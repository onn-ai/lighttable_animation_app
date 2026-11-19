# LightTable implementation report

**Delivery classification:** functional alpha source handoff; not production-certified  
**Report date:** 2026-11-19  
**Product/contract basis:** `KICKSTART.md`, `READ_FIRST.md`, architecture and contract documents in `docs/`, schemas and the supplied Coloring Mode package.

## 1. What was delivered

The supplied archive was an architecture, contract, schema, example and optional-plugin handoff. It did not contain a pre-existing React host application. A new host implementation was created in this repository, preserving the supplied documents and updating the implementation plan and integration notes where the product-owner decisions supersede older architecture language.

The delivered application source is a React 19 / TypeScript / Vite modular monolith. Its primary workspace includes a paper canvas, built-in drawing tools, filmstrip timeline, cel-layer controls, playback, project lifecycle and optional Coloring Mode controls. A Progressive Web App shell and offline app-shell service worker are included.

### Core capabilities implemented

- Canonical project/document model, structural and semantic validation, default project creation, and preservation of unknown plugin node/extension data.
- Revisioned atomic transactions, expected-revision checks, undo/redo and bounded history.
- Pointer Events input routing, pointer capture, coalesced samples, cancellation, viewport mapping and horizontal view flip.
- Host-owned path rendering; pressure-aware pencil input; graphite and non-photo-blue presets; eraser and transient stroke preview.
- Single-track user-facing filmstrip backed by tracks, exposure clips and cels; blank, duplicate and delete frame operations; playback at 12/24 FPS; four cel layers with visibility, opacity and lock controls.
- Host-owned onion-skin neighbor resolution for previous/following distinct cels.
- IndexedDB project/asset persistence with an in-memory fallback, autosave coalescing, local recovery and a visible warning when persistent browser storage is unavailable.
- `.ltproj` ZIP package read/write with bounded decompression, path checks, integrity verification and opaque plugin data preservation.
- Numbered PNG-sequence ZIP and multi-page A4 landscape PDF export with frame numbering and registration marks; optional Acme peg-bar marks.
- Stable export snapshots with a pinned document revision.

### Optional Coloring Mode integration

Coloring Mode remains optional and can be explicitly enabled or disabled from the host. Its public-SDK integrations include its mode/workspace contributions, paint-bucket and color-picker tools, palette/options panels, Draft command, region-node renderer, plugin-local preferences and content-addressed mask assets. Its host renderer gate is registered through `registerNodeRenderGate()` and suppresses the specified node family before both `prepare()` and `render()` for editor, thumbnail and export render intents. Plugin contributions are disposed on deactivation; project data is not stripped merely because the plugin is disabled or unavailable.

The plugin's originally supplied integration report described mock-host testing only. The appended lead implementation update now records the host-side work and current tests. This does not constitute browser/device integration certification.

## 2. Contracts and versioning

- **Project model/schema:** v1 (`1.0.0` schema contract). The current implementation validates the v1 model and preserves unknown plugin-owned content. A general multi-version migration framework is not implemented yet.
- **Plugin SDK:** `@lighttable/plugin-sdk`, API v1 (`^1.0.0` compatibility range in the Coloring Mode package/manifest).
- **Runtime profile:** trusted in-process UI plugin only. Worker execution is rejected for SDK v1; sandboxed/isolated third-party plugin execution is not provided.
- **Export contract:** exporters work from a revision-pinned snapshot; render preparation receives the restricted/read-only asset surface specified by the SDK.
- **History contract:** committed user gestures are one transaction; cancelled preview gestures do not commit project changes.
- **Extension scopes:** modeled as a discriminated union with scope-specific identifiers.
- **Onion skin:** active-track, chronological, distinct-cel neighbor resolution is covered by host tests.

## 3. Validation performed

The following commands were run successfully from the repository root:

```sh
tsc -p tsconfig.core.json --pretty false
tsc -p tsconfig.hostcheck.json --pretty false
tsc -p tsconfig.test.json --pretty false
node tests/run-host-tests.mjs
node plugins/coloring-mode/scripts/build.mjs
node plugins/coloring-mode/scripts/test-setup.mjs
node --test plugins/coloring-mode/tests/**/*.test.mjs
node --test plugins/coloring-mode/vendor/standalone-coloring-mode/tests/*.test.js
python3 tests/validate-schemas.py
```

