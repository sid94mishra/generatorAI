// ────────────────────────────────────────────────────────────────
// Connection catalog — the set of servers this client knows about.
// ────────────────────────────────────────────────────────────────
//
// A client used to hold exactly one device key and one session, which made
// "connect to a different server" indistinguishable from "re-pair with this
// one". Every credential is per-server, so the catalog is what lets a device
// hold several at once and move between them without re-pairing.
//
// ── Why a connection is identified by serverId, not by URL ──────
//
// The server's X25519 host fingerprint is its durable identity; a URL is only
// one route to it. A laptop that moves from `192.168.0.107` to a new DHCP
// lease, or is reached over loopback at home and over LAN from the sofa, is
// the SAME server and must keep the same credential. Keying on URL would mint
// a second identity per address, forcing a re-pair after every network change
// and quietly filling the device list with duplicates of one machine.
//
// It also keeps the security story coherent: host pinning already treats
// serverId as the thing that must not change. Using it as the primary key
// means "which credential do I present?" and "am I talking to who I think?"
// are answered by the same value, so they cannot disagree.

// Type-only (erased): this file must stay free of runtime imports, see the probe section.
import type { ServerReachability } from '@generatorai/shared';

const CATALOG_KEY = 'generatorai.connections';

/** Storage key holding the pre-catalog single session, migrated on first read. */
const LEGACY_SESSION_KEY = 'generatorai.auth.session';

export interface ServerConnection {
  /** The server's host identity fingerprint. Stable across address changes. */
  serverId: string;
  /** Human label; defaults to the server's advertised name. */
  label: string;
  /** Origin last known to work. Tried first on reconnect. */
  endpoint: string;
  /** All known routes to this server, best first. */
  endpoints: string[];
  /**
   * `local` means this server runs on the same machine as the client. Only the
   * host shell can assert that, so it is never inferred from a loopback URL —
   * a remote server tunnelled to localhost would look identical.
   */
  kind: 'local' | 'remote';
  /**
   * True when the entry is supplied by the host shell (the desktop app's own
   * embedded server) rather than saved by the user. Managed entries cannot be
   * edited or removed from the UI because the shell would just recreate them.
   */
  managed: boolean;
  lastConnectedAt: number | null;
}

export interface ConnectionCatalog {
  connections: ServerConnection[];
  /** `serverId` of the active connection, or null before the first pairing. */
  activeServerId: string | null;
}

const EMPTY: ConnectionCatalog = { connections: [], activeServerId: null };

/**
 * Storage keys for a connection's credentials.
 *
 * Deliberately derived rather than stored: a mismatch between the catalog and
 * the credential location would strand a session that is still perfectly
 * valid, and there is no way to repair it without asking the user to pair
 * again. One function, both call sites.
 */
export function sessionStorageKey(serverId: string): string {
  return `${LEGACY_SESSION_KEY}.${serverId}`;
}

export function deviceKeyId(serverId: string): string {
  return `device-key:${serverId}`;
}

function isConnection(value: unknown): value is ServerConnection {
  const c = value as Partial<ServerConnection> | null;
  return (
    typeof c?.serverId === 'string' &&
    c.serverId.length > 0 &&
    typeof c.endpoint === 'string' &&
    Array.isArray(c.endpoints)
  );
}

export function loadCatalog(storage: Storage): ConnectionCatalog {
  let catalog = EMPTY;
  try {
    const raw = storage.getItem(CATALOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ConnectionCatalog>;
      const connections = (parsed.connections ?? []).filter(isConnection);
      catalog = {
        connections,
        // Never point at a connection that is not in the list; a dangling
        // pointer would leave the app authenticated against nothing.
        activeServerId: connections.some((c) => c.serverId === parsed.activeServerId)
          ? (parsed.activeServerId as string)
          : (connections[0]?.serverId ?? null),
      };
    }
  } catch {
    catalog = EMPTY;
  }

  const migrated = migrateLegacySession(storage, catalog);
  if (migrated !== catalog) saveCatalog(storage, migrated);
  return migrated;
}

export function saveCatalog(storage: Storage, catalog: ConnectionCatalog): void {
  try {
    storage.setItem(CATALOG_KEY, JSON.stringify(catalog));
  } catch {
    // Private browsing: the session still works for this tab, it just will not
    // be remembered. Failing loudly here would block an otherwise usable app.
  }
}

