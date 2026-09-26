// ────────────────────────────────────────────────────────────────
// The workflow callback key (P05 §4.3): the HMAC key of the per-wait
// callback tokens (`/api/workflow-callbacks/<token>`).
//
// 32 random bytes in `<dataDir>/workflow-callback.key`, owner-only (0600),
// created on first boot and reused after, so the callback URL a CI job was
// given keeps working across a server restart. Deleting the file revokes
// every outstanding callback token.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

const FILE_NAME = 'workflow-callback.key';

/** Boot-only: the composition root calls this once, before the server listens. */
export function loadOrCreateCallbackKey(dataDir: string): Buffer {
  const file = path.join(dataDir, FILE_NAME);
  try {
    // eslint-disable-next-line no-restricted-syntax -- boot-only, before the server listens
    const existing = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64url');
    if (existing.length >= 32) return existing;
  } catch {
    /* first boot */
  }
  const key = randomBytes(32);
  // eslint-disable-next-line no-restricted-syntax -- boot-only, before the server listens
  fs.mkdirSync(dataDir, { recursive: true });
  // eslint-disable-next-line no-restricted-syntax -- boot-only, before the server listens
  fs.writeFileSync(file, `${key.toString('base64url')}\n`, { mode: 0o600 });
  return key;
}
