// ────────────────────────────────────────────────────────────────
// The CLI's view of "which servers do I know about".
//
// `client-runtime/connections.ts` already models this correctly — keyed on
// the server's X25519 host fingerprint rather than a URL, so a laptop that
// changes DHCP lease or is reached over loopback at home and LAN from the
// sofa stays ONE server with ONE credential. The CLI previously keyed its
// credential cache on `endpoint::profile`, which minted a second identity per
// address and forced a re-pair after every network change.
//
// This file supplies the two things that model needs in Node: a file-backed
// `Storage`, and a resolver that tries a connection's known routes in order.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  activeConnection,
  hostLabel,
  loadCatalog,
  saveCatalog,
  upsertConnection,
  type ConnectionCatalog,
  type ServerConnection,
} from '@generatorai/client-runtime';
import { CliError } from '../errors/CliError.js';
import { getConnectionsFilePath } from '../config/paths.js';

export interface ServerConnectionInfo extends ServerConnection {
  /** The route that answered, once one has. */
  resolvedEndpoint: string;
}

/**
 * A `Storage` backed by one JSON file.
 *
 * The web catalog is written against the DOM `Storage` interface. Rather than
 * fork the catalog logic for Node, we supply the four methods it actually
 * calls; forking would mean two implementations of "which server am I talking
 * to", which is precisely the class of duplication this rewrite exists to
 * remove.
 */
export class FileStorage implements Storage {
  private data: Record<string, string> = {};

  constructor(private readonly filePath: string) {
    this.reload();
  }

