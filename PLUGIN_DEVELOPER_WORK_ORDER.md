# LightTable — Plugin Developer Work Order (Parallel Track)

**Assignment type:** Independent first-party plugin development  
**Target deliverable:** `com.lighttable.coloring` — Coloring Mode plugin MVP  
**Architecture baseline:** LightTable Architecture Foundation, SDK v1 contract candidate  
**Execution profile:** `trusted-ui` only for this assignment

## 1. Mission

Build the first independently packaged LightTable plugin: a Coloring Mode plugin. It must be developed in a repository separate from the LightTable host and must consume only the public `@lighttable/plugin-sdk` contract supplied with this handoff.

The purpose is twofold:

1. Deliver a useful starting point for the future coloring environment.
2. Prove that the LightTable architecture can support a real plugin without importing or modifying private host code.

The plugin developer must be able to compile, test, package and validate the plugin before the LightTable host runtime is complete. Use the contract package and a mock host adapter for local tests. The mock is a test harness only; it must not become a second production implementation of LightTable.

## 2. Ownership boundary

### The plugin developer owns

- Coloring Mode plugin source and build configuration.
- Plugin manifest and package layout.
- Coloring tools and algorithms.
- Coloring-specific UI panels and settings.
- Coloring node payload schema, validation and migrations.
- Coloring node renderer.
- Plugin-owned project extension data.
- Plugin-owned tests, examples and developer documentation.
- A mock-host contract test harness sufficient to test the plugin in isolation.

### The LightTable lead developer owns

- Canonical project/document model and validators.
- Transaction engine and central undo/redo.
- Canvas lifecycle, pointer routing and viewport transforms.
- Renderer orchestration and compositing.
- Asset persistence and render service implementation.
- Plugin loader, permissions, registry and lifecycle runtime.
- Host UI extension points and plugin installation UI.
- Published production `@lighttable/plugin-sdk` package and host integration tests.

### Explicitly prohibited

- Do not import LightTable host source files, React components, stores, canvas refs or private services.
- Do not edit the host repository to make the plugin work.
- Do not implement a second plugin manager or a replacement document/history engine.
- Do not directly mutate document objects or write to host IndexedDB records.
- Do not create custom layer types or custom blend modes in SDK v1.
- Do not assume that an in-process `trusted-ui` plugin is sandboxed from browser capabilities.

## 3. Contract source and API freeze

Use these files as the integration contract:

1. `docs/01-architecture-overview.md`
2. `docs/02-document-model.md`
3. `docs/03-rendering-contracts.md`
4. `docs/04-plugin-sdk.md`
5. `docs/05-plugin-runtime-security.md`
6. `contracts/document-model.d.ts`
7. `contracts/plugin-api.d.ts`
8. `schemas/plugin-manifest.schema.json`
9. `examples/coloring-mode-reference.md`
10. `sdk-contract-package/` as the local TypeScript package `@lighttable/plugin-sdk`

For the parallel development period, treat `contracts/plugin-api.d.ts` and the plugin manifest schema as **SDK v1 contract candidate 1.0.0-architecture.1**. Implement against the declared public surface. Do not wait for the host runtime to be available.

The contract is frozen for compatible development during this work period. If an API is genuinely insufficient, file a proposed contract change containing: the missing capability, why existing APIs cannot express it, proposed type/signature, required permission, expected host behavior, and a test. Do not silently invent private APIs or ship a plugin-only fork.

The authoritative plugin API target declared by the manifest is `^1.0.0`. The local declarations package version `1.0.0-architecture.1` is a development artifact, not a published runtime release.

## 4. Required plugin package

Create a separate repository/package with this suggested structure:

```text
lighttable-coloring-plugin/
├── manifest.json
├── package.json
├── README.md
├── src/
│   ├── index.ts
│   ├── manifest.ts
│   ├── mode.ts
│   ├── tools/
│   │   ├── paint-bucket.ts
│   │   ├── color-picker.ts
│   │   └── color-brush.ts
│   ├── nodes/
│   │   ├── region-types.ts
│   │   ├── region-schema.ts
│   │   └── region-renderer.ts
│   ├── algorithms/
│   │   ├── flood-fill.ts
│   │   └── mask.ts
│   ├── panels/
│   │   ├── palette-panel.tsx
│   │   └── coloring-options-panel.tsx
│   ├── storage/
│   │   └── project-data.ts
│   └── workers/                 # optional computational worker
├── tests/
│   ├── algorithms/
│   ├── serialization/
│   ├── sdk-contract/
│   └── fixtures/
├── dist/
└── plugin-package.zip
```

