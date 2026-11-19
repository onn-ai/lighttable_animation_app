# 3. Rendering Architecture and Contracts

## 3.1 Objectives

The rendering system must provide one authoritative render path for editor display, onion-skin composition, thumbnails, print/PNG export and future plugin renderers.

The host owns the canvas element, canvas sizing, device-pixel-ratio scaling, viewport transform, clipping, render scheduling and final composition. Plugins contribute content renderers and overlays through registration APIs.

A plugin must not create a competing document canvas, alter the canvas size, own the render loop or modify the document during rendering.

## 3.2 Render domains

Keep these domains separate:

1. **Document rendering:** Produces pixels from the project at a specified timeline tick. It uses document coordinates and no editor UI state.
2. **Viewport rendering:** Displays document output in the editor, applying pan, zoom, canvas flip and DPR.
3. **Editor overlays:** Selection outlines, lasso previews, handles, guides, brush cursor and plugin HUD. These are not document pixels.
4. **Transient interaction previews:** In-progress tool feedback that is not yet committed to the document.
5. **Export rendering:** A deterministic document render at explicit output dimensions. It excludes viewport transforms and editor-only elements.

Do not mix these concerns into a single renderer that branches on CSS layout or current React component state.

## 3.3 Coordinate spaces

The host exposes the following named coordinate spaces:

- `document`: canonical project units, origin top-left.
- `node-local`: coordinates stored in a content node before its affine transform.
- `viewport`: logical CSS-pixel coordinates in the visible workspace.
- `device`: physical backing-store pixels after DPR scaling.

Pointer events passed to a tool include both the original viewport position and the resolved document-space position. Drawing tools should normally use `document` coordinates only.

The host applies the following transform order:

`node-local -> node transform -> document clip -> viewport transform -> DPR backing-store scale`.

For export, the host applies:

`node-local -> node transform -> document clip -> export scale/translation`.

Viewport pan/zoom/flip MUST NOT leak into export geometry.

## 3.4 Render pipeline order

At tick `t`, the document renderer performs the following logical stages:

1. Initialize an isolated document render target and clear it.
2. Paint the document background if the requested output profile requires one.
3. Resolve each track's exposure at tick `t`, bottom-to-top.
4. For each resolved cel, render its visible layers bottom-to-top.
5. For each visible layer, render its nodes back-to-front, applying each node's affine transform.
6. Composite each layer using layer opacity/blend mode.
7. Composite the track using track opacity/blend mode.
8. Return the document image to the viewport or export caller.

Basic onion skin is a host-owned editor-only composition stage behind the active drawing. The product default resolves neighbors on the active filmstrip track only, excluding the active tick and repeated references to the same cel. Previous drawings are tinted soft red/pink and following drawings soft cyan/blue; each direction supports one to three neighbors and independent opacity. Onion skin MUST NOT be included in a normal export unless an export option explicitly requests it.

Plugin overlays and tool previews are composed in separate editor-only passes and never included in a standard project frame render.

## 3.5 Node renderer contract

The host registers the `core.path` renderer and the built-in drawing tools use it without plugin installation. A plugin may additionally register namespaced node renderers.


A plugin registers a renderer for a node `type` and supported `typeVersion` range. The host calls the renderer when it encounters that node type.

Conceptual interface:

```ts
interface NodeRenderer<TData = unknown> {
  type: string;
  supportedVersions: { min: number; max: number };
  validate?(data: unknown): data is TData;
  getLocalBounds?(data: TData): Rect | null;
  render(data: TData, context: NodeRenderContext): void;
  migrate?(data: unknown, fromVersion: number, toVersion: number): unknown;
}
```

Requirements:

- `render()` is synchronous.
- `render()` is deterministic for identical payload, render context and renderer version.
- `render()` is read-only and MUST NOT commit document mutations, alter plugin persistent state, perform network I/O or wait for asynchronous work.
- The host applies the node transform; the renderer draws in node-local coordinates.
- The host clips to document bounds.
- The host wraps renderer invocation with canvas `save()`/`restore()` so renderer state does not leak. Plugin authors must still use balanced state changes internally.
- A renderer must not resize the render target, change the host viewport or access UI DOM.
- A renderer should use `getLocalBounds()` for culling, hit-test acceleration and dirty-region calculation. Returning `null` means bounds are unknown; the host may render conservatively. A renderer may also expose `hitTest(data, query)` for precise point/rectangle/polygon selection. The host transforms the query into node-local coordinates before calling it. If a node type has no precise hit-test provider, the host may fall back to its bounds and should make that coarse selection behavior consistent and documented.
- The host validates payloads before passing them to a renderer. Plugin validation is still required for plugin-owned schemas.
- Renderer exceptions are caught at the plugin boundary, reported with plugin/node identifiers and converted to an error placeholder in editor mode. Export must fail or require explicit lossy-export confirmation if required content failed to render.

