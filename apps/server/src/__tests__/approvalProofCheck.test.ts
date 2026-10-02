// MG-05 — a risky gate answered by a mobile device must be signed by its
// registered approval key; every other principal keeps click approvals.
import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ApprovalProofVerifier, MemoryNonceStore, type DeviceRecord, type Principal } from '@generatorai/auth';
import { canonicalApprovalPayload, type ApprovalPayload } from '@generatorai/shared';
import { checkApprovalProof } from '../middleware/approvalProof.js';

const NOW = 1_790_412_600_000;
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });
const sign = (text: string) =>
  crypto.sign('sha256', Buffer.from(text, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');

const expectation = { kind: 'tool_permission', id: 'int-1', entityId: 'chat-1', decision: 'allow' } as const;

function setup(device: Partial<DeviceRecord> | null) {
  const approvals = new ApprovalProofVerifier({ nonceStore: new MemoryNonceStore(), serverId: 'srv', clock: () => NOW });
  const audited: { action: string; metadata?: Record<string, unknown> }[] = [];
  const deps = {
    approvals,
    deviceRepo: {
      findById: async () =>
        device
          ? ({ deviceId: 'dev-1', platform: 'mobile', approvalPublicJwk: JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }), approvalKeyPresence: 'biometry', ...device } as DeviceRecord)
          : null,
    },
    audit: { record: async (e: { action: string; metadata?: Record<string, unknown> }) => void audited.push(e) },
  };
  const principal = { type: 'paired-device', id: 'dev-1' } as Principal;
  const proof = async () => {
    const payload: ApprovalPayload = {
      v: 1,
      typ: 'gai-approval',
      gate: { kind: 'tool_permission', id: 'int-1', entityId: 'chat-1' },
      decision: 'allow',
      serverId: 'srv',
      deviceId: 'dev-1',
      iat: Math.floor(NOW / 1000),
      nonce: (await approvals.issueNonce('dev-1')).nonce,
    };
    return { v: 1, payload, signature: sign(canonicalApprovalPayload(payload)) };
  };
  const check = (body: Record<string, unknown>, risk: unknown = 'risky', who: Principal = principal) =>
    checkApprovalProof(deps as never, { principal: who, body }, { risk, expect: expectation });
  return { check, proof, audited };
}

describe('checkApprovalProof (MG-05)', () => {
  it('lets a standard gate, a non-mobile device and a non-device principal answer with a click', async () => {
    expect(await setup({}).check({}, 'standard')).toEqual({ ok: true });
    expect(await setup({ platform: 'desktop' }).check({})).toEqual({ ok: true });
    expect(await setup({}).check({}, 'risky', { type: 'service-account', id: 'svc' } as Principal)).toEqual({ ok: true });
  });

  it('asks for a key, then a proof, then a valid proof — in that order', async () => {
    expect(await setup({ approvalPublicJwk: null }).check({})).toMatchObject({ ok: false, status: 403, code: 'APPROVAL_KEY_MISSING' });
    expect(await setup({}).check({})).toMatchObject({ code: 'APPROVAL_PROOF_REQUIRED' });

    const s = setup({});
    const signed = await s.proof();
    expect(await s.check({ approvalProof: { ...signed, payload: { ...signed.payload, decision: 'deny' } } })).toMatchObject({
      code: 'APPROVAL_PROOF_INVALID',
    });
    expect(s.audited.map((e) => e.action)).toEqual(['approval.rejected']);
  });

  it('accepts a signed answer once and audits it with the key presence', async () => {
    const s = setup({});
    const signed = await s.proof();
    expect(await s.check({ approvalProof: signed })).toEqual({ ok: true });
    expect(s.audited).toEqual([expect.objectContaining({ action: 'approval.signed', metadata: { decision: 'allow', presence: 'biometry' } })]);
    expect(await s.check({ approvalProof: signed })).toMatchObject({ code: 'APPROVAL_PROOF_INVALID' });
  });
});
