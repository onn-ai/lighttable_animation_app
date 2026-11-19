/**
 * LightTable Plugin SDK — v1 contract draft.
 *
 * This file defines public contracts only. It intentionally contains no
 * implementation. Keep this contract aligned with runtime validators,
 * manifest schema and docs before releasing SDK 1.0.0.
 */

import type * as React from "react";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type DeepReadonly<T> = T extends JsonPrimitive
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;
export type Unsubscribe = () => void;

export interface Disposable {
  dispose(): void;
}

export interface DisposableStore extends Disposable {
  add<T extends Disposable>(item: T): T;
  clear(): void;
}

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type Matrix2D = readonly [number, number, number, number, number, number];
export type PointerKind = "pen" | "mouse" | "touch";
export type RenderIntent = "editor" | "thumbnail" | "export" | "onion";

export interface FrameRate {
  readonly numerator: number;
  readonly denominator: number;
}

export interface DocumentInfo {
  readonly projectId: string;
  readonly name: string;
  readonly revision: number;
  readonly width: number;
  readonly height: number;
  readonly colorSpace: "srgb";
  readonly frameRate: FrameRate;
  readonly durationTicks: number;
}

export interface TrackInfo {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly blendMode: string;
}

export interface ClipInfo {
  readonly id: string;
  readonly trackId: string;
  readonly startTick: number;
  readonly durationTicks: number;
  readonly celId: string;
}

export interface LayerInfo {
  readonly id: string;
  readonly celId: string;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly blendMode: string;
}

export interface NodeInfo<TData extends JsonValue = JsonValue> {
  readonly id: string;
  readonly type: string;
  readonly typeVersion: number;
  readonly transform: Matrix2D;
  readonly visible: boolean;
  readonly locked?: boolean;
  readonly data: DeepReadonly<TData>;
  readonly extensions?: Readonly<Record<string, { readonly schemaVersion: number; readonly data: DeepReadonly<JsonValue> }>>;
}

export interface ResolvedTrackAtTick {
  readonly track: TrackInfo;
  readonly clip?: ClipInfo;
  readonly celId?: string;
}

export interface ResolvedTick {
  readonly tick: number;
  readonly tracks: readonly ResolvedTrackAtTick[]; // bottom -> top
}

export interface ActiveEditTarget {
  readonly tick: number;
  readonly trackId: string;
  readonly clipId: string;
  readonly celId: string;
  readonly layerId: string;
}

export interface SelectionRef {
  readonly celId: string;
  readonly layerId: string;
  readonly nodeId: string;
}

export interface CelInfo {
  readonly id: string;
  readonly layers: readonly LayerInfo[];
}

export interface ProjectSnapshot {
  readonly info: DocumentInfo;
  readonly tracks: readonly TrackInfo[];
  readonly revision: number;
  // Snapshot is intentionally opaque beyond stable query APIs. Do not mutate.
}

export interface TransactionOptions {
  readonly label: string;
  readonly expectedRevision?: number;
  readonly undoable?: boolean; // defaults true
}

export interface TransactionResult {
  readonly committed: boolean;
  readonly revision: number;
  readonly transactionId?: string;
  readonly conflict?: { expected: number; actual: number };
}

export interface InsertNodeInput {
  readonly celId: string;
  readonly layerId: string;
  readonly node: NodeInfo;
  readonly index?: number;
}

export interface UpdateNodeInput {
  readonly celId: string;
  readonly layerId: string;
  readonly nodeId: string;
  readonly patch: Partial<Pick<NodeInfo, "transform" | "visible" | "data" | "locked">>;
}

export interface InsertLayerInput {
  readonly celId: string;
  readonly layer: Omit<LayerInfo, "celId"> & { nodes?: readonly NodeInfo[] };
  readonly index?: number;
}

export interface UpdateLayerInput {
  readonly celId: string;
  readonly layerId: string;
  readonly patch: Partial<Pick<LayerInfo, "name" | "visible" | "locked" | "opacity" | "blendMode">>;
}

export type NewExposureClip = Omit<ClipInfo, "trackId">;

export interface ClipMutation {
  readonly trackId: string;
  readonly clipId: string;
  readonly patch: Partial<Pick<ClipInfo, "startTick" | "durationTicks" | "celId">>;
  readonly collisionPolicy?: "reject" | "ripple";
}

