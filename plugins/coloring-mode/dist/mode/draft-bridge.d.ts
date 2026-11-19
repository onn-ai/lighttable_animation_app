import { ColoringModeController } from "../../vendor/standalone-coloring-mode/src/index.js";
import type { PluginLogger } from "@lighttable/plugin-sdk";
import type { WorkspaceStore } from "../runtime/workspace-store.js";
/** A renderer-local surface. The host compositor remains host-owned. */
export declare class ColoringRenderSurfaceGate {
    private visible;
    private renderingEnabled;
    setVisible(visible: boolean): void;
    setRenderingEnabled(enabled: boolean): void;
    isVisible(): boolean;
    isRenderingEnabled(): boolean;
    shouldRender(): boolean;
}
export interface DraftBridge {
    readonly controller: ColoringModeController;
    readonly gate: ColoringRenderSurfaceGate;
    dispose(): void;
}
export declare function createDraftBridge(store: WorkspaceStore, logger: PluginLogger): DraftBridge;
