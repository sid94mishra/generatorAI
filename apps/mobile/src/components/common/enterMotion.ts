// ────────────────────────────────────────────────────────────────
// Entering animation for decision cards and gates.
//
// The gate cards (permission / plan / question / stage approval) all arrive
// with the same spring, and all four wrote `FadeInDown.springify().damping(18)`
// inline with no Reduce Motion branch — the OS switch was honoured by every
// press and sheet in the design system and ignored by the one surface that
// slides in unasked. One hook, one spring (`SPRING_ENTER`), one branch.
//
// Returns `undefined` under Reduce Motion, which Reanimated treats as "mount
// in place": the card appears, it does not travel.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { FadeInDown } from 'react-native-reanimated';

import { useReduceMotion } from '../ui/accessibility';
import { SPRING_ENTER } from '../ui/motion';

export function useCardEntering(): ReturnType<typeof FadeInDown.springify> | undefined {
  const reduceMotion = useReduceMotion();
  return useMemo(
    () =>
      reduceMotion
        ? undefined
        : FadeInDown.springify()
            .damping(SPRING_ENTER.damping ?? 18)
            .stiffness(SPRING_ENTER.stiffness ?? 220)
            .mass(SPRING_ENTER.mass ?? 0.9),
    [reduceMotion],
  );
}