/** Scope identifiers are required exactly where the selected scope needs them. */
export type ExtensionScope =
  | { readonly kind: "project" }
  | { readonly kind: "track"; readonly trackId: string }
  | { readonly kind: "cel"; readonly celId: string }
  | { readonly kind: "layer"; readonly celId: string; readonly layerId: string }
  | { readonly kind: "node"; readonly celId: string; readonly layerId: string; readonly nodeId: string };

export interface ExtensionValue {
  readonly schemaVersion: number;
  readonly data: DeepReadonly<JsonValue>;
}

export interface DocumentTransaction {
  readonly baseRevision: number;
  nodes: {
    insert(input: InsertNodeInput): void;
    update(input: UpdateNodeInput): void;
    remove(input: { celId: string; layerId: string; nodeId: string }): void;
    move(input: { celId: string; fromLayerId: string; toLayerId: string; nodeId: string; index?: number }): void;
  };
  layers: {
    insert(input: InsertLayerInput): void;
    update(input: UpdateLayerInput): void;
    remove(input: { celId: string; layerId: string }): void;
    reorder(input: { celId: string; layerId: string; toIndex: number }): void;
  };
  cels: {
    create(input?: { celId?: string; cloneFromCelId?: string }): string;
    remove(input: { celId: string; onlyIfUnreferenced?: boolean }): void;
  };
  tracks: {
    insert(input: { track: Omit<TrackInfo, "id"> & { id?: string }; index?: number }): string;
    update(input: { trackId: string; patch: Partial<Pick<TrackInfo, "name" | "visible" | "locked" | "opacity" | "blendMode">> }): void;
    remove(input: { trackId: string; policy: "reject-if-has-clips" | "remove-clips" }): void;
    reorder(input: { trackId: string; toIndex: number }): void;
  };
  documentSettings: {
    setFrameRate(frameRate: FrameRate): void;
    setDurationTicks(durationTicks: number): void;
    setBackground(background: { kind: "transparent" } | { kind: "solid"; color: string }): void;
  };
  clips: {
    insert(input: { trackId: string; clip: NewExposureClip; collisionPolicy?: "reject" | "ripple" }): void;
    update(input: ClipMutation): void;
    remove(input: { trackId: string; clipId: string }): void;
    move(input: { clipId: string; fromTrackId: string; toTrackId: string; startTick: number; collisionPolicy: "reject" | "ripple" }): void;
  };
  extensions: {
    set(input: { scope: ExtensionScope; namespace: string; value: ExtensionValue }): void;
    remove(input: { scope: ExtensionScope; namespace: string }): void;
  };
  metadata: {
    set(input: { key: string; value: JsonValue }): void;
  };
}

export interface DocumentApi {
  getInfo(): DocumentInfo;
  getSnapshot(): ProjectSnapshot;
  resolveTick(tick: number): ResolvedTick;
  listTracks(): readonly TrackInfo[];
  getTrack(trackId: string): TrackInfo | undefined;
  listClips(trackId: string): readonly ClipInfo[];
  getClip(trackId: string, clipId: string): ClipInfo | undefined;
  getCel(celId: string): CelInfo | undefined;
  getLayer(celId: string, layerId: string): LayerInfo | undefined;
  listNodes(celId: string, layerId: string): readonly NodeInfo[];
  getNode(celId: string, layerId: string, nodeId: string): NodeInfo | undefined;
  getExtension(scope: ExtensionScope, namespace: string): ExtensionValue | undefined;
  transact(options: TransactionOptions, build: (tx: DocumentTransaction) => void): TransactionResult;
}

export interface FrameQueryApi {
  getCurrentTick(): number;
  getFrameRate(): FrameRate;
  getDurationTicks(): number;
  getExposureAt(trackId: string, tick: number): ClipInfo | undefined;
  /** Returns available neighboring ticks in ascending chronological order, excluding the requested tick and clamped to document duration. */
  getNeighborTicks(tick: number, before: number, after: number): readonly number[];
  onPlayheadChanged(listener: (tick: number) => void): Disposable;
  onPlaybackChanged(listener: (state: "playing" | "paused" | "stopped") => void): Disposable;
}

