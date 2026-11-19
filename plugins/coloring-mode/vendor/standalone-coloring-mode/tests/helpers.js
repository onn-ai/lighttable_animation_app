export function createFakeLayer() {
  const calls = [];
  let visible = true;
  let renderingEnabled = true;
  let disposed = false;
  return {
    calls,
    adapter: {
      setVisible(value) { visible = Boolean(value); calls.push(['visible', visible]); },
      setRenderingEnabled(value) { renderingEnabled = Boolean(value); calls.push(['rendering', renderingEnabled]); },
      dispose() { disposed = true; calls.push(['dispose']); },
    },
    get visible() { return visible; },
    get renderingEnabled() { return renderingEnabled; },
    get disposed() { return disposed; },
  };
}
