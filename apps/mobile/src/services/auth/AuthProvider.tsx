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
import { ENDPOINT_PROBE_TIMEOUT_MS, orderEndpoints, rememberEndpoint, rememberedEndpoint } from '../transport/endpointMemory';
import { endpointSecurity, InsecureEndpointError, usableEndpoints, type ConnectionProblem, type TrustRecord } from '../transport/trust';
import { applyTrust, deleteTrust, explainConnectionFailure, installTrust, loadTrust, saveTrust } from './serverTrust';
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
  /**
   * Why the active server cannot be used, when the app can say more than "can't reach" (MD-202): its certificate is
   * not the one paired with, it was paired over plain HTTP, or Local Network access is off. Null otherwise.
   */
  connectionProblem: ConnectionProblem | null;
  /** `trust`: the CA fingerprints the server's LAN addresses are anchored to (from the QR or the confirmed certificate). */
  completePairing(consent: PairingConsent, deviceName: string, trust: TrustRecord): Promise<void>;
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
  if (endpointSecurity(endpoint) === 'plain') throw new InsecureEndpointError(endpoint);
  const res = await fetch(`${endpoint}/api/auth/server-info`, {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`server-info returned ${res.status}`);
  const body = (await res.json()) as { serverId?: string };
  if (!body.serverId) throw new Error('server-info did not include a serverId');
  return body.serverId;
}

