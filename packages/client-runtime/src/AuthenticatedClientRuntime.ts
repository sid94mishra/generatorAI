// ────────────────────────────────────────────────────────────────
// AuthenticatedClientRuntime — the shared client-side auth engine.
//
// Every GeneratorAI client (web SPA, Electron renderer, CLI, mobile) uses
// this. It owns:
//
//   * the device key and its DPoP proofs
//   * the access token + automatic refresh (with single-flight de-dup)
//   * server-nonce handling for clock-skewed clients
//   * pairing-code import and pairing completion
//   * short-lived stream tickets for SSE / WebSocket
//   * revocation detection → a clean "this device was revoked" signal
//
// It does NOT know about React, Node, or any specific transport: callers
// supply storage and (optionally) a `fetch` implementation.
// ────────────────────────────────────────────────────────────────

import {
  createDpopProof,
  type DeviceKey,
  type DeviceKeyStore,
  type PublicJwk,
} from './deviceKey.js';

export interface StoredSession {
  serverId: string;
  endpoint: string;
  /** Ordered direct origins. Absent on legacy sessions. */
  endpoints?: string[];
  deviceId: string;
  deviceName: string;
  scopes: string[];
  resumeSecret: string;
  resumeExpiresAt: number;
  credentialVersion: number;
}

/** Platform storage for the (sensitive) session. Must be encrypted at rest. */
export interface SessionStore {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export type AuthState =
  | { status: 'unpaired' }
  | { status: 'pairing' }
  | { status: 'authenticated'; deviceId: string; scopes: string[]; expiresAt: number }
  | { status: 'revoked'; reason: string }
  /**
   * `kind` separates "cannot reach the host" from "the host rejected this
   * device's saved session". Both are recoverable and neither is a
   * revocation, but they need different words in front of the user.
   */
  | { status: 'error'; message: string; kind?: 'unreachable' | 'credential' };

export interface ClientRuntimeOptions {
  /** Base URL of the GeneratorAI API, e.g. `http://127.0.0.1:3100`. */
  endpoint: string;
  keyStore: DeviceKeyStore;
  sessionStore: SessionStore;
  fetchImpl?: typeof fetch;
  onStateChange?: (state: AuthState) => void;
  /**
   * Legacy shared API key. Supported only so an existing local setup keeps
   * working during migration; it bypasses DPoP entirely.
   *
   * @deprecated Pair the device instead.
   */
  legacyApiKey?: string | undefined;
  /**
   * Permits unauthenticated requests when the client holds no credential.
   *
   * Set only when the server has reported that it is running in dev
   * unauthenticated-loopback mode. Without this, a developer running
   * `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1` would see every request
   * fail with `NotPairedError` even though the server would have accepted it.
   */
  allowUnauthenticated?: boolean;
  /** Maximum time to wait for one endpoint to prove its pinned identity. */
  identityProbeTimeoutMs?: number;
  clock?: () => number;
}

export class DeviceRevokedError extends Error {
  constructor(message = 'This device has been revoked') {
    super(message);
    this.name = 'DeviceRevokedError';
  }
}

/**
 * The stored resume credential was rejected, but the DEVICE was not revoked.
 *
 * These are two different facts and they were being conflated. A server that
 * cannot durably write the rotated credential — a full disk, a failed
 * transaction, a process killed between issuing and committing — answers the
 * next refresh with `INVALID_GRANT`, and treating that as a revocation wiped
 * the pairing and told the user "this device is no longer authorized", which
 * was neither true nor recoverable without going back to the host.
 *
 * The credential is genuinely unusable, so the session cannot continue; but
 * the key stays, the pairing stays, and the user is offered a retry with an
 * honest reason before anything is destroyed.
 */
export class CredentialRejectedError extends Error {
  constructor(
    message = 'The server did not accept this device’s saved session',
    readonly code: string = 'INVALID_GRANT',
  ) {
    super(message);
    this.name = 'CredentialRejectedError';
  }
}

/**
 * The server at the paired endpoint is not the server we paired with.
 *
 * Raised when the host's advertised identity no longer matches the `serverId`
 * pinned at pairing time. This is the signal that something is impersonating
 * the host — a LAN attacker answering on the same address, a hijacked DNS
 * name, or a relay attempting to substitute a different host. The client must
 * NOT send its credential, and the user must re-pair deliberately.
 */
export class HostIdentityChangedError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      'The server at this address is not the one this device paired with. ' +
        'Its identity key changed, which can mean the server was reinstalled — ' +
        'or that something is impersonating it. Re-pair only if you expected this.',
    );
    this.name = 'HostIdentityChangedError';
  }
}

