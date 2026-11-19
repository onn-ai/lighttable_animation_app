import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const buildRoot = resolve(root, '.build');
writeFileSync(resolve(buildRoot, 'package.json'), '{"type":"commonjs"}');
const require = createRequire(import.meta.url);
const { createDefaultProject, cloneValue, newId } = require('./.build/core/document/types.js');
const { validateProject, DocumentValidationError } = require('./.build/core/document/validate.js');
const { TransactionEngine } = require('./.build/core/history/transaction-engine.js');
const { insertBlankFrame, duplicateFrame, deleteFrame, addLayer, addTrack, removeLayer } = require('./.build/core/document/operations.js');
const { isInsideDocument, clampToDocument } = require('./.build/core/input/viewport.js');
const { RendererRegistry } = require('./.build/core/rendering/renderer-registry.js');
const { renderTickToCanvas, findOnionTicks } = require('./.build/core/rendering/render-service.js');
const { createZip, readZip, normalizeZipPath } = require('./.build/core/export/zip.js');
const { exportProjectPackage, importProjectPackage } = require('./.build/core/export/project-package.js');
const { exportA4PDF, exportPNGSequence } = require('./.build/core/export/print-export.js');
const { ProjectRepository, AutosaveController } = require('./.build/core/storage/project-repository.js');
const { createPluginApi, EventBus } = require('./.build/core/plugins/sdk-host.js');
const { RendererRegistry: HostRendererRegistry } = require('./.build/core/rendering/renderer-registry.js');
const { InputService } = require('./.build/core/input/input-service.js');
const { clearCanvasInDeviceSpace } = require('./.build/core/rendering/canvas-surface.js');

let passCount = 0;
function test(name, run) {
  return Promise.resolve().then(run).then(() => {
    passCount += 1;
    process.stdout.write(`PASS ${name}\n`);
  }).catch((error) => {
    process.stderr.write(`FAIL ${name}\n${error?.stack ?? error}\n`);
    throw error;
  });
}

class FakeContext {
  constructor(canvas) { this.canvas = canvas; this.globalAlpha = 1; this.globalCompositeOperation = 'source-over'; }
  save() {} restore() {} scale() {} transform() {} fillRect() {} drawImage() {}
  beginPath() {} moveTo() {} lineTo() {} quadraticCurveTo() {} stroke() {} fill() {} arc() {}
  setLineDash() {} strokeRect() {} fillText() {}
}
class FakeCanvas {
  constructor() { this.width = 1; this.height = 1; this.context = new FakeContext(this); }
  getContext(type) { return type === '2d' ? this.context : null; }
  toBlob(callback, type = 'image/png') { callback(new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])], { type })); }
}

await test('default project is valid and uses canonical Layer 1', () => {
  const project = createDefaultProject();
  validateProject(project);
  assert.equal(project.tracks.length, 1);
  const cel = Object.values(project.cels)[0];
  assert.equal(cel.layers.length, 1);
  assert.equal(cel.layers[0].name, 'Layer 1');
});

await test('malformed untrusted project shapes fail with validation errors, not runtime exceptions', () => {
  assert.throws(() => validateProject(null), (error) => error instanceof DocumentValidationError && /root must be an object/.test(error.message));
  const malformed = { ...createDefaultProject(), tracks: [null, { id: 'bad-track', clips: null }], cels: { broken: null }, assets: [null] };
  assert.throws(() => validateProject(malformed), (error) => error instanceof DocumentValidationError && error.issues.length >= 4);
});

await test('transactions are atomic, revision checked, and undo/redo restore snapshots', () => {
  const engine = new TransactionEngine(createDefaultProject());
  const before = engine.document;
  assert.throws(() => engine.transact('Invalid', (draft) => { draft.document.width = -1; }), DocumentValidationError);
  assert.equal(engine.revision, 0);
  assert.deepEqual(engine.document, before);
  const committed = engine.transact('Rename', (draft) => { draft.name = 'Changed'; }, { expectedRevision: 0 });
  assert.equal(committed.committed, true);
  assert.equal(engine.document.name, 'Changed');
  const conflict = engine.transact('Stale edit', (draft) => { draft.name = 'Lost'; }, { expectedRevision: 0 });
  assert.equal(conflict.committed, false);
  assert.equal(conflict.conflict.actual, 1);
  assert.equal(engine.undo(), true);
  assert.equal(engine.document.name, before.name);
  assert.equal(engine.redo(), true);
  assert.equal(engine.document.name, 'Changed');
});

