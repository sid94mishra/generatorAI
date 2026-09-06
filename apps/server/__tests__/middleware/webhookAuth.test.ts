// ────────────────────────────────────────────────────────────────
// webhookAuth — verifySignedPayload (per-automation HMAC verification)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import { verifySignedPayload, AUTOMATION_SIGNATURE_HEADER } from '../../src/middleware/webhookAuth.js';

function sign(secret: string, body: Buffer, algo: 'sha256' | 'sha512' = 'sha256'): string {
  return `${algo}=${crypto.createHmac(algo, secret).update(body).digest('hex')}`;
}

describe('webhookAuth — verifySignedPayload', () => {
  it('accepts a correctly-signed body', () => {
    const secret = 'per-automation-secret';
    const body = Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }));
    expect(verifySignedPayload(secret, sign(secret, body), body)).toBe(true);
  });

  it('accepts sha512 (the other allowlisted algorithm)', () => {
    const secret = 'per-automation-secret';
    const body = Buffer.from('{}');
    expect(verifySignedPayload(secret, sign(secret, body, 'sha512'), body)).toBe(true);
  });

  it('rejects a missing signature header', () => {
    const body = Buffer.from('{}');
    expect(verifySignedPayload('secret', undefined, body)).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const body = Buffer.from('{}');
    expect(verifySignedPayload('right-secret', sign('wrong-secret', body), body)).toBe(false);
  });

  it('rejects a signature computed over a different body (tampered payload)', () => {
    const secret = 'per-automation-secret';
    const signed = sign(secret, Buffer.from('{"a":1}'));
    expect(verifySignedPayload(secret, signed, Buffer.from('{"a":2}'))).toBe(false);
  });

  it('rejects an unsupported algorithm (sha1 downgrade attempt)', () => {
    const secret = 'per-automation-secret';
    const body = Buffer.from('{}');
    const sha1 = `sha1=${crypto.createHmac('sha1', secret).update(body).digest('hex')}`;
    expect(verifySignedPayload(secret, sha1, body)).toBe(false);
  });

  it('rejects a malformed header (no algo prefix)', () => {
    expect(verifySignedPayload('secret', 'not-a-valid-header', Buffer.from('{}'))).toBe(false);
  });

  it('uses the documented header name', () => {
    expect(AUTOMATION_SIGNATURE_HEADER).toBe('x-signature-256');
  });
});
