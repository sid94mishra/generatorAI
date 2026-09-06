// ────────────────────────────────────────────────────────────────
// FetchHttpClient — IHttpClient implementation over `safeFetch`.
//
// Every URL that reaches this client came from user configuration
// (hook targets, HTTP data sources), so the SSRF policy is the DEFAULT:
// private / loopback / link-local / metadata addresses are refused,
// redirects are re-vetted hop by hop and the socket is pinned to the
// resolved address. `allowPrivate: true` is the explicit opt-in for
// loopback development targets; a request that says `network:
// 'public-only'` is protected even on a client that opted in.
// ────────────────────────────────────────────────────────────────

import type { IHttpClient, HttpRequestOptions, HttpResponse } from '../domain/ports/IHttpClient.js';
import { NetworkError } from '@generatorai/shared';
import { safeFetch, SsrfBlockedError, type SafeFetchOptions } from './safeFetch.js';

export interface FetchHttpClientOptions {
  /** Development opt-in: permit private / loopback targets. Default false. */
  allowPrivate?: boolean;
  /** Operator allowlist of hostnames exempt from the address policy. */
  allowedHosts?: readonly string[];
  /** Response size cap in bytes (default 5 MiB). */
  maxResponseBytes?: number;
  /** Test seam — see `SafeFetchOptions.lookup`. */
  lookup?: SafeFetchOptions['lookup'];
}

export class FetchHttpClient implements IHttpClient {
  constructor(private readonly options: FetchHttpClientOptions = {}) {}

  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const { url, method, headers, body, timeout: timeoutMs, signal, network } = options;
    const allowPrivate = network === 'public-only' ? false : this.options.allowPrivate === true;

    try {
      const response = await safeFetch(url, {
        method,
        headers,
        body: body ?? undefined,
        timeoutMs,
        signal,
        allowPrivate,
        allowedHosts: network === 'public-only' ? undefined : this.options.allowedHosts,
        maxResponseBytes: this.options.maxResponseBytes,
        lookup: this.options.lookup,
      });
      return {
        status: response.status,
        headers: response.headers,
        body: response.body,
      };
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        throw new NetworkError(`Request blocked: ${err.message}`, err);
      }
      const message = err instanceof Error ? err.message : String(err);
      if (/timed out|aborted by caller/.test(message)) {
        throw new NetworkError(message, err instanceof Error ? err : undefined);
      }
      throw new NetworkError(`HTTP request failed: ${message}`, err instanceof Error ? err : undefined);
    }
  }
}
