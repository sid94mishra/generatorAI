// ────────────────────────────────────────────────────────────────
// AuthGate — decides whether the SPA may render at all.
//
// Three outcomes:
//   * authenticated (device-paired, legacy shared key, or a server running
//     in dev-only unauthenticated loopback mode) → render the app
//   * unpaired / revoked → render the pairing screen
//   * still initialising → render a neutral splash
//
// The pairing screen accepts a code from three sources so it works on any
// device shape: a `?pair=` deep link, a paste, or a camera QR scan.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, Loader2, ArrowRight } from 'lucide-react';
import { isPairingCode } from '@generatorai/shared';
import {
  initAuth,
  subscribeToAuthState,
  resolvePairingInput,
  acceptPairing,
  getStoredApiKey,
  type AuthState,
  type PairingConsent,
} from '@/platform/authRuntime.js';

/**
 * Below this length an input cannot be a full offer blob, so it is still
 * mid-paste rather than something worth decoding. Short codes are recognised
 * separately by `isPairingCode`.
 */
const MIN_OFFER_LENGTH = 64;

/** Best-effort friendly name so the device list is readable without editing. */
function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
      : /Android/.test(ua) ? 'Android'
        : /iPhone|iPad/.test(ua) ? 'iOS'
          : /Linux/.test(ua) ? 'Linux' : 'Unknown';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'unpaired' });
  const [ready, setReady] = useState(false);
  /** The server may permit unauthenticated loopback in development. */
  const [openServer, setOpenServer] = useState(false);
  /** Desktop shells enrol silently; suppress the manual screen while trying. */
  const [autoPairing, setAutoPairing] = useState(false);
  const autoPairAttempted = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState(setState);
    void initAuth().finally(() => setReady(true));
    return unsubscribe;
  }, []);

  // Probe the PUBLIC discovery endpoint: when the server allows unauthenticated
  // loopback there is nothing to pair, and forcing a pairing screen would be a
  // pointless wall in front of a local dev setup. `/api/security/posture`
  // cannot be used here — it needs a credential, so it always 401s for exactly
  // the clients that need this answer.
  useEffect(() => {
    if (state.status === 'authenticated') return;
    let cancelled = false;
    void fetch('/api/auth/server-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { authentication?: { required?: boolean } } | null) => {
        if (cancelled) return;
        setOpenServer(body?.authentication?.required === false);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state.status]);

  // ── Desktop auto-pairing ─────────────────────────────────────────
  // The Electron shell started this server and owns a per-launch handshake
  // token, so it can mint a pairing code for its own renderer. The user is
  // not asked to confirm because they already trust the application they
  // launched — showing a QR screen to the app that owns the server would be
  // security theatre.
  useEffect(() => {
    if (!ready || state.status === 'authenticated' || openServer) return;
    const desktop = (window as unknown as {
      generatoraiDesktop?: {
        isDesktop?: boolean;
        requestPairingCode?: (
          name?: string,
        ) => Promise<{ pairingUrl: string } | null>;
      };
    }).generatoraiDesktop;
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

  if (!ready || autoPairing) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state.status === 'authenticated' || openServer || getStoredApiKey()) {
    return <>{children}</>;
  }

  return <PairingScreen state={state} />;
}

function PairingScreen({ state }: { state: AuthState }) {
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState<PairingConsent | null>(null);
  /** True while a typed short code is being resolved against the host. */
  const [resolving, setResolving] = useState(false);
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Accept `generatorai://pair?code=…` style deep links and `/?pair=…`.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('pair');
    if (!fromUrl) return;
    setCode(fromUrl);
    // Strip the code from the address bar immediately: browser history,
    // sync and extensions must never retain pairing material.
    params.delete('pair');
    const rest = params.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${rest ? `?${rest}` : ''}`,
    );
  }, []);

  // Monotonic token that invalidates in-flight previews. Short codes resolve
  // over the network, so a user still typing can easily have two requests in
  // flight; without this the slower one can overwrite the newer result and
  // show consent for a code that is no longer in the box.
  const previewToken = useRef(0);

  const preview = useCallback((raw: string) => {
    const token = ++previewToken.current;
    setError(null);
    const trimmed = raw.trim();
    if (!trimmed) {
      setConsent(null);
      setResolving(false);
      return;
    }
    // Wait for a complete code before asking the host about it, so every
    // keystroke of a 12-character code does not spend a throttle slot.
    if (!isPairingCode(trimmed) && trimmed.length < MIN_OFFER_LENGTH) {
      setConsent(null);
      setResolving(false);
      return;
    }

    setResolving(true);
    void resolvePairingInput(trimmed).then(
      (next) => {
        if (token !== previewToken.current) return;
        setConsent(next);
        setResolving(false);
      },
      (err: unknown) => {
        if (token !== previewToken.current) return;
        setConsent(null);
        setResolving(false);
        setError(err instanceof Error ? err.message : 'That pairing code is not valid.');
      },
    );
  }, []);

  useEffect(() => {
    if (code) preview(code);
  }, [code, preview]);

  const confirm = useCallback(async () => {
    if (!consent) return;
    setBusy(true);
    setError(null);
    try {
      await acceptPairing(consent, deviceName.trim() || defaultDeviceName());
      window.location.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }, [consent, deviceName]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg space-y-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {state.status === 'revoked' ? (
              <ShieldAlert className="h-5 w-5" />
            ) : (
              <ShieldCheck className="h-5 w-5" />
            )}
          </span>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {state.status === 'revoked' ? 'This device was revoked' : 'Pair this device'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {state.status === 'revoked'
                ? 'Its access was removed from the server. Pair again to continue.'
                : 'Open Settings → Security on a device that is already connected and generate a pairing code.'}
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-card p-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-foreground">Pairing code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoCapitalize="characters"
              autoComplete="one-time-code"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              placeholder="4H7K-2M9P-XQ3T"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.2em] uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:tracking-[0.2em] placeholder:text-muted-foreground/50"
            />
            <span className="block text-[11px] text-muted-foreground">
              Type the code shown on the host device. Scanning a QR code or opening a pairing
              link fills this in for you.
            </span>
          </label>

          {resolving && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking this code…
            </p>
          )}

          {consent && (
            <div className="space-y-3 rounded-md border border-border bg-subtle/40 p-3.5">
              {/* Consent must be *informed*: the user has to see which host
                  they are trusting and exactly what it will be able to do. */}
              <p className="text-xs font-medium text-foreground">You are about to connect to:</p>
              <dl className="space-y-1 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Server</dt>
                  <dd className="font-medium text-foreground">{consent.serverName ?? 'GeneratorAI'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Endpoint</dt>
                  <dd className="font-mono text-foreground">{consent.endpoint}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Host identity</dt>
                  <dd className="font-mono text-foreground" title={consent.serverId}>
                    {consent.serverId.slice(0, 8)}…{consent.serverId.slice(-8)}
                  </dd>
                </div>
              </dl>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">This device will be granted:</p>
                <div className="flex flex-wrap gap-1">
                  {consent.requestedScopes.map((s) => (
                    <span
                      key={s}
                      className="rounded bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">Name this device</span>
                <input
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={!consent || busy}
            onClick={() => void confirm()}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {busy ? 'Pairing…' : 'Connect'}
          </button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          A pairing code is single-use and expires in 10 minutes. Your device generates its own
          key, which never leaves this browser.
        </p>
      </div>
    </div>
  );
}
