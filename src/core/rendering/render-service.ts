import type { AssetDescriptor, ContentNode, ProjectDocumentV1 } from '../document/types';
import { resolveClipAt } from '../document/types';
import { RendererRegistry, assertNodeEnvelope, type RenderIntent } from './renderer-registry';
import { renderCorePath } from './path-renderer';

export type ExportBackground = 'document' | 'white' | 'transparent';
export interface RenderOptions {
  width?: number;
  height?: number;
  background?: ExportBackground;
  intent?: RenderIntent;
  trackIds?: readonly string[];
  signal?: AbortSignal;
  strictMissingRenderers?: boolean;
  revision?: number;
}
export interface RenderDiagnostic {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  nodeId?: string;
  pluginId?: string;
  tick?: number;
}
export interface RenderResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  revision: number;
  warnings: RenderDiagnostic[];
}
export class MissingNodeRendererError extends Error {
  constructor(readonly nodeType: string, readonly nodeId: string) {
    super(`No renderer is installed for ${nodeType} (node ${nodeId}).`);
    this.name = 'MissingNodeRendererError';
  }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function paintBackground(ctx: CanvasRenderingContext2D, project: ProjectDocumentV1, background: ExportBackground): void {
  if (background === 'transparent') return;
  if (background === 'white') {
    ctx.fillStyle = '#FFFFFF';
  } else if (project.document.background.kind === 'solid') {
    ctx.fillStyle = project.document.background.color;
  } else {
    return;
  }
  ctx.fillRect(0, 0, project.document.width, project.document.height);
}

function renderNodePlaceholder(ctx: CanvasRenderingContext2D, node: ContentNode): void {
  ctx.save();
  ctx.strokeStyle = '#C75B55';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(20, 20, 180, 54);
  ctx.setLineDash([]);
  ctx.fillStyle = '#8F2F2A';
  ctx.font = '16px sans-serif';
  ctx.fillText(`Missing: ${node.type}`, 28, 52);
  ctx.restore();
}

export async function renderTickToCanvas(
  project: ProjectDocumentV1,
  tick: number,
  registry: RendererRegistry,
  assets: { get(id: string): Promise<Blob | undefined>; getDescriptor(id: string): AssetDescriptor | undefined },
  options: RenderOptions = {},
): Promise<RenderResult> {
  const width = Math.max(1, Math.round(options.width ?? project.document.width));
  const height = Math.max(1, Math.round(options.height ?? project.document.height));
  const intent = options.intent ?? 'editor';
  const warnings: RenderDiagnostic[] = [];
  const root = makeCanvas(width, height);
  const rootCtx = root.getContext('2d');
  if (!rootCtx) throw new Error('A 2D rendering context is not available.');
  const scaleX = width / project.document.width;
  const scaleY = height / project.document.height;
  rootCtx.scale(scaleX, scaleY);
  paintBackground(rootCtx, project, options.background ?? 'document');

  const trackFilter = options.trackIds ? new Set(options.trackIds) : undefined;
  for (const track of project.tracks) {
    if (options.signal?.aborted) throw abortError();
    if (!track.visible || (trackFilter && !trackFilter.has(track.id))) continue;
    if (track.blendMode !== 'normal') warnings.push({ severity: 'warning', code: 'unsupported-blend-mode', message: `Track blend mode '${track.blendMode}' is not supported yet; normal blending is used.`, tick });
    const clip = resolveClipAt(track, tick);
    if (!clip) continue;
    const cel = project.cels[clip.celId];
    if (!cel) throw new Error(`Exposure ${clip.id} references missing cel ${clip.celId}.`);
    const trackCanvas = makeCanvas(width, height);
    const trackCtx = trackCanvas.getContext('2d');
    if (!trackCtx) throw new Error('Could not create track render surface.');
    trackCtx.scale(scaleX, scaleY);

    for (const layer of cel.layers) {
      if (!layer.visible) continue;
      if (layer.blendMode !== 'normal') warnings.push({ severity: 'warning', code: 'unsupported-blend-mode', message: `Layer blend mode '${layer.blendMode}' is not supported yet; normal blending is used.`, tick });
      const layerCanvas = makeCanvas(width, height);
      const layerCtx = layerCanvas.getContext('2d');
      if (!layerCtx) throw new Error('Could not create layer render surface.');
      layerCtx.scale(scaleX, scaleY);
      for (const node of layer.nodes) {
        if (!node.visible) continue;
        assertNodeEnvelope(node);
        // Gates are checked before payload validation, prepare scheduling and render.
        if (!registry.isRenderable(node.type)) continue;
        const renderer = registry.get(node.type);
        if (!renderer) {
          const diagnostic: RenderDiagnostic = { severity: options.strictMissingRenderers ? 'error' : 'warning', code: 'missing-node-renderer', message: `No renderer is installed for ${node.type}.`, nodeId: node.id, tick };
          warnings.push(diagnostic);
          if (options.strictMissingRenderers) throw new MissingNodeRendererError(node.type, node.id);
          renderNodePlaceholder(layerCtx, node);
          continue;
        }
        if (node.typeVersion < renderer.supportedVersions.min || node.typeVersion > renderer.supportedVersions.max) {
          const message = `Renderer for ${node.type} does not support payload version ${node.typeVersion}.`;
          warnings.push({ severity: 'error', code: 'unsupported-node-version', message, nodeId: node.id, tick });
          if (options.strictMissingRenderers) throw new Error(message);
          continue;
        }
        if (renderer.validate && !renderer.validate(node.data)) {
          const message = `Node ${node.id} failed ${node.type} payload validation.`;
          warnings.push({ severity: 'error', code: 'invalid-node-payload', message, nodeId: node.id, tick });
          if (options.strictMissingRenderers) throw new Error(message);
          continue;
        }
        const prepareContext = {
          intent,
          documentRevision: options.revision ?? 0,
          assets,
          signal: options.signal,
        };
        if (renderer.prepare) await renderer.prepare(node.data, prepareContext);
        if (!registry.isRenderable(node.type)) continue;
        layerCtx.save();
        try {
          layerCtx.transform(...node.transform);
          if (node.type === 'core.path') {
            renderCorePath(layerCtx, node.data as unknown as Parameters<typeof renderCorePath>[1]);
          } else {
            renderer.render(node.data, {
              ctx: layerCtx,
              intent,
              document: { width: project.document.width, height: project.document.height, colorSpace: 'srgb' },
              tick,
              frameRate: project.document.frameRate,
              pixelRatio: scaleX,
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push({ severity: 'error', code: 'node-render-failed', message, nodeId: node.id, pluginId: registry.ownerOf(node.type), tick });
          if (options.strictMissingRenderers) throw error;
          renderNodePlaceholder(layerCtx, node);
        } finally {
          layerCtx.restore();
        }
      }
      trackCtx.save();
      trackCtx.globalAlpha = layer.opacity;
      trackCtx.globalCompositeOperation = 'source-over';
      trackCtx.drawImage(layerCanvas, 0, 0, project.document.width, project.document.height);
      trackCtx.restore();
    }
    rootCtx.save();
    rootCtx.globalAlpha = track.opacity;
    rootCtx.globalCompositeOperation = 'source-over';
    rootCtx.drawImage(trackCanvas, 0, 0, project.document.width, project.document.height);
    rootCtx.restore();
  }
  return { canvas: root, width, height, revision: options.revision ?? 0, warnings };
}

export interface OnionSettings {
  enabled: boolean;
  before: number;
  after: number;
  beforeOpacity: number;
  afterOpacity: number;
}

export async function renderEditorComposite(
  project: ProjectDocumentV1,
  tick: number,
  activeTrackId: string,
  registry: RendererRegistry,
  assets: Parameters<typeof renderTickToCanvas>[3],
  onion: OnionSettings,
  revision: number,
): Promise<RenderResult> {
  const base = makeCanvas(project.document.width, project.document.height);
  const ctx = base.getContext('2d');
  if (!ctx) throw new Error('Could not create editor canvas.');
  paintBackground(ctx, project, 'document');
  const warnings: RenderDiagnostic[] = [];

  if (onion.enabled) {
    const activeTrack = project.tracks.find((item) => item.id === activeTrackId);
    const activeClip = activeTrack ? resolveClipAt(activeTrack, tick) : undefined;
    const beforeTicks = findOnionTicks(project, activeTrackId, tick, activeClip?.celId, onion.before, -1);
    const afterTicks = findOnionTicks(project, activeTrackId, tick, activeClip?.celId, onion.after, 1);
    // Paint far ghosts first so the nearest drawing remains visually strongest.
    for (let index = beforeTicks.length - 1; index >= 0; index -= 1) {
      const neighborTick = beforeTicks[index];
      const ghost = await renderTickToCanvas(project, neighborTick, registry, assets, { background: 'transparent', intent: 'onion', trackIds: [activeTrackId], revision });
      warnings.push(...ghost.warnings);
      tintCanvas(ctx, ghost.canvas, '#EA8B9A', onion.beforeOpacity * (1 - index * 0.18));
    }
    for (let index = afterTicks.length - 1; index >= 0; index -= 1) {
      const neighborTick = afterTicks[index];
      const ghost = await renderTickToCanvas(project, neighborTick, registry, assets, { background: 'transparent', intent: 'onion', trackIds: [activeTrackId], revision });
      warnings.push(...ghost.warnings);
      tintCanvas(ctx, ghost.canvas, '#68B7C9', onion.afterOpacity * (1 - index * 0.18));
    }
  }

  const active = await renderTickToCanvas(project, tick, registry, assets, { background: 'transparent', intent: 'editor', revision });
  warnings.push(...active.warnings);
  ctx.drawImage(active.canvas, 0, 0);
  return { canvas: base, width: base.width, height: base.height, revision, warnings };
}

export function findOnionTicks(project: ProjectDocumentV1, trackId: string, tick: number, activeCelId: string | undefined, count: number, direction: -1 | 1): number[] {
  const track = project.tracks.find((item) => item.id === trackId);
  if (!track || count <= 0) return [];
  const output: number[] = [];
  const seen = new Set<string>(activeCelId ? [activeCelId] : []);
  const limit = Math.min(2400, project.document.durationTicks);
  for (let t = tick + direction; t >= 0 && t < limit && output.length < Math.min(3, count); t += direction) {
    const clip = resolveClipAt(track, t);
    if (!clip || seen.has(clip.celId)) continue;
    seen.add(clip.celId);
    output.push(t);
  }
  return output;
}

function tintCanvas(destination: CanvasRenderingContext2D, source: HTMLCanvasElement, tint: string, opacity: number): void {
  const overlay = makeCanvas(source.width, source.height);
  const ctx = overlay.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, source.width, source.height);
  destination.save();
  destination.globalAlpha = Math.max(0, Math.min(1, opacity));
  destination.drawImage(overlay, 0, 0);
  destination.restore();
}

function abortError(): Error {
  const error = new Error('Rendering was cancelled.');
  error.name = 'AbortError';
  return error;
}
