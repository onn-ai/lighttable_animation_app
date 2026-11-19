let activeStore;
let activeController;
export function attachPanelRuntime(store, controller) {
    activeStore = store;
    activeController = controller;
}
export function detachPanelRuntime() {
    activeStore = undefined;
    activeController = undefined;
}
export function getWorkspaceStore() {
    if (!activeStore)
        throw new Error("Coloring Mode panel runtime is not active.");
    return activeStore;
}
export function getDraftController() {
    if (!activeController)
        throw new Error("Coloring Mode controller is not active.");
    return activeController;
}
//# sourceMappingURL=panel-context.js.map