/**
 * Adopts a pre-catalog session as the first catalog entry.
 *
 * Without this every already-paired client is silently logged out by the
 * upgrade, which looks exactly like a revocation and cannot be undone from the
 * UI — the pairing screen it lands on needs a code it can no longer mint.
 */
function migrateLegacySession(storage: Storage, catalog: ConnectionCatalog): ConnectionCatalog {
  if (catalog.connections.length > 0) return catalog;

  interface LegacySession {
    serverId?: string;
    endpoint?: string;
    endpoints?: string[];
  }

  let legacy: LegacySession | null = null;
  try {
    const raw = storage.getItem(LEGACY_SESSION_KEY);
    legacy = raw ? (JSON.parse(raw) as LegacySession) : null;
  } catch {
    return catalog;
  }
  if (!legacy?.serverId || !legacy.endpoint) return catalog;

  try {
    // Copy rather than move: the old key stays until the migrated session has
    // been proven usable, so a failed upgrade is recoverable by rolling back.
    const raw = storage.getItem(LEGACY_SESSION_KEY);
    if (raw) storage.setItem(sessionStorageKey(legacy.serverId), raw);
  } catch {
    return catalog;
  }

  return {
    connections: [
      {
        serverId: legacy.serverId,
        label: hostLabel(legacy.endpoint),
        endpoint: legacy.endpoint,
        endpoints: legacy.endpoints ?? [legacy.endpoint],
        kind: 'remote',
        managed: false,
        lastConnectedAt: Date.now(),
      },
    ],
    activeServerId: legacy.serverId,
  };
}

