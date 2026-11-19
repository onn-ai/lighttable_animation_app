import * as React from "react";
import { getWorkspaceStore } from "../runtime/panel-context.js";
const h = React.createElement;
function useWorkspaceState() {
    const store = getWorkspaceStore();
    const [state, setState] = React.useState(store.getSnapshot());
    React.useEffect(() => store.subscribe(setState), [store]);
    return state;
}
export const PalettePanel = function PalettePanel() {
    const store = getWorkspaceStore();
    const state = useWorkspaceState();
    const [newName, setNewName] = React.useState("New color");
    const [newColor, setNewColor] = React.useState("#E76F51");
    return h("section", { className: "lt-coloring-panel", style: panelStyle }, h("header", { style: headerStyle }, h("div", null, h("strong", null, "Palette"), h("div", { style: mutedStyle }, `${state.palette.length} swatches`)), h("span", { style: selectedChipStyle }, state.palette.find((item) => item.id === state.selectedColorId)?.name ?? "No color")), h("div", { style: paletteGridStyle }, ...state.palette.map((entry) => {
        const selected = entry.id === state.selectedColorId;
        return h("div", { key: entry.id, style: selected ? selectedSwatchStyle : swatchStyle }, h("button", {
            type: "button", title: `Select ${entry.name}`, "aria-pressed": selected,
            onClick: () => store.selectColor(entry.id), style: { ...colorButtonStyle, background: entry.color },
        }), h("input", {
            type: "color", value: entry.color.slice(0, 7), "aria-label": `Recolor ${entry.name}`,
            onChange: (event) => store.updateColor(entry.id, event.target.value),
            style: colorInputStyle,
        }), h("input", {
            type: "text", value: entry.name, "aria-label": `Rename ${entry.name}`,
            onChange: (event) => store.renameColor(entry.id, event.target.value),
            style: nameInputStyle,
        }), h("button", {
            type: "button", title: `Delete ${entry.name}`, disabled: state.palette.length <= 1,
            onClick: () => store.deleteColor(entry.id), style: deleteButtonStyle,
        }, "×"));
    })), h("div", { style: addBlockStyle }, h("strong", null, "Add swatch"), h("div", { style: addRowStyle }, h("input", { type: "color", value: newColor.slice(0, 7), onChange: (event) => setNewColor(event.target.value), "aria-label": "New swatch color", style: colorInputStyle }), h("input", { type: "text", value: newName, onChange: (event) => setNewName(event.target.value), "aria-label": "New swatch name", style: { ...nameInputStyle, flex: 1 } }), h("button", { type: "button", onClick: () => { store.addColor(newColor, newName, true); setNewName("New color"); }, style: actionButtonStyle }, "Add"))));
};
const panelStyle = { display: "flex", flexDirection: "column", gap: 14, padding: 14, color: "var(--lt-panel-fg, #e9e9ed)", font: "13px/1.4 system-ui, sans-serif" };
const headerStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 };
const mutedStyle = { opacity: 0.65, fontSize: 11, marginTop: 2 };
const selectedChipStyle = { border: "1px solid var(--lt-border, #565663)", padding: "4px 8px", borderRadius: 999, fontSize: 11 };
const paletteGridStyle = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 };
const swatchStyle = { display: "grid", gridTemplateColumns: "30px 28px minmax(0, 1fr) 24px", alignItems: "center", gap: 6, padding: 4, border: "1px solid transparent", borderRadius: 7 };
const selectedSwatchStyle = { ...swatchStyle, border: "1px solid var(--lt-accent, #70a6ff)", background: "var(--lt-selection, rgba(112,166,255,.12))" };
const colorButtonStyle = { width: 27, height: 27, border: "1px solid rgba(255,255,255,.22)", borderRadius: 6, cursor: "pointer" };
const nameInputStyle = { minWidth: 0, width: "100%", border: "1px solid var(--lt-border, #555)", borderRadius: 5, padding: "5px 6px", color: "inherit", background: "var(--lt-input-bg, #22222a)" };
const deleteButtonStyle = { border: 0, background: "transparent", color: "inherit", opacity: 0.7, cursor: "pointer", fontSize: 18 };
const addBlockStyle = { display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--lt-border, #444)", paddingTop: 12 };
const addRowStyle = { display: "flex", alignItems: "center", gap: 7 };
const colorInputStyle = { width: 34, height: 32, border: 0, padding: 0, background: "transparent" };
const actionButtonStyle = { border: "1px solid var(--lt-border, #555)", borderRadius: 6, background: "var(--lt-button-bg, #33333d)", color: "inherit", padding: "6px 10px", cursor: "pointer" };
//# sourceMappingURL=palette-panel.js.map