// ────────────────────────────────────────────────────────────────
// LlmTextFormatter — every case exercises the resilience contract from
// ITextFormatter's file header: this must NEVER throw, and must fall back
// to the original text on any failure (missing key, HTTP error, network
// error, timeout, malformed response). `fetch` is mocked; no real network
// call is ever made.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SecretStore } from '@generatorai/secrets';
import { LlmTextFormatter } from '../LlmTextFormatter.js';

function fakeSecretStore(apiKey: string | null): SecretStore {
  return {
    get: vi.fn(async (_namespace: string, _name: string) => (apiKey == null ? null : new TextEncoder().encode(apiKey))),
    set: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    removeNamespace: vi.fn(),
    list: vi.fn(),
    getOrCreateRandom: vi.fn(),
    backendInfo: vi.fn(),
  } as unknown as SecretStore;
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => logger) };

function chatCompletionResponse(content: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

describe('LlmTextFormatter', () => {
  beforeEach(() => {
    logger.warn.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names itself after the configured model', () => {
    const formatter = new LlmTextFormatter(fakeSecretStore('key'), { model: 'gpt-4o-mini' });
    expect(formatter.name).toBe('llm:gpt-4o-mini');
  });

  it('returns the input unchanged for empty/whitespace-only text WITHOUT calling fetch at all', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const formatter = new LlmTextFormatter(fakeSecretStore('key'));

    expect(await formatter.format('')).toBe('');
    expect(await formatter.format('   ')).toBe('   ');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the original text and warns when no API key is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const formatter = new LlmTextFormatter(fakeSecretStore(null), { logger });

    const result = await formatter.format('hello world');

    expect(result).toBe('hello world');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('sends the API key, model, and text in the expected request shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatCompletionResponse('Hello, world.'));
    vi.stubGlobal('fetch', fetchMock);
    const formatter = new LlmTextFormatter(fakeSecretStore('sk-test-123'), {
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1/chat/completions',
    });

    const result = await formatter.format('um hello world');

    expect(result).toBe('Hello, world.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test-123');
    const body = JSON.parse(init.body as string) as { model: string; messages: Array<{ role: string; content: string }> };
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages.find((m) => m.role === 'user')?.content).toBe('um hello world');
    expect(body.messages.some((m) => m.role === 'system')).toBe(true);
  });

  it('honors a custom baseUrl (any OpenAI-compatible endpoint)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatCompletionResponse('cleaned'));
    vi.stubGlobal('fetch', fetchMock);
    const formatter = new LlmTextFormatter(fakeSecretStore('key'), { baseUrl: 'https://my-self-hosted-llm.example/v1/chat' });

    await formatter.format('text');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://my-self-hosted-llm.example/v1/chat');
  });

  it('falls back to the original text on an HTTP error response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatCompletionResponse('', false, 401));
    vi.stubGlobal('fetch', fetchMock);
    const formatter = new LlmTextFormatter(fakeSecretStore('bad-key'), { logger });

    const result = await formatter.format('hello world');

    expect(result).toBe('hello world');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('401'));
  });

  it('falls back to the original text when fetch itself throws (network error)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    vi.stubGlobal('fetch', fetchMock);
    const formatter = new LlmTextFormatter(fakeSecretStore('key'), { logger });

    const result = await formatter.format('hello world');

    expect(result).toBe('hello world');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ENOTFOUND'));
  });

  it('falls back to the original text on a request timeout, without hanging the caller', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const formatter = new LlmTextFormatter(fakeSecretStore('key'), { logger, timeoutMs: 5_000 });

    const pending = formatter.format('hello world');
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;

    expect(result).toBe('hello world');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    vi.useRealTimers();
  });

  it('falls back to the original text when the response has no usable content (malformed/empty choices)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [] }) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const formatter = new LlmTextFormatter(fakeSecretStore('key'));

    const result = await formatter.format('hello world');

    expect(result).toBe('hello world');
  });

  it('falls back to the original text when response.json() itself throws', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected end of JSON input');
      },
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const formatter = new LlmTextFormatter(fakeSecretStore('key'), { logger });

    const result = await formatter.format('hello world');

    expect(result).toBe('hello world');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('trims the cleaned response text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatCompletionResponse('  Cleaned text.  '));
    vi.stubGlobal('fetch', fetchMock);
    const formatter = new LlmTextFormatter(fakeSecretStore('key'));

    expect(await formatter.format('cleaned text')).toBe('Cleaned text.');
  });
});