await test('blank, independent duplicate, and delete frame operations preserve timeline invariants', () => {
  const project = createDefaultProject();
  const track = project.tracks[0];
  const sourceCel = project.cels[track.clips[0].celId];
  sourceCel.extensions = { 'com.example.unknown': { schemaVersion: 1, data: { color: 'violet' } } };
  sourceCel.layers[0].nodes.push({
    id: newId('node'), type: 'core.path', typeVersion: 1,
    transform: [1, 0, 0, 1, 0, 0], visible: true,
    data: { samples: [{ x: 2, y: 3, pressure: 1 }], paint: { color: '#112233', width: 3, opacity: 1, cap: 'round', join: 'round', composite: 'source-over' } },
  });
  const engine = new TransactionEngine(project);
  assert.equal(insertBlankFrame(engine, track.id, 0), 1);
  let snapshot = engine.document;
  assert.equal(snapshot.document.durationTicks, 2);
  const blankClip = snapshot.tracks[0].clips.find((item) => item.startTick === 1);
  assert.equal(snapshot.cels[blankClip.celId].layers[0].name, 'Layer 1');
  assert.equal(duplicateFrame(engine, track.id, 0), 1);
  snapshot = engine.document;
  assert.equal(snapshot.document.durationTicks, 3);
  const duplicate = snapshot.tracks[0].clips.find((item) => item.startTick === 1);
  assert.notEqual(duplicate.celId, track.clips[0].celId);
  const copiedCel = snapshot.cels[duplicate.celId];
  assert.notEqual(copiedCel.layers[0].id, sourceCel.layers[0].id);
  assert.notEqual(copiedCel.layers[0].nodes[0].id, sourceCel.layers[0].nodes[0].id);
  assert.deepEqual(copiedCel.extensions, sourceCel.extensions);
  assert.equal(deleteFrame(engine, track.id, 1), 1);
  validateProject(engine.document);
  assert.equal(engine.document.document.durationTicks, 2);
});

await test('new animation tracks create independent blank cels and undo as one operation', () => {
  const engine = new TransactionEngine(createDefaultProject());
  const originalTrackId = engine.document.tracks[0].id;
  insertBlankFrame(engine, originalTrackId, 0);
  const trackId = addTrack(engine);
  const document = engine.document;
  const track = document.tracks.find((item) => item.id === trackId);
  assert.ok(track);
  assert.equal(track.name, 'Animation 2');
  assert.equal(track.clips.length, document.document.durationTicks);
  assert.equal(new Set(track.clips.map((clip) => clip.celId)).size, document.document.durationTicks);
  assert.ok(track.clips.every((clip) => document.cels[clip.celId].layers[0].nodes.length === 0));
  assert.equal(engine.undo(), true);
  assert.equal(engine.document.tracks.length, 1);
  assert.equal(engine.redo(), true);
  assert.equal(engine.document.tracks.length, 2);
  validateProject(engine.document);
});

await test('document bounds reject off-paper starts and clamp captured samples at paper edges', () => {
  assert.equal(isInsideDocument({ x: 0, y: 0 }, 1920, 1080), true);
  assert.equal(isInsideDocument({ x: 1921, y: 300 }, 1920, 1080), false);
  assert.equal(isInsideDocument({ x: Number.NaN, y: 4 }, 1920, 1080), false);
  assert.deepEqual(clampToDocument({ x: -20, y: 1200 }, 1920, 1080), { x: 0, y: 1080 });
  assert.deepEqual(clampToDocument({ x: 400, y: 500 }, 1920, 1080), { x: 400, y: 500 });
});

