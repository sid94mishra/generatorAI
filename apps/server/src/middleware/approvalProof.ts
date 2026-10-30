// ────────────────────────────────────────────────────────────────
// Signed risky approvals (mobile MG-05, MD-31).
//
// A gate the server marked risky (MG-04) and answered by a MOBILE device
// must carry `approvalProof`, signed by that device's registered approval
// key. Desktop, web and CLI principals keep click approvals; the rule binds
// the platform that holds a biometric-gated key.
//
// Order (06 §6.3): key registered → proof present → proof valid. Failures
// are 403 `APPROVAL_KEY_MISSING` / `APPROVAL_PROOF_REQUIRED` /
// `APPROVAL_PROOF_INVALID`. A signed answer is audited as
// `approval.signed` with the key's presence (biometry or passcode).
// ────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { ApprovalProofError, type ApprovalExpectation, type IDeviceRepository, type SecurityAuditService } from '@generatorai/auth';
import { APPROVAL_PROOF_ERRORS } from '@generatorai/shared';

export interface ApprovalGateCheck {
  /** The gate's MG-04 verdict; only `risky` needs a proof. */
  risk: unknown;
  expect: ApprovalExpectation;
}

export interface ApprovalProofDeps {
  approvals: { verifyApproval(input: { deviceId: string; publicJwk: string; proof: unknown; expect: ApprovalExpectation }): Promise<unknown> };
  deviceRepo: Pick<IDeviceRepository, 'findById'>;
  audit: Pick<SecurityAuditService, 'record'>;
}

export type ApprovalProofOutcome = { ok: true } | { ok: false; status: 403; code: string; message: string };

/** Checks `req.body.approvalProof` for a risky gate answered by a mobile device. */
export async function checkApprovalProof(
  deps: ApprovalProofDeps,
  req: Pick<Request, 'principal' | 'body'>,
  gate: ApprovalGateCheck,
): Promise<ApprovalProofOutcome> {
  const principal = req.principal;
  if (gate.risk !== 'risky' || principal?.type !== 'paired-device') return { ok: true };
  const device = await deps.deviceRepo.findById(principal.id);
  if (!device || device.platform !== 'mobile') return { ok: true };

  const deny = (code: string, message: string): ApprovalProofOutcome => ({ ok: false, status: 403, code, message });
  if (!device.approvalPublicJwk) {
    return deny(APPROVAL_PROOF_ERRORS.keyMissing, 'Register an approval key on this device to answer risky gates');
  }
  const proof = (req.body as Record<string, unknown> | undefined)?.['approvalProof'];
  if (proof === undefined) return deny(APPROVAL_PROOF_ERRORS.required, 'This gate is risky: the answer must be signed on the device');
  try {
    await deps.approvals.verifyApproval({ deviceId: device.deviceId, publicJwk: device.approvalPublicJwk, proof, expect: gate.expect });
  } catch (err) {
    if (!(err instanceof ApprovalProofError)) throw err;
    await deps.audit.record({
      action: 'approval.rejected',
      result: 'failure',
      principal,
      resourceType: gate.expect.kind,
      resourceId: gate.expect.id,
      metadata: { reason: err.message },
      severity: 'warn',
    });
    return deny(err.code, err.message);
  }
  await deps.audit.record({
    action: 'approval.signed',
    result: 'success',
    principal,
    resourceType: gate.expect.kind,
    resourceId: gate.expect.id,
    metadata: { decision: gate.expect.decision, presence: device.approvalKeyPresence ?? 'unknown' },
    severity: 'info',
  });
  return { ok: true };
}
