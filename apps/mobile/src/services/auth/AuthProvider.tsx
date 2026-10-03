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
  useReducer,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import {
  AuthenticatedClientRuntime,
  type AuthState,
  type PairingConsent,
  type ServerConnection,
  probeServer,
} from '@generatorai/client-runtime';
import {
  EndpointSupervisor,
  HostIdentityMismatchError,
  type TransportStatus,
} from '@generatorai/client-transport';

import { MobileDeviceKeyStore, MobileSessionStore, clearLegacyCredentials, type KeyBacking } from './stores';
import { serverRegistry } from './serverRegistry';
import { registerAuthenticatedFetch, setBackgroundActiveServer, clearAuthenticatedFetches } from './backgroundFetch';
import { resetStepUp } from './stepUp';
import {
  isStorageUnavailableError,
  nextRestorePhase,
  shouldRetryRestore,
  type RestoreEvent,
  type RestorePhase,
} from './restoreState';
import { buildEndpointCandidates } from '../transport/endpointPlan';
import { assertServerWriteAllowed } from '../api/offlinePolicy';
import { clearServerQueryCache } from '../api/queryPersister';
import { PREF_KEYS, prefs } from '../storage/prefs';
import { liveStore } from '../live/liveStore';

export interface AuthContextValue {
  state: AuthState;
  serverId: string | null;
  servers: ServerConnection[];
  switchServer(id: string): Promise<void>;
  probeServer(id: string): ReturnType<typeof probeServer>;
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
  unpair(serverId?: string): Promise<void>;
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

interface AuthSnapshot {
  state: AuthState;
  endpoint: string | null;
}
const INITIAL_AUTH_SNAPSHOT: AuthSnapshot = { state: { status: 'unpaired' }, endpoint: null };
/** A full snapshot replaces; `{ endpoint }` alone refreshes the endpoint (a transport change), keeping the state. */
const replaceAuthSnapshot = (previous: AuthSnapshot, next: AuthSnapshot | { endpoint: string | null }): AuthSnapshot =>
  'state' in next ? next : next.endpoint === previous.endpoint ? previous : { ...previous, endpoint: next.endpoint };
const authSnapshot = (state: AuthState, runtime: AuthenticatedClientRuntime | null): AuthSnapshot => ({ state, endpoint: runtime?.endpoint ?? null });

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [serverId, setServerId] = useState<string | null>(() => serverRegistry.read().activeServerId);
  const activeServerRef = useRef(serverId);
  const pairingRef = useRef(false);
  const [servers, setServers] = useState(() => serverRegistry.read().connections);
  // The auth state and the active runtime's endpoint change together (the runtime is built or replaced only with a
  // state change — pairing, restore, unpair, revoke), so one reducer holds both and render never reads the ref.
  const [{ state, endpoint }, dispatchAuth] = useReducer(replaceAuthSnapshot, INITIAL_AUTH_SNAPSHOT);
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

