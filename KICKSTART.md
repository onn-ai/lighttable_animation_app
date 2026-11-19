# LIGHTTABLE — KICKSTART

**Read this first.** This document onboards a developer who has no previous context about LightTable.

**Audience:** New lead developer, core application developers, technical product owner, QA, and plugin developers  
**Purpose:** Explain the product we are building, the experience it must deliver, the boundaries of the first release, and how to use the rest of this architecture package.  
**Product status:** Pre-implementation architecture; this is a product and engineering starting brief, not a claim that the application is already implemented.

---

## 1. The idea in one minute

**LightTable is a minimalist, digital light table for traditional 2D hand-drawn, frame-by-frame rough animation.** It lets an animator draw directly on a sheet of virtual paper, flip between drawings, see neighboring frames through onion skinning, play the sequence, and export aligned printable sheets.

The product should feel like a focused animation desk—not like a general-purpose illustration package, a complex studio pipeline, or a plugin manager.

Its defining experience is simple:

> Draw a pose. Add the next drawing. See the previous and following drawings faintly. Flip back and forth. Refine the motion. Play it. Print the sheets and continue working on a physical light table if desired.

The original product concept specifically targets a smooth experience on desktop computers and Android devices with an active stylus, including the Huion Note E. Mouse drawing is required for desktop use and development/testing. The app is intended to be an installable, offline-capable Progressive Web App (PWA).

## 2. Who it is for and what problem it solves

### Primary user

A 2D animator, animation student, storyboard/character artist, or hobbyist who wants to rough out movement by drawing successive poses rather than building animation from keyframes, rigs, or complex vector timelines.

### The job the user is hiring LightTable to do

- Open a clean drawing surface quickly.
- Draw naturally with an active pen or a mouse.
- Create and flip through successive drawings without fighting the interface.
- Compare drawings using traditional onion-skin colors.
- Test timing at familiar animation frame rates.
- Keep rough, tie-down, guides/background, and note work organized without a complicated layer system.
- Preserve work locally and export clean sheets for further digital or physical work.

### The product's differentiator

LightTable connects two workflows that should feel like one:

1. **Digital rough animation:** responsive pen input, paper-like canvas, frame flipping, onion skin and playback.
2. **Physical light-table workflow:** printable frame sheets with consistent numbering and registration marks.

The second workflow is not an incidental export feature. It is part of the original product identity.

## 3. What the product should feel like

The interface is inspired by the directness of a traditional animation desk and the restraint of a professional drawing app.

### Visual direction

- Workspace background: matte charcoal `#121212`.
- Paper: warm off-white `#FAF9F6`.
- Graphite/ink: `#1A1A1A`.
- Animator's non-photo blue: `#2563EB` (the original concept also mentioned `#3B82F6`; keep the chosen product token consistent across UI, docs and code before release).
- The paper and drawing should dominate the screen. Tool chrome should be quiet and compact.
- Avoid decorative panels, unnecessary labels, dashboards and persistent modal dialogs.

### Default workspace layout

The initial product experience should follow this layout, adapting it to screen size and orientation:

- **Top-left:** project/gallery actions, save/load or project menu, horizontal canvas flip, onion-skin toggle and settings.
- **Left edge:** vertical brush-size and opacity/flow controls, with a live brush preview and a graphite/blue-pencil toggle.
- **Drawing area:** large, uncluttered paper canvas.
- **Top/right tool dock:** pencil, eraser, and later lasso/transform; layer controls are in a compact popover/panel.
- **Bottom:** a single, easy-to-read horizontal filmstrip with thumbnails, frame numbers, playback, 12/24 FPS, loop, add/duplicate/delete controls.
- **Bottom corners on touch devices:** large previous/next frame controls so the animator can flip drawings with a thumb.

The underlying document model may support multiple timeline tracks, but the first workspace should expose one primary filmstrip by default. Keep advanced multi-track editing out of the way until users need it.

