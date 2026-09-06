// ────────────────────────────────────────────────────────────────
// HttpPlatformClient tests — REST + SSE platform client
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpPlatformClient } from '../../platform/HttpPlatformClient.js';
import { __setAllowUnauthenticatedForTests } from '../../platform/authRuntime.js';
import { resetMuxStreamForTests } from '../../platform/muxStream.js';

// Every request now flows through the shared AuthenticatedClientRuntime. These
// tests exercise the REST surface, not pairing, so the runtime is put into the
// same "server does not require a credential" mode a dev loopback server
// produces — requests are then passed straight to the mocked `fetch`.
__setAllowUnauthenticatedForTests(true);

// ── Mocks ──

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  const headersObj = new Headers({ 'content-type': 'application/json', ...headers });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headersObj,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    blob: () => Promise.resolve(new Blob([JSON.stringify(body)])),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
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

// ── Test Suite ──

describe('HttpPlatformClient', () => {
  let client: HttpPlatformClient;
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    client = new HttpPlatformClient('http://localhost:3000');
    globalThis.fetch = vi.fn();
    // △ Fixed during end-to-end review — `subscribeToEvents` now routes
    // through muxStream's shared, module-level connection singleton (W26).
    // Without resetting it, the second `subscribeToEvents` test in this file
    // silently reused the first test's already-open mock connection instead
    // of creating its own, so its own `MockEventSource` spy was never called.
    resetMuxStreamForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
    resetMuxStreamForTests();
  });

  // ── Session CRUD ──

  it('createSession calls POST /api/sessions with JSON body', async () => {
    const session = { id: 's1', name: 'Test', status: 'created' };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(session, 201));

    const params = { name: 'Test', workflows: [{ templateId: 'code-generation' }] };
    const result = await client.createSession(params as any);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }),
    );
    expect(result).toEqual(session);
  });

  it('getSessions calls GET /api/sessions', async () => {
    const sessions = [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }];
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(sessions));

    const result = await client.getSessions();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/sessions',
      expect.objectContaining({ headers: {} }),
    );
    expect(result).toEqual(sessions);
  });

  it('getSession calls GET /api/sessions/:id', async () => {
    const session = { id: 's1', name: 'Test', workflows: [] };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(session));

    const result = await client.getSession('s1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/sessions/s1',
      expect.objectContaining({ headers: {} }),
    );
    expect(result).toEqual(session);
  });

  // ── Session Control ──

  it('startSession calls POST /api/sessions/:id/start', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(noContentResponse());

    await client.startSession('s1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/sessions/s1/start',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('pauseSession calls POST /api/sessions/:id/pause', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(noContentResponse());

    await client.pauseSession('s1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/sessions/s1/pause',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('resumeSession calls POST /api/sessions/:id/resume', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(noContentResponse());

    await client.resumeSession('s1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/sessions/s1/resume',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('cancelSession calls POST /api/sessions/:id/cancel', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(noContentResponse());

    await client.cancelSession('s1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/sessions/s1/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('deleteSession calls DELETE /api/sessions/:id', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(noContentResponse());

    await client.deleteSession('s1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/sessions/s1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  // ── Chat ──

  it('sendPrompt sends FormData with prompt field', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(noContentResponse());

    await client.sendPrompt('s1', 'Hello world');

    const call = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(call[0]).toBe('http://localhost:3000/api/sessions/s1/prompt');

    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');

    const formData = init.body as FormData;
    expect(formData.get('prompt')).toBe('Hello world');
  });

  it('sendPromptWithFiles sends FormData with attachments field name', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(noContentResponse());

    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    await client.sendPromptWithFiles('s1', 'Check this', [file]);

    const call = vi.mocked(globalThis.fetch).mock.calls[0]!;
    const init = call[1] as RequestInit;
    const formData = init.body as FormData;

    expect(formData.get('prompt')).toBe('Check this');
    // The field name should be 'attachments' (not 'files')
    const attachment = formData.get('attachments') as File;
    expect(attachment).toBeTruthy();
    expect(attachment.name).toBe('test.txt');
  });

  it('getChatHistory passes limit and offset as query params', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse([]));

    await client.getChatHistory('s1', 50, 10);

    const url = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
    expect(url).toContain('/api/sessions/s1/chat');
    expect(url).toContain('limit=50');
    expect(url).toContain('offset=10');
  });

  // ── Templates ──

  it('getWorkflowTemplates calls GET /api/templates', async () => {
    const templates = [{ id: 't1', name: 'Code Gen' }];
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(templates));

    const result = await client.getWorkflowTemplates();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/templates',
      expect.objectContaining({ headers: {} }),
    );
    expect(result).toEqual(templates);
  });

  // ── Artifacts ──

  it('getArtifacts calls correct endpoint', async () => {
    const artifacts = [{ id: 'a1', name: 'output.ts' }];
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(artifacts));

    const result = await client.getArtifacts('s1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/sessions/s1/artifacts',
      expect.objectContaining({ headers: {} }),
    );
    expect(result).toEqual(artifacts);
  });

  it('downloadArtifact returns Uint8Array data with mimeType and name', async () => {
    const blobContent = new Uint8Array([1, 2, 3]);
    const blob = new Blob([blobContent], { type: 'application/octet-stream' });

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="archive.zip"',
      }),
      blob: () => Promise.resolve(blob),
    } as unknown as Response);

    const result = await client.downloadArtifact('a1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/artifacts/a1/download',
      expect.objectContaining({}),
    );
    expect(result.mimeType).toBe('application/zip');
    expect(result.name).toBe('archive.zip');
    expect(result.data).toBeInstanceOf(Uint8Array);
  });

  // ── SSE (subscribeToEvents) ──

  // △ Fixed during end-to-end review — `subscribeToEvents` now opens (or
  // joins) the shared multiplexed connection from `muxStream.ts` (W26)
  // instead of constructing a plain single-scope `EventSource` directly.
  // These two tests still asserted the PRE-W26 URL shape
  // (`/api/stream?scope=session&id=s1`), which the mux client never
  // produces — the scope/id pair now travels in the `POST
  // /api/stream/connections` body, and the resulting `EventSource` is opened
  // against `/api/stream?c=<connectionId>&ticket=<ticket>`. Both tests also
  // need `fetch` mocked for that POST and `addEventListener` on the mock
  // `EventSource`, since the mux client wires `hello`/`subs`/`gap` control
  // frames through it immediately on connect.
  function mockConnectionsEndpoint(): void {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ connectionId: 'conn-1', ticket: 't', expiresAt: Date.now() + 30_000 }, 201),
    );
  }

  function makeMockEventSource(closeFn: () => void = vi.fn()) {
    return vi.fn().mockImplementation(() => ({
      onopen: null,
      onerror: null,
      onmessage: null,
      close: closeFn,
      readyState: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }

  it('subscribeToEvents creates EventSource and returns unsubscribe function', async () => {
    const closeFn = vi.fn();
    const MockEventSource = makeMockEventSource(closeFn);
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    mockConnectionsEndpoint();

    const handler = vi.fn();
    const unsubscribe = client.subscribeToEvents('s1', handler);

    // The connection is opened only after a stream ticket has been obtained,
    // so the EventSource appears on a later microtask.
    await vi.waitFor(() => expect(MockEventSource).toHaveBeenCalled());

    // The scope/id pair travels in the connection POST body, not the
    // EventSource URL — the URL only ever carries the opaque connection id.
    const connectBody = vi.mocked(globalThis.fetch).mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(connectBody.body as string)).toMatchObject({
      subs: [{ scope: 'session', id: 's1' }],
    });
    const url = MockEventSource.mock.calls[0]![0] as string;
    expect(url).toContain('/api/stream');
    expect(url).toContain('c=conn-1');
    expect(typeof unsubscribe).toBe('function');

    // Calling unsubscribe should close the EventSource (it is the last/only
    // subscriber, so the shared connection closes with it).
    unsubscribe();
    expect(closeFn).toHaveBeenCalled();
  });

  it('subscribeToEvents passes kindPrefixes as a filter on the subscription', async () => {
    const MockEventSource = makeMockEventSource();
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
    mockConnectionsEndpoint();

    const handler = vi.fn();
    client.subscribeToEvents('s1', handler, { kindPrefixes: ['copilot', 'session'] });

    await vi.waitFor(() => expect(MockEventSource).toHaveBeenCalled());

    // Filter travels as part of the subscription in the connection POST body,
    // not as a query param — there is no per-scope query string on a shared
    // multiplexed connection.
    const connectBody = vi.mocked(globalThis.fetch).mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(connectBody.body as string)).toMatchObject({
      subs: [{ scope: 'session', id: 's1', filter: ['copilot', 'session'] }],
    });
  });

  // ── Copilot-specific ──

  it('getModels calls GET /api/harness/models', async () => {
    const models = [{ id: 'gpt-4', name: 'GPT-4' }];
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(models));

    const result = await client.getModels();

    // The canonical catalog route. `/api/copilot/models` still works but is
    // deprecated — it never returned Copilot-only models anyway.
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/harness/models',
      expect.objectContaining({ headers: {} }),
    );
    expect(result).toEqual(models);
  });

  it('getCopilotState calls GET /api/copilot/state', async () => {
    const state = { state: 'ready' };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(state));

    const result = await client.getCopilotState();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/copilot/state',
      expect.objectContaining({ headers: {} }),
    );
    expect(result).toEqual(state);
  });

  // ── W48 — custom MCP servers now round-trip through the server instead of
  // only ever reaching the browser's localStorage (customMcpStore). ──

  it('createCustomMcpServer calls POST /api/system/mcp-servers/custom with the token, and the mocked response never echoes it back', async () => {
    // GET would redact it server-side; this pins the CLIENT sends what the
    // user typed (the vaulting itself is a server-side/db-package concern).
    const created = { id: 'custom-mcp-1', name: 'Jira', source: 'custom', hasCredentials: true };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(created, 201));

    const body = { name: 'Jira', serverType: 'http', url: 'https://jira/mcp', headers: { Authorization: 'Bearer live-token' } };
    const result = await client.createCustomMcpServer(body);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/system/mcp-servers/custom',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    // The RESPONSE (what a GET would also return) never carries the token.
    expect(JSON.stringify(result)).not.toContain('live-token');
  });

  it('updateCustomMcpServer calls PUT /api/system/mcp-servers/custom/:id', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(noContentResponse());
    const body = { name: 'Jira', serverType: 'http', url: 'https://jira/mcp', enabled: false };
    await client.updateCustomMcpServer('custom-mcp-1', body);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/system/mcp-servers/custom/custom-mcp-1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(body) }),
    );
  });

  it('deleteCustomMcpServer calls DELETE /api/system/mcp-servers/custom/:id', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(noContentResponse());
    await client.deleteCustomMcpServer('custom-mcp-1');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/system/mcp-servers/custom/custom-mcp-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('updateSystemMcpServerPrefs calls PUT /api/system/mcp-servers/system/:id', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(noContentResponse());
    const data = { enabled: true, inputs: { allowedDirectory: 'D:/work' } };
    await client.updateSystemMcpServerPrefs('system-mcp-filesystem', data);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/system/mcp-servers/system/system-mcp-filesystem',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(data) }),
    );
  });
});
