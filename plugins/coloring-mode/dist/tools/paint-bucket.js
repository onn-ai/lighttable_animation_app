import { floodFillRegionAsync } from "../algorithms/flood-fill.js";
import { REGION_NODE_TYPE, REGION_NODE_VERSION } from "../manifest.js";
export function createPaintBucketTool(deps) {
    const active = new Map();
    const cancelAll = (reason = "plugin-disabled") => {
        for (const job of active.values()) {
            job.abort.abort();
            job.gesture.cancel(reason);
        }
        active.clear();
    };
    return {
        id: "paint-bucket",
        name: "Paint Bucket",
        icon: "paint-bucket",
        tooltip: "Fill a closed region from selected source layers",
        category: "coloring",
        cursor: "crosshair",
        onPointerDown(sample, context) {
            const target = context.getActiveTarget();
            if (!target) {
                deps.logger.warn("Paint bucket requires an active edit target.", { code: "coloring-target-missing" });
                return;
            }
            const layer = context.document.getLayer(target.celId, target.layerId);
            const track = context.document.getTrack(target.trackId);
            if (!layer || layer.locked || track?.locked) {
                deps.logger.warn("Paint bucket cannot edit a missing or locked target.", { code: "coloring-target-locked", layerId: target.layerId });
                return;
            }
            const state = deps.workspace.getSnapshot();
            const selected = state.palette.find((entry) => entry.id === state.selectedColorId);
            if (!selected)
                return;
            const previous = active.get(sample.pointerId);
            if (previous) {
                previous.abort.abort();
                previous.gesture.cancel("user-cancel");
                active.delete(sample.pointerId);
            }
            const gesture = context.beginGesture({ label: "Paint bucket fill", pointerId: sample.pointerId });
            active.set(sample.pointerId, {
                pointerId: sample.pointerId,
                gesture,
                abort: new AbortController(),
                context,
                target,
                baseRevision: context.document.getInfo().revision,
                sourceLayerIds: [...state.options.sourceLayerIds],
                tolerance: state.options.tolerance,
                gapClose: state.options.gapClose,
                color: selected.color,
                opacity: state.options.opacity,
                point: { x: sample.document.x, y: sample.document.y },
            });
        },
        onPointerMove(sample) {
            const job = active.get(sample.pointerId);
            if (job && !job.abort.signal.aborted)
                job.point = { x: sample.document.x, y: sample.document.y };
        },
        onPointerUp(sample) {
            const job = active.get(sample.pointerId);
            if (!job)
                return;
            job.point = { x: sample.document.x, y: sample.document.y };
            void runFill(job, deps).finally(() => {
                if (active.get(sample.pointerId) === job)
                    active.delete(sample.pointerId);
            });
        },
        onCancel(reason) { cancelAll(reason); },
        onDeactivate() { cancelAll("tool-change"); },
        cancelAll,
    };
}
async function runFill(job, deps) {
    let bitmap;
    try {
        if (job.abort.signal.aborted)
            return;
        const currentTarget = job.context.getActiveTarget();
        if (!currentTarget || currentTarget.celId !== job.target.celId || currentTarget.layerId !== job.target.layerId) {
            throw new Error("The active edit target changed before the fill could be committed.");
        }
        const source = job.context.document.getCel(job.target.celId);
        const validSourceIds = job.sourceLayerIds.filter((id) => source?.layers.some((layer) => layer.id === id && layer.visible && !layer.locked));
        if (validSourceIds.length === 0)
            throw new Error("Choose at least one visible, unlocked source / line-art layer in Coloring options.");
        const info = job.context.document.getInfo();
        job.context.reportProgress?.({ fraction: 0.08, message: "Rendering selected line-art layers" });
        const rendered = await deps.renderCel(job.target.celId, {
            layerIds: validSourceIds,
            width: info.width,
            height: info.height,
            background: "transparent",
            intent: "editor",
            signal: job.abort.signal,
        });
        bitmap = rendered.bitmap;
        if (job.abort.signal.aborted)
            return;
        const rgba = readBitmapPixels(bitmap, rendered.width, rendered.height);
        job.context.reportProgress?.({ fraction: 0.45, message: "Detecting closed region" });
        const fill = await floodFillRegionAsync(rgba, rendered.width, rendered.height, job.point.x, job.point.y, {
            tolerance: job.tolerance,
            gapClose: job.gapClose,
        }, job.abort.signal);
        if (fill.pixelCount === 0)
            throw new Error("No fillable region was found at that point.");
        if (job.abort.signal.aborted)
            return;
        const maskBlob = new Blob([fill.mask.slice().buffer], { type: "application/x-lighttable-alpha-mask" });
        job.context.reportProgress?.({ fraction: 0.76, message: "Storing region mask" });
        const asset = await deps.assets.put(maskBlob, { fileName: `coloring-region-${Date.now()}.mask` });
        if (job.abort.signal.aborted)
            return;
        const region = {
            maskAssetId: asset.id,
            maskWidth: rendered.width,
            maskHeight: rendered.height,
            color: job.color,
            opacity: job.opacity,
            seed: { x: job.point.x, y: job.point.y },
            sourceLayerIds: validSourceIds,
            algorithmVersion: fill.algorithmVersion,
            tolerance: job.tolerance,
            gapClose: job.gapClose,
        };
        const node = {
            id: makeNodeId(),
            type: REGION_NODE_TYPE,
            typeVersion: REGION_NODE_VERSION,
            transform: [1, 0, 0, 1, 0, 0],
            visible: true,
            data: region,
        };
        if (job.abort.signal.aborted)
            return;
        const result = job.gesture.commit({ label: "Paint bucket fill", expectedRevision: job.baseRevision, undoable: true }, (tx) => tx.nodes.insert({ celId: job.target.celId, layerId: job.target.layerId, node }));
        if (!result.committed)
            throw new Error(`Fill was not committed because the document changed (revision ${result.revision}).`);
        job.context.reportProgress?.({ fraction: 1, message: `Filled ${fill.pixelCount.toLocaleString()} pixels` });
    }
    catch (error) {
        if (!job.abort.signal.aborted) {
            job.gesture.cancel("user-cancel");
            deps.logger.warn("Paint bucket fill was not committed.", {
                code: "coloring-fill-cancelled",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    finally {
        bitmap?.close();
    }
}
function readBitmapPixels(bitmap, width, height) {
    let surface;
    if (typeof OffscreenCanvas !== "undefined")
        surface = new OffscreenCanvas(width, height);
    else if (typeof globalThis.document !== "undefined") {
        const canvas = globalThis.document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        surface = canvas;
    }
    else
        throw new Error("Paint bucket readback requires OffscreenCanvas or a document canvas.");
    const ctx = surface.getContext("2d");
    if (!ctx)
        throw new Error("Could not create a 2D readback context for the source image.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
}
function makeNodeId() {
    return globalThis.crypto?.randomUUID?.() ?? `color-region-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
export function isPaintBucketPointerSample(sample) {
    return Number.isFinite(sample.document.x) && Number.isFinite(sample.document.y);
}
//# sourceMappingURL=paint-bucket.js.map