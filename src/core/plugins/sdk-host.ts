import type {
  ActiveEditTarget, AssetDescriptor, ClipInfo, CommandDefinition, DocumentApi, DocumentInfo,
  DocumentTransaction, ExtensionScope, ExtensionValue, FrameQueryApi, ImporterDefinition, JsonValue,
  LayerInfo, LightTableEventMap, LightTablePlugin, ModeDefinition, NodeInfo, NodeRenderGate,
  PanelDefinition, PluginApi, PluginLogger, PluginManifestRef, ProjectSnapshot, RenderServiceApi,
  ResolvedTick, SelectionApi, SelectionRef, SettingsDefinition, ToolDefinition, ToolbarItemDefinition,
  MenuItemDefinition, TransactionOptions, TransactionResult, TrackInfo, OverlayDefinition, ExporterDefinition, PluginPermission,
} from '../../../contracts/plugin-api';
import type { ProjectDocumentV1, ContentLayer, ContentNode, AnimationTrack, ExposureClip, Cel } from '../document/types';
import { cloneValue, newId, resolveClipAt, type AssetDescriptor as HostAssetDescriptor } from '../document/types';
import { TransactionEngine } from '../history/transaction-engine';
import { RendererRegistry } from '../rendering/renderer-registry';
import { renderTickToCanvas } from '../rendering/render-service';
import type { ProjectRepository } from '../storage/project-repository';

export interface Disposable { dispose(): void }
export interface HostRegistries {
  tools: Map<string, ToolDefinition>;
  modes: Map<string, ModeDefinition>;
  panels: Map<string, PanelDefinition>;
  toolbar: Map<string, ToolbarItemDefinition>;
  menus: Map<string, MenuItemDefinition>;
  commands: Map<string, CommandDefinition>;
  overlays: Map<string, OverlayDefinition>;
  importers: Map<string, ImporterDefinition>;
  exporters: Map<string, ExporterDefinition>;
  settings: Map<string, SettingsDefinition>;
  onChange(): void;
}

class RegistrationStore {
  private items: Disposable[] = [];
  add<T extends Disposable>(item: T): T { this.items.push(item); return item; }
  clear(): void {
    const items = this.items.splice(0).reverse();
    for (const item of items) { try { item.dispose(); } catch (error) { console.warn('Plugin registration cleanup failed.', error); } }
  }
  dispose(): void { this.clear(); }
}

class EventBus {
  private listeners = new Map<keyof LightTableEventMap, Set<(payload: never) => void>>();
  emit<K extends keyof LightTableEventMap>(name: K, payload: LightTableEventMap[K]): void {
    // A failing extension listener must not interrupt host events or other plugins.
    for (const listener of [...(this.listeners.get(name) ?? [])]) {
      try { listener(payload as never); }
      catch (error) { console.error(`Plugin event listener failed for ${String(name)}.`, error); }
    }
  }
  on<K extends keyof LightTableEventMap>(name: K, listener: (payload: LightTableEventMap[K]) => void): Disposable {
    const listeners = this.listeners.get(name) ?? new Set<(payload: never) => void>();
    listeners.add(listener as (payload: never) => void);
    this.listeners.set(name, listeners);
    return disposable(() => listeners.delete(listener as (payload: never) => void));
  }
}

export interface PluginHostContext {
  readonly engine: TransactionEngine;
  readonly repository: ProjectRepository;
  readonly renderers: RendererRegistry;
  readonly registries: HostRegistries;
  readonly getCurrentTick: () => number;
  readonly setCurrentTick: (tick: number) => void;
  readonly getActiveTarget: () => ActiveEditTarget | undefined;
  readonly invalidate: () => void;
}

