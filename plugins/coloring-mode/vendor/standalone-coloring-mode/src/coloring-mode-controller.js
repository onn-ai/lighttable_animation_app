/**
 * Framework- and DOM-independent controller for color-buffer visibility.
 *
 * The controller deliberately does not own a render loop and does not know
 * about outlines. The host application remains responsible for drawing its
 * outline layer on its normal display-refresh schedule.
 */
export class ColoringModeController {
  #draft;
  #layers = new Map();
  #listeners = new Set();
  #onChange;
  #onError;
  #destroyed = false;

  constructor({ draft = false, onChange, onError } = {}) {
    this.#draft = Boolean(draft);
    this.#onChange = typeof onChange === 'function' ? onChange : null;
    this.#onError = typeof onError === 'function' ? onError : null;
  }

  get draft() {
    return this.#draft;
  }

  get destroyed() {
    return this.#destroyed;
  }

  /** Return an immutable, serializable view of current state. */
  getSnapshot() {
    const layers = {};
    for (const [id, record] of this.#layers) {
      layers[id] = Object.freeze({
        enabled: record.enabled,
        visible: this.#isEffective(record),
        renderingEnabled: this.#isEffective(record),
      });
    }
    return Object.freeze({ draft: this.#draft, layers: Object.freeze(layers) });
  }

  /**
   * Register a color-buffer adapter.
   *
   * Required adapter contract:
   *   setVisible(boolean): synchronously include/exclude this surface from
   *                        the visible composition.
   *   setRenderingEnabled(boolean): synchronously inform the host scheduler
   *                        whether expensive color rendering should run.
   *
   * Optional:
   *   dispose(): restore state captured when the adapter was created.
   *
   * Returns an idempotent unregister function.
   */
  registerColorLayer(id, adapter, { enabled = true } = {}) {
    this.#assertAlive();
    this.#validateId(id);
    if (this.#layers.has(id)) {
      throw new Error(`A color layer with id "${id}" is already registered.`);
    }
    if (!adapter || typeof adapter.setVisible !== 'function' ||
        typeof adapter.setRenderingEnabled !== 'function') {
      throw new TypeError(
        'A color layer adapter must implement setVisible(boolean) and setRenderingEnabled(boolean).'
      );
    }

    const record = { id, adapter, enabled: Boolean(enabled), disposed: false };
    this.#layers.set(id, record);
    try {
      const errors = this.#applyRecord(record);
      this.#throwAdapterErrors(errors, `Unable to register color layer "${id}".`);
    } catch (error) {
      this.#layers.delete(id);
      this.#disposeRecord(record);
      throw error;
    }
    this.#emit('layer-registered');

    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      if (this.#layers.get(id) !== record) return;
      this.#layers.delete(id);
      this.#disposeRecord(record);
      this.#emit('layer-unregistered');
    };
  }

  /** Switch between full-color mode and draft/outline-only mode. */
  setDraft(enabled) {
    this.#assertAlive();
    const next = Boolean(enabled);
    if (next === this.#draft) return this.getSnapshot();
    this.#draft = next;
    const errors = this.#applyAll();
    this.#emit('draft-changed');
    this.#throwAdapterErrors(errors, 'Unable to apply draft-mode transition.');
    return this.getSnapshot();
  }

  /** Enable/disable an individual registered color layer. */
  setLayerEnabled(id, enabled) {
    this.#assertAlive();
    const record = this.#getRecord(id);
    const next = Boolean(enabled);
    if (record.enabled === next) return this.getSnapshot();
    record.enabled = next;
    const errors = [];
    this.#applyRecord(record, errors);
    this.#emit('layer-enabled-changed');
    this.#throwAdapterErrors(errors, `Unable to update color layer "${id}".`);
    return this.getSnapshot();
  }

  /** Is this color layer currently eligible to render and be composited? */
  isColorRenderingEnabled(id) {
    this.#assertAlive();
    return this.#isEffective(this.#getRecord(id));
  }

  /** Read one layer's state. */
  getLayerState(id) {
    this.#assertAlive();
    const record = this.#getRecord(id);
    const effective = this.#isEffective(record);
    return Object.freeze({
      enabled: record.enabled,
      visible: effective,
      renderingEnabled: effective,
    });
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener) {
    this.#assertAlive();
    if (typeof listener !== 'function') throw new TypeError('listener must be a function.');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Detach all adapters and release listeners. Adapter dispose() methods
   * should restore any host-owned DOM/style/scheduler state they captured.
   */
  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    const errors = [];
    for (const record of this.#layers.values()) this.#disposeRecord(record, errors);
    this.#layers.clear();
    this.#listeners.clear();
    this.#throwAdapterErrors(errors, 'One or more color layer adapters failed to dispose.');
  }

  #assertAlive() {
    if (this.#destroyed) throw new Error('ColoringModeController has been destroyed.');
  }

  #validateId(id) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new TypeError('Color layer id must be a non-empty string.');
    }
  }

  #getRecord(id) {
    const record = this.#layers.get(id);
    if (!record) throw new Error(`Unknown color layer: "${id}".`);
    return record;
  }

  #isEffective(record) {
    return !this.#draft && record.enabled;
  }

  #applyRecord(record, errors = []) {
    const effective = this.#isEffective(record);
    // Ordering is intentional: on entry to Draft, hide first, then stop work.
    // On exit, resume work first, then reveal the layer.
    const calls = effective
      ? [() => record.adapter.setRenderingEnabled(true), () => record.adapter.setVisible(true)]
      : [() => record.adapter.setVisible(false), () => record.adapter.setRenderingEnabled(false)];
    for (const call of calls) {
      try { call(); } catch (error) { errors.push(error); }
    }
    return errors;
  }

  #applyAll() {
    const errors = [];
    const records = [...this.#layers.values()];
    if (this.#draft) {
      // Hide every color surface before notifying any renderer/scheduler.
      for (const record of records) {
        try { record.adapter.setVisible(false); } catch (error) { errors.push(error); }
      }
      for (const record of records) {
        try { record.adapter.setRenderingEnabled(false); } catch (error) { errors.push(error); }
      }
    } else {
      // Resume all color work before revealing any of its surfaces.
      for (const record of records) {
        const enabled = record.enabled;
        try { record.adapter.setRenderingEnabled(enabled); } catch (error) { errors.push(error); }
      }
      for (const record of records) {
        try { record.adapter.setVisible(record.enabled); } catch (error) { errors.push(error); }
      }
    }
    return errors;
  }

  #disposeRecord(record, errors = []) {
    if (record.disposed) return errors;
    record.disposed = true;
    if (typeof record.adapter.dispose === 'function') {
      try { record.adapter.dispose(); } catch (error) { errors.push(error); }
    }
    return errors;
  }

  #emit(reason) {
    const snapshot = this.getSnapshot();
    const event = Object.freeze({ reason, snapshot });
    const callbacks = [...this.#listeners];
    if (this.#onChange) callbacks.push(this.#onChange);
    for (const callback of callbacks) {
      try { callback(snapshot, event); }
      catch (error) {
        if (this.#onError) this.#onError(error, event);
        else queueMicrotask(() => { throw error; });
      }
    }
  }

  #throwAdapterErrors(errors, message) {
    if (errors.length === 0) return;
    const error = new Error(`${message} ${errors.length} adapter operation(s) failed.`);
    error.name = 'ColoringModeAdapterError';
    error.causes = errors;
    throw error;
  }
}
