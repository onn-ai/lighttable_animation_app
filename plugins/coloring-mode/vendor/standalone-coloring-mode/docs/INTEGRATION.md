# Integration Contract

This contract is intended to keep the coloring module attachable to an existing application with minimal changes.

## Host responsibilities

The host application must:

1. Keep outline rendering independent of coloring state.
2. Continue invoking its outline renderer on its existing refresh/frame schedule while Draft mode is active.
3. Honor the color-render gate and skip color draw calls while the relevant layer is disabled.
4. Keep the color buffer's underlying data/resources available if fast restoration is desired.
5. Call `destroy()` or `detach()` when the module is removed.

A host render loop should look conceptually like this:

```js
function renderFrame() {
  if (coloring.isColorRenderingEnabled('base')) renderBaseColor();
  if (coloring.isColorRenderingEnabled('shade')) renderShading();
  renderOutlines(); // always; never gated by Draft mode
  requestAnimationFrame(renderFrame);
}
```

The API can be queried each frame, or the host can store the booleans delivered by `onColorRenderingEnabled` for a minimal hot-path check.

## Core adapter contract

`registerColorLayer(id, adapter, options)` expects:

| Member | Required | Meaning |
|---|---:|---|
| `setVisible(visible)` | Yes | Synchronously include/exclude the surface from visible composition. |
| `setRenderingEnabled(enabled)` | Yes | Synchronously gate expensive color generation/drawing in the host. |
| `dispose()` | No | Restore adapter-owned host state captured at attachment. |

The module calls both required methods when the effective state changes. Effective state is:

```text
effective = !draft && layer.enabled
```

On Draft entry, visibility is disabled before rendering is gated. On Draft exit, rendering is re-enabled before visibility is restored. The adapter methods should be synchronous and should not wait for transitions, promises, or animation frames.

## Minimal integration procedure

1. Identify every independently composited color buffer (base fill, shading, texture, highlights, etc.).
2. Register each buffer with a stable unique ID.
3. Implement `setVisible` to hide/show that surface.
4. Implement `setRenderingEnabled` to update the host's color-render gate.
5. Leave outline code and its scheduler unchanged.
6. Connect the UI switch to `setDraft(Boolean(value))`.
7. On teardown, unregister layers or destroy/detach the module.

## Browser/canvas host adapter

Use `attachBrowserColoringMode` when the color buffers are DOM elements such as `<canvas>` elements. It uses `display: none` plus the `hidden` property for immediate visibility suppression and calls `onColorRenderingEnabled(id, enabled)` so the host can pause/resume expensive color drawing.

```js
const gates = { base: true, shade: true };
const coloring = attachBrowserColoringMode({
  colorLayers: [
    { id: 'base', element: baseCanvas },
    { id: 'shade', element: shadeCanvas },
  ],
  onColorRenderingEnabled(id, enabled) {
    gates[id] = enabled;
  },
});
```

The browser adapter does not register or control the outline canvas. Keep that canvas visible and draw it from the host's normal render loop.

## Other renderer types

For WebGL, OffscreenCanvas, SVG, or a custom compositor, implement the two-method core adapter directly. `setVisible(false)` should remove the color surface/pass from composition; `setRenderingEnabled(false)` should prevent its color-generation pass from running. The outline pass remains owned by the host.

## Detachment and ownership

Each adapter owns restoration of the host state it changes. Implement optional `dispose()` to restore previous DOM styles, compositor state, and scheduler state. The controller calls `dispose()` when a layer is unregistered or when the controller is destroyed. Do not use the same adapter instance for multiple registrations.

## Error behavior

Adapter calls are synchronous. If one or more adapter calls throw during a transition, the controller still attempts the remaining layer operations, emits the resulting state change, and throws an error named `ColoringModeAdapterError` with a `causes` array. Hosts should log/report this error and avoid assuming every surface successfully changed. Adapter methods should be small, predictable, and non-throwing wherever possible.
