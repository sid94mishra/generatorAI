// ────────────────────────────────────────────────────────────────
// W09-a / W26 — mobile is on the multiplexed transport, and has a `global`
// subscription.
//
// Two separate regressions are pinned here:
//
//   1. Mobile opened `GET /api/stream?scope=chat&id=…` per scope. Against the
//      old `SseClient` the first two tests fail outright — there was no
//      `/api/stream/connections` call to observe, and a second scope meant a
//      second socket.
//   2. Mobile subscribed ONLY `chat`. There was no `global` scope anywhere in
//      `apps/mobile`, so list screens had no live lifecycle events. The
//      routing tests below are the mapping that closed it.
//
// The vitest environment here is node with no React Native (see
// `vitest.config.ts`), so this drives `MuxStreamClient` through the same
// factory the app uses, with the streaming fetch injected.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';

import {
  createMobileMuxClient,
  GLOBAL_SCOPE_FILTER,
  GLOBAL_SCOPE_ID,
  invalidateListKeys,
  listKeysForEvent,
} from '../stream/muxTransport';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

/** The three endpoints the mux client talks to, with every call recorded. */
function fakeServer() {
  const controlCalls: Array<{ path: string; init?: RequestInit }> = [];
  const streamUrls: string[] = [];

  const authedFetch = vi.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    controlCalls.push({ path, init });
    if (path === '/api/stream/connections' && init?.method === 'POST') {
      return new Response(JSON.stringify({ connectionId: 'c1', ticket: 'tkt-1' }), { status: 201 });
    }
    if (/\/subs$/.test(path)) return new Response('{}', { status: 202 });
    return new Response('not found', { status: 404 });
  });

  const streamFetch = vi.fn(async (url: string): Promise<Response> => {
    streamUrls.push(url);
    return new Response(new ReadableStream<Uint8Array>({ start: () => {} }), { status: 200 });
  });

  return { authedFetch, streamFetch, controlCalls, streamUrls };
}

describe('mobile → multiplexed transport', () => {
  it('opens ONE connection for the chat and global scopes together', async () => {
    const server = fakeServer();
    const client = createMobileMuxClient({
      fetch: server.authedFetch,
      endpoint: 'https://host.example:3100',
      streamFetch: server.streamFetch,
    });

    client.subscribe('chat', 'chat-1', () => {});
    client.subscribe('global', GLOBAL_SCOPE_ID, () => {}, { filter: [...GLOBAL_SCOPE_FILTER] });
    await flush();

    const connects = server.controlCalls.filter((c) => c.path === '/api/stream/connections');
    expect(connects).toHaveLength(1);
    // …and both scopes are on it. The old transport could not express this at
    // all: a second scope was a second socket, which is why `global` was
    // simply never subscribed.
    const subs = (JSON.parse(String(connects[0]?.init?.body)) as { subs: unknown[] }).subs;
    expect(subs).toEqual(
      expect.arrayContaining([
        { scope: 'chat', id: 'chat-1' },
        { scope: 'global', id: GLOBAL_SCOPE_ID, filter: [...GLOBAL_SCOPE_FILTER].sort() },
      ]),
    );
    expect(server.streamUrls).toHaveLength(1);
    client.disposeAll();
  });

  it('attaches with an absolute url and the connection ticket', async () => {
    // RN's authenticated fetch cannot stream a body, so the attach runs on
    // expo/fetch and is authorised by the ticket instead of a DPoP header.
    const server = fakeServer();
    const client = createMobileMuxClient({
      fetch: server.authedFetch,
      endpoint: 'https://host.example:3100',
      streamFetch: server.streamFetch,
    });
    client.subscribe('chat', 'chat-1', () => {});
    await flush();

    expect(server.streamUrls[0]).toBe('https://host.example:3100/api/stream?c=c1&ticket=tkt-1');
    // The attach must NOT have gone through the authenticated fetch, which is
    // the one that cannot produce a readable body on this platform.
    expect(server.controlCalls.some((c) => c.path.startsWith('/api/stream?'))).toBe(false);
    client.disposeAll();
  });

  it('delivers a chat frame to the chat scope only', async () => {
    const server = fakeServer();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    server.streamFetch.mockImplementation(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start: (c) => {
            controller = c;
          },
        }),
        { status: 200 },
      ),
    );

    const client = createMobileMuxClient({
      fetch: server.authedFetch,
      endpoint: 'http://h:1',
      streamFetch: server.streamFetch,
    });
    const chatEvents: string[] = [];
    const globalEvents: string[] = [];
    client.subscribe('chat', 'chat-1', (e) => chatEvents.push(e.kind));
    client.subscribe('global', GLOBAL_SCOPE_ID, (e) => globalEvents.push(e.kind));
    await flush();

    const encoder = new TextEncoder();
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({ s: 'chat:chat-1', q: 1, e: 1, k: 'harness.token', p: { text: 'hi' } })}\n\n`,
      ),
    );
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({ s: `global:${GLOBAL_SCOPE_ID}`, q: 1, e: 2, k: 'chat.created', p: {} })}\n\n`,
      ),
    );
    await flush();

    expect(chatEvents).toEqual(['harness.token']);
    expect(globalEvents).toEqual(['chat.created']);
    client.disposeAll();
  });
});

describe('global scope → list invalidation', () => {
  it('maps each lifecycle family to the list it invalidates', () => {
    expect(listKeysForEvent('chat.created')).toEqual([['chats']]);
    expect(listKeysForEvent('chat.archived')).toEqual([['chats']]);
    expect(listKeysForEvent('workflow_run.completed')).toEqual([['runs'], ['workflows']]);
    expect(listKeysForEvent('automation_execution.failed')).toEqual([['automations']]);
  });

  it('ignores anything that is not a lifecycle event', () => {
    // The global scope must never become a firehose: a token event reaching
    // it would invalidate a list once per streamed character.
    expect(listKeysForEvent('harness.token')).toEqual([]);
    expect(listKeysForEvent('stage_run.running')).toEqual([]);
  });

  it('de-duplicates a burst into one refetch per list', () => {
    const invalidateQueries = vi.fn();
    const batch = new Set<string>();
    for (const kind of ['chat.created', 'chat.archived', 'chat.deleted']) {
      for (const key of listKeysForEvent(kind)) batch.add(JSON.stringify(key));
    }
    invalidateListKeys({ invalidateQueries }, batch);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['chats'] });
  });
});
