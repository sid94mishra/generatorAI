// ────────────────────────────────────────────────────────────────
// Updater state hook (G-04) — the "Restart to update" pill's data (Windows
// strip, Linux sidebar-header, DesktopMac traffic row) once it lands (P3-06);
// no UI lives here.
//
// One read at mount plus a live `onChange` subscription, not React Query:
// main pushes every transition itself (`updater.ts` `onUpdateStateChange`),
// so the hook only holds the latest value. Subscribing is also what tells the
// shell it may skip its native "update ready" dialog (P1-review P2-R3): the
// component that mounts this hook must actually show the state.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import type { DesktopUpdateState } from '@generatorai/shared';
import { desktopUpdates, isDesktop } from '@/lib/desktop.js';

/**
 * Live updater state. `null` on plain web (D-23: "web: never" shows the pill),
 * before the first read, and when the first read failed with no push since:
 * unknown, never an invented "idle" (D-36).
 */
export function useUpdateState(): DesktopUpdateState | null {
  const [state, setState] = useState<DesktopUpdateState | null>(null);

  useEffect(() => {
    if (!isDesktop) return undefined;
    let cancelled = false;
    let pushed = false;
    desktopUpdates.getState().then(
      (s) => {
        // A push that arrived first is newer than this read.
        if (!cancelled && !pushed) setState(s);
      },
      () => undefined, // stays unknown until main pushes the next transition
    );
    const unsubscribe = desktopUpdates.onChange((s) => {
      pushed = true;
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}

/**
 * Installs the downloaded update (06 §11 R5). Resolves once the shell has
 * either handed over to the installer (the app then quits) or given up; a
 * failure shows up in `useUpdateState` as `ready` with `error`.
 */
export function restartToUpdate(): Promise<void> {
  return desktopUpdates.restartToUpdate();
}
