import { REGION_NODE_TYPE, REGION_NODE_VERSION } from "../manifest.js";
import { assertColoringRegionData, isColoringRegionData } from "./region-schema.js";
/**
 * Node renderer for persistent alpha-mask regions. The host applies each
 * node's transform before render(); this renderer deliberately does not.
 */
export function createColoringRegionRenderer(assets, gate, logger, options = {}) {
    const rendererVersion = options.rendererVersion ?? "1";
    const createSurface = options.createSurface ?? defaultSurfaceFactory;
    const maskBytesByHash = new Map();
    const preparedByKey = new Map();
    function dataKey(data, sha256) {
        return [sha256, rendererVersion, data.maskWidth, data.maskHeight, data.color.toLowerCase(), data.opacity].join(":");
    }
    async function prepareWithContext(data, context) {
        assertColoringRegionData(data);
        if (context.signal?.aborted)
            throw abortError();
        const descriptor = context.assets.getDescriptor(data.maskAssetId);
        if (!descriptor)
            return reportAssetFailure(data, "mask-descriptor-missing", `Mask asset descriptor ${data.maskAssetId} is missing.`);
        const cacheKey = dataKey(data, descriptor.sha256);
        if (preparedByKey.has(cacheKey))
            return;
        let mask = maskBytesByHash.get(`${descriptor.sha256}:${rendererVersion}`);
        if (!mask) {
            const blob = await context.assets.get(data.maskAssetId);
            if (context.signal?.aborted)
                throw abortError();
            if (!blob)
                return reportAssetFailure(data, "mask-asset-missing", `Mask asset ${data.maskAssetId} could not be loaded.`);
            const bytes = new Uint8Array(await blob.arrayBuffer());
            if (bytes.length !== data.maskWidth * data.maskHeight) {
                return reportAssetFailure(data, "mask-asset-corrupt", `Mask asset ${data.maskAssetId} has ${bytes.length} bytes; expected ${data.maskWidth * data.maskHeight}.`);
            }
            mask = bytes;
            maskBytesByHash.set(`${descriptor.sha256}:${rendererVersion}`, mask);
        }
        if (context.signal?.aborted)
            throw abortError();
        const surface = createSurface(data.maskWidth, data.maskHeight);
        const ctx = surface.getContext("2d");
        if (!ctx)
            return reportAssetFailure(data, "mask-surface-unavailable", "A 2D surface could not be created for a coloring region.");
        const image = ctx.createImageData(data.maskWidth, data.maskHeight);
        const rgba = parseColor(data.color);
        for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
            image.data[p] = rgba.r;
            image.data[p + 1] = rgba.g;
            image.data[p + 2] = rgba.b;
            image.data[p + 3] = Math.round(mask[i] * data.opacity * rgba.a);
        }
        ctx.putImageData(image, 0, 0);
        let drawable = surface;
        if (typeof createImageBitmap === "function") {
            drawable = await createImageBitmap(surface);
            if (context.signal?.aborted) {
                if ("close" in drawable && typeof drawable.close === "function")
                    drawable.close();
                throw abortError();
            }
        }
        if (preparedByKey.has(cacheKey)) {
            const redundant = drawable;
            if (typeof redundant.close === "function")
                redundant.close();
            return;
        }
        preparedByKey.set(cacheKey, {
            drawable,
            width: data.maskWidth,
            height: data.maskHeight,
        });
    }
    function reportAssetFailure(data, code, message) {
        logger.error(message, {
            code,
            nodeType: REGION_NODE_TYPE,
            maskAssetId: data.maskAssetId,
            algorithmVersion: data.algorithmVersion,
        });
        const error = new Error(message);
        error.name = "ColoringRegionAssetError";
        throw error;
    }
    const renderer = {
        type: REGION_NODE_TYPE,
        supportedVersions: { min: REGION_NODE_VERSION, max: REGION_NODE_VERSION },
        validate: isColoringRegionData,
        getLocalBounds(data) {
            return { x: 0, y: 0, width: data.maskWidth, height: data.maskHeight };
        },
        async prepare(data, context) {
            await prepareWithContext(data, context);
        },
        prepareWithContext,
        render(data, context) {
            const value = data;
            // Draft controller calls setVisible(false) before it closes this gate.
            // Check both flags so either transition independently suppresses output.
            if (!gate.isVisible() || !gate.isRenderingEnabled())
                return;
            const descriptorHash = assets?.getDescriptor(value.maskAssetId)?.sha256;
            const key = descriptorHash ? dataKey(value, descriptorHash) : undefined;
            const prepared = key ? preparedByKey.get(key) : undefined;
            if (!prepared)
                throw new Error(`Coloring region ${data.maskAssetId} was rendered before its mask was prepared.`);
            context.ctx.save();
            try {
                context.ctx.drawImage(prepared.drawable, 0, 0, prepared.width, prepared.height);
            }
            finally {
                context.ctx.restore();
            }
        },
        dispose() {
            for (const item of preparedByKey.values()) {
                const drawable = item.drawable;
                if (typeof drawable.close === "function")
                    drawable.close();
            }
            preparedByKey.clear();
            maskBytesByHash.clear();
        },
    };
    return renderer;
}
function parseColor(color) {
    const value = color.slice(1);
    return {
        r: Number.parseInt(value.slice(0, 2), 16),
        g: Number.parseInt(value.slice(2, 4), 16),
        b: Number.parseInt(value.slice(4, 6), 16),
        a: value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) / 255 : 1,
    };
}
function defaultSurfaceFactory(width, height) {
    if (typeof OffscreenCanvas !== "undefined")
        return new OffscreenCanvas(width, height);
    if (typeof globalThis.document !== "undefined") {
        const canvas = globalThis.document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
    throw new Error("Coloring region preparation requires OffscreenCanvas or a document canvas.");
}
function abortError() {
    const error = new Error("Coloring region preparation was aborted.");
    error.name = "AbortError";
    return error;
}
//# sourceMappingURL=region-renderer.js.map