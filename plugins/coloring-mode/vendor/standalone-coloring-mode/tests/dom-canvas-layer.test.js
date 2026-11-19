import test from 'node:test';
import assert from 'node:assert/strict';
import { createDomCanvasLayerAdapter } from '../src/adapters/dom-canvas-layer.js';
import { ColoringModeController } from '../src/index.js';

function fakeElement({ hidden = false, display = '' } = {}) {
  return { hidden, style: { display } };
}

test('DOM canvas adapter hides with display:none and restores original styles on dispose', () => {
  const element = fakeElement({ hidden: false, display: 'inline-block' });
  const enabledEvents = [];
  const adapter = createDomCanvasLayerAdapter(element, {
    onRenderingEnabled: enabled => enabledEvents.push(enabled),
  });

  adapter.setVisible(false);
  assert.equal(element.hidden, true);
  assert.equal(element.style.display, 'none');
  adapter.setRenderingEnabled(false);
  assert.deepEqual(enabledEvents, [false]);

  adapter.dispose();
  assert.equal(element.hidden, false);
  assert.equal(element.style.display, 'inline-block');
  assert.deepEqual(enabledEvents, [false, true]);
});

test('browser-facing adapter composes with the framework-independent controller', async () => {
  const { attachBrowserColoringMode } = await import('../src/adapters/browser-host-adapter.js');
  const element = fakeElement();
  const schedulerEvents = [];
  const host = attachBrowserColoringMode({
    colorLayers: [{ id: 'fill', element }],
    onColorRenderingEnabled: (id, enabled) => schedulerEvents.push([id, enabled]),
  });

  host.setDraft(true);
  assert.equal(element.hidden, true);
  assert.equal(host.isColorRenderingEnabled('fill'), false);
  host.setDraft(false);
  assert.equal(element.hidden, false);
  assert.equal(host.isColorRenderingEnabled('fill'), true);
  assert.deepEqual(schedulerEvents, [['fill', false], ['fill', true]]);

  host.detach();
  assert.equal(host.detached, true);
  assert.equal(element.hidden, false);
  assert.throws(() => host.setDraft(true), /destroyed/);
});

test('controller can use a DOM adapter without the browser host adapter', () => {
  const element = fakeElement();
  const adapter = createDomCanvasLayerAdapter(element);
  const controller = new ColoringModeController();
  controller.registerColorLayer('canvas', adapter);
  controller.setDraft(true);
  assert.equal(element.hidden, true);
  controller.destroy();
  assert.equal(element.hidden, false);
});
