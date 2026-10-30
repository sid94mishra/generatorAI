// Android Back ordering (06 §3.2): overlays subscribe when they OPEN, so the most recently opened one is the
// first listener and wins (BackHandler calls listeners last-in, first-out). Return true when handled.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

export function useBackHandler(active: boolean, handler: () => boolean): void {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!active) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => latest.current());
    return () => sub.remove();
  }, [active]);
}
