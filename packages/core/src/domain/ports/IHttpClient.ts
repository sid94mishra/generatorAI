// ────────────────────────────────────────────────────────────────
// IHttpClient — Port interface for HTTP requests (used by hooks)
// ────────────────────────────────────────────────────────────────

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  /**
   * Phase 1, 1.24 — abort the in-flight request. Implementations wire this
   * straight through to `fetch(..., { signal })` so a hook/stage timeout
   * actually cancels the socket instead of just rejecting the wait.
   */
  signal?: AbortSignal;
  /**
   * Address policy for this request. `'public-only'` forces the SSRF
   * policy (no private / loopback / link-local / metadata targets, redirects
   * re-vetted per hop) even on a client constructed with a private-network
   * opt-in. Callers handing user-supplied URLs to the network (data
   * sources) MUST set it. Default: the client's own configuration.
   */
  network?: 'public-only' | 'default';
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface IHttpClient {
  request(options: HttpRequestOptions): Promise<HttpResponse>;
}
