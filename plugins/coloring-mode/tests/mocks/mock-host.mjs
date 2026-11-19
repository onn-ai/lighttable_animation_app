export class FakeBitmap {
  constructor(width, height, data) { this.width = width; this.height = height; this.data = new Uint8ClampedArray(data); this.closed = false; }
  close() { this.closed = true; }
}

export class FakeOffscreenCanvas {
  constructor(width, height) { this.width = width; this.height = height; this.pixels = new Uint8ClampedArray(width * height * 4); this.context = new Fake2DContext(this); }
  getContext(kind) { return kind === "2d" ? this.context : null; }
}

class Fake2DContext {
  constructor(canvas) { this.canvas = canvas; this.lastImage = undefined; }
  drawImage(source) { this.lastImage = source; if (source?.data) this.canvas.pixels.set(source.data); }
  getImageData(x, y, width, height) {
    const source = this.lastImage?.data ?? this.canvas.pixels;
    const out = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const from = ((y + row) * this.canvas.width + (x + col)) * 4;
        const to = (row * width + col) * 4;
        out.set(source.subarray(from, from + 4), to);
      }
    }
    return { data: out, width, height };
  }
  createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4), width, height }; }
  putImageData(imageData) { this.canvas.pixels.set(imageData.data); this.lastImage = undefined; }
}

function makeLineArt(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  for (let x = 1; x <= width - 2; x += 1) { set(x, 1, [0,0,0,255]); set(x, height - 2, [0,0,0,255]); }
  for (let y = 1; y <= height - 2; y += 1) { set(1, y, [0,0,0,255]); set(width - 2, y, [0,0,0,255]); }
  return data;
}