await test('preview canvas clearing resets the viewport transform before clearing the full backing store', () => {
  const calls = [];
  const context = {
    setTransform: (...values) => calls.push(['setTransform', ...values]),
    clearRect: (...values) => calls.push(['clearRect', ...values]),
  };
  clearCanvasInDeviceSpace(context, 2400, 1350);
  assert.deepEqual(calls, [
    ['setTransform', 1, 0, 0, 1, 0, 0],
    ['clearRect', 0, 0, 2400, 1350],
  ]);
});

await test('one drawing gesture is stored as one undoable path node', () => {
  const engine = new TransactionEngine(createDefaultProject());
  const track = engine.document.tracks[0];
  const celId = track.clips[0].celId;
  const layerId = engine.document.cels[celId].layers[0].id;
  const samples = Array.from({ length: 12 }, (_, index) => ({ x: index * 10, y: index * 4, pressure: 0.5 }));
  engine.transact('Pencil stroke', (draft) => {
    draft.cels[celId].layers.find((layer) => layer.id === layerId).nodes.push({
      id: 'single-gesture-node', type: 'core.path', typeVersion: 1,
      transform: [1, 0, 0, 1, 0, 0], visible: true,
      data: {
        samples,
        paint: { color: '#1A1A1A', width: 5, opacity: 1, cap: 'round', join: 'round', composite: 'source-over' },
      },
    });
  });
  let nodes = engine.document.cels[celId].layers[0].nodes;
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].data.samples.length, samples.length);
  assert.equal(engine.undo(), true);
  nodes = engine.document.cels[celId].layers[0].nodes;
  assert.equal(nodes.length, 0);
  assert.equal(engine.redo(), true);
  nodes = engine.document.cels[celId].layers[0].nodes;
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].data.samples.length, samples.length);
});

await test('cel layer operations cap at four and preserve one editable layer', () => {
  const engine = new TransactionEngine(createDefaultProject());
  const celId = engine.document.tracks[0].clips[0].celId;
  addLayer(engine, celId, 'Lines');
  addLayer(engine, celId, 'Shadows');
  addLayer(engine, celId, 'Notes');
  assert.equal(engine.document.cels[celId].layers.length, 4);
  assert.throws(() => addLayer(engine, celId, 'Overflow'), /at most four/);
  const target = engine.document.cels[celId].layers[3];
  removeLayer(engine, celId, target.id);
  assert.equal(engine.document.cels[celId].layers.length, 3);
  const onlyLayer = engine.document.cels[celId].layers[0];
  const minimal = new TransactionEngine(createDefaultProject());
  const onlyCelId = minimal.document.tracks[0].clips[0].celId;
  assert.throws(() => removeLayer(minimal, onlyCelId, minimal.document.cels[onlyCelId].layers[0].id), /at least one/);
});

await test('onion neighbors are active-track, chronological, and deduplicated by cel identity', () => {
  const project = createDefaultProject();
  const track = project.tracks[0];
  const celA = track.clips[0].celId;
  const celB = newId('cel');
  const celC = newId('cel');
  project.cels[celB] = { id: celB, layers: [] };
  project.cels[celC] = { id: celC, layers: [] };
  project.document.durationTicks = 6;
  track.clips = [
    { id: 'clip-a1', startTick: 0, durationTicks: 2, celId: celA },
    { id: 'clip-a2', startTick: 2, durationTicks: 1, celId: celA }, // linked exposure: not a new onion drawing
    { id: 'clip-b1', startTick: 3, durationTicks: 1, celId: celB },
    { id: 'clip-b2', startTick: 4, durationTicks: 1, celId: celB }, // linked exposure: skip
    { id: 'clip-c', startTick: 5, durationTicks: 1, celId: celC },
  ];
  assert.deepEqual(findOnionTicks(project, track.id, 0, celA, 3, 1), [3, 5]);
  assert.deepEqual(findOnionTicks(project, track.id, 3, celB, 3, -1), [2]);
  assert.deepEqual(findOnionTicks(project, track.id, 3, celB, 0, 1), []);
});

