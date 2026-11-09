// ────────────────────────────────────────────────────────────────
// Where the bundled device components live, from the server's point of view
// (the same layout rules as `computer/driverBinary.ts`):
//
//  - scrcpy-server (Android live view): `resources/scrcpy/` next to the
//    packaged server, `apps/desktop/resources/scrcpy/` in a checkout.
//  - serve-sim (iOS simulator helper): a runtime package beside the server
//    bundle, resolved through Node's resolver.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';

export const SCRCPY_SERVER_FILE = 'scrcpy-server-v3.3.3';

const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true, () => false);

export async function resolveScrcpyServer(): Promise<string | null> {
  const explicit = process.env['GENERATORAI_SCRCPY_SERVER'];
  if (explicit) return (await exists(explicit)) ? explicit : null;
  const candidates = [
    // Packaged: resources/server/server.mjs → resources/scrcpy/
    path.resolve(path.dirname(process.argv[1] ?? ''), '..', 'scrcpy', SCRCPY_SERVER_FILE),
    path.resolve(process.cwd(), 'apps', 'desktop', 'resources', 'scrcpy', SCRCPY_SERVER_FILE),
    path.resolve(process.cwd(), '..', '..', 'apps', 'desktop', 'resources', 'scrcpy', SCRCPY_SERVER_FILE),
  ];
  for (const c of candidates) if (await exists(c)) return c;
  return null;
}

/** `serve-sim/dist/serve-sim.js`, or null (not installed, or not macOS). */
export async function resolveServeSimCli(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  const bases = [process.argv[1] ?? '', path.join(process.cwd(), 'package.json'), import.meta.url];
  for (const base of bases) {
    try {
      const req = createRequire(base);
      const middleware = req.resolve('serve-sim/middleware');
      const cli = path.join(path.dirname(middleware), 'serve-sim.js');
      if (await exists(cli)) return cli;
    } catch {
      // try the next base
    }
  }
  return null;
}