export interface PointerSample {
  readonly pointerId: number;
  readonly pointerType: PointerKind;
  readonly viewport: Point;
  readonly document: Point;
  readonly pressure: number; // normalized [0,1]
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly twist?: number;
  readonly buttons: number;
  readonly modifiers: { readonly alt: boolean; readonly ctrl: boolean; readonly meta: boolean; readonly shift: boolean };
  readonly timeStamp: number;
  readonly coalesced?: readonly Omit<PointerSample, "coalesced">[];
}

export type CancelReason =
  | "pointercancel"
  | "lostpointercapture"
  | "mode-change"
  | "tool-change"
  | "plugin-disabled"
  | "project-close"
  | "app-suspended"
  | "user-cancel";

export interface ToolGesture {
  readonly id: string;
  updatePreview(draw: (context: OverlayRenderContext) => void): void;
  /**
   * Commits exactly one atomic host transaction and therefore at most one
   * undo entry. Do not call DocumentApi.transact() for the same gesture.
   */
  commit(options: TransactionOptions, build: (tx: DocumentTransaction) => void): TransactionResult;
  cancel(reason: CancelReason): void;
}

export interface ToolContext {
  readonly pluginId: string;
  readonly document: DocumentApi;
  readonly frames: FrameQueryApi;
  getActiveTarget(): ActiveEditTarget | undefined;
  beginGesture(options: { label: string; pointerId: number }): ToolGesture;
  invalidate(region?: Rect): void;
  reportProgress?(progress: { fraction: number; message?: string }): void;
}

export interface ToolDefinition {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly tooltip?: string;
  readonly category?: string;
  readonly shortcut?: string;
  readonly cursor?: string;
  readonly settingsComponent?: React.ComponentType<PluginPanelProps>;
  onActivate?(context: ToolContext): void;
  onDeactivate?(context: ToolContext): void;
  onPointerDown?(sample: PointerSample, context: ToolContext): void;
  onPointerMove?(sample: PointerSample, context: ToolContext): void;
  onPointerUp?(sample: PointerSample, context: ToolContext): void;
  onCancel?(reason: CancelReason, context: ToolContext): void;
}

export interface ModeDefinition {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly description?: string;
  readonly toolIds?: readonly string[];
  readonly panelIds?: readonly string[];
  readonly defaultVisiblePanels?: readonly string[];
  onActivate?(context: ModeContext): void;
  onDeactivate?(context: ModeContext): void;
}

export interface ModeContext {
  readonly pluginId: string;
  readonly document: DocumentApi;
  readonly frames: FrameQueryApi;
  setActiveTool(toolId: string): void;
  setPanelVisibility(panelId: string, visible: boolean): void;
}

export interface PluginPanelProps {
  readonly pluginId: string;
  readonly panelId: string;
  readonly document: DocumentApi;
  readonly frames: FrameQueryApi;
  readonly close: () => void;
}

export interface PanelDefinition {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly slot: "dock.right" | "timeline.footer" | "toolbar.top" | "toolbar.left";
  readonly defaultVisible?: boolean;
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly component: React.ComponentType<PluginPanelProps>;
}

export interface ToolbarItemDefinition {
  readonly id: string;
  readonly slot: "toolbar.top" | "toolbar.left";
  readonly name: string;
  readonly icon: string;
  readonly tooltip?: string;
  readonly commandId?: string;
  readonly onClick?: () => void;
}

export interface MenuItemDefinition {
  readonly id: string;
  readonly slot: "menu.project" | "menu.context";
  readonly title: string;
  readonly commandId: string;
  readonly order?: number;
  /** Host-defined context predicate; unknown predicates are rejected at registration. */
  readonly when?: "always" | "project-open" | "selection-nonempty" | "timeline-active";
}

export interface CommandDefinition {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly shortcut?: string;
  isEnabled?(): boolean;
  execute(): void | Promise<void>;
}

export type NodeHitTestQuery =
  | { readonly kind: "point"; readonly point: Point; readonly tolerance: number }
  | { readonly kind: "rect"; readonly rect: Rect; readonly mode: "intersects" | "contains" }
  | { readonly kind: "polygon"; readonly points: readonly Point[]; readonly mode: "intersects" | "contains" };

export interface NodeRenderDocumentInfo {
  readonly width: number;
  readonly height: number;
  readonly colorSpace: "srgb";
}

export interface NodePrepareContext {
  readonly intent: RenderIntent;
  readonly documentRevision: number;
  /** Preparation may read project assets but cannot create or mutate them. */
  readonly assets: AssetReadApi;
  readonly signal?: AbortSignal;
}