export class NotPairedError extends Error {
  constructor(message = 'This client is not paired with a GeneratorAI server') {
    super(message);
    this.name = 'NotPairedError';
  }
}

/** Refresh this far before actual expiry so an in-flight request never 401s. */
const REFRESH_SKEW_MS = 60_000;

export class AuthenticatedClientRuntime {
  private key: DeviceKey | null = null;
  private session: StoredSession | null = null;
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private nonce: string | null = null;
  private activeEndpoint: string | null = null;
  private state: AuthState = { status: 'unpaired' };
  /** Single-flight: concurrent 401s must trigger ONE refresh, not N. */
  private refreshInFlight: Promise<void> | null = null;
  /** Single-flight guard so N parallel first requests load the vault once. */
  private initPromise: Promise<AuthState> | null = null;
  /** Overridable so a browser interceptor can inject an un-wrapped fetch. */
  private fetchImpl: typeof fetch | null = null;
  /**
   * Tri-state: `undefined` means "not yet determined", and triggers a one-off
   * posture probe the first time a credential would otherwise be required.
   */
  private allowUnauthenticated: boolean | undefined;
  private postureProbe: Promise<boolean> | null = null;
  /** Transport error from the posture probe, if it could not reach the server. */
  private probeFailure: Error | null = null;
  /**
   * Single-flight identity check. `null` = not yet verified this session.
   *
   * Pinning the host id at pairing time is worthless unless it is actually
   * checked, so this runs once per process before the first credential leaves
   * the device.
   */
  private identityCheck: Promise<void> | null = null;

  constructor(private readonly options: ClientRuntimeOptions) {
    this.fetchImpl = options.fetchImpl ?? null;
    // Left `undefined` on purpose when the caller did not say: that is the
    // "not yet determined" state which triggers the one-off posture probe.
    this.allowUnauthenticated = options.allowUnauthenticated;
  }

  /**
   * Replaces the transport used for every outbound call.
   *
   * The web client wraps `window.fetch` to sign all `/api` traffic; that
   * wrapper must hand the runtime the *native* fetch, otherwise signing a
   * request would recurse into the interceptor indefinitely.
   */
  setFetchImpl(impl: typeof fetch): void {
    this.fetchImpl = impl;
  }

  /**
   * Declares that the server accepts unauthenticated requests.
   *
   * Called after probing `/api/security/posture`. Never enables anything on
   * the server side — it only stops the client from refusing to send a
   * request the server would have honoured.
   */
  setAllowUnauthenticated(allow: boolean): void {
    this.allowUnauthenticated = allow;
    this.postureProbe = null;
  }

  get currentState(): AuthState {
    return this.state;
  }

  get endpoint(): string {
    return this.activeEndpoint ?? this.session?.endpoint ?? this.options.endpoint;
  }

  get isLegacyKeyMode(): boolean {
    return Boolean(this.options.legacyApiKey);
  }

  /** Loads persisted state. Safe to call repeatedly. */
  initialize(): Promise<AuthState> {
    this.initPromise ??= this.doInitialize();
    return this.initPromise;
  }

  /**
   * Re-runs initialisation after it ended in `error` (host unreachable at
   * launch). `initialize()` memoises its result, so without this a "Try again"
   * button could reconnect the transport yet leave the app on the error screen
   * forever. Any other state is returned unchanged.
   */
  retryInitialize(): Promise<AuthState> {
    if (this.state.status === 'error') {
      this.initPromise = null;
      this.identityCheck = null;
    }
    return this.initialize();
  }

