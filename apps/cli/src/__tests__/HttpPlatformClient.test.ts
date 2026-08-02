import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Point the CLI at a throwaway credential vault BEFORE importing anything
// that reads it. Without this the test would load the developer's real
// `~/.generatorai` identity: if that machine happens to be paired, the client
// tries a token refresh and these tests fail for reasons unrelated to the
// code under test (and, worse, pass or fail depending on who runs them).
process.env['GENERATORAI_CONFIG_DIR'] = fs.mkdtempSync(
  path.join(os.tmpdir(), 'generatorai-cli-test-'),
);

const { HttpPlatformClient } = await import('../platform/HttpPlatformClient.js');

// Verifies the CLI HTTP client maps facade methods to the correct
// REST endpoints/verbs and normalizes the base URL — with `fetch` mocked,
// so no server is required.
//
// Requests flow through the shared `AuthenticatedClientRuntime`, which asks
// the server once whether a credential is required at all. The mock answers
// that discovery probe with "authentication not required", so the client
// behaves exactly as it does against a local dev server and the assertions
// below can stay focused on endpoint mapping.

/** The PUBLIC discovery endpoint the runtime probes. */
const DISCOVERY_PATH = '/api/auth/server-info';

/** A discovery response saying "this server does not require a credential". */
function discoveryResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => ({
      serverId: 'test-server',
      authentication: { required: false, dpopRequired: true },
    }),
    text: async () => '{}',
  } as unknown as Response;
}

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes(DISCOVERY_PATH)) return discoveryResponse();
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'x',
      headers: new Headers(),
      json: async () => body,
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  });
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('HttpPlatformClient endpoint mapping', () => {
  let calls: Array<{ url: string; init?: RequestInit }>;
  beforeEach(() => {
    calls = [];
  });

  /** The recorded calls with the auth discovery probe filtered out. */
  function apiCalls(): Array<{ url: string; init?: RequestInit }> {
    return calls.filter((c) => !c.url.includes(DISCOVERY_PATH));
  }

  function spyFetch(status = 200, body: unknown = {}) {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push({ url: href, init });
      if (href.includes(DISCOVERY_PATH)) return discoveryResponse();
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: 'x',
        headers: new Headers(),
        json: async () => body,
        text: async () => (body === undefined ? '' : JSON.stringify(body)),
      } as unknown as Response;
    }) as typeof fetch;
  }

  it('normalizes a trailing slash in the base URL', async () => {
    spyFetch(200, []);
    const client = new HttpPlatformClient('http://localhost:9999/');
    await client.listChats();
    expect(apiCalls()[0]!.url).toBe('http://localhost:9999/api/chats');
  });

  it('createChat → POST /api/chats with a JSON body', async () => {
    spyFetch(200, { id: 'c1', name: 'X' });
    const client = new HttpPlatformClient('http://localhost:9999');
    await client.createChat({ name: 'X' } as never);
    expect(apiCalls()[0]!.url).toBe('http://localhost:9999/api/chats');
    expect(apiCalls()[0]!.init?.method).toBe('POST');
    expect(String(apiCalls()[0]!.init?.body)).toContain('"name":"X"');
  });

  it('getHealthInfo → GET /api/health', async () => {
    spyFetch(200, { status: 'ok' });
    const client = new HttpPlatformClient('http://localhost:9999');
    const health = await client.getHealthInfo();
    expect(apiCalls()[0]!.url).toBe('http://localhost:9999/api/health');
    expect(health).toEqual({ status: 'ok' });
  });

  it('listChats with a status filter appends the query string', async () => {
    spyFetch(200, []);
    const client = new HttpPlatformClient('http://localhost:9999');
    await client.listChats({ status: 'active' });
    expect(apiCalls()[0]!.url).toContain('/api/chats?');
    expect(apiCalls()[0]!.url).toContain('status=active');
  });
});

describe('HttpPlatformClient error handling', () => {
  afterEach(() => { globalThis.fetch = realFetch; });

  it('throws ApiError on a non-ok response (after retries)', async () => {
    globalThis.fetch = mockFetchOnce(404, { error: { code: 'NOT_FOUND', message: 'nope' } }) as typeof fetch;
    const client = new HttpPlatformClient('http://localhost:9999');
    await expect(client.getChat('missing')).rejects.toMatchObject({ status: 404 });
  });
});
