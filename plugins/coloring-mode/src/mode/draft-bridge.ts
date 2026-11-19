import { ColoringModeController } from "../../vendor/standalone-coloring-mode/src/index.js";
import type { PluginLogger } from "@lighttable/plugin-sdk";
import { COLOR_RENDER_LAYER_ID } from "../manifest.js";
import type { WorkspaceStore } from "../runtime/workspace-store.js";

/** A renderer-local surface. The host compositor remains host-owned. */
export class ColoringRenderSurfaceGate {
  private visible = true;
  private renderingEnabled = true;

  setVisible(visible: boolean): void { this.visible = visible; }
  setRenderingEnabled(enabled: boolean): void { this.renderingEnabled = enabled; }
  isVisible(): boolean { return this.visible; }
  isRenderingEnabled(): boolean { return this.renderingEnabled; }
  shouldRender(): boolean { return this.visible && this.renderingEnabled; }
}

export interface DraftBridge {
  readonly controller: ColoringModeController;
  readonly gate: ColoringRenderSurfaceGate;
  dispose(): void;
}

export function createDraftBridge(store: WorkspaceStore, logger: PluginLogger): DraftBridge {
  const gate = new ColoringRenderSurfaceGate();
  const controller = new ColoringModeController({
    onChange(snapshot) {
      store.setDraft(snapshot.draft);
      const layer = snapshot.layers[COLOR_RENDER_LAYER_ID];
      if (layer) store.setColorLayerEnabled(layer.enabled);
    },
    onError(error) {
      logger.error("A coloring Draft-mode surface adapter failed.", {
        code: "coloring-draft-adapter-error",
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });
  controller.registerColorLayer(COLOR_RENDER_LAYER_ID, {
    setVisible: (visible) => gate.setVisible(visible),
    setRenderingEnabled: (enabled) => gate.setRenderingEnabled(enabled),
  }, { enabled: true });

  let disposed = false;
  return {
    controller,
    gate,
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.destroy();
    },
  };
}