### Interaction principles

- The canvas is the main event. Controls should not obscure drawing space.
- Common actions should be one tap/click away.
- Frame navigation should feel like flipping paper, not operating a video-editing suite.
- Tool and layer popovers should close predictably and not steal drawing focus.
- Mobile controls need comfortable touch targets, safe-area support and sensible portrait/landscape behavior.
- Desktop should support keyboard shortcuts and mouse/trackpad workflows.
- Stylus input must feel immediate; avoid React/UI work on every pen sample.

## 4. The end-to-end experience we are building

This scenario is the simplest useful definition of LightTable Alpha 1. A developer should be able to imagine the finished experience without reading the SDK first.

1. **Launch:** The user opens LightTable in Chrome or launches its installed PWA. They see a calm dark workspace and a clear way to create or open a project.
2. **Create:** They create a project with a default landscape paper canvas. The app is usable without an account and without installing any plugin.
3. **Draw:** They choose the pencil and draw a rough character pose. A pen uses pressure when available; a mouse works with a sensible fixed/default pressure. A live stroke preview follows the input.
4. **Choose pencil:** They switch between graphite and non-photo blue. Brush size and opacity/flow are quick to adjust.
5. **Correct:** They erase part of a drawing. Undo restores it. A completed drawing gesture is one coherent undo step; a cancelled gesture does not leave a partial mark.
6. **Make the next drawing:** They add a blank frame or duplicate the previous drawing. When duplicated independently, edits to the new drawing do not unexpectedly change the old one.
7. **Compare:** The previous drawing appears as a soft red/pink ghost and the next drawing as a soft cyan/blue ghost, with a configurable range of one to three frames in either direction. The active drawing remains clear.
8. **Flip:** They use previous/next controls, arrow keys or the filmstrip to move between drawings. The filmstrip remains understandable and responsive.
9. **Organize:** They use up to four layers in a drawing—for example Rough, Tie-down, BG/Guides and Notes—with visibility, opacity and lock controls.
10. **Test motion:** They play the sequence at 12 or 24 FPS and can loop it.
11. **Return later:** The project autosaves locally. After closing and reopening the app, the user can recover their work.
12. **Take it to paper:** They export a numbered PNG sequence and an A4 landscape PDF with consistent registration marks. Export contains the drawing, not the editor UI, cursor, selection handles, viewport zoom or onion ghosts by default.

If this experience is not possible on a clean installation with no optional plugins, LightTable Alpha 1 is not complete.

## 5. What must be built into LightTable itself

These features are the baseline product, not optional plugin capabilities:

| Core capability | Expected outcome |
|---|---|
| Pencil/brush | User can draw immediately on a new project |
| Active-stylus pressure | Pressure influences stroke width and/or opacity through a documented response |
| Mouse input | Desktop users and developers can draw without a stylus |
| Graphite and non-photo blue | Both traditional rough-animation drawing colors are readily available |
| Eraser | Erases content on the intended active layer |
| Stroke preview | Input feedback appears during the gesture without waiting for commit |
| Core path content and renderer | Drawings persist in the document and render consistently |
| Undo/redo | Drawing and frame operations can be reversed predictably |
| Input lifecycle | Pointer capture, cancellation, lost capture and app suspension are handled safely |
| Frame operations | Add, duplicate, delete, select and navigate frames |
| Filmstrip | Single primary animation track is the default workspace |
| Playback | 12/24 FPS and loop controls work |
| Onion skin | Red/pink previous and cyan/blue following frames, 1–3 each direction |
| Cel layers | Up to four layers with visibility, opacity and lock |
| Project storage | Local autosave, recovery and project import/export |
| Print/export | Numbered PNG sequence and baseline A4 landscape PDF with registration marks |

These are host-owned capabilities. The Default Drawing Tools must be implemented as built-in host code, bundled and enabled by default. They may reuse internal extension interfaces, but must not require plugin installation, activation, network access or the plugin manager to function.

