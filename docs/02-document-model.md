# 2. Document Model and Persistence Contract

## 2.1 Goals

The document model is the canonical, renderer-independent representation of a LightTable project. It must support:

- fixed logical document dimensions independent of screen size and DPR;
- multiple animation tracks (three visible rows in the initial workspace);
- exposures that hold a cel for one or more playback ticks;
- cels that can be linked/reused or independently duplicated;
- up to four ordered content layers per cel in the initial product version;
- extensible content-node types registered by plugins;
- assets stored separately from JSON document metadata;
- plugin-owned persistent data at project/cel/layer/node scopes;
- import/save round-trips that preserve unknown data;
- deterministic playback and rendering;
- transactions, undo/redo and migration.

## 2.2 Terminology

| Term | Definition |
|---|---|
| Document | The complete editable project and its metadata. |
| Track | A temporal animation lane. Tracks are composited in a defined bottom-to-top order. |
| Tick / playback frame | One discrete time position at the document frame rate. |
| Exposure / clip | A range of ticks on a track that references one cel. |
| Cel | A reusable drawing-content unit. A cel owns its own layer stack. |
| Layer | An ordered content container inside a cel. |
| Content node | A persistable visual object within a layer, such as a path or bitmap. |
| Asset | A binary resource referenced by a node or plugin data, such as a raster image. |
| Extension data | Versioned JSON owned by a plugin and attached to a documented scope. |

**Critical distinction:** a timeline tick is not a cel. If an exposure lasts five ticks, playback resolves the same cel at each of those five ticks. The UI may still call each position a “frame”.

## 2.3 Coordinate system

Every document MUST define `width` and `height` in logical document units. The default is 1920 × 1080. The first-release UI exposes at most 200 editable frame positions even though the document model remains timeline-based and can preserve longer imported documents.

- One document unit maps to one logical pixel at the default dimensions.
- Coordinates are floating-point document-space units.
- The origin is the top-left corner; +X points right and +Y points down.
- Coordinates MUST NOT be stored in CSS pixels, device pixels or viewport coordinates.
- Device pixel ratio and viewport transform are runtime view state, not document geometry.
- Plugins receive normalized document-space coordinates through the Input API.
- Any resize/rebase of a document is an explicit document operation with defined geometry behavior; it is not an incidental viewport resize.

Use a 2D affine transform with six finite values `[a,b,c,d,e,f]` for node transforms. The transform maps node-local coordinates to document coordinates. Identity is `[1,0,0,1,0,0]`.

## 2.4 Frame rate and timebase

The timebase is integer ticks. The document frame rate is represented as a rational number:

```ts
interface FrameRate {
  numerator: number;   // positive integer
  denominator: number; // positive integer
}
```

Examples: 12/1, 24/1, 30/1. Rational representation avoids floating-point drift and can represent rates such as 24000/1001 if a future product version permits them. The initial UI may restrict ordinary user-selected rates to 1–30 FPS, with presets 8, 12, 16 and 24 FPS.

All clip starts and durations are integer ticks. Duration MUST be greater than zero. A clip covers the half-open interval `[startTick, startTick + durationTicks)`.

The document SHOULD store an explicit `durationTicks` so the user can retain an intentional blank tail. It must be at least the maximum clip end. A soft performance target of approximately 240 ticks is recommended for the initial product; it is not a hard data-model limit.

## 2.5 Canonical document shape

The following TypeScript-style model is normative at the conceptual level. The exact generated types may differ if the same guarantees are retained.

```ts
interface ProjectDocumentV1 {
  format: "lighttable.project";
  schemaVersion: "1.0.0";
  projectId: string;             // UUID
  name: string;
  createdAt: string;             // ISO-8601 UTC
  updatedAt: string;             // ISO-8601 UTC
  document: {
    width: number;
    height: number;
    colorSpace: "srgb";
    background: { kind: "transparent" | "solid"; color?: string };
    frameRate: { numerator: number; denominator: number };
    durationTicks: number;
    physicalSizeMm?: { width: number; height: number }; // explicit print calibration; omitted means fit-to-page only
  };
  tracks: AnimationTrack[];      // ordered bottom -> top
  cels: Record<string, Cel>;
  assets: AssetDescriptor[];
  requiredPlugins: PluginRequirement[];
  extensions?: ExtensionBag;
  metadata?: Record<string, JsonValue>;
}
```

