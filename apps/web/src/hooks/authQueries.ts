// ────────────────────────────────────────────────────────────────
// Auth gate data (P5-11; 03-component-inventory-domain.md §3.10 F-pairing-01).
//
// `app/shell/AuthGate.tsx` (the gate's logic) and `features/pairing/PairingGate`
// (the view) both reach the single auth runtime through here — features/ may
// not import `platform/*` directly (D-04), so every platform call this pair
// of components needs is re-exported or wrapped below.
//
// `resolveGateOutcome` is pulled out as a pure function on purpose: it is the
// one branchy bit of real risk in the AuthGate split (loading vs the app vs
// the pairing screen), so it gets a unit test instead of relying on the
// headed walkthrough alone.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import {
  acceptPairing,
  getStoredApiKey,
  initAuth,
  resolvePairingInput,
  subscribeToAuthState,
  type AuthState,
  type PairingConsent,
} from '@/platform/authRuntime.js';

export type { AuthState, PairingConsent };

/** Best-effort friendly name so the device list is readable without editing. */
export function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  return `${browser} on ${os}`;
}

export type GateOutcome = 'loading' | 'app' | 'pairing';

/**
 * Which of AuthGate's three outcomes applies. Pure — no DOM, no platform
 * calls — so the split from the original inline JSX conditions is verifiable
 * without mounting anything. Mirrors the pre-split behaviour exactly:
 * loading while not ready or mid silent-desktop-pairing, otherwise the app
 * for an authenticated session / an open (unauthenticated-loopback) server /
 * a legacy shared API key, otherwise the pairing screen.
 */
export function resolveGateOutcome(input: {
  ready: boolean;
  autoPairing: boolean;
  authenticated: boolean;
  openServer: boolean;
  hasApiKey: boolean;
}): GateOutcome {
  if (!input.ready || input.autoPairing) return 'loading';
  if (input.authenticated || input.openServer || input.hasApiKey) return 'app';
  return 'pairing';
}

interface DesktopPairingBridge {
  isDesktop?: boolean;
  requestPairingCode?: (name?: string) => Promise<{ pairingUrl: string } | null>;
}

/**
 * Loosely typed on purpose, same as the pre-split code: `requestPairingCode`
 * is not part of the shared `window.generatoraiDesktop` ambient type (that
 * file documents this — only the widely-used bridge methods are declared
 * there; narrower ones stay behind a local optional-chain cast).
 */
function desktopPairingBridge(): DesktopPairingBridge | undefined {
  return (window as unknown as { generatoraiDesktop?: DesktopPairingBridge }).generatoraiDesktop;
}

export interface AuthGateState {
  ready: boolean;
  state: AuthState;
  /** The server allows unauthenticated loopback (a dev-only posture). */
  openServer: boolean;
  /** `undefined` until the first probe of this origin's `/api/auth/server-info` settles. */
  reachable: boolean | undefined;
  /** Desktop is silently enrolling itself; suppress the manual screen while this is true. */
  autoPairing: boolean;
  outcome: GateOutcome;
}

/**
 * Everything AuthGate needs to pick an outcome, plus what the pairing screen
 * shows for "Server address": auth-state subscription, the public
 * server-info probe (open-loopback detection and reachability, one fetch)
 * and desktop's silent auto-pairing handshake.
 */
