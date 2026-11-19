import { floodFillRegion } from "../algorithms/flood-fill.js";
const scope = globalThis;
scope.addEventListener("message", (event) => {
    try {
        const request = event.data;
        const rgba = new Uint8Array(request.rgba);
        const result = floodFillRegion(rgba, request.width, request.height, request.seedX, request.seedY, request.options);
        const maskBuffer = result.mask.buffer;
        scope.postMessage({
            ok: true,
            result: {
                mask: maskBuffer,
                pixelCount: result.pixelCount,
                bounds: result.bounds,
                algorithmVersion: result.algorithmVersion,
            },
        }, [maskBuffer]);
    }
    catch (error) {
        scope.postMessage({
            ok: false,
            error: {
                name: error instanceof Error ? error.name : "FloodFillWorkerError",
                message: error instanceof Error ? error.message : String(error),
            },
        });
    }
});
//# sourceMappingURL=flood-fill-worker.js.map