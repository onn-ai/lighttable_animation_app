# Architecture

## Design boundary

The coloring module is a small state-and-adapter component. Its responsibility ends at the color-buffer boundary. It has no dependency on the host's animation system, time model, scene graph, vector format, raster format, or UI framework.

```text
                 Existing host application
  ┌─────────────────────────────────────────────────────────┐
  │  UI switch                                               │
  │    │                                                    │
  │    ▼                                                    │
  │  Browser host adapter ───────► DOM/canvas color surfaces │
  │    │                          + color-render gates       │
  │    ▼                                                    │
  │  ColoringModeController                                  │
  │                                                         │
  │  Host-owned frame loop:                                  │
  │    if colorGate.base   → render base color               │
  │    if colorGate.detail → render detail color             │
  │    always               → render outlines                │
  └─────────────────────────────────────────────────────────┘
```

## Why the frame loop remains outside

The host already knows its display-refresh policy. The module must not introduce a second scheduler, cap frame rate, or request frames on behalf of outlines. Keeping the outline renderer outside the module avoids coupling Draft mode to the animation/rendering engine and preserves the host's native refresh behavior.

## Draft transition ordering

Entering Draft mode:

1. Set controller state to Draft.
2. Synchronously hide each color surface (`setVisible(false)`).
3. Synchronously disable its expensive color-render gate (`setRenderingEnabled(false)`).
4. Notify subscribers of the new state.
5. The host continues its normal frame loop and outline path.

Leaving Draft mode:

1. Clear Draft state.
2. Re-enable the color-render gate.
3. Reveal the enabled color surface.
4. Notify subscribers.

Per-layer enablement is separate from Draft mode. A layer disabled before Draft stays disabled after Draft is turned off.

## Rendering guarantee and boundary

The controller makes synchronous adapter calls in the same JavaScript task as `setDraft`. This avoids waiting for a timer, animation frame, or transition. Browser painting occurs after the current task, so the requested visibility state is applied before the next paint opportunity.

Actual CPU/GPU work reduction depends on the host honoring `setRenderingEnabled(false)` and skipping color drawing/compositing work. CSS/DOM hiding by itself does not prevent application code from drawing into a canvas backing store. The module cannot guarantee a specific measured FPS on all hardware; it ensures that it does not throttle or replace the host's outline refresh loop.

## Dependency policy

- Core entry (`src/index.js`) imports only the core controller.
- DOM-specific code is isolated under `src/adapters/`.
- The browser adapter is optional and can be omitted when integrating with a non-DOM renderer.
- No runtime dependencies are declared.