Use Vite or another bundler that emits browser-compatible ESM. React must be externalized/peer-resolved; do not bundle a second React runtime. Include every relative chunk and stylesheet referenced by the entry point in the final ZIP package.

## 5. SDK and manifest requirements

- Import all host-facing types from `@lighttable/plugin-sdk`.
- Declare `execution: "trusted-ui"`.
- Declare API compatibility `^1.0.0` and the supported host version range agreed with the lead developer.
- Declare only the permissions required by actual plugin behavior.
- Register the Coloring Mode, its tools, panels, commands and renderer during `activate()`.
- Retain and dispose every registration. `deactivate()` must be idempotent and cancel any active gestures or computations.
- Use `api.document.transact()` or a `ToolGesture.commit()` for all persistent edits.
- Use `api.assets` for binary masks; never put base64 image data into JSON node payloads.
- Use `api.storage` / registered settings for local plugin preferences. Use namespaced document extension data or plugin-owned nodes for data that must travel with the project.
- Do not depend on undocumented host behaviors. Add a contract test for any subtle assumption.

The manifest ID is `com.lighttable.coloring`. The example manifest should declare contributions for one mode, its tools, panels, commands, and the custom node type `com.lighttable.coloring.region`.

## 6. Coloring plugin MVP scope

The plugin must activate as a distinct workspace mode and demonstrate this vertical slice:

### 6.1 Mode and UI

- Register a `coloring` mode.
- Register a palette panel with add/select/rename/delete color operations.
- Register a coloring-options panel for fill tolerance, gap closing and source-layer selection.
- Register a paint-bucket tool and a color-picker tool. A simple color-brush tool may be included if time permits.
- Register at least one keyboard command/shortcut and a project-menu entry.
- Switching away from Coloring Mode must not lose unsaved project edits or leave overlays/listeners active.

### 6.2 Persistent coloring representation

Use a plugin-owned node type in a standard host content layer:

`com.lighttable.coloring.region`, `typeVersion: 1`.

A starting payload is:

```ts
interface ColoringRegionData {
  maskAssetId: string;
  color: string;                 // sRGB #RRGGBB or #RRGGBBAA
  opacity: number;               // 0..1
  seed: { x: number; y: number };
  sourceLayerIds: string[];
  algorithmVersion: number;
  tolerance: number;
  gapClose: number;
}
```

The plugin owns validation and migration of this payload. Store the alpha mask as a binary asset using `api.assets.put()`. The project node stores only the asset descriptor ID and ordinary JSON properties. Do not place the mask in plugin preferences: it must travel with the project.

### 6.3 Paint-bucket workflow

1. Receive the host-normalized pointer sample in document coordinates.
2. Resolve the active target via `ToolContext.getActiveTarget()`; refuse edits if the target is missing or locked.
3. Determine input/source layers from the plugin's explicit options. Do not assume the currently active layer is the line-art source.
4. Use `api.render.renderCel()` with the chosen source-layer IDs and transparent background to obtain a deterministic source image.
5. Run flood-fill/region detection without blocking the host render loop. A Worker is preferred for large images, but a worker implementation is not required for the first contract milestone.
6. Convert the result into an alpha-mask `Blob`, store it through `api.assets.put()`, and obtain the returned asset ID.
7. Insert one `com.lighttable.coloring.region` node through a single transaction/gesture commit.
8. Ensure the resulting node can be undone/redone through host history.
9. Release the returned `ImageBitmap` using `close()` when no longer required. Abort long work on cancellation, tool change, mode deactivation or project close.

The initial algorithm may be basic contiguous flood fill with documented limits. It must have deterministic tests. Gap closing and tolerance controls must either work or be explicitly marked as not implemented; do not expose decorative controls.

### 6.4 Node renderer

- Register a `NodeRenderer` for `com.lighttable.coloring.region`.
- Validate the payload and supported type version.
- Load/decode the mask in `prepare()` and cache it by asset hash plus renderer/plugin version.
- Keep `render()` synchronous and deterministic. It must only consume prepared resources and the supplied render context.
- Do not access the active editor canvas DOM node.
- Do not apply the node transform a second time; the host renderer contract owns transform application.
- Ensure the node renders for editor, thumbnail and export intents.
- Report missing/corrupt mask assets as diagnostics rather than drawing silently incorrect output.
- Close decoded resources and clear caches on deactivation where ownership permits.

## 7. Independent development and mock-host requirement

The plugin must build and run its unit/contract tests before the production host exists.

Create a mock host adapter for tests that implements only the SDK methods the plugin uses. It must support:

