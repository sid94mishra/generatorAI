// ────────────────────────────────────────────────────────────────
// Web auth runtime — the browser's single `AuthenticatedClientRuntime`.
//
// Every network call in the SPA funnels through here so there is exactly one
// place that:
//   * holds the non-extractable device key
//   * attaches DPoP proofs
//   * refreshes the access token (single-flight)
//   * mints short-lived tickets for EventSource / WebSocket
//   * detects revocation and drops the user back to the pairing screen
//
// Legacy mode: if the user has an old `generatorai-api-key` in localStorage,
// the runtime keeps using it verbatim so existing local setups do not break
// mid-migration. The UI surfaces that as a warning.
// ────────────────────────────────────────────────────────────────

import {
  AuthenticatedClientRuntime,
  IndexedDbDeviceKeyStore,
  LocalStorageSessionStore,
  PairingCodeError,
  formatFingerprint,
  parsePairingCode,
  type AuthState,
  type PairingConsent,
} from '@generatorai/client-runtime';
import { isPairingCode, normalizePairingCode } from '@generatorai/shared';

/** localStorage key that holds the legacy shared server API key. */
export const API_KEY_STORAGE_KEY = 'generatorai-api-key';

export function getStoredApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(API_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function resolveEndpoint(): string {
  // Same-origin in production and behind the Vite dev proxy; an explicit
  // override lets a browser talk to a remote/paired server directly.
  const override =
    typeof window !== 'undefined' ? window.localStorage.getItem('generatorai-endpoint') : null;
  if (override) return override.replace(/\/$/, '');
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

let runtime: AuthenticatedClientRuntime | null = null;
let initPromise: Promise<AuthState> | undefined;
const listeners = new Set<(state: AuthState) => void>();
let currentState: AuthState = { status: 'unpaired' };

export function getAuthRuntime(): AuthenticatedClientRuntime {
  if (!runtime) {
    const legacyKey = getStoredApiKey();
    runtime = new AuthenticatedClientRuntime({
      endpoint: resolveEndpoint(),
      keyStore: new IndexedDbDeviceKeyStore(),
      sessionStore: new LocalStorageSessionStore(),
      ...(legacyKey ? { legacyApiKey: legacyKey } : {}),
      onStateChange: (state: AuthState) => {
        currentState = state;
        for (const listener of listeners) listener(state);
      },
    });
  }
  return runtime;
}

/**
 * Idempotent — every caller awaits the same initialization.
 *
 * Probes the server's *public* discovery endpoint first so the runtime knows
 * whether a credential is required at all. Without this, a developer running
 * the server with `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1` would see
 * every request fail locally with "not paired" even though the server would
 * have accepted it.
 */
export function initAuth(): Promise<AuthState> {
  initPromise ??= (async () => {
    const rt = getAuthRuntime();
    try {
      const response = await fetch(`${resolveEndpoint()}/api/auth/server-info`);
      if (response.ok) {
        const body = (await response.json()) as { authentication?: { required?: boolean } };
        rt.setAllowUnauthenticated(body.authentication?.required === false);
      }
    } catch {
      // Server unreachable — assume authentication is required, which is the
      // safe assumption: we would rather show a pairing screen than send
      // unauthenticated requests to something we could not identify.
    }
    return rt.initialize();
  })();
  return initPromise;
}

/**
 * Test seam: lets unit tests drive `apiFetch` without a paired device.
 *
 * Deliberately NOT a general "disable auth" switch — it only relaxes the
 * client's local precondition, exactly as a dev unauthenticated server does.
 */
export function __setAllowUnauthenticatedForTests(allow: boolean): void {
  getAuthRuntime().setAllowUnauthenticated(allow);
}
export function getAuthState(): AuthState {
  return currentState;
}

export function subscribeToAuthState(listener: (state: AuthState) => void): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => listeners.delete(listener);
}

/**
 * True when the SPA can talk to the API right now — either paired, or in
 * legacy shared-key mode.
 */
export function isAuthenticated(): boolean {
  return currentState.status === 'authenticated' || Boolean(getStoredApiKey());
}

// ── Pairing ────────────────────────────────────────────────────────

export function previewPairingCode(code: string): PairingConsent {
  return parsePairingCode(code);
}

/**
 * Resolves typed or pasted pairing input into a consent screen.
 *
 * Two shapes are accepted, and which one you get depends on how the user got
 * here rather than on anything they have to understand:
 *
 *   - A short typed code (`4H7K-2M9P-XQ3T`). The endpoint is NOT in the code,
 *     because it does not need to be: the user is typing this into an app they
 *     already loaded from the host, so `window.location.origin` IS the server.
 *     Asking the host what the code grants gives the same informed-consent
 *     screen the QR flow renders offline.
 *   - A full offer blob or `generatorai://pair?code=…` link, which carries its
 *     own endpoint list and is decoded without a network round-trip. This is
 *     still required for QR scans and for pairing a device that cannot reach
 *     this server on the origin it is currently loaded from.
 */
export async function resolvePairingInput(input: string): Promise<PairingConsent> {
  const trimmed = input.trim();
  if (!isPairingCode(trimmed)) {
    return parsePairingCode(trimmed);
  }

  const pairingGrant = normalizePairingCode(trimmed);
  const origin = resolveEndpoint();
  let response: Response;
  try {
    response = await fetch(`${origin}/api/auth/pair/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairingToken: pairingGrant }),
      // Bypass the auth fetch interceptor. This endpoint is deliberately
      // pre-auth: the device asking has no session yet, which is the entire
      // reason it is asking. Routing it through the runtime would fail with
      // "not paired" on the one request whose job is to start pairing.
      // Symbol.for keeps this in sync with authTransport without importing it
      // (which would be circular).
      [Symbol.for('generatorai.signedRequest')]: true,
    } as RequestInit);
  } catch {
    throw new PairingCodeError(
      `Could not reach ${origin}. Check that you opened this page from the host device's address.`,
      'UNREACHABLE',
    );
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      body && typeof body === 'object' && 'error' in body
        ? (body as { error?: { code?: string; message?: string } }).error
        : undefined;
    throw new PairingCodeError(
      error?.message ?? 'This pairing code is not valid.',
      error?.code ?? 'INVALID_GRANT',
    );
  }

  const preview = body as {
    serverId: string;
    serverName: string;
    requestedScopes: string[];
    expiresAt: number;
    endpoints?: Array<{ origin: string; reachability: string; priority: number }>;
  };

  // The origin the user is already talking to is the endpoint to pin. The
  // host's advertised list is kept as fallbacks, but never ahead of the one
  // that is demonstrably reachable from this device.
  const advertised = (preview.endpoints ?? []).filter((e) => e.origin !== origin);
  return {
    serverName: preview.serverName,
    endpoint: origin,
    endpoints: [
      { origin, reachability: 'lan', priority: 0 },
      ...advertised.map((e, index) => ({
        origin: e.origin,
        reachability: e.reachability as PairingConsent['endpoints'][number]['reachability'],
        priority: index + 1,
      })),
    ],
    serverId: preview.serverId,
    fingerprint: formatFingerprint(preview.serverId),
    requestedScopes: preview.requestedScopes,
    transportCapabilities: ['lan'],
    relayOffered: false,
    expiresAt: preview.expiresAt,
    pairingGrant,
  };
}

export async function acceptPairing(
  consent: PairingConsent,
  deviceName: string,
  /**
   * The SPA is served both in a browser tab and inside the Electron shell.
   * Recording which one it is keeps the device list honest — otherwise every
   * device shows up as "web" and a user cannot tell their desktop app apart
   * from a browser they paired months ago.
   */
  platform: 'web' | 'desktop' = 'web',
): Promise<void> {
  const rt = getAuthRuntime();
  await rt.completePairing({
    endpoint: consent.endpoint,
    endpoints: consent.endpoints.map((endpoint) => endpoint.origin),
    serverId: consent.serverId,
    pairingToken: consent.pairingGrant,
    deviceName,
    platform,
    connectionMode: 'auto',
  });
  // Remember the endpoint so a reload reconnects to the same server.
  try {
    window.localStorage.setItem('generatorai-endpoint', consent.endpoint);
  } catch {
    // Private-browsing mode — the session still works for this tab.
  }
}

export async function signOut(): Promise<void> {
  await getAuthRuntime().forget();
  try {
    window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    window.localStorage.removeItem('generatorai-endpoint');
  } catch {
    // Ignore.
  }
  // A full reload guarantees no stale in-memory query cache survives logout.
  window.location.reload();
}

export type { AuthState, PairingConsent };
