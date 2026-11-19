import type { ColoringRegionData } from "./region-types.js";
export declare function isColoringRegionData(value: unknown): value is ColoringRegionData;
export declare function assertColoringRegionData(value: unknown): asserts value is ColoringRegionData;
export declare function migrateColoringRegionData(value: unknown, fromVersion: number, toVersion: number): ColoringRegionData;