The `playheadTick`, selected track/cel, selected tool, viewport zoom, panel layout and expanded/collapsed panels are **workspace state**, not document content. They may be stored separately in local preferences or per-project workspace state, but must not affect exported rendering.

## 2.6 Tracks and exposures

```ts
interface AnimationTrack {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;               // 0..1
  blendMode: string;             // "normal" in core v1
  clips: ExposureClip[];         // sorted by startTick, no overlap per track
  extensions?: ExtensionBag;
}

interface ExposureClip {
  id: string;
  startTick: number;             // integer >= 0
  durationTicks: number;         // integer >= 1
  celId: string;
  extensions?: ExtensionBag;
}
```

Rules:

- `tracks` are stored and composited bottom-to-top. Index 0 is the bottom track.
- The initial workspace exposes three tracks. The model must use an array and must not encode exactly three fixed properties. The user-facing workspace may present these as three independently editable rows, composited bottom-to-top; changing their count must not require a project schema migration.
- Clips on the same track MUST NOT overlap in v1. Gaps are allowed and resolve as transparent for that track.
- Clips on different tracks may overlap.
- Clips MUST reference an existing cel.
- Track opacity is applied by the compositor after rendering the track's resolved cel for that tick.
- Unknown `blendMode` values are preserved. If the compositor cannot render one, it falls back to `normal` with a visible compatibility warning; it must not rewrite the stored value.
- A tick with no clip on a track is transparent on that track.

### Resolving a tick

At playback tick `t`, for each track in bottom-to-top order, find the unique clip satisfying:

`clip.startTick <= t && t < clip.startTick + clip.durationTicks`.

The resolved clip references a cel. The same cel may be referenced by multiple clips or tracks. This supports held drawings and linked exposures.

### Frame operations and semantics

The document/SDK must distinguish these operations:

- **Add blank exposure:** create a new cel with one default content layer (`Layer 1`, visible, unlocked, opacity 1, normal blend) and a one-tick clip at the insertion point. Low-level import/migration code may preserve a cel with zero layers, but the ordinary user-facing blank-frame action should produce an immediately editable target.
- **Extend hold:** increase an exposure duration, shifting following clips on that track if the chosen edit operation requires ripple behavior. The command must name its ripple policy explicitly.
- **Duplicate linked exposure:** create another clip referencing the same cel. Later edits to the shared cel appear in both exposures.
- **Duplicate independent exposure:** deep-copy the cel, its layers, nodes and plugin-scoped data, then create a clip referencing the new cel. Asset blobs may be deduplicated by hash. The ordinary user-facing “Duplicate frame” action SHOULD use this independent-copy behavior; linked duplication should be a separate explicit operation.
- **Delete exposure:** delete the clip. Delete the cel only if it is no longer referenced and no explicit retain/pin rule applies.
- **Move exposure:** change track and/or start tick, validating collision policy. The core must not silently overwrite another clip.
- **Split exposure:** create two adjacent clips referencing the same cel unless the user explicitly requests an independent copy.

Do not overload one “duplicate” operation with ambiguous linked/unlinked behavior. UI labels and command payloads must make the behavior clear.

## 2.7 Cels and layers

```ts
interface Cel {
  id: string;
  layers: ContentLayer[];        // bottom -> top
  extensions?: ExtensionBag;
}

interface ContentLayer {
  id: string;
  name: string;
  kind: "content";
  visible: boolean;
  locked: boolean;
  opacity: number;               // 0..1
  blendMode: string;             // "normal" in core v1
  nodes: ContentNode[];          // back -> front
  extensions?: ExtensionBag;
}
```

- Layers are local to a cel in v1. Each cel has its own ordered layer stack.
- The initial product constraint is a maximum of four layers per cel. Enforce this in the core mutation validator and test it. Do not conflate the four cel layers with the three timeline tracks.
- Layer arrays are bottom-to-top; nodes are back-to-front.
- Layer opacity and visibility are applied by the compositor.
- A locked layer rejects edits through the document mutation API unless the operation explicitly has an authorized override capability. Read access remains available.
- A hidden layer remains in the document and in project exports.
- Plugin-created node types can be stored inside a standard content layer. Future custom layer types require a separate, explicitly versioned layer-renderer extension point; do not invent arbitrary layer shapes in v1.

