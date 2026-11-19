# Host API change request: coloring render-pass gate

**Requested by:** `com.lighttable.coloring` 1.0.0  
**Current contract:** `@lighttable/plugin-sdk` 1.0.0-architecture.1  
**Priority:** Required for full Draft-mode render-pass suppression; the plugin has a renderer-local fallback today.

## Current behavior and limitation

The supplied `standalone-coloring-mode` controller drives each color surface through two synchronous adapter methods: `setVisible(boolean)` and `setRenderingEnabled(boolean)`. The Coloring Mode plugin maps these to independent renderer-local flags. Its region node renderer checks both flags at the start of `render()` and produces no color output while hidden or gated off. The host outline renderer is not registered, mutated, or rescheduled by this plugin.

SDK v1 exposes `api.renderers.registerNode(renderer)` and an async node `prepare()` plus sync `render()`, but it exposes no public way for a plugin to tell the render coordinator that a registered node family is currently suppressed. The host may still enumerate the nodes, invoke `prepare()`, and call the renderer, even though its `render()` becomes a no-op. That does not provide a true skip of the coloring pass or its preparation cost.

## Requested public extension

Add a disposable, plugin-scoped renderer gate to the public SDK. The exact names can follow the host's conventions; the required contract is equivalent to:

```ts
interface NodeRenderGate {
  setVisible(visible: boolean): void;
  setRenderingEnabled(enabled: boolean): void;
}

interface NodeRendererRegistry {
  registerNode<TData extends JsonValue>(renderer: NodeRenderer<TData>): Disposable;
  registerNodeRenderGate(
    nodeType: string,
    gate: NodeRenderGate,
  ): Disposable;
}
```

The host render coordinator must synchronously consult the gate before node preparation and before rendering for every intent (editor, thumbnail, export, and any future document render intent). When either flag is false, it must omit the gated node family from that coloring pass and skip its preparation work. Re-enabling rendering must make prepared resources eligible again without requiring a new document transaction. This gate must not affect unrelated node types, host line-art/outline rendering, or other plugins.

The host may choose a more general registered render-surface API if it provides these semantics and ties the registration's lifetime to the owning plugin. It must remain a public SDK interface; plugin code must not reach into a private compositor, scheduler, canvas, or React store.

## Required host tests

1. Visibility false suppresses the plugin node family in editor, thumbnail, and export intents.
2. Rendering enabled false independently suppresses the same family.
3. Draft entry performs hide before gate-off; Draft exit performs gate-on before show, with no intermediate color flash.
4. Suppression leaves the outline path and its scheduling unchanged.
5. Suppressed nodes are not prepared or rendered; unrelated node types still are.
6. Disposing the gate restores the host's default policy and removes its callback/registry reference.
7. Rapid Draft toggles are synchronous, deterministic, and do not schedule a new animation loop or impose a fixed frame rate.

## Current plugin fallback

Until this extension exists, the plugin uses renderer-local flags. This prevents region color output synchronously and does not reimplement host rendering infrastructure, but it cannot prevent the host from invoking the plugin renderer or preparing its assets while Draft is active.

---

## Implementation status — 2026-11-19

**Status: implemented in the LightTable host source.** The public SDK declares `registerNodeRenderGate()`; the host registry and SDK adapter enforce owner-scoped gates before renderer `prepare()` and `render()` calls. Host tests cover editor, thumbnail and export intents, including a gate that closes while preparation is in flight. Coloring Mode now registers the host gate and retains its renderer-local suppression fallback. See `INTEGRATION_REPORT.md` for the current validation results and remaining browser/device qualification boundary.
