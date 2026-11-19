/**
 * Canonical LightTable project document model v1.
 *
 * These are domain/storage types for the host. Plugin authors should use the
 * narrower readonly query and transaction types in plugin-api.d.ts instead
 * of mutating ProjectDocument directly.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Matrix2D = [number, number, number, number, number, number];

export interface RationalFrameRate {
  numerator: number;
  denominator: number;
}

export type DocumentBackground =
  | { kind: "transparent" }
  | { kind: "solid"; color: string };

export interface DocumentSettings {
  width: number;
  height: number;
  colorSpace: "srgb";
  background: DocumentBackground;
  frameRate: RationalFrameRate;
  durationTicks: number;
  /** Optional calibrated physical output size; absence means fit-to-page only. */
  physicalSizeMm?: { width: number; height: number };
}

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
  kind: "content";
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

export interface PluginExtension {
  schemaVersion: number;
  data: JsonValue;
}

export type ExtensionBag = Record<string, PluginExtension>;

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
  requiredFor?: Array<"edit" | "render" | "import" | "export">;
  optional: boolean;
}

export interface ProjectDocumentV1 {
  format: "lighttable.project";
  schemaVersion: "1.0.0";
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  document: DocumentSettings;
  tracks: AnimationTrack[];       // bottom -> top
  cels: Record<string, Cel>;
  assets: AssetDescriptor[];
  requiredPlugins: PluginRequirement[];
  extensions?: ExtensionBag;
  metadata?: Record<string, JsonValue>;
}

/** Baseline node type. A drawing tool may be supplied by a plugin. */
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
    cap: "round" | "butt" | "square";
    join: "round" | "bevel" | "miter";
    composite: "source-over" | "destination-out";
  };
  smoothing?: {
    kind: "none" | "quadratic" | "catmull-rom";
    amount?: number;
  };
}

export declare const PROJECT_FORMAT: "lighttable.project";
export declare const PROJECT_SCHEMA_VERSION: "1.0.0";
export declare const MAX_LAYERS_PER_CEL_V1: 4;
export declare const INITIAL_WORKSPACE_TRACK_ROWS: 3;