export function createMockHost(options = {}) {
  const width = options.width ?? 7;
  const height = options.height ?? 7;
  const linePixels = options.pixels ?? makeLineArt(width, height);
  const targetLayer = { id: "destination", celId: "cel-1", name: "Color layer", visible: true, locked: !!options.targetLocked, opacity: 1, blendMode: "normal" };
  const sourceLayer = { id: "line-art", celId: "cel-1", name: "Line art", visible: true, locked: false, opacity: 1, blendMode: "normal" };
  const trackInfo = { id: "track-1", name: "Main", visible: true, locked: false, opacity: 1, blendMode: "normal" };
  const cel = { id: "cel-1", layers: [targetLayer, sourceLayer] };
  const info = { projectId: "project-1", name: "Fixture", revision: 1, width, height, colorSpace: "srgb", frameRate: { numerator: 24, denominator: 1 }, durationTicks: 24 };
  const insertedNodes = [];
  const commitCalls = [];
  const logs = [];
  const storage = new Map();
  const assetBlobs = new Map();
  const descriptors = new Map();
  const registrations = [];
  const tools = new Map();
  const modes = new Map();
  const panels = new Map();
  const renderers = new Map();
  const renderGates = new Map();
  const commands = new Map();
  const toolbars = new Map();
  const menus = new Map();
  const eventListeners = new Map();
  let revision = 1;
  let activeTarget = { tick: 0, trackId: "track-1", clipId: "clip-1", celId: "cel-1", layerId: "destination" };
  let gestureId = 0;

  function registration(map, id, value) {
    if (options.failRegistration === id) throw new Error(`synthetic registration failure: ${id}`);
    map.set(id, value);
    let disposed = false;
    const handle = { dispose() { if (disposed) return; disposed = true; map.delete(id); }, get disposed() { return disposed; } };
    registrations.push(handle);
    return handle;
  }

  const hostStore = {
    add(item) { registrations.push(item); return item; },
    clear() { for (const item of [...registrations].reverse()) item.dispose(); registrations.length = 0; },
    dispose() { this.clear(); },
  };

  const documentApi = {
    getInfo: () => ({ ...info, revision }),
    getSnapshot: () => ({ info: { ...info, revision }, tracks: [trackInfo], revision }),
    resolveTick: (tick) => ({ tick, tracks: [{ track: trackInfo, clip: { id: "clip-1", trackId: "track-1", startTick: 0, durationTicks: 24, celId: "cel-1" }, celId: "cel-1" }] }),
    listTracks: () => [trackInfo],
    getTrack: (id) => id === trackInfo.id ? trackInfo : undefined,
    listClips: () => [{ id: "clip-1", trackId: "track-1", startTick: 0, durationTicks: 24, celId: "cel-1" }],
    getClip: () => ({ id: "clip-1", trackId: "track-1", startTick: 0, durationTicks: 24, celId: "cel-1" }),
    getCel: (id) => id === "cel-1" ? cel : undefined,
    getLayer: (celId, layerId) => celId === "cel-1" ? cel.layers.find((layer) => layer.id === layerId) : undefined,
    listNodes: () => insertedNodes,
    getNode: (_celId, _layerId, nodeId) => insertedNodes.find((item) => item.id === nodeId),
    getExtension: () => undefined,
    transact(txOptions, build) {
      const pending = [];
      build({ nodes: { insert(input) { pending.push(input.node); } } });
      insertedNodes.push(...pending);
      commitCalls.push({ options: txOptions, nodes: pending });
      revision += 1;
      return { committed: true, revision, transactionId: `tx-${revision}` };
    },
  };

  const assets = {
    async put(blob, metadata) {
      const id = `asset-${assetBlobs.size + 1}`;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      assetBlobs.set(id, blob);
      descriptors.set(id, { id, mimeType: blob.type, byteLength: bytes.length, sha256: hashBytes(bytes), fileName: metadata?.fileName });
      return descriptors.get(id);
    },
    async get(id) { return assetBlobs.get(id); },
    getDescriptor(id) { return descriptors.get(id); },
  };

  const render = {
    async renderCel(celId, renderOptions = {}) {
      if (celId !== "cel-1") throw new Error("unknown cel");
      if (options.renderCel) return options.renderCel(celId, renderOptions, { width, height, linePixels });
      if (renderOptions.signal?.aborted) throw abortError();
      const bitmap = new FakeBitmap(width, height, linePixels);
      return { bitmap, width, height, documentRevision: revision, warnings: [] };
    },
    async *renderFrames() { yield { tick: 0, bitmap: new FakeBitmap(width, height, linePixels), width, height, documentRevision: revision, warnings: [] }; },
  };

  const events = {
    on(name, listener) {
      if (!eventListeners.has(name)) eventListeners.set(name, new Set());
      eventListeners.get(name).add(listener);
      return { dispose() { eventListeners.get(name)?.delete(listener); } };
    },
  };
  const api = {
    plugin: { id: "com.lighttable.coloring", version: "1.0.0", apiVersionRange: "^1.0.0" },
    document: documentApi,
    frames: {
      getCurrentTick: () => 0,
      getFrameRate: () => info.frameRate,
      getDurationTicks: () => info.durationTicks,
      getExposureAt: () => documentApi.getClip(),
      getNeighborTicks: () => [],
      onPlayheadChanged: () => ({ dispose() {} }),
      onPlaybackChanged: () => ({ dispose() {} }),
    },
    selection: { getSelection: () => [], setSelection() {}, clear() {}, onChanged: () => ({ dispose() {} }) },
    assets,
    storage: {
      async get(key) { return storage.get(key); },
      async set(key, value) { storage.set(key, structuredClone(value)); },
      async delete(key) { storage.delete(key); },
      async keys() { return [...storage.keys()]; },
    },
    events,
    render,
    logger: {
      debug(message, data) { logs.push({ level: "debug", message, data }); },
      info(message, data) { logs.push({ level: "info", message, data }); },
      warn(message, data) { logs.push({ level: "warn", message, data }); },
      error(message, data) { logs.push({ level: "error", message, data }); },
    },
    registrations: hostStore,
    tools: { register: (def) => registration(tools, def.id, def) },
    modes: { register: (def) => registration(modes, def.id, def) },
    panels: { register: (def) => registration(panels, def.id, def) },
    toolbar: { register: (def) => registration(toolbars, def.id, def) },
    menus: { register: (def) => registration(menus, def.id, def) },
    commands: { register: (def) => registration(commands, def.id, def) },
    renderers: {
      registerNode: (def) => registration(renderers, def.type, def),
      registerNodeRenderGate(nodeType, gate) {
        if (!renderers.has(nodeType)) throw new Error(`Cannot gate unregistered node type: ${nodeType}`);
        if (renderGates.has(nodeType)) throw new Error(`Render gate already exists for ${nodeType}`);
        const state = { visible: true, enabled: true };
        const setVisible = gate.setVisible.bind(gate);
        const setRenderingEnabled = gate.setRenderingEnabled.bind(gate);
        gate.setVisible = (value) => { state.visible = !!value; setVisible(value); };
        gate.setRenderingEnabled = (value) => { state.enabled = !!value; setRenderingEnabled(value); };
        renderGates.set(nodeType, { owner: api.plugin.id, state, gate });
        let disposed = false;
        const handle = { dispose() {
          if (disposed) return;
          disposed = true;
          renderGates.delete(nodeType);
          gate.setVisible = setVisible;
          gate.setRenderingEnabled = setRenderingEnabled;
        } };
        registrations.push(handle);
        return handle;
      },
      registerOverlay: (def) => registration(renderers, def.id, def),
    },
    importers: { register: (def) => registration(new Map(), def.id, def) },
    exporters: { register: (def) => registration(new Map(), def.id, def) },
    settings: { register: (def) => registration(new Map(), def.id, def), get: () => undefined, async set() {} },
  };

  function createToolContext() {
    return {
      pluginId: "com.lighttable.coloring",
      document: documentApi,
      frames: api.frames,
      getActiveTarget: () => activeTarget,
      beginGesture({ label, pointerId }) {
        const id = `gesture-${++gestureId}`;
        let cancelled = false;
        return {
          id,
          updatePreview() {},
          commit(txOptions, build) {
            if (cancelled) return { committed: false, revision, conflict: { expected: revision, actual: revision } };
            const pending = [];
            build({ nodes: { insert(input) { pending.push(input.node); } } });
            insertedNodes.push(...pending);
            commitCalls.push({ options: { ...txOptions, label }, nodes: pending, pointerId });
            revision += 1;
            return { committed: true, revision, transactionId: `tx-${revision}` };
          },
          cancel(reason) { cancelled = true; logs.push({ level: "info", message: "gesture cancelled", data: { reason, id } }); },
        };
      },
      invalidate() {},
      reportProgress(progress) { logs.push({ level: "debug", message: "progress", data: progress }); },
    };
  }

  function dispatch(name, payload = {}) {
    for (const listener of eventListeners.get(name) ?? []) listener(payload);
  }
  function setActiveTarget(target) { activeTarget = target; }

  return {
    api,
    activationContext: { signal: new AbortController().signal, logger: api.logger },
    documentApi,
    assets,
    insertedNodes,
    commitCalls,
    logs,
    storage,
    assetBlobs,
    descriptors,
    registrations,
    tools,
    modes,
    panels,
    renderers,
    renderGates,
    commands,
    toolbars,
    menus,
    render,
    createToolContext,
    dispatch,
    setActiveTarget,
    get revision() { return revision; },
  };
}

function hashBytes(bytes) {
  let hash = 2166136261;
  for (const b of bytes) hash = Math.imul(hash ^ b, 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(8);
}
function abortError() { const error = new Error("aborted"); error.name = "AbortError"; return error; }
