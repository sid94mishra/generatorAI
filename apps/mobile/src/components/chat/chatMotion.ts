// ────────────────────────────────────────────────────────────────
// chatMotion — the chat surfaces' inline enter / exit / layout presets.
//
// The chat screen, its rows, the tray, the banners and the composer used
// `FadeIn.duration(…)` and `LinearTransition` inline. Reanimated's own default
// honours the OS Reduce Motion switch, but NOT the app's explicit preference
// (`system | reduced | full`), which only `useReduceMotion()` knows. This hook
// is the one place the chat reads that flag: under reduced motion every
// builder is `undefined`, which Reanimated treats as "mount in place".
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { useReduceMotion } from '../ui/accessibility';

export interface ChatMotion {
  reduce: boolean;
  fadeIn: (ms?: number) => ReturnType<typeof FadeIn.duration> | undefined;
  fadeOut: (ms?: number) => ReturnType<typeof FadeOut.duration> | undefined;
  layout: (ms?: number) => ReturnType<typeof LinearTransition.duration> | undefined;
}

export function useChatMotion(): ChatMotion {
  const reduce = useReduceMotion();
  return useMemo<ChatMotion>(
    () => ({
      reduce,
      fadeIn: (ms = 160) => (reduce ? undefined : FadeIn.duration(ms)),
      fadeOut: (ms = 120) => (reduce ? undefined : FadeOut.duration(ms)),
      layout: (ms = 160) => (reduce ? undefined : LinearTransition.duration(ms)),
    }),
    [reduce],
  );
}
