/** Alpha-mask helpers. A mask is one unsigned byte per document pixel. */
export interface MaskBounds { x: number; y: number; width: number; height: number }

export function getMaskBounds(mask: Uint8Array, width: number, height: number): MaskBounds | null {
  if (mask.length !== width * height) throw new RangeError("Mask dimensions do not match its data length.");
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function countMaskPixels(mask: Uint8Array): number {
  let count = 0;
  for (const value of mask) if (value > 0) count += 1;
  return count;
}

/**
 * Bridge short, completely enclosed gaps in horizontal or vertical line-art
 * runs. Unlike full binary morphology this does not fill small enclosed paint
 * regions; it only fills a zero run whose two endpoints are barrier pixels.
 */
export function closeBinaryGaps(input: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (input.length !== width * height) throw new RangeError("Barrier dimensions do not match its data length.");
  if (!Number.isInteger(radius) || radius < 0 || radius > 8) throw new RangeError("gapClose must be an integer from 0 to 8.");
  const output = input.slice();
  if (radius === 0) return output;

  for (let y = 0; y < height; y += 1) {
    bridgeRuns(output, width, y, 1, radius);
  }
  for (let x = 0; x < width; x += 1) {
    bridgeRuns(output, height, x, width, radius);
  }
  return output;
}

function bridgeRuns(buffer: Uint8Array, length: number, start: number, stride: number, maxGap: number): void {
  let previousBarrier = -1;
  for (let position = 0; position < length; position += 1) {
    if (buffer[start + position * stride] === 0) continue;
    if (previousBarrier >= 0) {
      const gap = position - previousBarrier - 1;
      if (gap > 0 && gap <= maxGap) {
        for (let fill = previousBarrier + 1; fill < position; fill += 1) buffer[start + fill * stride] = 255;
      }
    }
    previousBarrier = position;
  }
}
