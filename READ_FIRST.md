# READ FIRST — LightTable Product & Engineering Direction

> **New to LightTable? Read [`KICKSTART.md`](./KICKSTART.md) first.** It explains the product, target user and intended end result without assuming prior project context. This document then sets the product-owner decisions and engineering direction.

**Audience:** Lead developer, core application team, plugin team, QA  
**Purpose:** Product-owner direction to read before implementation of the LightTable host begins  
**Status:** Decision brief / implementation guidance  
**Applies to:** LightTable Architecture Foundation and Plugin SDK contract candidate 1.0.0-architecture.1  
**Priority:** Read this document before following the current implementation sequence

---

## 1. Product-owner decision

The architecture foundation is approved **with the product and sequencing refinements in this document**.

The coloring-plugin side project may continue as planned. It is a legitimate parallel workstream and should not be stopped or discarded. Its work can help validate the plugin contract, custom node lifecycle, asset handling, renderer registration, serialization and missing-plugin behavior. Any adjustments needed at host integration can be handled through explicit contract changes and a small integration pass.

However, the main LightTable host must be built around the original product proposition:

> **LightTable is a minimalist, responsive, traditional 2D rough-animation light table. The drawing and frame-by-frame workflow is the product. The plugin system extends that product; it must not delay, replace or obscure it.**

The core animation workflow must work in the official application without installing, enabling or depending on any optional plugin.

This document changes product ownership and implementation priority. It does **not** discard the document model, rendering contracts, plugin architecture, security model or the coloring work order where those remain compatible with the decisions below.

## 2. The product must always work without plugins

The following are **built-in LightTable capabilities**, not optional extensions and not a plugin installation requirement:

| Capability | Required in the core application |
|---|---|
| Pencil / brush drawing | Yes |
| Pressure-sensitive active-stylus input | Yes |
| Mouse drawing for desktop use | Yes |
| Graphite `#1A1A1A` and non-photo blue `#2563EB` | Yes |
| Eraser | Yes |
| Live stroke preview | Yes |
| Core path content-node creation and rendering | Yes |
| Undoable drawing gestures | Yes |
| Pointer capture, cancellation and stylus lifecycle handling | Yes |
| Frame creation, duplication, deletion and navigation | Yes |
| Single-track filmstrip timeline as the default workspace | Yes |
| 12 / 24 FPS playback and looping | Yes |
| Basic onion skinning, 1–3 frames before and after | Yes |
| Up to four drawing layers per cel, with visibility, opacity and lock | Yes |
| IndexedDB autosave and project recovery | Yes |
| Project import/export | Yes |
| Baseline A4 PDF and numbered PNG-sequence export | Yes |
| Registration marks for print export | Yes |

These are release requirements for the first usable LightTable animation workflow. Do not move them to a later “specialized tools” phase merely because the architecture supports plugins.

### 2.1 Default Drawing Tools are core code

Implement the **Default Drawing Tools** as a first-party, host-owned core module, bundled and enabled automatically with LightTable:

- Pressure-sensitive pencil / brush.
- Graphite and non-photo blue presets.
- Eraser.
- Low-latency stroke preview.
- Core path node creation and deterministic path rendering.
- One atomic, undoable document edit per completed drawing gesture.
- Correct cancellation with no partial document edit.
- Pointer capture, lost-capture handling, `pointercancel`, app suspension and stylus/device changes.

The tools may use the same internal registration interfaces or abstractions as SDK tools where that is useful. They must **not** depend on the external plugin manager, plugin installation, plugin activation, network access or a separately installed “basic tools” package.

Do not interpret “Default Drawing Tools plugin” as permission to make pencil and eraser optional. For product purposes these are part of the LightTable host/core distribution.

### 2.2 Core input contract

The host Input Service remains the sole owner of browser Pointer Events, pointer capture, touch policy and coordinate conversion. Core tools and plugins receive normalized samples rather than taking ownership of the main canvas or registering competing global pointer handlers.

Minimum behavior:

