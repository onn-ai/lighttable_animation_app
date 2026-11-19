/**
 * Create a DOM adapter for a canvas (or other HTMLElement used as a color
 * surface). The controller remains DOM-independent; this is an optional
 * browser integration utility.
 */
export function createDomCanvasLayerAdapter(element, {
  onRenderingEnabled = () => {},
  initialRenderingEnabled = true,
} = {}) {
  if (!element || !element.style || typeof element.hidden !== 'boolean') {
    throw new TypeError('element must be a DOM element with style and hidden properties.');
  }
  if (typeof onRenderingEnabled !== 'function') {
    throw new TypeError('onRenderingEnabled must be a function.');
  }

  const original = {
    hidden: element.hidden,
    display: element.style.display,
    renderingEnabled: Boolean(initialRenderingEnabled),
  };
  let renderingEnabled = original.renderingEnabled;
  let disposed = false;

  return {
    setVisible(visible) {
      if (disposed) return;
      if (visible) {
        element.hidden = false;
        element.style.display = original.display === 'none' ? '' : original.display;
      } else {
        element.hidden = true;
        element.style.display = 'none';
      }
    },

    setRenderingEnabled(enabled) {
      if (disposed) return;
      const next = Boolean(enabled);
      if (next === renderingEnabled) return;
      renderingEnabled = next;
      onRenderingEnabled(next);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      element.hidden = original.hidden;
      element.style.display = original.display;
      if (renderingEnabled !== original.renderingEnabled) {
        renderingEnabled = original.renderingEnabled;
        onRenderingEnabled(renderingEnabled);
      }
    },
  };
}