export function createPluginApi(plugin: PluginManifestRef, host: PluginHostContext, events: EventBus): PluginApi {
  const registrations = new RegistrationStore();
  const { engine, repository, renderers, registries } = host;
  const query = () => engine.document;
  const grantedPermissions = new Set<PluginPermission>(plugin.permissions ?? []);
  const requirePermission = (permission: PluginPermission): void => {
    if (!grantedPermissions.has(permission)) throw new Error(`Plugin ${plugin.id} is not granted the ${permission} capability.`);
  };
  const logger: PluginLogger = {
    debug: (message, data) => console.debug(`[${plugin.id}] ${message}`, data ?? ''),
    info: (message, data) => console.info(`[${plugin.id}] ${message}`, data ?? ''),
    warn: (message, data) => console.warn(`[${plugin.id}] ${message}`, data ?? ''),
    error: (message, data) => console.error(`[${plugin.id}] ${message}`, data ?? ''),
  };

  const documentApi = guardApiMethods(createDocumentApi(host), (method) => method === 'transact' ? 'document.write' : 'document.read', requirePermission);
  const frameApi = guardApiMethods(createFrameApi(host, events), () => 'timeline.read', requirePermission);
  const selectionState: SelectionRef[] = [];
  const selectionListeners = new Set<(selection: readonly SelectionRef[]) => void>();
  const selection: SelectionApi = {
    getSelection: () => { requirePermission('selection.read'); return cloneValue(selectionState); },
    setSelection(next) {
      requirePermission('selection.write');
      selectionState.splice(0, selectionState.length, ...cloneValue(next));
      for (const listener of selectionListeners) listener(cloneValue(selectionState));
      events.emit('selection.changed', { selection: cloneValue(selectionState) });
    },
    clear() { requirePermission('selection.write'); this.setSelection([]); },
    onChanged(listener) { requirePermission('selection.read'); selectionListeners.add(listener); return disposable(() => selectionListeners.delete(listener)); },
  };

  const register = <T>(map: Map<string, T>, id: string, value: T): Disposable => {
    const key = `${plugin.id}:${id}`;
    if (!id.trim() || map.has(key)) throw new Error(`Plugin contribution already registered: ${key}`);
    map.set(key, value);
    registries.onChange();
    return disposable(() => { map.delete(key); registries.onChange(); });
  };

  const renderService: RenderServiceApi = {
    async renderCel(celId, options) {
      requirePermission('canvas.render');
      const project = query();
      const cel = project.cels[celId];
      if (!cel) throw new Error(`Cel ${celId} no longer exists.`);
      const selectedCel: Cel = cloneValue(cel);
      if (options.layerIds) selectedCel.layers = selectedCel.layers.filter((layer) => options.layerIds!.includes(layer.id));
      const track = project.tracks[0];
      if (!track) throw new Error('The project has no animation track.');
      const renderProject = cloneValue(project);
      renderProject.document.durationTicks = 1;
      renderProject.tracks = [{ ...cloneValue(track), clips: [{ id: newId('clip'), startTick: 0, durationTicks: 1, celId }] }];
      renderProject.cels = { [celId]: selectedCel };
      const result = await renderTickToCanvas(renderProject, 0, renderers, repository, {
        intent: options.intent, background: options.background, width: options.width,
        height: options.height, signal: options.signal, strictMissingRenderers: false, revision: engine.revision,
      });
      const bitmap = await canvasToBitmap(result.canvas);
      return { bitmap, width: result.width, height: result.height, documentRevision: engine.revision, warnings: result.warnings };
    },
    async *renderFrames(request, controls) {
      requirePermission('canvas.render');
      const project = query();
      const snapshotRevision = engine.revision;
      const ticks: readonly number[] = Array.isArray(request.ticks)
        ? request.ticks as readonly number[]
        : (() => { const range = request.ticks as { readonly start: number; readonly endExclusive: number }; return Array.from({ length: Math.max(0, range.endExclusive - range.start) }, (_, index) => range.start + index); })();
      for (let index = 0; index < ticks.length; index += 1) {
        if (controls?.signal?.aborted) throw abortError();
        const rendered = await renderTickToCanvas(project, ticks[index], renderers, repository, {
          intent: request.intent, background: request.background,
          width: request.width, height: request.height, revision: snapshotRevision,
          signal: controls?.signal, strictMissingRenderers: false,
        });
        yield {
          tick: ticks[index], bitmap: await canvasToBitmap(rendered.canvas), width: rendered.width,
          height: rendered.height, documentRevision: snapshotRevision, warnings: rendered.warnings,
        };
        controls?.onProgress?.((index + 1) / ticks.length);
      }
    },
  };

  const api: PluginApi = {
    plugin,
    document: documentApi,
    frames: frameApi,
    selection,
    assets: {
      get: (id) => { requirePermission('assets.read'); return repository.getAsset(id); },
      getDescriptor: (id) => { requirePermission('assets.read'); return hostDescriptor(repository.getAssetDescriptor(id)); },
      put: async (blob, metadata) => { requirePermission('assets.write'); return cloneValue(await repository.putAsset(blob, metadata?.fileName)) as AssetDescriptor; },
    },
    storage: {
      get: async <T extends JsonValue>(key: string) => { requirePermission('storage.plugin'); return await repository.getPluginValue<JsonValue>(plugin.id, key) as T | undefined; },
      set: (key, value) => { requirePermission('storage.plugin'); return repository.setPluginValue(plugin.id, key, value); },
      delete: (key) => { requirePermission('storage.plugin'); return repository.deletePluginValue(plugin.id, key); },
      keys: () => { requirePermission('storage.plugin'); return repository.listPluginKeys(plugin.id); },
    },
    events: { on: (name, listener) => { requirePermission('document.read'); return events.on(name, listener); } },
    render: renderService,
    logger,
    registrations,
    tools: { register: (definition) => { requirePermission('canvas.input'); return register(registries.tools, definition.id, definition); } },
    modes: { register: (definition) => { requirePermission('ui.modes'); return register(registries.modes, definition.id, definition); } },
    panels: { register: (definition) => { requirePermission('ui.panels'); return register(registries.panels, definition.id, definition); } },
    toolbar: { register: (definition) => { requirePermission('ui.toolbar'); return register(registries.toolbar, definition.id, definition); } },
    menus: { register: (definition) => { requirePermission('ui.toolbar'); return register(registries.menus, definition.id, definition); } },
    commands: { register: (definition) => { requirePermission('history.commands'); return register(registries.commands, definition.id, definition); } },
    renderers: {
      registerNode: (definition) => { requirePermission('canvas.render'); return disposable(renderers.registerNode(plugin.id, definition as unknown as import('../rendering/renderer-registry').NodeRenderer)); },
      registerNodeRenderGate: (nodeType, gate) => { requirePermission('canvas.render'); return disposable(renderers.registerNodeRenderGate(plugin.id, nodeType, gate as NodeRenderGate)); },
      registerOverlay: (definition) => { requirePermission('canvas.render'); return register(registries.overlays, definition.id, definition); },
    },
    importers: { register: (definition) => { requirePermission('project.import'); return register(registries.importers, definition.id, definition); } },
    exporters: { register: (definition) => { requirePermission('project.export'); return register(registries.exporters, definition.id, definition); } },
    settings: {
      register: (definition) => { requirePermission('storage.plugin'); return register(registries.settings, definition.id, definition); },
      get: <T extends JsonValue>(key: string) => { requirePermission('storage.plugin'); return settingsValues.get(`${plugin.id}:${key}`) as T | undefined; },
      set: async <T extends JsonValue>(key: string, value: T) => { requirePermission('storage.plugin'); settingsValues.set(`${plugin.id}:${key}`, cloneValue(value)); await repository.setPluginValue(plugin.id, `setting:${key}`, value); },
    },
  };
  return api;
}

