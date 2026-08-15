// ────────────────────────────────────────────────────────────────
// Where the bundled `cua-driver` executable lives, from the server's point of
// view.
//
// The desktop installer stages one target's payload into `resources/cua-driver`
// next to the server bundle. A checkout stages every target it has fetched
// under `apps/desktop/resources/cua-driver/<platform>-<arch>/`, so dev and CI
// find it without a packaging step.
//
// Returns null when nothing is staged, which is a normal state: the bridge
// then falls back to the in-process runtime.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

export function resolveCuaDriverBinary(): string | null {
  const explicit = process.env['GENERATORAI_CUA_DRIVER_PATH'];
  if (explicit) return fs.existsSync(explicit) ? explicit : null;

  const exe = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
  const target = `${process.platform}-${process.arch}`;
  const candidates = [
    // Packaged: resources/server/server.mjs → resources/cua-driver/
    path.resolve(path.dirname(process.argv[1] ?? ''), '..', 'cua-driver', exe),
    path.resolve(process.cwd(), 'apps', 'desktop', 'resources', 'cua-driver', target, exe),
    path.resolve(process.cwd(), '..', '..', 'apps', 'desktop', 'resources', 'cua-driver', target, exe),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Unreadable candidate — try the next one.
    }
  }
  return null;
}

export const AGENT_CURSOR_THEME_ID = 'generatorai.red';

// ────────────────────────────────────────────────────────────────
// The agent cursor renders whichever theme is installed in the driver's own
// theme store, which is per-machine and outlives us. Installing is idempotent
// and cheap, so we do it on every boot rather than tracking whether a previous
// install is still there or still current.
//
// Returns the theme id when the cursor can be themed, and null when it cannot
// — a missing asset or a builder that refuses is not worth failing a boot
// over, it just means the agent uses the driver's default pointer.
// ────────────────────────────────────────────────────────────────
export function installAgentCursorTheme(logger: {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
}): string | null {
  const target = `${process.platform}-${process.arch}`;
  const builderName = process.platform === 'win32' ? 'cua-cursor-theme.exe' : 'cua-cursor-theme';
  const here = path.dirname(process.argv[1] ?? '');

  const builder = firstExisting([
    path.resolve(here, '..', 'cua-driver', builderName),
    path.resolve(process.cwd(), 'apps', 'desktop', 'resources', 'cua-driver', target, builderName),
    path.resolve(process.cwd(), '..', '..', 'apps', 'desktop', 'resources', 'cua-driver', target, builderName),
  ]);
  const theme = firstExisting([
    path.resolve(here, '..', 'cursor-themes', 'generatorai-red.cua-theme'),
    path.resolve(process.cwd(), 'apps', 'desktop', 'resources', 'cursor-themes', 'generatorai-red.cua-theme'),
    path.resolve(process.cwd(), '..', '..', 'apps', 'desktop', 'resources', 'cursor-themes', 'generatorai-red.cua-theme'),
  ]);
  if (!builder || !theme) return null;

  try {
    // The theme store is under the user's local app data. A task runner or
    // service manager that trimmed the environment leaves the builder with
    // nothing to resolve, and it fails with "LOCALAPPDATA is unavailable".
    const home = process.env['USERPROFILE'] ?? process.env['HOME'] ?? os.homedir();
    const env = {
      ...process.env,
      ...(process.platform === 'win32' && !process.env['LOCALAPPDATA']
        ? { LOCALAPPDATA: path.join(home, 'AppData', 'Local') }
        : {}),
      ...(!process.env['HOME'] && process.platform !== 'win32' ? { HOME: home } : {}),
    };
    execFileSync(builder, ['install', theme], { stdio: 'pipe', timeout: 15_000, env });
    logger.info?.(`[computer-use] agent cursor theme installed: ${AGENT_CURSOR_THEME_ID}`);
    return AGENT_CURSOR_THEME_ID;
  } catch (error) {
    logger.warn?.(`[computer-use] agent cursor theme install failed: ${String(error)}`);
    return null;
  }
}

function firstExisting(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Unreadable candidate — try the next one.
    }
  }
  return null;
}