## 2.8 Content-node envelope

The document model must support content types the host does not understand. Each node has a stable envelope and plugin/core-owned payload.

```ts
interface ContentNode<T = JsonValue> {
  id: string;
  type: string;                  // namespaced, e.g. "core.path" or "com.vendor.fill-region"
  typeVersion: number;           // positive integer, owned by the type provider
  transform: [number, number, number, number, number, number];
  visible: boolean;
  locked?: boolean;
  data: T;                       // opaque JSON payload
  extensions?: ExtensionBag;
}
```

Type identifiers MUST be globally namespaced. Reserved core identifiers use the `core.` prefix. Third-party plugins SHOULD use their reverse-DNS plugin ID followed by a type name, for example `com.example.coloring.region`.

The host understands the envelope and common fields but not necessarily `data`. The registered provider owns payload validation, migration and rendering. Plugins MUST NOT register or claim a `core.*` node type; that namespace is reserved for host-defined baseline nodes. If the provider is absent, the host retains the entire envelope byte-for-byte at the JSON-value level (property order is not significant) and presents a missing-type indicator in editor UI if practical.

### Baseline core node: `core.path`

`core.path` is a required host-owned node type in the first product release. It is the persisted representation used by the built-in pencil, graphite/blue presets and eraser workflow. It is a small deterministic variable-width path primitive, not a mandate to build every advanced brush engine into core.

Suggested data:

```ts
interface CorePathData {
  samples: Array<{
    x: number;                 // node-local document units
    y: number;
    pressure: number;          // normalized 0..1
    timeOffsetMs?: number;     // relative to gesture start
    tiltX?: number;            // device-reported degrees, if available
    tiltY?: number;
    twist?: number;
  }>;
  paint: {
    color: string;             // #RRGGBB or #RRGGBBAA, sRGB
    width: number;             // document units, > 0
    opacity: number;           // 0..1
    cap: "round" | "butt" | "square";
    join: "round" | "bevel" | "miter";
    composite: "source-over" | "destination-out";
  };
  smoothing?: { kind: "none" | "quadratic" | "catmull-rom"; amount?: number };
}
```

Pressure is normalized and original samples must be preserved. Smoothing must be a derived rendering result; it must not destructively replace raw input samples. Mouse fallback pressure should be normalized by the input service (suggested default 0.5 or a configured constant), not guessed independently by each tool.

A plugin may instead define a custom node such as `com.vendor.brush.stroke` with richer payload. Such a plugin must register a renderer and preserve a stable payload version.

## 2.9 Transform and geometry rules

- Every node transform is a finite affine matrix.
- The core validates matrix length and finite values; a plugin may add stricter constraints.
- Node payload coordinates are local to the node; the host applies the node transform before calling its renderer.
- Plugin renderers must not apply the node transform a second time.
- Bounds are derived by the provider where possible. Bounds are cache data, not a substitute for canonical node payload.
- Transform operations are document transactions and are undoable.
- A transform may be committed by updating the matrix rather than rewriting every sample.

## 2.10 Assets and binary data

Binary assets must not be embedded repeatedly in node JSON. Use an asset store with content-addressed identifiers.

```ts
interface AssetDescriptor {
  id: string;                    // "sha256:<hex>" preferred
  mimeType: string;
  byteLength: number;
  sha256: string;
  width?: number;
  height?: number;
  fileName?: string;
}
```

- Assets are stored as `Blob`/binary records in IndexedDB or another browser storage abstraction.
- The descriptor lives in document JSON; binary bytes live in the asset store/package.
- Asset identity SHOULD be SHA-256 content-addressed to deduplicate repeated image data.
- Import must verify hash and byte length before making the asset available.
- Plugin data may reference assets only through declared asset IDs.
- Asset deletion must be reference-aware. Undo history and project references must not lose data prematurely. If a plugin uploads an asset and its following document transaction fails or is cancelled, the asset is an orphan candidate; the host garbage collector may remove it only after checking all project, undo-history and in-flight import references.
- A plugin cannot access arbitrary storage records; it uses the asset API and permissions.

## 2.11 Plugin extension data

Plugins may attach JSON data to the project, a track, cel, layer or node. Extensions are namespaced by the plugin ID.