| Verification | Result |
|---|---:|
| Core TypeScript compilation | PASS |
| Host TypeScript compile against local UI shim | PASS |
| Test TypeScript compilation | PASS |
| Host runtime regression checks | 13 / 13 PASS |
| Coloring Mode algorithm + integration tests | 21 / 21 PASS |
| Supplied standalone Coloring Mode controller tests | 12 / 12 PASS |
| JSON Schema/example acceptance and rejection checks | PASS |
| Coloring Mode build script | PASS |

Host runtime coverage includes malformed-project validation, atomic history, frame operations, cel-layer invariants, onion neighbors, render-gate timing, pointer capture/coalesced events/cancellation, ZIP path and CRC checks, project package round-trips, PNG/PDF structure, SDK capability boundaries and autosave revision coalescing.

The host UI compile uses `tsconfig.hostcheck.json` and a local React declaration shim because dependencies could not be installed in this execution environment. It is not equivalent to a successful full strict compile against installed React/Vite type packages.

## 4. Build and test environment limitations

- **Windows TypeScript launcher fix:** `plugins/coloring-mode/scripts/build.mjs` now resolves `typescript/bin/tsc` from the root project and invokes it with `process.execPath`. This avoids the Windows `.cmd` shim failure (`spawnSync tsc ENOENT`) and uses file-URL conversion for Windows-safe paths. The corrected build script and the 21 Coloring Mode tests pass in the available Node environment.
- The root React/Vite dependency tree was not available. `npm install` could not complete against the package registry, and the offline install failed because required packages were not cached. As a result, **`vite build`, `npm run dev` and a full dependency-backed root typecheck were not run**.
- No automated real-browser end-to-end suite was run.
- No physical Android stylus or Huion Note E hardware was available for input, palm-rejection or latency verification.
- PDF export currently offers Fit to A4. Calibrated 1:1 physical-size printing is not claimed.
- No performance measurements against agreed desktop/mobile reference devices have been recorded.

## 5. Known incomplete work / release blockers

1. **General plugin ZIP installer:** the host includes the optional Coloring Mode bundle and can enable/disable it, but a generic local ZIP install/update/uninstall workflow for arbitrary third-party plugins is not complete.
2. **Production security isolation:** SDK v1 supports trusted in-process plugin code. It does not sandbox untrusted third-party code; only trusted packages should be loaded.
3. **Schema migration framework:** v1 validation and preservation are implemented; automated migration between arbitrary project schema versions is not complete.
4. **Advanced editor tools:** lasso, transform/move/rotate/scale, advanced brushes and specialist importers are deferred.
5. **Advanced timeline:** the user-facing editor is single-track; advanced multi-track editing UI is deferred even though the underlying document model distinguishes tracks, clips and cels.
6. **Browser/device acceptance:** Chrome desktop/Android and Huion Note E verification remain outstanding.
7. **Calibrated print:** physical dimensions and printer calibration are not yet enforced for true 1:1 output.
8. **Dependency-backed release build:** install dependencies and run the full Vite build, strict typecheck and browser/E2E suite in CI before production release.

## 6. Commands for a machine with dependencies installed

Install the pinned npm dependencies and Python schema-test requirements, then run:

```sh
npm install
python3 -m pip install -r tests/requirements.txt
npm run check
npm run build
npm run dev
```

`npm run check` runs the local core/host compile checks and all current host, plugin, controller and schema tests. `npm run build` additionally performs the strict root project typecheck and Vite production bundle; these final steps are intentionally not marked as passed in this handoff.

## 7. Release recommendation

Treat this repository as an implementation-complete **functional alpha**, not a production-certified release. Before production, complete the release blockers above, especially the real dependency-backed Vite build, browser/device acceptance, plugin installation/security boundary and schema migration strategy. No hardware-specific behavior or production security certification is asserted by this report.
