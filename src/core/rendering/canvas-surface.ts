/** Clear every backing-store pixel, independent of the context's current transform. */
export function clearCanvasInDeviceSpace(
  context: Pick<CanvasRenderingContext2D, 'setTransform' | 'clearRect'>,
  width: number,
  height: number,
): void {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
}
