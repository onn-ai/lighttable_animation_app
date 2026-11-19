import test from "node:test";
import assert from "node:assert/strict";
import { floodFillRegion } from "../../dist/algorithms/flood-fill.js";
import { closeBinaryGaps, countMaskPixels } from "../../dist/algorithms/mask.js";

function rgbaFromRows(rows, palette = { " ": [255,255,255,255], "#": [0,0,0,255], ".": [0,0,0,0] }) {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(palette[rows[y][x]], (y * width + x) * 4);
  }
  return { data, width, height };
}

test("fills a closed single-color region and stops at a line-art boundary", () => {
  const source = rgbaFromRows([
    ".......",
    ".#####.",
    ".#   #.",
    ".#   #.",
    ".#   #.",
    ".#####.",
    ".......",
  ]);
  const result = floodFillRegion(source.data, source.width, source.height, 3, 3, { tolerance: 0, gapClose: 0 });
  assert.equal(result.pixelCount, 9);
  assert.deepEqual(result.bounds, { x: 2, y: 2, width: 3, height: 3 });
  assert.equal(result.mask[3 * 7 + 3], 255);
  assert.equal(result.mask[1 * 7 + 1], 0);
  assert.equal(result.algorithmVersion, 1);
});

test("tolerance admits just-under-threshold color variation and rejects above-threshold variation", () => {
  const source = rgbaFromRows(["   "], { " ": [100,100,100,255] });
  source.data.set([110,100,100,255], 4);
  source.data.set([120,100,100,255], 8);
  const narrow = floodFillRegion(source.data, 3, 1, 0, 0, { tolerance: 10, gapClose: 0 });
  const wide = floodFillRegion(source.data, 3, 1, 0, 0, { tolerance: 20, gapClose: 0 });
  assert.equal(narrow.pixelCount, 2);
  assert.equal(wide.pixelCount, 3);
});

test("transparent pixels are treated as transparent rather than dark ink", () => {
  const source = rgbaFromRows(["...", ". .", "..."]);
  const result = floodFillRegion(source.data, 3, 3, 1, 1, { tolerance: 0, gapClose: 0 });
  assert.equal(result.pixelCount, 1);
  assert.equal(result.mask[4], 255);
});

test("rejects an out-of-bounds seed and a seed on line art", () => {
  const source = rgbaFromRows(["###", "# #", "###"]);
  assert.throws(() => floodFillRegion(source.data, 3, 3, -1, 1, { tolerance: 0, gapClose: 0 }), /outside/);
  assert.throws(() => floodFillRegion(source.data, 3, 3, 0, 0, { tolerance: 0, gapClose: 0 }), /line art/);
});

test("gap closing bridges a one-pixel break in a line-art barrier", () => {
  const source = rgbaFromRows([
    ".......",
    ".#####.",
    ".#   #.",
    ".#   ..",
    ".#   #.",
    ".#####.",
    ".......",
  ], { " ": [0,0,0,0], "#": [0,0,0,255], ".": [0,0,0,0] });
  const open = floodFillRegion(source.data, 7, 7, 3, 3, { tolerance: 0, gapClose: 0 });
  const closed = floodFillRegion(source.data, 7, 7, 3, 3, { tolerance: 0, gapClose: 1 });
  assert.ok(open.pixelCount > closed.pixelCount);
  assert.equal(closed.pixelCount, 9);
});

test("identical inputs produce identical masks", () => {
  const source = rgbaFromRows([".......", ".#####.", ".#   #.", ".#   #.", ".#####.", "......."]);
  const a = floodFillRegion(source.data, 7, 6, 3, 2, { tolerance: 12, gapClose: 1 });
  const b = floodFillRegion(source.data, 7, 6, 3, 2, { tolerance: 12, gapClose: 1 });
  assert.deepEqual(a.mask, b.mask);
  assert.equal(countMaskPixels(a.mask), a.pixelCount);
});

test("binary gap closing preserves a fully closed boundary", () => {
  const barrier = Uint8Array.from([0,255,0, 255,0,255, 0,255,0]);
  const closed = closeBinaryGaps(barrier, 3, 3, 1);
  assert.equal(closed.length, 9);
});

test("async flood fill uses the deterministic fallback when Worker is unavailable", async () => {
  const { floodFillRegionAsync } = await import("../../dist/algorithms/flood-fill.js");
  const source = rgbaFromRows([".....", ".###.", ".# #.", ".###.", "....."]);
  const expected = floodFillRegion(source.data, 5, 5, 2, 2, { tolerance: 0, gapClose: 0 });
  const originalWorker = globalThis.Worker;
  try {
    delete globalThis.Worker;
    const actual = await floodFillRegionAsync(source.data, 5, 5, 2, 2, { tolerance: 0, gapClose: 0 });
    assert.deepEqual(actual.mask, expected.mask);
    assert.equal(actual.pixelCount, expected.pixelCount);
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test("async flood fill falls back if a module Worker fails at runtime", async () => {
  const { floodFillRegionAsync } = await import("../../dist/algorithms/flood-fill.js");
  const source = rgbaFromRows([".....", ".###.", ".# #.", ".###.", "....."]);
  const expected = floodFillRegion(source.data, 5, 5, 2, 2, { tolerance: 0, gapClose: 0 });
  const originalWorker = globalThis.Worker;
  class FailingWorker {
    onerror = null;
    onmessage = null;
    onmessageerror = null;
    postMessage() { queueMicrotask(() => this.onerror?.({ message: "worker load failed" })); }
    terminate() {}
  }
  try {
    globalThis.Worker = FailingWorker;
    const actual = await floodFillRegionAsync(source.data, 5, 5, 2, 2, { tolerance: 0, gapClose: 0 });
    assert.deepEqual(actual.mask, expected.mask);
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});