/** The server answered with another identity key: the supervisor stopped on it, or the runtime's own probe did. */
function hostMismatched(supervisor: EndpointSupervisor | null, state: AuthState): boolean {
  return supervisor?.currentStatus.state === 'host-mismatch' || (state.status === 'error' && /identity at this address changed/i.test(state.message));
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
  const [connectionProblem, setConnectionProblem] = useState<ConnectionProblem | null>(null);
  // Per server: resolves once its trust anchors are installed natively. Every request waits for it (MV-44).
  const trustReady = useRef(new Map<string, Promise<TrustRecord | null>>());

  const keyStore = useMemo(() => serverId ? new MobileDeviceKeyStore(serverId) : null, [serverId]);
  const sessionStore = useMemo(() => serverId ? new MobileSessionStore(serverId, () => rememberedEndpoint(prefs, serverId)) : null, [serverId]);
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
      // The address that answered last goes first; the rest keep the offer's order (MD-203).
      const [first = pairedEndpoint, ...rest] = orderEndpoints([pairedEndpoint, ...(endpoints ?? [])], rememberedEndpoint(prefs, pinnedServerId));
      const supervisor = new EndpointSupervisor({
        pinnedServerId,
        candidates: buildEndpointCandidates({
          pairedEndpoint: first,
          discoveredEndpoints: rest,
          localOnly: prefs.getBoolean(PREF_KEYS.localOnly),
        }),
        verifyHost: verifyHostIdentity,
        onStatusChange: (next) => {
          if (next.state === 'connected') rememberEndpoint(prefs, pinnedServerId, next.endpoint);
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
    const sessions = new MobileSessionStore(id, () => rememberedEndpoint(prefs, id));
    const supervisor = buildSupervisor(endpoint, id, endpoints);
    let latest: AuthState = { status: 'unpaired' };
    if (!trustReady.current.has(id)) trustReady.current.set(id, installTrust(id, [endpoint, ...(endpoints ?? [])]).catch(() => null));
    const runtime = new AuthenticatedClientRuntime({
      endpoint, keyStore: keys, sessionStore: sessions,
      identityProbeTimeoutMs: ENDPOINT_PROBE_TIMEOUT_MS,
      fetchImpl: async (input, init) => {
        await trustReady.current.get(id);
        // The plain-HTTP LAN lane is gone (MD-201): an absolute http:// URL to another device is never requested.
        const url = String(input);
        if (/^http:\/\//i.test(url) && endpointSecurity(url) === 'plain') throw new InsecureEndpointError(new URL(url).origin);
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

        const sessionEndpoints = [session.endpoint, ...(session.endpoints ?? [])];
        if (usableEndpoints(sessionEndpoints).length === 0) {
          // Paired over the removed plain-HTTP lane (D-112): nothing to try, the person has to pair again (MD-201).
          setConnectionProblem('insecure-endpoint');
          dispatchAuth(authSnapshot({ status: 'error', message: new InsecureEndpointError(session.endpoint).message }, runtimeRef.current));
          return;
        }
        const entry = getRuntime(session.serverId, session.endpoint, session.endpoints);
        const runtime = entry.runtime;
        runtimeRef.current = runtime;
        supervisorRef.current = entry.supervisor;
        setBackgroundActiveServer(serverId);
        const startedAt = Date.now();
        setConnectionProblem(null);

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
          if (!cancelled && next.status === 'error') {
            const problem = await explainConnectionFailure(sessionEndpoints, await trustReady.current.get(session.serverId) ?? null, startedAt, hostMismatched(entry.supervisor, next));
            if (!cancelled) setConnectionProblem(problem);
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
    setConnectionProblem(null);
    dispatchRestore({ type: 'server-switch' });
    setServerId(id);
    setRestoreAttempt((n) => n + 1);
    const server = serverRegistry.read().connections.find((item) => item.serverId === id)!;
    const entry = getRuntime(id, server.endpoint, server.endpoints);
    await entry.runtime.initialize();
  }, [dispatchRestore, getRuntime]);

  const completePairing = useCallback(async (consent: PairingConsent, deviceName: string, trust: TrustRecord) => {
    const endpoints = usableEndpoints(consent.endpoints.map((endpoint) => endpoint.origin));
    if (!endpoints.length) throw new InsecureEndpointError(consent.endpoint);
    const primary = endpoints[0]!;
    const previousId = activeServerRef.current;
    pairingRef.current = true;
    activeServerRef.current = consent.serverId;
    setServerId(consent.serverId);
    setConnectionProblem(null);
    // The record is stored before any request so the anchors every request waits for are the new ones; a failed
    // pairing puts back what this server had (a re-pair of a paired server) or nothing.
    const previousTrust = await loadTrust(consent.serverId).catch(() => null);
    const previousEndpoints = serverRegistry.read().connections.find((item) => item.serverId === consent.serverId)?.endpoints ?? [];
    const installed = saveTrust(consent.serverId, trust).then(() => {
      applyTrust(consent.serverId, trust, endpoints);
      return trust;
    });
    trustReady.current.set(consent.serverId, installed);
    // A fresh runtime for a re-pair: the old one has the old offer's candidates and its chosen route cached.
    const stale = runtimes.current.get(consent.serverId);
    if (stale) runtimes.current.delete(consent.serverId);
    const entry = getRuntime(consent.serverId, primary, endpoints);
    runtimeRef.current = entry.runtime;
    supervisorRef.current = entry.supervisor;
    dispatchAuth(authSnapshot({ status: 'pairing' }, runtimeRef.current));
    try {
      await installed;
      // Find the first address that answers (the offer lists ts.net first, which a phone without Tailscale cannot reach)
      // and pair through it; the rest stay as fallbacks in the offer's order (MD-203).
      const working = await entry.supervisor.connect(1).then((adapter) => adapter.endpoint, () => null);
      const ordered = orderEndpoints(endpoints, working);
      const selected = ordered[0] ?? primary;
      await entry.runtime.completePairing({ pairingToken: consent.pairingGrant, deviceName, platform: 'mobile', serverId: consent.serverId, endpoint: selected, endpoints: ordered });
      serverRegistry.add({ serverId: consent.serverId, label: consent.serverName, endpoint: selected, endpoints: ordered, kind: 'remote', managed: false, lastConnectedAt: Date.now() });
      setServers(serverRegistry.read().connections);
      setBackgroundActiveServer(consent.serverId);
      if (stale) void stale.supervisor.disconnect();
      resetStepUp();
      setKeyBacking(entry.keyStore.backing);
    } catch (error) {
      const restored = (async () => {
        if (previousTrust) {
          await saveTrust(consent.serverId, previousTrust);
          applyTrust(consent.serverId, previousTrust, previousEndpoints);
        } else {
          await deleteTrust(consent.serverId);
        }
        return previousTrust;
      })().catch(() => null);
      trustReady.current.set(consent.serverId, restored);
      void entry.supervisor.disconnect();
      if (stale) {
        runtimes.current.set(consent.serverId, stale);
        registerAuthenticatedFetch(consent.serverId, (path, init) => stale.runtime.fetch(path, init));
      } else {
        runtimes.current.delete(consent.serverId);
        registerAuthenticatedFetch(consent.serverId, null);
      }
      const problem = await explainConnectionFailure(endpoints, trust, 0).catch(() => null);
      activeServerRef.current = previousId;
      setServerId(previousId);
      const previous = previousId ? runtimes.current.get(previousId) : undefined;
      runtimeRef.current = previous?.runtime ?? null;
      supervisorRef.current = previous?.supervisor ?? null;
      dispatchAuth(authSnapshot(previous?.state ?? { status: 'unpaired' }, runtimeRef.current));
      setBackgroundActiveServer(previousId);
      // A refused certificate or a denied Local Network is named, not reported as "can't reach" (MD-202).
      if (problem === 'identity-changed' || problem === 'local-network-denied') throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { problem });
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
    await deleteTrust(id);
    trustReady.current.delete(id);
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
    if (endpointSecurity(server.endpoint) === 'plain') return Promise.reject(new InsecureEndpointError(server.endpoint));
    return probeServer(server.endpoint, { expectedServerId: id, timeoutMs: 4000 });
  }, []);

  const reconnect = useCallback(async () => {
    if (connectionProblem === 'insecure-endpoint') return;
    const startedAt = Date.now();
    await supervisorRef.current?.invalidate('manual reconnect');
    try {
      await supervisorRef.current?.connect(3);
    } catch {
      // Still unreachable: the retry below reports it through the auth state.
    }
    // A launch that failed left auth in `error`; reconnecting the transport
    // alone never leaves that screen, so re-run initialisation too.
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const next = await runtime.retryInitialize();
    const id = activeServerRef.current;
    const server = id ? serverRegistry.read().connections.find((item) => item.serverId === id) : undefined;
    setConnectionProblem(
      next.status === 'error' && id && server
        ? await explainConnectionFailure([server.endpoint, ...(server.endpoints ?? [])], await trustReady.current.get(id) ?? null, startedAt, hostMismatched(supervisorRef.current, next))
        : null,
    );
    dispatchAuth(authSnapshot(next, runtimeRef.current));
  }, [connectionProblem]);

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
      connectionProblem,
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
      connectionProblem,
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
