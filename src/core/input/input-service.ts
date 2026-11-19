export type PointerKind = 'pen' | 'mouse' | 'touch';
export type InputCancelReason = 'pointercancel' | 'lostpointercapture' | 'app-suspended' | 'tool-change' | 'project-close';
export interface InputSample {
  pointerId: number;
  pointerType: PointerKind;
  viewport: { x: number; y: number };
  document: { x: number; y: number };
  pressure: number;
  tiltX?: number;
  tiltY?: number;
  twist?: number;
  buttons: number;
  modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
  timeStamp: number;
}
export interface InputCallbacks {
  onDown(sample: InputSample): void;
  onMove(samples: readonly InputSample[]): void;
  onUp(sample: InputSample): void;
  onCancel(reason: InputCancelReason): void;
}
export interface InputOptions {
  touchPolicy?: 'navigate' | 'draw';
  mousePressure?: number;
  screenToDocument(point: { x: number; y: number }): { x: number; y: number };
}

/** Host-owned Pointer Events router. No React state updates occur in this class. */
export class InputService {
  private activePointerId: number | undefined;
  private activePointerType: PointerKind | undefined;
  private callbacks?: InputCallbacks;
  private options?: InputOptions;
  private attachedElement?: HTMLElement;
  private readonly visibilityHandler = () => {
    if (document.visibilityState !== 'visible') this.cancel('app-suspended');
  };

  attach(element: HTMLElement, callbacks: InputCallbacks, options: InputOptions): () => void {
    this.detach();
    this.callbacks = callbacks;
    this.options = options;
    this.attachedElement = element;
    element.addEventListener('pointerdown', this.pointerDown);
    element.addEventListener('pointermove', this.pointerMove);
    element.addEventListener('pointerup', this.pointerUp);
    element.addEventListener('pointercancel', this.pointerCancel);
    element.addEventListener('lostpointercapture', this.lostCapture);
    window.addEventListener('blur', this.windowBlur);
    document.addEventListener('visibilitychange', this.visibilityHandler);
    return () => this.detach(element);
  }

  cancel(reason: InputCancelReason): void {
    if (this.activePointerId !== undefined) {
      const id = this.activePointerId;
      this.activePointerId = undefined;
      this.activePointerType = undefined;
      try {
        if (this.attachedElement?.hasPointerCapture(id)) this.attachedElement.releasePointerCapture(id);
      } catch { /* capture may already have been released by the browser */ }
      try { this.callbacks?.onCancel(reason); }
      catch (error) { console.error('Input cancellation handler failed.', error); }
    }
  }

  detach(element?: HTMLElement): void {
    const target = element ?? this.attachedElement;
    if (target) {
      target.removeEventListener('pointerdown', this.pointerDown);
      target.removeEventListener('pointermove', this.pointerMove);
      target.removeEventListener('pointerup', this.pointerUp);
      target.removeEventListener('pointercancel', this.pointerCancel);
      target.removeEventListener('lostpointercapture', this.lostCapture);
    }
    this.cancel('project-close');
    window.removeEventListener('blur', this.windowBlur);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.callbacks = undefined;
    this.options = undefined;
    this.attachedElement = undefined;
  }

  private pointerDown = (event: PointerEvent): void => {
    if (this.activePointerId !== undefined) return;
    const type = normalizePointerType(event.pointerType);
    if (type === 'touch' && this.options?.touchPolicy !== 'draw') return;
    if (type === 'mouse' && event.button !== 0) return;
    this.activePointerId = event.pointerId;
    this.activePointerType = type;
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* browser may already own capture */ }
    try { this.callbacks?.onDown(this.toSample(event, type)); }
    catch (error) { this.cancel('tool-change'); console.error('Pointer-down handler failed; gesture was cancelled.', error); }
    event.preventDefault();
  };

  private pointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId || !this.activePointerType) return;
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    const samples = (coalesced.length ? coalesced : [event]).map((item) => this.toSample(item, this.activePointerType!));
    try { this.callbacks?.onMove(samples); }
    catch (error) { this.cancel('tool-change'); console.error('Pointer-move handler failed; gesture was cancelled.', error); }
    event.preventDefault();
  };

  private pointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId || !this.activePointerType) return;
    const sample = this.toSample(event, this.activePointerType);
    this.activePointerId = undefined;
    this.activePointerType = undefined;
    try { if (this.attachedElement?.hasPointerCapture(event.pointerId)) this.attachedElement.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    try { this.callbacks?.onUp(sample); }
    catch (error) {
      try { this.callbacks?.onCancel('tool-change'); } catch (cancelError) { console.error('Input cancellation handler failed.', cancelError); }
      console.error('Pointer-up handler failed.', error);
    }
    event.preventDefault();
  };

  private pointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointerId) this.cancel('pointercancel');
  };

  private lostCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointerId) this.cancel('lostpointercapture');
  };

  private windowBlur = (): void => this.cancel('app-suspended');

  private toSample(event: PointerEvent, pointerType: PointerKind): InputSample {
    // Coalesced PointerEvents are not dispatched events and often have currentTarget=null.
    const target = this.attachedElement;
    if (!target) throw new Error('Input target is no longer attached.');
    const rect = target.getBoundingClientRect();
    const viewport = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const documentPoint = this.options!.screenToDocument(viewport);
    const rawPressure = event.pressure;
    const pressure = pointerType === 'mouse'
      ? (rawPressure > 0 ? rawPressure : this.options?.mousePressure ?? 0.5)
      : Math.max(0, Math.min(1, rawPressure));
    return {
      pointerId: event.pointerId,
      pointerType,
      viewport,
      document: documentPoint,
      pressure,
      tiltX: Number.isFinite(event.tiltX) ? event.tiltX : undefined,
      tiltY: Number.isFinite(event.tiltY) ? event.tiltY : undefined,
      twist: Number.isFinite(event.twist) ? event.twist : undefined,
      buttons: event.buttons,
      modifiers: { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey },
      timeStamp: event.timeStamp,
    };
  }
}

function normalizePointerType(type: string): PointerKind {
  return type === 'pen' || type === 'touch' ? type : 'mouse';
}