  private async doInitialize(): Promise<AuthState> {
    if (this.options.legacyApiKey) {
      this.setState({ status: 'authenticated', deviceId: 'legacy', scopes: [], expiresAt: 0 });
      return this.state;
    }
    this.session = await this.options.sessionStore.load();
    this.key = await this.options.keyStore.load();
    if (!this.session || !this.key) {
      this.setState({ status: 'unpaired' });
      return this.state;
    }
    try {
      await this.refreshAccessToken();
    } catch (err) {
      if (err instanceof DeviceRevokedError) {
        await this.forget();
        this.setState({ status: 'revoked', reason: err.message });
      } else {
        this.setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return this.state;
  }

  // ── Pairing ─────────────────────────────────────────────────────

  /**
   * Completes pairing against a decoded offer.
   *
   * The caller is expected to have shown the user the host name, endpoint,
   * `serverId` fingerprint and requested scopes FIRST — this method assumes
   * consent has already been given.
   */
  async completePairing(params: {
    endpoint: string;
    endpoints?: string[];
    serverId: string;
    pairingToken: string;
    deviceName: string;
    platform: 'web' | 'desktop' | 'cli' | 'mobile' | 'other';
    connectionMode?: 'loopback' | 'lan' | 'ssh' | 'relay' | 'auto';
  }): Promise<StoredSession> {
    this.setState({ status: 'pairing' });

    const endpoints = normalizeEndpointList(params.endpoint, params.endpoints);
    const selectedEndpoint = await this.resolvePinnedEndpoint(params.serverId, endpoints);

    // A fresh key per pairing: re-pairing after a revoke must not resurrect
    // the old identity, and the server's unique-thumbprint index would reject
    // it anyway.
    const key = await this.options.keyStore.create();
    this.key = key;

    const url = `${selectedEndpoint}/api/auth/pair/complete`;
    const response = await this.fetchWithProof(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pairingToken: params.pairingToken,
        publicJwk: key.publicJwk,
        deviceName: params.deviceName,
        platform: params.platform,
        ...(params.connectionMode ? { connectionMode: params.connectionMode } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await safeErrorMessage(response);
      this.setState({ status: 'error', message: detail });
      throw new Error(`Pairing failed: ${detail}`);
    }

    const body = (await response.json()) as {
      deviceId: string;
      deviceName: string;
      scopes: string[];
      accessToken: string;
      accessTokenExpiresAt: number;
      resumeSecret: string;
      resumeExpiresAt: number;
      credentialVersion: number;
    };

    const session: StoredSession = {
      serverId: params.serverId,
      endpoint: selectedEndpoint,
      endpoints,
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      scopes: body.scopes,
      resumeSecret: body.resumeSecret,
      resumeExpiresAt: body.resumeExpiresAt,
      credentialVersion: body.credentialVersion,
    };
    await this.options.sessionStore.save(session);
    this.session = session;
    this.accessToken = body.accessToken;
    this.accessTokenExpiresAt = body.accessTokenExpiresAt;
    // Mark initialization as satisfied: we just loaded everything from the
    // pairing response, so a later `fetch()` must not re-read the vault and
    // rotate this brand-new resume credential for no reason.
    this.initPromise = Promise.resolve({
      status: 'authenticated',
      deviceId: body.deviceId,
      scopes: body.scopes,
      expiresAt: body.accessTokenExpiresAt,
    } satisfies AuthState);
    this.setState({
      status: 'authenticated',
      deviceId: body.deviceId,
      scopes: body.scopes,
      expiresAt: body.accessTokenExpiresAt,
    });
    return session;
  }

  /**
   * Re-mints the access token now, without waiting for it to expire.
   *
   * Scopes are carried IN the token, so a capability granted from another
   * device is invisible here until the next refresh. Without this the user
   * grants "Terminal" on their laptop, returns to the phone, and the tab is
   * still locked with no way to ask again.
   */
  async refreshSession(): Promise<AuthState> {
    await this.initialize();
    if (!this.session) return this.state;
    await this.refreshAccessToken();
    return this.state;
  }

  /** Deletes all local credentials. Used for logout and after revocation. */
  async forget(): Promise<void> {
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.activeEndpoint = null;
    this.session = null;
    this.key = null;
    // Reset the memo so a later call re-reads the (now empty) vault instead of
    // resolving to the stale pre-logout state.
    this.initPromise = null;
    await this.options.sessionStore.clear();
    await this.options.keyStore.clear();
    this.setState({ status: 'unpaired' });
  }

  // ── Authenticated requests ──────────────────────────────────────

  /**
   * Performs an authenticated request, attaching a fresh DPoP proof.
   * Retries exactly once on `401 use_dpop_nonce` or an expired token.
   */
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (this.options.legacyApiKey) {
      const url = path.startsWith('http') ? path : `${this.endpoint}${path}`;
      return this.doFetch(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          authorization: `Bearer ${this.options.legacyApiKey}`,
        },
      });
    }

    // Lazily load the stored credential. A CLI command or a background caller
    // should not have to remember to call `initialize()` first — forgetting it
    // would surface as a confusing "not paired" error on a device that is in
    // fact paired.
    await this.initialize();

    // No credential and none required: the server is a dev loopback listener
    // running with authentication explicitly disabled. Send the request as-is
    // rather than failing locally on a request the server would have accepted.
    if (!this.session && (await this.serverAllowsUnauthenticated())) {
      const url = path.startsWith('http') ? path : `${this.endpoint}${path}`;
      return this.doFetch(url, init);
    }

    // The probe could not reach the server at all. That is the fact the user
    // needs; "not paired" would point them at pairing when the address, the
    // port or the process is what is actually wrong.
    if (!this.session && this.probeFailure) throw this.probeFailure;

    try {
      await this.ensureAccessToken();
    } catch (error) {
      // A stored session that can no longer be refreshed — the usual cause is
      // a dev server restarted with fresh keys — must not brick the client.
      // Only discard it when the server says it needs no credential at all,
      // because then the stored one is provably worthless; if the server does
      // require auth, the failure is real and the caller must hear it.
      if (!(await this.serverAllowsUnauthenticated())) throw error;
      await this.forget();
      const url = path.startsWith('http') ? path : `${this.endpoint}${path}`;
      return this.doFetch(url, init);
    }

    const url = path.startsWith('http') ? path : `${this.endpoint}${path}`;
    let response = await this.signedRequest(url, init);

    if (response.status === 401) {
      const wwwAuth = response.headers.get('www-authenticate') ?? '';
      const freshNonce = response.headers.get('dpop-nonce');
      if (freshNonce) this.nonce = freshNonce;

      if (wwwAuth.includes('use_dpop_nonce') && freshNonce) {
        // Clock skew — retry immediately with the server's nonce.
        response = await this.signedRequest(url, init);
      } else {
        // Token may simply have expired between the check and the send.
        await this.refreshAccessToken();
        response = await this.signedRequest(url, init);
      }
    }

    if (response.status === 401) {
      const body = await response.clone().json().catch(() => null);
      const code = (body as { error?: { code?: string } } | null)?.error?.code;
      if (code === 'DEVICE_REVOKED' || code === 'CREDENTIAL_SUPERSEDED') {
        await this.forget();
        this.setState({ status: 'revoked', reason: 'The server revoked this device.' });
        throw new DeviceRevokedError();
      }
    }
    return response;
  }

