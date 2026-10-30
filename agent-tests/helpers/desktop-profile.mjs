// ────────────────────────────────────────────────────────────────
// Shared by the Electron smokes that launch the desktop app.
//
// DESKTOP_DIR is resolved from this file, never from process.cwd(), so a smoke
// runs the same from the repo root (the 09 §6.5 command) or from agent-tests/.
//
// isolatedProfile() gives each launch a fresh temp user-data directory, passed
// as Chromium's `--user-data-dir` switch. Electron takes `app.getPath('userData')`
// from it on every OS, so settings.json, logs, the single-instance lock and the
// vault key (secret-key.bin) all live there. A smoke therefore never reads or
// rewrites the developer's profile (~/Library/Application Support/@generatorai/
// desktop, %APPDATA%\@generatorai\desktop, ~/.config/@generatorai/desktop) and
// never renames its vault key when a Playwright-launched Electron cannot
// decrypt it.
//
// P2-R44 — three fixes to how this profile directory is cleaned up:
//  1. `process.on('exit', profile.cleanup)` alone never runs on SIGINT/SIGTERM:
//     Node's default disposition for an unhandled signal terminates the
//     process immediately without emitting 'exit', so Ctrl-C (or a CI-issued
//     SIGTERM) used to leave the directory behind. This module now installs
//     its own SIGINT/SIGTERM handlers that clean up, then exit with the
//     conventional 128+signal code.
//  2. A caller used to register the cleanup hook *before* `electron.launch`,
//     so a throw between the two could run cleanup while Electron (and the
//     embedded server it spawns) still held files open. `attach(app)` lets a
//     smoke hand the launched app to this helper once it exists, so a signal
//     that lands afterwards tries `app.close()` before removing the
//     directory. Callers should additionally close the app themselves before
//     calling `cleanup()` on their own success/failure paths (try/finally).
//  3. A final rmSync failure (e.g. Windows EBUSY because a file handle is
//     still closing) is now logged, not swallowed — the previous silent
//     catch made a leak invisible. Windows does not sweep %TEMP% for us, so
//     the sandbox's `--clean` (scripts/redesign/sandbox.mjs) also sweeps
//     these directories by prefix.
// ────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DESKTOP_DIR = path.join(REPO_ROOT, 'apps', 'desktop');

const CLEANUP_SIGNALS = ['SIGINT', 'SIGTERM'];

/**
 * A fresh user-data directory for one Electron launch.
 * @param {string} prefix temp-dir name prefix, e.g. 'gai-chrome-smoke-'
 * @returns {{ dir: string, arg: string, attach: (app: { close: () => Promise<void> }) => void, cleanup: () => void }}
 */
export function isolatedProfile(prefix = 'gai-desktop-smoke-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  let electronApp = null;
  let removed = false;
  let uninstallSignalHandlers = () => {};

  function cleanup() {
    if (removed) return;
    removed = true;
    uninstallSignalHandlers();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (err) {
      // Do not swallow: a directory left behind hides the vault key and a
      // stale single-instance lock from the next run, and on Windows this
      // log is the only place that ever surfaces (no OS temp sweep there).
      console.error(
        `[desktop-profile] failed to remove isolated profile ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function onSignal(signal) {
    // Best-effort: close whatever Electron instance was `attach()`-ed before
    // touching the directory it may still hold files in.
    if (electronApp) {
      await electronApp.close().catch(() => {});
    }
    cleanup();
    const signalNumber = os.constants.signals[signal];
    process.exit(signalNumber ? 128 + signalNumber : 1);
  }

  uninstallSignalHandlers = (() => {
    const handlers = CLEANUP_SIGNALS.map((signal) => {
      const handler = () => {
        onSignal(signal);
      };
      process.on(signal, handler);
      return [signal, handler];
    });
    return () => {
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    };
  })();

  return {
    dir,
    arg: `--user-data-dir=${dir}`,
    /** Hand this helper the launched Electron app so a later signal closes it first. */
    attach: (app) => {
      electronApp = app;
    },
    cleanup,
  };
}
