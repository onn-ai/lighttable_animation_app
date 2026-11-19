import type { ColoringModeController } from "../../vendor/standalone-coloring-mode/src/index.js";
import type { WorkspaceStore } from "./workspace-store.js";
export declare function attachPanelRuntime(store: WorkspaceStore, controller: ColoringModeController): void;
export declare function detachPanelRuntime(): void;
export declare function getWorkspaceStore(): WorkspaceStore;
export declare function getDraftController(): ColoringModeController;
