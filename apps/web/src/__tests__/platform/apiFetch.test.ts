// ────────────────────────────────────────────────────────────────
// apiFetch tests — HTTP helper with typed error handling
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, apiFetch } from '../../platform/apiFetch.js';
import { __setAllowUnauthenticatedForTests } from '../../platform/authRuntime.js';

// `apiFetch` routes through the shared AuthenticatedClientRuntime. These tests
// cover the HTTP/error semantics rather than pairing, so the runtime is put
// into the same no-credential-required mode a dev loopback server produces.
__setAllowUnauthenticatedForTests(true);

// ── Helpers ──

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  const headersObj = new Headers({ 'content-type': 'application/json', ...headers });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    json: () => Promise.resolve(body),
    blob: () => Promise.resolve(new Blob()),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function noContentResponse(): Response {
  return {
    ok: true,
    status: 204,
    headers: new Headers(),
    json: () => Promise.reject(new Error('No body')),
  } as unknown as Response;
}

function plainTextResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/plain' }),
    json: () => Promise.reject(new SyntaxError('Not JSON')),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

// ── Tests ──

describe('apiFetch', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('successful GET request returning JSON', async () => {
    const mockData = { id: '1', name: 'Test' };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(mockData));

    const result = await apiFetch<{ id: string; name: string }>('/api/test');

    // The runtime resolves relative paths against the paired endpoint, which
    // is what lets a browser talk to a remote server rather than only
    // same-origin.
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/test'),
      { headers: {} },
    );
    expect(result).toEqual(mockData);
  });

  it('successful POST request with body', async () => {
    const requestBody = { name: 'New Item' };
    const responseBody = { id: '2', name: 'New Item' };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(responseBody, 201));

    const result = await apiFetch<{ id: string; name: string }>('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/items'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    expect(result).toEqual(responseBody);
  });

  it('204 No Content returns undefined', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(noContentResponse());

    const result = await apiFetch('/api/sessions/1');

    expect(result).toBeUndefined();
  });

  it('non-JSON response returns undefined', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(plainTextResponse('OK'));

    const result = await apiFetch('/api/health');

    expect(result).toBeUndefined();
  });

  it('error response (4xx) throws ApiError with correct fields', async () => {
    const errorBody = {
      error: {
        code: 'NOT_FOUND',
        message: 'Session not found',
        details: { sessionId: 'abc' },
      },
    };
    const errorResponse: Response = {
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(errorBody),
    } as unknown as Response;

    vi.mocked(globalThis.fetch).mockResolvedValue(errorResponse);

    try {
      await apiFetch('/api/sessions/abc');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.code).toBe('NOT_FOUND');
      expect(apiErr.message).toBe('Session not found');
      expect(apiErr.details).toEqual({ sessionId: 'abc' });
      expect(apiErr.name).toBe('ApiError');
    }
  });

  it('error response (5xx) throws ApiError', async () => {
    const errorResponse: Response = {
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ error: { code: 'INTERNAL', message: 'Server error' } }),
    } as unknown as Response;

    vi.mocked(globalThis.fetch).mockResolvedValue(errorResponse);

    try {
      await apiFetch('/api/sessions');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(500);
      expect(apiErr.code).toBe('INTERNAL');
      expect(apiErr.message).toBe('Server error');
    }
  });

  it('error response with non-JSON body uses fallback code and message', async () => {
    const errorResponse: Response = {
      ok: false,
      status: 502,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    } as unknown as Response;

    vi.mocked(globalThis.fetch).mockResolvedValue(errorResponse);

    try {
      await apiFetch('/api/test');
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(502);
      expect(apiErr.code).toBe('HTTP_502');
      expect(apiErr.message).toBe('Request failed with status 502');
    }
  });

  it('network error is propagated', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(apiFetch('/api/test')).rejects.toThrow('Failed to fetch');
  });

  it('custom headers are passed through', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ ok: true }));

    await apiFetch('/api/test', {
      headers: {
        Authorization: 'Bearer token-123',
        'X-Custom-Header': 'custom-value',
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/test'), {
      headers: {
        Authorization: 'Bearer token-123',
        'X-Custom-Header': 'custom-value',
      },
    });
  });
});
