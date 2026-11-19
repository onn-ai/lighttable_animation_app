import type { NodeInfo, ExtensionValue } from "../contracts/plugin-api";

type NestedPayload = {
  region: {
    points: Array<{ x: number; y: number }>;
  };
};

declare const node: NodeInfo<NestedPayload>;
declare const extension: ExtensionValue;

// These expected errors prove SDK query results are recursively readonly.
// @ts-expect-error nested node payload is readonly
node.data.region.points.push({ x: 10, y: 20 });
// @ts-expect-error nested point properties are readonly
node.data.region.points[0].x = 20;
// @ts-expect-error affine matrix is a readonly tuple
node.transform[0] = 2;
const readonlyPalette = extension.data as { readonly palette: readonly string[] };
// @ts-expect-error extension payload is recursively readonly
readonlyPalette.palette.push("#ffffff");
