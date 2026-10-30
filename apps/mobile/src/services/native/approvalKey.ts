// The approval key (06 §6.3, MG-05 / MD-31; M6-03): a biometric / passcode-bound P-256 key per server
// (`gai.approval.<serverId>`) in the device-key module (Secure Enclave on iOS, StrongBox / TEE on Android) that
// signs risky approvals. Every use shows the system prompt; nothing caches it (06 §6.4).
//
// The native functions are optional: a dev client built before M6-03 has the module but not these functions, and
// `approvalKeyAvailable()` is then false — callers show the "update the app" state instead of crashing.
import { requireOptionalNativeModule } from 'expo';
import type { ApprovalKeyPresence, ApprovalKeyProtection, ApprovalPublicJwk } from '@generatorai/shared';

import { base64ToBytes, bytesToBase64 } from '../lib/base64';

export type ApprovalKeyStatus = 'ok' | 'missing' | 'invalidated' | 'unsupported';

export interface ApprovalPrompt {
  /** 'Approve "git push"?' */
  title: string;
  subtitle?: string;
  cancel: string;
}

interface NativeApprovalKey {
  generateApprovalKey?: (alias: string) => Promise<{ publicJwk: { kty: string; crv: string; x: string; y: string }; backing: string; presence: string }>;
  approvalKeyStatus?: (alias: string) => Promise<string>;
  signWithPrompt?: (alias: string, dataBase64: string, prompt: ApprovalPrompt) => Promise<string>;
  removeApprovalKey?: (alias: string) => Promise<void>;
  /** Ends a prompt still on screen (MD-155); absent on a client built before it. */
  cancelApprovalPrompt?: () => void;
}

const native = requireOptionalNativeModule<NativeApprovalKey>('GeneratorAIDeviceKey');

export const approvalAlias = (serverId: string): string => `gai.approval.${serverId}`;

/** The client has the M6-03 native functions. */
export function approvalKeyAvailable(): boolean {
  return typeof native?.generateApprovalKey === 'function' && typeof native.signWithPrompt === 'function' && typeof native.approvalKeyStatus === 'function';
}

export type ApprovalErrorCode = 'cancelled' | 'timeout' | 'unsupported' | 'missing' | 'invalidated' | 'failed';

/** The module's error codes (ERR_APPROVAL_KEY_*), from either platform, plus the client timeout. */
export function approvalErrorCode(error: unknown): ApprovalErrorCode {
  const code = String((error as { code?: unknown })?.code ?? '');
  if (code.endsWith('TIMEOUT')) return 'timeout';
  if (code.endsWith('CANCELLED')) return 'cancelled';
  if (code.endsWith('UNSUPPORTED')) return 'unsupported';
  if (code.endsWith('MISSING')) return 'missing';
  if (code.endsWith('INVALIDATED')) return 'invalidated';
  return 'failed';
}

const STATUSES: ReadonlySet<string> = new Set(['ok', 'missing', 'invalidated', 'unsupported']);

export async function approvalKeyStatus(alias: string): Promise<ApprovalKeyStatus> {
  if (!approvalKeyAvailable()) return 'unsupported';
  try {
    const status = await native!.approvalKeyStatus!(alias);
    return STATUSES.has(status) ? (status as ApprovalKeyStatus) : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/** The server's protection words (MG-05); a software keystore (an emulator) has no word of its own and reports `tee`. */
export function keyProtectionOf(backing: string): ApprovalKeyProtection {
  if (backing === 'secure-enclave') return 'secure-enclave';
  if (backing === 'strongbox') return 'strongbox';
  return 'tee';
}

export async function generateApprovalKey(alias: string): Promise<{ publicJwk: ApprovalPublicJwk; keyProtection: ApprovalKeyProtection; presence: ApprovalKeyPresence }> {
  if (!approvalKeyAvailable()) throw Object.assign(new Error('This app version cannot sign approvals'), { code: 'ERR_APPROVAL_KEY_UNSUPPORTED' });
  const raw = await native!.generateApprovalKey!(alias);
  const jwk = raw.publicJwk;
  if (jwk?.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new Error('The approval key has an unexpected shape');
  return {
    publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
    keyProtection: keyProtectionOf(raw.backing),
    presence: raw.presence === 'passcode' ? 'passcode' : 'biometry',
  };
}

/** How long a system prompt may stay unanswered before the client gives up (MD-155). */
export const APPROVAL_PROMPT_TIMEOUT_MS = 60_000;

/**
 * Settles `work` within `ms`: past it, `onTimeout` runs (the native prompt is cancelled) and the promise rejects with
 * `ERR_APPROVAL_KEY_TIMEOUT`, so a prompt that never appeared (seen on the iOS Simulator) cannot leave a spinner forever.
 */
export function withPromptTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        onTimeout();
      } catch {
        // The prompt may already be gone; the rejection below is what matters.
      }
      reject(Object.assign(new Error('The approval prompt did not complete in time'), { code: 'ERR_APPROVAL_KEY_TIMEOUT' }));
    }, ms);
    work.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** ECDSA-SHA256 over `data` after the prompt; the raw r‖s (64 bytes). Rejects with a coded error, never hangs. */
export async function signWithPrompt(alias: string, data: Uint8Array, prompt: ApprovalPrompt, timeoutMs = APPROVAL_PROMPT_TIMEOUT_MS): Promise<Uint8Array> {
  if (!approvalKeyAvailable()) throw Object.assign(new Error('This app version cannot sign approvals'), { code: 'ERR_APPROVAL_KEY_UNSUPPORTED' });
  const pending = native!.signWithPrompt!(alias, bytesToBase64(data), prompt);
  const signature = base64ToBytes(await withPromptTimeout(pending, timeoutMs, () => native?.cancelApprovalPrompt?.()));
  if (signature.length !== 64) throw new Error(`The approval key returned a ${signature.length}-byte signature; expected 64`);
  return signature;
}

export async function removeApprovalKey(alias: string): Promise<void> {
  await native?.removeApprovalKey?.(alias);
}
