// Audit F-7: the `htu` binding treats scheme and host case-insensitively
// (RFC 3986 §6.2.2.1) and the path byte-exactly. Route case is the route
// policy's business (D-115) — DPoP binds exactly the path that was signed.

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { canonicalHtu, DpopError, DpopVerifier } from '../dpop.js';
import { MemoryNonceStore, MemoryReplayStore } from '../memoryStores.js';

const b64u = (v: string | Buffer) => Buffer.from(v).toString('base64url');

function proof(htu: string): string {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const header = b64u(JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } }));
  const payload = b64u(JSON.stringify({ jti: randomUUID(), htm: 'GET', htu, iat: Math.floor(Date.now() / 1000) }));
  const sig = sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64u(sig)}`;
}

describe('canonicalHtu (F-7)', () => {
  it('lower-cases scheme and host, drops default ports, query and fragment, keeps the path exact', () => {
    expect(canonicalHtu('HTTPS://Studio-MAC.Local:443/api/Auth/Devices?x=1#f')).toBe('https://studio-mac.local/api/Auth/Devices');
    expect(canonicalHtu('http://LOCALHOST:80/api/chats')).toBe('http://localhost/api/chats');
    expect(canonicalHtu('http://[FD00::A]:3100/api')).toBe('http://[fd00::a]:3100/api');
    expect(canonicalHtu('http://127.0.0.1:3100/api/auth/devices')).not.toBe(canonicalHtu('http://127.0.0.1:3100/api/auth/Devices'));
  });

  it('a proof signed for a mixed-case host verifies against the server-rebuilt URL', async () => {
    const verifier = new DpopVerifier({ replayStore: new MemoryReplayStore(), nonceStore: new MemoryNonceStore() });
    await expect(
      verifier.verify({ proof: proof('http://Studio-Mac.LOCAL:3100/api/chats'), method: 'GET', url: 'http://studio-mac.local:3100/api/chats' }),
    ).resolves.toBeTruthy();
  });

  it('a proof for a different path case does not verify', async () => {
    const verifier = new DpopVerifier({ replayStore: new MemoryReplayStore(), nonceStore: new MemoryNonceStore() });
    await expect(
      verifier.verify({ proof: proof('http://127.0.0.1:3100/api/auth/Devices'), method: 'GET', url: 'http://127.0.0.1:3100/api/auth/devices' }),
    ).rejects.toBeInstanceOf(DpopError);
  });
});