await test('renderer gate suppresses prepare and render for every intent', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => new FakeCanvas() };
  try {
    const project = createDefaultProject();
    const track = project.tracks[0];
    project.cels[track.clips[0].celId].layers[0].nodes.push({ id: 'plugin-node-1', type: 'com.example.color', typeVersion: 1, transform: [1, 0, 0, 1, 0, 0], visible: true, data: {} });
    const registry = new RendererRegistry();
    let prepared = 0;
    let rendered = 0;
    const renderer = {
      type: 'com.example.color', supportedVersions: { min: 1, max: 1 },
      async prepare() { prepared += 1; },
      render() { rendered += 1; },
    };
    registry.registerNode('com.example', renderer);
    const gate = { visible: true, enabled: true, setVisible(value) { this.visible = value; }, setRenderingEnabled(value) { this.enabled = value; } };
    const disposeGate = registry.registerNodeRenderGate('com.example', 'com.example.color', gate);
    gate.setVisible(false);
    for (const intent of ['editor', 'thumbnail', 'export', 'onion']) {
      await renderTickToCanvas(project, 0, registry, { get: async () => undefined, getDescriptor: () => undefined }, { intent });
    }
    assert.equal(prepared, 0);
    assert.equal(rendered, 0);
    gate.setVisible(true);
    await renderTickToCanvas(project, 0, registry, { get: async () => undefined, getDescriptor: () => undefined }, { intent: 'export' });
    assert.equal(prepared, 1);
    assert.equal(rendered, 1);

    const disposeRenderer = registry.registerNode('other.plugin', { type: 'other.plugin.node', supportedVersions: { min: 1, max: 1 }, render() {} });
    assert.throws(() => registry.registerNodeRenderGate('com.example', 'other.plugin.node', gate), /does not own/);
    disposeRenderer();

    // A gate that closes while prepare is pending must prevent the render phase too.
    const secondProject = cloneValue(project);
    const secondRegistry = new RendererRegistry();
    const asyncGate = { visible: true, enabled: true, setVisible(value) { this.visible = value; }, setRenderingEnabled(value) { this.enabled = value; } };
    let secondPrepared = 0;
    let secondRendered = 0;
    secondRegistry.registerNode('com.example', {
      type: 'com.example.color', supportedVersions: { min: 1, max: 1 },
      async prepare() { secondPrepared += 1; asyncGate.setVisible(false); },
      render() { secondRendered += 1; },
    });
    secondRegistry.registerNodeRenderGate('com.example', 'com.example.color', asyncGate);
    await renderTickToCanvas(secondProject, 0, secondRegistry, { get: async () => undefined, getDescriptor: () => undefined }, { intent: 'onion' });
    assert.equal(secondPrepared, 1);
    assert.equal(secondRendered, 0);
    disposeGate();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});


await test('pointer router handles coalesced events, capture, coordinate mapping and cancellation', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  class Target extends EventTarget {
    captured = new Set();
    getBoundingClientRect() { return { left: 5, top: 7, width: 200, height: 100, right: 205, bottom: 107, x: 5, y: 7, toJSON() {} }; }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); }
  }
  const eventWith = (type, fields) => Object.assign(new Event(type, { cancelable: true }), fields);
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  try {
    const target = new Target();
    const events = [];
    const service = new InputService();
    const dispose = service.attach(target, {
      onDown: (sample) => events.push(['down', sample]),
      onMove: (samples) => events.push(['move', ...samples]),
      onUp: (sample) => events.push(['up', sample]),
      onCancel: (reason) => events.push(['cancel', reason]),
    }, { touchPolicy: 'draw', mousePressure: 0.5, screenToDocument: (point) => ({ x: point.x * 2, y: point.y * 2 }) });
    target.dispatchEvent(eventWith('pointerdown', { pointerId: 9, pointerType: 'pen', button: 0, buttons: 1, clientX: 15, clientY: 27, pressure: 0.8, tiltX: 12, tiltY: 5, twist: 2, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }));
    assert.equal(target.hasPointerCapture(9), true);
    const coalesced = eventWith('pointermove', { pointerId: 9, pointerType: 'pen', buttons: 1, clientX: 25, clientY: 37, pressure: 0.6, tiltX: 8, tiltY: 3, twist: 1, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
    const move = eventWith('pointermove', { pointerId: 9, pointerType: 'pen', buttons: 1, clientX: 26, clientY: 38, pressure: 0.4, tiltX: 8, tiltY: 3, twist: 1, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, getCoalescedEvents: () => [coalesced] });
    target.dispatchEvent(move);
    target.dispatchEvent(eventWith('pointerup', { pointerId: 9, pointerType: 'pen', button: 0, buttons: 0, clientX: 26, clientY: 38, pressure: 0, tiltX: 0, tiltY: 0, twist: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }));
    assert.deepEqual(events.map((entry) => entry[0]), ['down', 'move', 'up']);
    assert.deepEqual(events[0][1].document, { x: 20, y: 40 });
    assert.deepEqual(events[1][1].document, { x: 40, y: 60 });
    assert.equal(events[1][1].pressure, 0.6);
    assert.equal(target.hasPointerCapture(9), false);

    target.dispatchEvent(eventWith('pointerdown', { pointerId: 10, pointerType: 'pen', button: 0, buttons: 1, clientX: 15, clientY: 27, pressure: 0.5, tiltX: 0, tiltY: 0, twist: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }));
    target.dispatchEvent(eventWith('pointercancel', { pointerId: 10 }));
    assert.deepEqual(events.at(-1), ['cancel', 'pointercancel']);
    dispose();
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  }
});

