import { REGION_NODE_VERSION } from "../manifest.js";
import type { ColoringRegionData } from "./region-types.js";

const COLOR_RE = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isColoringRegionData(value: unknown): value is ColoringRegionData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const seed = data.seed as Record<string, unknown> | null;
  return typeof data.maskAssetId === "string" && data.maskAssetId.length > 0
    && Number.isInteger(data.maskWidth) && Number(data.maskWidth) > 0
    && Number.isInteger(data.maskHeight) && Number(data.maskHeight) > 0
    && typeof data.color === "string" && COLOR_RE.test(data.color)
    && typeof data.opacity === "number" && Number.isFinite(data.opacity) && data.opacity >= 0 && data.opacity <= 1
    && !!seed && typeof seed === "object"
    && typeof seed.x === "number" && Number.isFinite(seed.x)
    && typeof seed.y === "number" && Number.isFinite(seed.y)
    && Array.isArray(data.sourceLayerIds) && data.sourceLayerIds.every((id) => typeof id === "string" && id.length > 0)
    && Number.isInteger(data.algorithmVersion) && Number(data.algorithmVersion) >= 1
    && typeof data.tolerance === "number" && Number.isFinite(data.tolerance) && data.tolerance >= 0 && data.tolerance <= 255
    && Number.isInteger(data.gapClose) && Number(data.gapClose) >= 0 && Number(data.gapClose) <= 8;
}

export function assertColoringRegionData(value: unknown): asserts value is ColoringRegionData {
  if (!isColoringRegionData(value)) throw new TypeError("Invalid com.lighttable.coloring.region v1 payload.");
}

export function migrateColoringRegionData(value: unknown, fromVersion: number, toVersion: number): ColoringRegionData {
  if (toVersion !== REGION_NODE_VERSION || fromVersion !== 1) {
    throw new RangeError(`Unsupported coloring-region migration ${fromVersion} -> ${toVersion}.`);
  }
  assertColoringRegionData(value);
  return {
    ...value,
    seed: { ...value.seed },
    sourceLayerIds: [...value.sourceLayerIds],
  };
}
