import type { NodePrepareContext, NodeRenderContext, NodeRenderer, PluginLogger } from "@lighttable/plugin-sdk";
import { REGION_NODE_TYPE, REGION_NODE_VERSION } from "../manifest.js";
import { assertColoringRegionData, isColoringRegionData } from "./region-schema.js";
import type { ColoringRegionData } from "./region-types.js";

export interface ColorRenderGate {
  isVisible(): boolean;
  isRenderingEnabled(): boolean;
}

interface PreparedSurface {
  readonly drawable: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

export type SurfaceFactory = (width: number, height: number) => OffscreenCanvas | HTMLCanvasElement;

/**
 * Node renderer for persistent alpha-mask regions. The host applies each
 * node's transform before render(); this renderer deliberately does not.
 */
export function createColoringRegionRenderer(
  assets: NodePrepareContext["assets"] | undefined,
  gate: ColorRenderGate,
  logger: PluginLogger,
  options: { createSurface?: SurfaceFactory; rendererVersion?: string } = {},
): NodeRenderer<ColoringRegionData> & { dispose(): void; prepareWithContext(data: ColoringRegionData, context: NodePrepareContext): Promise<void> } {
  const rendererVersion = options.rendererVersion ?? "1";
  const createSurface = options.createSurface ?? defaultSurfaceFactory;
  const maskBytesByHash = new Map<string, Uint8Array>();
  const preparedByKey = new Map<string, PreparedSurface>();

  function dataKey(data: ColoringRegionData, sha256: string): string {
    return [sha256, rendererVersion, data.maskWidth, data.maskHeight, data.color.toLowerCase(), data.opacity].join(":");
  }

  async function prepareWithContext(data: ColoringRegionData, context: NodePrepareContext): Promise<void> {
    assertColoringRegionData(data);
    if (context.signal?.aborted) throw abortError();
    const descriptor = context.assets.getDescriptor(data.maskAssetId);
    if (!descriptor) return reportAssetFailure(data, "mask-descriptor-missing", `Mask asset descriptor ${data.maskAssetId} is missing.`);
    const cacheKey = dataKey(data, descriptor.sha256);
    if (preparedByKey.has(cacheKey)) return;

    let mask = maskBytesByHash.get(`${descriptor.sha256}:${rendererVersion}`);
    if (!mask) {
      const blob = await context.assets.get(data.maskAssetId);
      if (context.signal?.aborted) throw abortError();
      if (!blob) return reportAssetFailure(data, "mask-asset-missing", `Mask asset ${data.maskAssetId} could not be loaded.`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length !== data.maskWidth * data.maskHeight) {
        return reportAssetFailure(data, "mask-asset-corrupt", `Mask asset ${data.maskAssetId} has ${bytes.length} bytes; expected ${data.maskWidth * data.maskHeight}.`);
      }
      mask = bytes;
      maskBytesByHash.set(`${descriptor.sha256}:${rendererVersion}`, mask);
    }

    if (context.signal?.aborted) throw abortError();
    const surface = createSurface(data.maskWidth, data.maskHeight);
    const ctx = surface.getContext("2d");
    if (!ctx) return reportAssetFailure(data, "mask-surface-unavailable", "A 2D surface could not be created for a coloring region.");
    const image = ctx.createImageData(data.maskWidth, data.maskHeight);
    const rgba = parseColor(data.color);
    for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
      image.data[p] = rgba.r;
      image.data[p + 1] = rgba.g;
      image.data[p + 2] = rgba.b;
      image.data[p + 3] = Math.round(mask[i] * data.opacity * rgba.a);
    }
    ctx.putImageData(image, 0, 0);

    let drawable: CanvasImageSource = surface as CanvasImageSource;
    if (typeof createImageBitmap === "function") {
      drawable = await createImageBitmap(surface as ImageBitmapSource);
      if (context.signal?.aborted) {
        if ("close" in drawable && typeof drawable.close === "function") drawable.close();
        throw abortError();
      }
    }
    if (preparedByKey.has(cacheKey)) {
      const redundant = drawable as CanvasImageSource & { close?: () => void };
      if (typeof redundant.close === "function") redundant.close();
      return;
    }
    preparedByKey.set(cacheKey, {
      drawable,
      width: data.maskWidth,
      height: data.maskHeight,
    });
  }

  function reportAssetFailure(data: ColoringRegionData, code: string, message: string): never {
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

  const renderer: NodeRenderer<ColoringRegionData> & { dispose(): void; prepareWithContext(data: ColoringRegionData, context: NodePrepareContext): Promise<void> } = {
    type: REGION_NODE_TYPE,
    supportedVersions: { min: REGION_NODE_VERSION, max: REGION_NODE_VERSION },
    validate: isColoringRegionData,
    getLocalBounds(data) {
      return { x: 0, y: 0, width: data.maskWidth, height: data.maskHeight };
    },
    async prepare(data, context) {
      await prepareWithContext(data as unknown as ColoringRegionData, context);
    },
    prepareWithContext,
    render(data, context) {
      const value = data as unknown as ColoringRegionData;
      // Draft controller calls setVisible(false) before it closes this gate.
      // Check both flags so either transition independently suppresses output.
      if (!gate.isVisible() || !gate.isRenderingEnabled()) return;
      const descriptorHash = assets?.getDescriptor(value.maskAssetId)?.sha256;
      const key = descriptorHash ? dataKey(value, descriptorHash) : undefined;
      const prepared = key ? preparedByKey.get(key) : undefined;
      if (!prepared) throw new Error(`Coloring region ${data.maskAssetId} was rendered before its mask was prepared.`);
      context.ctx.save();
      try {
        context.ctx.drawImage(prepared.drawable, 0, 0, prepared.width, prepared.height);
      } finally {
        context.ctx.restore();
      }
    },
    dispose() {
      for (const item of preparedByKey.values()) {
        const drawable = item.drawable as CanvasImageSource & { close?: () => void };
        if (typeof drawable.close === "function") drawable.close();
      }
      preparedByKey.clear();
      maskBytesByHash.clear();
    },
  };

  return renderer;
}

function parseColor(color: string): { r: number; g: number; b: number; a: number } {
  const value = color.slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
    a: value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) / 255 : 1,
  };
}

function defaultSurfaceFactory(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof globalThis.document !== "undefined") {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("Coloring region preparation requires OffscreenCanvas or a document canvas.");
}

function abortError(): Error {
  const error = new Error("Coloring region preparation was aborted.");
  error.name = "AbortError";
  return error;
}