await test('ZIP round-trip verifies contents and rejects unsafe paths', async () => {
  const source = new Blob([new Uint8Array([0, 1, 2, 250, 255])]);
  const archive = createZip([{ path: 'folder/data.bin', data: new Uint8Array(await source.arrayBuffer()) }, { path: 'README.txt', data: 'LightTable' }]);
  const files = await readZip(archive);
  assert.deepEqual([...files.get('folder/data.bin')], [0, 1, 2, 250, 255]);
  assert.equal(new TextDecoder().decode(files.get('README.txt')), 'LightTable');
  assert.throws(() => normalizeZipPath('../outside.txt'), /Unsafe ZIP path/);
  assert.throws(() => normalizeZipPath('folder\\\\outside.txt'), /Unsafe ZIP path/);
  assert.throws(() => createZip([{ path: 'x/../y', data: '' }]), /Unsafe ZIP path/);
  const corrupt = new Uint8Array(await archive.arrayBuffer());
  const nameLength = new DataView(corrupt.buffer).getUint16(26, true);
  corrupt[30 + nameLength] ^= 0xFF;
  await assert.rejects(() => readZip(new Blob([corrupt])), /integrity check failed/);
});

await test('project package preserves unknown plugin data and verifies content-addressed assets', async () => {
  const sourceRepository = new ProjectRepository();
  const targetRepository = new ProjectRepository();
  const project = createDefaultProject('Archive round-trip');
  const cel = Object.values(project.cels)[0];
  cel.extensions = { 'com.unknown.future': { schemaVersion: 7, data: { nested: [1, 'kept', true] } } };
  cel.layers[0].nodes.push({ id: 'future-node', type: 'vendor.future.shape', typeVersion: 3, transform: [1, 0, 0, 1, 0, 0], visible: true, data: { preserved: { value: 'opaque' } } });
  const descriptor = await sourceRepository.putAsset(new Blob([new Uint8Array([9, 8, 7, 6])], { type: 'application/octet-stream' }), 'mask.bin');
  project.assets.push(descriptor);
  const archive = await exportProjectPackage(project, sourceRepository);
  const imported = await importProjectPackage(archive, targetRepository);
  assert.deepEqual(imported.cels[cel.id].extensions, cel.extensions);
  assert.deepEqual(imported.cels[cel.id].layers[0].nodes[0].data, { preserved: { value: 'opaque' } });
  const restoredBlob = await targetRepository.getAsset(descriptor.id);
  assert.deepEqual([...new Uint8Array(await restoredBlob.arrayBuffer())], [9, 8, 7, 6]);
  assert.equal((await targetRepository.loadProject(project.projectId)).document.name, 'Archive round-trip');
});


