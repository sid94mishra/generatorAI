// ────────────────────────────────────────────────────────────────
// Webhook Auth — HMAC-SHA256/SHA512 signature verification for
// automation webhooks
// (SEC-12 — algorithm pinning + defensive comments for new contributors)
// ────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';

/**
 * SEC-12 — allowlist of HMAC algorithms we accept on inbound webhooks.
 * Any algorithm claimed by a signature header outside this list is
 * rejected BEFORE we compute a digest. This blocks:
 *   - `md5=...` (broken, colliding since 2005)
 *   - `sha1=...` (broken for collisions since 2017, still seen in legacy
 *     GitHub deliveries via `x-hub-signature` — use `x-hub-signature-256`
 *     instead, which pins to sha256)
 *   - any future algorithm attackers might try to force-downgrade to
 *
 * When adding a new algorithm, ensure (a) it is collision-resistant by
 * current standards and (b) a corresponding separate signature header
 * exists — don't multiplex algorithms on one header.
 */
const ALLOWED_HMAC_ALGORITHMS: ReadonlySet<string> = new Set(['sha256', 'sha512']);

/**
 * Parse a signature header of the form `<algo>=<hex>`. Rejects non-allowlisted
 * algorithms. Returns `null` on any parsing/validation failure — callers
 * should treat that as "reject with 401".
 */
function parseSignatureHeader(header: string): { algo: string; hex: string } | null {
  const eqIdx = header.indexOf('=');
  if (eqIdx <= 0 || eqIdx === header.length - 1) return null;
  const algo = header.slice(0, eqIdx).toLowerCase();
  const hex = header.slice(eqIdx + 1);
  if (!ALLOWED_HMAC_ALGORITHMS.has(algo)) return null;
  // Hex must be exactly the expected length for the algorithm (64 for
  // sha256, 128 for sha512). Catches truncated / padded signatures early.
  const expectedLen = algo === 'sha256' ? 64 : 128;
  if (hex.length !== expectedLen) return null;
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  return { algo, hex };
}

/**
 * Header an automation webhook signs its raw body with. Matches the
 * `Automation.webhookSecret` doc comment ("HMAC key for X-Signature-256").
 */
export const AUTOMATION_SIGNATURE_HEADER = 'x-signature-256';

/**
 * Verifies an HMAC signature against an explicit secret + raw body.
 *
 * Automation webhooks are keyed per-automation, resolved at request time
 * (after the route looks the automation up by its token), so the caller
 * passes the secret in directly. Pins the algorithm through
 * `parseSignatureHeader` and compares in constant time.
 *
 * Returns `false` (never throws) for any parsing/verification failure —
 * callers should treat that uniformly as "reject with 401".
 */
export function verifySignedPayload(
  secret: string,
  signatureHeader: string | undefined,
  body: Buffer,
): boolean {
  if (!signatureHeader) return false;
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;

  const hmac = crypto.createHmac(parsed.algo, secret);
  const expectedHex = hmac.update(body).digest('hex');

  const sigBuf = Buffer.from(parsed.hex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

