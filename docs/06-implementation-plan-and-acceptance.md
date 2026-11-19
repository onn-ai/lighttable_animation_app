# 6. Implementation Plan, Test Matrix and Acceptance Criteria

## 6.1 Delivery strategy — revised by READ_FIRST.md

The product-owner sequence supersedes the original plan that deferred pencil/eraser, onion skin and full timeline UX until after the SDK/runtime. Keep plugin runtime work parallel where practical, but never block the core animation experience on it.

### Stage 0 — Baseline and decisions

- Preserve repository, schema, contract and test baseline.
- Reconcile all ownership conflicts in architecture docs.
- Record ADRs for `core.path`, drawing gesture transactions, active-track onion composition, physical print scale and default single-track workspace.
- Keep SDK v1 `trusted-ui` only; reject `worker` manifests.

### Stage 1 — Document model, validation and persistence

- Implement canonical project model, semantic validator and deterministic migrations.
- Implement revisioned snapshots, IndexedDB persistence, content-addressed asset storage and hash verification.
- Preserve unknown plugin nodes, namespaces and assets through project round-trips.
- Implement native project import/export, autosave and recovery.

### Stage 2 — Transactions and history

- Implement atomic transactions, expected-revision checks, undo/redo, bounded history and checkpoints.
- One completed drawing gesture is one undoable transaction.
- Preview/cancellation never mutates project data or history.
- Enforce track/layer locks and four-layer limit centrally.

### Stage 3 — Core canvas, input and default drawing tools

- Implement host canvas lifecycle, DPR, viewport transforms and render scheduler.
- Implement normalized Pointer Events input, capture, coalesced samples and cancellation.
- Implement generic `core.path` content and deterministic renderer.
- Ship built-in pressure-sensitive pencil, graphite/non-photo blue presets, eraser and low-latency preview.
- Measure mouse/pen behavior; report physical-device testing honestly.

**Exit gate:** draw, pressure-vary, erase, undo/redo and save/reopen on a clean install with no plugin.

### Stage 4 — Core animation workflow

- Implement the default single-track filmstrip over the full tracks/exposures/cels timeline model.
- Support up to 200 user-facing frames, add/independent duplicate/delete/navigation.
- Implement 12/24 FPS playback and loop.
- Support up to four cel layers with visibility, opacity and lock.
- Implement host-owned basic onion skin (one to three neighbors per direction, active-track default, red/pink previous and cyan/blue following).
- Implement horizontal canvas flip and desktop/mobile navigation controls.

**Exit gate:** create and play a hand-drawn animation with onion skin and layers on a clean install.

### Stage 5 — Project and print/export workflow

- Complete robust project JSON and native `.ltproj` package interchange, autosave and recovery.
- Implement numbered PNG sequence ZIP and A4 landscape PDF, one frame per page.
- Add frame numbering and consistent registration crosshairs; support optional Acme peg-bar marks.
- Define `physicalSizeMm`; offer Fit to A4 by default and only offer calibrated 1:1 when physical scale exists.
- Export from a pinned read-only snapshot, excluding editor overlays, onion skin and viewport transforms by default.

**Exit gate:** reopen a project and produce deterministic PNG and printable outputs.

### Stage 6 — Plugin runtime and Coloring integration

- Implement plugin manifest validation, local ZIP installation, trusted ESM loading, permissions, staged registration and lifecycle cleanup.
- Integrate Coloring Mode against public host APIs; no private imports or duplicate history/input/canvas services.
- Implement the plugin-scoped renderer gate so Draft mode skips preparation and rendering for coloring nodes only.
- Verify assets, node persistence, undo/redo, deterministic rendering, disable/missing-plugin preservation and export diagnostics.
- Run separate core and coloring acceptance suites.

**Exit gate:** Coloring can be enabled/disabled independently without reducing core functionality or destroying project data.

### Stage 7 — Advanced capabilities

- Lasso and transform (move/rotate/scale).
- Advanced multi-track workspace.
- 2x2 / 3x3 contact sheets and expanded print presets/calibration UI.
- Advanced brush engines, importers/exporters and optional plugin ecosystem features.

## 6.2 Required contract tests

### Document model