Renderers should avoid depending on non-deterministic browser state, current time, random values or external resources not embedded in the project. If randomness is intrinsic to a brush texture, its seed must be stored in node payload.

## 3.6 Render context

A renderer receives a deliberately small context. Exact type definitions are in `contracts/plugin-api.d.ts`.

Required properties:

- `ctx`: Canvas 2D context whose current coordinate space is node-local.
- `intent`: `editor`, `thumbnail`, `export` or `onion`.
- `document`: read-only dimensions and color-space descriptor.
- `tick`: timeline tick being rendered.
- `frameRate`: rational frame rate.
- `pixelRatio`: output target scale for cache decisions only; geometry remains in logical units.

Render callbacks must not use `ctx.canvas.width` or CSS width as a source of document dimensions. Use `document.width/height`.

## 3.7 Layer and track compositing

Core v1 supports `normal` compositing using standard source-over alpha composition, plus the baseline path's destination-out behavior within its own layer surface where implemented. A plugin may register additional blend/composite modes only through a future explicit blend-mode extension contract.

Layer opacity is applied after its nodes are rendered to an isolated layer surface. Track opacity is applied after its resolved cel is composited. Do not apply opacity independently to every node when that would change overlap behavior.

Unknown blend modes are retained in the document. If unsupported, render using `normal` and expose a compatibility warning. A plugin that registers the missing blend mode may restore correct rendering.

## 3.8 Overlays and tool previews

Overlays are not content nodes. They are ephemeral UI feedback.

A plugin may register an overlay renderer with:

- a named z-order slot (`under-document`, `over-document`, `screen-ui`);
- editor-only render callback;
- invalidation keys/regions;
- activation conditions;
- optional pointer/selection context.

For `under-document` and `over-document`, the context coordinate space is document space; for `screen-ui`, it is viewport space. Examples: selection outline, lasso marquee, transform handles, guides, pivot point, brush cursor, safe-frame overlay.

The host must make it impossible for a normal export call to accidentally include editor overlays. Do not rely on each plugin to remember to hide its handles; the export pipeline must not invoke editor overlay registrations.

Transient tool previews should be rendered through the preview/overlay service. `ToolGesture.updatePreview()` supplies an overlay callback in document space above the active document content. Updating the preview invalidates the relevant canvas region. On pointer-up, the tool commits canonical node data through a transaction and removes the preview. On pointer-cancel, lost capture or application interruption, the host cancels the preview and releases resources without creating a document edit.

## 3.9 Input/render interaction

The host Input Service owns Pointer Events listeners, pointer capture, touch policy, cancellation and conversion to document coordinates.

Tool plugins receive normalized samples containing:

- pointer ID and pointer type (`pen`, `mouse`, `touch`);
- viewport and document coordinates;
- pressure normalized to `[0,1]`;
- tilt/twist when available;
- buttons/modifiers;
- timestamp;
- coalesced samples where supported;
- cancellation/lifecycle state.

The input service handles `pointercancel`, `lostpointercapture`, window/app backgrounding and device changes. Plugins must implement a cancellation handler and must not assume every pointer-down receives pointer-up.

Navigation gestures are owned by the host and are kept separate from document drawing. The host decides whether two-finger pan/pinch, Space+drag, wheel zoom or stylus input is navigation or drawing. Plugins cannot redefine global palm/touch policy.

## 3.10 High-DPI and low-latency display

- Backing-store dimensions are computed from CSS size × `devicePixelRatio`.
- Document coordinates remain invariant under DPR changes.
- Pointer-to-document mapping must invert the same viewport transform used for display.
- The host should redraw only when invalidated and avoid React renders in high-frequency pointer loops.
- In-progress stroke previews should use a low-latency path separate from committed document replay.
- `getCoalescedEvents()` should be consumed by the input service when available, preserving original sample timing/order.
- A renderer must not assume the display surface has a 1:1 mapping to document units.

## 3.11 Asynchronous preparation and caching

The render callback is synchronous. Expensive work is prepared outside it. A node renderer may expose an asynchronous `prepare()` hook; the host awaits preparation before entering the synchronous render pass and passes an abort signal to preparation. `prepare()` must not mutate the document:

- decode raster assets;
- tessellate or flatten complex paths;
- calculate flood-fill regions;
- generate brush texture tiles;
- build thumbnail caches;
- compute plugin-specific render caches.

A plugin MAY use a Worker/OffscreenCanvas for this preparation and return an `ImageBitmap`, typed array or serializable result. The result must be versioned against the source document revision/node hash; stale results must be discarded. The host awaits `NodeRenderer.prepare()` for visible nodes before a frame render/export, then calls the synchronous `render()` method.

