export interface ColorLayerAdapter {
  setVisible(visible: boolean): void;
  setRenderingEnabled(enabled: boolean): void;
  dispose?(): void;
}
export interface ColorLayerState {
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly renderingEnabled: boolean;
}
export interface ColoringModeSnapshot {
  readonly draft: boolean;
  readonly layers: Readonly<Record<string, ColorLayerState>>;
}
export interface ColoringModeEvent {
  readonly reason: string;
  readonly snapshot: ColoringModeSnapshot;
}
export declare class ColoringModeController {
  constructor(options?: {
    draft?: boolean;
    onChange?: (snapshot: ColoringModeSnapshot, event: ColoringModeEvent) => void;
    onError?: (error: unknown, event: ColoringModeEvent) => void;
  });
  readonly draft: boolean;
  readonly destroyed: boolean;
  registerColorLayer(id: string, adapter: ColorLayerAdapter, options?: { enabled?: boolean }): () => void;
  setDraft(enabled: boolean): ColoringModeSnapshot;
  setLayerEnabled(id: string, enabled: boolean): ColoringModeSnapshot;
  isColorRenderingEnabled(id: string): boolean;
  getLayerState(id: string): ColorLayerState;
  getSnapshot(): ColoringModeSnapshot;
  subscribe(listener: (snapshot: ColoringModeSnapshot, event: ColoringModeEvent) => void): () => void;
  destroy(): void;
}
