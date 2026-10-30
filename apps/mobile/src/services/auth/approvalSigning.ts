// Signed risky approvals (06 §6.3, MG-05 / MD-31 / MD-113; M6-03). A risky gate answered from this phone carries
// an `approvalProof`: the device's approval key signs the canonical payload (shared `canonicalApprovalPayload`)
// with a fresh single-use nonce from `POST /api/auth/approval-nonce`. Registration proves possession the same way
// (`PUT /api/auth/devices/me/approval-key`, body with its nonce, MD-113). Every signature prompts (no step-up
// cache, 06 §6.4). Pure over its dependencies, so the protocol is unit-tested without the native module.
import {
  APPROVAL_PROOF_ERRORS,
  canonicalApprovalPayload,
  canonicalJson,
  type ApprovalDecision,
  type ApprovalGateKind,
  type ApprovalKeyRegistration,
  type ApprovalPayload,
  type ApprovalProof,
} from '@generatorai/shared';

import { bytesToBase64Url } from '../lib/base64';
import * as nativeKey from '../native/approvalKey';
import type { ApprovalKeyStatus, ApprovalPrompt } from '../native/approvalKey';

export interface ApprovalApi {
  auth: {
    approvalNonce: () => Promise<{ nonce: string; expiresAt: number }>;
    setApprovalKey: (body: ApprovalKeyRegistration) => Promise<void>;
    removeApprovalKey: () => Promise<void>;
  };
}

export interface ApprovalNative {
  available: () => boolean;
  status: (alias: string) => Promise<ApprovalKeyStatus>;
  generate: typeof nativeKey.generateApprovalKey;
  sign: (alias: string, data: Uint8Array, prompt: ApprovalPrompt) => Promise<Uint8Array>;
  remove: (alias: string) => Promise<void>;
}

export const NATIVE_APPROVAL_KEY: ApprovalNative = {
  available: nativeKey.approvalKeyAvailable,
  status: nativeKey.approvalKeyStatus,
  generate: nativeKey.generateApprovalKey,
  sign: nativeKey.signWithPrompt,
  remove: nativeKey.removeApprovalKey,
};

export interface ApprovalContext {
  api: ApprovalApi;
  /** This server's host id (`/auth/server-info` serverId). */
  serverId: string;
  /** The DPoP principal's device id. */
  deviceId: string;
  native?: ApprovalNative;
  now?: () => number;
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** What the phone can do about risky gates right now. `unavailable`: this app build lacks the native key. */
export async function approvalReadiness(ctx: Pick<ApprovalContext, 'serverId' | 'native'>): Promise<ApprovalKeyStatus | 'unavailable'> {
  const native = ctx.native ?? NATIVE_APPROVAL_KEY;
  if (!native.available()) return 'unavailable';
  return native.status(nativeKey.approvalAlias(ctx.serverId));
}

/** Generates the key (replacing any), proves possession with a nonce, registers it on the server. */
export async function registerApprovalKey(ctx: ApprovalContext, prompt: ApprovalPrompt): Promise<void> {
  const native = ctx.native ?? NATIVE_APPROVAL_KEY;
  const alias = nativeKey.approvalAlias(ctx.serverId);
  const key = await native.generate(alias);
  const { nonce } = await ctx.api.auth.approvalNonce();
  const proof = await native.sign(alias, utf8(canonicalJson({ deviceId: ctx.deviceId, nonce, serverId: ctx.serverId, typ: 'gai-approval-key' })), prompt);
  await ctx.api.auth.setApprovalKey({ ...key, nonce, proof: bytesToBase64Url(proof) });
}

export interface ApprovalTarget {
  gate: { kind: ApprovalGateKind; id: string; entityId: string };
  decision: ApprovalDecision;
}

/** Signs one answer: a fresh nonce, the canonical payload, the prompt, the proof the answer route takes. */
export async function signApproval(ctx: ApprovalContext, target: ApprovalTarget, prompt: ApprovalPrompt): Promise<ApprovalProof> {
  const native = ctx.native ?? NATIVE_APPROVAL_KEY;
  const { nonce } = await ctx.api.auth.approvalNonce();
  const payload: ApprovalPayload = {
    v: 1,
    typ: 'gai-approval',
    gate: target.gate,
    decision: target.decision,
    serverId: ctx.serverId,
    deviceId: ctx.deviceId,
    iat: Math.floor((ctx.now ?? Date.now)() / 1000),
    nonce,
  };
  const signature = await native.sign(nativeKey.approvalAlias(ctx.serverId), utf8(canonicalApprovalPayload(payload)), prompt);
  return { v: 1, payload, signature: bytesToBase64Url(signature) };
}

/** Removes the key here and on the server (Settings › Security). */
export async function removeApprovalKey(ctx: ApprovalContext): Promise<void> {
  const native = ctx.native ?? NATIVE_APPROVAL_KEY;
  await ctx.api.auth.removeApprovalKey();
  await native.remove(nativeKey.approvalAlias(ctx.serverId));
}

/** The server's verdict on a signed (or unsigned) answer, from a 403 body. */
export function approvalRejection(error: unknown): 'key-missing' | 'proof-required' | 'proof-invalid' | null {
  const body = (error as { status?: number; body?: { error?: { code?: string } } }) ?? {};
  if (body.status !== 403) return null;
  const code = body.body?.error?.code;
  if (code === APPROVAL_PROOF_ERRORS.keyMissing) return 'key-missing';
  if (code === APPROVAL_PROOF_ERRORS.required) return 'proof-required';
  if (code === APPROVAL_PROOF_ERRORS.invalid) return 'proof-invalid';
  return null;
}