- valid minimal project accepted;
- invalid dimensions/frame rate/opacity rejected;
- duplicate IDs rejected;
- missing cel references rejected;
- overlapping clips on one track rejected;
- overlaps across tracks accepted;
- clip duration and document duration validated;
- four layers per cel accepted, five rejected in product v1;
- shared cel exposure resolves consistently;
- independent duplicate creates independent cel/nodes/extensions;
- linked duplicate references the same cel;
- unknown node type preserved;
- unknown extension namespace preserved;
- project round-trip preserves plugin data and assets;
- malformed asset hash rejected;
- unsupported major schema version does not overwrite source project.

### Transaction/history

- successful transaction increments revision exactly once;
- failed transaction leaves state unchanged;
- multi-operation transaction is atomic;
- undo restores prior state;
- redo restores committed state;
- locked layer rejects unauthorized edit;
- stale expected revision returns conflict;
- preview-only updates do not increment revision;
- plugin write cannot mutate another namespace.

### Rendering

- track and layer ordering are correct;
- opacity is applied once at the correct compositing boundary;
- node transform is applied exactly once;
- DPR/viewport changes do not change document content;
- horizontal canvas flip is view-only;
- export excludes selection/cursor/handles/viewport transforms;
- onion-skin layers are excluded unless requested;
- same snapshot + same intent yields deterministic output;
- missing renderer prevents silent incomplete export;
- thrown renderer does not leak canvas state;
- stale async cache is ignored after revision changes.

### Plugin runtime/SDK

- manifest parsing rejects invalid IDs/versions/paths/permissions;
- a `worker` manifest is rejected with an explicit unsupported-runtime error until a worker RPC protocol is implemented;
- incompatible API range blocks activation;
- missing required dependency blocks activation;
- missing optional dependency permits degraded activation where declared;
- dependency cycle is rejected;
- duplicate contribution IDs are rejected;
- failed activation rolls back registrations;
- deactivate disposes every registration/listener/worker/preview;
- re-enable does not duplicate contributions;
- disabled plugin data remains in project;
- uninstall does not strip project content;
- installed plugin bundle loads offline;
- package path traversal rejected;
- package update rollback works;
- sample plugin compiles against SDK package without importing host internals;
- contract TypeScript and JSON Schema example checks run in CI.

## 6.3 Performance and reliability targets

Initial targets should be measured on agreed desktop and mobile reference devices. These are engineering targets, not claims that every device can meet them:

- no React render per pointer sample;
- pointer processing and preview rendering should remain responsive under ordinary pen input;
- timeline resolution for 240 ticks and three tracks should be inexpensive (use indexing if linear scans become material);
- thumbnails update only when the referenced cel/content changes;
- export yields to the UI or runs preparation in a worker and supports cancellation;
- autosave is debounced and must never block a pointer move;
- project/asset storage errors are surfaced and never reported as a successful save;
- recovery checkpoint is retained until a subsequent successful save is confirmed.

The implementation report must identify the tested devices/browsers and measured results. Do not claim hardware-specific palm rejection without physical testing on those devices.

## 6.4 Definition of done for this architecture foundation

The foundation is ready for production drawing-tool implementation only when:

- the document model is stable and validated;
- timeline ticks, exposures, cels and cel layers are implemented as separate concepts;
- project import/export preserves unknown data;
- all persistent changes use the central transaction/history service;
- the render coordinator owns the only main canvas and deterministic document render path;
- plugins can register node renderers and editor overlays;
- the SDK can register tools, modes, panels, commands, events and settings;
- a locally packaged plugin can be installed, loaded offline, disabled and uninstalled;
- an optional missing plugin does not prevent project opening or data preservation;
- the example plugins compile in separate packages;
- all contract tests pass in CI;
- API and project schema versioning policies are documented.

## 6.5 Required developer handoff/report

At the end of the foundation implementation, the developer must report:

1. Exact repository and package structure.
2. Implemented project schema version and migration path.
3. Exact Plugin API version and package name.
4. Any deviations from this specification, with rationale and impact.
5. Unit/integration/e2e test commands and exact results.
6. Browser/device matrix tested.
7. Known limitations and security limitations.
8. Example plugin installation instructions.
9. A minimal plugin development tutorial.
10. A list of APIs intentionally deferred to a future SDK major/minor release.

