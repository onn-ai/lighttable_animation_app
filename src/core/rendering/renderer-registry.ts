import type { AssetReadApi, CorePathData, ContentNode, ProjectDocumentV1 } from '../document/types';

export type RenderIntent = 'editor' | 'thumbnail' | 'export' | 'onion';
export interface NodeRenderContext {
  ctx: CanvasRenderingContext2D;
  intent: RenderIntent;
  document: { width: number; height: number; colorSpace: 'srgb' };
  tick: number;
  frameRate: { numerator: number; denominator: number };
  pixelRatio: number;
}
export interface NodePrepareContext {
  intent: RenderIntent;
  documentRevision: number;
  assets: AssetReadApi;
  signal?: AbortSignal;
}
export interface NodeRenderer<T = unknown> {
  type: string;
  supportedVersions: { min: number; max: number };
  validate?(data: unknown): data is T;
  prepare?(data: T, context: NodePrepareContext): void | Promise<void>;
  render(data: T, context: NodeRenderContext): void;
}
export interface NodeRenderGate {
  setVisible(visible: boolean): void;
  setRenderingEnabled(enabled: boolean): void;
}

interface RendererRecord {
  owner: string;
  renderer: NodeRenderer;
}
interface GateState {
  owner: string;
  visible: boolean;
  enabled: boolean;
}

export class RendererRegistry {
  private renderers = new Map<string, RendererRecord>();
  private gates = new Map<string, GateState>();

  registerCorePath(): () => void {
    if (this.renderers.has('core.path')) throw new Error('core.path renderer already registered');
    const renderer: NodeRenderer<CorePathData> = {
      type: 'core.path',
      supportedVersions: { min: 1, max: 1 },
      validate: isCorePathData,
      render: (data, context) => {
        // Lazy import is avoided in hot render paths; implementation is linked below.
        renderPathDirect(context.ctx, data);
      },
    };
    this.renderers.set('core.path', { owner: 'lighttable.core', renderer });
    return () => this.renderers.delete('core.path');
  }

  registerNode(pluginId: string, renderer: NodeRenderer): () => void {
    if (!renderer.type || renderer.type.startsWith('core.')) throw new Error('Plugins cannot register reserved core node types.');
    if (this.renderers.has(renderer.type)) throw new Error(`A renderer already owns node type ${renderer.type}.`);
    this.renderers.set(renderer.type, { owner: pluginId, renderer });
    return () => {
      this.renderers.delete(renderer.type);
      const gate = this.gates.get(renderer.type);
      if (gate?.owner === pluginId) this.gates.delete(renderer.type);
    };
  }

  registerNodeRenderGate(pluginId: string, nodeType: string, gate: NodeRenderGate): () => void {
    const renderer = this.renderers.get(nodeType);
    if (!renderer || renderer.owner !== pluginId) throw new Error(`Plugin ${pluginId} cannot gate node type ${nodeType} because it does not own its renderer.`);
    if (this.gates.has(nodeType)) throw new Error(`A render gate already exists for ${nodeType}.`);
    const state: GateState = { owner: pluginId, visible: true, enabled: true };
    const previousVisible = gate.setVisible.bind(gate);
    const previousEnabled = gate.setRenderingEnabled.bind(gate);
    // Observe the plugin's controller calls while preserving its renderer-local fallback.
    gate.setVisible = (value: boolean) => {
      state.visible = Boolean(value);
      previousVisible(value);
    };
    gate.setRenderingEnabled = (value: boolean) => {
      state.enabled = Boolean(value);
      previousEnabled(value);
    };
    this.gates.set(nodeType, state);
    return () => {
      if (this.gates.get(nodeType) === state) this.gates.delete(nodeType);
      gate.setVisible = previousVisible;
      gate.setRenderingEnabled = previousEnabled;
    };
  }

  isRenderable(nodeType: string): boolean {
    const gate = this.gates.get(nodeType);
    return !gate || (gate.visible && gate.enabled);
  }

  get(nodeType: string): NodeRenderer | undefined {
    return this.renderers.get(nodeType)?.renderer;
  }

  ownerOf(nodeType: string): string | undefined {
    return this.renderers.get(nodeType)?.owner;
  }

  clearPlugin(pluginId: string): void {
    for (const [type, record] of this.renderers) {
      if (record.owner === pluginId) {
        this.renderers.delete(type);
        this.gates.delete(type);
      }
    }
  }
}

function isCorePathData(value: unknown): value is CorePathData {
  if (!value || typeof value !== 'object') return false;
  const item = value as CorePathData;
  return Array.isArray(item.samples) && item.samples.length > 0 &&
    typeof item.paint?.color === 'string' && Number.isFinite(item.paint.width) && item.paint.width > 0 &&
    Number.isFinite(item.paint.opacity) && item.paint.opacity >= 0 && item.paint.opacity <= 1;
}

// Static import would create no meaningful cycle; a local implementation avoids a closure per node.
import { renderCorePath as renderPathDirect } from './path-renderer';

export interface RenderSnapshot {
  document: ProjectDocumentV1;
  revision: number;
  assets: AssetReadApi;
}

export function assertNodeEnvelope(node: ContentNode): void {
  if (!node.id || !node.type || !Number.isInteger(node.typeVersion) || node.typeVersion < 1) throw new Error('Invalid content node envelope.');
  if (node.transform.length !== 6 || node.transform.some((value) => !Number.isFinite(value))) throw new Error(`Node ${node.id} has an invalid transform.`);
}
