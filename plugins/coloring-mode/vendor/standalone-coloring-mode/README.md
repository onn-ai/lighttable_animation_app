# Standalone Coloring Mode Module

A dependency-free JavaScript module for attaching a **Draft / Outlines Only** mode to an existing drawing or animation application.

The module owns color-buffer state, visibility, and the signal that tells the host to skip expensive color rendering. It does **not** own the animation loop, timeline, drawing engine, or outline renderer. The host application continues to render vector/raster outlines on its existing display-refresh schedule.

## Deliverables

- **Part 1 — Standalone module:** framework- and DOM-independent `ColoringModeController` with a small public API.
- **Part 2 — Integration and verification:** optional browser/canvas host adapter, documented integration contract, automated unit tests, and a runnable test frontend.

## Key behavior

When `setDraft(true)` is called, each registered color surface is hidden synchronously and its rendering gate is disabled. The outline path is not touched. The module does not call `requestAnimationFrame`, start a timer, or schedule work. The host's existing frame loop remains responsible for outlines and should continue at its normal native refresh cadence.

When `setDraft(false)` is called, color rendering is re-enabled before the surfaces are revealed. The original enabled/disabled preference of each color layer is retained across Draft mode.

## Requirements

- Runtime: modern browser with ES modules for the browser adapter.
- Tests: Node.js 18 or later (`node:test` is used; there are no npm dependencies).
- No React, Vue, Svelte, canvas library, animation library, or build tool is required.

## Quick start — framework-independent core

```js
import { ColoringModeController } from 'standalone-coloring-mode';

const coloring = new ColoringModeController();

coloring.registerColorLayer('base', {
  setVisible(visible) {
    // Synchronously include/exclude this buffer from composition.
    baseBuffer.setVisible(visible);
  },
  setRenderingEnabled(enabled) {
    // Synchronously gate expensive drawing in the host's render loop.
    baseColorRenderEnabled = enabled;
  },
  dispose() {
    // Optional: restore any state captured by this adapter.
  },
});

// Draft on: hide color buffers and skip their rendering.
coloring.setDraft(true);

// Draft off: restore color buffers that were enabled before Draft.
coloring.setDraft(false);

coloring.destroy();
```

## Quick start — browser/canvas adapter

```js
import { attachBrowserColoringMode } from 'standalone-coloring-mode/browser';

const colorRenderGate = { base: true, detail: true };
const coloring = attachBrowserColoringMode({
  colorLayers: [
    { id: 'base', element: baseCanvas },
    { id: 'detail', element: detailCanvas },
  ],
  onColorRenderingEnabled(id, enabled) {
    colorRenderGate[id] = enabled;
  },
});

// Connect UI controls to the module.
draftToggle.addEventListener('change', event => {
  coloring.setDraft(event.currentTarget.checked);
});

// Keep the host's existing render loop. Do not move outline drawing into
// this module or condition it on the Draft state.
function renderFrame() {
  if (colorRenderGate.base) renderBaseColor();
  if (colorRenderGate.detail) renderDetailColor();
  renderOutlines();
  requestAnimationFrame(renderFrame);
}
requestAnimationFrame(renderFrame);

// On host-app teardown:
coloring.detach();
```

## Run tests and demo

```sh
npm test
npm run demo
```

Then open the local URL printed by the demo server (default `http://127.0.0.1:4173`). Alternatively, serve the package directory with any static HTTP server and open `demo/index.html`. ES modules should be served over HTTP rather than `file://`.

## Package layout

```text
src/
  index.js                         Core public entry point
  coloring-mode-controller.js      Framework-independent state/controller
  adapters/
    dom-canvas-layer.js            DOM element visibility + render-gate adapter
    browser-host-adapter.js        Convenience adapter for existing browser apps
tests/                              Node built-in unit tests
demo/                               Runnable frontend integration test bench
docs/
  ARCHITECTURE.md
  INTEGRATION.md
  API.md
  TESTING.md
```

## Important scope note

Hiding a canvas element alone does not stop application code from continuing to draw into it. For actual CPU/GPU-work reduction, wire `onColorRenderingEnabled` (or the core adapter's `setRenderingEnabled`) into the host's color-render scheduler and skip those color draw calls while disabled. The outline renderer must remain on its existing frame path. The included demo demonstrates that arrangement with a host-owned `requestAnimationFrame` loop.
