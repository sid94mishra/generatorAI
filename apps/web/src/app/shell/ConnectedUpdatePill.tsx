// ────────────────────────────────────────────────────────────────
// ConnectedUpdatePill — "Restart to update" wired to the shell's updater
// (G-04, D-23, 06 §8). Rendered in each layout's reserved slot:
//   strip   title strip (Windows, Linux custom title bar)
//   footer  sidebar footer (macOS, Linux native frame)
//   rail    the collapsed rail (macOS, Linux native frame)
// It shows only while a downloaded update is ready (or its install is
// starting) — never on the web, where `useUpdateState` is null. Mounting it
// subscribes to the updater, which is also what lets the shell skip its native
// "update ready" dialog while the window is on screen (P2-R3). A click installs
// (`restartToUpdate`): the app quits into the installer, or — declined or
// failed — stays, and the tooltip names the failure.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { DesktopUpdateState } from '@generatorai/shared';
import { restartToUpdate, useUpdateState } from '@/hooks/updateQueries.js';
import { UpdatePill, type UpdatePillPlacement } from '@/ui/shell/UpdatePill/UpdatePill.js';

export interface ReadyUpdate {
  version: string;
  /** The install is committed / starting (`installing`). */
  installing: boolean;
  error?: string;
}

/** The update a restart would install, or null when there is none ready. */
export function readyUpdate(state: DesktopUpdateState | null): ReadyUpdate | null {
  if (!state || (state.status !== 'ready' && state.status !== 'installing')) return null;
  const version = state.downloadedVersion;
  if (!version) return null;
  return { version, installing: state.status === 'installing', ...(state.error ? { error: state.error } : {}) };
}

const TEST_IDS: Record<UpdatePillPlacement, string> = {
  strip: 'titlebar-update-pill',
  footer: 'sidebar-update-pill',
  rail: 'rail-update',
};

export function ConnectedUpdatePill({ placement }: { placement: UpdatePillPlacement }) {
  const ready = readyUpdate(useUpdateState());
  const [requested, setRequested] = useState(false);
  if (!ready) return null;
  const install = () => {
    if (requested) return;
    setRequested(true);
    // Resolves once the shell has handed over to the installer (the app then
    // quits) or given up; a failure arrives as `ready` + `error`.
    void restartToUpdate()
      .catch(() => undefined)
      .finally(() => setRequested(false));
  };
  return (
    <UpdatePill
      placement={placement}
      version={ready.version}
      busy={ready.installing || requested}
      {...(ready.error ? { error: ready.error } : {})}
      data-testid={TEST_IDS[placement]}
      onClick={install}
    />
  );
}
