/** Alpha-mask helpers. A mask is one unsigned byte per document pixel. */
export interface MaskBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}
export declare function getMaskBounds(mask: Uint8Array, width: number, height: number): MaskBounds | null;
export declare function countMaskPixels(mask: Uint8Array): number;
/**
 * Bridge short, completely enclosed gaps in horizontal or vertical line-art
 * runs. Unlike full binary morphology this does not fill small enclosed paint
 * regions; it only fills a zero run whose two endpoints are barrier pixels.
 */
export declare function closeBinaryGaps(input: Uint8Array, width: number, height: number, radius: number): Uint8Array;
