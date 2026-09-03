// ────────────────────────────────────────────────────────────────
// Assembling a working client from a connection.
//
// This is the one place that knows how auth, transport, the API surface and
// the event stream fit together. All three surfaces call it, so all three
// authenticate identically — which is the fix for the previous TUI, which set
// `GENERATORAI_API_KEY` in the environment and skipped DPoP entirely.
// ────────────────────────────────────────────────────────────────

import { createAdminApi, createApiClient, MuxStreamClient } from '@generatorai/client-core';
import type { AuthenticatedClientRuntime } from '@generatorai/client-runtime';
import { getCliAuthRuntime } from '../auth/cliAuth.js';
import {
  checkProtocolCompatibility,
  ConnectionManager,
  probeEndpoint,
  resolveEndpoint,
  SUPPORTED_PROTOCOL_VERSIONS,
  type ServerConnection,
} from '../connection/ConnectionManager.js';
import type { Api, StreamPort } from '../context/CliContext.js';
import type { ResolvedCliConfig } from '../config/schema.js';
import { CliError } from '../errors/CliError.js';

export interface CliClient {
  api: Api;
  stream: StreamPort;
  runtime: AuthenticatedClientRuntime;
  baseUrl: string;
  connection: ServerConnection | null;
  /**
   * Set when the server's protocol version is ahead of what this CLI build
   * has been written against (`checkProtocolCompatibility() === 'server-ahead'`).
   * Not fatal — unknown response fields are just ignored — but worth a
   * one-time heads-up rather than a silently stale CLI. A version genuinely
   * too old to talk to fails outright in `selectEndpoint` instead; this is
   * the one case left for the caller to decide how to surface.
   */
  protocolWarning: string | null;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** Absolute ws:// or wss:// URL for a server WebSocket path. */
  socketUrl(path: string, scope: string, id: string | null): Promise<string>;
  dispose(): void;
}

export interface CreateCliClientOptions {
  config: ResolvedCliConfig;
  /** Explicit override from `--server`; wins over the connection catalog. */
  serverUrl?: string | undefined;
  /** Explicit override from `--connection`. */
  connectionRef?: string | undefined;
  /** Skips endpoint probing. Used by commands that do not need the server. */
  offline?: boolean;
  signal?: AbortSignal;
}

/**
 * Chooses which server to talk to.
 *
 * Precedence is `--server` → `--connection` → the catalog's active entry →
 * `config.server.url`. The bare URL fallback exists so a fresh install with
 * no catalog still works against a local server.
 */
/** Exported for direct testing of the version-negotiation branch — the rest of `createCliClient` needs a live DPoP runtime to exercise meaningfully, this does not. */
export async function selectEndpoint(
  options: CreateCliClientOptions,
): Promise<{ baseUrl: string; connection: ServerConnection | null; protocolWarning: string | null }> {
  if (options.serverUrl) {
    return { baseUrl: options.serverUrl.replace(/\/$/, ''), connection: null, protocolWarning: null };
  }

  const manager = new ConnectionManager();
  const connection = options.connectionRef
    ? manager.require(options.connectionRef)
    : (options.config.activeConnection ? manager.find(options.config.activeConnection) : null) ??
      manager.active();

  if (!connection) {
    return { baseUrl: options.config.server.url.replace(/\/$/, ''), connection: null, protocolWarning: null };
  }

  if (options.offline) {
    return { baseUrl: connection.endpoint, connection, protocolWarning: null };
  }

  const resolved = await resolveEndpoint(connection);
  if (!resolved) {
    throw new CliError('UNAVAILABLE', `No route to "${connection.label}" answered.`, {
      hint: `Tried: ${[connection.endpoint, ...connection.endpoints].join(', ')}`,
      suggestions: [
        `generatorai connect test ${connection.label}`,
        `generatorai connect endpoint add ${connection.label} <url>`,
      ],
    });
  }

  // Host pinning: a route answering with a different identity is the
  // impersonation case and must not receive this device's credential.
  if (resolved.probe.serverId && resolved.probe.serverId !== connection.serverId) {
    throw new CliError(
      'NOAUTH',
      `The server at ${resolved.endpoint} is not the one this device paired with.`,
      {
        hint:
          'Its identity key changed. That can mean the server was reinstalled — or that ' +
          'something is impersonating it. Re-pair only if you expected this.',
        suggestions: [`generatorai connect test ${connection.label}`],
      },
    );
  }

  // Protocol-version range check — real negotiation, replacing the previous
  // "nothing is checked at all" state (the version field this reads was, until
  // this same change, populated under the WRONG field name and always
  // `undefined`; see `ConnectionManager.ts`'s `probeEndpoint`). A server
  // below this CLI's minimum-supported version fails outright here, the same
  // way the host-pinning check above does — a request against a genuinely
  // incompatible server is not a request worth making. A server AHEAD of
  // this CLI build is not fatal (unknown response fields are simply
  // ignored), so that case is surfaced as `protocolWarning` for the caller
  // to log/toast once, not thrown.
  const compatibility = checkProtocolCompatibility(resolved.probe.protocolVersion);
  if (compatibility === 'server-too-old') {
    throw new CliError(
      'VERSION_MISMATCH',
      `${connection.label} speaks protocol v${resolved.probe.protocolVersion}; this CLI needs at least v${SUPPORTED_PROTOCOL_VERSIONS.min}.`,
      {
        hint: 'The server needs upgrading before this CLI build can talk to it.',
        suggestions: [`generatorai connect test ${connection.label}`],
      },
    );
  }

  if (resolved.endpoint !== connection.endpoint) {
    manager.markConnected(connection.serverId, resolved.endpoint);
  }
  return {
    baseUrl: resolved.endpoint,
    connection,
    protocolWarning:
      compatibility === 'server-ahead'
        ? `${connection.label} speaks protocol v${resolved.probe.protocolVersion}, ahead of what this CLI build understands.`
        : null,
  };
}

