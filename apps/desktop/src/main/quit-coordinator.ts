// ────────────────────────────────────────────────────────────────
// The one bounded shutdown sequence that ends the process.
//
// `before-quit` (index.ts) cancels Electron's own quit and calls `quitApp`,
// which asks about unsaved work, stops what this shell owns, and finishes in
// `app.exit(0)`. Every quit goes through here, including an update install
// (updater.ts `installUpdate`, D-54):
// - Windows and Linux register an exit hand-off (`setExitHandoff`) and call
//   `app.quit()`. The hand-off starts the installer AFTER the shutdown and
//   immediately before `exit(0)`, so the installer never races it (P1-review
//   P2-R28: NSIS kills every process under the install dir within ~1.5 s,
//   and a spawned AppImage cannot take the single-instance lock while this
//   process still holds it).
// - macOS calls `quitAndInstall()` first. Squirrel.Mac closes the windows and
//   quits, which lands here, and ShipIt installs once the process has exited.
//
// `app.exit(0)` is not a problem for installing updates (06 §11 R5, P1-review
// P2-R5, P2-R42). Electron documents that `app.exit` skips `before-quit` and
// `will-quit`; it does not skip `quit`. `app.exit` binds to `Browser::Exit`,
// which destroys the windows (`DestroyAllWindows`) and then runs
// `Browser::Shutdown`, which notifies `OnQuit`; `App::OnQuit` emits `quit`
// with the exit code. electron-updater's `autoInstallOnAppQuit` hook is
// `app.once('quit', …)` and installs when that code is 0 and no install was
// started. Still to be confirmed per OS with `mock-update-server` (07 R-10).
// ────────────────────────────────────────────────────────────────

import { app } from 'electron';
import { disposeComputerHost } from './computer-host-registry';
import { getServerManager } from './server-manager';
import { getWindowManager } from './window-manager';
import { destroyTray } from './tray';
import { log } from './logger';

let quitting = false;
let inFlight: Promise<boolean> | null = null;

/**
 * Work that must run after the shutdown and immediately before `exit(0)`: the
 * update installer on Windows and Linux (updater.ts). At most one.
 */
export interface ExitHandoff {
  /** The quit was accepted (unsaved work confirmed): the shutdown starts now. */
  onCommitted(): void;
  /** The quit was not accepted: nothing was stopped, the app keeps running. */
  onDeclined(): void;
  /** Runs once the shutdown is complete, right before `exit(0)`. Bounded by `HANDOFF_DEADLINE_MS`. */
  run(): Promise<void>;
}

let handoff: ExitHandoff | null = null;

/** How long `ExitHandoff.run` may take before the exit goes ahead anyway. */
export const HANDOFF_DEADLINE_MS = 10_000;

/** Registers (or, with null, clears) the work that runs right before the exit. */
export function setExitHandoff(next: ExitHandoff | null): void {
  handoff = next;
}

function takeHandoff(): ExitHandoff | null {
  const current = handoff;
  handoff = null;
  return current;
}

/** True from the moment a quit was accepted, for callers that must stop starting new work. */
export function isQuitting(): boolean {
  return quitting;
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
 * Confirms discard, stops the computer host and (in standalone mode) the
 * embedded server, tears down the tray, runs the exit hand-off if one is
 * registered, then exits.
 *
 * Bounded, because `app.exit(0)` at the end is the only thing that actually
 * ends the process once `before-quit` has been cancelled. A step that will not
 * drain or release here takes the whole quit with it, and the user is left
 * with a window that closed and an application that did not, still holding
 * the database and the port. That happened once in a shipped build and had to
 * be killed from the task manager, which is why this has its own deadline.
 *
 * One quit at a time: a second call while one is running (Cmd+Q pressed again
 * while the discard prompt is open, the tray's Quit, an update install) gets
 * the same promise instead of a second prompt and a second shutdown
 * (P1-review P2-R23). Resolves false when the user kept their unsaved work (or
 * the prompt itself failed); a later quit may then ask again.
 */
export function quitApp(mode: 'dev' | 'standalone', exit: (code: number) => void = (code) => app.exit(code)): Promise<boolean> {
  if (!inFlight) {
    inFlight = runQuit(mode, exit).then(
      (proceeded) => {
        if (!proceeded) inFlight = null;
        return proceeded;
      },
      (err: unknown) => {
        // Only the unsaved-work prompt can throw (the shutdown catches its own
        // errors), so nothing was stopped. Keeping the rejected promise would
        // make every later quit fail the same way (P1-review P2-R38).
        log.error('Quit abandoned: the unsaved-work prompt failed', err);
        inFlight = null;
        takeHandoff()?.onDeclined();
        return false;
      },
    );
  }
  return inFlight;
}

async function runQuit(mode: 'dev' | 'standalone', exit: (code: number) => void): Promise<boolean> {
  if (!(await getWindowManager().confirmDiscard())) {
    takeHandoff()?.onDeclined();
    return false;
  }
  quitting = true;
  getWindowManager().setQuitting(true);
  handoff?.onCommitted();
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
  // Read only now: an install requested while this quit was already shutting
  // down still gets its hand-off.
  const pending = takeHandoff();
  if (pending) {
    log.info('Running the exit hand-off');
    try {
      await withDeadline(
        pending.run(),
        HANDOFF_DEADLINE_MS,
        `exit hand-off did not finish in ${HANDOFF_DEADLINE_MS / 1000}s — exiting anyway`,
      );
    } catch (e) {
      log.warn('Exit hand-off failed', e);
    }
  }
  log.info('Exiting');
  exit(0);
  return true;
}