  /**
   * Mints a single-use ticket for an `EventSource` / `WebSocket`, which cannot
   * carry an `Authorization` header.
   */
  async createStreamTicket(scope: string, id: string | null): Promise<string> {
    if (this.options.legacyApiKey) {
      // Legacy mode keeps the old query-param behaviour on loopback only.
      return this.options.legacyApiKey;
    }
    if (!this.session && (await this.serverAllowsUnauthenticated())) {
      // Nothing to mint, and a bogus `?ticket=` would be *rejected*: the
      // server tries to redeem a ticket before it ever reaches the
      // unauthenticated branch. Callers must omit the parameter entirely.
      return '';
    }
    const response = await this.fetch('/api/stream/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope, id }),
    });
    if (!response.ok) {
      throw new Error(`Could not obtain a stream ticket: ${await safeErrorMessage(response)}`);
    }
    const body = (await response.json()) as { ticket: string };
    return body.ticket;
  }

  /** Builds an SSE URL with a fresh ticket. The ticket dies in 30 seconds. */
  async buildStreamUrl(scope: string, id: string | null): Promise<string> {
    const ticket = await this.createStreamTicket(scope, id);
    const url = new URL(`${this.endpoint}/api/stream`);
    url.searchParams.set('scope', scope);
    if (id) url.searchParams.set('id', id);
    if (ticket) url.searchParams.set(this.options.legacyApiKey ? 'apiKey' : 'ticket', ticket);
    return url.toString();
  }

  /** Builds a WebSocket URL with a fresh ticket. */
  async buildSocketUrl(path: string, scope: string, id: string | null): Promise<string> {
    const ticket = await this.createStreamTicket(scope, id);
    const url = new URL(`${this.endpoint}${path}`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if (ticket) url.searchParams.set(this.options.legacyApiKey ? 'apiKey' : 'ticket', ticket);
    return url.toString();
  }

  // ── Internals ───────────────────────────────────────────────────

  private async ensureAccessToken(): Promise<void> {
    const now = this.now();
    if (this.accessToken && this.accessTokenExpiresAt - REFRESH_SKEW_MS > now) return;
    await this.refreshAccessToken();
  }

  /**
   * Confirms the host still presents the identity key pinned at pairing time.
   *
   * Runs once per process, before the first credential is transmitted. Pinning
   * the host id and never checking it would be security theatre: the point of
   * out-of-band pairing is that the client can detect a substituted server
   * even when TLS is absent, self-signed, or terminated by a relay.
   *
  * Network failures move to the next saved endpoint. If none can prove the
  * pinned identity, the credential stays local and the request fails closed.
   */
  private verifyPinnedIdentity(session: StoredSession): Promise<void> {
    if (!session.serverId) return Promise.resolve();
    if (!this.identityCheck) {
      const check = (async () => {
        await this.resolvePinnedEndpoint(
          session.serverId,
          normalizeEndpointList(session.endpoint, session.endpoints),
        );
      })();
      this.identityCheck = check;
      // Only a SUCCESS is memoised. A failed probe (phone briefly offline, host
      // asleep, Wi-Fi switching) must be retried on the next request; caching
      // the rejection would fail every request "unreachable" until restart.
      check.catch(() => {
        if (this.identityCheck === check) this.identityCheck = null;
      });
    }
    return this.identityCheck;
  }

  private async resolvePinnedEndpoint(serverId: string, endpoints: readonly string[]): Promise<string> {
    if (this.activeEndpoint) return this.activeEndpoint;
    const failures: string[] = [];
    for (const endpoint of endpoints) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        this.options.identityProbeTimeoutMs ?? 4_000,
      );
      try {
        const response = await this.doFetch(`${endpoint}/api/auth/server-info`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          failures.push(`${endpoint} returned ${response.status}`);
          continue;
        }
        const body = (await response.json()) as { serverId?: string };
        if (!body.serverId) {
          failures.push(`${endpoint} did not identify itself`);
          continue;
        }
        if (body.serverId !== serverId) {
          this.identityCheck = null;
          this.setState({ status: 'error', message: 'The server identity at this address changed.' });
          throw new HostIdentityChangedError(serverId, body.serverId);
        }
        this.activeEndpoint = endpoint;
        return endpoint;
      } catch (error) {
        if (error instanceof HostIdentityChangedError) throw error;
        failures.push(`${endpoint} is unreachable`);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`Could not verify the paired server identity. ${failures.join('; ')}`);
  }

  /**
   * Whether the server accepts unauthenticated requests.
   *
   * Probed at most once per runtime, against `/api/auth/server-info` — the
   * *public* discovery endpoint. `/api/security/posture` cannot be used here:
   * it requires a credential, so an unpaired client would always get 401 and
   * could never learn that the server does not actually want one.
   *
   * Without this, a developer running the server with
   * `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1` would see every client fail
   * with "not paired" even though the server would have answered.
   *
   * A failed probe resolves to `false`: if we cannot identify the server we
   * would rather demand a credential than send requests blind.
   */
  private serverAllowsUnauthenticated(): Promise<boolean> {
    if (this.allowUnauthenticated !== undefined) {
      return Promise.resolve(this.allowUnauthenticated);
    }
    this.postureProbe ??= this.doFetch(`${this.endpoint}/api/auth/server-info`, {})
      .then(async (response) => {
        if (!response.ok) return false;
        const body = (await response.json()) as {
          authentication?: { required?: boolean };
        };
        return body.authentication?.required === false;
      })
      .catch((error: unknown) => {
        // Remembered so an unreachable server is reported as unreachable
        // rather than as "not paired", which sends the user to fix the wrong
        // thing entirely.
        this.probeFailure = error instanceof Error ? error : new Error(String(error));
        return false;
      })
      .then((allow) => {
        this.allowUnauthenticated = allow;
        return allow;
      });
    return this.postureProbe;
  }

  private refreshAccessToken(): Promise<void> {
    // Single-flight — a burst of parallel requests must not rotate the resume
    // credential N times, which would invalidate all but one of them.
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.doRefresh()
      .catch(async (error) => {
        // ONE retry on a rejected credential before giving up. The server
        // keeps the previous generation in a grace window precisely so an
        // interrupted rotation can recover, and a rejection here is often a
        // race with the write that rotated it.
        if (error instanceof CredentialRejectedError) {
          try {
            await this.doRefresh();
            return;
          } catch (retryError) {
            if (retryError instanceof DeviceRevokedError) {
              await this.forget();
              this.setState({ status: 'revoked', reason: retryError.message });
            } else {
              // NOT `forget()`: the pairing and the key are still valid as far
              // as anyone knows, and destroying them turns a retryable
              // failure into a trip back to the host machine.
              this.setState({
                status: 'error',
                message: (retryError as Error).message,
                kind: 'credential',
              });
            }
            throw retryError;
          }
        }
        if (error instanceof DeviceRevokedError) {
          await this.forget();
          this.setState({ status: 'revoked', reason: error.message });
        }
        throw error;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<void> {
    const session = this.session;
    if (!session) throw new NotPairedError();

    // Identity FIRST, before any other precondition. If the host at this
    // address is not the one we paired with, that is the fact the user needs
    // to hear — reporting "not paired" instead would hide an active
    // impersonation behind a routine-looking error.
    //
    // This is the trust anchor that survives when TLS does not: a self-signed
    // LAN certificate, a plaintext port-forward, or a relay that terminates
    // the connection all leave the pinned host key as the only proof.
    await this.verifyPinnedIdentity(session);

    if (!this.key) throw new NotPairedError();

    const url = `${this.endpoint}/api/auth/token/refresh`;
    const response = await this.fetchWithProof(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resumeSecret: session.resumeSecret }),
    });

    if (response.status === 401 || response.status === 400) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      const code = body?.error?.code;
      // A REVOKED device or a key that does not match are decisions the
      // server made about this DEVICE: unrecoverable, and re-pairing is the
      // only route. Everything else is a statement about the CREDENTIAL.
      if (code === 'REVOKED' || code === 'INVALID_KEY') {
        throw new DeviceRevokedError('The server no longer recognises this device.');
      }
      if (code === 'INVALID_GRANT' || code === 'EXPIRED' || code === 'CREDENTIAL_SUPERSEDED') {
        throw new CredentialRejectedError(
          code === 'EXPIRED'
            ? 'This device’s saved session has expired.'
            : 'The server did not accept this device’s saved session.',
          code,
        );
      }
    }
    if (!response.ok) {
      throw new Error(`Token refresh failed: ${await safeErrorMessage(response)}`);
    }

    const body = (await response.json()) as {
      deviceId: string;
      deviceName: string;
      scopes: string[];
      accessToken: string;
      accessTokenExpiresAt: number;
      resumeSecret: string;
      resumeExpiresAt: number;
      credentialVersion: number;
    };

    // Persist the rotated resume credential BEFORE using the new access
    // token, so a crash here leaves the client with a credential the server
    // still honours (the server keeps the previous generation in grace).
    const updated: StoredSession = {
      ...session,
      deviceId: body.deviceId,
      deviceName: body.deviceName,
      scopes: body.scopes,
      resumeSecret: body.resumeSecret,
      resumeExpiresAt: body.resumeExpiresAt,
      credentialVersion: body.credentialVersion,
    };
    await this.options.sessionStore.save(updated);
    this.session = updated;
    this.accessToken = body.accessToken;
    this.accessTokenExpiresAt = body.accessTokenExpiresAt;
    this.setState({
      status: 'authenticated',
      deviceId: body.deviceId,
      scopes: body.scopes,
      expiresAt: body.accessTokenExpiresAt,
    });
  }

  private async signedRequest(url: string, init: RequestInit): Promise<Response> {
    const key = this.key;
    const token = this.accessToken;
    if (!key || !token) throw new NotPairedError();

    const proof = await createDpopProof({
      key,
      method: init.method ?? 'GET',
      url,
      accessToken: token,
      nonce: this.takeNonce(),
    });
    const response = await this.doFetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        authorization: `DPoP ${token}`,
        dpop: proof,
      },
    });
    const nonce = response.headers.get('dpop-nonce');
    if (nonce) this.nonce = nonce;
    return response;
  }

  /**
   * The server nonce for ONE proof. Server nonces are single-use: holding on to
   * one and signing it into every later proof meant each request after the
   * first carried a spent nonce and was rejected, which locked the client out.
   */
  private takeNonce(): string | undefined {
    const nonce = this.nonce ?? undefined;
    this.nonce = null;
    return nonce;
  }

  /** Proof without an access token — used by pairing and refresh. */
  private async fetchWithProof(url: string, init: RequestInit): Promise<Response> {
    const key = this.key;
    if (!key) throw new NotPairedError('No device key is available');

    let proof = await createDpopProof({
      key,
      method: init.method ?? 'GET',
      url,
      nonce: this.takeNonce(),
    });
    let response = await this.doFetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), dpop: proof },
    });

    const nonce = response.headers.get('dpop-nonce');
    if (nonce && response.status === 401) {
      proof = await createDpopProof({
        key,
        method: init.method ?? 'GET',
        url,
        nonce,
      });
      response = await this.doFetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), dpop: proof },
      });
    } else if (nonce) {
      this.nonce = nonce;
    }
    return response;
  }

  private doFetch(url: string, init: RequestInit): Promise<Response> {
    const impl = this.fetchImpl ?? fetch;
    return impl(url, init);
  }

  private setState(state: AuthState): void {
    this.state = state;
    this.options.onStateChange?.(state);
  }

  private now(): number {
    return this.options.clock?.() ?? Date.now();
  }
}

async function safeErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    if (body?.error?.message) return `${body.error.code ?? response.status}: ${body.error.message}`;
  } catch {
    // Non-JSON body.
  }
  return `HTTP ${response.status}`;
}

function normalizeEndpointList(primary: string, endpoints?: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of [primary, ...(endpoints ?? [])]) {
    try {
      const origin = new URL(value).origin;
      if (!seen.has(origin)) {
        seen.add(origin);
        result.push(origin);
      }
    } catch {
      // Pairing-offer validation rejects malformed endpoints; legacy stores may not.
    }
  }
  if (result.length === 0) throw new Error('No valid server endpoint is available.');
  return result;
}

export type { DeviceKey, DeviceKeyStore, PublicJwk };
