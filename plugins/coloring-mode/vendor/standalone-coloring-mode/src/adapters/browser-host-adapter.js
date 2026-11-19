import { ColoringModeController } from '../coloring-mode-controller.js';
import { createDomCanvasLayerAdapter } from './dom-canvas-layer.js';

/**
 * Attach the standalone controller to an existing browser application.
 *
 * colorLayers: [{ id, element, enabled? }]
 * onColorRenderingEnabled(id, enabled): wire this to the host's color-render
 * scheduler. The host's outline render loop is intentionally not intercepted.
 */
export function attachBrowserColoringMode({
  colorLayers,
  draft = false,
  onChange,
  onError,
  onColorRenderingEnabled = () => {},
} = {}) {
  if (!Array.isArray(colorLayers)) {
    throw new TypeError('colorLayers must be an array of { id, element, enabled? } entries.');
  }
  if (typeof onColorRenderingEnabled !== 'function') {
    throw new TypeError('onColorRenderingEnabled must be a function.');
  }

  const controller = new ColoringModeController({ draft, onChange, onError });
  try {
    for (const layer of colorLayers) {
      if (!layer || typeof layer.id !== 'string') {
        throw new TypeError('Each color layer requires a string id and a DOM element.');
      }
      const adapter = createDomCanvasLayerAdapter(layer.element, {
        onRenderingEnabled: enabled => onColorRenderingEnabled(layer.id, enabled),
        initialRenderingEnabled: layer.initialRenderingEnabled ?? true,
      });
      controller.registerColorLayer(layer.id, adapter, { enabled: layer.enabled ?? true });
    }
  } catch (error) {
    try { controller.destroy(); } catch { /* preserve original attach error */ }
    throw error;
  }

  let detached = false;
  return Object.freeze({
    controller,
    setDraft: enabled => controller.setDraft(enabled),
    setLayerEnabled: (id, enabled) => controller.setLayerEnabled(id, enabled),
    isColorRenderingEnabled: id => controller.isColorRenderingEnabled(id),
    getLayerState: id => controller.getLayerState(id),
    getSnapshot: () => controller.getSnapshot(),
    subscribe: listener => controller.subscribe(listener),
    detach() {
      if (detached) return;
      detached = true;
      controller.destroy();
    },
    get detached() { return detached; },
  });
}
