import { floodFillRegion, type FloodFillOptions } from "../algorithms/flood-fill.js";

interface WorkerRequest {
  rgba: ArrayBuffer;
  width: number;
  height: number;
  seedX: number;
  seedY: number;
  options: FloodFillOptions;
}
interface WorkerScope {
  addEventListener(type: "message", listener: (event: { data: WorkerRequest }) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
scope.addEventListener("message", (event) => {
  try {
    const request = event.data;
    const rgba = new Uint8Array(request.rgba);
    const result = floodFillRegion(rgba, request.width, request.height, request.seedX, request.seedY, request.options);
    const maskBuffer = result.mask.buffer as ArrayBuffer;
    scope.postMessage({
      ok: true,
      result: {
        mask: maskBuffer,
        pixelCount: result.pixelCount,
        bounds: result.bounds,
        algorithmVersion: result.algorithmVersion,
      },
    }, [maskBuffer]);
  } catch (error) {
    scope.postMessage({
      ok: false,
      error: {
        name: error instanceof Error ? error.name : "FloodFillWorkerError",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
