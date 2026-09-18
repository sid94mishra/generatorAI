// ────────────────────────────────────────────────────────────────
// GitHub device-code sign-in (`/api/source-control/accounts/device/*`).
//
// Why a phone may connect an account this way when it may not paste a
// token: the device flow never puts a credential on the phone. The server
// asks GitHub for a short user code, the phone shows it, the person
// approves it on github.com, and the SERVER polls GitHub and stores the
// token. The phone only ever sees `loginId`, the user code and the outcome.
//
// Endpoint table + pure rules; the sheet is `ConnectGitHubSheet.tsx`.
// Tests: src/__tests__/deviceLogin.test.ts.
// ────────────────────────────────────────────────────────────────

import type {
  DeviceLoginStart,
  DeviceLoginStatus,
  SourceControlProviderInfo,
} from '@generatorai/shared';

import { json, requestJson, type AuthedFetch } from '../../api/http';

export interface DeviceLoginApi {
  /** `POST /api/source-control/accounts/device/start` `{ provider: 'github', host? }`. */
  start: (host?: string) => Promise<DeviceLoginStart>;
  /** `GET /api/source-control/accounts/device/:loginId`. 404 once the server forgot the login. */
  poll: (loginId: string) => Promise<DeviceLoginStatus>;
}

export function createDeviceLoginApi(fetchImpl: AuthedFetch): DeviceLoginApi {
  return {
    start: (host) =>
      requestJson(
        fetchImpl,
        '/api/source-control/accounts/device/start',
        json({ provider: 'github', ...(host?.trim() ? { host: host.trim() } : {}) }),
      ),
    poll: (loginId) =>
      requestJson(fetchImpl, `/api/source-control/accounts/device/${encodeURIComponent(loginId)}`),
  };
}

// ── Availability ─────────────────────────────────────────────────

export const CONNECT_SCOPE = 'write:projects';

export type ConnectAvailability =
  | { kind: 'available' }
  | { kind: 'missing-scope'; reason: string }
  | { kind: 'not-configured'; reason: string }
  | { kind: 'unknown' };

export const NOT_CONFIGURED_REASON =
  'This server has no GitHub OAuth app configured, so device sign-in is off. Set GENERATORAI_GITHUB_OAUTH_CLIENT_ID on the machine running GeneratorAI, or connect an account from the desktop or web app.';

/**
 * Whether "Connect GitHub" can work from this device. Scope first — a device
 * that could never call the route should be told that, not about server
 * configuration it cannot change anyway.
 */
export function deviceConnectAvailability(
  providers: readonly SourceControlProviderInfo[] | undefined,
  scopes: readonly string[],
): ConnectAvailability {
  if (!scopes.includes(CONNECT_SCOPE)) {
    return {
      kind: 'missing-scope',
      reason: 'Connecting an account needs project-edit permission on this device.',
    };
  }
  if (!providers) return { kind: 'unknown' };
  const github = providers.find((p) => p.id === 'github');
  if (!github || !github.loginMethods.includes('device')) {
    return { kind: 'not-configured', reason: NOT_CONFIGURED_REASON };
  }
  return { kind: 'available' };
}

/** The server's `ValidationError` for an unset client id, recognised by its wording. */
export function isNotConfiguredError(message: string | null | undefined): boolean {
  return /not configured|OAUTH_CLIENT_ID/i.test(message ?? '');
}

// ── Polling ──────────────────────────────────────────────────────

/** GitHub's `interval` is seconds; never poll the SERVER faster than every 2s. */
export function pollDelayMs(intervalSeconds: number | null | undefined): number {
  const seconds = typeof intervalSeconds === 'number' && Number.isFinite(intervalSeconds) ? intervalSeconds : 5;
  return Math.max(2, Math.min(30, seconds)) * 1000;
}

export function expiresAtMs(startedAt: number, expiresInSeconds: number | null | undefined): number {
  const seconds = typeof expiresInSeconds === 'number' && expiresInSeconds > 0 ? expiresInSeconds : 900;
  return startedAt + seconds * 1000;
}

/** `mm:ss` left on the code, clamped at zero. */
export function countdown(expiresAt: number, now: number): string {
  const total = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export type DevicePhase =
  | { kind: 'waiting' }
  | { kind: 'connected'; label: string }
  | { kind: 'expired' }
  | { kind: 'failed'; message: string };

/**
 * A poll response → what the sheet shows. A client-side expiry wins over a
 * stale `pending`, so the sheet never waits forever on a server that stopped
 * polling.
 */
export function interpretDeviceStatus(
  status: DeviceLoginStatus | null | undefined,
  now: number,
  expiresAt: number,
): DevicePhase {
  if (status?.status === 'complete') {
    const account = status.account;
    return { kind: 'connected', label: account?.login ?? account?.label ?? 'GitHub' };
  }
  if (status?.status === 'error') return { kind: 'failed', message: status.error?.trim() || 'Sign-in failed.' };
  if (status?.status === 'expired' || now >= expiresAt) return { kind: 'expired' };
  return { kind: 'waiting' };
}

/** Display form of a user code: GitHub's `ABCD-1234`, spaced for reading aloud. */
export function formatUserCode(code: string): string {
  return code.trim().toUpperCase();
}
