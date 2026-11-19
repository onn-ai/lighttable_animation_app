import { cloneValue, createCel, createLayer, newId, primaryTrack, resolveClipAt, type AnimationTrack, type ContentLayer, type ExposureClip, type ProjectDocumentV1 } from './types';
import type { TransactionEngine } from '../history/transaction-engine';
import { MAX_LAYERS_PER_CEL_V1, MAX_USER_FRAME_COUNT } from './types';

/** Create a new independent animation track with a blank drawing for each timeline tick. */
export function addTrack(engine: TransactionEngine, requestedName?: string): string {
  let createdTrackId = '';
  engine.transact('Add animation track', (draft) => {
    const index = draft.tracks.length + 1;
    const name = requestedName?.trim().slice(0, 64) || `Animation ${index}`;
    const track: AnimationTrack = {
      id: newId('track'), name, visible: true, locked: false, opacity: 1, blendMode: 'normal', clips: [],
    };
    for (let tick = 0; tick < draft.document.durationTicks; tick += 1) {
      const cel = createCel('Layer 1');
      draft.cels[cel.id] = cel;
      track.clips.push({ id: newId('clip'), startTick: tick, durationTicks: 1, celId: cel.id });
    }
    draft.tracks.push(track);
    createdTrackId = track.id;
  });
  return createdTrackId;
}

export function insertBlankFrame(engine: TransactionEngine, trackId: string, currentTick: number): number {
  if (engine.document.document.durationTicks >= MAX_USER_FRAME_COUNT) throw new Error(`LightTable supports up to ${MAX_USER_FRAME_COUNT} user-facing frames in this workflow.`);
  const insertionTick = Math.max(0, currentTick + 1);
  engine.transact('Add blank frame', (draft) => {
    insertTimelinePosition(draft, insertionTick);
    const cel = createCel('Layer 1');
    draft.cels[cel.id] = cel;
    const track = requireTrack(draft, trackId);
    track.clips.push({ id: newId('clip'), startTick: insertionTick, durationTicks: 1, celId: cel.id });
    track.clips.sort((a, b) => a.startTick - b.startTick);
    draft.document.durationTicks += 1;
  });
  return insertionTick;
}

export function duplicateFrame(engine: TransactionEngine, trackId: string, currentTick: number): number {
  if (engine.document.document.durationTicks >= MAX_USER_FRAME_COUNT) throw new Error(`LightTable supports up to ${MAX_USER_FRAME_COUNT} user-facing frames in this workflow.`);
  const insertionTick = Math.max(0, currentTick + 1);
  engine.transact('Duplicate frame', (draft) => {
    const track = requireTrack(draft, trackId);
    const sourceClip = resolveClipAt(track, currentTick);
    const sourceCel = sourceClip ? draft.cels[sourceClip.celId] : undefined;
    const copy = sourceCel ? cloneCelWithFreshIds(sourceCel) : createCel('Layer 1');
    draft.cels[copy.id] = copy;
    insertTimelinePosition(draft, insertionTick);
    const activeTrack = requireTrack(draft, trackId);
    activeTrack.clips.push({ id: newId('clip'), startTick: insertionTick, durationTicks: 1, celId: copy.id });
    activeTrack.clips.sort((a, b) => a.startTick - b.startTick);
    draft.document.durationTicks += 1;
  });
  return insertionTick;
}

export function deleteFrame(engine: TransactionEngine, trackId: string, currentTick: number): number {
  const duration = engine.document.document.durationTicks;
  if (duration > MAX_USER_FRAME_COUNT) throw new Error(`Frame editing is disabled for documents longer than ${MAX_USER_FRAME_COUNT} timeline positions; the imported project remains intact.`);
  if (duration <= 1) {
    engine.transact('Clear frame', (draft) => {
      const track = requireTrack(draft, trackId);
      const oldClip = resolveClipAt(track, 0);
      const cel = createCel('Layer 1');
      draft.cels[cel.id] = cel;
      if (oldClip) oldClip.celId = cel.id;
      else track.clips = [{ id: newId('clip'), startTick: 0, durationTicks: 1, celId: cel.id }];
      if (oldClip) oldClip.durationTicks = 1;
    });
    return 0;
  }
  const deletedTick = Math.max(0, Math.min(duration - 1, currentTick));
  engine.transact('Delete frame', (draft) => {
    for (const track of draft.tracks) {
      const next: ExposureClip[] = [];
      for (const clip of track.clips) {
        const end = clip.startTick + clip.durationTicks;
        if (clip.startTick >= deletedTick + 1) {
          clip.startTick -= 1;
          next.push(clip);
        } else if (clip.startTick <= deletedTick && end > deletedTick) {
          clip.durationTicks -= 1;
          if (clip.durationTicks > 0) next.push(clip);
        } else {
          next.push(clip);
        }
      }
      track.clips = next.sort((a, b) => a.startTick - b.startTick);
    }
    draft.document.durationTicks -= 1;
  });
  return Math.min(deletedTick, engine.document.document.durationTicks - 1);
}