/** `https://192.168.0.107:5173` → `192.168.0.107`. Falls back to the input. */
export function hostLabel(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function activeConnection(catalog: ConnectionCatalog): ServerConnection | null {
  return catalog.connections.find((c) => c.serverId === catalog.activeServerId) ?? null;
}

/**
 * Inserts or updates a connection and makes it active.
 *
 * Merging by `serverId` is what makes re-pairing the same host over a new
 * address widen its route list instead of creating a duplicate entry.
 */
export function upsertConnection(
  catalog: ConnectionCatalog,
  connection: ServerConnection,
): ConnectionCatalog {
  const existing = catalog.connections.find((c) => c.serverId === connection.serverId);
  const merged: ServerConnection = existing
    ? {
        ...existing,
        ...connection,
        endpoints: [...new Set([connection.endpoint, ...connection.endpoints, ...existing.endpoints])],
      }
    : { ...connection, endpoints: [...new Set([connection.endpoint, ...connection.endpoints])] };

  return {
    connections: [
      merged,
      ...catalog.connections.filter((c) => c.serverId !== connection.serverId),
    ],
    activeServerId: connection.serverId,
  };
}

export function removeConnection(
  catalog: ConnectionCatalog,
  serverId: string,
): ConnectionCatalog {
  const connections = catalog.connections.filter((c) => c.serverId !== serverId);
  return {
    connections,
    activeServerId:
      catalog.activeServerId === serverId
        ? (connections[0]?.serverId ?? null)
        : catalog.activeServerId,
  };
}

/** Forgets a connection's credentials. Call alongside {@link removeConnection}. */
export function clearConnectionCredentials(storage: Storage, serverId: string): void {
  try {
    storage.removeItem(sessionStorageKey(serverId));
  } catch {
    // Nothing to clear.
  }
}

// ────────────────────────────────────────────────────────────────
// Reachability probe (G-03, 05-gap-matrix.md §G-03).
// ────────────────────────────────────────────────────────────────
//
// `GET /api/auth/server-info` is deliberately public (see `auth.ts`'s own
// comment): a device that has not paired yet still needs to identify the
// server it is about to pair with. That makes it the right endpoint for a
// reachability probe too.
//
// Where it may run: anywhere a cross-origin request is allowed. The desktop
// main process probes every known server with Node's `fetch`
// (`apps/desktop/src/main/server-probe.ts`, imported through the
// dependency-free `@generatorai/client-runtime/connections` subpath). A page
// may only probe its OWN origin: the app's CSP is `connect-src 'self'` and the
// server sends no CORS headers for other origins, so a renderer probing
// another server gets a CSP violation and a false "offline"
// (P1-review P2-R6). Keep this file free of runtime imports so the desktop
// bundle can take it without pulling the package root in (06 §3.2).

export interface ServerProbeResult {
  /** See {@link ServerReachability}. */
  status: ServerReachability;
  serverName?: string;
  latencyMs?: number;
}

export interface ProbeServerOptions {
  timeoutMs?: number;
  /**
   * The `serverId` this client expects at `endpoint`, when it knows one (a
   * paired connection's host fingerprint). A different server answering at
   * that address is reported as `unpaired`: the credential held for this
   * entry is not for it.
   */
  expectedServerId?: string;
  /**
   * Injectable `fetch` (P2-R40). Defaults to the global `fetch`, which in the
   * desktop main process is Node's `fetch` (undici) — it ignores the system
   * proxy and Chromium's certificate policy, so its verdict can disagree with
   * what the renderer's window would actually be able to load. Main passes
   * Electron's `net.fetch` instead (`apps/desktop/src/main/server-probe.ts`),
   * which uses Chrome's network stack and shares its proxy/cert behavior.
   */
  fetch?: typeof fetch;
}

const DEFAULT_PROBE_TIMEOUT_MS = 2500;

/**
 * Probes one server origin for reachability and identity. Never throws.
 *
 * Reachability mapping (D-54; also documented in
 * docs/redesign/01-decisions.md):
 *  - `connected` — a matching `serverId` (or none expected).
 *  - `unpaired` — a 4xx other than 429, a fully-received body with no
 *    `serverId` (including one that is not valid JSON — the body still
 *    finished downloading, it just isn't this API), a different `serverId`
 *    than expected, OR a 3xx (see below). None of these confirm the
 *    credential this connection holds is for the server that actually
 *    answered.
 *  - `error` — 429/5xx (server is there, answer not confirmed), OR the
 *    status line arrived but the body read was cut short by the timeout/abort
 *    (P2-R40): the server IS reachable, just unconfirmed — distinct from
 *    `offline` (no answer at all) and from `unpaired` (a confirmed mismatch).
 *  - `offline` — no answer: a network error, or the timeout/abort fired
 *    before any response (not even a status line) arrived.
 *
 * `redirect: 'manual'` (P2-R40): a stored server's URL is data this client
 * does not otherwise trust, so a 3xx must not be silently followed — that
 * would let a stored server bounce the request to a different origin and
 * have ITS `serverName`/`serverId` reach the caller as if they belonged to
 * the original endpoint. With redirects not followed, a 3xx response never
 * carries a matching `serverId` and falls through to `unpaired` below, same
 * as any other unconfirmed answer — it never reaches the redirect target at
 * all.
 */
export async function probeServer(
  endpoint: string,
  options: ProbeServerOptions = {},
): Promise<ServerProbeResult> {
  const doFetch = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    let response: Response;
    try {
      response = await doFetch(`${endpoint}/api/auth/server-info`, {
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch {
      // No response at all — network error, or the timeout fired before a
      // status line arrived. Treated the same as "no answer".
      return { status: 'offline' };
    }
    const latencyMs = Date.now() - startedAt;
    // Throttled or failing: something is there, but this probe could not
    // confirm what. Not `unpaired`, which would tell the user to pair again.
    if (response.status === 429 || response.status >= 500) return { status: 'error', latencyMs };
    if (!response.ok) return { status: 'unpaired', latencyMs };
    let body: { serverId?: unknown; serverName?: unknown } | null;
    try {
      body = (await response.json()) as { serverId?: unknown; serverName?: unknown } | null;
    } catch {
      // Two different failures land here and must not be confused:
      //  - The timeout/abort fired while the body was still streaming in.
      //    The status line (and thus `response.status`/`.ok` above) DID
      //    arrive, so the server is genuinely reachable — just unconfirmed.
      //    That is `error`, not `offline` (no answer) or `unpaired` (a
      //    confirmed non-matching answer).
      //  - The body finished downloading but was not valid JSON. The server
      //    fully answered with something that is not this API — a confirmed
      //    non-match, i.e. `unpaired`, same as a body with no `serverId`.
      // `controller.signal.aborted` distinguishes them: this function owns
      // the controller and only ever aborts it via the timeout above.
      if (controller.signal.aborted) return { status: 'error', latencyMs };
      return { status: 'unpaired', latencyMs };
    }
    if (!body || typeof body.serverId !== 'string' || !body.serverId) {
      return { status: 'unpaired', latencyMs };
    }
    const serverName = typeof body.serverName === 'string' ? { serverName: body.serverName } : {};
    if (options.expectedServerId && body.serverId !== options.expectedServerId) {
      return { status: 'unpaired', latencyMs, ...serverName };
    }
    return { status: 'connected', latencyMs, ...serverName };
  } finally {
    clearTimeout(timer);
  }
}
