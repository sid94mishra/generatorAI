// ML-30 useDirtyGuard (03 ML-30; 06 §3.7): one guard for sheets, full-screen editors and pushed forms. While
// `dirty`, router removal (via the passed navigation), Android Back and guarded actions (✕, Cancel, scrim) ask
// AlertDialog "Discard changes?" — "Keep editing" / "Discard".
import { useCallback, useEffect, useRef } from 'react';

import { confirm } from '../../native/AlertDialog';
import { useBackHandler } from '../../platform/back';
import type { DirtyGuard, DirtyGuardOptions } from './DirtyGuard.types';

export const DISCARD_DEFAULTS = { title: 'Discard changes?', message: 'Your edits are not saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing' } as const;

export function useDirtyGuard(dirty: boolean, options: DirtyGuardOptions = {}): DirtyGuard {
  const latest = useRef({ dirty, options });
  useEffect(() => {
    latest.current = { dirty, options };
  });

  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    const { dirty: isDirty, options: o } = latest.current;
    if (!isDirty) return true;
    return confirm({ ...DISCARD_DEFAULTS, title: o.title ?? DISCARD_DEFAULTS.title, message: o.message ?? DISCARD_DEFAULTS.message });
  }, []);

  const guard = useCallback(async <T,>(fn: () => T): Promise<T | undefined> => ((await confirmDiscard()) ? fn() : undefined), [confirmDiscard]);

  useBackHandler(dirty && Boolean(options.onDiscard), () => {
    void confirmDiscard().then((discard) => discard && latest.current.options.onDiscard?.());
    return true;
  });

  const navigation = options.navigation;
  // After "Discard" the removal is replayed once without asking again.
  const bypass = useRef(false);
  useEffect(() => {
    if (!navigation || !dirty) return undefined;
    bypass.current = false;
    return navigation.addListener('beforeRemove', (e) => {
      if (bypass.current) return;
      e.preventDefault();
      void confirmDiscard().then((discard) => {
        if (!discard) return;
        bypass.current = true;
        navigation.dispatch(e.data.action as never);
      });
    });
  }, [navigation, dirty, confirmDiscard]);

  return { guard, confirmDiscard };
}
