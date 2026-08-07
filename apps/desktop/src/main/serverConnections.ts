// ────────────────────────────────────────────────────────────────
// Server connections — which backend this shell talks to.
// ────────────────────────────────────────────────────────────────
//
// The shell can either run its own server (the default: a child process on
// loopback) or attach to one running on another machine. The list of known
// servers has to live HERE, in the main process, and not in the renderer:
// `localStorage` is per-origin, so a window that loads server A and then
// server B gets two unrelated storages, and neither could hold the list that
// lets you get from one to the other.
//
// Everything in this module is pure so it can be tested without Electron; the
// only I/O is the settings file the caller passes state in and out of.

export type ServerMode = 'embedded' | 'remote';

export interface RemoteServerConnection {
  id: string;
  label: string;
  /** Canonical origin, e.g. `https://studio.example:3100`. No path. */
  url: string;
  /** Host fingerprint, recorded after the first successful connection. */
  serverId?: string;
  lastConnectedAt?: number;
}

export interface ServerConnectionState {
  serverMode: ServerMode;
  connections: RemoteServerConnection[];
  activeConnectionId: string | null;
}

export const DEFAULT_CONNECTION_STATE: ServerConnectionState = {
  serverMode: 'embedded',
  connections: [],
  activeConnectionId: null,
};

/**
 * Canonicalises a user-typed address, or returns null when it is not a usable
 * server origin.
 *
 * A bare `host:port` is accepted and assumed `http://`, because that is what
 * people copy off the Network access card. Paths, credentials and query
 * strings are rejected rather than trimmed: silently loading a different URL
 * than the one typed is how you end up pairing with the wrong thing.
 */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (!url.hostname) return null;
  return url.origin;
}

/** Human-friendly default label: the hostname. */
export function defaultLabelFor(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

/**
 * Repairs whatever was on disk into something usable.
 *
 * Fails toward `embedded`: a corrupt or partially-written settings file must
 * never leave the shell pointing at a server the user cannot see or change.
 */
export function sanitizeConnectionState(raw: unknown): ServerConnectionState {
  const source = (raw ?? {}) as Partial<ServerConnectionState>;

  const connections: RemoteServerConnection[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(source.connections) ? source.connections : []) {
    if (!entry || typeof entry !== 'object') continue;
    const url = typeof entry.url === 'string' ? normalizeServerUrl(entry.url) : null;
    const id = typeof entry.id === 'string' && entry.id ? entry.id : null;
    if (!url || !id || seen.has(id)) continue;
    seen.add(id);
    connections.push({
      id,
      url,
      label: typeof entry.label === 'string' && entry.label ? entry.label : defaultLabelFor(url),
      ...(typeof entry.serverId === 'string' ? { serverId: entry.serverId } : {}),
      ...(typeof entry.lastConnectedAt === 'number' ? { lastConnectedAt: entry.lastConnectedAt } : {}),
    });
  }

  const activeConnectionId =
    typeof source.activeConnectionId === 'string' &&
    connections.some((c) => c.id === source.activeConnectionId)
      ? source.activeConnectionId
      : null;

  // Remote mode without a reachable selection is meaningless, and would leave
  // the window with nothing to load.
  const serverMode: ServerMode =
    source.serverMode === 'remote' && activeConnectionId ? 'remote' : 'embedded';

  return { serverMode, connections, activeConnectionId };
}

export function addConnection(
  state: ServerConnectionState,
  input: { url: string; label?: string; id?: string },
): { state: ServerConnectionState; connection: RemoteServerConnection } {
  const url = normalizeServerUrl(input.url);
  if (!url) throw new Error(`Not a valid server address: ${input.url}`);

  // Same origin means the same server, so re-adding updates the label rather
  // than producing two entries that switch to an identical place.
  const existing = state.connections.find((c) => c.url === url);
  if (existing) {
    const updated = { ...existing, ...(input.label ? { label: input.label } : {}) };
    return {
      state: {
        ...state,
        connections: state.connections.map((c) => (c.id === existing.id ? updated : c)),
      },
      connection: updated,
    };
  }

  const connection: RemoteServerConnection = {
    id: input.id ?? `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    url,
    label: input.label?.trim() || defaultLabelFor(url),
  };
  return {
    state: { ...state, connections: [...state.connections, connection] },
    connection,
  };
}

export function removeConnection(
  state: ServerConnectionState,
  id: string,
): ServerConnectionState {
  const connections = state.connections.filter((c) => c.id !== id);
  if (state.activeConnectionId !== id) return { ...state, connections };
  // Dropping the active server sends the shell home rather than nowhere.
  return { serverMode: 'embedded', connections, activeConnectionId: null };
}

/** Selects a remote server. Unknown ids are ignored so callers cannot strand the window. */
export function activateConnection(
  state: ServerConnectionState,
  id: string,
): ServerConnectionState {
  if (!state.connections.some((c) => c.id === id)) return state;
  return { ...state, serverMode: 'remote', activeConnectionId: id };
}

export function activateEmbedded(state: ServerConnectionState): ServerConnectionState {
  return { ...state, serverMode: 'embedded' };
}

export function activeConnection(state: ServerConnectionState): RemoteServerConnection | null {
  if (state.serverMode !== 'remote' || !state.activeConnectionId) return null;
  return state.connections.find((c) => c.id === state.activeConnectionId) ?? null;
}

export interface ResolvedTarget {
  url: string;
  mode: ServerMode;
  /** True when the embedded server must be running for this target to work. */
  needsEmbeddedServer: boolean;
}

/**
 * Decides what the window should load.
 *
 * `embeddedUrl` is null until the child server is up, which is why this can
 * report a remote target before there is any local server at all — the point
 * of remote mode is that starting one is unnecessary.
 */
export function resolveTarget(
  state: ServerConnectionState,
  embeddedUrl: string | null,
): ResolvedTarget | null {
  const remote = activeConnection(state);
  if (remote) return { url: remote.url, mode: 'remote', needsEmbeddedServer: false };
  if (embeddedUrl) return { url: embeddedUrl, mode: 'embedded', needsEmbeddedServer: true };
  return null;
}
