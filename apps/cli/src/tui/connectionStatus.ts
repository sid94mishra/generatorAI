// ────────────────────────────────────────────────────────────────
// What the TUI says about its connection, in one place.
//
// Two things went wrong here before and both are fixed by keeping the
// wording and the colour next to each other: the launch toast for a hard
// connection failure read literally "Auth: error" (the real reason was
// captured and then dropped), and the status bar painted "server down" and
// "just needs pairing" in the same yellow. A user could not tell "fix the
// network" from "run `device pair`" by text or by colour.
// ────────────────────────────────────────────────────────────────

import type { Toast } from './store.js';

/** The `runtime.initialize()` outcome the launcher hands us. */
export interface ConnectionAuthState {
  status: string;
  message?: string;
}

/** Tones a `StatusSegment` accepts; mirrored here to avoid a tui-kit import in a pure module. */
export type ConnectionTone = 'success' | 'warning' | 'failure';

/**
 * Status-bar colour for the connection bullet.
 *
 *   authenticated → success   (green: working)
 *   unpaired      → warning   (yellow: reachable, needs `device pair`)
 *   anything else → failure   (red: unreachable / refused / broken)
 *
 * `null` (nothing connected yet) is also failure — a bar with no server is
 * not a warning, it is the thing to fix first.
 */
export function connectionTone(state: string | null | undefined): ConnectionTone {
  if (state === 'authenticated') return 'success';
  if (state === 'unpaired') return 'warning';
  return 'failure';
}

/**
 * The launch toast for a non-authenticated connection, or `null` when there
 * is nothing to say. Carries the real reason for a hard failure so the user
 * sees "Cannot reach 127.0.0.1:3100: ECONNREFUSED" rather than "Auth: error".
 */
export function connectionToast(
  authState: ConnectionAuthState,
  host: string,
): { text: string; tone: Toast['tone'] } | null {
  if (authState.status === 'authenticated') return null;
  if (authState.status === 'unpaired') {
    return {
      text: 'Not paired — run `generatorai device pair <code>` in another shell.',
      tone: 'warning',
    };
  }
  if (authState.status === 'error') {
    const reason = authState.message?.trim();
    return {
      text: `Cannot reach ${host}${reason ? `: ${reason}` : ''}`,
      tone: 'error',
    };
  }
  // Any other intermediate state (`refreshing`, `revoked`, …): still worth a
  // line, still with whatever detail the runtime gave us.
  const reason = authState.message?.trim();
  return { text: `Auth: ${authState.status}${reason ? ` — ${reason}` : ''}`, tone: 'warning' };
}
