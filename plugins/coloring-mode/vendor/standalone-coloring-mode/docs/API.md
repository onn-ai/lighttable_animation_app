# API Reference

## `new ColoringModeController(options?)`

Creates the framework-independent controller.

Options:

- `draft?: boolean` — initial Draft state; defaults to `false`.
- `onChange?(snapshot, event)` — callback on controller state changes.
- `onError?(error, event)` — handles exceptions thrown by change listeners. If omitted, listener errors are re-thrown in a microtask.

### `registerColorLayer(id, adapter, options?)`

Registers one color buffer. `id` must be a non-empty unique string. Adapter methods `setVisible(boolean)` and `setRenderingEnabled(boolean)` are required. `dispose()` is optional. `options.enabled` defaults to `true`.

Returns an idempotent `unregister()` function.

### `setDraft(enabled)`

Synchronously activates/deactivates Draft mode. Returns an immutable state snapshot.

### `setLayerEnabled(id, enabled)`

Enables/disables one color buffer independently of Draft mode. Returns an immutable state snapshot.

### `isColorRenderingEnabled(id)`

Returns whether the layer should currently render. The host should use this as its drawing gate if it does not store the adapter callback state.

### `getLayerState(id)`

Returns `{ enabled, visible, renderingEnabled }` for one layer. `visible` and `renderingEnabled` reflect effective state (`!draft && enabled`).

### `getSnapshot()`

Returns a frozen snapshot:

```js
{
  draft: false,
  layers: {
    base: { enabled: true, visible: true, renderingEnabled: true }
  }
}
```

### `subscribe(listener)`

Subscribes to state changes. Listener receives `(snapshot, event)`. Event is `{ reason, snapshot }`. Returns an unsubscribe function.

### `destroy()`

Detaches all registered adapters by calling their optional `dispose()` method, clears subscriptions, and permanently destroys the controller. Subsequent mutating/query methods that require a live controller throw.

## Browser adapter

Import from `standalone-coloring-mode/browser`:

```js
attachBrowserColoringMode({
  colorLayers: [{ id, element, enabled? }],
  draft?,
  onChange?,
  onError?,
  onColorRenderingEnabled?(id, enabled),
})
```

Returns an object with `controller`, `setDraft`, `setLayerEnabled`, `isColorRenderingEnabled`, `getLayerState`, `getSnapshot`, `subscribe`, `detach`, and read-only `detached`.

Import `createDomCanvasLayerAdapter(element, options?)` from `standalone-coloring-mode/dom` when building a custom browser integration.