export interface NodeRenderContext {
  readonly ctx: CanvasRenderingContext2D;
  readonly intent: RenderIntent;
  readonly document: NodeRenderDocumentInfo;
  readonly tick: number;
  readonly frameRate: FrameRate;
  readonly pixelRatio: number;
}

export interface NodeRenderGate {
  /** Hidden node families are omitted from all render intents. */
  setVisible(visible: boolean): void;
  /** Disabled node families skip preparation and rendering work. */
  setRenderingEnabled(enabled: boolean): void;
}

export interface NodeRenderer<TData extends JsonValue = JsonValue> {
  readonly type: string;
  readonly supportedVersions: { readonly min: number; readonly max: number };
  validate?(data: unknown): data is TData;
  getLocalBounds?(data: DeepReadonly<TData>): Rect | null;
  hitTest?(data: DeepReadonly<TData>, query: NodeHitTestQuery): boolean;
  prepare?(data: DeepReadonly<TData>, context: NodePrepareContext): void | Promise<void>;
  render(data: DeepReadonly<TData>, context: NodeRenderContext): void;
  migrate?(data: unknown, fromVersion: number, toVersion: number): unknown;
}

export interface OverlayRenderContext {
  readonly ctx: CanvasRenderingContext2D;
  readonly space: "document" | "viewport";
  readonly document: NodeRenderDocumentInfo;
  readonly tick: number;
  readonly viewportScale: number;
  readonly pixelRatio: number;
}

export interface OverlayDefinition {
  readonly id: string;
  readonly slot: "under-document" | "over-document" | "screen-ui";
  render(context: OverlayRenderContext): void;
}

export interface AssetDescriptor {
  readonly id: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly width?: number;
  readonly height?: number;
  readonly fileName?: string;
}

export interface AssetReadApi {
  get(assetId: string): Promise<Blob | undefined>;
  getDescriptor(assetId: string): AssetDescriptor | undefined;
}

export interface AssetApi extends AssetReadApi {
  put(blob: Blob, metadata?: { fileName?: string }): Promise<AssetDescriptor>;
}

export interface PluginStorageApi {
  get<T extends JsonValue>(key: string): Promise<T | undefined>;
  set<T extends JsonValue>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
}

export interface SettingsField {
  readonly key: string;
  readonly type: "boolean" | "number" | "string" | "enum";
  readonly label: string;
  readonly description?: string;
  readonly defaultValue: JsonValue;
  readonly min?: number;
  readonly max?: number;
  readonly options?: readonly { label: string; value: string }[];
}

export interface SettingsDefinition {
  readonly id: string;
  readonly title: string;
  readonly fields: readonly SettingsField[];
}

export interface RenderDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly pluginId?: string;
  readonly nodeId?: string;
  readonly tick?: number;
}

export interface FrameRenderRequest {
  readonly ticks: readonly number[] | { readonly start: number; readonly endExclusive: number };
  readonly width?: number;
  readonly height?: number;
  readonly background: "document" | "white" | "transparent";
  readonly intent: "export" | "thumbnail" | "onion";
}

export interface RenderedSurface {
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
  readonly documentRevision: number;
  readonly warnings: readonly RenderDiagnostic[];
}

export interface RenderedFrame {
  readonly tick: number;
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
  readonly documentRevision: number;
  readonly warnings: readonly RenderDiagnostic[];
}

export interface RenderServiceApi {
  renderFrames(request: FrameRenderRequest, options?: { signal?: AbortSignal; onProgress?: (fraction: number) => void }): AsyncIterable<RenderedFrame>;
  /** Render one cel independently; useful for plugin algorithms such as region detection. */
  renderCel(celId: string, options: {
    layerIds?: readonly string[];
    width?: number;
    height?: number;
    background: "document" | "white" | "transparent";
    intent: RenderIntent;
    signal?: AbortSignal;
  }): Promise<RenderedSurface>;
}

export interface ImportedAsset {
  readonly descriptor: AssetDescriptor;
  readonly blob: Blob;
}

export interface ImportedProjectBundle {
  /** Canonical lighttable.project JSON value; host validates before commit. */
  readonly document: JsonValue;
  readonly assets: readonly ImportedAsset[];
  readonly suggestedName?: string;
}

export interface ImporterContext {
  readonly signal: AbortSignal;
  readonly logger: PluginLogger;
}

