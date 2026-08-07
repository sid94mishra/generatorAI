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
