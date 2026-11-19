# Reference Plugin Design: Coloring Mode

This is an architectural example, not a working coloring implementation. It demonstrates that coloring belongs in a separately packaged plugin and identifies the minimum host services the plugin needs.

## Plugin identity

- ID: `com.lighttable.coloring`
- Contribution type: mode + tools + panels + node renderer
- Initial mode ID: `coloring`
- Example tools: `paint-bucket`, `color-picker`, `color-brush`
- Example panels: `palette`, `coloring-options`, `color-layer-inspector`
- Example node type: `com.lighttable.coloring.region`

## Ownership

The plugin owns:

- palette definitions and palette UI;
- fill bucket behavior;
- flood-fill and region detection algorithms;
- gap-closing and tolerance logic;
- region/mask generation;
- coloring-specific tools and brushes;
- coloring workflow panels and shortcuts;
- plugin settings;
- project-scoped coloring metadata;
- serialization, validation and migration of its own node payloads.

The host owns:

- document and cel/layer containers;
- active edit target;
- source-layer visibility and locking rules;
- canvas lifecycle and viewport transforms;
- transactions and undo/redo;
- asset persistence and hash verification;
- deterministic rendering orchestration;
- project package import/export.

## Suggested non-destructive fill representation

Use a plugin-owned content node in a standard content layer:

```ts
interface ColoringRegionData {
  maskAssetId: string;            // alpha mask asset in host asset store
  color: string;                  // #RRGGBB or #RRGGBBAA, sRGB
  opacity: number;                // 0..1
  seed: { x: number; y: number }; // diagnostic/editing anchor in document units
  sourceLayerIds: string[];       // line-art/input layers used to calculate this region
  algorithmVersion: number;
  tolerance: number;
  gapClose: number;
}
```

The binary alpha mask is stored as a host asset, not base64 inside node JSON. The `maskAssetId` is referenced by the node. The plugin renderer colors the mask using the node color. The plugin may later replace the mask after the user changes fill settings or source geometry.

This representation is a starting recommendation. Alternative vector boundary or run-length mask formats are acceptable if the plugin owns their versioning and can render them deterministically.

## Paint-bucket workflow

1. The tool receives pointer samples in document coordinates.
2. It asks the host for the active edit target (cel and layer) and validates that the target is not locked.
3. It determines which source layers are used for line-art sampling according to plugin settings.
4. It calls `api.render.renderCel(celId, { layerIds, background: "transparent", intent: "editor" })` to receive a deterministic source image.
5. It performs flood-fill/region analysis in a Worker where practical. It does not block the host render loop.
6. It creates an alpha-mask Blob and calls `api.assets.put()`.
7. It creates a `com.lighttable.coloring.region` node referencing the new asset and commits one host document transaction.
8. Undo removes the region node and its asset reference coherently; redo restores it.
9. The plugin node renderer draws the region synchronously from a decoded/cached mask. Its `prepare()` hook loads/decodes the mask before editor/export render; its cache is keyed by asset hash and renderer version.

## Missing-plugin behavior

If Coloring Mode is disabled or uninstalled:

- the project still opens;
- coloring region nodes and the `com.lighttable.coloring` extension namespace remain in the project;
- the host displays a missing-renderer/missing-plugin diagnostic;
- normal project package export preserves all coloring data;
- a visual export that cannot render the coloring nodes fails with a clear diagnostic unless the user confirms a lossy result.

## First milestone

The first Coloring Mode reference plugin need not implement a production-grade fill algorithm. It should prove that the mode can register a palette panel, a placeholder bucket tool, a custom node type/renderer and plugin-owned project data, then disable/re-enable without document corruption.
