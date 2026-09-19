// ────────────────────────────────────────────────────────────────
// AuthProvider — wires the shared auth runtime to the mobile platform.
//
//   AuthenticatedClientRuntime   credentials, DPoP, refresh, tickets
//            ▲
//            │ fetchImpl
//   EndpointSupervisor           which route, host pinning, failover
//            ▲
//            │
//   DirectTransport / RelayTransport
//
// The runtime is given a `fetchImpl` that routes through whichever transport
// the supervisor selected. That indirection is what lets the SAME credential
// code work over loopback, LAN and the relay — and it keeps the security
// rule that transport never implies authorization structurally true, because
// the auth layer literally cannot see which transport it is using.
// ────────────────────────────────────────────────────────────────

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import {
  AuthenticatedClientRuntime,
  type AuthState,
  type PairingConsent,
} from '@generatorai/client-runtime';
import {
  EndpointSupervisor,
  HostIdentityMismatchError,
  type TransportStatus,
} from '@generatorai/client-transport';

import { MobileDeviceKeyStore, MobileSessionStore, type KeyBacking } from './stores';
import { registerAuthenticatedFetch } from './backgroundFetch';
import { resetStepUp } from './stepUp';
import {
  isStorageUnavailableError,
  nextRestorePhase,
  shouldRetryRestore,
  type RestoreEvent,
  type RestorePhase,
} from './restoreState';
import { buildEndpointCandidates } from '../transport/endpointPlan';
import { PREF_KEYS, prefs } from '../storage/prefs';