function guardApiMethods<T extends object>(
  target: T,
  permissionFor: (method: string) => PluginPermission,
  requirePermission: (permission: PluginPermission) => void,
): T {
  return new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        requirePermission(permissionFor(String(property)));
        return (value as (...items: unknown[]) => unknown).apply(object, args);
      };
    },
  });
}

const settingsValues = new Map<string, JsonValue>();

function createDocumentApi(host: PluginHostContext): DocumentApi {
  const { engine } = host;
  const get = () => engine.document;
  const info = (): DocumentInfo => {
    const p = get();
    return { projectId: p.projectId, name: p.name, revision: engine.revision, width: p.document.width, height: p.document.height, colorSpace: 'srgb', frameRate: cloneValue(p.document.frameRate), durationTicks: p.document.durationTicks };
  };
  const toTrackInfo = (track: AnimationTrack): TrackInfo => ({ id: track.id, name: track.name, visible: track.visible, locked: track.locked, opacity: track.opacity, blendMode: track.blendMode });
  const toClipInfo = (trackId: string, clip: ExposureClip): ClipInfo => ({ id: clip.id, trackId, startTick: clip.startTick, durationTicks: clip.durationTicks, celId: clip.celId });
  const toLayerInfo = (celId: string, layer: ContentLayer): LayerInfo => ({ id: layer.id, celId, name: layer.name, visible: layer.visible, locked: layer.locked, opacity: layer.opacity, blendMode: layer.blendMode });
  const toNodeInfo = (node: ContentNode): NodeInfo => cloneValue(node) as unknown as NodeInfo;

  return {
    getInfo: info,
    getSnapshot: (): ProjectSnapshot => ({ info: info(), tracks: get().tracks.map(toTrackInfo), revision: engine.revision }),
    resolveTick: (tick): ResolvedTick => {
      const project = get();
      return { tick, tracks: project.tracks.map((track) => {
        const clip = resolveClipAt(track, tick);
        return { track: toTrackInfo(track), clip: clip ? toClipInfo(track.id, clip) : undefined, celId: clip?.celId };
      }) };
    },
    listTracks: () => get().tracks.map(toTrackInfo),
    getTrack: (trackId) => { const track = get().tracks.find((item) => item.id === trackId); return track ? toTrackInfo(track) : undefined; },
    listClips: (trackId) => { const track = get().tracks.find((item) => item.id === trackId); return track ? track.clips.map((clip) => toClipInfo(trackId, clip)) : []; },
    getClip: (trackId, clipId) => { const clip = get().tracks.find((item) => item.id === trackId)?.clips.find((item) => item.id === clipId); return clip ? toClipInfo(trackId, clip) : undefined; },
    getCel: (celId) => { const cel = get().cels[celId]; return cel ? { id: cel.id, layers: cel.layers.map((layer) => toLayerInfo(celId, layer)) } : undefined; },
    getLayer: (celId, layerId) => { const layer = get().cels[celId]?.layers.find((item) => item.id === layerId); return layer ? toLayerInfo(celId, layer) : undefined; },
    listNodes: (celId, layerId) => get().cels[celId]?.layers.find((item) => item.id === layerId)?.nodes.map(toNodeInfo) ?? [],
    getNode: (celId, layerId, nodeId) => { const node = get().cels[celId]?.layers.find((item) => item.id === layerId)?.nodes.find((item) => item.id === nodeId); return node ? toNodeInfo(node) : undefined; },
    getExtension: (scope, namespace) => getExtension(get(), scope, namespace),
    transact(options: TransactionOptions, build: (tx: DocumentTransaction) => void): TransactionResult {
      const baseRevision = engine.revision;
      const result = engine.transact(options.label, (draft) => build(createTransaction(draft, baseRevision)), { expectedRevision: options.expectedRevision, undoable: options.undoable });
      return { ...result, committed: result.committed, revision: result.revision, transactionId: result.committed ? `revision-${result.revision}` : undefined };
    },
  };
}

