import { ColoringModeController } from "../../vendor/standalone-coloring-mode/src/index.js";
import { COLOR_RENDER_LAYER_ID } from "../manifest.js";
/** A renderer-local surface. The host compositor remains host-owned. */
export class ColoringRenderSurfaceGate {
    visible = true;
    renderingEnabled = true;
    setVisible(visible) { this.visible = visible; }
    setRenderingEnabled(enabled) { this.renderingEnabled = enabled; }
    isVisible() { return this.visible; }
    isRenderingEnabled() { return this.renderingEnabled; }
    shouldRender() { return this.visible && this.renderingEnabled; }
}
export function createDraftBridge(store, logger) {
    const gate = new ColoringRenderSurfaceGate();
    const controller = new ColoringModeController({
        onChange(snapshot) {
            store.setDraft(snapshot.draft);
            const layer = snapshot.layers[COLOR_RENDER_LAYER_ID];
            if (layer)
                store.setColorLayerEnabled(layer.enabled);
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
            if (disposed)
                return;
            disposed = true;
            controller.destroy();
        },
    };
}
//# sourceMappingURL=draft-bridge.js.map