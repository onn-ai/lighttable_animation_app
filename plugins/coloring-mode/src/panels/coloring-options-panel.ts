import * as React from "react";
import type { PluginPanelProps } from "@lighttable/plugin-sdk";
import { getDraftController, getWorkspaceStore } from "../runtime/panel-context.js";
import type { WorkspaceState } from "../runtime/workspace-store.js";

const h = React.createElement;
interface SourceLayerChoice { id: string; label: string; visible: boolean; locked: boolean }

function useWorkspaceState(): WorkspaceState {
  const store = getWorkspaceStore();
  const [state, setState] = React.useState(store.getSnapshot());
  React.useEffect(() => store.subscribe(setState), [store]);
  return state;
}

function getSourceLayerChoices(props: PluginPanelProps): SourceLayerChoice[] {
  const choices = new Map<string, SourceLayerChoice>();
  const resolved = props.document.resolveTick(props.frames.getCurrentTick());
  for (const item of resolved.tracks) {
    if (!item.celId) continue;
    const cel = props.document.getCel(item.celId);
    for (const layer of cel?.layers ?? []) {
      if (!choices.has(layer.id)) choices.set(layer.id, {
        id: layer.id,
        label: `${item.track.name} · ${layer.name}`,
        visible: layer.visible && item.track.visible,
        locked: layer.locked || item.track.locked,
      });
    }
  }
  return [...choices.values()];
}

export const ColoringOptionsPanel: React.ComponentType<PluginPanelProps> = function ColoringOptionsPanel(props) {
  const store = getWorkspaceStore();
  const state = useWorkspaceState();
  const choices = React.useMemo(() => getSourceLayerChoices(props), [props.document, props.frames, props.frames.getCurrentTick()]);

  return h("section", { className: "lt-coloring-panel", style: panelStyle },
    h("header", null, h("strong", null, "Coloring options"), h("p", { style: mutedStyle }, "Controls used by the paint bucket.")),
    h("label", { style: checkRowStyle },
      h("input", { type: "checkbox", checked: state.draft, onChange: () => {
        const controller = getDraftController();
        try { controller.setDraft(!controller.draft); } catch { /* errors are also logged by the plugin bridge */ }
      } }),
      h("span", null, h("strong", null, "Draft / Outlines Only"), h("span", { style: mutedStyle }, "Hide coloring output while the host keeps its outline renderer active."))),
    h("label", { style: checkRowStyle },
      h("input", { type: "checkbox", checked: state.colorLayerEnabled, onChange: (event: { target: { checked: boolean } }) => {
        try { getDraftController().setLayerEnabled("coloring-regions", event.target.checked); } catch { /* surfaced by plugin logger */ }
      } }),
      h("span", null, "Show coloring regions")),
    h("div", { style: fieldStyle },
      h("label", { htmlFor: "lt-fill-tolerance", style: labelStyle }, `Fill tolerance · ${state.options.tolerance}`),
      h("input", { id: "lt-fill-tolerance", type: "range", min: 0, max: 255, step: 1, value: state.options.tolerance, onChange: (event: { target: { value: string } }) => store.updateOptions({ tolerance: Number(event.target.value) }), style: rangeStyle }),
      h("p", { style: mutedStyle }, "Higher values cross more color variation in the source image.")),
    h("div", { style: fieldStyle },
      h("label", { htmlFor: "lt-gap-close", style: labelStyle }, `Gap closing · ${state.options.gapClose} px`),
      h("input", { id: "lt-gap-close", type: "range", min: 0, max: 8, step: 1, value: state.options.gapClose, onChange: (event: { target: { value: string } }) => store.updateOptions({ gapClose: Number(event.target.value) }), style: rangeStyle }),
      h("p", { style: mutedStyle }, "Bridges short enclosed horizontal or vertical breaks in dark line-art barriers before the flood fill.")),
    h("div", { style: fieldStyle },
      h("label", { htmlFor: "lt-region-opacity", style: labelStyle }, `Region opacity · ${Math.round(state.options.opacity * 100)}%`),
      h("input", { id: "lt-region-opacity", type: "range", min: 0, max: 1, step: 0.05, value: state.options.opacity, onChange: (event: { target: { value: string } }) => store.updateOptions({ opacity: Number(event.target.value) }), style: rangeStyle })),
    h("div", { style: fieldStyle },
      h("strong", null, "Source / line-art layers"),
      h("p", { style: mutedStyle }, "Select inputs explicitly. The bucket reads matching layer IDs from the active edit cel; layers belonging to other cels do not contribute to that fill."),
      choices.length === 0
        ? h("p", { style: mutedStyle }, "No layers are available at the current playhead.")
        : h("div", { style: layerListStyle }, ...choices.map((layer) => {
          const checked = state.options.sourceLayerIds.includes(layer.id);
          return h("label", { key: layer.id, style: checkRowStyle },
            h("input", {
              type: "checkbox", checked, disabled: layer.locked,
              onChange: () => store.updateOptions({ sourceLayerIds: checked
                ? state.options.sourceLayerIds.filter((id) => id !== layer.id)
                : [...state.options.sourceLayerIds, layer.id] }),
            }),
            h("span", { style: { opacity: layer.visible ? 1 : 0.55 } }, layer.label),
            layer.locked ? h("small", { style: mutedStyle }, "locked") : null);
        }))));
};

const panelStyle = { display: "flex", flexDirection: "column", gap: 14, padding: 14, color: "var(--lt-panel-fg, #e9e9ed)", font: "13px/1.4 system-ui, sans-serif" };
const mutedStyle = { opacity: 0.65, fontSize: 11, marginTop: 3, display: "block" };
const checkRowStyle = { display: "flex", alignItems: "center", gap: 8, padding: "5px 0" };
const fieldStyle = { display: "flex", flexDirection: "column", gap: 5, borderTop: "1px solid var(--lt-border, #444)", paddingTop: 10 };
const labelStyle = { fontWeight: 600 };
const rangeStyle = { width: "100%", accentColor: "var(--lt-accent, #70a6ff)" };
const layerListStyle = { display: "flex", flexDirection: "column", maxHeight: 220, overflowY: "auto" };
