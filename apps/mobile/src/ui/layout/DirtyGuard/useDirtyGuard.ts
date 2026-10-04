// ML-30 useDirtyGuard (03 ML-30; 06 §3.7): one guard for sheets, full-screen editors and pushed forms. While
// `dirty`, router removal (via the passed navigation), Android Back and guarded actions (✕, Cancel, scrim) ask
// AlertDialog "Discard changes?" — "Keep editing" / "Discard".
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { confirm } from '../../native/AlertDialog';
import { useBackHandler } from '../../platform/back';
import type { DirtyGuard, DirtyGuardOptions } from './DirtyGuard.types';

/** How long a blocked removal waits for a just-saved screen to re-render clean before asking. */
export const REMOVAL_SETTLE_MS = 60;

export const DISCARD_DEFAULTS = { title: 'Discard changes?', message: 'Your edits are not saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing' } as const;

export function useDirtyGuard(dirty: boolean, options: DirtyGuardOptions = {}): DirtyGuard {
  const latest = useRef({ dirty, options });
  // Layout effect: the value is current as soon as a render commits (the removal check below relies on it).
  useLayoutEffect(() => {
    latest.current = { dirty, options };
  });

  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    const { dirty: isDirty, options: o } = latest.current;
    if (!isDirty) return true;
    return confirm({ ...DISCARD_DEFAULTS, title: o.title ?? DISCARD_DEFAULTS.title, message: o.message ?? DISCARD_DEFAULTS.message });
  }, []);

  // After "Discard" the removal is replayed once without asking again.
  const bypass = useRef(false);
  // A confirmed discard runs its action with the removal guard off: Cancel → "Discard" → router.back() must not ask
  // a second time from beforeRemove (seen on device: the builder's Cancel showed the dialog twice).
  const discarded = useCallback(<T,>(fn: () => T): T => {
    bypass.current = true;
    try {
      return fn();
    } finally {
      bypass.current = false;
    }
  }, []);

  const guard = useCallback(async <T,>(fn: () => T): Promise<T | undefined> => ((await confirmDiscard()) ? discarded(fn) : undefined), [confirmDiscard, discarded]);

  useBackHandler(dirty && Boolean(options.onDiscard), () => {
    void confirmDiscard().then((discard) => discard && discarded(() => latest.current.options.onDiscard?.()));
    return true;
  });

  const navigation = options.navigation;
  useEffect(() => {
    if (!navigation || !dirty) return undefined;
    bypass.current = false;
    return navigation.addListener('beforeRemove', (e) => {
      if (bypass.current) return;
      e.preventDefault();
      const replay = (): void => {
        bypass.current = true;
        navigation.dispatch(e.data.action as never);
      };
      // A save navigates from its mutation's onSuccess before the screen re-renders clean (`dirty && !isSuccess`),
      // so this listener still sees `dirty`. Look again once that render has committed: a saved screen leaves
      // without "Discard changes?" (seen on device: Create project, Turn sheet Done).
      setTimeout(() => {
        if (!latest.current.dirty) return replay();
        void confirmDiscard().then((discard) => {
          if (discard) replay();
        });
      }, REMOVAL_SETTLE_MS);
    });
  }, [navigation, dirty, confirmDiscard]);

  return { guard, confirmDiscard };
}
