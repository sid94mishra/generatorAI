// ────────────────────────────────────────────────────────────────
// Webhook token hashing — Node only, so it is reachable through
// `@generatorai/shared/node` rather than the browser-bundled barrel.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';

/**
 * The one hash used for webhook tokens, everywhere.
 *
 * A webhook token is a bearer credential: it is shown once at create/rotate
 * time and only its hash is persisted, so a database copy, a log line, or a
 * read-scoped API response cannot yield a working token. The repository (on
 * write and lookup) and the service (on an incoming delivery) must agree byte
 * for byte, so the implementation lives here rather than being written twice.
 */
export function hashWebhookToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}
