import { type MaskBounds } from "./mask.js";
export declare const FLOOD_FILL_ALGORITHM_VERSION = 1;
export interface FloodFillOptions {
    tolerance: number;
    gapClose: number;
    inkThreshold?: number;
}
export interface FloodFillResult {
    mask: Uint8Array;
    pixelCount: number;
    bounds: MaskBounds | null;
    algorithmVersion: number;
}
/**
 * Deterministic four-connected region fill on an RGBA source surface.
 * Dark/opaque line-art pixels form barriers; transparent pixels are not
 * mistaken for ink. Tolerance limits the source-color delta from the seed.
 */
export declare function floodFillRegion(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, seedX: number, seedY: number, options: FloodFillOptions): FloodFillResult;
/**
 * Use a module Worker when the host browser provides one so large region scans
 * do not occupy the UI/render thread. The deterministic synchronous algorithm
 * remains the fallback used by tests and constrained embedded webviews.
 */
export declare function floodFillRegionAsync(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, seedX: number, seedY: number, options: FloodFillOptions, signal?: AbortSignal): Promise<FloodFillResult>;
