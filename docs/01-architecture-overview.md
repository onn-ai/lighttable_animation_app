# 1. Architecture Overview

## 1.1 Product architecture goal

LightTable is a lightweight 2D frame-by-frame animation host with an extensible plugin ecosystem. It is not intended to become a monolithic drawing package in which every creative capability is built into the application core.

The host supplies the complete essential rough-animation workflow as well as durable platform services:

- project/document lifecycle and validation;
- timeline, tracks, exposures, cels and layers;
- canvas lifecycle, coordinate conversion and rendering orchestration;
- input routing and gesture/navigation infrastructure;
- playback clock;
- centralized transactional document mutation and undo/redo;
- persistence, recovery and project interchange;
- plugin discovery, registration, lifecycle and compatibility;
- UI extension points;
- built-in pressure-sensitive pencil, graphite/non-photo-blue presets, eraser and stroke preview;
- basic onion-skin composition and controls;
- default single-track filmstrip, frame operations, playback and four cel layers;
- numbered PNG ZIP and A4 landscape PDF export.

Specialized creative capabilities are supplied by plugins. Coloring is the canonical example: there is no built-in coloring engine in the host. The optional first-party Coloring Mode plugin owns the fill tools, palette, region detection, gap closing, coloring workflow UI and plugin-specific project data. The host provides the APIs needed to build these features safely. Basic onion-skin display is a built-in host capability; plugins may contribute additional onion-related workflows without owning the baseline compositor.

## 1.2 Architectural shape

Use a **modular monolith** for the host, with explicit module boundaries and a separately versioned Plugin SDK. Do not split the core into services or micro-frontends. The application is an offline-first PWA, and a modular monolith is the simplest reliable deployment and runtime model for that environment.

```text
┌──────────────────────────────────────────────────────────┐
│                    LightTable Host                        │
│  Workspace UI / Project lifecycle / Settings / PWA shell  │
├──────────────────────────────────────────────────────────┤
│                  Public Plugin API / SDK                   │
│  Tools · Modes · Panels · Commands · Events · Extensions  │
├─────────────────────────┬────────────────────────────────┤
│       Core Services     │        Plugin Runtime          │
│                         │                                 │
│ Document & timeline     │ Discovery & package validation │
│ Cels, layers, assets    │ Dependency resolver             │
│ Transaction/history    │ Loader / registry               │
│ Input & viewport        │ Lifecycle / failure isolation   │
│ Render coordinator     │ Permission / capability checks  │
│ Playback / persistence │ Plugin-owned storage            │
└─────────────────────────┴────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │     Installed plugins │
              │ Coloring / Brush /     │
              │ Cleanup / Import /      │
              │ Export / Other modes   │
              └───────────────────────┘
```

The diagram describes logical boundaries, not separate processes. SDK v1 supports trusted in-process UI plugins only. A worker/sandbox runtime is deferred until a separately specified RPC protocol and isolation boundary have been implemented.

## 1.3 Ownership boundaries

| Concern | Owner | Plugin interaction |
|---|---|---|
| Project identity and schema | Core | Read through Document API; mutate through transactions |
| Tracks, exposure timing and playback clock | Core | Read/modify through timeline APIs |
| Cel and layer containers | Core | Read/modify through document transactions |
| Generic content-node envelope | Core | Register node types and renderers |
| Plugin-specific node payload | Owning plugin | Serialize and migrate its own payload |
| Canvas element and DPR handling | Core | Never replace or own the host canvas |
| Viewport transform and pointer coordinates | Core | Receive normalized document-space samples |
| Node rendering | Core orchestrates; registered renderer implements | Register renderer against a namespaced node type |
| Tool algorithms | Tool plugin | Register tool and use gesture/document APIs |
| Coloring algorithms and UI | Coloring plugin | Register mode, tools, panels and node types |
| Undo/redo stack | Core | Submit atomic transactions; no separate plugin history |
| Plugin settings | Plugin owns schema; host owns persistence/UI shell | Register settings definitions |
| Plugin package and lifecycle | Core plugin runtime | Manifest + activation contract |
| Export file format | Exporter plugin or core baseline exporter | Consume deterministic render/frame APIs |

## 1.4 Plugin categories

A plugin can declare one or more contributions:

- **Tool:** Pencil, eraser, paint bucket, lasso, picker, transform tool.
- **Mode:** Coloring, cleanup, inking, animation planning. A mode groups tools, panels, shortcuts and workflow rules.
- **Node renderer:** Renders a custom persisted content-node type.
- **Layer renderer/processor:** Adds a custom layer type or processing stage when the host supports that extension point.
- **Panel/UI extension:** Palette, inspector, reference-image panel, plugin settings.
- **Timeline extension:** Exposure metadata, visual timeline overlays or specialized track UI.
- **Importer:** Reads external formats into the document model.
- **Exporter:** Produces output formats using the host's render service.
- **Utility/integration:** Automation, palette utilities, external integrations.

A plugin type is a declaration of contribution, not a separate executable format.

## 1.5 Core owns the essential animation workflow

