import { generateKeyPairSync, createVerify, type KeyObject } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { canonicalApprovalPayload, canonicalJson } from '@generatorai/shared';

// The native facade imports `expo`; the protocol under test never reaches it (every test injects `native`).
vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

import { approvalReadiness, approvalRejection, registerApprovalKey, signApproval, type ApprovalNative } from '../approvalSigning';

/** A software P-256 key standing in for the enclave: raw r‖s like the native module. */
function softwareNative(): ApprovalNative & { privateKey: KeyObject; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  return {
    privateKey,
    publicKey,
    available: () => true,
    status: async () => 'ok',
    generate: async () => ({ publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, keyProtection: 'secure-enclave', presence: 'biometry' }),
    sign: async (_alias, data) => {
      const { createSign } = await import('node:crypto');
      const signer = createSign('SHA256');
      signer.update(data);
      return new Uint8Array(signer.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }));
    },
    remove: async () => undefined,
  };
}

const verify = (publicKey: KeyObject, text: string, signatureB64Url: string): boolean => {
  const v = createVerify('SHA256');
  v.update(Buffer.from(text, 'utf8'));
  return v.verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signatureB64Url, 'base64url'));
};

describe('signed risky approvals (MG-05)', () => {
  it('registers a key whose proof signs {deviceId, nonce, serverId, typ} and carries the nonce (MD-113)', async () => {
    const native = softwareNative();
    const setApprovalKey = vi.fn(async (_body: unknown) => undefined);
    const api = { auth: { approvalNonce: async () => ({ nonce: 'appr.dev1.n1', expiresAt: 0 }), setApprovalKey, removeApprovalKey: async () => undefined } };
    await registerApprovalKey({ api, serverId: 'host1', deviceId: 'dev1', native }, { title: 'Register', cancel: 'Cancel' });
    const body = setApprovalKey.mock.calls[0]![0] as unknown as { nonce: string; proof: string; keyProtection: string; presence: string };
    expect(body).toMatchObject({ nonce: 'appr.dev1.n1', keyProtection: 'secure-enclave', presence: 'biometry' });
    expect(verify(native.publicKey, canonicalJson({ deviceId: 'dev1', nonce: 'appr.dev1.n1', serverId: 'host1', typ: 'gai-approval-key' }), body.proof)).toBe(true);
  });

  it('signs the canonical approval payload with a fresh nonce and the current time', async () => {
    const native = softwareNative();
    const api = { auth: { approvalNonce: async () => ({ nonce: 'appr.dev1.n2', expiresAt: 0 }), setApprovalKey: async () => undefined, removeApprovalKey: async () => undefined } };
    const proof = await signApproval(
      { api, serverId: 'host1', deviceId: 'dev1', native, now: () => 1_790_000_000_500 },
      { gate: { kind: 'tool_permission', id: 'i1', entityId: 'c1' }, decision: 'allow' },
      { title: 'Approve', cancel: 'Cancel' },
    );
    expect(proof.payload).toMatchObject({ v: 1, typ: 'gai-approval', serverId: 'host1', deviceId: 'dev1', iat: 1_790_000_000, nonce: 'appr.dev1.n2', decision: 'allow' });
    expect(verify(native.publicKey, canonicalApprovalPayload(proof.payload), proof.signature)).toBe(true);
  });

  it('reports an app without the native key, and reads the server’s 403 codes', async () => {
    expect(await approvalReadiness({ serverId: 'h', native: { ...softwareNative(), available: () => false } })).toBe('unavailable');
    expect(await approvalReadiness({ serverId: 'h', native: { ...softwareNative(), status: async () => 'invalidated' } })).toBe('invalidated');
    expect(approvalRejection({ status: 403, body: { error: { code: 'APPROVAL_KEY_MISSING' } } })).toBe('key-missing');
    expect(approvalRejection({ status: 403, body: { error: { code: 'APPROVAL_PROOF_INVALID' } } })).toBe('proof-invalid');
    expect(approvalRejection({ status: 409 })).toBeNull();
  });
});
