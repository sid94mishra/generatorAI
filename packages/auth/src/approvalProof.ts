// ────────────────────────────────────────────────────────────────
// Approval proofs (mobile MG-05, MD-31).
//
// A risky gate answered by a phone must carry a signature from the device's
// biometric-gated approval key. This module issues the single-use nonces,
// checks a key registration (the new key signs a nonce, proving possession)
// and verifies an approval proof against what the route is about to do.
//
// Nonces live in the DPoP nonce table under a device-bound prefix
// (`appr.<deviceId>.<random>`), so a nonce issued to one device can never
// be spent by another, and consuming it is the same single DELETE.
// ────────────────────────────────────────────────────────────────

import {
  APPROVAL_IAT_SKEW_S,
  APPROVAL_NONCE_TTL_MS,
  APPROVAL_PROOF_ERRORS,
  canonicalApprovalPayload,
  canonicalJson,
  type ApprovalDecision,
  type ApprovalGateKind,
  type ApprovalKeyRegistration,
  type ApprovalPayload,
  type ApprovalPublicJwk,
} from '@generatorai/shared';
import { JoseError, base64urlDecode, importPublicJwk, verifyBytes } from './jose.js';
import type { INonceStore } from './ports.js';

export type ApprovalProofErrorCode = (typeof APPROVAL_PROOF_ERRORS)[keyof typeof APPROVAL_PROOF_ERRORS];

export class ApprovalProofError extends Error {
  constructor(
    readonly code: ApprovalProofErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApprovalProofError';
  }
}

/** What the route is about to do; the signed payload must say exactly this. */
export interface ApprovalExpectation {
  kind: ApprovalGateKind;
  id: string;
  entityId: string;
  decision: ApprovalDecision;
}

export interface ApprovalProofVerifierOptions {
  nonceStore: INonceStore;
  /** This server's host id (`/auth/server-info` `serverId`). */
  serverId: string;
  clock?: () => number;
}

const NONCE_PREFIX = 'appr.';

const invalid = (message: string) => new ApprovalProofError(APPROVAL_PROOF_ERRORS.invalid, message);

export class ApprovalProofVerifier {
  private readonly clock: () => number;

  constructor(private readonly options: ApprovalProofVerifierOptions) {
    this.clock = options.clock ?? Date.now;
  }

  /** A nonce only `deviceId` can spend, valid for 60 s. */
  async issueNonce(deviceId: string): Promise<{ nonce: string; expiresAt: number }> {
    const expiresAt = this.clock() + APPROVAL_NONCE_TTL_MS;
    const nonce = await this.options.nonceStore.issue(expiresAt, `${NONCE_PREFIX}${deviceId}.`);
    return { nonce, expiresAt };
  }

  /**
   * Checks a registration: the new P-256 key signed the canonical
   * `{"deviceId","nonce","serverId","typ":"gai-approval-key"}` with a nonce
   * issued to this device. Returns the canonical public JWK to store.
   */
  async verifyRegistration(deviceId: string, body: ApprovalKeyRegistration): Promise<ApprovalPublicJwk> {
    const imported = importApprovalKey(body.publicJwk);
    const signed = canonicalJson({ deviceId, nonce: body.nonce, serverId: this.options.serverId, typ: 'gai-approval-key' });
    if (!verifyBytes('ES256', imported.key, Buffer.from(signed, 'utf8'), decodeSignature(body.proof))) {
      throw invalid('The registration proof does not verify with the new key');
    }
    await this.consumeNonce(deviceId, body.nonce);
    return imported.jwk as ApprovalPublicJwk;
  }

  /**
   * Verifies an approval proof for `deviceId`, whose registered key is
   * `publicJwk`, against what the route is about to do. Consumes the nonce.
   */
  async verifyApproval(input: {
    deviceId: string;
    publicJwk: string;
    proof: unknown;
    expect: ApprovalExpectation;
  }): Promise<ApprovalPayload> {
    const proof = parseProof(input.proof);
    const { payload } = proof;
    const imported = importApprovalKey(JSON.parse(input.publicJwk) as unknown);
    const bytes = Buffer.from(canonicalApprovalPayload(payload), 'utf8');
    if (!verifyBytes('ES256', imported.key, bytes, decodeSignature(proof.signature))) {
      throw invalid('The approval signature does not verify');
    }
    if (payload.serverId !== this.options.serverId) throw invalid('The approval is for another server');
    if (payload.deviceId !== input.deviceId) throw invalid('The approval was signed for another device');
    const { kind, id, entityId, decision } = input.expect;
    if (payload.gate.kind !== kind || payload.gate.id !== id || payload.gate.entityId !== entityId) {
      throw invalid('The approval is for another gate');
    }
    if (payload.decision !== decision) throw invalid('The approval is for another decision');
    if (Math.abs(Math.floor(this.clock() / 1000) - payload.iat) > APPROVAL_IAT_SKEW_S) {
      throw invalid('The approval is too old or from the future');
    }
    await this.consumeNonce(input.deviceId, payload.nonce);
    return payload;
  }

  private async consumeNonce(deviceId: string, nonce: string): Promise<void> {
    if (typeof nonce !== 'string' || !nonce.startsWith(`${NONCE_PREFIX}${deviceId}.`)) {
      throw invalid('The nonce was not issued to this device');
    }
    if (!(await this.options.nonceStore.verify(nonce, this.clock()))) {
      throw invalid('The nonce is unknown, used or expired');
    }
  }
}

/** Imports an approval key; only EC P-256 is accepted. */
function importApprovalKey(jwk: unknown): ReturnType<typeof importPublicJwk> {
  let imported: ReturnType<typeof importPublicJwk>;
  try {
    imported = importPublicJwk(jwk);
  } catch (err) {
    throw invalid(err instanceof JoseError ? err.message : 'Invalid approval key');
  }
  if (imported.alg !== 'ES256') throw invalid('The approval key must be EC P-256');
  return imported;
}

function decodeSignature(signature: unknown): Buffer {
  if (typeof signature !== 'string' || signature.length === 0) throw invalid('Missing signature');
  return base64urlDecode(signature);
}

const GATE_KINDS: ReadonlySet<string> = new Set<ApprovalGateKind>([
  'tool_permission',
  'question',
  'plan_review',
  'stage_approval',
  'stage_input',
  'computer_consent',
  'scope_grant',
]);
const DECISIONS: ReadonlySet<string> = new Set<ApprovalDecision>(['allow', 'deny', 'approve', 'reject', 'answer', 'request_changes']);

/** Validates the wire shape; every member the signature covers must be the right type. */
function parseProof(value: unknown): { payload: ApprovalPayload; signature: string } {
  const proof = record(value);
  const payload = record(proof?.['payload']);
  const gate = record(payload?.['gate']);
  if (!proof || proof['v'] !== 1 || !payload || !gate) throw invalid('Malformed approval proof');
  const str = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 512;
  const ok =
    payload['v'] === 1 &&
    payload['typ'] === 'gai-approval' &&
    GATE_KINDS.has(String(gate['kind'])) &&
    str(gate['id']) &&
    str(gate['entityId']) &&
    DECISIONS.has(String(payload['decision'])) &&
    str(payload['serverId']) &&
    str(payload['deviceId']) &&
    str(payload['nonce']) &&
    Number.isInteger(payload['iat']) &&
    (payload['digest'] === undefined || str(payload['digest'])) &&
    str(proof['signature']);
  if (!ok) throw invalid('Malformed approval proof');
  return { payload: payload as unknown as ApprovalPayload, signature: proof['signature'] as string };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