export interface ImporterDefinition {
  readonly id: string;
  readonly name: string;
  readonly extensions: readonly string[];
  readonly mimeTypes?: readonly string[];
  canImport?(file: File): boolean | Promise<boolean>;
  import(file: File, context: ImporterContext): Promise<ImportedProjectBundle>;
}

/**
 * A revision-pinned read-only query surface. All methods resolve against the
 * same immutable snapshot used by the paired render service.
 */
export interface ExportDocumentSnapshot {
  readonly revision: number;
  getInfo(): DocumentInfo;
  resolveTick(tick: number): ResolvedTick;
  listTracks(): readonly TrackInfo[];
  listClips(trackId: string): readonly ClipInfo[];
  getCel(celId: string): CelInfo | undefined;
  getLayer(celId: string, layerId: string): LayerInfo | undefined;
  listNodes(celId: string, layerId: string): readonly NodeInfo[];
  getNode(celId: string, layerId: string, nodeId: string): NodeInfo | undefined;
  getExtension(scope: ExtensionScope, namespace: string): ExtensionValue | undefined;
}

export interface ExporterContext {
  readonly document: ExportDocumentSnapshot;
  readonly render: RenderServiceApi;
  readonly signal: AbortSignal;
  reportProgress(fraction: number, message?: string): void;
}

export interface ExportedArtifact {
  readonly blob: Blob;
  readonly fileName: string;
  readonly mimeType: string;
}

export interface ExporterDefinition {
  readonly id: string;
  readonly name: string;
  readonly extensions: readonly string[];
  readonly mimeTypes: readonly string[];
  export(context: ExporterContext): Promise<ExportedArtifact>;
}

export interface SelectionApi {
  getSelection(): readonly SelectionRef[];
  setSelection(selection: readonly SelectionRef[]): void;
  clear(): void;
  onChanged(listener: (selection: readonly SelectionRef[]) => void): Disposable;
}

export interface LightTableEventMap {
  "project.opened": { readonly projectId: string };
  "project.closing": { readonly projectId: string };
  "project.saved": { readonly projectId: string; readonly revision: number };
  "project.closed": { readonly projectId: string };
  "document.changed": { readonly projectId: string; readonly revision: number; readonly originPluginId?: string; readonly affectedIds: readonly string[] };
  "document.revisionChanged": { readonly revision: number };
  "track.created": { readonly trackId: string };
  "track.updated": { readonly trackId: string };
  "track.deleted": { readonly trackId: string };
  "clip.created": { readonly trackId: string; readonly clipId: string };
  "clip.updated": { readonly trackId: string; readonly clipId: string };
  "clip.deleted": { readonly trackId: string; readonly clipId: string };
  "cel.created": { readonly celId: string };
  "cel.updated": { readonly celId: string };
  "cel.deleted": { readonly celId: string };
  "layer.created": { readonly celId: string; readonly layerId: string };
  "layer.updated": { readonly celId: string; readonly layerId: string };
  "layer.deleted": { readonly celId: string; readonly layerId: string };
  "node.created": { readonly celId: string; readonly layerId: string; readonly nodeId: string; readonly type: string };
  "node.updated": { readonly celId: string; readonly layerId: string; readonly nodeId: string; readonly type: string };
  "node.deleted": { readonly celId: string; readonly layerId: string; readonly nodeId: string; readonly type: string };
  "playback.started": { readonly tick: number };
  "playback.stopped": { readonly tick: number };
  "playback.tick": { readonly tick: number };
  "selection.changed": { readonly selection: readonly SelectionRef[] };
  "playhead.changed": { readonly tick: number };
  "mode.activated": { readonly pluginId: string; readonly modeId: string };
  "mode.deactivated": { readonly pluginId: string; readonly modeId: string };
  "plugin.activated": { readonly pluginId: string; readonly version: string };
  "plugin.deactivated": { readonly pluginId: string };
  "plugin.error": { readonly pluginId: string; readonly code: string; readonly message: string };
}

export interface PluginEvents {
  on<K extends keyof LightTableEventMap>(eventName: K, listener: (payload: LightTableEventMap[K]) => void): Disposable;
}

export interface PluginLogger {
  debug(message: string, data?: JsonValue): void;
  info(message: string, data?: JsonValue): void;
  warn(message: string, data?: JsonValue): void;
  error(message: string, data?: JsonValue): void;
}