  private reload(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      this.data = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
    } catch {
      this.data = {};
    }
  }

  private flush(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // 0600: the catalog names the servers this machine can reach and, for
    // relay routes, the tunnel address. Not a secret, but not world-readable.
    fs.writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
  }

  get length(): number {
    return Object.keys(this.data).length;
  }

  key(index: number): string | null {
    return Object.keys(this.data)[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.data[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.data[key] = value;
    this.flush();
  }

  removeItem(key: string): void {
    delete this.data[key];
    this.flush();
  }

  clear(): void {
    this.data = {};
    this.flush();
  }
}

/** The capability-ish fields `/api/auth/server-info` already publishes, previously fetched and discarded. */
export interface ProbeCapabilities {
  authentication?: {
    required?: boolean;
    dpopRequired?: boolean;
    legacyApiKeyAccepted?: boolean;
  };
  transports?: {
    loopback?: boolean;
    lan?: boolean;
    privateNetwork?: boolean;
    relay?: boolean;
  };
}

export interface ProbeResult {
  endpoint: string;
  ok: boolean;
  serverId?: string;
  serverName?: string;
  /**
   * The server's `/api/auth/server-info` protocol version (a small integer
   * the server bumps on breaking wire-shape changes — currently always `2`).
   * Compare against `SUPPORTED_PROTOCOL_VERSIONS` via
   * `checkProtocolCompatibility()`, not directly: a bare `!==` check is
   * exactly the all-or-nothing gate this module replaces.
   */
  protocolVersion?: number;
  capabilities?: ProbeCapabilities;
  latencyMs: number;
  error?: string;
}

/**
 * Server `protocolVersion` values this CLI build understands.
 *
 * `min` — the oldest server this CLI can still usefully talk to. Below it,
 * response shapes this CLI relies on may not exist at all, so this is a hard
 * failure with upgrade guidance, not a degraded-but-working state.
 *
 * `max` — the newest server-info shape this CLI has actually been written
 * against. A server ahead of `max` is running features this CLI build
 * predates — forward-compatible in practice (unknown fields are just
 * ignored), so this is a one-time heads-up, not a failure.
 *
 * Both are `2` today because `2` is the only value this protocol has ever
 * had (`apps/server/src/routes/auth.ts`) — the range exists so a future bump
 * on either side is a data change here, not new branching logic at every
 * call site.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = { min: 2, max: 2 } as const;

export type ProtocolCompatibility =
  /** No version advertised at all — an old server predating this field. Treated as compatible: refusing outright would break every real deployment that exists today. */
  | 'unknown'
  | 'compatible'
  /** Server is older than this CLI build requires. */
  | 'server-too-old'
  /** Server is newer than this CLI build has been tested against. */
  | 'server-ahead';

export function checkProtocolCompatibility(protocolVersion: number | undefined): ProtocolCompatibility {
  if (protocolVersion === undefined) return 'unknown';
  if (protocolVersion < SUPPORTED_PROTOCOL_VERSIONS.min) return 'server-too-old';
  if (protocolVersion > SUPPORTED_PROTOCOL_VERSIONS.max) return 'server-ahead';
  return 'compatible';
}

export class ConnectionManager {
  private catalog: ConnectionCatalog;

  constructor(private readonly storage: Storage = new FileStorage(getConnectionsFilePath())) {
    this.catalog = loadCatalog(this.storage);
  }

  list(): ServerConnection[] {
    return this.catalog.connections;
  }

  active(): ServerConnection | null {
    return activeConnection(this.catalog);
  }

  /** Accepts a serverId, a label, or a URL. */
  find(ref: string): ServerConnection | undefined {
    const needle = ref.toLowerCase();
    return (
      this.catalog.connections.find((c) => c.serverId === ref) ??
      this.catalog.connections.find((c) => c.label.toLowerCase() === needle) ??
      this.catalog.connections.find((c) =>
        c.endpoints.some((e) => e.toLowerCase() === needle.replace(/\/$/, '')),
      ) ??
      this.catalog.connections.find((c) => c.serverId.startsWith(ref))
    );
  }

  require(ref: string): ServerConnection {
    const found = this.find(ref);
    if (!found) {
      throw CliError.notFound('connection', ref, {
        suggestions: ['generatorai connect list', `generatorai connect add ${ref}`],
      });
    }
    return found;
  }

  upsert(connection: ServerConnection): void {
    this.catalog = upsertConnection(this.catalog, connection);
    saveCatalog(this.storage, this.catalog);
  }

  setActive(serverId: string): void {
    if (!this.catalog.connections.some((c) => c.serverId === serverId)) {
      throw CliError.notFound('connection', serverId);
    }
    this.catalog = { ...this.catalog, activeServerId: serverId };
    saveCatalog(this.storage, this.catalog);
  }

  rename(serverId: string, label: string): void {
    this.catalog = {
      ...this.catalog,
      connections: this.catalog.connections.map((c) =>
        c.serverId === serverId ? { ...c, label } : c,
      ),
    };
    saveCatalog(this.storage, this.catalog);
  }

  remove(serverId: string): void {
    const target = this.catalog.connections.find((c) => c.serverId === serverId);
    if (target?.managed) {
      throw new CliError('USAGE', `"${target.label}" is managed by the host application.`, {
        hint: 'Managed connections are recreated automatically and cannot be removed here.',
      });
    }
    const connections = this.catalog.connections.filter((c) => c.serverId !== serverId);
    this.catalog = {
      connections,
      activeServerId:
        this.catalog.activeServerId === serverId
          ? (connections[0]?.serverId ?? null)
          : this.catalog.activeServerId,
    };
    saveCatalog(this.storage, this.catalog);
  }

  addEndpoint(serverId: string, endpoint: string): void {
    const normalised = endpoint.replace(/\/$/, '');
    this.catalog = {
      ...this.catalog,
      connections: this.catalog.connections.map((c) =>
        c.serverId === serverId
          ? { ...c, endpoints: [...new Set([...c.endpoints, normalised])] }
          : c,
      ),
    };
    saveCatalog(this.storage, this.catalog);
  }

  removeEndpoint(serverId: string, endpoint: string): void {
    const normalised = endpoint.replace(/\/$/, '');
    this.catalog = {
      ...this.catalog,
      connections: this.catalog.connections.map((c) =>
        c.serverId === serverId
          ? {
              ...c,
              endpoints: c.endpoints.filter((e) => e !== normalised),
              endpoint: c.endpoint === normalised ? (c.endpoints.find((e) => e !== normalised) ?? c.endpoint) : c.endpoint,
            }
          : c,
      ),
    };
    saveCatalog(this.storage, this.catalog);
  }

  markConnected(serverId: string, endpoint: string): void {
    this.catalog = {
      ...this.catalog,
      connections: this.catalog.connections.map((c) =>
        c.serverId === serverId
          ? { ...c, endpoint, lastConnectedAt: Date.now(), endpoints: [...new Set([endpoint, ...c.endpoints])] }
          : c,
      ),
    };
    saveCatalog(this.storage, this.catalog);
  }
}

/**
 * Asks one endpoint who it is.
 *
 * `/api/auth/server-info` is deliberately unauthenticated — a client has to
 * be able to learn a host's identity before it holds a credential for it, or
 * pairing would be circular.
 */
export async function probeEndpoint(endpoint: string, timeoutMs = 4000): Promise<ProbeResult> {
  const base = endpoint.replace(/\/$/, '');
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/auth/server-info`, { signal: controller.signal });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return { endpoint: base, ok: false, latencyMs, error: `HTTP ${res.status}` };
    }
    // Field names matched against what `apps/server/src/routes/auth.ts`'s
    // `/server-info` handler actually sends. This used to look for `name`
    // and `version` — neither of which that response has ever contained
    // (it sends `serverName` and `protocolVersion`) — so `serverName` and
    // the protocol version were silently always `undefined`, for every real
    // server, since this probe was written.
    const info = (await res.json()) as {
      serverId?: string;
      serverName?: string;
      protocolVersion?: number;
      authentication?: ProbeCapabilities['authentication'];
      transports?: ProbeCapabilities['transports'];
    };
    return {
      endpoint: base,
      ok: true,
      latencyMs,
      ...(info.serverId ? { serverId: info.serverId } : {}),
      ...(info.serverName ? { serverName: info.serverName } : {}),
      ...(info.protocolVersion !== undefined ? { protocolVersion: info.protocolVersion } : {}),
      ...(info.authentication || info.transports
        ? {
            capabilities: {
              ...(info.authentication ? { authentication: info.authentication } : {}),
              ...(info.transports ? { transports: info.transports } : {}),
            },
          }
        : {}),
    };
  } catch (error) {
    return {
      endpoint: base,
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Picks the first route that answers.
 *
 * Sequential rather than parallel: probing every route at once would wake a
 * sleeping laptop over Wake-on-LAN and light up a relay tunnel purely to run
 * `generatorai chat list`. The best-known route is tried first and usually
 * wins on the first attempt.
 */
export async function resolveEndpoint(
  connection: ServerConnection,
  timeoutMs = 4000,
): Promise<{ endpoint: string; probe: ProbeResult } | null> {
  const routes = [connection.endpoint, ...connection.endpoints.filter((e) => e !== connection.endpoint)];
  let lastFailure: ProbeResult | null = null;
  for (const route of routes) {
    const probe = await probeEndpoint(route, timeoutMs);
    if (probe.ok) return { endpoint: route, probe };
    lastFailure = probe;
  }
  return lastFailure ? null : null;
}

export { hostLabel };
export type { ServerConnection, ConnectionCatalog };
