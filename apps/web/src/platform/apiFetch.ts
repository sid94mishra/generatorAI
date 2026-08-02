// ────────────────────────────────────────────────────────────────
// apiFetch — Shared HTTP helper with typed error handling
//
// Every request goes through the shared `AuthenticatedClientRuntime`, which
// attaches a DPoP proof bound to this browser's non-extractable device key.
// The legacy shared-key path survives only for an unmigrated local setup.
// ────────────────────────────────────────────────────────────────

import { getAuthRuntime, getStoredApiKey, API_KEY_STORAGE_KEY } from './authRuntime.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export { API_KEY_STORAGE_KEY, getStoredApiKey };

/**
 * Builds an authenticated SSE URL.
 *
 * Async because obtaining a single-use ticket is a network round trip. The
 * ticket lives 30 seconds and can be redeemed once, so — unlike the API key
 * this replaced — a URL captured from a log or referrer is worthless.
 */
export async function buildAuthenticatedStreamUrl(
  url: string,
  scope: string,
  id: string | null,
): Promise<string> {
  const runtime = getAuthRuntime();
  const ticket = await runtime.createStreamTicket(scope, id);
  if (!ticket) return url;
  const sep = url.includes('?') ? '&' : '?';
  const param = getStoredApiKey() ? 'apiKey' : 'ticket';
  return `${url}${sep}${param}=${encodeURIComponent(ticket)}`;
}

export async function apiFetch<T = unknown>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const mergedHeaders: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
  };
  // Default the JSON content type for string bodies. Without it Express's
  // `express.json()` skips parsing and the route sees an empty `req.body`,
  // which surfaces as a confusing "field is required" 400 even though the
  // payload was correct. FormData is deliberately excluded — the browser must
  // set `multipart/form-data` itself so it can include the boundary.
  const hasContentType =
    'Content-Type' in mergedHeaders || 'content-type' in mergedHeaders;
  if (!hasContentType && typeof options?.body === 'string') {
    mergedHeaders['Content-Type'] = 'application/json';
  }

  const response = await getAuthRuntime().fetch(url, {
    ...options,
    headers: mergedHeaders,
  });

  if (!response.ok) {
    let code = `HTTP_${String(response.status)}`;
    let msg = `Request failed with status ${String(response.status)}`;
    let details: unknown;
    try {
      const errorBody = (await response.json()) as { error?: { code?: string; message?: string; details?: unknown } };
      if (errorBody?.error?.code) code = errorBody.error.code;
      if (errorBody?.error?.message) msg = errorBody.error.message;
      details = errorBody?.error?.details;
    } catch {
      // Response might not be JSON
    }

    throw new ApiError(response.status, code, msg, details);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  // Check content type
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return response.json() as Promise<T>;
  }

  return undefined as T;
}
