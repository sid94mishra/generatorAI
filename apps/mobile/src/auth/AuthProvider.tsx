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
  transport: TransportStatus;
  /** Where the private key lives. Surfaced in Settings → Security. */
  keyBacking: KeyBacking;
  /** Authenticated fetch, already routed and DPoP-signed. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
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
  // Starts true and is cleared exactly once, when the restore effect settles.
  // See `AuthContextValue.initializing`.
  const [initializing, setInitializing] = useState(true);
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
      try {
        const session = await sessionStore.load();
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
          const next = await runtime.initialize();
          if (!cancelled) {
            setState(next);
            setKeyBacking(keyStore.backing);
          }
        } catch (err) {
          if (cancelled) return;
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
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [buildSupervisor, keyStore, sessionStore]);

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
    supervisorRef.current = null;
    runtimeRef.current = null;
    setState({ status: 'unpaired' });
    setTransport({ state: 'idle' });
  }, [keyStore]);

  const reconnect = useCallback(async () => {
    await supervisorRef.current?.invalidate('manual reconnect');
    await supervisorRef.current?.connect(3);
  }, []);

  const refreshPermissions = useCallback(async () => {
    const next = await runtimeRef.current?.refreshSession();
    if (next) setState(next);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      initializing,
      transport,
      keyBacking,
      fetch: (path, init) => {
        const runtime = runtimeRef.current;
        if (!runtime) throw new Error('Not paired');
        return runtime.fetch(path, init);
      },
      streamUrl: (scope, id) => {
        const runtime = runtimeRef.current;
        if (!runtime) throw new Error('Not paired');
        return runtime.buildStreamUrl(scope, id);
      },
      socketUrl: (path, scope, id) => {
        const runtime = runtimeRef.current;
        if (!runtime) throw new Error('Not paired');
        return runtime.buildSocketUrl(path, scope, id);
      },
      completePairing,
      unpair,
      reconnect,
      refreshPermissions,
    }),
    [
      state,
      initializing,
      transport,
      keyBacking,
      completePairing,
      unpair,
      reconnect,
      refreshPermissions,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
