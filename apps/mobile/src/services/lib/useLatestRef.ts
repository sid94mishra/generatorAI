// The latest value of a prop or callback, for reading inside effects and event handlers without making it a
// dependency (a screen-owned callback rebuilt on every keystroke must not re-subscribe a stream). Written in a layout
// effect, so render never touches the ref (React Compiler rule `react-hooks/refs`) and every passive effect already
// sees the new value.
import { useLayoutEffect, useRef, type RefObject } from 'react';

export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
