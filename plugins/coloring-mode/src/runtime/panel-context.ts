import type { ColoringModeController } from "../../vendor/standalone-coloring-mode/src/index.js";
import type { WorkspaceStore } from "./workspace-store.js";

let activeStore: WorkspaceStore | undefined;
let activeController: ColoringModeController | undefined;

export function attachPanelRuntime(store: WorkspaceStore, controller: ColoringModeController): void {
  activeStore = store;
  activeController = controller;
}
export function detachPanelRuntime(): void {
  activeStore = undefined;
  activeController = undefined;
}
export function getWorkspaceStore(): WorkspaceStore {
  if (!activeStore) throw new Error("Coloring Mode panel runtime is not active.");
  return activeStore;
}
export function getDraftController(): ColoringModeController {
  if (!activeController) throw new Error("Coloring Mode controller is not active.");
  return activeController;
}
