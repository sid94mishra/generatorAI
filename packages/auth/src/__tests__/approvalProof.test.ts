import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalApprovalPayload, canonicalJson, type ApprovalPayload } from '@generatorai/shared';
import { ApprovalProofVerifier, type ApprovalExpectation } from '../approvalProof.js';
import { MemoryNonceStore } from '../memoryStores.js';

const NOW = 1_790_412_600_000;

function deviceKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { kty: 'EC'; crv: 'P-256'; x: string; y: string };
  const sign = (text: string) =>
    crypto.sign('sha256', Buffer.from(text, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, sign };
}

function setup() {
  const verifier = new ApprovalProofVerifier({ nonceStore: new MemoryNonceStore(), serverId: 'srv', clock: () => NOW });
  const key = deviceKey();
  const expect: ApprovalExpectation = { kind: 'tool_permission', id: 'int-1', entityId: 'chat-1', decision: 'allow' };
  const payloadFor = (nonce: string, patch: Partial<ApprovalPayload> = {}): ApprovalPayload => ({
    v: 1,
    typ: 'gai-approval',
    gate: { kind: 'tool_permission', id: 'int-1', entityId: 'chat-1' },
    decision: 'allow',
    serverId: 'srv',
    deviceId: 'dev-1',
    iat: Math.floor(NOW / 1000),
    nonce,
    ...patch,
  });
  const proofFor = (payload: ApprovalPayload) => ({ v: 1, payload, signature: key.sign(canonicalApprovalPayload(payload)) });
  const verify = (proof: unknown, deviceId = 'dev-1') =>
    verifier.verifyApproval({ deviceId, publicJwk: JSON.stringify(key.jwk), proof, expect });
  return { verifier, key, payloadFor, proofFor, verify };
}

describe('ApprovalProofVerifier (MG-05)', () => {
  it('registers a key that signed a nonce issued to this device, once', async () => {
    const { verifier, key } = setup();
    const { nonce } = await verifier.issueNonce('dev-1');
    const proof = key.sign(canonicalJson({ deviceId: 'dev-1', nonce, serverId: 'srv', typ: 'gai-approval-key' }));
    const body = { publicJwk: key.jwk, keyProtection: 'secure-enclave' as const, presence: 'biometry' as const, nonce, proof };
    await expect(verifier.verifyRegistration('dev-1', body)).resolves.toEqual(key.jwk);
    await expect(verifier.verifyRegistration('dev-1', body)).rejects.toMatchObject({ code: 'APPROVAL_PROOF_INVALID' });
  });

  it('rejects a registration signed by another key', async () => {
    const { verifier, key } = setup();
    const { nonce } = await verifier.issueNonce('dev-1');
    const other = deviceKey();
    const proof = other.sign(canonicalJson({ deviceId: 'dev-1', nonce, serverId: 'srv', typ: 'gai-approval-key' }));
    await expect(
      verifier.verifyRegistration('dev-1', { publicJwk: key.jwk, keyProtection: 'tee', presence: 'passcode', nonce, proof }),
    ).rejects.toThrow(/does not verify/);
  });

  it('accepts a matching approval and spends its nonce', async () => {
    const { verifier, payloadFor, proofFor, verify } = setup();
    const proof = proofFor(payloadFor((await verifier.issueNonce('dev-1')).nonce));
    await expect(verify(proof)).resolves.toMatchObject({ decision: 'allow' });
    await expect(verify(proof)).rejects.toThrow(/unknown, used or expired/);
  });

  it.each([
    ['another gate', { gate: { kind: 'tool_permission', id: 'int-2', entityId: 'chat-1' } }, /another gate/],
    ['another decision', { decision: 'deny' }, /another decision/],
    ['another server', { serverId: 'srv-2' }, /another server/],
    ['another device', { deviceId: 'dev-2' }, /another device/],
    ['a stale iat', { iat: Math.floor(NOW / 1000) - 121 }, /too old/],
  ] as const)('rejects an approval for %s', async (_label, patch, message) => {
    const { verifier, payloadFor, proofFor, verify } = setup();
    const proof = proofFor(payloadFor((await verifier.issueNonce('dev-1')).nonce, patch as Partial<ApprovalPayload>));
    await expect(verify(proof)).rejects.toThrow(message);
  });

  it("rejects another device's nonce, a tampered payload and a malformed proof", async () => {
    const { verifier, payloadFor, proofFor, verify } = setup();
    const foreign = proofFor(payloadFor((await verifier.issueNonce('dev-2')).nonce));
    await expect(verify(foreign)).rejects.toThrow(/not issued to this device/);

    const signed = proofFor(payloadFor((await verifier.issueNonce('dev-1')).nonce));
    await expect(verify({ ...signed, payload: { ...signed.payload, decision: 'deny' } })).rejects.toThrow(/does not verify/);
    await expect(verify({ v: 1, payload: { v: 1 }, signature: 'x' })).rejects.toMatchObject({ code: 'APPROVAL_PROOF_INVALID' });
  });
});
