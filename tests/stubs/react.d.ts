declare module "react" {
  export type ComponentType<P = Record<string, never>> = (props: P) => unknown;
}