export async function createCliClient(options: CreateCliClientOptions): Promise<CliClient> {
  const { baseUrl, connection, protocolWarning } = await selectEndpoint(options);

  const runtime = getCliAuthRuntime({
    endpoint: baseUrl,
    serverId: connection?.serverId,
    profile: options.config.activeProfile,
    legacyApiKey: options.config.server.apiKey,
  });

  const requestTimeoutMs = options.config.server.timeoutMs;

  const apiFetch = async (path: string, init?: RequestInit): Promise<Response> => {
    // Every REST call is bounded. A server that accepts the connection and
    // then never answers — a wedged provider SDK is the usual cause — would
    // otherwise hang the CLI forever with no output and no way to tell
    // whether it is working. Streaming uses its own path and is not bounded.
    // `0` is the documented escape hatch for "wait as long as it takes".
    const timeout = requestTimeoutMs > 0 ? AbortSignal.timeout(requestTimeoutMs) : undefined;
    const signals = [timeout, init?.signal, options.signal].filter(
      (s): s is AbortSignal => Boolean(s),
    );

    try {
      // The runtime takes an absolute or relative path and handles DPoP,
      // refresh and endpoint pinning; nothing above it should build URLs.
      return await runtime.fetch(path, {
        ...init,
        ...(signals.length > 0
          ? { signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0]! }
          : {}),
      });
    } catch (error) {
      if (timeout?.aborted) {
        throw new CliError(
          'TIMEOUT',
          `The server did not respond within ${Math.round(requestTimeoutMs / 1000)}s.`,
          {
            hint: `Raise it with --timeout <ms>, use --timeout 0 to wait indefinitely, or check whether ${baseUrl} is healthy.`,
            suggestions: ['generatorai system health', 'generatorai connect test'],
            cause: error,
          },
        );
      }
      throw error;
    }
  };

  const api = deepMergeApi(createApiClient(apiFetch), createAdminApi(apiFetch)) as Api;

  // Phase 3 items 1/2 — one shared connection multiplexing every subscribed
  // scope, replacing the previous per-`scope:id` HTTP/SSE connection (each
  // with its own `Backoff`/reconnect loop) plus `SharedStreamPort`'s
  // same-scope-only dedup on top of it. `MuxStreamClient` talks to the SAME
  // real server endpoints `apps/web`'s browser client already uses
  // (`POST /api/stream/connections`, `POST .../subs`, `GET /api/stream?c=`)
  // — `apps/server/src/routes/stream.ts`'s own comment on the older
  // single-scope endpoint says as much: "stays for the CLI, curl and any
  // client that has not moved." This is that move.
  //
  // Deliberately `runtime.fetch` directly, not `apiFetch`: `apiFetch` bounds
  // every call to `--timeout`, which is correct for a REST call and wrong
  // for a connection meant to stay open indefinitely — the original
  // single-scope implementation made the same choice for the same reason.
  // The POST control-plane calls (`/connections`, `.../subs`) inherit that
  // same lack of a per-request timeout as a result; they are still bounded
  // by `options.signal` (the whole client's lifetime), just not by
  // `--timeout` specifically — a deliberate, minor trade-off, not an
  // oversight.
  const streamClient = new MuxStreamClient({
    fetch: (path, init) => runtime.fetch(path, init),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  return {
    api,
    stream: streamClient,
    runtime,
    baseUrl,
    connection,
    protocolWarning,
    fetch: apiFetch,
    socketUrl: (path, scope, id) => runtime.buildSocketUrl(path, scope, id),
    dispose() {
      streamClient.disposeAll();
    },
  };
}

export { probeEndpoint };

/**
 * Merges the two API halves one level into each namespace.
 *
 * A shallow spread would drop `runs.stages` (read-only half) the moment the
 * admin half also declared a `runs` namespace. Merging per-namespace keeps
 * both, with admin winning on a genuine method collision because it is the
 * one with the write semantics the CLI needs.
 */
function deepMergeApi(
  read: Record<string, unknown>,
  admin: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...read };
  for (const [key, adminValue] of Object.entries(admin)) {
    const readValue = out[key];
    const bothNamespaces =
      isNamespace(readValue) && isNamespace(adminValue);
    out[key] = bothNamespaces
      ? deepMergeApi(readValue as Record<string, unknown>, adminValue as Record<string, unknown>)
      : adminValue;
  }
  return out;
}

function isNamespace(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