  const keyStore = useMemo(() => serverId ? new MobileDeviceKeyStore(serverId) : null, [serverId]);
  const sessionStore = useMemo(() => serverId ? new MobileSessionStore(serverId) : null, [serverId]);
  const runtimes = useRef(new Map<string, { runtime: AuthenticatedClientRuntime; supervisor: EndpointSupervisor; keyStore: MobileDeviceKeyStore; state: AuthState }>());
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
        onStatusChange: (next) => {
          if (activeServerRef.current !== pinnedServerId) return;
          setTransport(next);
          // The context's endpoint followed every transport change before M10-01 (it was read in the memo).
          dispatchAuth({ endpoint: runtimeRef.current?.endpoint ?? null });
        },
      });
      return supervisor;
    },
    [],
  );

  const getRuntime = useCallback((id: string, endpoint: string, endpoints?: readonly string[]) => {
    const existing = runtimes.current.get(id);
    if (existing) return existing;
    const keys = new MobileDeviceKeyStore(id);
    const sessions = new MobileSessionStore(id);
    const supervisor = buildSupervisor(endpoint, id, endpoints);
    let latest: AuthState = { status: 'unpaired' };
    const runtime = new AuthenticatedClientRuntime({
      endpoint, keyStore: keys, sessionStore: sessions,
      fetchImpl: async (input, init) => {
        const adapter = await supervisor.connect(3, init?.signal ?? undefined);
        return adapter.fetch(String(input), init as RequestInit);
      },
      onStateChange: (next) => {
        latest = next;
        if (activeServerRef.current === id && runtimes.current.get(id)?.runtime === runtime) dispatchAuth(authSnapshot(next, runtimeRef.current));
      },
    });
    const entry = { runtime, supervisor, keyStore: keys, get state() { return latest; } };
    runtimes.current.set(id, entry);
    registerAuthenticatedFetch(id, (path, init) => entry.runtime.fetch(path, init));
    return entry;
  }, [buildSupervisor]);

  useEffect(() => {
    let cancelled = false;
    if (pairingRef.current) return;

    void (async () => {
      // Which way the attempt ended; applied in `finally` so every path —
      // including a throw nobody anticipated — leaves the spinner.
      let outcome: RestoreEvent = { type: 'settled' };
      try {
        if (!prefs.getBoolean('auth.multi-server-reset')) {
          await clearLegacyCredentials();
          prefs.setBoolean('auth.multi-server-reset', true);
        }
        if (!sessionStore || !keyStore || !serverId) { dispatchAuth(authSnapshot({ status: 'unpaired' }, runtimeRef.current)); return; }
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
          dispatchAuth(authSnapshot({ status: 'unpaired' }, runtimeRef.current));
          return;
        }

        const entry = getRuntime(session.serverId, session.endpoint, session.endpoints);
        const runtime = entry.runtime;
        runtimeRef.current = runtime;
        supervisorRef.current = entry.supervisor;
        setBackgroundActiveServer(serverId);

        try {
          let next = entry.state.status === 'authenticated' ? entry.state : await runtime.initialize();
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
            dispatchAuth(authSnapshot(next, runtimeRef.current));
            setKeyBacking(entry.keyStore.backing);
          }
        } catch (err) {
          if (cancelled) return;
          // The device key (or the session, re-read inside the runtime) sits
          // in the same protected storage and fails the same way when locked.
          if (isStorageUnavailableError(err)) {
            runtimes.current.delete(serverId);
            registerAuthenticatedFetch(serverId, null);
            await entry.supervisor.disconnect();
            outcome = { type: 'storage-unavailable' };
            return;
          }
          if (err instanceof HostIdentityMismatchError) {
            // Surfaced as a blocking screen: this is a security event, not a
            // transient network error, and it must not be retried silently.
            dispatchAuth(authSnapshot({ status: 'error', message: err.message }, runtimeRef.current));
            return;
          }
          dispatchAuth(authSnapshot({ status: 'error', message: err instanceof Error ? err.message : String(err) }, runtimeRef.current));
        }
      } catch (error) {
        if (!cancelled) {
          if (isStorageUnavailableError(error)) outcome = { type: 'storage-unavailable' };
          else dispatchAuth(authSnapshot({ status: 'error', message: error instanceof Error ? error.message : String(error) }, runtimeRef.current));
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
  }, [getRuntime, keyStore, sessionStore, serverId, dispatchRestore, restoreAttempt]);

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

  const switchServer = useCallback(async (id: string) => {
    if (pairingRef.current) throw new Error('Finish pairing before switching servers');
    serverRegistry.select(id);
    resetStepUp();
    activeServerRef.current = id;
    setBackgroundActiveServer(id);
    runtimeRef.current = null;
    supervisorRef.current = null;
    dispatchAuth(authSnapshot({ status: 'unpaired' }, runtimeRef.current));
    setTransport({ state: 'idle' });
    dispatchRestore({ type: 'server-switch' });
    setServerId(id);
    setRestoreAttempt((n) => n + 1);
    const server = serverRegistry.read().connections.find((item) => item.serverId === id)!;
    const entry = getRuntime(id, server.endpoint, server.endpoints);
    await entry.runtime.initialize();
  }, [dispatchRestore, getRuntime]);

  const completePairing = useCallback(async (consent: PairingConsent, deviceName: string) => {
    const previousId = activeServerRef.current;
    pairingRef.current = true;
    activeServerRef.current = consent.serverId;
    setServerId(consent.serverId);
    const endpoints = consent.endpoints.map((endpoint) => endpoint.origin);
    const entry = getRuntime(consent.serverId, consent.endpoint, endpoints);
    runtimeRef.current = entry.runtime;
    supervisorRef.current = entry.supervisor;
    dispatchAuth(authSnapshot({ status: 'pairing' }, runtimeRef.current));
    try {
      await entry.runtime.completePairing({ pairingToken: consent.pairingGrant, deviceName, platform: 'mobile', serverId: consent.serverId, endpoint: consent.endpoint, endpoints });
      serverRegistry.add({ serverId: consent.serverId, label: consent.serverName, endpoint: consent.endpoint, endpoints, kind: 'remote', managed: false, lastConnectedAt: Date.now() });
      setServers(serverRegistry.read().connections);
      setBackgroundActiveServer(consent.serverId);
      resetStepUp();
      setKeyBacking(entry.keyStore.backing);
    } catch (error) {
      activeServerRef.current = previousId;
      setServerId(previousId);
      const previous = previousId ? runtimes.current.get(previousId) : undefined;
      runtimeRef.current = previous?.runtime ?? null;
      supervisorRef.current = previous?.supervisor ?? null;
      dispatchAuth(authSnapshot(previous?.state ?? { status: 'unpaired' }, runtimeRef.current));
      setBackgroundActiveServer(previousId);
      throw error;
    } finally {
      pairingRef.current = false;
      dispatchRestore({ type: 'settled' });
    }
  }, [getRuntime, dispatchRestore]);

  const unpair = useCallback(async (selectedId?: string) => {
    if (pairingRef.current) throw new Error('Finish pairing before removing a server');
    const id = selectedId ?? activeServerRef.current;
    if (!id) return;
    const entry = runtimes.current.get(id);
    await entry?.runtime.forget();
    await entry?.supervisor.disconnect();
    await (entry?.keyStore ?? new MobileDeviceKeyStore(id)).clear();
    await new MobileSessionStore(id).clear();
    await clearServerQueryCache(id);
    prefs.deletePrefix(`srv.${id}.`);
    liveStore.dispatch({ type: 'forgetServer', serverId: id });
    registerAuthenticatedFetch(id, null);
    runtimes.current.delete(id);
    serverRegistry.remove(id);
    const catalog = serverRegistry.read();
    setServers(catalog.connections);
    if (id !== activeServerRef.current) return;
    if (catalog.activeServerId) dispatchRestore({ type: 'server-switch' });
    resetStepUp();
    runtimeRef.current = null;
    supervisorRef.current = null;
    activeServerRef.current = catalog.activeServerId;
    setBackgroundActiveServer(catalog.activeServerId);
    dispatchAuth(authSnapshot({ status: 'unpaired' }, runtimeRef.current));
    setTransport({ state: 'idle' });
    setServerId(catalog.activeServerId);
  }, [dispatchRestore]);

  const probePairedServer = useCallback((id: string) => {
    const server = serverRegistry.read().connections.find((item) => item.serverId === id);
    if (!server) return Promise.reject(new Error('Server is not paired'));
    return probeServer(server.endpoint, { expectedServerId: id, timeoutMs: 4000 });
  }, []);

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
    if (runtime) dispatchAuth(authSnapshot(await runtime.retryInitialize(), runtimeRef.current));
  }, []);

  const refreshPermissions = useCallback(async () => {
    const next = await runtimeRef.current?.refreshSession();
    if (next) dispatchAuth(authSnapshot(next, runtimeRef.current));
  }, []);

  // These operations read the current runtime through a ref. Keep their
  // identities stable across transport/credential status updates: consumers
  // such as TerminalView must not tear down a live socket on every update.
  const authenticatedFetch = useCallback<AuthContextValue['fetch']>((path, init) => {
    const runtime = serverId ? runtimes.current.get(serverId)?.runtime : undefined;
    if (!runtime) throw new Error('Not paired');
    assertServerWriteAllowed(path, init?.method);
    return runtime.fetch(path, init);
  }, [serverId]);
  const streamUrl = useCallback<AuthContextValue['streamUrl']>((scope, id) => {
    const runtime = serverId ? runtimes.current.get(serverId)?.runtime : undefined;
    if (!runtime) throw new Error('Not paired');
    return runtime.buildStreamUrl(scope, id);
  }, [serverId]);
  const socketUrl = useCallback<AuthContextValue['socketUrl']>((path, scope, id) => {
    const runtime = serverId ? runtimes.current.get(serverId)?.runtime : undefined;
    if (!runtime) throw new Error('Not paired');
    return runtime.buildSocketUrl(path, scope, id);
  }, [serverId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      serverId,
      servers,
      switchServer,
      probeServer: probePairedServer,
      initializing,
      storageLocked,
      retryRestore,
      transport,
      keyBacking,
      fetch: authenticatedFetch,
      endpoint,
      streamUrl,
      socketUrl,
      completePairing,
      unpair,
      reconnect,
      refreshPermissions,
    }),
    [
      state,
      endpoint,
      serverId,
      servers,
      switchServer,
      probePairedServer,
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

  useEffect(() => {
    for (const server of servers) {
      registerAuthenticatedFetch(server.serverId, async (path, init) => {
        const entry = getRuntime(server.serverId, server.endpoint, server.endpoints);
        if (entry.state.status !== 'authenticated') await entry.runtime.initialize();
        return entry.runtime.fetch(path, init);
      });
    }
  }, [servers, getRuntime]);

  useEffect(() => {
    const entries = runtimes.current;
    return () => {
      for (const [id, entry] of entries) {
        registerAuthenticatedFetch(id, null);
        void entry.supervisor.disconnect();
      }
      entries.clear();
      clearAuthenticatedFetches();
    };
  }, []);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
