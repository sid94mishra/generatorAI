// ────────────────────────────────────────────────────────────────
// A spent DPoP nonce must be answered with a nonce challenge.
//
// Nonces are single-use. A client holding a spent one used to get a bare
// INVALID_PROOF with no fresh nonce, so it had nothing to retry with and every
// later request failed the same way — a locked-out session that only
// re-pairing fixed. Proofs here are really ES256-signed.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { DpopVerifier, DpopError, isNonceChallenge } from '../dpop.js';
import { MemoryNonceStore, MemoryReplayStore } from '../memoryStores.js';

const b64u = (v: string | Buffer) => Buffer.from(v).toString('base64url');

function proof(url: string, nonce?: string): string {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const header = b64u(JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } }));
  const payload = b64u(JSON.stringify({
    jti: randomUUID(), htm: 'GET', htu: url, iat: Math.floor(Date.now() / 1000), ...(nonce ? { nonce } : {}),
  }));
  const sig = sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64u(sig)}`;
}

async function failure(p: Promise<unknown>): Promise<DpopError> {
  try { await p; } catch (err) { if (err instanceof DpopError) return err; throw err; }
  throw new Error('expected the proof to be rejected');
}

describe('DPoP nonces', () => {
  const url = 'http://127.0.0.1:3100/api/chats';

  it('treats a spent nonce as a challenge the client can recover from', async () => {
    const verifier = new DpopVerifier({ replayStore: new MemoryReplayStore(), nonceStore: new MemoryNonceStore() });
    const nonce = await verifier.issueNonce();
    await expect(verifier.verify({ proof: proof(url, nonce), method: 'GET', url })).resolves.toBeTruthy();

    const err = await failure(verifier.verify({ proof: proof(url, nonce), method: 'GET', url }));
    expect(err.code).toBe('NONCE_INVALID');
    expect(isNonceChallenge(err.code)).toBe(true);
  });

  it('challenges a proof outside the time window, and nothing unrelated', () => {
    expect(isNonceChallenge('IAT_OUT_OF_WINDOW')).toBe(true);
    expect(isNonceChallenge('NONCE_REQUIRED')).toBe(true);
    expect(isNonceChallenge('BAD_SIGNATURE')).toBe(false);
    expect(isNonceChallenge('REPLAYED')).toBe(false);
    expect(isNonceChallenge('JKT_MISMATCH')).toBe(false);
  });
});
