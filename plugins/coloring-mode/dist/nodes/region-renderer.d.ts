import type { NodePrepareContext, NodeRenderer, PluginLogger } from "@lighttable/plugin-sdk";
import type { ColoringRegionData } from "./region-types.js";
export interface ColorRenderGate {
    isVisible(): boolean;
    isRenderingEnabled(): boolean;
}
export type SurfaceFactory = (width: number, height: number) => OffscreenCanvas | HTMLCanvasElement;
/**
 * Node renderer for persistent alpha-mask regions. The host applies each
 * node's transform before render(); this renderer deliberately does not.
 */
export declare function createColoringRegionRenderer(assets: NodePrepareContext["assets"] | undefined, gate: ColorRenderGate, logger: PluginLogger, options?: {
    createSurface?: SurfaceFactory;
    rendererVersion?: string;
}): NodeRenderer<ColoringRegionData> & {
    dispose(): void;
    prepareWithContext(data: ColoringRegionData, context: NodePrepareContext): Promise<void>;
};
