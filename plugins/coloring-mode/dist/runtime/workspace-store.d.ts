import type { JsonValue, PluginStorageApi } from "@lighttable/plugin-sdk";
export interface PaletteColor {
    [key: string]: JsonValue;
    id: string;
    name: string;
    color: string;
}
export interface ColoringOptions {
    [key: string]: JsonValue;
    tolerance: number;
    gapClose: number;
    sourceLayerIds: string[];
    opacity: number;
}
export interface WorkspaceState {
    [key: string]: JsonValue;
    palette: PaletteColor[];
    selectedColorId: string;
    options: ColoringOptions;
    draft: boolean;
    colorLayerEnabled: boolean;
}
export declare function defaultWorkspaceState(): WorkspaceState;
export declare class WorkspaceStore {
    private state;
    private listeners;
    private storage?;
    private persistQueue;
    getSnapshot(): WorkspaceState;
    subscribe(listener: (state: WorkspaceState) => void): () => void;
    load(storage: PluginStorageApi): Promise<void>;
    setDraft(draft: boolean): void;
    setColorLayerEnabled(enabled: boolean): void;
    selectColor(id: string): void;
    setSelectedColor(color: string, name?: string): string;
    addColor(color: string, name: string, select?: boolean): string;
    renameColor(id: string, name: string): void;
    updateColor(id: string, color: string): void;
    deleteColor(id: string): void;
    flush(): Promise<void>;
    updateOptions(patch: Partial<ColoringOptions>): void;
    private emit;
}
