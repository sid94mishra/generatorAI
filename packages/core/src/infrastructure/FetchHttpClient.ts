// ────────────────────────────────────────────────────────────────
// FetchHttpClient — IHttpClient implementation using native fetch
// ────────────────────────────────────────────────────────────────

import type { IHttpClient, HttpRequestOptions, HttpResponse } from '../domain/ports/IHttpClient.js';
import { NetworkError } from '@generatorai/shared';

export class FetchHttpClient implements IHttpClient {
  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const { url, method, headers, body, timeout: timeoutMs, signal: externalSignal } = options;

    // Internal controller carries both the caller-supplied abort (if any)
    // and the per-request timeout. Aborting either must cancel the fetch.
    const controller = new AbortController();
    let externalAbortHandler: (() => void) | undefined;
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      externalAbortHandler = () => controller.abort();
      externalSignal.addEventListener('abort', externalAbortHandler);
    }
    const timeout = timeoutMs
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ?? undefined,
        signal: controller.signal,
      });

      const responseBody = await response.text();

      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
      };
    } catch (err) {
      if (controller.signal.aborted) {
        // Distinguish caller-cancelled vs timeout when reporting.
        if (externalSignal?.aborted) {
          throw new NetworkError(
            'HTTP request aborted by caller',
            err instanceof Error ? err : undefined,
          );
        }
        throw new NetworkError(
          `HTTP request timed out after ${timeoutMs}ms`,
          err instanceof Error ? err : undefined,
        );
      }
      throw new NetworkError(
        `HTTP request failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    } finally {
      if (timeout) clearTimeout(timeout);
      if (externalSignal && externalAbortHandler) {
        externalSignal.removeEventListener('abort', externalAbortHandler);
      }
    }
  }
}