function createTransaction(project: ProjectDocumentV1, baseRevision: number): DocumentTransaction {
  return {
    baseRevision,
    nodes: {
      insert({ celId, layerId, node, index }) {
        const layer = requireLayer(project, celId, layerId);
        const value = cloneValue(node) as unknown as ContentNode;
        if (layer.nodes.some((item) => item.id === value.id)) throw new Error(`Node ${value.id} already exists.`);
        layer.nodes.splice(clampIndex(index, layer.nodes.length), 0, value);
      },
      update({ celId, layerId, nodeId, patch }) {
        const node = requireLayer(project, celId, layerId).nodes.find((item) => item.id === nodeId);
        if (!node) throw new Error(`Node ${nodeId} no longer exists.`);
        Object.assign(node, cloneValue(patch));
      },
      remove({ celId, layerId, nodeId }) {
        const layer = requireLayer(project, celId, layerId);
        const index = layer.nodes.findIndex((node) => node.id === nodeId);
        if (index >= 0) layer.nodes.splice(index, 1);
      },
      move({ celId, fromLayerId, toLayerId, nodeId, index }) {
        const from = requireLayer(project, celId, fromLayerId);
        const to = requireLayer(project, celId, toLayerId);
        const at = from.nodes.findIndex((node) => node.id === nodeId);
        if (at < 0) throw new Error(`Node ${nodeId} no longer exists.`);
        const [node] = from.nodes.splice(at, 1);
        to.nodes.splice(clampIndex(index, to.nodes.length), 0, node);
      },
    },
    layers: {
      insert({ celId, layer, index }) {
        const cel = requireCel(project, celId);
        if (cel.layers.length >= 4) throw new Error('A cel can contain at most four layers.');
        const value: ContentLayer = { ...cloneValue(layer), kind: 'content', nodes: cloneValue(layer.nodes ?? []) } as ContentLayer;
        if (cel.layers.some((item) => item.id === value.id)) throw new Error(`Layer ${value.id} already exists.`);
        cel.layers.splice(clampIndex(index, cel.layers.length), 0, value);
      },
      update({ celId, layerId, patch }) { Object.assign(requireLayer(project, celId, layerId), cloneValue(patch)); },
      remove({ celId, layerId }) {
        const cel = requireCel(project, celId);
        if (cel.layers.length <= 1) throw new Error('A cel must retain at least one layer.');
        const index = cel.layers.findIndex((layer) => layer.id === layerId);
        if (index < 0) throw new Error(`Layer ${layerId} no longer exists.`);
        cel.layers.splice(index, 1);
      },
      reorder({ celId, layerId, toIndex }) {
        const cel = requireCel(project, celId);
        const index = cel.layers.findIndex((layer) => layer.id === layerId);
        if (index < 0) throw new Error(`Layer ${layerId} no longer exists.`);
        const [layer] = cel.layers.splice(index, 1);
        cel.layers.splice(clampIndex(toIndex, cel.layers.length), 0, layer);
      },
    },
    cels: {
      create(input) {
        const source = input?.cloneFromCelId ? requireCel(project, input.cloneFromCelId) : undefined;
        const celId = input?.celId ?? newId('cel');
        if (project.cels[celId]) throw new Error(`Cel ${celId} already exists.`);
        const cel = source ? cloneValue(source) : { id: celId, layers: [{ id: newId('layer'), name: 'Rough', kind: 'content' as const, visible: true, locked: false, opacity: 1, blendMode: 'normal', nodes: [] }] };
        cel.id = celId;
        project.cels[celId] = cel;
        return celId;
      },
      remove({ celId, onlyIfUnreferenced }) {
        if (onlyIfUnreferenced && project.tracks.some((track) => track.clips.some((clip) => clip.celId === celId))) throw new Error(`Cel ${celId} is still referenced by an exposure.`);
        if (!project.cels[celId]) return;
        delete project.cels[celId];
      },
    },
    tracks: {
      insert({ track, index }) {
        const id = track.id ?? newId('track');
        if (project.tracks.some((item) => item.id === id)) throw new Error(`Track ${id} already exists.`);
        project.tracks.splice(clampIndex(index, project.tracks.length), 0, { ...cloneValue(track), id, clips: [] } as AnimationTrack);
        return id;
      },
      update({ trackId, patch }) { Object.assign(requireTrack(project, trackId), cloneValue(patch)); },
      remove({ trackId, policy }) {
        const index = project.tracks.findIndex((track) => track.id === trackId);
        if (index < 0) return;
        if (policy === 'reject-if-has-clips' && project.tracks[index].clips.length) throw new Error('Track still contains exposures.');
        if (project.tracks.length <= 1) throw new Error('A project must retain at least one track.');
        project.tracks.splice(index, 1);
      },
      reorder({ trackId, toIndex }) {
        const index = project.tracks.findIndex((track) => track.id === trackId);
        if (index < 0) throw new Error(`Track ${trackId} no longer exists.`);
        const [track] = project.tracks.splice(index, 1);
        project.tracks.splice(clampIndex(toIndex, project.tracks.length), 0, track);
      },
    },
    documentSettings: {
      setFrameRate(rate) { project.document.frameRate = cloneValue(rate); },
      setDurationTicks(count) {
        if (!Number.isInteger(count) || count < 1) throw new Error('Duration must be a positive frame count.');
        project.document.durationTicks = count;
        for (const track of project.tracks) track.clips = track.clips.flatMap((clip) => {
          if (clip.startTick >= count) return [];
          if (clip.startTick + clip.durationTicks > count) clip.durationTicks = count - clip.startTick;
          return [clip];
        });
      },
      setBackground(background) { project.document.background = cloneValue(background); },
    },
    clips: {
      insert({ trackId, clip, collisionPolicy = 'reject' }) {
        const track = requireTrack(project, trackId);
        const value = cloneValue(clip) as ExposureClip;
        applyCollisionPolicy(track, value, collisionPolicy);
        track.clips.push(value);
        track.clips.sort((a, b) => a.startTick - b.startTick);
      },
      update({ trackId, clipId, patch, collisionPolicy = 'reject' }) {
        const track = requireTrack(project, trackId);
        const clip = track.clips.find((item) => item.id === clipId);
        if (!clip) throw new Error(`Exposure ${clipId} no longer exists.`);
        const candidate = { ...clip, ...cloneValue(patch) };
        const others = track.clips.filter((item) => item.id !== clipId);
        const overlap = others.find((item) => candidate.startTick < item.startTick + item.durationTicks && candidate.startTick + candidate.durationTicks > item.startTick);
        if (overlap && collisionPolicy === 'reject') throw new Error('Exposure update would overlap another exposure.');
        if (overlap && collisionPolicy === 'ripple') {
          for (const item of others.filter((item) => item.startTick >= candidate.startTick)) item.startTick += candidate.durationTicks;
        }
        Object.assign(clip, candidate);
      },
      remove({ trackId, clipId }) { const track = requireTrack(project, trackId); track.clips = track.clips.filter((clip) => clip.id !== clipId); },
      move({ clipId, fromTrackId, toTrackId, startTick, collisionPolicy }) {
        const source = requireTrack(project, fromTrackId);
        const index = source.clips.findIndex((item) => item.id === clipId);
        if (index < 0) throw new Error(`Exposure ${clipId} no longer exists.`);
        const [clip] = source.clips.splice(index, 1);
        clip.startTick = startTick;
        const destination = requireTrack(project, toTrackId);
        applyCollisionPolicy(destination, clip, collisionPolicy);
        destination.clips.push(clip);
        destination.clips.sort((a, b) => a.startTick - b.startTick);
      },
    },
    extensions: {
      set({ scope, namespace, value }) { const owner = getScopeOwner(project, scope); const ext = owner.extensions ?? (owner.extensions = {}); ext[namespace] = cloneValue(value) as unknown as import('../document/types').PluginExtension; },
      remove({ scope, namespace }) { const owner = getScopeOwner(project, scope); if (owner.extensions) delete owner.extensions[namespace]; },
    },
    metadata: { set({ key, value }) { (project.metadata ??= {})[key] = cloneValue(value); } },
  };
}

