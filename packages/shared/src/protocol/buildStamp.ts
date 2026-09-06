// ────────────────────────────────────────────────────────────────
// Build stamp + hello construction — the Node-only half of the host
// protocol. Kept out of the main `@generatorai/shared` barrel because it
// reads the filesystem, and that barrel is bundled for the browser.
// Import via `@generatorai/shared/node`.
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILD_STAMP_ENV, HOST_PROTOCOL_VERSIONS, type HostHelloFrame, type HostName } from './hostProtocol.js';

/**
 * Build stamp for the calling module.
 *
 * `fromUrl` is the caller's `import.meta.url`; the nearest `package.json`
 * above it supplies the version. Falls back to `'unknown'` rather than
 * throwing: a stamp is advisory, and a bundled entry with no package.json in
 * reach must still boot.
 */
export function readBuildStamp(fromUrl?: string): string {
  const fromEnv = process.env[BUILD_STAMP_ENV];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  if (!fromUrl) return 'unknown';
  try {
    let dir = fromUrl.startsWith('file:') ? dirname(fileURLToPath(fromUrl)) : dirname(fromUrl);
    for (let i = 0; i < 8; i += 1) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: unknown };
        if (typeof pkg.version === 'string' && pkg.version) return pkg.version;
      } catch {
        // No package.json here — keep walking up.
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Unusual URL shape — fall through.
  }
  return 'unknown';
}

/** Build the hello frame a host sends first. */
export function makeHostHello(host: HostName, fromUrl?: string): HostHelloFrame {
  return {
    type: 'hello',
    host,
    protocolVersion: HOST_PROTOCOL_VERSIONS[host],
    buildStamp: readBuildStamp(fromUrl),
  };
}

