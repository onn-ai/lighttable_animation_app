import type { LightTablePlugin, PluginApi, PluginActivationContext } from "@lighttable/plugin-sdk";
import { runtimeManifest } from "./manifest.js";
import { createDraftBridge, type DraftBridge } from "./mode/draft-bridge.js";
import { createColoringRegionRenderer } from "./nodes/region-renderer.js";
import { PalettePanel } from "./panels/palette-panel.js";
import { ColoringOptionsPanel } from "./panels/coloring-options-panel.js";
import { attachPanelRuntime, detachPanelRuntime } from "./runtime/panel-context.js";
import { WorkspaceStore } from "./runtime/workspace-store.js";
import { createPaintBucketTool } from "./tools/paint-bucket.js";
import { createColorPickerTool } from "./tools/color-picker.js";

let currentApi: PluginApi | undefined;
let workspace: WorkspaceStore | undefined;
let draftBridge: DraftBridge | undefined;
let regionRenderer: ReturnType<typeof createColoringRegionRenderer> | undefined;
let paintBucket: ReturnType<typeof createPaintBucketTool> | undefined;
let colorPicker: ReturnType<typeof createColorPickerTool> | undefined;

async function activate(api: PluginApi, context: PluginActivationContext): Promise<void> {
  if (currentApi) await deactivate("disable");
  currentApi = api;
  workspace = new WorkspaceStore();

  try {
    await workspace.load(api.storage);
    if (context.signal.aborted) throw new Error("Coloring Mode activation was aborted.");

    draftBridge = createDraftBridge(workspace, api.logger);
    attachPanelRuntime(workspace, draftBridge.controller);
    regionRenderer = createColoringRegionRenderer(api.assets, draftBridge.gate, api.logger);

    paintBucket = createPaintBucketTool({
      assets: api.assets,
      workspace,
      logger: api.logger,
      renderCel: (celId, options) => api.render.renderCel(celId, options),
    });
    colorPicker = createColorPickerTool({
      workspace,
      logger: api.logger,
      renderCel: (celId, options) => api.render.renderCel(celId, options),
    });

    const add = <T extends { dispose(): void }>(registration: T): T => api.registrations.add(registration);

    add(api.renderers.registerNode(regionRenderer));
    // The host gate suppresses this node family before both prepare and render.
    add(api.renderers.registerNodeRenderGate("com.lighttable.coloring.region", draftBridge.gate));
    add(api.tools.register(paintBucket));
    add(api.tools.register(colorPicker));
    add(api.panels.register({
      id: "palette",
      title: "Color Palette",
      icon: "palette",
      slot: "dock.right",
      defaultVisible: true,
      minWidth: 240,
      minHeight: 220,
      component: PalettePanel,
    }));
    add(api.panels.register({
      id: "coloring-options",
      title: "Coloring Options",
      icon: "sliders-horizontal",
      slot: "dock.right",
      defaultVisible: true,
      minWidth: 240,
      minHeight: 300,
      component: ColoringOptionsPanel,
    }));
    add(api.modes.register({
      id: "coloring",
      name: "Coloring",
      icon: "palette",
      description: "Non-destructive region coloring with bucket and color picker tools.",
      toolIds: ["paint-bucket", "color-picker"],
      panelIds: ["palette", "coloring-options"],
      defaultVisiblePanels: ["palette", "coloring-options"],
    }));
    add(api.commands.register({
      id: "toggle-draft",
      title: "Toggle Draft / Outlines Only",
      description: "Synchronously suppress coloring region output while leaving host outline rendering untouched.",
      shortcut: "Shift+D",
      execute() {
        if (!draftBridge) return;
        try { draftBridge.controller.setDraft(!draftBridge.controller.draft); }
        catch (error) {
          api.logger.error("Could not complete Draft-mode transition.", {
            code: "coloring-draft-transition-failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    }));
    add(api.toolbar.register({
      id: "toggle-draft",
      slot: "toolbar.top",
      name: "Draft / Outlines Only",
      icon: "eye-off",
      tooltip: "Toggle Draft / Outlines Only (Shift+D)",
      commandId: "toggle-draft",
    }));
    add(api.menus.register({
      id: "toggle-draft",
      slot: "menu.project",
      title: "Toggle Draft / Outlines Only",
      commandId: "toggle-draft",
      order: 80,
      when: "project-open",
    }));
    add(api.events.on("project.closing", () => {
      paintBucket?.cancelAll("project-close");
      colorPicker?.cancelAll("project-close");
    }));

    api.logger.info("Coloring Mode activated.", {
      pluginId: runtimeManifest.id,
      sdkApiRange: runtimeManifest.apiVersionRange,
      coloringModuleVersion: "1.0.0",
    });
  } catch (error) {
    paintBucket?.cancelAll("plugin-disabled");
    colorPicker?.cancelAll("plugin-disabled");
    try { draftBridge?.dispose(); } catch { /* preserve activation failure */ }
    try { regionRenderer?.dispose(); } catch { /* preserve activation failure */ }
    detachPanelRuntime();
    try { await workspace?.flush(); } catch { /* activation failure remains primary */ }
    try { api.registrations.clear(); } catch { /* host also rolls back staged registrations */ }
    currentApi = undefined;
    workspace = undefined;
    draftBridge = undefined;
    regionRenderer = undefined;
    paintBucket = undefined;
    colorPicker = undefined;
    throw error;
  }
}

async function deactivate(reason: "disable" | "uninstall" | "update" | "shutdown" | "failure"): Promise<void> {
  if (!currentApi && !draftBridge && !regionRenderer) return;
  paintBucket?.cancelAll(reason === "failure" ? "plugin-disabled" : "plugin-disabled");
  colorPicker?.cancelAll(reason);
  try { draftBridge?.dispose(); }
  catch (error) {
    currentApi?.logger.warn("Draft controller disposal reported an adapter error.", {
      code: "coloring-draft-dispose-failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  try { regionRenderer?.dispose(); }
  catch (error) {
    currentApi?.logger.warn("Coloring region cache disposal failed.", {
      code: "coloring-renderer-dispose-failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  detachPanelRuntime();
  try { await workspace?.flush(); } catch (error) {
    currentApi?.logger.warn("Could not flush Coloring Mode settings during deactivation.", {
      code: "coloring-storage-flush-failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  try { currentApi?.registrations.clear(); }
  finally {
    currentApi = undefined;
    workspace = undefined;
    draftBridge = undefined;
    regionRenderer = undefined;
    paintBucket = undefined;
    colorPicker = undefined;
  }
}

const plugin: LightTablePlugin = {
  manifest: runtimeManifest,
  activate,
  deactivate,
};

export default plugin;
