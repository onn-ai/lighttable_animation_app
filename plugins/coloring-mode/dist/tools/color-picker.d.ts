import type { PluginLogger, ToolDefinition } from "@lighttable/plugin-sdk";
import type { WorkspaceStore } from "../runtime/workspace-store.js";
export interface ColorPickerDependencies {
    workspace: WorkspaceStore;
    logger: PluginLogger;
    renderCel(celId: string, options: {
        background: "transparent";
        intent: "editor";
        signal: AbortSignal;
    }): Promise<{
        bitmap: ImageBitmap;
        width: number;
        height: number;
    }>;
}
export declare function createColorPickerTool(deps: ColorPickerDependencies): ToolDefinition & {
    cancelAll(reason?: string): void;
};