- `pointerType === "pen"` draws with available pressure/tilt data.
- `pointerType === "mouse"` draws for desktop use, with a sensible pressure fallback.
- Touch does not accidentally create drawing strokes when the stylus workflow is active. The host owns a configurable touch policy for touch-only devices.
- Consume `getCoalescedEvents()` where supported and preserve sample order/timing.
- Convert viewport samples to document coordinates through the same transform used by rendering.
- Handle `pointercancel`, `lostpointercapture`, mode/tool changes, project close and application suspension.
- On cancellation, clear the preview and release resources without committing a partial stroke.
- Avoid a React render for every pointer sample; keep high-frequency input/rendering outside React state updates.

Pressure should affect width and/or opacity through a documented, adjustable curve. Preserve raw samples needed for deterministic replay and future brush improvements. Do not claim hardware-specific palm rejection until it has been physically tested on the target Android device.

## 3. Keep the architecture; correct the feature ownership

The architecture's strongest foundations should remain:

- React + TypeScript + Vite modular monolith.
- Host-owned project/document model, timeline clock, canvas lifecycle, viewport transforms, Input Service, renderer coordination, persistence and central transaction/history service.
- Distinct concepts for tracks, exposures, timeline ticks, cels and cel layers.
- Generic content-node envelope with namespaced plugin node payloads.
- Deterministic document rendering separate from editor overlays and viewport presentation.
- Unknown plugin data and unknown node payload preservation on project round-trips.
- Optional plugins that can be missing or disabled without destroying their project data.
- Offline-first PWA behavior and explicit plugin security boundaries.

The required adjustment is that **essential rough-animation functionality is part of the host's built-in product surface**. Extensibility is not a reason to leave essential workflows to optional plugins.

### 3.1 Ownership table

| Area | Owner / delivery status |
|---|---|
| Document model, validation, tracks, exposures, cels and layers | Host core |
| Canvas lifecycle, DPR, viewport, transforms and input routing | Host core |
| Generic core path node schema and renderer | Host core |
| Pencil, graphite/blue presets, eraser and stroke preview | Host core; bundled by default |
| Undo/redo and atomic transactions | Host core |
| Timeline, playback and basic filmstrip | Host core |
| Basic onion-skin query, composition, UI and settings | Host core |
| Four-layer workflow | Host core |
| Autosave, recovery and canonical project interchange | Host core |
| Baseline A4 PDF, PNG sequence and registration marks | Host core |
| Coloring Mode, palette, bucket/fill algorithm, region masks and coloring-specific UI/data | Separate first-party optional plugin |
| Future specialized brushes, additional importers/exporters and third-party workflows | Optional plugins where appropriate |

A first-party plugin can still be bundled with the official application. The distinction is not whether code is written by the same team; it is whether the product's core workflow depends on an optional plugin lifecycle. Essential functionality must not.

## 4. Preserve the original minimalist workspace

The document model can be richer than the default user interface.

For the first product release:

- Show one primary animation track as a horizontal filmstrip by default.
- Keep frame thumbnails, frame numbers, playback, 12/24 FPS, loop and add/duplicate/delete actions immediately accessible.
- Keep large previous/next frame controls reachable on touch devices.
- Keep the four cel layers in a compact layers popover/panel, not as four mandatory timeline tracks.
- Keep onion-skin enablement and opacity/count controls easy to reach.
- Keep the drawing canvas visually dominant, with a restrained dark workspace and light paper.
- Provide an advanced workspace path for additional tracks later; do not expose multi-track complexity by default.

Do **not** remove tracks/exposures from the underlying document model just to achieve a simple filmstrip. The model remains extensible; the default workspace stays focused.

The original reference UI also includes horizontal canvas flip, keyboard frame stepping, spacebar navigation on desktop and mobile-safe touch targets. These should remain in the core workspace plan. Full two-finger pan/pinch/rotate is a host navigation feature, not a plugin's responsibility.

## 5. Onion skinning is core

The architecture overview currently describes basic onion-skin display as a possible optional workflow plugin. Change that product decision.

Basic onion skinning is a guaranteed host capability:

- Previous frames: soft red/pink tint.
- Following frames: soft cyan/blue tint.
- Configurable 1–3 frames in each direction.
- Separate opacity and enable/disable controls.
- Rendered through a host-owned onion compositor using the deterministic document renderer.
- Excluded from normal exports unless a user explicitly chooses an onion-skin/contact-sheet option.

