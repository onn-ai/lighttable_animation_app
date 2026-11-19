import type { AssetApi, PluginLogger, PointerSample, ToolDefinition } from "@lighttable/plugin-sdk";
import type { WorkspaceStore } from "../runtime/workspace-store.js";
export interface PaintBucketDependencies {
    assets: AssetApi;
    workspace: WorkspaceStore;
    logger: PluginLogger;
    renderCel(celId: string, options: {
        layerIds: readonly string[];
        width: number;
        height: number;
        background: "transparent";
        intent: "editor";
        signal: AbortSignal;
    }): Promise<{
        bitmap: ImageBitmap;
        width: number;
        height: number;
    }>;
}
export declare function createPaintBucketTool(deps: PaintBucketDependencies): ToolDefinition & {
    cancelAll(reason?: "pointercancel" | "lostpointercapture" | "mode-change" | "tool-change" | "plugin-disabled" | "project-close" | "app-suspended" | "user-cancel"): void;
};
export declare function isPaintBucketPointerSample(sample: PointerSample): boolean;
