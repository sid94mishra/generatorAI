// ────────────────────────────────────────────────────────────────
// authTransport — makes *every* browser network call authenticated.
//
// The SPA has ~30 raw `fetch('/api/...')` call sites plus a handful of
// `EventSource` / `WebSocket` constructions spread across pages, hooks and
// panels. Editing each of them individually would work today and rot
// tomorrow: the next feature that types `fetch('/api/...')` would silently
// ship an unauthenticated request.
//
// So instead of 30 edits we install one interception layer:
//
//   * `installAuthFetchInterceptor()` wraps `window.fetch`. Any same-origin
//     `/api/**` request is re-dispatched through the AuthenticatedClientRuntime,
//     which attaches the DPoP proof and handles refresh/nonce/revocation.
//     Everything else (widget origins, CDNs, blob: URLs) passes straight
//     through untouched.
//   * `openAuthenticatedEventSource()` / `openAuthenticatedWebSocket()` mint a
//     single-use 30-second ticket first, because neither API can carry headers.
//
// The interceptor is deliberately idempotent and re-entrancy safe: the
// runtime itself calls `fetch`, and without the guard below that call would
// recurse into the interceptor forever.
// ────────────────────────────────────────────────────────────────

import { getAuthRuntime, setRuntimeFetchImpl } from './authRuntime.js';

/**
 * Marks an init object as "already signed, do not re-enter the interceptor".
 *
 * Deliberately a Symbol property on the init object rather than an HTTP
 * header: a header would actually be transmitted, and any non-simple header on
 * a cross-origin request triggers a CORS preflight that the server would have
 * to explicitly allow. A Symbol is invisible to `fetch` and never leaves the
 * page.
 */
const BYPASS = Symbol.for('generatorai.signedRequest');

type MarkedInit = RequestInit & { [BYPASS]?: true };

let installed = false;

/** True for requests the interceptor must sign. */
function isApiRequest(url: string): boolean {
  try {
    const resolved = new URL(url, window.location.origin);
    if (resolved.origin !== window.location.origin) {
      // Cross-origin: only sign it when it targets the paired server.
      const endpoint = getAuthRuntime().endpoint;
      if (!endpoint || !url.startsWith(endpoint)) return false;
    }
    return resolved.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Wraps `window.fetch` once, for the lifetime of the page.
 *
 * Must be called before any feature code runs — see `main.tsx`.
 */
export function installAuthFetchInterceptor(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);

  // The runtime must NOT be routed back through the interceptor, otherwise
  // signing a request would trigger signing a request, forever. Registered via
  // the auth module so a runtime rebuilt for another server inherits it.
  setRuntimeFetchImpl((url: RequestInfo | URL, init?: RequestInit) =>
    nativeFetch(url, { ...init, [BYPASS]: true } as MarkedInit),
  );

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);

    // Already signed by the runtime, or not ours — pass straight through.
    if ((init as MarkedInit | undefined)?.[BYPASS]) {
      return nativeFetch(input, init);
    }
    if (!isApiRequest(url)) {
      return nativeFetch(input, init);
    }

    // `fetch(new Request(...))` is rare in this codebase but must not lose
    // its body, so we normalise through the Request constructor.
    if (input instanceof Request) {
      const clone = input.clone();
      const body = ['GET', 'HEAD'].includes(clone.method)
        ? undefined
        : await clone.arrayBuffer();
      return getAuthRuntime().fetch(url, {
        method: clone.method,
        headers: Object.fromEntries(clone.headers.entries()),
        ...(body && body.byteLength > 0 ? { body } : {}),
        ...init,
      });
    }

    return getAuthRuntime().fetch(url, init ?? {});
  };
}

// ── Streaming helpers ──────────────────────────────────────────────

export interface StreamTicketScope {
  /** Ticket scope: `session` | `run` | `chat` | `global` | `automation`. */
  scope: string;
  /** Scope id. `null` only for scopes that do not need one (e.g. `stt`). */
  id: string | null;
}

/**
 * Opens an `EventSource` against `url` after minting a single-use ticket, and
 * keeps it open across reconnects.
 *
 * Why this is not just `new EventSource(url + '?ticket=' + t)`:
 * a ticket is **single use**, and the browser's built-in EventSource
 * auto-reconnect replays the *same* URL. The second attempt would present an
 * already-redeemed ticket, the server would answer 401, and per the HTML spec
 * a non-2xx response permanently kills the EventSource. So we take ownership
 * of reconnection: on any close we mint a fresh ticket, and resume from the
 * last delivered sequence via `?afterSeq=` so no event is lost in the gap.
 *
 * Returns a handle synchronously so callers keep their existing `useEffect`
 * cleanup shape. Closing before the first ticket arrives prevents the
 * connection from ever being opened.
 */
export function openAuthenticatedEventSource(
  url: string,
  ticketScope: StreamTicketScope,
  handlers: {
    onMessage?: (event: MessageEvent<string>) => void;
    onOpen?: () => void;
    onError?: (source: EventSource | null) => void;
  },
): { close: () => void } {
  let source: EventSource | null = null;
  let closed = false;
  let attempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Highest `id:` seen, so a reconnect resumes exactly where we stopped. */
  let lastEventId: string | null = null;

  const connect = async (): Promise<void> => {
    if (closed) return;
    try {
      const ticket = await getAuthRuntime().createStreamTicket(ticketScope.scope, ticketScope.id);
      if (closed) return;
      const target = new URL(url, `${getAuthRuntime().endpoint}/`);
      // Empty means the server is running unauthenticated — a bogus ticket
      // would be rejected before the server ever reached that branch.
      if (ticket) target.searchParams.set('ticket', ticket);
      if (lastEventId) target.searchParams.set('afterSeq', lastEventId);

      const es = new EventSource(target.toString());
      source = es;

      es.onopen = () => {
        attempts = 0;
        handlers.onOpen?.();
      };
      es.onmessage = (e) => {
        const evt = e as MessageEvent<string>;
        if (evt.lastEventId) lastEventId = evt.lastEventId;
        handlers.onMessage?.(evt);
      };
      es.onerror = () => {
        handlers.onError?.(es);
        if (closed) return;
        // Only the CLOSED state is terminal; CONNECTING means the browser is
        // still retrying a transport-level blip on its own.
        if (es.readyState !== EventSource.CLOSED) return;
        try {
          es.close();
        } catch {
          /* already closed */
        }
        scheduleRetry();
      };
    } catch {
      // Ticket mint failed — unpaired, revoked, or missing scope. The auth
      // state listener drives the UI; we still back off and retry in case it
      // was a transient network failure.
      if (!closed) {
        handlers.onError?.(null);
        scheduleRetry();
      }
    }
  };

  const scheduleRetry = (): void => {
    if (closed || retryTimer) return;
    attempts += 1;
    // 500ms → 8s, capped. Unbounded retries are fine: the handle is closed on
    // unmount, and a paired device that comes back online should reattach.
    const delay = Math.min(8000, 500 * 2 ** Math.min(attempts - 1, 4));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  };

  void connect();

  return {
    close: () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      try {
        source?.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/**
 * Mints a ticket and returns a ready-to-open `ws(s)://` URL.
 *
 * Terminal/browser/STT sockets each require their own execution scope, so a
 * device without `exec:terminal` simply cannot obtain a terminal ticket.
 */
export async function buildAuthenticatedSocketUrl(
  path: string,
  ticketScope: StreamTicketScope,
): Promise<string> {
  return getAuthRuntime().buildSocketUrl(path, ticketScope.scope, ticketScope.id);
}
