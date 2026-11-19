export const runtimeManifest = {
    id: "com.lighttable.coloring",
    version: "1.0.0",
    apiVersionRange: "^1.0.0",
    execution: "trusted-ui",
    // These permissions are shown before the user enables the optional plugin.
    permissions: [
        "document.read", "document.write", "timeline.read", "canvas.input", "canvas.render",
        "ui.modes", "ui.panels", "ui.toolbar", "history.commands", "assets.read", "assets.write", "storage.plugin",
    ],
};
export const PLUGIN_ID = runtimeManifest.id;
export const REGION_NODE_TYPE = "com.lighttable.coloring.region";
export const REGION_NODE_VERSION = 1;
export const STORAGE_KEY = "workspace-v1";
export const COLOR_RENDER_LAYER_ID = "coloring-regions";
//# sourceMappingURL=manifest.js.map