The host core MUST include the baseline drawing and animation workflow. Pencil/brush drawing, pressure response, graphite and non-photo-blue presets, eraser, preview, core path rendering, undo/redo, frame operations, filmstrip, playback, basic onion skin, four cel layers, local persistence, PNG-sequence ZIP and A4 PDF are product-critical capabilities and MUST NOT depend on an optional plugin lifecycle.

The public SDK remains useful for specialized tools and extension workflows. Coloring Mode is the canonical optional first-party plugin. Advanced brushes, lasso/transform, cleanup, additional importers/exporters and extended print presets may be optional plugins or later host features as product needs dictate.

A small baseline importer/exporter MAY be included for project interchange and diagnostics. Optional output formats such as GIF, video, SVG, layered PSD or specialized print workflows should be plugins unless product requirements explicitly designate them as core.

## 1.6 Architecture principles

1. **Document first:** all editing is expressed as valid document transactions.
2. **Host owns resources:** canvas, timeline clock, storage and history are host-owned.
3. **Plugins own capabilities:** tool/mode behavior and plugin-specific data live outside core.
4. **Stable contracts:** public SDK types are the only supported integration surface.
5. **Unknown-data preservation:** the host must not destroy content it cannot interpret.
6. **Deterministic output:** an export render must not depend on CSS size, viewport zoom, current tool or editor overlays.
7. **Offline by design:** an installed plugin and its assets are available offline.
8. **Failure containment:** activation/render failures are reported and isolated as far as the runtime model allows.
9. **Security honesty:** in-process code is trusted; worker or iframe isolation is required for stronger isolation.
10. **No private imports:** plugins cannot rely on internal React components, stores, source paths or undocumented host modules.

## 1.7 Architectural decisions (ADRs)

### ADR-001 — Separate timeline ticks, exposures and cels

**Decision:** Model a playback tick, an exposure clip and a cel as separate records.

**Reason:** A drawing can be held for several playback ticks; a cel may be reused; multiple timeline tracks can coexist. Storing every timeline tick as a copied drawing would duplicate content and make holds/reordering unnecessarily expensive.

**Consequence:** The frame UI is a view over timeline ticks/exposures. The document model uses `tracks[]`, `clips[]` and `cels{}`.

### ADR-002 — The host owns the canvas and compositor

**Decision:** The host creates and sizes the main canvas, handles DPR/viewport transforms and runs the render pipeline. Plugins register renderers and overlays.

**Reason:** Multiple canvas owners would create coordinate, input, compositing, export and lifecycle conflicts.

**Consequence:** Plugin renderers receive a documented render context and draw in document space. They may not resize or replace the host canvas.

### ADR-003 — All document edits go through transactions

**Decision:** Plugins never mutate document objects directly. Every persistent edit uses the host transaction API.

**Reason:** This keeps validation, revision tracking, undo/redo, dirty state and autosave coherent.

**Consequence:** An interaction uses a transient preview while active and commits one atomic transaction when complete.

### ADR-004 — Unknown plugin content is preserved

**Decision:** Unknown node types and extension namespaces are retained as opaque JSON and included in saves/exports.

**Reason:** A project must not be destroyed merely because an optional plugin is missing.

**Consequence:** The host may show a missing-plugin placeholder. Exports that cannot faithfully render required content must warn or fail rather than silently omit it.

### ADR-005 — Plugin execution model is explicit

**Decision:** SDK v1 supports trusted in-process UI plugins only; worker execution is explicitly rejected until a separately designed RPC protocol exists.

**Reason:** React UI contribution and high-assurance isolation have different technical requirements.

**Consequence:** Permission manifests are capability/consent controls, not security boundaries for in-process JavaScript. Untrusted plugins require a future worker/iframe bridge.

### ADR-006 — Project schema, SDK and plugin data versions are independent

**Decision:** Maintain separate version identifiers for project format, Plugin API and each plugin-owned data namespace.

**Reason:** A host release should not force every plugin data structure to migrate, and a project migration should not imply an SDK break.

**Consequence:** Each version axis has its own compatibility and migration rules.

### ADR-007 — Core layers and animation tracks are distinct

**Decision:** Tracks arrange exposures over time; layers arrange content inside a cel.

**Reason:** The product direction describes up to three independent timeline rows and up to four drawing layers per frame. Conflating them would prevent correct compositing and editing.

**Consequence:** A track contains exposure clips. Each clip references a cel. Each cel contains its own ordered layer stack.

### ADR-008 — Render callbacks are synchronous and pure

**Decision:** A renderer callback is synchronous, deterministic and read-only with respect to the document. Expensive preparation happens outside the render callback.

**Reason:** Pointer drawing and playback need predictable latency; asynchronous render hooks can complete out of order and cause flicker.

**Consequence:** Plugins can precompute caches/bitmaps asynchronously, then render cached results synchronously. Render callbacks cannot commit document edits.

## 1.8 Out of scope for the first host release

- Coloring algorithms, bucket fill and region detection (optional Coloring Mode plugin).
- Full lasso/transform UX.
- Advanced multi-track workspace and advanced print presets.
- Marketplace backend, accounts, payments and publisher-signing infrastructure.
- Cloud synchronization or collaborative editing.

These can be developed after the contracts in this handoff are implemented and validated.
