import type { JsonValue } from "@lighttable/plugin-sdk";
export interface ColoringRegionData {
    [key: string]: JsonValue;
    maskAssetId: string;
    maskWidth: number;
    maskHeight: number;
    color: string;
    opacity: number;
    seed: {
        x: number;
        y: number;
    };
    sourceLayerIds: string[];
    algorithmVersion: number;
    tolerance: number;
    gapClose: number;
}