The host provides cache invalidation hooks. Cache keys must include all rendering-relevant inputs (node data/version, render target scale where relevant, renderer version and color profile). Caches are disposable and must not be the only copy of project data.

## 3.12 Render intent and export rules

Every render invocation declares an intent:

- `editor`: normal active document view, excluding separately composed selection/tool overlays unless explicitly part of an editor preview.
- `thumbnail`: small deterministic composited representation of a tick/cel.
- `export`: document-only render at requested output geometry.
- `onion`: neighboring tick render for editor onion-skin composition.

Standard export MUST:

- render every requested timeline tick, including repeated held exposures;
- use document geometry, not viewport geometry;
- exclude selection handles, lasso paths, cursor, guides and workspace panels;
- exclude viewport flip/pan/zoom;
- exclude onion skins by default;
- use an explicit background policy (opaque paper or transparent);
- report missing node renderers or render failures;
- use the same node rendering implementations as editor output.

## 3.13 Export/render service contract

The host should expose an export-neutral frame iterator rather than leaking its canvas component. It should also expose `renderCel(celId, { layerIds, ... })` so plugins can obtain a deterministic render of one cel or a selected subset of its layers. This is required for workflows such as coloring/region detection, which need to analyze line art without taking ownership of the main canvas.

```ts
interface FrameRenderRequest {
  ticks: number[] | { start: number; endExclusive: number };
  width?: number;
  height?: number;
  background: "document" | "white" | "transparent";
  intent: "export" | "thumbnail";
}

interface RenderedFrame {
  tick: number;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  documentRevision: number;
  warnings: RenderDiagnostic[];
}
```

The host must document bitmap ownership and disposal (`ImageBitmap.close()` where applicable). The caller that consumes a returned `ImageBitmap` is responsible for closing it when no longer needed. Long export operations should support progress, cancellation and snapshot consistency. Export plugins should consume this API rather than query the active canvas DOM node.

## 3.14 Plugin-scoped renderer gates

A plugin may register a disposable `NodeRenderGate` only for a node type that the same plugin owns and has registered. The gate exposes synchronous `setVisible(boolean)` and `setRenderingEnabled(boolean)` operations. Before scheduling preparation and again before rendering, the coordinator MUST consult the gate for every render intent (`editor`, `thumbnail`, `export`, `onion`). If either flag is false, nodes of that type are skipped and their `prepare()` work is not invoked. The gate affects only that node family; it MUST NOT change host core renderers, unrelated plugin types, the main render scheduler or outline rendering. Disposal restores the default enabled/visible policy and releases the gate reference. A gate change does not mutate the document or create history.

Renderer preparation receives `AssetReadApi`, not the write-capable asset API. Asset writes occur in tool/command workflows and must be completed before a transaction references the asset.

## 3.15 Revision-pinned export snapshots

An exporter receives an immutable, read-only document query snapshot pinned to one revision and a render service bound to that same snapshot. It must not receive `DocumentApi.transact()` or observe later live edits midway through an export. The host either completes from the pinned snapshot or aborts with a revision/snapshot diagnostic; it must never mix frames from different revisions.

## 3.16 Failure behavior

- A broken node renderer must not corrupt canvas state for subsequent renderers.
- The host logs plugin ID, renderer type, node ID, project ID and render intent.
- Editor mode may display a diagnostic placeholder.
- Export mode must not silently generate an incomplete file when required visual content is missing.
- A plugin render failure should disable/quarantine the failing renderer after repeated errors, not crash unrelated document services.
- Missing renderer status must be visible in project diagnostics.

## 3.17 Rendering conformance tests

At minimum:

1. Render the same snapshot twice and compare deterministic pixel output within a defined tolerance.
2. Resize CSS canvas and change DPR; document-space geometry remains unchanged.
3. Apply viewport flip/zoom; exported pixels remain unchanged.
4. Verify node transform is applied exactly once.
5. Verify layer and track order/opacity.
6. Verify hidden layers/tracks are omitted from visible render but retained in project data.
7. Verify onion intent does not leak into export.
8. Verify editor overlays are never invoked by standard export.
9. Verify renderer exceptions do not leak Canvas state.
10. Verify missing renderer produces a diagnostic and prevents silent lossy export.
11. Verify plugin async cache created for an old revision is ignored after document edits.
12. Verify long frame sequences render from one stable document revision.
13. Verify a disabled node render gate prevents both preparation and render for every intent.
14. Verify disposing a gate restores default behavior without affecting unrelated renderers.
15. Verify exporter document queries and render output are pinned to the same immutable revision.
