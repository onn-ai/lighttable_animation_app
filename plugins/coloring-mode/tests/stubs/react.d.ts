declare module "react" {
  export type ReactNode = unknown;
  export type ReactElement = { readonly type: unknown; readonly props: Record<string, unknown> };
  export type ComponentType<P = {}> = (props: P) => ReactElement | null;
  export function createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): ReactElement;
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
}