The host owns the baseline onion-skin UI and behavior. An optional plugin may add advanced onion workflows later, but basic onion skinning must never require one.

Clarify in the rendering specification whether onion neighbors are resolved for the active track only or across the composited document. The initial product default should be documented and tested, rather than left to an implicit plugin decision.

## 6. Export and physical print workflow are core

LightTable's print workflow is a product differentiator, not an optional afterthought.

The host must provide baseline exports:

1. Numbered PNG sequence in a ZIP.
2. A4 landscape PDF, one frame per page.
3. Frame numbers with consistent registration crosshairs and optional Acme peg-bar marks.
4. White-paper export by default, with a transparent PNG option where appropriate.
5. Onion skins, selection handles, cursor, UI, viewport transform and editor-only overlays excluded by default.

The specification must distinguish:

- **Fit to A4:** artwork is scaled to fit the printable region.
- **Calibrated 1:1:** artwork is printed at a defined physical scale, without automatic fit scaling.

A logical canvas size such as 1920×1080 does not itself define a physical print size. Before claiming 1:1, define document physical dimensions or a pixels-per-inch / scale calibration model, page margins and printer scaling assumptions. The export UI and PDF metadata/help must not label “fit to page” as 1:1.

The first release should include A4 one-frame-per-page and numbered PNG sequence. Contact sheets (2×2 / 3×3), blue-pencil lightening/conversion, print calibration and advanced presets can be staged, but the print/export architecture must anticipate them and the baseline export must not be delegated to a third-party plugin.

## 7. Coloring plugin: continue the parallel workstream

The existing `PLUGIN_DEVELOPER_WORK_ORDER.md` remains a valid separate assignment. Do not stop the coloring team and do not throw away work already completed.

The coloring plugin is valuable because it tests real extension scenarios:

- Separate package and public SDK consumption.
- Mode, tools, panels and command registration.
- Custom `com.lighttable.coloring.region` node type.
- Binary mask assets through the host Asset API.
- Plugin-owned project data and migrations.
- Deterministic renderer integration for editor, thumbnail and export intents.
- Undo/redo through the host transaction service.
- Disable/missing-plugin behavior and round-trip preservation.

Keep the plugin repository independent. Continue using the mock-host adapter for algorithm and contract tests. Do not import private host modules, duplicate the document/history engine or write directly to host storage.

### 7.1 Integration rules

- The coloring plugin is optional; LightTable's pencil, eraser, timeline, onion skin, saving and baseline export must work when it is absent or disabled.
- Coloring data must survive project open/save/export when the plugin is missing. If the host cannot render a required coloring node, show a clear diagnostic and do not silently produce an incomplete visual export.
- The core application must provide the standard path rendering and deterministic `renderCel()`/render-service capabilities required by the coloring workflow.
- Coloring should use the active edit target and host transactions; it must not own the main canvas, pointer routing, timeline clock or global undo stack.
- Do not silently fork the SDK or invent undocumented host APIs. If the plugin needs a missing capability, submit a contract-change proposal with the use case, proposed signature, permission impact and test. The lead developer owns approval and synchronization of the contract package, types, manifest schema, runtime validation and docs.
- Avoid breaking the frozen SDK candidate without a reviewed change. Keep the plugin team informed of any approved contract updates and provide a migration note if required.

It is acceptable if the plugin requires a small integration refinement when the host becomes available. That is normal for a separately developed plugin against a pre-implementation contract. The aim is to keep the integration controlled, not to demand that the side project predict every host detail perfectly.

## 8. Revised implementation sequence

The current `docs/06-implementation-plan-and-acceptance.md` says production pencil/eraser, advanced stylus handling, onion skin and full timeline UX belong in Stage 6, after the SDK/runtime and reference plugins. **That sequence is superseded for product-critical features.**

Use the sequence below for the host application. The coloring team can continue in parallel.

### Stage 0 — Baseline and decisions