- plugin activation and registration capture;
- fake document snapshots and transaction recording;
- fake active edit target and pointer samples;
- fake asset store with Blob/hash descriptors;
- fake `renderCel()` returning fixture `ImageBitmap` or a test-compatible image abstraction;
- renderer `prepare()` and `render()` invocation;
- fake settings/storage;
- event dispatch and disposable cleanup;
- simulated tool cancellation and project close.

Do not use the mock adapter to redefine SDK semantics. The official contracts and architecture docs are authoritative. The mock exists to make plugin logic testable without the host runtime.

## 8. Required tests

### Algorithm tests

- fill a closed single-color region;
- stop at a boundary;
- tolerance behavior at just below/above threshold;
- transparent pixels and anti-aliased boundaries;
- image edge and seed outside bounds;
- gap-closing behavior if exposed;
- deterministic identical inputs produce identical masks.

### Plugin/SDK tests

- manifest validates against the provided schema;
- plugin compiles using only `@lighttable/plugin-sdk`;
- activation registers expected contributions;
- failed activation disposes staged registrations;
- deactivation cancels active fill work and clears subscriptions;
- mode switching does not discard project data;
- tool cancellation does not commit a partial fill;
- a successful fill inserts exactly one node and one undoable transaction;
- the node renderer handles editor, thumbnail and export intents;
- corrupt/missing assets produce a diagnostic;
- palette preferences persist locally;
- project coloring nodes and assets survive serialized project round-trip;
- unknown/disabled plugin data remains intact.

## 9. Deliverables

1. Separate source repository (or clearly isolated package) with no private host imports.
2. Valid `manifest.json` and package ZIP.
3. TypeScript build configuration and reproducible build instructions.
4. Unit and SDK contract tests.
5. Mock-host adapter and fixtures.
6. Coloring node schema and migration policy.
7. README with installation, permissions, limitations and API version target.
8. A short integration report listing each host API used and any API gaps submitted for review.

## 10. Acceptance criteria

The plugin assignment is complete when:

- the plugin builds independently against the supplied SDK contract package;
- the package manifest validates;
- the plugin can be installed by the future host package installer without changing the plugin source;
- the Coloring Mode, palette panel, options panel and bucket tool register through public APIs;
- one successful fill creates a project-persistent plugin node and binary mask asset;
- undo/redo and project round-trip are covered by contract tests;
- renderer output is independent of viewport zoom, CSS size and editor overlay state;
- disabling/uninstalling the plugin does not delete its document data;
- the plugin does not import host internals or mutate the host store directly;
- all known limitations are documented.

## 11. Non-goals for this assignment

- Implement the LightTable plugin manager or host runtime.
- Implement the production host document model, transaction engine, renderer or asset store.
- Implement every advanced coloring feature (temporal color propagation, automatic multi-frame region matching, advanced line-art gap reconstruction, gradient/fill effects).
- Implement untrusted marketplace execution or worker plugin RPC.
- Change the canonical document schema without architecture review.
- Implement the complete LightTable drawing toolset.

## 12. Coordination protocol with the LightTable lead developer

Both developers work against the same architecture package revision.

The lead developer must implement the host-side APIs and semantics specified by the public contract. The plugin developer must implement only against that public contract and must not depend on lead-developer private code.

Use this change process for contract gaps:

1. Plugin developer submits a concise API Change Request with use case, missing capability, proposed signature, permission impact and test.
2. Architecture owner reviews whether the capability belongs in core or plugin scope.
3. If accepted, update `contracts/plugin-api.d.ts`, the local SDK package, manifest/schema/docs and tests in one coordinated change.
4. Both branches update to the same contract snapshot. No silent one-sided SDK fork.

The host integration milestone begins only when both sides pass the contract suite. Until then, plugin work proceeds independently using the local SDK package and mock adapter.

---

**Instruction to the plugin developer:** Start by reading this work order and the linked architecture documents. Build the plugin in a separate repository. Treat the SDK declarations as the only host integration surface. Do not wait for the LightTable host implementation, and do not invent private APIs to work around missing host functionality.


## Host ownership and integration boundary

Coloring Mode is an optional first-party plugin. The host ships the essential pencil/graphite/blue drawing tools, eraser, main canvas, pointer routing, document model, timeline clock, core path renderer, deterministic render service, asset store, transactions/history, onion skin, persistence and baseline print/export. The core workflow must work when Coloring Mode is absent or disabled. The plugin may use public SDK abstractions but must not take ownership of host services or implement a second history/document engine.

The host is adding the reviewed plugin-scoped `registerNodeRenderGate()` extension requested in `API_CHANGE_REQUEST.md`. The render coordinator will consult it before preparation and rendering for all render intents. Until that public API is available in a host build, the plugin's renderer-local fallback remains valid.
