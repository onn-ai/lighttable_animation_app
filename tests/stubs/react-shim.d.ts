declare namespace React {
  type ReactNode = any;
  type CSSProperties = Record<string, string | number | undefined>;
  type ComponentType<P = {}> = (props: P) => JSX.Element | null;
  interface RefObject<T> { current: T; }
  interface MutableRefObject<T> extends RefObject<T> {}
  interface ChangeEvent<T = any> { target: T; }
  interface WheelEvent<T = any> { currentTarget: T; clientX: number; clientY: number; ctrlKey: boolean; metaKey: boolean; deltaY: number; preventDefault(): void; }
  namespace JSX {
    type Element = any;
    interface IntrinsicElements { [elementName: string]: any; }
    interface IntrinsicAttributes { key?: string | number; }
  }
  const StrictMode: any;
  function useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];
  function useRef<T>(initial: T): MutableRefObject<T>;
  function useRef<T>(initial: T | null): MutableRefObject<T | null>;
  function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
  function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  function createElement(type: any, props?: any, ...children: any[]): any;
}
declare module 'react' { export = React; }
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any; export namespace JSX { interface IntrinsicAttributes { key?: string | number; } interface IntrinsicElements { [elementName: string]: any; } } }
declare module 'react-dom/client' { export function createRoot(element: Element): { render(node: unknown): void; unmount(): void }; }
declare module '*.css' { const content: string; export default content; }
declare module 'vite' { export function defineConfig(config: any): any; }
declare module '@vitejs/plugin-react' { export default function react(): any; }
declare module 'vitest/config' { export function defineConfig(config: any): any; }
interface ImportMetaEnv { readonly PROD: boolean; readonly DEV: boolean; }
interface ImportMeta { readonly env: ImportMetaEnv; }

declare namespace JSX { interface Element {} interface IntrinsicAttributes { key?: string | number; } interface IntrinsicElements { [elementName: string]: any; } }
