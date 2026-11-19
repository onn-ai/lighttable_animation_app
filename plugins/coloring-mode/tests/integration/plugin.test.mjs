import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import plugin from "../../dist/index.js";
import { getWorkspaceStore } from "../../dist/runtime/panel-context.js";
import { createMockHost, FakeOffscreenCanvas } from "../mocks/mock-host.mjs";

const previousCanvas = globalThis.OffscreenCanvas;
before(() => { globalThis.OffscreenCanvas = FakeOffscreenCanvas; });
after(() => { if (previousCanvas === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = previousCanvas; });

async function waitFor(predicate, message = "condition was not reached") {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(message);
}

async function activate(host) { await plugin.activate(host.api, host.activationContext); }

function pointerSample(pointerId = 1, x = 3, y = 3) {
  return {
    pointerId, pointerType: "mouse", viewport: { x, y }, document: { x, y }, pressure: 1,
    buttons: 1, modifiers: { alt: false, ctrl: false, meta: false, shift: false }, timeStamp: 10,
  };
}

test("activation registers the full Coloring Mode workspace through SDK contributions", async () => {
  const host = createMockHost();
  await activate(host);
  assert.deepEqual([...host.modes.keys()], ["coloring"]);
  assert.deepEqual([...host.tools.keys()].sort(), ["color-picker", "paint-bucket"]);
  assert.deepEqual([...host.panels.keys()].sort(), ["coloring-options", "palette"]);
  assert.ok(host.renderers.has("com.lighttable.coloring.region"));
  assert.ok(host.commands.has("toggle-draft"));
  assert.ok(host.toolbars.has("toggle-draft"));
  assert.ok(host.menus.has("toggle-draft"));
  assert.equal(host.modes.get("coloring").defaultVisiblePanels.length, 2);
  await plugin.deactivate("disable");
  assert.equal(host.tools.size, 0);
  assert.equal(host.renderers.size, 0);
});

test("host render gate is registered, toggled synchronously, and disposed with the plugin", async () => {
  const host = createMockHost();
  await activate(host);
  const nodeType = "com.lighttable.coloring.region";
  const gate = host.renderGates.get(nodeType);
  assert.ok(gate);
  assert.deepEqual(gate.state, { visible: true, enabled: true });

  host.commands.get("toggle-draft").execute();
  assert.deepEqual(gate.state, { visible: false, enabled: false });
  host.commands.get("toggle-draft").execute();
  assert.deepEqual(gate.state, { visible: true, enabled: true });

  await plugin.deactivate("disable");
  assert.equal(host.renderGates.has(nodeType), false);
});

test("paint bucket stores a binary alpha mask and commits exactly one undoable region node", async () => {
  const host = createMockHost();
  await activate(host);
  const store = getWorkspaceStore();
  store.updateOptions({ sourceLayerIds: ["line-art"], tolerance: 0, gapClose: 1 });
  const tool = host.tools.get("paint-bucket");
  const context = host.createToolContext();
  tool.onPointerDown(pointerSample(), context);
  tool.onPointerUp(pointerSample(), context);
  await waitFor(() => host.commitCalls.length === 1, "paint bucket did not commit");

  assert.equal(host.insertedNodes.length, 1);
  assert.equal(host.commitCalls.length, 1);
  assert.equal(host.commitCalls[0].options.undoable, true);
  const node = host.insertedNodes[0];
  assert.equal(node.type, "com.lighttable.coloring.region");
  assert.equal(node.typeVersion, 1);
  assert.equal(node.data.maskAssetId, "asset-1");
  assert.deepEqual(node.data.sourceLayerIds, ["line-art"]);
  assert.equal(node.data.maskWidth, 7);
  assert.equal(node.data.maskHeight, 7);
  const blob = host.assetBlobs.get(node.data.maskAssetId);
  assert.equal(blob.type, "application/x-lighttable-alpha-mask");
  assert.equal(blob.size, 49);
  const mask = new Uint8Array(await blob.arrayBuffer());
  assert.equal(mask.filter((value) => value > 0).length, 9);
  assert.equal(host.logs.some((entry) => entry.data?.fraction === 1), true);

  const roundTrip = JSON.parse(JSON.stringify(node));
  assert.equal(roundTrip.data.maskAssetId, node.data.maskAssetId);
  assert.equal(host.assets.getDescriptor(roundTrip.data.maskAssetId).byteLength, 49);
  await plugin.deactivate("disable");
});

test("tool cancellation aborts source rendering and does not commit partial coloring", async () => {
  let signalSeen;
  const host = createMockHost({
    renderCel(_celId, renderOptions) {
      signalSeen = renderOptions.signal;
      return new Promise((_resolve, reject) => {
        renderOptions.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      });
    },
  });
  await activate(host);
  getWorkspaceStore().updateOptions({ sourceLayerIds: ["line-art"] });
  const tool = host.tools.get("paint-bucket");
  const context = host.createToolContext();
  tool.onPointerDown(pointerSample(5), context);
  tool.onPointerUp(pointerSample(5), context);
  await waitFor(() => !!signalSeen, "renderCel was not called");
  tool.onCancel("user-cancel", context);
  await waitFor(() => signalSeen.aborted, "render signal was not aborted");
  assert.equal(host.commitCalls.length, 0);
  assert.equal(host.insertedNodes.length, 0);
  await plugin.deactivate("disable");
});

test("locked target refuses bucket edits", async () => {
  const host = createMockHost({ targetLocked: true });
  await activate(host);
  const tool = host.tools.get("paint-bucket");
  tool.onPointerDown(pointerSample(), host.createToolContext());
  assert.equal(host.commitCalls.length, 0);
  assert.equal(host.logs.some((entry) => entry.data?.code === "coloring-target-locked"), true);
  await plugin.deactivate("disable");
});

test("Draft synchronously suppresses region drawing and restores it without changing outline scheduling", async () => {
  const host = createMockHost();
  await activate(host);
  getWorkspaceStore().updateOptions({ sourceLayerIds: ["line-art"] });
  const bucket = host.tools.get("paint-bucket");
  const toolContext = host.createToolContext();
  bucket.onPointerDown(pointerSample(), toolContext);
  bucket.onPointerUp(pointerSample(), toolContext);
  await waitFor(() => host.insertedNodes.length === 1);
  const node = host.insertedNodes[0];
  const renderer = host.renderers.get("com.lighttable.coloring.region");
  await renderer.prepare(node.data, { intent: "editor", documentRevision: host.revision, assets: host.assets });
  let drawCount = 0;
  const renderContext = { ctx: { save() {}, restore() {}, drawImage() { drawCount += 1; } }, intent: "editor", document: { width: 7, height: 7, colorSpace: "srgb" }, tick: 0, frameRate: { numerator: 24, denominator: 1 }, pixelRatio: 1 };
  renderer.render(node.data, renderContext);
  assert.equal(drawCount, 1);

  host.commands.get("toggle-draft").execute();
  assert.equal(getWorkspaceStore().getSnapshot().draft, true);
  renderer.render(node.data, renderContext);
  assert.equal(drawCount, 1, "Draft must suppress color drawing synchronously");

  host.commands.get("toggle-draft").execute();
  renderer.render(node.data, renderContext);
  assert.equal(drawCount, 2, "color rendering resumes before the surface is made visible");
  // There is no outline renderer registration in this plugin: the host-owned outline path is untouched.
  assert.equal(host.renderers.has("outline"), false);
  await plugin.deactivate("disable");
});

test("region renderer serves editor, thumbnail and export intents from prepared resources", async () => {
  const host = createMockHost();
  await activate(host);
  getWorkspaceStore().updateOptions({ sourceLayerIds: ["line-art"] });
  const bucket = host.tools.get("paint-bucket");
  bucket.onPointerDown(pointerSample(), host.createToolContext());
  bucket.onPointerUp(pointerSample(), host.createToolContext());
  await waitFor(() => host.insertedNodes.length === 1);
  const node = host.insertedNodes[0];
  const renderer = host.renderers.get("com.lighttable.coloring.region");
  await renderer.prepare(node.data, { intent: "editor", documentRevision: host.revision, assets: host.assets });
  let draws = 0;
  for (const intent of ["editor", "thumbnail", "export"]) {
    renderer.render(node.data, { intent, ctx: { save() {}, restore() {}, drawImage() { draws += 1; } }, document: { width: 7, height: 7, colorSpace: "srgb" }, tick: 0, frameRate: { numerator: 24, denominator: 1 }, pixelRatio: 1 });
  }
  assert.equal(draws, 3);
  await plugin.deactivate("disable");
});

test("missing or corrupt mask assets surface a diagnostic and reject preparation", async () => {
  const host = createMockHost();
  await activate(host);
  const renderer = host.renderers.get("com.lighttable.coloring.region");
  const data = { maskAssetId: "absent", maskWidth: 2, maskHeight: 2, color: "#FF0000", opacity: 1, seed: { x: 0, y: 0 }, sourceLayerIds: ["line-art"], algorithmVersion: 1, tolerance: 0, gapClose: 0 };
  await assert.rejects(renderer.prepare(data, { intent: "export", documentRevision: host.revision, assets: host.assets }), /descriptor/);
  assert.equal(host.logs.some((entry) => entry.level === "error" && entry.data?.code === "mask-descriptor-missing"), true);
  await plugin.deactivate("disable");
});

test("palette operations persist in plugin-local storage", async () => {
  const host = createMockHost();
  await activate(host);
  const store = getWorkspaceStore();
  const id = store.addColor("#123456", "Test blue");
  store.renameColor(id, "Ocean blue");
  store.updateColor(id, "#234567");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const saved = host.storage.get("workspace-v1");
  assert.ok(saved.palette.some((entry) => entry.id === id && entry.name === "Ocean blue" && entry.color === "#234567"));
  store.deleteColor(id);
  assert.equal(store.getSnapshot().palette.some((entry) => entry.id === id), false);
  await plugin.deactivate("disable");
});

test("activation failure disposes already-staged registrations", async () => {
  const host = createMockHost({ failRegistration: "paint-bucket" });
  await assert.rejects(plugin.activate(host.api, host.activationContext), /synthetic registration failure/);
  assert.equal(host.renderers.size, 0);
  assert.equal(host.modes.size, 0);
  assert.equal(host.tools.size, 0);
});

test("deactivation is idempotent and a later activation registers cleanly", async () => {
  const host = createMockHost();
  await activate(host);
  await plugin.deactivate("disable");
  await plugin.deactivate("disable");
  assert.equal(host.tools.size, 0);
  await activate(host);
  assert.equal(host.tools.size, 2);
  await plugin.deactivate("shutdown");
  assert.equal(host.tools.size, 0);
});

test("color picker samples the current cel and makes the sampled color active", async () => {
  const host = createMockHost();
  await activate(host);
  const picker = host.tools.get("color-picker");
  const context = host.createToolContext();
  picker.onPointerDown(pointerSample(9, 1, 1), context);
  picker.onPointerUp(pointerSample(9, 1, 1), context);
  await waitFor(() => getWorkspaceStore().getSnapshot().palette.some((entry) => entry.color === "#000000"));
  const state = getWorkspaceStore().getSnapshot();
  assert.equal(state.palette.find((entry) => entry.id === state.selectedColorId).color, "#000000");
  await plugin.deactivate("disable");
});
