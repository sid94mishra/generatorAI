// ────────────────────────────────────────────────────────────────
// Assembling a working client from a connection.
//
// This is the one place that knows how auth, transport, the API surface and
// the event stream fit together. All three surfaces call it, so all three
// authenticate identically — which is the fix for the previous TUI, which set
// `GENERATORAI_API_KEY` in the environment and skipped DPoP entirely.
// ────────────────────────────────────────────────────────────────

import { createAdminApi, createApiClient, SseParser } from '@generatorai/client-core';
import { Backoff } from '@generatorai/client-transport';
import type { AuthenticatedClientRuntime } from '@generatorai/client-runtime';
import { getCliAuthRuntime } from '../auth/cliAuth.js';
import {
  ConnectionManager,
  probeEndpoint,
  resolveEndpoint,
  type ServerConnection,
} from '../connection/ConnectionManager.js';
import type { Api, StreamPort } from '../context/CliContext.js';
import type { ResolvedCliConfig } from '../config/schema.js';
import { CliError } from '../errors/CliError.js';
import { SharedStreamPort } from './SharedStreamPort.js';

export interface CliClient {
  api: Api;
  stream: StreamPort;
  runtime: AuthenticatedClientRuntime;
  baseUrl: string;
  connection: ServerConnection | null;
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
async function selectEndpoint(
  options: CreateCliClientOptions,
): Promise<{ baseUrl: string; connection: ServerConnection | null }> {
  if (options.serverUrl) {
    return { baseUrl: options.serverUrl.replace(/\/$/, ''), connection: null };
  }

  const manager = new ConnectionManager();
  const connection = options.connectionRef
    ? manager.require(options.connectionRef)
    : (options.config.activeConnection ? manager.find(options.config.activeConnection) : null) ??
      manager.active();

  if (!connection) {
    return { baseUrl: options.config.server.url.replace(/\/$/, ''), connection: null };
  }

  if (options.offline) {
    return { baseUrl: connection.endpoint, connection };
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

  if (resolved.endpoint !== connection.endpoint) {
    manager.markConnected(connection.serverId, resolved.endpoint);
  }
  return { baseUrl: resolved.endpoint, connection };
}

export async function createCliClient(options: CreateCliClientOptions): Promise<CliClient> {
  const { baseUrl, connection } = await selectEndpoint(options);

  const runtime = getCliAuthRuntime({
    endpoint: baseUrl,
    serverId: connection?.serverId,
    profile: options.config.activeProfile,
    legacyApiKey: options.config.server.apiKey,
  });

  const disposers: Array<() => void> = [];

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

  const stream: StreamPort = {
    subscribe(scope, id, handler, subscribeOptions) {
      let closed = false;
      let lastSequence = subscribeOptions?.afterSequence ?? 0;
      const backoff = new Backoff({ baseMs: 1000, maxMs: 30_000, factor: 1.5 });
      let abort: AbortController | null = null;

      const connect = async (): Promise<void> => {
        while (!closed) {
          abort = new AbortController();
          const onOuterAbort = () => abort?.abort();
          options.signal?.addEventListener('abort', onOuterAbort, { once: true });

          try {
            const query = new URLSearchParams({ scope, id });
            if (lastSequence > 0) query.set('afterSequence', String(lastSequence));
            if (subscribeOptions?.filter?.length) {
              query.set('filter', subscribeOptions.filter.join(','));
            }

            const response = await runtime.fetch(`/api/stream?${query}`, {
              headers: {
                accept: 'text/event-stream',
                // Belt and braces alongside `afterSequence`: whichever the
                // server honours, no event is delivered twice or skipped.
                ...(lastSequence > 0 ? { 'last-event-id': String(lastSequence) } : {}),
              },
              signal: abort.signal,
            });

            if (!response.ok || !response.body) {
              throw new Error(`Stream failed: ${response.status} ${response.statusText}`);
            }

            subscribeOptions?.onConnected?.();
            backoff.reset();

            const parser = new SseParser();
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              for (const message of parser.push(decoder.decode(value, { stream: true }))) {
                if (!message.data) continue;
                let payload: { kind?: string; payload?: unknown; data?: unknown; sequence?: number };
                try {
                  payload = JSON.parse(message.data) as typeof payload;
                } catch {
                  continue;
                }
                const sequence = payload.sequence ?? (message.id ? Number(message.id) : undefined);
                if (sequence !== undefined && Number.isFinite(sequence)) {
                  lastSequence = Math.max(lastSequence, sequence);
                }
                handler({
                  kind: payload.kind ?? message.event,
                  data: (payload.payload ?? payload.data ?? {}) as Record<string, unknown>,
                  ...(sequence !== undefined ? { sequence } : {}),
                });
              }
            }
          } catch (error) {
            if (closed || abort?.signal.aborted) return;
            subscribeOptions?.onDisconnected?.(
              error instanceof Error ? error.message : String(error),
            );
          } finally {
            options.signal?.removeEventListener('abort', onOuterAbort);
          }

          if (closed) return;
          // A clean end-of-body is still a disconnect — the server closed the
          // stream — so both paths fall through to the same reconnect.
          const attempt = backoff.attempts + 1;
          if (attempt > 20) {
            subscribeOptions?.onDisconnected?.('giving up after 20 attempts');
            return;
          }
          subscribeOptions?.onReconnecting?.(attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff.next()));
        }
      };

      void connect();

      const dispose = () => {
        closed = true;
        abort?.abort();
        // Drop the registration too. A TUI session opens and closes a
        // subscription per pane, and without this the array — and the aborted
        // controllers it closes over — grows for the life of the process.
        const index = disposers.indexOf(dispose);
        if (index >= 0) disposers.splice(index, 1);
      };
      disposers.push(dispose);
      return dispose;
    },
  };

  // W48 / STR-04 — deduplicate connections for the same scope:id.
  // `SharedStreamPort` fans multiple pane subscriptions to the same scope out
  // from a single underlying HTTP SSE connection, eliminating duplicate requests
  // when the user opens the same chat/run in more than one TUI pane.
  // The full mux (single connection for ALL scopes) is the next step; see
  // packages/cli-core/src/client/SharedStreamPort.ts for details.
  const sharedStream = new SharedStreamPort(stream);

  return {
    api,
    stream: sharedStream,
    runtime,
    baseUrl,
    connection,
    fetch: apiFetch,
    socketUrl: (path, scope, id) => runtime.buildSocketUrl(path, scope, id),
    dispose() {
      sharedStream.disposeAll();
      for (const dispose of disposers.splice(0)) dispose();
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
