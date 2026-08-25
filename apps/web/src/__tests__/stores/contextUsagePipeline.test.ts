// ────────────────────────────────────────────────────────────────
// Context-usage pipeline tests — SSE event → stream store.
//
// Covers the wiring the unit tests can't: that a `harness.context_usage`
// event actually lands in the store with the right shape, that sub-agent
// snapshots are ignored, and that the value is allowed to fall after
// compaction (a max() or provider-wins rule would freeze it).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectChatSession, disconnectAll, _resetForTests } from '@/stores/sseManager.js';
import { useStreamStore } from '@/stores/streamStore.js';
import { useConnectionStore } from '@/stores/connectionStore.js';
import { __setAllowUnauthenticatedForTests } from '@/platform/authRuntime.js';
import { resetMuxStreamForTests } from '@/platform/muxStream.js';

// The SSE manager now mints a stream ticket before opening a connection. These
// tests are about event plumbing, not auth, so the runtime is put into the
// same no-credential-required mode a dev loopback server produces — no ticket
// is requested and the mock EventSource is created immediately.
__setAllowUnauthenticatedForTests(true);

// ── Minimal EventSource mock that lets tests push events ──
const live: MockEventSource[] = [];

class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;

  url: string;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private listeners = new Map<string, Array<(ev: Event) => void>>();

  constructor(url: string) {
    this.url = url;
    live.push(this);
    queueMicrotask(() => {
      if (this.readyState !== MockEventSource.CLOSED) {
        this.readyState = MockEventSource.OPEN;
        this.onopen?.({} as Event);
      }
    });
  }
  close() { this.readyState = MockEventSource.CLOSED; }
  addEventListener(type: string, fn: (ev: Event) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener() {}
  dispatchEvent() { return false; }

  /** Named control frame — `hello`, `subs`, `gap`. */
  control(type: string, data: Record<string, unknown>) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ data: JSON.stringify(data) } as MessageEvent as Event);
    }
  }

  push(kind: string, data: Record<string, unknown>, sessionId: string, seq: number, eventId: number) {
    // W09-a wire frame: `s` routes, `q` is the per-scope cursor, `e` is the
    // global event id the client dedups on.
    this.onmessage?.({
      data: JSON.stringify({
        s: `chat:${CHAT}`,
        q: seq,
        e: eventId,
        k: kind,
        p: { ...data, sessionId },
      }),
    } as MessageEvent);
  }
}

function mockPlatform() {
  return {
    baseUrl: 'http://localhost:3000',
    streamReplay: vi.fn(async () => []),
  } as unknown as Parameters<typeof connectChatSession>[2];
}

const CHAT = 'chat-1';
const SESSION = 'session-1';

const originalES = (globalThis as unknown as { EventSource?: unknown }).EventSource;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;
  // The multiplexed connection is created by a POST before the EventSource is
  // opened — the resume vector is a map and cannot ride on a bodyless GET.
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/stream/connections')) {
      return {
        ok: true,
        status: 201,
        json: async () => ({ connectionId: 'conn-1', ticket: 't' }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as typeof globalThis.fetch;
  live.length = 0;
  resetMuxStreamForTests();
  _resetForTests();
  useStreamStore.setState({ streams: {} });
  useConnectionStore.setState({ connections: {} });
});

afterEach(() => {
  disconnectAll();
  resetMuxStreamForTests();
  globalThis.fetch = originalFetch;
  if (originalES !== undefined) {
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalES;
  }
});

/** Connect and return the live socket plus a helper to read the snapshot. */
async function connect() {
  connectChatSession(CHAT, SESSION, mockPlatform());
  await vi.waitFor(() => expect(live.length).toBeGreaterThan(0));
  await new Promise((r) => setTimeout(r, 60));
  const es = live[live.length - 1]!;
  es.control('hello', {
    connectionId: 'conn-1',
    active: [`chat:${CHAT}`],
    resumed: { [`chat:${CHAT}`]: true },
  });
  // The store only records onto an existing stream, so make one.
  useStreamStore.getState().startPending(SESSION, 'hi');
  let seq = 0;
  let eventId = 1000;
  return {
    es: {
      push: (k: string, d: Record<string, unknown>) => es.push(k, d, SESSION, ++seq, ++eventId),
    },
    snapshot: () => useStreamStore.getState().streams[SESSION]?.contextUsage ?? null,
  };
}

