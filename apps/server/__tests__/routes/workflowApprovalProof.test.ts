// ────────────────────────────────────────────────────────────────
// Mobile MG-05 / MD-31 (M8): a stage approval sent from a phone is signed by
// the device's approval key — every workflow approval counts as risky until
// the server has a verdict for them (MG-34) — and a risky in-turn tool
// permission of a stage is signed exactly as a chat's. Desktop, web and CLI
// principals keep click approvals.
// ────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { ALL_SCOPES, ApprovalProofVerifier, MemoryNonceStore, type Principal } from '@generatorai/auth';
import { canonicalApprovalPayload, type ApprovalDecision, type ApprovalGateKind, type ApprovalPayload } from '@generatorai/shared';
import { createApp } from '../../src/app.js';
import { createMockContainer } from '../helpers/testApp.js';
import type { Container } from '../../src/composition-root.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });
const sign = (text: string) => crypto.sign('sha256', Buffer.from(text, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');

const PHONE: Principal = { type: 'paired-device', id: 'dev-1', displayName: 'Phone', scopes: [...ALL_SCOPES], transport: 'direct' } as unknown as Principal;
const DESKTOP: Principal = { ...PHONE, id: 'dev-2' } as Principal;

describe('signed workflow approvals from a phone (MG-05)', () => {
  let app: Express;
  let container: Container;
  let approvals: ApprovalProofVerifier;
  let keyRegistered: boolean;

  beforeEach(() => {
    container = createMockContainer();
    // The stage conversation answers in-turn gates (the route reads it when the router is built).
    (container as unknown as Record<string, unknown>)['stageConversationService'] = { resolveInteraction: vi.fn().mockResolvedValue(undefined) };
    app = createApp(container);
    keyRegistered = true;
    approvals = new ApprovalProofVerifier({ nonceStore: new MemoryNonceStore(), serverId: 'srv' });
    const security = container.security as unknown as Record<string, unknown>;
    security['approvals'] = approvals;
    security['deviceRepo'] = {
      list: vi.fn().mockResolvedValue([]),
      findById: vi.fn(async (id: string) => ({
        deviceId: id,
        platform: id === 'dev-1' ? 'mobile' : 'desktop',
        approvalPublicJwk: keyRegistered ? JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }) : null,
        approvalKeyPresence: 'biometry',
      })),
    };
    (container.security.auth.authenticate as ReturnType<typeof vi.fn>).mockResolvedValue(PHONE);
  });

  const proof = async (gate: { kind: ApprovalGateKind; id: string; entityId: string }, decision: ApprovalDecision) => {
    const payload: ApprovalPayload = {
      v: 1,
      typ: 'gai-approval',
      gate,
      decision,
      serverId: 'srv',
      deviceId: 'dev-1',
      iat: Math.floor(Date.now() / 1000),
      nonce: (await approvals.issueNonce('dev-1')).nonce,
    };
    return { v: 1, payload, signature: sign(canonicalApprovalPayload(payload)) };
  };
  const approve = (body: Record<string, unknown>) => request(app).post('/api/workflow-runs/run-1/commands').send({ command: 'approve', instanceId: 'sr-1', ...body });

  it('refuses an unsigned approval, and one from a phone without a key', async () => {
    const unsigned = await approve({ outcome: 'approved' });
    expect(unsigned.status).toBe(403);
    expect(unsigned.body.error.code).toBe('APPROVAL_PROOF_REQUIRED');
    keyRegistered = false;
    const keyless = await approve({ outcome: 'approved' });
    expect(keyless.body.error.code).toBe('APPROVAL_KEY_MISSING');
    expect(container.workflowRunService.command).not.toHaveBeenCalled();
  });

  it('accepts each outcome signed for exactly that decision, and strips the proof from the command', async () => {
    for (const [outcome, decision] of [
      ['approved', 'approve'],
      ['rejected', 'reject'],
      ['changes_requested', 'request_changes'],
    ] as const) {
      const res = await approve({ outcome, feedback: 'ok', approvalProof: await proof({ kind: 'stage_approval', id: 'sr-1', entityId: 'run-1' }, decision) });
      expect(res.status).toBe(202);
    }
    expect(container.workflowRunService.command).toHaveBeenLastCalledWith('run-1', { command: 'approve', instanceId: 'sr-1', outcome: 'changes_requested', feedback: 'ok' });
  });

  it('refuses a proof for another decision or another stage', async () => {
    const wrongDecision = await approve({ outcome: 'approved', approvalProof: await proof({ kind: 'stage_approval', id: 'sr-1', entityId: 'run-1' }, 'reject') });
    expect(wrongDecision.body.error.code).toBe('APPROVAL_PROOF_INVALID');
    const wrongStage = await approve({ outcome: 'approved', approvalProof: await proof({ kind: 'stage_approval', id: 'sr-2', entityId: 'run-1' }, 'approve') });
    expect(wrongStage.body.error.code).toBe('APPROVAL_PROOF_INVALID');
  });

  it('keeps click approvals for a desktop device and leaves run control unsigned', async () => {
    (container.security.auth.authenticate as ReturnType<typeof vi.fn>).mockResolvedValue(DESKTOP);
    expect((await approve({ outcome: 'approved' })).status).toBe(202);
    (container.security.auth.authenticate as ReturnType<typeof vi.fn>).mockResolvedValue(PHONE);
    expect((await request(app).post('/api/workflow-runs/run-1/commands').send({ command: 'pause' })).status).toBe(202);
  });

  describe('in-turn tool permission of a stage', () => {
    const permission = (body: Record<string, unknown>) => request(app).post('/api/workflow-runs/run-1/instances/sr-1/interactions/int-1/permission').send(body);
    const parkWith = (risk: string) =>
      (container.stageRunRepo.getById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'sr-1', workflowRunId: 'run-1', status: 'awaiting_input', interruptData: { kind: 'tool_permission', interactionId: 'int-1', risk } });

    it('needs a signature when the parked gate is risky', async () => {
      parkWith('risky');
      expect((await permission({ behavior: 'allow' })).body.error.code).toBe('APPROVAL_PROOF_REQUIRED');
      const ok = await permission({ behavior: 'deny', approvalProof: await proof({ kind: 'tool_permission', id: 'int-1', entityId: 'run-1' }, 'deny') });
      expect(ok.status).toBe(202);
    });

    it('answers a standard gate with a click', async () => {
      parkWith('standard');
      expect((await permission({ behavior: 'allow' })).status).toBe(202);
    });
  });
});
