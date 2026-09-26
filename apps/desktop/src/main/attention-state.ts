// ────────────────────────────────────────────────────────────────
// The attention counts main mirrors from the renderer (G-05, D-36).
//
// Main holds no server session, so the counts are whatever the page last
// pushed through `setMenuState`. They feed the tray text and the OS badge;
// the application menu does not show them, so a push that carries only
// counts does not rebuild it (P1-review P2-R16).
//
// A count is only true while the page that pushed it is alive and on the same
// server. `clearAttention` drops it whenever that stops being so: the window
// closed, the renderer died, or the window moved to another document or
// server (`WindowManager.onRendererReset`, wired in `ipc.ts`). Otherwise the
// badge and tray kept the previous server's number (P1-review P2-R8).
// ────────────────────────────────────────────────────────────────

import type { AttentionCounts } from '@generatorai/shared';
import { applyAttentionBadge } from './badge';
import { refreshTrayMenu } from './tray';
import { getWindowManager } from './window-manager';

let current: AttentionCounts | null = null;

/** The latest counts, or `null` when there is no live page reporting them. */
export function getAttention(): AttentionCounts | null {
  return current;
}

/** Stores a validated push and repaints the tray and the badge. */
export function setAttention(next: AttentionCounts | null): void {
  current = next;
  refreshTrayMenu();
  applyAttentionBadge(next?.needsYou ?? 0, { getMainWindow: () => getWindowManager().getMainWindow() });
}

/** Forgets the counts: the tray drops its count text and the badge clears on every OS. */
export function clearAttention(): void {
  setAttention(null);
}
