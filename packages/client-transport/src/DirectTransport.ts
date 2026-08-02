// ────────────────────────────────────────────────────────────────
// DirectTransport — plain fetch to a reachable origin.
//
// Covers `loopback` (desktop shell, same machine) and `lan` (phone on the
// same wifi). There is no tunnel: the origin is dialable, so this is a thin
// wrapper that exists only so the supervisor can treat every route
// uniformly.
// ────────────────────────────────────────────────────────────────

import type { TransportAdapter, TransportKind } from './TransportAdapter.js';

export interface DirectTransportOptions {
  kind: Extract<TransportKind, 'loopback' | 'lan'>;
  /** Absolute origin, e.g. `http://192.168.1.10:3100`. Trailing slash is trimmed. */
  endpoint: string;
  fetchImpl?: typeof fetch;
  /**
   * Probe timeout for `open()`. A phone that has left the wifi must discover
   * that quickly rather than hanging on a TCP connect until the OS gives up
   * (which can be 75s+ on iOS).
   */
  probeTimeoutMs?: number;
}

export class DirectTransport implements TransportAdapter {
  readonly kind: Extract<TransportKind, 'loopback' | 'lan'>;
  readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly probeTimeoutMs: number;

  constructor(options: DirectTransportOptions) {
    this.kind = options.kind;
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    // `.bind(globalThis)` is required, not defensive. Browsers implement
    // `fetch` as a method of the global object and reject a detached call
    // with "Failed to execute 'fetch' on 'Window': Illegal invocation" —
    // which is exactly what happens once the reference is stored on `this`
    // and later invoked as `this.fetchImpl(...)`.
    //
    // React Native's `fetch` is a plain function and does not care, and unit
    // tests inject their own `fetchImpl`, so this only ever fails in a real
    // browser — i.e. the Expo web build, where it broke pairing outright.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    this.probeTimeoutMs = options.probeTimeoutMs ?? 4_000;
    if (!this.fetchImpl) {
      throw new Error('DirectTransport requires a fetch implementation');
    }
  }

  /**
   * Probe `/api/health` so an unreachable endpoint fails fast and the
   * supervisor can move on to the next candidate.
   *
   * `/api/health` is unauthenticated by policy, so this reveals nothing and
   * needs no credential.
   */
  async open(signal?: AbortSignal): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const res = await this.fetchImpl(`${this.endpoint}/api/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`health probe returned ${res.status}`);
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  fetch(input: string, init?: RequestInit): Promise<Response> {
    return this.fetchImpl(this.resolve(input), init);
  }

  streamUrl(path: string, protocol: 'http' | 'ws'): string {
    const url = this.resolve(path);
    if (protocol === 'http') return url;
    return url.replace(/^http/, 'ws');
  }

  async close(): Promise<void> {
    // Nothing to tear down: fetch owns its own connection pool.
  }

  private resolve(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return `${this.endpoint}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }
}