function createFrameApi(host: PluginHostContext, events: EventBus): FrameQueryApi {
  const project = () => host.engine.document;
  return {
    getCurrentTick: host.getCurrentTick,
    getFrameRate: () => cloneValue(project().document.frameRate),
    getDurationTicks: () => project().document.durationTicks,
    getExposureAt(trackId, tick) { const track = project().tracks.find((item) => item.id === trackId); const clip = track ? resolveClipAt(track, tick) : undefined; return clip ? { id: clip.id, trackId, startTick: clip.startTick, durationTicks: clip.durationTicks, celId: clip.celId } : undefined; },
    getNeighborTicks(tick, before, after) {
      const current = project();
      const track = current.tracks[0];
      if (!track) return [];
      const result: number[] = [];
      const currentClip = resolveClipAt(track, tick);
      const previous: number[] = [];
      const next: number[] = [];
      let seen = currentClip?.celId;
      for (let value = tick - 1; value >= 0 && previous.length < Math.min(3, before); value -= 1) {
        const clip = resolveClipAt(track, value);
        if (clip && clip.celId !== seen) { previous.push(value); seen = clip.celId; }
      }
      seen = currentClip?.celId;
      for (let value = tick + 1; value < current.document.durationTicks && next.length < Math.min(3, after); value += 1) {
        const clip = resolveClipAt(track, value);
        if (clip && clip.celId !== seen) { next.push(value); seen = clip.celId; }
      }
      result.push(...previous.reverse(), ...next);
      return result.sort((a, b) => a - b);
    },
    onPlayheadChanged(listener) { return events.on('playhead.changed', ({ tick: value }) => listener(value)); },
    onPlaybackChanged(listener) {
      const started = events.on('playback.started', () => listener('playing'));
      const stopped = events.on('playback.stopped', () => listener('paused'));
      return disposable(() => { started.dispose(); stopped.dispose(); });
    },
  };
}

