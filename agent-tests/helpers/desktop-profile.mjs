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
// ────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DESKTOP_DIR = path.join(REPO_ROOT, 'apps', 'desktop');

/**
 * A fresh user-data directory for one Electron launch.
 * @param {string} prefix temp-dir name prefix, e.g. 'gai-chrome-smoke-'
 * @returns {{ dir: string, arg: string, cleanup: () => void }}
 */
export function isolatedProfile(prefix = 'gai-desktop-smoke-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    arg: `--user-data-dir=${dir}`,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      } catch {
        /* Windows may still hold a file for a moment after quit; the OS temp cleaner gets it. */
      }
    },
  };
}
