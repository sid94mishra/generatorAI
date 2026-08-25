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
