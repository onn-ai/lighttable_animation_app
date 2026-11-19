/** Canonical project types. Runtime/view state intentionally lives elsewhere. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Matrix2D = [number, number, number, number, number, number];

export interface RationalFrameRate {
  numerator: number;
  denominator: number;
}

export type DocumentBackground =
  | { kind: 'transparent' }
  | { kind: 'solid'; color: string };

export interface DocumentSettings {
  width: number;
  height: number;
  colorSpace: 'srgb';
  background: DocumentBackground;
  frameRate: RationalFrameRate;
  durationTicks: number;
  /** Physical dimensions represented by this canvas. Absent means no 1:1 scale. */
  physicalSizeMm?: { width: number; height: number };
}

export interface PluginExtension {
  schemaVersion: number;
  data: JsonValue;
}
export type ExtensionBag = Record<string, PluginExtension>;

export interface AnimationTrack {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: string;
  clips: ExposureClip[];
  extensions?: ExtensionBag;
}

export interface ExposureClip {
  id: string;
  startTick: number;
  durationTicks: number;
  celId: string;
  extensions?: ExtensionBag;
}

export interface Cel {
  id: string;
  layers: ContentLayer[];
  extensions?: ExtensionBag;
}

export interface ContentLayer {
  id: string;
  name: string;
  kind: 'content';
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: string;
  nodes: ContentNode[];
  extensions?: ExtensionBag;
}

export interface ContentNode<TData extends JsonValue = JsonValue> {
  id: string;
  type: string;
  typeVersion: number;
  transform: Matrix2D;
  visible: boolean;
  locked?: boolean;
  data: TData;
  extensions?: ExtensionBag;
}

export interface CorePathSample {
  x: number;
  y: number;
  pressure: number;
  timeOffsetMs?: number;
  tiltX?: number;
  tiltY?: number;
  twist?: number;
}

export interface CorePathData {
  samples: CorePathSample[];
  paint: {
    color: string;
    width: number;
    opacity: number;
    cap: 'round' | 'butt' | 'square';
    join: 'round' | 'bevel' | 'miter';
    composite: 'source-over' | 'destination-out';
  };
  smoothing?: { kind: 'none' | 'quadratic' | 'catmull-rom'; amount?: number };
}

export interface AssetReadApi {
  get(assetId: string): Promise<Blob | undefined>;
  getDescriptor(assetId: string): AssetDescriptor | undefined;
}

export interface AssetApi extends AssetReadApi {
  put(blob: Blob, metadata?: { fileName?: string }): Promise<AssetDescriptor>;
}

export interface AssetDescriptor {
  id: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  width?: number;
  height?: number;
  fileName?: string;
}

export interface PluginRequirement {
  id: string;
  versionRange: string;
  apiVersionRange: string;
  requiredFor?: Array<'edit' | 'render' | 'import' | 'export'>;
  optional: boolean;
}

export interface ProjectDocumentV1 {
  format: 'lighttable.project';
  schemaVersion: '1.0.0';
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  document: DocumentSettings;
  tracks: AnimationTrack[];
  cels: Record<string, Cel>;
  assets: AssetDescriptor[];
  requiredPlugins: PluginRequirement[];
  extensions?: ExtensionBag;
  metadata?: Record<string, JsonValue>;
}

export const PROJECT_FORMAT = 'lighttable.project' as const;
export const PROJECT_SCHEMA_VERSION = '1.0.0' as const;
export const MAX_LAYERS_PER_CEL_V1 = 4;
export const MAX_USER_FRAME_COUNT = 200;
export const CORE_PATH_NODE_TYPE = 'core.path';

export function newId(prefix = 'lt'): string {
  const random = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${random ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`}`;
}

export function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createLayer(name = 'Rough'): ContentLayer {
  return {
    id: newId('layer'), name, kind: 'content', visible: true, locked: false,
    opacity: 1, blendMode: 'normal', nodes: [],
  };
}

export function createCel(name = 'Rough'): Cel {
  return { id: newId('cel'), layers: [createLayer(name)] };
}

export function createDefaultProject(name = 'Untitled Animation'): ProjectDocumentV1 {
  const now = new Date().toISOString();
  const cel = createCel('Layer 1');
  const trackId = newId('track');
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: newId('project'),
    name,
    createdAt: now,
    updatedAt: now,
    document: {
      width: 1920,
      height: 1080,
      colorSpace: 'srgb',
      background: { kind: 'solid', color: '#FAF9F6' },
      frameRate: { numerator: 12, denominator: 1 },
      durationTicks: 1,
    },
    tracks: [{
      id: trackId, name: 'Animation', visible: true, locked: false,
      opacity: 1, blendMode: 'normal',
      clips: [{ id: newId('clip'), startTick: 0, durationTicks: 1, celId: cel.id }],
    }],
    cels: { [cel.id]: cel },
    assets: [],
    requiredPlugins: [],
    metadata: { productVersion: '0.1.0' },
  };
}

export function resolveClipAt(track: AnimationTrack, tick: number): ExposureClip | undefined {
  return track.clips.find((clip) => clip.startTick <= tick && tick < clip.startTick + clip.durationTicks);
}

export function resolveCelAt(project: ProjectDocumentV1, trackId: string, tick: number): Cel | undefined {
  const track = project.tracks.find((item) => item.id === trackId);
  const clip = track ? resolveClipAt(track, tick) : undefined;
  return clip ? project.cels[clip.celId] : undefined;
}

export function primaryTrack(project: ProjectDocumentV1): AnimationTrack {
  const track = project.tracks[0];
  if (!track) throw new Error('The project has no animation track.');
  return track;
}

export function getFrameCount(project: ProjectDocumentV1): number {
  return Math.max(1, project.document.durationTicks);
}