Do not mark an acceptance item complete because its UI exists. It is complete only when the behavior is implemented and tested.


## 6.6 Explicit v1 support boundary and deferred extensions

To prevent accidental over-implementation or false compatibility claims, use this initial SDK v1 profile:

| Capability | SDK v1 status |
|---|---|
| Trusted in-process React/UI plugins | Supported; install only trusted code |
| Local ZIP package installation and offline loading | Required host runtime capability |
| Tools, modes, panels, toolbar/menu items, commands, settings and typed events | Supported |
| Custom content-node types and synchronous deterministic renderers | Supported |
| Editor overlays and transient gesture previews | Supported |
| Project/cel/track/layer/node extension data | Supported, namespaced and versioned |
| Importer and exporter contributions | Supported through host APIs |
| Plugin-owned asset and preference storage | Supported through host APIs |
| Worker plugin runtime | Not representable in SDK v1; reject at schema, type and runtime boundaries |
| Sandboxed third-party UI / iframe plugins | Deferred |
| Plugin-defined layer types | Deferred; v1 uses standard content layers |
| Plugin-defined blend/composite modes | Deferred; unsupported modes are preserved and render with fallback warning |
| Plugin-defined timeline track types or clip overlap semantics | Deferred; v1 track/exposure invariants remain host-owned |
| Cross-plugin references to another plugin's tools/panels from a mode declaration | Deferred; SDK v1 mode references are plugin-local |
| Arbitrary global CSS or direct host DOM access as a supported API | Not supported |

A host may implement deferred capabilities later, but it must introduce an explicit compatible SDK extension or a new major API version as appropriate. A manifest field reserved for future use is not proof that the runtime supports that capability.

## 6.7 Lead implementation status — 2026-11-19

This status distinguishes implemented source and automated checks from release qualification. A visible UI control alone is not treated as acceptance evidence.

| Stage | Status | Evidence / remaining qualification |
|---|---|---|
| 0 — Baseline and decisions | Complete | Product-owner ownership conflicts reconciled; ADRs and the implementation report document decisions and boundaries. |
| 1 — Document and persistence | Implemented, migration work partial | v1 model validation, project package, asset hash checks, IndexedDB/fallback, autosave and recovery are present and host-tested. A general schema-version migration framework remains outstanding. |
| 2 — Transactions and history | Implemented and host-tested | Atomic revisioned transactions, undo/redo, gesture commit/cancel semantics and layer invariants are covered by host runtime checks. |
| 3 — Core canvas, input and tools | Implemented in source; browser qualification outstanding | Host canvas, pointer capture/coalesced samples, pressure paths, presets, eraser and preview are present. Full dependency-backed build, desktop/mobile browser behavior and real stylus/hardware testing remain outstanding. |
| 4 — Core animation workflow | Implemented in source; browser qualification outstanding | Single-track filmstrip, frame operations, 12/24 FPS playback, four cel layers and host-owned onion skin are present. The host runtime validates model/timeline behavior; full browser UX and performance acceptance remain outstanding. |
| 5 — Project and print/export | Implemented with print boundary | `.ltproj`, PNG sequence ZIP and A4 PDF exports use pinned snapshots and pass structural/runtime checks. Calibrated 1:1 physical printing is not implemented; Fit to A4 is the supported path. |
| 6 — Plugin runtime and Coloring integration | Partial | Trusted in-process plugin lifecycle, SDK capability checks, optional built-in Coloring Mode, assets, renderers and public node-render gate are implemented/tested. General local ZIP installation, dependency resolution/update rollback and sandboxing are not complete. |
| 7 — Advanced capabilities | Deferred | Lasso/transform, advanced multi-track editing, contact sheets and advanced brushes/importers remain outside this alpha. |

### Verified test commands

`npm run check` passes in the supplied environment and runs the core/host/test TypeScript checks, 13 host runtime checks, 21 Coloring Mode tests, 12 standalone controller tests and schema acceptance checks. The host UI check uses a local React type shim. The environment lacked installed root React/Vite dependencies and registry access, so `npm run build` / `vite build` and a dependency-backed strict application typecheck remain unverified. No real-browser or physical-device test is represented as passed. See [`IMPLEMENTATION_REPORT.md`](../IMPLEMENTATION_REPORT.md) for the full release boundary.