export interface AuthContextValue {
  state: AuthState;
  /**
   * True until the stored session has been read and validated.
   *
   * This exists because `AuthState` has no "don't know yet" member: it starts
   * at `unpaired`, which is indistinguishable from "we looked and there is no
   * session". The entry gate acted on that first frame and redirected to
   * /pair before the async restore could run — so every cold start of an
   * already-paired app landed on the pairing screen, and nothing sent the
   * user back once auth resolved.
   *
   * Callers must treat `initializing` as "render a spinner", never as a
   * reason to route.
   */
  initializing: boolean;
  /**
   * The stored session exists (or might) but protected storage refused to
   * read it — the phone is locked, or the Keystore is briefly unavailable.
   * NOT the same as `unpaired`: the gate shows "Unlock to continue" and the
   * restore re-runs when the app next becomes active. See `restoreState.ts`.
   */
  storageLocked: boolean;
  /** Re-run a restore that stopped at `storageLocked`. */
  retryRestore(): void;
  transport: TransportStatus;
  /** Where the private key lives. Surfaced in Settings → Security. */
  keyBacking: KeyBacking;
  /** Authenticated fetch, already routed and DPoP-signed. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /**
   * The origin the runtime resolved to, or null before one exists.
   *
   * Needed by the multiplexed stream: RN's authenticated fetch cannot produce
   * a streaming body, so the long-lived attach runs through `expo/fetch`,
   * which has no notion of a base endpoint and needs an absolute url. Every
   * other caller should use `fetch`/`streamUrl` and stay out of URL building.
   */
  endpoint: string | null;
  /** Mint a single-use ticket and build an SSE/WS URL. */
  streamUrl(scope: string, id: string | null): Promise<string>;
  socketUrl(path: string, scope: string, id: string | null): Promise<string>;
  completePairing(consent: PairingConsent, deviceName: string): Promise<void>;
  unpair(): Promise<void>;
  reconnect(): Promise<void>;
  /**
   * Re-mint the access token so scopes granted elsewhere take effect.
   * Scopes live inside the token, so nothing else picks them up.
   */
  refreshPermissions(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * Ask the host who it is.
 *
 * Deliberately uses the RAW global fetch, not the runtime's authenticated
 * one: this call happens BEFORE we are willing to send a credential to this
 * address. Routing it through the authenticated path would defeat the entire
 * purpose of the check.
 */
async function verifyHostIdentity(endpoint: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${endpoint}/api/auth/server-info`, {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`server-info returned ${res.status}`);
  const body = (await res.json()) as { serverId?: string };
  if (!body.serverId) throw new Error('server-info did not include a serverId');
  return body.serverId;
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<AuthState>({ status: 'unpaired' });
  // Starts `restoring`; `initializing` and `storageLocked` are views of it.
  // See `AuthContextValue.initializing` and `restoreState.ts`.
  const [restorePhase, setRestorePhase] = useState<RestorePhase>('restoring');
  const restorePhaseRef = useRef<RestorePhase>('restoring');
  const dispatchRestore = useCallback((event: RestoreEvent) => {
    const next = nextRestorePhase(restorePhaseRef.current, event);
    restorePhaseRef.current = next;
    setRestorePhase(next);
  }, []);
  // Bumped to re-run the restore effect after a locked read.
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const initializing = restorePhase === 'restoring';
  const storageLocked = restorePhase === 'locked';
  const [transport, setTransport] = useState<TransportStatus>({ state: 'idle' });
  const [keyBacking, setKeyBacking] = useState<KeyBacking>('software');

  const keyStore = useRef(new MobileDeviceKeyStore()).current;
  const sessionStore = useRef(new MobileSessionStore()).current;
  const supervisorRef = useRef<EndpointSupervisor | null>(null);
  const runtimeRef = useRef<AuthenticatedClientRuntime | null>(null);

  /**
   * Rebuild the supervisor for a session.
   *
   * Called on boot and after pairing, because the candidate list depends on
   * the pinned endpoint we only learn from the stored session.
   */
  const buildSupervisor = useCallback(
    (
      pairedEndpoint: string,
      pinnedServerId: string,
      endpoints?: readonly string[],
    ): EndpointSupervisor => {
      const supervisor = new EndpointSupervisor({
        pinnedServerId,
        candidates: buildEndpointCandidates({
          pairedEndpoint,
          discoveredEndpoints: endpoints?.filter((endpoint) => endpoint !== pairedEndpoint),
          localOnly: prefs.getBoolean(PREF_KEYS.localOnly),
        }),
        verifyHost: verifyHostIdentity,
        onStatusChange: setTransport,
      });
      supervisorRef.current = supervisor;
      return supervisor;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Which way the attempt ended; applied in `finally` so every path —
      // including a throw nobody anticipated — leaves the spinner.
      let outcome: RestoreEvent = { type: 'settled' };
      try {
        let session: Awaited<ReturnType<MobileSessionStore['load']>>;
        try {
          session = await sessionStore.load();
        } catch {
          // A READ failure is not an absent session. Treating it as one sent
          // every locked-phone launch (notification action, background wake)
          // to /pair. Any rejection here counts: the item could not be read,
          // so nothing is known about whether this device is paired.
          outcome = { type: 'storage-unavailable' };
          return;
        }
        if (cancelled) return;

        if (!session) {
          setState({ status: 'unpaired' });
          return;
        }

        const supervisor = buildSupervisor(session.endpoint, session.serverId, session.endpoints);

        const runtime = new AuthenticatedClientRuntime({
          endpoint: session.endpoint,
          keyStore,
          sessionStore,
          // Every request goes through the selected transport. Connecting
          // lazily here means a cold start does not block on the network
          // until something actually needs data.
          fetchImpl: async (input, init) => {
            const adapter = await supervisor.connect(3, init?.signal ?? undefined);
            return adapter.fetch(String(input), init as RequestInit);
          },
          onStateChange: (next) => {
            if (!cancelled) setState(next);
          },
        });
        runtimeRef.current = runtime;

        try {
          let next = await runtime.initialize();
          // A cold start races the network: the radio is still waking, or the
          // JS thread is busy enough that the 4 s identity probe times out.
          // One quiet retry turns that common first-launch "Can't reach your
          // server" flash into a normal start; a host that is really down
          // still lands on the error screen a moment later.
          if (!cancelled && next.status === 'error') {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            if (!cancelled) next = await runtime.retryInitialize();
          }
          if (!cancelled) {
            setState(next);
            setKeyBacking(keyStore.backing);
          }
        } catch (err) {
          if (cancelled) return;
          // The device key (or the session, re-read inside the runtime) sits
          // in the same protected storage and fails the same way when locked.
          if (isStorageUnavailableError(err)) {
            outcome = { type: 'storage-unavailable' };
            return;
          }
          if (err instanceof HostIdentityMismatchError) {
            // Surfaced as a blocking screen: this is a security event, not a
            // transient network error, and it must not be retried silently.
            setState({ status: 'error', message: err.message });
            return;
          }
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        // Must run on every path, including the early `!session` return and
        // any throw — otherwise the app is stuck on the spinner forever.
        if (!cancelled) dispatchRestore(outcome);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [buildSupervisor, keyStore, sessionStore, dispatchRestore, restoreAttempt]);

  const retryRestore = useCallback(() => {
    if (restorePhaseRef.current !== 'locked') return;
    dispatchRestore({ type: 'retry' });
    setRestoreAttempt((n) => n + 1);
  }, [dispatchRestore]);

  // Unlocking the phone and opening the app makes it `active`: that is the
  // moment protected storage becomes readable again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (shouldRetryRestore(restorePhaseRef.current, next)) retryRestore();
    });
    return () => sub.remove();
  }, [retryRestore]);

  const completePairing = useCallback(
    async (consent: PairingConsent, deviceName: string) => {
      setState({ status: 'pairing' });

      const endpoints = consent.endpoints.map((endpoint) => endpoint.origin);
      const supervisor = buildSupervisor(consent.endpoint, consent.serverId, endpoints);
      const runtime = new AuthenticatedClientRuntime({
        endpoint: consent.endpoint,
        keyStore,
        sessionStore,
        fetchImpl: async (input, init) => {
          const adapter = await supervisor.connect(3, init?.signal ?? undefined);
          return adapter.fetch(String(input), init as RequestInit);
        },
        onStateChange: setState,
      });
      runtimeRef.current = runtime;

      await runtime.completePairing({
        pairingToken: consent.pairingGrant,
        deviceName,
        platform: 'mobile',
        serverId: consent.serverId,
        endpoint: consent.endpoint,
        endpoints,
      });

      setKeyBacking(keyStore.backing);
    },
    [buildSupervisor, keyStore, sessionStore],
  );

  const unpair = useCallback(async () => {
    await runtimeRef.current?.forget();
    await supervisorRef.current?.disconnect();
    // Clear the key too: leaving it behind would let a later pairing reuse a
    // keypair the server has already revoked.
    await keyStore.clear();
    // A biometric step-up granted to the old pairing must not carry over to
    // the next one.
    resetStepUp();
    supervisorRef.current = null;
    runtimeRef.current = null;
    setState({ status: 'unpaired' });
    setTransport({ state: 'idle' });
  }, [keyStore]);

  const reconnect = useCallback(async () => {
    await supervisorRef.current?.invalidate('manual reconnect');
    try {
      await supervisorRef.current?.connect(3);
    } catch {
      // Still unreachable: the retry below reports it through the auth state.
    }
    // A launch that failed left auth in `error`; reconnecting the transport
    // alone never leaves that screen, so re-run initialisation too.
    const runtime = runtimeRef.current;
    if (runtime) setState(await runtime.retryInitialize());
  }, []);

  const refreshPermissions = useCallback(async () => {
    const next = await runtimeRef.current?.refreshSession();
    if (next) setState(next);
  }, []);

  // These operations read the current runtime through a ref. Keep their
  // identities stable across transport/credential status updates: consumers
  // such as TerminalView must not tear down a live socket on every update.
  const authenticatedFetch = useCallback<AuthContextValue['fetch']>((path, init) => {
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error('Not paired');
    return runtime.fetch(path, init);
  }, []);
  const streamUrl = useCallback<AuthContextValue['streamUrl']>((scope, id) => {
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error('Not paired');
    return runtime.buildStreamUrl(scope, id);
  }, []);
  const socketUrl = useCallback<AuthContextValue['socketUrl']>((path, scope, id) => {
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error('Not paired');
    return runtime.buildSocketUrl(path, scope, id);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      initializing,
      storageLocked,
      retryRestore,
      transport,
      keyBacking,
      fetch: authenticatedFetch,
      // Recomputed whenever `state` changes, which is the only time the
      // runtime is built or replaced — pairing, restore, unpair, revoke.
      endpoint: runtimeRef.current?.endpoint ?? null,
      streamUrl,
      socketUrl,
      completePairing,
      unpair,
      reconnect,
      refreshPermissions,
    }),
    [
      state,
      initializing,
      storageLocked,
      retryRestore,
      transport,
      keyBacking,
      completePairing,
      unpair,
      reconnect,
      refreshPermissions,
      authenticatedFetch,
      streamUrl,
      socketUrl,
    ],
  );

  // ── Non-React access to the signed fetch (notifications/backgroundFetch) ──
  // Lock-screen Allow/Deny actions POST a decision while no screen is
  // mounted; they reach the runtime through this module-level accessor.
  useEffect(() => {
    registerAuthenticatedFetch(value.fetch);
    return () => registerAuthenticatedFetch(null);
  }, [value.fetch]);
  // ── end non-React access ──────────────────────────────────────────────

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