```ts
type JsonValue = null | boolean | number | string | JsonValue[] |
  { [key: string]: JsonValue };

interface PluginExtension {
  schemaVersion: number;
  data: JsonValue;
}

type ExtensionBag = Record<string, PluginExtension>;
```

Rules:

- A plugin may write only its own namespace unless an explicit cross-plugin contract grants otherwise.
- The host preserves namespaces for uninstalled plugins.
- The host validates that extension data is valid JSON and within configured size limits.
- Each plugin owns migrations for its extension namespace.
- Extension migrations must be deterministic and must not mutate another plugin's namespace.
- A plugin should prefer a custom content node when the data is directly drawable/editable content; use extension data for supporting metadata/settings/relationships.
- Plugin preferences that are not part of the artwork (e.g. selected palette panel tab) belong in plugin settings, not project extension data.

## 2.12 Project requirements and missing plugins

A project may declare plugins required to fully edit or render it:

```ts
interface PluginRequirement {
  id: string;
  versionRange: string;            // semver range
  apiVersionRange: string;
  requiredFor?: Array<"edit" | "render" | "import" | "export">;
  optional: boolean;
}
```

Missing plugin behavior:

1. The project MUST open if its base project schema is supported.
2. Unknown node payloads and extension data MUST be preserved.
3. The host MUST report which plugins are missing or incompatible.
4. The editor SHOULD show placeholders for unsupported content.
5. An export that would silently omit required render content MUST fail with a clear diagnostic, unless the user explicitly chooses an acknowledged lossy export.
6. Saving the project MUST not strip unknown data.
7. A plugin is not automatically installed just because a project declares it.

## 2.13 Transactions, mutation and history

The in-memory document must be treated as immutable from plugin code. Plugins receive readonly snapshots/views and mutate via a host transaction.

```ts
api.document.transact({ label: "Add fill region" }, tx => {
  tx.nodes.insert({ celId, layerId, node });
  tx.extensions.set({
    scope: { kind: "cel", celId },
    namespace: "com.example.coloring",
    value: { schemaVersion: 1, data: { lastRegionId: node.id } }
  });
});
```

The transaction callback is synchronous. Long calculations, asset decoding or user interaction happen before commit. The callback builds a candidate transaction; the host validates all operations and commits them atomically.

Mandatory semantics:

- Each successful transaction increments one document revision.
- A failed transaction changes nothing.
- Each transaction creates one undo entry (unless explicitly marked non-undoable system metadata).
- Undo and redo are centrally managed by the host.
- The host records enough inverse data to undo plugin operations without invoking plugin code.
- All persistent plugin edits, including plugin extension data and node insertion/removal, go through transactions.
- A plugin cannot directly mutate the document object it receives.
- Transactions support an expected revision or conflict result so stale asynchronous work cannot overwrite newer edits.
- Preview samples and transient overlays do not create document revisions.
- The host enforces the four-layer-per-cel rule and any other core invariants at commit time.

A transaction should carry `originPluginId`, `label`, timestamp and affected object IDs for diagnostics. Do not serialize closures or executable callback functions into the project.

## 2.14 Validation invariants

A project is valid only if all of the following hold:

1. `format` is exactly `lighttable.project`.
2. Project ID and all object IDs are valid unique identifiers.
3. Width and height are finite positive numbers and within product safety limits.
4. Frame-rate numerator and denominator are positive integers.
5. `durationTicks` is a non-negative integer.
6. Track IDs are unique; track opacity is in `[0,1]`.
7. Clip IDs are unique within the whole project; start ticks are non-negative integers; durations are positive integers.
8. Clips do not overlap on the same track in schema v1.
9. Every clip references an existing cel.
10. Every cel contains no more than four layers in product v1.
11. Layer IDs are unique within the project; opacity is in `[0,1]`.
12. Node IDs are unique within the project; type is namespaced; typeVersion is a positive integer.
13. Matrices contain exactly six finite values.
14. All node/plugin payloads are JSON-safe (no NaN, Infinity, functions, DOM objects, cyclic values or undefined values).
15. Asset references resolve to descriptors, and imported binary assets pass integrity checks.
16. All clip end ticks are at or before `durationTicks`.
17. Extension namespaces are valid plugin IDs and each extension has a positive schema version.
18. Required plugin declarations are syntactically valid.

Structural JSON Schema validation is necessary but not sufficient; implement semantic validation in TypeScript and cover it with tests.

