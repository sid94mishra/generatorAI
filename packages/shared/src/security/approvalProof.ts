// ────────────────────────────────────────────────────────────────
// Approval proof (mobile MG-05, MD-31) — client-safe, pure.
//
// A risky gate (MG-04) answered from a phone carries a signature by the
// device's biometric-gated approval key (Secure Enclave / StrongBox). The
// phone signs the canonical JSON below; the server rebuilds the same bytes
// and verifies the ES256 signature. Contract: docs/redesign/mobile/05-gap-matrix.md
// MG-05; protocol: 06-platform-and-shell.md §6.3.
// ────────────────────────────────────────────────────────────────

export type ApprovalGateKind =
  | 'tool_permission'
  | 'question'
  | 'plan_review'
  | 'stage_approval'
  | 'stage_input'
  | 'computer_consent'
  | 'scope_grant';

export type ApprovalDecision = 'allow' | 'deny' | 'approve' | 'reject' | 'answer' | 'request_changes';

/** A workflow approval's outcome (the `approve` run command) as the decision its proof signs (M8, MD-177). */
export const STAGE_APPROVAL_DECISION = {
  approved: 'approve',
  rejected: 'reject',
  changes_requested: 'request_changes',
} as const satisfies Record<'approved' | 'rejected' | 'changes_requested', ApprovalDecision>;

export interface ApprovalPayload {
  v: 1;
  typ: 'gai-approval';
  gate: {
    kind: ApprovalGateKind;
    /** interactionId, planId or stageRunId. */
    id: string;
    /** The chat or run the gate belongs to. */
    entityId: string;
  };
  decision: ApprovalDecision;
  serverId: string;
  deviceId: string;
  /** base64url SHA-256 of the gate summary + detail the phone showed. */
  digest?: string;
  /** Seconds since the epoch. */
  iat: number;
  /** From `POST /api/auth/approval-nonce`; single use, 60 s. */
  nonce: string;
}

/** Body field the answer routes accept. */
export interface ApprovalProof {
  v: 1;
  payload: ApprovalPayload;
  /** base64url ES256 signature (raw r‖s, 64 bytes) over `canonicalApprovalPayload(payload)`. */
  signature: string;
}

/** What the new key signs at registration, proving the device holds it. */
export interface ApprovalKeyRegistrationPayload {
  deviceId: string;
  nonce: string;
  serverId: string;
  typ: 'gai-approval-key';
}

export type ApprovalKeyProtection = 'secure-enclave' | 'strongbox' | 'tee';
export type ApprovalKeyPresence = 'biometry' | 'passcode';

/** Public half of the approval key: always P-256 (ES256). */
export interface ApprovalPublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

/** `PUT /api/auth/devices/me/approval-key` body. */
export interface ApprovalKeyRegistration {
  publicJwk: ApprovalPublicJwk;
  keyProtection: ApprovalKeyProtection;
  presence: ApprovalKeyPresence;
  /** The nonce the proof signs (MD-113: the server needs it to rebuild the bytes). */
  nonce: string;
  /** base64url ES256 signature over `canonicalJson(ApprovalKeyRegistrationPayload)`. */
  proof: string;
}

export const APPROVAL_PROOF_ERRORS = {
  keyMissing: 'APPROVAL_KEY_MISSING',
  required: 'APPROVAL_PROOF_REQUIRED',
  invalid: 'APPROVAL_PROOF_INVALID',
} as const;

/** Nonce lifetime and the allowed clock skew on `iat`. */
export const APPROVAL_NONCE_TTL_MS = 60_000;
export const APPROVAL_IAT_SKEW_S = 120;

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace,
 * `undefined` members dropped. Both sides sign/verify these exact bytes.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(',')}}`;
}

export function canonicalApprovalPayload(payload: ApprovalPayload): string {
  return canonicalJson(payload);
}