- Keep repository, schema, contract and test baseline.
- Approve the product ownership decisions in this document.
- Record ADRs for core path node schema, drawing gesture transactions, onion composition semantics, physical print scale and default workspace timeline.
- Keep SDK v1 `trusted-ui` only until a worker RPC contract is separately specified.

### Stage 1 — Document model, validation and persistence foundation

- Implement the canonical document model, validator and migrations.
- Implement project snapshots/revisions, asset storage and IndexedDB persistence.
- Preserve unknown plugin nodes, namespaces and assets through round-trips.
- Implement atomic project import/export, autosave and recovery.

### Stage 2 — Transactions and history

- Implement atomic transactions, revision checks, undo/redo, memory limits and checkpoints.
- Define one completed drawing gesture as one undoable operation.
- Ensure cancellation/preview-only updates do not mutate the document or create history entries.
- Enforce layer locks and transaction validation centrally.

### Stage 3 — Core canvas, input and default drawing tools

- Implement the host-owned canvas, DPR handling, document/viewport transforms and render scheduler.
- Implement the Input Service, pointer capture, coalesced samples and lifecycle cancellation.
- Implement the generic core path node and deterministic path renderer.
- Implement pencil, graphite/blue presets, eraser and low-latency preview as built-in host tools.
- Physically test pen and mouse behavior; record device/browser results.

**Exit gate:** A user can draw, vary pressure, erase, undo/redo and save/reopen without any plugin installed.

### Stage 4 — Core animation workflow

- Implement the default single-track filmstrip over the canonical timeline model.
- Implement up to 200 user-facing frames for the initial product release, including add/duplicate/delete/navigation.
- Implement 12/24 FPS playback and loop.
- Implement up to four cel layers with visibility, opacity and lock.
- Implement basic onion skinning in the host compositor.
- Implement canvas flip and desktop/mobile navigation behavior.

**Exit gate:** A user can create and play a simple hand-drawn frame-by-frame animation, with onion skin and layers, on a clean installation.

### Stage 5 — Core project and print/export workflow

- Complete robust project JSON and native package interchange, autosave and recovery.
- Implement numbered PNG ZIP and A4 landscape PDF.
- Implement frame numbering and registration marks.
- Define and test fit-to-page vs calibrated 1:1 semantics.
- Ensure export renders a stable snapshot and excludes editor-only state.

**Exit gate:** A user can reopen a project and produce a consistent numbered animation sequence and printable pages.

### Stage 6 — Plugin runtime and coloring integration

- Implement/finish plugin loading, registration, permissions, lifecycle, offline availability and failure cleanup.
- Integrate the coloring plugin against the real host APIs.
- Verify coloring node/asset persistence, undo/redo, deterministic rendering, missing-plugin preservation and visual-export diagnostics.
- Run separate core and plugin acceptance suites.

Plugin infrastructure can be developed in parallel where practical, but it must not block the first working core drawing/animation milestones. A core-only Alpha must remain possible even if third-party plugin distribution is not yet complete.

### Stage 7 — Advanced capabilities

- Lasso and transform with move/rotate/scale.
- Advanced multi-track workspace.
- 2×2 / 3×3 contact sheets and expanded print presets.
- Advanced brush engines, specialized importers/exporters and optional plugin ecosystem features.
- Further gesture shortcuts where reliability is demonstrated.

## 9. Contract and documentation changes required

The lead developer should update the architecture package so it no longer contradicts this direction. At minimum:

| File | Required change |
|---|---|
| `docs/01-architecture-overview.md` | State that built-in drawing, basic onion skin, animation workflow and baseline export are host product capabilities. Keep coloring as the canonical optional plugin. |
| `docs/02-document-model.md` | Retain tracks/exposures/cels/layers; define the core path node and clarify 200-frame first-release UX semantics versus timeline ticks/exposures. Add physical print-scale metadata or a clearly specified export calibration source. |
| `docs/03-rendering-contracts.md` | Define core path rendering, core onion composition and stable read-only export snapshots; make overlay/onion exclusion explicit. |
| `docs/04-plugin-sdk.md` | Clarify that SDK tools/modes are extension points, not a requirement for core pencil/eraser. Define how host-owned tools coexist with plugin-registered tools. |
| `docs/06-implementation-plan-and-acceptance.md` | Replace the old Stage 6 deferral with the revised sequence in Section 8. Add core drawing and animation acceptance gates. |
| `PLUGIN_DEVELOPER_WORK_ORDER.md` | Keep the coloring assignment. Add that coloring relies on host-owned path rendering/input/transactions and is optional to the core workflow. |
| `README.md` | Make this document the first read and explain the core-vs-plugin ownership rule. |
| SDK contract package and schemas | Keep aligned with any reviewed API changes; do not silently fork or publish an unimplemented runtime API. |