describe('harness.context_usage → stream store', () => {
  it('records a Copilot provider snapshot with its breakdown', async () => {
    const { es, snapshot } = await connect();
    es.push('harness.context_usage', {
      provider: 'copilot',
      source: 'provider',
      currentTokens: 22_027,
      promptTokenLimit: 200_000,
      messagesLength: 5,
      breakdown: { system: 9_612, tools: 12_250, conversation: 165 },
    });

    const s = snapshot();
    expect(s?.currentTokens).toBe(22_027);
    expect(s?.promptTokenLimit).toBe(200_000);
    expect(s?.source).toBe('provider');
    expect(s?.breakdown?.system).toBe(9_612);
    // The parts must account for the whole, or the popover lies.
    const sum = (s!.breakdown!.system ?? 0) + (s!.breakdown!.tools ?? 0) + (s!.breakdown!.conversation ?? 0);
    expect(sum).toBe(s!.currentTokens);
  });

  it('records a Claude provider snapshot with its richer breakdown', async () => {
    const { es, snapshot } = await connect();
    es.push('harness.context_usage', {
      provider: 'claude-agent',
      source: 'provider',
      model: 'claude-sonnet-4-6',
      currentTokens: 48_500,
      promptTokenLimit: 136_000,
      totalContextWindow: 200_000,
      compactionThreshold: 122_400,
      breakdown: {
        system: 4_000, tools: 11_000, mcpTools: 2_500, memoryFiles: 1_000,
        conversation: 30_000, toolCalls: 8_000, toolResults: 18_000,
        userMessages: 2_000, assistantMessages: 2_000, attachments: 0,
      },
      apiUsage: { input: 100, output: 60, cacheRead: 40_000, cacheWrite: 8_400 },
    });

    const s = snapshot();
    expect(s?.source).toBe('provider');
    expect(s?.currentTokens).toBe(48_500);
    expect(s?.promptTokenLimit).toBe(136_000);
    expect(s?.compactionThreshold).toBe(122_400);
    expect(s?.breakdown?.mcpTools).toBe(2_500);
    expect(s?.apiUsage?.cacheRead).toBe(40_000);
  });

  it('ignores sub-agent snapshots so the main gauge is not hijacked', async () => {
    const { es, snapshot } = await connect();
    es.push('harness.context_usage', {
      provider: 'copilot', source: 'provider', currentTokens: 50_000, promptTokenLimit: 200_000,
    });
    es.push('harness.context_usage', {
      provider: 'copilot', source: 'provider', currentTokens: 900, promptTokenLimit: 200_000,
      agentId: 'sub-agent-7',
    });

    // The sub-agent's much smaller window must not replace the main one.
    expect(snapshot()?.currentTokens).toBe(50_000);
  });

  it('lets the value fall after compaction', async () => {
    const { es, snapshot } = await connect();
    es.push('harness.context_usage', {
      provider: 'copilot', source: 'provider', currentTokens: 180_000, promptTokenLimit: 200_000,
    });
    expect(snapshot()?.currentTokens).toBe(180_000);

    es.push('harness.context_usage', {
      provider: 'copilot', source: 'provider', currentTokens: 21_000, promptTokenLimit: 200_000,
    });
    expect(snapshot()?.currentTokens).toBe(21_000);
  });

  it('lets a derived estimate stand in when the provider call fails', async () => {
    const { es, snapshot } = await connect();
    // Turn 1: provider answered.
    es.push('harness.context_usage', {
      provider: 'claude-agent', source: 'provider', currentTokens: 40_000, promptTokenLimit: 136_000,
    });
    // Turn 2: getContextUsage() failed, only the derived estimate arrives.
    es.push('harness.context_usage', {
      provider: 'claude-agent', source: 'derived', currentTokens: 61_000, promptTokenLimit: 136_000,
    });

    // Freezing on the stale provider value would under-report the window.
    expect(snapshot()?.currentTokens).toBe(61_000);
    expect(snapshot()?.source).toBe('derived');
  });

  it('rejects a malformed snapshot rather than rendering NaN', async () => {
    const { es, snapshot } = await connect();
    es.push('harness.context_usage', {
      provider: 'copilot', source: 'provider', currentTokens: 'lots', promptTokenLimit: 200_000,
    } as unknown as Record<string, unknown>);
    expect(snapshot()).toBeNull();
  });

  it('survives a turn boundary so the gauge does not blink to empty', async () => {
    const { es, snapshot } = await connect();
    es.push('harness.context_usage', {
      provider: 'copilot', source: 'provider', currentTokens: 22_000, promptTokenLimit: 200_000,
    });

    useStreamStore.getState().clearStream(SESSION);
    expect(snapshot()?.currentTokens).toBe(22_000);
  });
});