function getExtension(project: ProjectDocumentV1, scope: ExtensionScope, namespace: string): ExtensionValue | undefined {
  const owner = getScopeOwner(project, scope);
  const value = owner.extensions?.[namespace];
  return value ? cloneValue(value) as ExtensionValue : undefined;
}
function getScopeOwner(project: ProjectDocumentV1, scope: ExtensionScope): ProjectDocumentV1 | AnimationTrack | Cel | ContentLayer | ContentNode {
  switch (scope.kind) {
    case 'project': return project;
    case 'track': { const track = project.tracks.find((item) => item.id === scope.trackId); if (track) return track; break; }
    case 'cel': { const cel = project.cels[scope.celId]; if (cel) return cel; break; }
    case 'layer': { const layer = project.cels[scope.celId]?.layers.find((item) => item.id === scope.layerId); if (layer) return layer; break; }
    case 'node': { const node = project.cels[scope.celId]?.layers.find((item) => item.id === scope.layerId)?.nodes.find((item) => item.id === scope.nodeId); if (node) return node; break; }
    default: assertNever(scope);
  }
  throw new Error('Extension scope target does not exist.');
}
function requireCel(project: ProjectDocumentV1, celId: string): Cel { const cel = project.cels[celId]; if (!cel) throw new Error(`Cel ${celId} does not exist.`); return cel; }
function requireLayer(project: ProjectDocumentV1, celId: string, layerId: string): ContentLayer { const layer = requireCel(project, celId).layers.find((item) => item.id === layerId); if (!layer) throw new Error(`Layer ${layerId} does not exist.`); return layer; }
function requireTrack(project: ProjectDocumentV1, id: string): AnimationTrack { const track = project.tracks.find((item) => item.id === id); if (!track) throw new Error(`Track ${id} does not exist.`); return track; }
function applyCollisionPolicy(track: AnimationTrack, clip: ExposureClip, policy: 'reject' | 'ripple'): void {
  const overlaps = track.clips.filter((item) => clip.startTick < item.startTick + item.durationTicks && clip.startTick + clip.durationTicks > item.startTick);
  if (overlaps.length && policy === 'reject') throw new Error('Exposure would overlap another exposure.');
  if (overlaps.length && policy === 'ripple') {
    const end = clip.startTick + clip.durationTicks;
    for (const item of track.clips.filter((item) => item.startTick < end && item.startTick + item.durationTicks > clip.startTick)) item.startTick = end;
  }
}
function clampIndex(index: number | undefined, length: number): number { return Math.max(0, Math.min(length, Number.isFinite(index) ? Math.trunc(index!) : length)); }
function assertNever(value: never): never { throw new Error(`Unsupported scope ${(value as { kind?: string }).kind ?? 'unknown'}`); }
function hostDescriptor(value: HostAssetDescriptor | undefined): AssetDescriptor | undefined { return value ? cloneValue(value) : undefined; }
function disposable(dispose: () => void): Disposable { let active = true; return { dispose() { if (!active) return; active = false; dispose(); } }; }
async function canvasToBitmap(canvas: HTMLCanvasElement): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(canvas);
  throw new Error('ImageBitmap rendering is unavailable in this browser.');
}
function abortError(): Error { const error = new Error('Rendering cancelled.'); error.name = 'AbortError'; return error; }