## 2.15 Persistence and project interchange

The canonical project package should be a ZIP-based `.ltproj` archive:

```text
my-animation.ltproj
├── manifest.json
├── document.json
└── assets/
    ├── <sha256>.png
    ├── <sha256>.webp
    └── ...
```

`manifest.json` includes package format/version, project ID, document schema version, asset inventory and optional integrity hashes. `document.json` contains the canonical JSON document. ZIP paths must be normalized and traversal entries such as `../` must be rejected.

The starting structural schema is `schemas/package-manifest.schema.json`; a valid empty-asset example is `examples/package.manifest.example.json`. A package manifest has this shape:

```json
{
  "format": "lighttable.package",
  "packageVersion": 1,
  "projectId": "<project-id>",
  "projectSchemaVersion": "1.0.0",
  "documentPath": "document.json",
  "assets": [],
  "createdAt": "<ISO-8601 UTC timestamp>"
}
```

Each asset entry maps the document asset ID to a normalized path under `assets/` and repeats its MIME type, byte length and SHA-256 hash. The document's `assets` descriptors remain the canonical project-level inventory; the package manifest supplies the archive path mapping.

A single-file JSON interchange option is defined as a `lighttable.project-json-bundle` wrapper containing the canonical `document` plus an `embeddedAssets` array of base64 binary records. Its starting schema is `schemas/project-json-bundle.schema.json`; its example is `examples/project-json-bundle.example.json`. The importer must decode and verify every embedded asset against byte length and SHA-256 before committing the project. The export UI must warn that embedded assets can make JSON files large. The ZIP package remains the preferred full-fidelity format.

Import pipeline:

1. Identify package format.
2. Enforce compressed and decompressed size limits.
3. Reject traversal paths and unexpected executable content.
4. Parse manifest and document JSON.
5. Validate supported project schema version.
6. Migrate older supported versions using deterministic sequential migrations.
7. Validate structural and semantic invariants.
8. Verify every asset hash/length and reference.
9. Resolve plugin requirements without auto-installing.
10. Commit the imported project atomically to storage.

Export pipeline:

1. Take a stable document snapshot/revision.
2. Resolve all asset references.
3. Preserve all unknown plugin data and unknown node payloads.
4. Serialize canonical JSON.
5. Write the package and integrity manifest.
6. Report missing renderers separately from data serialization; exporting a project package should not require every plugin to be installed.

## 2.16 Schema migrations

- Project `schemaVersion` uses semantic versioning.
- A major version indicates a breaking storage-model change.
- Minor/patch releases may add optional fields without breaking old readers, subject to documented rules.
- The host maintains ordered migrations, e.g. `1.0.0 -> 1.1.0`.
- Migrations operate on a copy and are atomic; failed migration leaves the original stored project untouched.
- Plugin data migrations are performed by the owning plugin when available. Unknown namespaces must remain untouched.
- Do not use the Plugin API version as a proxy for project schema version.

## 2.17 Physical print scale

`document.physicalSizeMm`, when present, defines the calibrated physical width and height represented by the logical document dimensions. It MUST be finite and positive and is preserved by project import/export. If it is absent, the document has no authoritative physical scale: the baseline PDF exporter may offer **Fit to A4** but MUST NOT label that output as 1:1. A calibrated 1:1 export uses `physicalSizeMm` to derive points per document unit, preserves that scale, and reports overflow rather than silently shrinking or enlarging the artwork. Printer-driver “fit to page” settings can still alter physical output and must be disabled by the user for 1:1 printing.

## 2.18 First-release frame UX

The first-release workspace caps user-created timeline positions at 200. This is a UI/product limit, not a change to timeline semantics or a schema-level cap. A tick remains a playback position; exposures can hold cels over multiple ticks. Add/duplicate/delete operations update exposure placement and document duration atomically. Imported documents beyond the UI cap remain preservable and should show a clear unsupported-editing warning rather than having frames silently dropped.

## 2.19 Storage/runtime separation

The domain model must not import IndexedDB APIs. Define storage interfaces so tests can use an in-memory adapter and the PWA can use IndexedDB. Store document JSON, assets, thumbnails, autosave journals and recovery checkpoints as separate records/stores. The service worker should cache the app shell and installed plugin packages, not unbounded user project/export blobs.
