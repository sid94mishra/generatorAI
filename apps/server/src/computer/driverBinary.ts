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
import * as path from 'node:path';

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
