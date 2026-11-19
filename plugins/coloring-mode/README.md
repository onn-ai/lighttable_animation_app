# LightTable Coloring Mode

**Plugin ID:** `com.lighttable.coloring`  
**Plugin version:** `1.0.0`  
**Plugin API:** `^1.0.0`  
**Host range:** `>=1.0.0 <2.0.0`

A non-destructive coloring workspace for LightTable. The plugin owns the palette, paint-bucket and color-picker tools, flood-fill/gap-bridging algorithms, persistent coloring-region node payload, region asset format, region renderer, Coloring Mode UI, and Draft / Outlines Only bridge. Host application infrastructure is accessed only through `@lighttable/plugin-sdk`.

## Workspace features

- **Coloring mode:** registers the palette and options panels and exposes the two coloring tools.
- **Palette:** add, select, rename, recolor, and delete swatches. The selected swatch and palette are stored in plugin-local preferences.
- **Paint bucket:** samples only explicitly selected visible source/line-art layers, uses normalized document coordinates, applies tolerance and gap-closing options, and inserts one undoable region node through a host `ToolGesture` transaction. A missing/locked edit target is rejected.
- **Color picker:** samples the rendered current cel and adds/selects the sampled sRGB color in the palette.
- **Coloring options:** source-layer selection, tolerance (0–255), short line-gap bridging (0–8 px), region opacity, coloring-region visibility, and Draft / Outlines Only.
- **Persistent region:** a `com.lighttable.coloring.region` v1 node references a binary, one-byte-per-pixel alpha mask stored through `AssetApi.put()`. Pixel data is not embedded as base64 in the project node.
- **Node renderer:** prepares/cache colorized mask surfaces asynchronously and paints them synchronously for editor, thumbnail, and export intents. The host remains responsible for applying the node transform and compositing.
- **Worker acceleration:** flood fill uses a module Worker when supported. It falls back to the same deterministic algorithm on the main thread when Worker is unavailable or worker startup/runtime fails. Cancellation aborts the pending work; returned/rendered `ImageBitmap` resources are closed.
- **Draft controller:** the exact supplied `standalone-coloring-mode` 1.0.0 module is vendored under `vendor/standalone-coloring-mode` and imported by the bridge. Its controller is not reimplemented or modified.

## Install package

Build the package with:

```sh
npm run build
npm run package
```

The installable archive is `plugin-package.zip`. It contains `manifest.json`, the compiled `dist/` ESM modules (including the worker module), the pinned standalone controller module, and integration documentation. The current LightTable alpha bundles this first-party plugin with the host and exposes an explicit Enable/Disable control in the Layers dock. A general third-party ZIP installer/plugin manager is not included in this alpha; the package script produces the installable archive for a future manager or external host. React and `@lighttable/plugin-sdk` are peer/external dependencies and must resolve to the host's single React and SDK runtime instances; do not bundle a second React or SDK runtime into the plugin.

The TypeScript build is intentionally kept separate from host implementation source. The local `vendor/lighttable-plugin-sdk-contract` package contains declarations used only to compile and test against the supplied architecture SDK contract; it is not a runtime SDK implementation. The host must provide its published `@lighttable/plugin-sdk` package when loading the plugin.

## Development and tests

Requirements: Node.js 18+, TypeScript compiler (`tsc`) on `PATH`, and Python `jsonschema`/`referencing` for the upstream architecture schema checks.

```sh
npm test
npm run test:module
python /path/to/lighttable-architecture/tests/validate-schemas.py
npm run package
```

- `npm test` compiles the TypeScript and runs algorithm plus mock-host integration tests.
- `npm run test:module` runs the supplied standalone controller's own test suite.
- The architecture schema suite verifies the foundation's example manifests/documents and rejection cases. The plugin's own `manifest.json` is separately checked against the same `plugin-manifest.schema.json` before packaging.

The host integration is implemented in this repository and the plugin mock-host suite passes. The root React/Vite application has not yet been exercised in a real browser build in this environment, and no Huion Note E or Android stylus hardware has been physically tested. See the top-level implementation report for the explicit release boundary.

## Region algorithm and persistence format

The source cel is rendered via `RenderServiceApi.renderCel()` with a transparent background and the selected source layer IDs. Opaque dark pixels are treated as line-art barriers. The seed pixel defines the color/alpha comparison reference; four-connected flood fill admits pixels within the configured per-channel tolerance. `gapClose` bridges only short, enclosed horizontal or vertical breaks in the barrier mask before the flood fill; it is not general morphological dilation or contour reconstruction.

The resulting mask has exactly `maskWidth * maskHeight` bytes; zero means outside and 255 means inside. The blob MIME type is `application/x-lighttable-alpha-mask`. The node stores the asset ID, dimensions, fill color, opacity, seed, selected source layer IDs, algorithm version, tolerance, and gap-close radius. The host asset service owns storage, hash/descriptor metadata, and project asset packaging.

## Host responsibilities and integration notes

The host must provide the documented SDK v1 contracts for plugin lifecycle/registries, document snapshots and transactions, tool gestures, renderCel, assets, storage, panels, and node renderer orchestration. In particular:

1. Register `com.lighttable.coloring.region` as a supported custom node type and preserve unknown plugin node data/assets if the plugin is disabled or unavailable.
2. Invoke the registered renderer's `prepare()` before `render()` for editor, thumbnail, and export paths; report renderer prepare/render failures as diagnostics so missing or corrupt mask assets cannot silently produce incomplete output.
3. Apply node transforms once outside the plugin renderer and composite the prepared surface in the host-owned render pipeline.
4. Ensure each tool gesture commit is one atomic, revision-checked undoable transaction, enforce target/track/layer locks, and cancel gestures on project close, mode change, lost pointer capture, plugin disable, and app suspension.
5. Resolve React and the SDK as host externals, stage registrations during activation, and roll them back on activation failure.
6. Keep the outline renderer and its scheduling independent of the plugin's coloring region renderer.

### Host render-gate integration

The host SDK contract now includes `renderers.registerNodeRenderGate(nodeType, gate)`. The host validates that the registering plugin owns the renderer and checks the gate before both `prepare()` and `render()` for editor, thumbnail, onion and export intents. The gate is scoped to the plugin's node type and cannot suppress the host's core path/outline renderer or another plugin's nodes. The plugin keeps its renderer-local visibility fallback for standalone/controller compatibility. See [API_CHANGE_REQUEST.md](API_CHANGE_REQUEST.md) for the original request and [INTEGRATION_REPORT.md](INTEGRATION_REPORT.md) for host-side test status.

## Scope and limitations

This version implements solid-color region fills, color picking, palette management, tolerance, limited gap bridging, region opacity, and Draft / Outlines Only. It does not implement a freehand brush, gradients, texture/pattern fills, multi-frame propagation, advanced contour reconstruction, anti-aliased soft masks, or region re-edit/recompute UI. The mask is binary (0/255); edge anti-aliasing and richer selection behavior can be added in a later node/algorithm version while preserving v1 projects.

This package is a plugin implementation against the supplied SDK contract, not the LightTable host application. It has not been validated in a production LightTable binary or on physical hardware.