export class PluginRuntime {
  private api?: PluginApi;
  private abort?: AbortController;
  private active = false;
  constructor(private plugin: LightTablePlugin, private host: PluginHostContext, private events: EventBus) {}
  get isActive(): boolean { return this.active; }
  async enable(): Promise<void> {
    if (this.active) return;
    if (this.plugin.manifest.apiVersionRange !== '^1.0.0') throw new Error(`Plugin SDK range ${this.plugin.manifest.apiVersionRange} is incompatible with host SDK 1.0.0.`);
    if (this.plugin.manifest.execution !== 'trusted-ui') throw new Error('LightTable SDK v1 activates trusted-ui plugins only; worker and unspecified execution profiles are rejected.');
    const supportedPermissions: readonly PluginPermission[] = ['document.read', 'document.write', 'timeline.read', 'timeline.write', 'canvas.input', 'canvas.render', 'selection.read', 'selection.write', 'ui.panels', 'ui.toolbar', 'ui.modes', 'history.commands', 'project.import', 'project.export', 'assets.read', 'assets.write', 'storage.plugin', 'network'];
    for (const permission of this.plugin.manifest.permissions ?? []) if (!supportedPermissions.includes(permission)) throw new Error(`Plugin requests unsupported capability: ${String(permission)}.`);
    this.abort = new AbortController();
    const api = createPluginApi(this.plugin.manifest, this.host, this.events);
    this.api = api;
    try {
      await this.plugin.activate(api, { signal: this.abort.signal, logger: api.logger });
      if (this.abort.signal.aborted) throw new Error('Plugin activation was cancelled.');
      this.active = true;
      this.events.emit('plugin.activated', { pluginId: this.plugin.manifest.id, version: this.plugin.manifest.version });
    } catch (error) {
      this.abort.abort();
      api.registrations.clear();
      this.host.renderers.clearPlugin(this.plugin.manifest.id);
      this.api = undefined;
      throw error;
    }
  }
  async disable(reason: 'disable' | 'uninstall' | 'update' | 'shutdown' | 'failure' = 'disable'): Promise<void> {
    if (!this.api && !this.active) return;
    this.abort?.abort();
    this.events.emit('project.closing', { projectId: this.host.engine.document.projectId });
    try { await this.plugin.deactivate?.(reason); }
    finally {
      this.api?.registrations.clear();
      this.host.renderers.clearPlugin(this.plugin.manifest.id);
      this.api = undefined;
      this.active = false;
      this.events.emit('plugin.deactivated', { pluginId: this.plugin.manifest.id });
    }
  }
  get registeredApi(): PluginApi | undefined { return this.api; }
}

export { EventBus };