await test('PNG sequence and A4 PDF exports produce numbered outputs from a stable snapshot', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => new FakeCanvas() };
  try {
    const project = createDefaultProject('Export regression');
    const repository = new ProjectRepository();
    const registry = new HostRendererRegistry();
    registry.registerCorePath();
    const pngArchive = await exportPNGSequence(project, registry, repository, { transparent: false });
    const pngFiles = await readZip(pngArchive);
    assert.ok(pngFiles.has('frames/frame_0001.png'));
    assert.match(new TextDecoder().decode(pngFiles.get('README.txt')), /Frames: 1/);

    const pdfBlob = await exportA4PDF(project, registry, repository, { includeAcmePegBar: true });
    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
    const pdf = new TextDecoder().decode(pdfBytes);
    assert.ok(pdf.startsWith('%PDF-1.4'));
    assert.match(pdf, /\/MediaBox \[0 0 841\.89 595\.28\]/);
    assert.match(pdf, /FRAME 0001/);
    assert.match(pdf, /\/Subtype \/Image/);
    const marker = new Uint8Array([0x78, 0x72, 0x65, 0x66, 0x0A]);
    let xref = -1;
    for (let index = 0; index <= pdfBytes.length - marker.length; index += 1) {
      if (marker.every((byte, offset) => pdfBytes[index + offset] === byte)) { xref = index; break; }
    }
    const startXref = Number(pdf.match(/startxref\n(\d+)/)?.[1]);
    assert.equal(startXref, xref);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

await test('plugin SDK enforces declared capabilities at API boundaries', () => {
  const engine = new TransactionEngine(createDefaultProject());
  const repository = new ProjectRepository();
  const renderers = new HostRendererRegistry();
  renderers.registerCorePath();
  const registries = { tools: new Map(), modes: new Map(), panels: new Map(), toolbar: new Map(), menus: new Map(), commands: new Map(), overlays: new Map(), importers: new Map(), exporters: new Map(), settings: new Map(), onChange() {} };
  const host = { engine, repository, renderers, registries, getCurrentTick: () => 0, setCurrentTick() {}, getActiveTarget: () => undefined, invalidate() {} };
  const denied = createPluginApi({ id: 'com.example.denied', version: '1.0.0', apiVersionRange: '^1.0.0', execution: 'trusted-ui', permissions: [] }, host, new EventBus());
  assert.throws(() => denied.document.getInfo(), /document.read capability/);
  assert.throws(() => denied.tools.register({ id: 'unsafe', name: 'Unsafe' }), /canvas.input capability/);
  assert.throws(() => denied.assets.get('sha256:missing'), /assets.read capability/);
  assert.throws(() => denied.storage.keys(), /storage.plugin capability/);

  const reader = createPluginApi({ id: 'com.example.reader', version: '1.0.0', apiVersionRange: '^1.0.0', execution: 'trusted-ui', permissions: ['document.read'] }, host, new EventBus());
  assert.equal(reader.document.getInfo().name, 'Untitled Animation');
  assert.throws(() => reader.document.transact({ label: 'forbidden write' }, () => {}), /document.write capability/);
});

await test('autosave coalesces edits arriving during an in-flight save without losing the newest revision', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = { setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: (id) => clearTimeout(id) };
  try {
    const saved = [];
    let releaseFirst;
    const firstSave = new Promise((resolve) => { releaseFirst = resolve; });
    const repository = { async saveProject(document, revision) { saved.push(revision); if (revision === 1) await firstSave; } };
    const statuses = [];
    const autosave = new AutosaveController(repository, (status) => statuses.push(status), 99999);
    const document1 = createDefaultProject('revision one');
    const document2 = cloneValue(document1); document2.name = 'revision two';
    const pendingOne = autosave.flush(document1, 1);
    await new Promise((resolve) => setImmediate(resolve));
    const pendingTwo = autosave.flush(document2, 2);
    releaseFirst();
    await Promise.all([pendingOne, pendingTwo]);
    assert.deepEqual(saved, [1, 2]);
    assert.equal(statuses.at(-1), 'saved');
    autosave.dispose();
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

process.stdout.write(`\n${passCount} host-runtime checks passed.\n`);
rmSync(buildRoot, { recursive: true, force: true });
