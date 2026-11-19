import test from 'node:test';
import assert from 'node:assert/strict';
import { ColoringModeController } from '../src/index.js';
import { createFakeLayer } from './helpers.js';

test('Draft mode hides color surfaces before disabling color rendering', () => {
  const controller = new ColoringModeController();
  const layer = createFakeLayer();
  controller.registerColorLayer('base', layer.adapter);
  layer.calls.length = 0;

  controller.setDraft(true);

  assert.equal(layer.visible, false);
  assert.equal(layer.renderingEnabled, false);
  assert.deepEqual(layer.calls, [['visible', false], ['rendering', false]]);
  controller.destroy();
});

test('leaving Draft mode resumes color rendering before revealing surfaces', () => {
  const controller = new ColoringModeController({ draft: true });
  const layer = createFakeLayer();
  controller.registerColorLayer('base', layer.adapter);
  layer.calls.length = 0;

  controller.setDraft(false);

  assert.equal(layer.renderingEnabled, true);
  assert.equal(layer.visible, true);
  assert.deepEqual(layer.calls, [['rendering', true], ['visible', true]]);
  controller.destroy();
});

test('individual color layers are independently enabled', () => {
  const controller = new ColoringModeController();
  const base = createFakeLayer();
  const detail = createFakeLayer();
  controller.registerColorLayer('base', base.adapter);
  controller.registerColorLayer('detail', detail.adapter);

  controller.setLayerEnabled('base', false);
  assert.equal(base.visible, false);
  assert.equal(base.renderingEnabled, false);
  assert.equal(detail.visible, true);
  assert.equal(detail.renderingEnabled, true);

  controller.setLayerEnabled('base', true);
  assert.equal(base.visible, true);
  controller.destroy();
});

test('Draft mode preserves per-layer enabled preference for restoration', () => {
  const controller = new ColoringModeController();
  const base = createFakeLayer();
  const detail = createFakeLayer();
  controller.registerColorLayer('base', base.adapter);
  controller.registerColorLayer('detail', detail.adapter);
  controller.setLayerEnabled('detail', false);

  controller.setDraft(true);
  controller.setDraft(false);

  assert.equal(base.visible, true);
  assert.equal(detail.visible, false);
  assert.equal(controller.getLayerState('detail').enabled, false);
  controller.destroy();
});

test('a layer registered while in Draft mode is immediately hidden and gated', () => {
  const controller = new ColoringModeController({ draft: true });
  const layer = createFakeLayer();
  controller.registerColorLayer('late', layer.adapter);
  assert.equal(layer.visible, false);
  assert.equal(layer.renderingEnabled, false);
  controller.destroy();
});

test('unregister and destroy dispose adapters exactly once', () => {
  const controller = new ColoringModeController();
  const layer = createFakeLayer();
  const unregister = controller.registerColorLayer('base', layer.adapter);
  unregister();
  unregister();
  assert.equal(layer.disposed, true);
  assert.throws(() => controller.getLayerState('base'), /Unknown color layer/);

  const another = createFakeLayer();
  controller.registerColorLayer('another', another.adapter);
  controller.destroy();
  controller.destroy();
  assert.equal(another.disposed, true);
  assert.throws(() => controller.setDraft(true), /destroyed/);
});

test('subscribers receive immutable snapshots and change reasons', () => {
  const controller = new ColoringModeController();
  const events = [];
  const unsubscribe = controller.subscribe((snapshot, event) => events.push({ snapshot, reason: event.reason }));
  controller.setDraft(true);
  unsubscribe();
  controller.setDraft(false);
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, 'draft-changed');
  assert.equal(events[0].snapshot.draft, true);
  assert.equal(Object.isFrozen(events[0].snapshot), true);
  controller.destroy();
});

test('invalid and duplicate registrations are rejected', () => {
  const controller = new ColoringModeController();
  assert.throws(() => controller.registerColorLayer('', createFakeLayer().adapter), /non-empty string/);
  assert.throws(() => controller.registerColorLayer('missing-methods', {}), /must implement/);
  controller.registerColorLayer('base', createFakeLayer().adapter);
  assert.throws(() => controller.registerColorLayer('base', createFakeLayer().adapter), /already registered/);
  assert.throws(() => controller.setLayerEnabled('nope', true), /Unknown color layer/);
  controller.destroy();
});

test('adapter errors do not prevent other layers from receiving a Draft transition', () => {
  const controller = new ColoringModeController();
  const broken = {
    setVisible(visible) { if (!visible) throw new Error('surface failure'); },
    setRenderingEnabled(enabled) { if (!enabled) throw new Error('scheduler failure'); },
  };
  const healthy = createFakeLayer();
  controller.registerColorLayer('broken', broken);
  controller.registerColorLayer('healthy', healthy.adapter);
  assert.throws(() => controller.setDraft(true), { name: 'ColoringModeAdapterError' });
  assert.equal(healthy.visible, false);
  assert.equal(healthy.renderingEnabled, false);
  controller.destroy();
});
