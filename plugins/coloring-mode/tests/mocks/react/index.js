export function createElement(type, props, ...children) {
  return { type, props: { ...(props ?? {}), children } };
}
export function useState(initial) {
  let value = typeof initial === "function" ? initial() : initial;
  return [value, (next) => { value = typeof next === "function" ? next(value) : next; }];
}
export function useEffect() { return undefined; }
export function useMemo(factory) { return factory(); }