## 6. What LightTable is not in its first release

To protect focus, do not treat every imaginable animation feature as an Alpha 1 requirement.

The initial product is not trying to be:

- A full Procreate replacement or general illustration suite.
- A vector animation, rigging or motion-graphics package.
- A full video editor or compositing studio.
- A node-based effects system.
- A complete cleanup, inking, coloring and production pipeline in one release.
- A marketplace-first plugin platform whose core tools are empty until extensions are installed.
- A pixel-perfect clone of Procreate's interface.

Advanced lasso/transform, sophisticated brush engines, advanced multi-track UI, video/GIF formats, specialized integrations, contact sheets and large third-party plugin ecosystem features can follow the first usable animation workflow.

Do not interpret this list as a prohibition on designing for future growth. It is a limit on what should delay the first product users can actually animate with.

## 7. Architecture in plain language

The architecture package is deliberately more extensible than the initial user interface. That is good, provided the product remains simple.

### The host owns the things that must stay consistent

The LightTable host is responsible for:

- Project/document identity, validation and lifecycle.
- The timeline clock and playback.
- Tracks, exposures, cels and layer containers.
- The main canvas, device-pixel-ratio sizing and viewport transforms.
- Pointer input, stylus routing, pointer capture and navigation gestures.
- Core path nodes and the baseline path renderer.
- Rendering/compositing and export snapshots.
- Central transactions, undo/redo and document revision.
- IndexedDB persistence, autosave, recovery and project interchange.
- Basic onion-skin composition and the baseline filmstrip workspace.
- Baseline PNG/PDF export.

These services must not be reimplemented independently by plugins.

### Plugins add optional specialist capabilities

Plugins can add capabilities such as:

- Coloring Mode: fill/bucket tools, palette, region detection, region masks and coloring-specific data.
- Future specialized brushes or cleanup/inking modes.
- Additional importers/exporters and workflow panels.
- Optional automation and other specialist integrations.

A missing or disabled optional plugin must not prevent the user from opening a project or using the built-in drawing and animation workflow. Unknown plugin data must be preserved, not silently discarded.

### The document model: five useful terms

The data model deliberately separates concepts that a simple frame-array implementation would conflate:

- **Track:** a lane in the animation timeline. The model can support more than one, although the first workspace shows one primary filmstrip.
- **Timeline tick:** one playback time position, often called a frame by the user interface.
- **Exposure:** a time span on a track that refers to a cel. One drawing can be held for multiple ticks.
- **Cel:** the actual drawing content being exposed on the timeline.
- **Cel layer:** an ordered layer inside a cel, such as Rough or Tie-down. This is not the same thing as a timeline track.

Example: a drawing may be exposed for three timeline ticks. The user sees it held for three playback frames without storing three duplicate drawings. If they independently duplicate the cel to make the next pose, edits to the new pose do not change the source pose.

The richer model is a foundation for animation behavior; it does not require a complex timeline UI in the first release.

## 8. How to treat the Coloring Mode side project

The Coloring Mode workstream is valid and should continue. It is a parallel first-party optional plugin project, not wasted effort and not a reason to delay the core application.

The coloring work is useful for validating the plugin SDK against a real use case: plugin registration, custom node types, binary assets, renderer integration, serialization, transactions, project round-tripping and missing-plugin behavior.

Keep the plugin independent and have it use only approved public SDK contracts. When the host implementation reveals a genuine API gap, raise a documented contract-change proposal. Do not silently fork the SDK or reach into private host modules.

Integration may require a small refinement pass. That is normal for a plugin developed in parallel against a pre-implementation contract.

The product rule remains: **LightTable's default pencil, eraser, frame workflow, onion skin, playback, layers, saving and baseline export work even when Coloring Mode is not installed or is disabled.**

## 9. What success looks and feels like

### Product success

A first-time user can understand the workspace without reading a manual. They can create a project, draw, make a few frames, see onion skin, flip between poses, play the sequence and export sheets without configuring a plugin ecosystem.