export interface PluginManifestRef {
  readonly id: string;
  readonly version: string;
  readonly apiVersionRange: string;
  /** SDK v1 only activates same-origin trusted UI modules. */
  readonly execution?: "trusted-ui";
  /** Capabilities granted to this plugin by the host/user. Missing means no capabilities. */
  readonly permissions?: readonly PluginPermission[];
}

export interface PluginApi {
  readonly plugin: PluginManifestRef;
  readonly document: DocumentApi;
  readonly frames: FrameQueryApi;
  readonly selection: SelectionApi;
  readonly assets: AssetApi;
  readonly storage: PluginStorageApi;
  readonly events: PluginEvents;
  readonly render: RenderServiceApi;
  readonly logger: PluginLogger;
  readonly registrations: DisposableStore;
  tools: { register(definition: ToolDefinition): Disposable };
  modes: { register(definition: ModeDefinition): Disposable };
  panels: { register(definition: PanelDefinition): Disposable };
  toolbar: { register(definition: ToolbarItemDefinition): Disposable };
  menus: { register(definition: MenuItemDefinition): Disposable };
  commands: { register(definition: CommandDefinition): Disposable };
  renderers: {
    registerNode<TData extends JsonValue>(definition: NodeRenderer<TData>): Disposable;
    /**
     * Registers a plugin-scoped gate for a node type owned by this plugin.
     * The coordinator consults it before prepare and render for every intent.
     */
    registerNodeRenderGate(nodeType: string, gate: NodeRenderGate): Disposable;
    registerOverlay(definition: OverlayDefinition): Disposable;
  };
  importers: { register(definition: ImporterDefinition): Disposable };
  exporters: { register(definition: ExporterDefinition): Disposable };
  settings: { register(definition: SettingsDefinition): Disposable; get<T extends JsonValue>(key: string): T | undefined; set<T extends JsonValue>(key: string, value: T): Promise<void> };
}

export interface PluginActivationContext {
  readonly signal: AbortSignal;
  readonly logger: PluginLogger;
}

export interface LightTablePlugin {
  readonly manifest: PluginManifestRef;
  activate(api: PluginApi, context: PluginActivationContext): void | Promise<void>;
  deactivate?(reason: "disable" | "uninstall" | "update" | "shutdown" | "failure"): void | Promise<void>;
}

export interface PluginDependency {
  readonly id: string;
  readonly versionRange: string;
  readonly optional?: boolean;
}

export interface PluginManifest {
  readonly manifestVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly apiVersionRange: string;
  readonly hostVersionRange: string;
  /** SDK v1 supports trusted first-party UI code only. Worker is rejected. */
  readonly execution: "trusted-ui";
  readonly entry: string;
  readonly icon?: string;
  readonly homepage?: string;
  readonly license?: string;
  readonly keywords?: readonly string[];
  readonly integrity?: {
    readonly algorithm: "sha256";
    readonly digest: string;
    readonly publisher?: string;
    readonly signature?: string;
  };
  readonly networkOrigins?: readonly string[];
  readonly permissions: readonly PluginPermission[];
  readonly dependencies: readonly PluginDependency[];
  readonly contributes: {
    readonly tools?: readonly string[];
    readonly modes?: readonly string[];
    readonly panels?: readonly string[];
    readonly commands?: readonly string[];
    readonly nodeTypes?: readonly string[];
    readonly importers?: readonly string[];
    readonly exporters?: readonly string[];
    readonly toolbar?: readonly string[];
    readonly menus?: readonly string[];
    readonly overlays?: readonly string[];
  };
}

export type PluginPermission =
  | "document.read" | "document.write"
  | "timeline.read" | "timeline.write"
  | "canvas.input" | "canvas.render"
  | "selection.read" | "selection.write"
  | "ui.panels" | "ui.toolbar" | "ui.modes"
  | "history.commands" | "project.import" | "project.export"
  | "assets.read" | "assets.write" | "storage.plugin" | "network";

export interface PluginManagerApi {
  list(): readonly { id: string; version: string; enabled: boolean; status: "installed" | "active" | "disabled" | "failed" | "incompatible" }[];
  enable(pluginId: string): Promise<void>;
  disable(pluginId: string): Promise<void>;
  installPackage(file: File): Promise<void>;
  uninstall(pluginId: string): Promise<void>;
}
