import { closeBinaryGaps, countMaskPixels, getMaskBounds, type MaskBounds } from "./mask.js";

export const FLOOD_FILL_ALGORITHM_VERSION = 1;
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
export function floodFillRegion(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  options: FloodFillOptions,
): FloodFillResult {
  validateInputs(rgba, width, height, seedX, seedY, options);
  const tolerance = Math.round(options.tolerance);
  const gapClose = Math.round(options.gapClose);
  const inkThreshold = options.inkThreshold ?? 32;
  const pixelCount = width * height;

  const barriers = new Uint8Array(pixelCount);
  for (let i = 0, p = 0; i < pixelCount; i += 1, p += 4) {
    const alpha = rgba[p + 3];
    if (alpha === 0) continue;
    const luminance = (rgba[p] * 0.2126) + (rgba[p + 1] * 0.7152) + (rgba[p + 2] * 0.0722);
    const inkStrength = luminance < 110 ? alpha * (110 - luminance) / 110 : 0;
    if (inkStrength >= inkThreshold) barriers[i] = 255;
  }
  const closedBarriers = closeBinaryGaps(barriers, width, height, gapClose);

  const sx = Math.floor(seedX);
  const sy = Math.floor(seedY);
  const start = sy * width + sx;
  if (closedBarriers[start] !== 0) throw new Error("The paint-bucket seed is on line art; click inside a closed region.");

  const seedOffset = start * 4;
  const seedR = rgba[seedOffset];
  const seedG = rgba[seedOffset + 1];
  const seedB = rgba[seedOffset + 2];
  const seedA = rgba[seedOffset + 3];
  const visited = new Uint8Array(pixelCount);
  const mask = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;

  if (!matchesSeed(rgba, seedOffset, seedR, seedG, seedB, seedA, tolerance)) {
    return { mask, pixelCount: 0, bounds: null, algorithmVersion: FLOOD_FILL_ALGORITHM_VERSION };
  }
  queue[tail++] = start;
  visited[start] = 1;

  while (head < tail) {
    const index = queue[head++];
    if (closedBarriers[index] !== 0) continue;
    const offset = index * 4;
    if (!matchesSeed(rgba, offset, seedR, seedG, seedB, seedA, tolerance)) continue;
    mask[index] = 255;

    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  return {
    mask,
    pixelCount: countMaskPixels(mask),
    bounds: getMaskBounds(mask, width, height),
    algorithmVersion: FLOOD_FILL_ALGORITHM_VERSION,
  };

  function enqueue(index: number): void {
    if (visited[index] || closedBarriers[index] !== 0) return;
    visited[index] = 1;
    queue[tail++] = index;
  }
}

function matchesSeed(
  rgba: Uint8ClampedArray | Uint8Array,
  offset: number,
  r: number, g: number, b: number, a: number,
  tolerance: number,
): boolean {
  const candidateA = rgba[offset + 3];
  if (a <= 8 && candidateA <= 8) return true;
  if (Math.abs(candidateA - a) > tolerance) return false;
  return Math.max(
    Math.abs(rgba[offset] - r),
    Math.abs(rgba[offset + 1] - g),
    Math.abs(rgba[offset + 2] - b),
  ) <= tolerance;
}

function validateInputs(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  options: FloodFillOptions,
): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new RangeError("Image dimensions must be positive integers.");
  if (rgba.length !== width * height * 4) throw new RangeError("RGBA buffer length does not match image dimensions.");
  if (!Number.isFinite(seedX) || !Number.isFinite(seedY) || seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) {
    throw new RangeError("Paint-bucket seed is outside the source image.");
  }
  if (!Number.isFinite(options.tolerance) || options.tolerance < 0 || options.tolerance > 255) throw new RangeError("tolerance must be between 0 and 255.");
  if (!Number.isInteger(options.gapClose) || options.gapClose < 0 || options.gapClose > 8) throw new RangeError("gapClose must be an integer from 0 to 8.");
  if (options.inkThreshold !== undefined && (!Number.isFinite(options.inkThreshold) || options.inkThreshold < 0 || options.inkThreshold > 255)) {
    throw new RangeError("inkThreshold must be between 0 and 255.");
  }
}

/**
 * Use a module Worker when the host browser provides one so large region scans
 * do not occupy the UI/render thread. The deterministic synchronous algorithm
 * remains the fallback used by tests and constrained embedded webviews.
 */
export function floodFillRegionAsync(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  options: FloodFillOptions,
  signal?: AbortSignal,
): Promise<FloodFillResult> {
  if (signal?.aborted) return Promise.reject(makeAbortError());
  if (typeof Worker === "undefined") {
    return Promise.resolve().then(() => {
      if (signal?.aborted) throw makeAbortError();
      return floodFillRegion(rgba, width, height, seedX, seedY, options);
    });
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL("../workers/flood-fill-worker.js", import.meta.url), { type: "module" });
  } catch {
    // Some embedded hosts expose Worker but disallow module workers by policy.
    return Promise.resolve().then(() => {
      if (signal?.aborted) throw makeAbortError();
      return floodFillRegion(rgba, width, height, seedX, seedY, options);
    });
  }
  const buffer = new Uint8Array(rgba).buffer;
  return new Promise<FloodFillResult>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      callback();
    };
    const onAbort = () => finish(() => reject(makeAbortError()));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    worker.onmessage = (event: MessageEvent<{
      ok: boolean;
      result?: { mask: ArrayBuffer; pixelCount: number; bounds: MaskBounds | null; algorithmVersion: number };
      error?: { name?: string; message?: string };
    }>) => {
      if (!event.data.ok || !event.data.result) {
        const error = new Error(event.data.error?.message ?? "Flood-fill worker failed.");
        error.name = event.data.error?.name ?? "FloodFillWorkerError";
        finish(() => reject(error));
        return;
      }
      finish(() => resolve({ ...event.data.result!, mask: new Uint8Array(event.data.result!.mask) }));
    };
    const runFallback = () => Promise.resolve().then(() => {
      if (signal?.aborted) throw makeAbortError();
      return floodFillRegion(rgba, width, height, seedX, seedY, options);
    });
    worker.onerror = () => finish(() => { void runFallback().then(resolve, reject); });
    worker.onmessageerror = () => finish(() => { void runFallback().then(resolve, reject); });
    try {
      worker.postMessage({
        rgba: buffer,
        width,
        height,
        seedX,
        seedY,
        options,
      }, [buffer]);
    } catch {
      finish(() => { void runFallback().then(resolve, reject); });
    }
  });
}

function makeAbortError(): Error {
  const error = new Error("Flood fill was aborted.");
  error.name = "AbortError";
  return error;
}