The app should feel responsive and direct. The interface should not demand attention while drawing. The digital workflow should connect naturally to traditional paper-based animation.

### Engineering success

- The host has a single owner for canvas, input, viewport, rendering, history and persistence.
- Persistent changes are atomic transactions; active stroke previews are transient.
- The same document content renders consistently in editor, thumbnails and exports.
- Export is based on a stable document snapshot, not the mutable live editor state.
- Optional plugin absence does not damage project data.
- Stylus/device claims are supported by measured tests, not assumptions.
- The app can be installed and used offline after its initial successful load/install.

### Alpha 1 release gate

Alpha 1 must demonstrate the end-to-end scenario in Section 4 on a clean installation without optional plugins. Test desktop Chrome and Android Chrome. Test an actual Huion Note E before claiming Huion-specific readiness. Record browser/device versions, observed pressure behavior, pointer cancellation, palm rejection limitations, playback behavior and export results.

A button that exists but does not complete its advertised action does not count as an implemented feature. A feature that has not been tested on its target input/device must be reported as unverified.

## 10. Important decisions to make explicit before coding

The architecture contains some intentionally general concepts. The lead developer must turn the following into written decisions (ADRs or equivalent) before implementing dependent features:

1. **Default workspace:** one primary filmstrip track; additional tracks remain in the document model and can be exposed in an advanced workspace later.
2. **User-facing frame limit:** the first release targets up to 200 user-visible frames. Clarify how this maps to timeline ticks, exposure durations and total animation duration.
3. **Onion-skin scope:** decide whether neighboring drawings are resolved from the active track only or from the fully composited document. Document and test the chosen behavior.
4. **Core path format:** define the built-in path node, normalized coordinate system, stored samples, pressure representation, deterministic rendering and schema versioning.
5. **Drawing gesture commit:** a completed gesture creates one atomic undoable document operation; preview-only samples never mutate the saved document; cancellation never commits a partial stroke.
6. **Physical print scale:** define canvas physical dimensions or an explicit PPI/calibration model. “Fit to A4” must not be called “1:1”.
7. **Export snapshot:** export reads a revision-pinned immutable document snapshot and excludes editor-only state by default.
8. **Plugin v1 execution:** the current architecture README says SDK v1 supports `trusted-ui` only and worker manifests must be rejected until a worker RPC contract exists. Keep types, manifest schema and runtime validation consistent.

Do not hide these decisions in implementation details. Record the decision, alternatives, rationale and effect on compatibility.

## 11. Recommended implementation sequence

The Coloring Mode team may work in parallel. The host should deliver the product experience in this order:

1. **Repository and architecture baseline:** review the package, identify gaps, record decisions and confirm the revised milestone plan.
2. **Document and persistence foundation:** document types, validation, migrations, assets, IndexedDB, autosave/recovery and import/export round-trips.
3. **Transactions and history:** atomic mutations, undo/redo, revisions, locks and memory policy.
4. **Canvas and built-in drawing:** canvas lifecycle, DPR, viewport transforms, host input service, pointer capture/cancellation, core path node/renderer, pencil, colors, eraser and stroke preview.
5. **Traditional animation workflow:** filmstrip, frame operations, playback, onion skin, four cel layers, canvas flip and practical navigation.
6. **Baseline output:** numbered PNG ZIP, A4 landscape PDF and registration marks; define fit-to-page versus calibrated physical scale.
7. **Plugin runtime and coloring integration:** complete the plugin runtime and integrate the parallel Coloring Mode against approved host contracts. Runtime infrastructure may be developed earlier in parallel, but it must not block core-only Alpha progress.
8. **Advanced features:** lasso/transform, richer tracks UI, contact sheets, advanced brush engines and other optional extensions.

