// ────────────────────────────────────────────────────────────────
// Updater state hook (G-04) — the "Restart to update" pill's data (Windows
// strip, Linux sidebar-header, DesktopMac traffic row) once it lands (P3); no
// UI lives here.
//
// Plain polling of `getState()` once at mount plus a live `onChange`
// subscription, not React Query: there is nothing to invalidate or refetch —
// main pushes every transition itself (`updater.ts` `onUpdateStateChange`),
// so the hook only needs to hold the latest value.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { desktopUpdates, isDesktop, type DesktopUpdateState } from '@/lib/desktop.js';

/** Live updater state, or `null` on plain web (D-23: "web: never" shows the pill) or before the first read. */
export function useUpdateState(): DesktopUpdateState | null {
  const [state, setState] = useState<DesktopUpdateState | null>(null);

  useEffect(() => {
    if (!isDesktop) return undefined;
    let cancelled = false;
    void desktopUpdates.getState().then((s) => {
      if (!cancelled) setState(s);
    });
    const unsubscribe = desktopUpdates.onChange((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}

/** Runs the shell's bounded shutdown and installs the downloaded update (06 §11 R5). */
export function restartToUpdate(): void {
  void desktopUpdates.restartToUpdate();
}
