// ────────────────────────────────────────────────────────────────
// Webhook Auth Middleware — HMAC-SHA256/SHA512 and token verification
// (SEC-12 — algorithm pinning + defensive comments for new contributors)
// ────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

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
 * Verifies GitHub webhook signature using HMAC-SHA256 by default
 * (the only algorithm GitHub emits on `x-hub-signature-256`).
 *
 * SEC-12 — this function now:
 *   1. Uses `parseSignatureHeader` to pin to an allowlisted algorithm before
 *      doing any crypto. Weaker algorithms (md5/sha1) are rejected with 401.
 *   2. Length-checks the hex payload to catch truncation attacks.
 *   3. Still does constant-time comparison of the raw hex bytes so timing
 *      oracles don't leak whether a digest was "close".
 *
 * New contributors: do NOT add sha1 or md5 support here. GitHub's legacy
 * `x-hub-signature` (sha1) header is explicitly unsupported.
 */
export function verifyGitHubSignature(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!signature) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing webhook signature' } });
      return;
    }

    const parsed = parseSignatureHeader(signature);
    if (!parsed || parsed.algo !== 'sha256') {
      // Explicit refusal. We expect `sha256=<64-hex>` for GitHub.
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unsupported or malformed signature algorithm (expected sha256)',
        },
      });
      return;
    }

    const hmac = crypto.createHmac('sha256', secret);
    // Use raw body buffer (captured by express.json verify hook in app.ts)
    // for accurate HMAC — re-serialising `req.body` can produce different
    // key ordering than what the sender signed.
    const rawBody = req.rawBody;
    const body = rawBody ?? Buffer.from(JSON.stringify(req.body));
    const expectedHex = hmac.update(body).digest('hex');

    // Constant-time comparison of the hex payloads. `timingSafeEqual` throws
    // if buffers differ in length, hence the length guard.
    const sigBuf = Buffer.from(parsed.hex, 'hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook signature' } });
      return;
    }

    next();
  };
}

/**
 * Verifies custom webhook token from `Authorization: Bearer <token>` header.
 * Uses constant-time comparison via `timingSafeEqual`.
 *
 * SEC-12 — no HMAC here because this path authenticates with a bearer
 * secret, not a signed body. The HMAC algorithm pinning above only applies
 * to signature-based webhooks. Bearer webhooks are simpler but ONLY safe
 * over TLS — never expose this path plaintext.
 */
export function verifyWebhookToken(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization'] as string | undefined;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' } });
      return;
    }

    const token = authHeader.slice(7);
    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(expectedToken);

    if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook token' } });
      return;
    }

    next();
  };
}