### 9.1 SDK v1 consistency checks before freeze

The architecture review also identified a few contract details to resolve before calling SDK v1 stable:

1. The public manifest/type surface must consistently reject `worker` execution until the worker RPC contract exists; the architecture README already says v1 supports `trusted-ui` only.
2. Export operations should use a revision-pinned, read-only snapshot rather than an unrestricted live `DocumentApi` surface.
3. Renderer preparation should not receive write-capable asset APIs unless there is a specifically justified use case; separate read and write asset capabilities where possible.
4. A `ToolGesture.commit()` and `DocumentApi.transact()` must have one unambiguous rule so a completed gesture creates exactly one history entry.
5. Tighten `ExtensionScope` types so invalid combinations are rejected at compile time.
6. Document whether onion-skin neighbors resolve on the active track or the full composited document.

These are contract refinements, not reasons to stop the coloring side project. Handle them through reviewed change proposals and keep the standalone `sdk-contract-package/index.d.ts` synchronized with `contracts/plugin-api.d.ts`.

## 10. Alpha 1 acceptance criteria

LightTable Alpha 1 is ready for product review when all the following can be demonstrated on a clean install, with no optional plugins:

- The app opens as an installable PWA and works offline after initial installation.
- The user can create a project and draw with mouse and active stylus.
- Pen pressure changes the stroke according to the configured pressure response.
- Graphite and non-photo blue are available.
- Erasing affects the intended active layer only.
- Stroke preview is responsive and committed strokes replay deterministically.
- A completed stroke creates one undo entry; undo/redo restores the expected document state.
- Pointer cancellation/lost capture does not leave partial strokes or stuck input state.
- The user can add, duplicate, delete and navigate frames (up to 200 in the initial UX).
- Onion skins show previous red/pink and following cyan/blue drawings, with configurable 1–3 frame ranges.
- Playback works at 12 and 24 FPS with loop control.
- Four layers per cel work with visibility, opacity and lock.
- Project autosave/recovery survives reload and a browser restart to the extent supported by browser storage.
- Numbered PNG ZIP and A4 landscape PDF exports work and do not include editor UI, onion skin or viewport transforms by default.
- Registration marks and frame numbering are consistent across pages.
- Device/browser test results are reported, including physical Huion Note E testing before claiming Huion-specific readiness.

A feature is not complete because its icon or panel exists. It must pass its workflow acceptance test. Anything not implemented must be visibly identified as a limitation.

## 11. Required lead-developer response

Before starting implementation against the old sequence, the lead developer should reply with:

1. Confirmation that this product direction is understood and accepted, or a list of explicit objections.
2. A revised repository/file plan reflecting core drawing tools and onion skin ownership.
3. Updated stage plan and milestones using Section 8.
4. A list of architecture and SDK contract edits to be made before the relevant implementation work.
5. Dependencies between the host and the parallel coloring plugin, including any contract changes requested.
6. Testable acceptance criteria and target desktop/mobile/stylus test devices.
7. Any proposed deviations, each with rationale and product impact.

**Default decision:** If a capability is listed as core in this document, do not defer it to an optional plugin or make the core product depend on the plugin runtime to provide it.

---

## Short version for the team

Build the LightTable animation tool first: stylus drawing, pencil, eraser, core path rendering, undo/redo, frame flipping, timeline, onion skin, playback, layers, autosave and reliable print/export. Keep the host in control of canvas, input, document state, history and rendering. Let the coloring team continue independently against the SDK contract. Integrate it later through reviewed APIs. Preserve the extensible architecture, but do not let the plugin system become the product or delay the original rough-animation workflow.
