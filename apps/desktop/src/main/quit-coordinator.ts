// ────────────────────────────────────────────────────────────────
// The one bounded shutdown sequence, shared by every path that ends the
// process: the normal `before-quit` handler (index.ts) and the update
// install path (`updater.ts` `installUpdate`, 06-desktop-and-shell.md §11
// risk R5).
//
// Why this has to be shared rather than duplicated: `before-quit` always
// finishes in `app.exit(0)`, because a shutdown step that hangs must not hang
// the whole app with it (that happened once in a shipped build — see the
// comment on `runQuitShutdown`). But `app.exit()` skips `before-quit` and
// `will-quit` entirely, which is exactly what `electron-updater`'s
// `autoInstallOnAppQuit` listens for (`app.once('quit', …)`) — so an update
// quit that went through the *same* forced exit would spawn the installer
// but then race it against a process teardown that never told anything the
// quit was "real". `installUpdate` instead runs this same routine and then
// calls `quitAndInstall()`, whose own `app.quit()` is left to finish
// normally: `runQuitShutdown` already marked the quit handled, so
// `before-quit` no-ops instead of intercepting it a second time.
// ────────────────────────────────────────────────────────────────

import { disposeComputerHost } from './computer-host-registry';
import { getServerManager } from './server-manager';
import { getWindowManager } from './window-manager';
import { destroyTray } from './tray';
import { log } from './logger';

let quitHandled = false;
let quitting = false;

/** True once `runQuitShutdown` has run (or is running) to completion. */
export function isQuitHandled(): boolean {
  return quitHandled;
}

/** True from the moment a quit was accepted, for callers that must stop starting new work. */
export function isQuitting(): boolean {
  return quitting;
}

/** Lets `promptVaultReset`'s "Quit" choice mark the same flag without going through the full sequence. */
export function markQuitting(value: boolean): void {
  quitting = value;
}

/** Test-only: resets module state between cases. Never called from production code. */
export function __resetQuitStateForTests(): void {
  quitHandled = false;
  quitting = false;
}

/**
 * Resolve `work`, or give up after `ms` and carry on.
 *
 * Deliberately resolves rather than rejects on the deadline: the caller's job
 * is to finish quitting either way, and a rejection there would only travel to
 * a `catch` that logs and continues. The timer is unref'd so it can never be
 * the reason the process stays alive — which would be a fine irony in a
 * shutdown path.
 */
async function withDeadline(work: Promise<void>, ms: number, message: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      log.warn(message);
      resolve();
    }, ms);
    timer.unref?.();
  });
  try {
    await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Runs the bounded shutdown sequence exactly once: confirms discard, stops
 * the computer host and (in standalone mode) the embedded server, and tears
 * down the tray.
 *
 * Bounded, because whatever the caller does after this returns (`app.exit(0)`
 * for a normal quit, `quitAndInstall()` for an update) is the only thing that
 * actually ends the process — a step that will not drain or release here
 * takes the whole quit with it, and the user is left with a window that
 * closed and an application that did not, still holding the database and the
 * port. That happened once in a shipped build and had to be killed from the
 * task manager, which is why this has its own deadline rather than the
 * caller's.
 *
 * Returns false when the user declined (unsaved work) or a shutdown is
 * already under way — the caller must not proceed to exit/install in that case.
 */
export async function runQuitShutdown(mode: 'dev' | 'standalone'): Promise<boolean> {
  if (quitHandled) return false;
  if (!(await getWindowManager().confirmDiscard())) return false;
  quitHandled = true;
  quitting = true;
  getWindowManager().setQuitting(true);
  log.info('Quitting — shutting down embedded server');
  try {
    await withDeadline(
      (async () => {
        // Before the server: the driver holds OS-level input grants, and
        // leaving it running past the app that is responsible for it is
        // exactly the orphaned-automation case the TCC model is meant to
        // prevent.
        await disposeComputerHost();
        if (mode === 'standalone') await getServerManager().stop();
      })(),
      20_000,
      'shutdown did not finish in 20s — exiting anyway',
    );
  } catch (e) {
    log.warn('Error stopping server during quit', e);
  } finally {
    // Logged, not silent. This is the last stretch of a path that has already
    // hung once in a shipped build, and when it hangs the only evidence is
    // which of these lines was the last one written.
    log.info('Shutdown complete — destroying tray');
    try {
      destroyTray();
    } catch (e) {
      log.warn('Error destroying tray during quit', e);
    }
  }
  return true;
}