function insertTimelinePosition(project: ProjectDocumentV1, tick: number): void {
  for (const track of project.tracks) {
    const next: ExposureClip[] = [];
    for (const clip of track.clips) {
      const end = clip.startTick + clip.durationTicks;
      if (clip.startTick >= tick) {
        clip.startTick += 1;
        next.push(clip);
      } else if (clip.startTick < tick && end > tick) {
        const oldEnd = end;
        const right = { ...cloneValue(clip), id: newId('clip'), startTick: tick + 1, durationTicks: oldEnd - tick };
        clip.durationTicks = tick - clip.startTick;
        next.push(clip, right);
      } else {
        next.push(clip);
      }
    }
    track.clips = next.sort((a, b) => a.startTick - b.startTick);
  }
}

function cloneCelWithFreshIds(source: ProjectDocumentV1['cels'][string]): ProjectDocumentV1['cels'][string] {
  const copy = cloneValue(source);
  copy.id = newId('cel');
  for (const layer of copy.layers) {
    layer.id = newId('layer');
    for (const node of layer.nodes) node.id = newId('node');
  }
  return copy;
}

export function addLayer(engine: TransactionEngine, celId: string, name?: string): string {
  let newLayerId = '';
  engine.transact('Add layer', (draft) => {
    const cel = draft.cels[celId];
    if (!cel) throw new Error('The active drawing no longer exists.');
    if (cel.layers.length >= MAX_LAYERS_PER_CEL_V1) throw new Error('A drawing can contain at most four layers.');
    const layerName = name?.trim() || nextLayerName(cel.layers);
    const layer = createLayer(layerName);
    newLayerId = layer.id;
    cel.layers.push(layer);
  });
  return newLayerId;
}

export function updateLayer(engine: TransactionEngine, celId: string, layerId: string, patch: Partial<Pick<ContentLayer, 'name' | 'visible' | 'locked' | 'opacity'>>): void {
  engine.transact('Update layer', (draft) => {
    const layer = draft.cels[celId]?.layers.find((item) => item.id === layerId);
    if (!layer) throw new Error('The selected layer no longer exists.');
    if (patch.name !== undefined) layer.name = patch.name.trim().slice(0, 64) || layer.name;
    if (patch.visible !== undefined) layer.visible = patch.visible;
    if (patch.locked !== undefined) layer.locked = patch.locked;
    if (patch.opacity !== undefined) layer.opacity = Math.max(0, Math.min(1, patch.opacity));
  });
}

export function removeLayer(engine: TransactionEngine, celId: string, layerId: string): void {
  engine.transact('Delete layer', (draft) => {
    const cel = draft.cels[celId];
    if (!cel) throw new Error('The active drawing no longer exists.');
    if (cel.layers.length <= 1) throw new Error('A drawing must keep at least one editable layer.');
    const index = cel.layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) throw new Error('The selected layer no longer exists.');
    if (cel.layers[index].locked) throw new Error('Unlock this layer before deleting it.');
    cel.layers.splice(index, 1);
  });
}

function nextLayerName(layers: ContentLayer[]): string {
  for (let i = 1; i <= 4; i += 1) {
    const name = `Layer ${i}`;
    if (!layers.some((layer) => layer.name === name)) return name;
  }
  return 'Layer';
}

function requireTrack(project: ProjectDocumentV1, id: string) {
  const track = project.tracks.find((item) => item.id === id);
  if (!track) throw new Error(`Animation track ${id} is missing.`);
  if (track.locked) throw new Error('Unlock the animation track before editing it.');
  return track;
}

export function getActiveTarget(project: ProjectDocumentV1, tick: number, trackId = primaryTrack(project).id, layerId?: string) {
  const track = project.tracks.find((item) => item.id === trackId);
  const clip = track ? resolveClipAt(track, tick) : undefined;
  const cel = clip ? project.cels[clip.celId] : undefined;
  if (!track || !clip || !cel) return undefined;
  const layer = layerId ? cel.layers.find((item) => item.id === layerId) : [...cel.layers].reverse().find((item) => item.visible);
  if (!layer) return undefined;
  return { tick, trackId, clipId: clip.id, celId: cel.id, layerId: layer.id, layerLocked: layer.locked };
}
