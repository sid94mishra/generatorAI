// Reduce Transparency (iOS; Android reports none): glass becomes the opaque fallback (mobile 02 §8.2, MD-28).
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export function useReduceTransparency(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    let alive = true;
    void AccessibilityInfo.isReduceTransparencyEnabled?.()
      .then((value) => {
        if (alive) setReduced(value);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.('reduceTransparencyChanged', setReduced);
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return reduced;
}
