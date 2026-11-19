export function createColorPickerTool(deps) {
    const active = new Map();
    const cancelAll = () => {
        for (const job of active.values())
            job.abort.abort();
        active.clear();
    };
    return {
        id: "color-picker",
        name: "Color Picker",
        icon: "eyedropper",
        tooltip: "Sample a color from the current cel",
        category: "coloring",
        cursor: "crosshair",
        onPointerDown(sample, context) {
            const target = context.getActiveTarget();
            if (!target)
                return;
            active.get(sample.pointerId)?.abort.abort();
            active.set(sample.pointerId, {
                abort: new AbortController(),
                celId: target.celId,
                x: sample.document.x,
                y: sample.document.y,
            });
        },
        onPointerMove(sample) {
            const job = active.get(sample.pointerId);
            if (job) {
                job.x = sample.document.x;
                job.y = sample.document.y;
            }
        },
        onPointerUp(sample) {
            const job = active.get(sample.pointerId);
            if (!job)
                return;
            job.x = sample.document.x;
            job.y = sample.document.y;
            void sampleColor(job, deps).finally(() => {
                if (active.get(sample.pointerId) === job)
                    active.delete(sample.pointerId);
            });
        },
        onCancel() { cancelAll(); },
        onDeactivate() { cancelAll(); },
        cancelAll,
    };
}
async function sampleColor(job, deps) {
    let bitmap;
    try {
        const rendered = await deps.renderCel(job.celId, {
            background: "transparent",
            intent: "editor",
            signal: job.abort.signal,
        });
        bitmap = rendered.bitmap;
        if (job.abort.signal.aborted)
            return;
        const x = Math.floor(job.x);
        const y = Math.floor(job.y);
        if (x < 0 || y < 0 || x >= rendered.width || y >= rendered.height)
            throw new RangeError("Color-picker sample is outside the document.");
        const surface = createReadbackSurface(rendered.width, rendered.height);
        const ctx = surface.getContext("2d");
        if (!ctx)
            throw new Error("Could not create a 2D readback context for the color picker.");
        ctx.drawImage(bitmap, 0, 0, rendered.width, rendered.height);
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        if (pixel[3] < 4)
            throw new Error("The sampled point is transparent.");
        const hex = `#${toHex(pixel[0])}${toHex(pixel[1])}${toHex(pixel[2])}${pixel[3] < 255 ? toHex(pixel[3]) : ""}`;
        deps.workspace.setSelectedColor(hex, "Picked color");
    }
    catch (error) {
        if (!job.abort.signal.aborted)
            deps.logger.info("Color picker did not sample a color.", {
                code: "coloring-pick-empty",
                message: error instanceof Error ? error.message : String(error),
            });
    }
    finally {
        bitmap?.close();
    }
}
function createReadbackSurface(width, height) {
    if (typeof OffscreenCanvas !== "undefined")
        return new OffscreenCanvas(width, height);
    if (typeof globalThis.document !== "undefined") {
        const canvas = globalThis.document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
    throw new Error("Color picker requires OffscreenCanvas or a document canvas.");
}
function toHex(value) { return Math.round(value).toString(16).padStart(2, "0").toUpperCase(); }
//# sourceMappingURL=color-picker.js.map