The current READ_FIRST.md is the authoritative product-owner direction and sequencing brief. Where older architecture documents still defer core pencil/eraser, onion skin or animation UX to a late plugin stage, update them to match READ_FIRST.md before treating the old order as current.

## 12. How to read the rest of this package

Read the files in this order:

1. **`KICKSTART.md` (this document):** understand the product, target user, desired end result, scope and architecture in plain language.
2. **`READ_FIRST.md`:** understand the product-owner decisions, core-vs-plugin ownership, revised implementation order, required document updates and lead-developer response.
3. **`README.md`:** package navigation, architecture constraints, normative language and test entry points.
4. **`docs/01-architecture-overview.md`:** system boundaries, architecture principles and architectural decisions. Update statements that conflict with READ_FIRST.md.
5. **`docs/02-document-model.md`:** normative project/document/timeline/cel/layer model.
6. **`docs/03-rendering-contracts.md`:** renderer, composition, preview, overlay and export contracts.
7. **`docs/04-plugin-sdk.md` and `docs/05-plugin-runtime-security.md`:** plugin contract, lifecycle, permissions and security limitations.
8. **`docs/06-implementation-plan-and-acceptance.md`:** implementation stages and test requirements. Its old sequencing is superseded where it conflicts with READ_FIRST.md; revise it before implementation sign-off.
9. **`contracts/`, `schemas/`, `examples/` and `tests/`:** machine-readable contracts, sample data and checks. These are important but are not a substitute for understanding the product first.
10. **`PLUGIN_DEVELOPER_WORK_ORDER.md`:** separate assignment for the Coloring Mode plugin team. It is not the main host implementation brief.

### Which source wins if two documents disagree?

Use this precedence:

1. **KICKSTART.md:** describes the intended product and user outcome.
2. **READ_FIRST.md:** contains explicit product-owner decisions and delivery direction. It wins over older sequencing or feature-ownership statements in the architecture documents.
3. **Normative architecture documents and approved ADRs:** define how the agreed product is implemented. Where they conflict with the first two documents, raise and resolve the conflict; do not silently pick one.
4. **TypeScript contracts and JSON schemas:** define the current machine-readable contract, but must be updated through a reviewed change when the approved design requires it.
5. **Examples and work orders:** illustrate or assign work; they do not override product requirements or normative contracts.

If the lead developer believes a product requirement creates a technical problem, raise it explicitly with options, cost, risks and user impact. Do not quietly remove or defer it.

## 13. First assignment for a new lead developer

Before writing application code, return a concise **Host Kickoff Plan** containing:

1. A one-paragraph restatement of LightTable's user and end result, in your own words.
2. Confirmation that built-in drawing tools, onion skin, animation workflow, local persistence and baseline print/export are core release capabilities.
3. A repository plan that distinguishes the host application, public SDK contract, and Coloring Mode plugin repository/package.
4. A document-by-document gap list for the architecture changes required by `READ_FIRST.md`.
5. The proposed module/component/service boundaries for the host (document, transactions/history, input, viewport, renderer, timeline/playback, storage, export, workspace UI).
6. The ADRs needed for the eight decisions in Section 10, with owners and decision dates.
7. A revised milestone plan with demonstrable exit gates, not just code-completion labels.
8. A test plan for desktop mouse, Android touch, active pen and physical Huion Note E, including which behaviors cannot be verified until hardware is available.
9. A dependency/integration note for the Coloring Mode side project, including requested SDK changes and compatibility strategy.
10. Risks, unresolved questions and proposed deviations, each with rationale and product impact.

Do not start by building a plugin marketplace, a complex multi-track timeline UI, or a coloring engine. Start by making the built-in drawing and frame-by-frame animation loop real.

---

## The one thing to remember

**LightTable is the drawing-and-flipping animation tool first; its extensibility is the foundation that lets it grow.**

If a new user can draw, make frames, compare them with onion skin, play the motion, save the project and print aligned sheets on a clean installation, the team is building the right product. Everything else should support that outcome—not compete with it.