export function useAuthGate(): AuthGateState {
  const [state, setState] = useState<AuthState>({ status: 'unpaired' });
  const [ready, setReady] = useState(false);
  const [openServer, setOpenServer] = useState(false);
  const [reachable, setReachable] = useState<boolean | undefined>(undefined);
  const [autoPairing, setAutoPairing] = useState(false);
  const autoPairAttempted = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState(setState);
    void initAuth().finally(() => setReady(true));
    return unsubscribe;
  }, []);

  // Probe the PUBLIC discovery endpoint on THIS origin: when the server
  // allows unauthenticated loopback there is nothing to pair, and forcing a
  // pairing screen would be a pointless wall in front of a local dev setup.
  // `/api/security/posture` cannot be used here — it needs a credential, so
  // it always 401s for exactly the clients that need this answer. The same
  // response also answers "is this server reachable at all" for the pairing
  // screen's "Server address" row (D-54's probe endpoint).
  //
  // Bypasses the auth fetch interceptor (`platform/authTransport.ts`, marker
  // documented there): unmarked, `window.fetch('/api/**')` is rerouted through
  // `AuthenticatedClientRuntime.fetch()`, which throws `NotPairedError` for an
  // unpaired device on a server that genuinely requires auth — even though
  // THIS ONE endpoint is deliberately public. Without the bypass, a real,
  // reachable, auth-required server (the common case) reports itself
  // "unreachable".
  useEffect(() => {
    if (state.status === 'authenticated') return;
    let cancelled = false;
    void fetch('/api/auth/server-info', { [Symbol.for('generatorai.signedRequest')]: true } as RequestInit)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ authentication?: { required?: boolean } }>;
      })
      .then((body) => {
        if (cancelled) return;
        setOpenServer(body.authentication?.required === false);
        setReachable(true);
      })
      .catch(() => {
        if (cancelled) return;
        setReachable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state.status]);

  // ── Desktop auto-pairing ─────────────────────────────────────────
  // The Electron shell started this server and owns a per-launch handshake
  // token, so it can mint a pairing code for its own renderer. The user is
  // not asked to confirm because they already trust the application they
  // launched — showing a pairing screen to the app that owns the server
  // would be security theatre.
  useEffect(() => {
    if (!ready || state.status === 'authenticated' || openServer) return;
    const desktop = desktopPairingBridge();
    if (!desktop?.isDesktop || typeof desktop.requestPairingCode !== 'function') return;

    // Once per page load, no matter how the auth state moves underneath us.
    //
    // Pairing itself emits auth-state changes, and `state.status` is a
    // dependency of this effect — so without this guard a completed pairing
    // re-triggers the effect, which mints another grant and pairs again. That
    // loop is silent (the catch below swallows it) and only shows up as the
    // server rate-limiting a blank window.
    if (autoPairAttempted.current) return;
    autoPairAttempted.current = true;

    let cancelled = false;
    setAutoPairing(true);
    void (async () => {
      try {
        const code = await desktop.requestPairingCode?.(`Desktop on ${defaultDeviceName()}`);
        if (cancelled || !code) return;
        const consent = await resolvePairingInput(code.pairingUrl);
        await acceptPairing(consent, 'GeneratorAI Desktop', 'desktop');
        window.location.reload();
      } catch {
        // Fall through to the manual pairing screen, which explains what to do.
      } finally {
        if (!cancelled) setAutoPairing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, state.status, openServer]);

  const outcome = resolveGateOutcome({
    ready,
    autoPairing,
    authenticated: state.status === 'authenticated',
    openServer,
    hasApiKey: Boolean(getStoredApiKey()),
  });

  return { ready, state, openServer, reachable, autoPairing, outcome };
}

/**
 * `?pair=` deep link (desktop `generatorai://pair?code=X` → `/?pair=X`, D-55):
 * reads and strips it from the address bar in one call — pairing material
 * must never survive into browser history, sync or extensions. Call once,
 * from an effect on mount (a plain function, not a hook, so the read/strip
 * happens exactly once regardless of Strict Mode's double-invoked renders).
 */
export function consumePairingCodeFromUrl(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('pair');
  if (!fromUrl) return carriedPairCode ?? '';
  params.delete('pair');
  const rest = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
  // Kept in this page's memory (never storage) so a pairing screen that
  // remounts — the auth gate passes through a checking state first — still
  // shows the code the link carried (D-126: the desktop opens another
  // server's page at `/?pair=<offer>`).
  carriedPairCode = fromUrl;
  return fromUrl;
}

let carriedPairCode: string | null = null;

/** Forget the linked code once it has been used. */
export function clearCarriedPairingCode(): void {
  carriedPairCode = null;
}

/** Resolves typed/pasted/linked pairing input into a consent screen. */
export const previewPairingConsent = resolvePairingInput;

/** Redeems a previewed consent and stores the resulting device credential. */
export async function confirmPairing(
  consent: PairingConsent,
  deviceName: string,
  platform: 'web' | 'desktop' = 'web',
): Promise<void> {
  await acceptPairing(consent, deviceName, platform);
  clearCarriedPairingCode();
}
