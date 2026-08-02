// ────────────────────────────────────────────────────────────────
// sseManager tests — STR-04 / per-scope EventSource architecture
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  connectChatSession,
  disconnectChatSession,
  connectWorkflowRun,
  disconnectWorkflowRun,
  disconnectAll,
  _resetForTests,
  _getConnectionCount,
  _getRefCount,
} from '@/stores/sseManager.js';
import { useStreamStore } from '@/stores/streamStore.js';
import { useConnectionStore } from '@/stores/connectionStore.js';

// ── EventSource mock ──
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;

  url: string;
  readyState: number;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    this.readyState = MockEventSource.CONNECTING;
    queueMicrotask(() => {
      if (this.readyState !== MockEventSource.CLOSED) {
        this.readyState = MockEventSource.OPEN;
        this.onopen?.({} as Event);
      }
    });
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return false; }
}

const originalEventSource = (globalThis as unknown as { EventSource?: unknown }).EventSource;
beforeEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;
});
afterEach(() => {
  if (originalEventSource !== undefined) {
    (globalThis as unknown as { EventSource?: unknown }).EventSource = originalEventSource;
  } else {
    delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  }
});

function createMockPlatform() {
  return {
    baseUrl: 'http://localhost:3000',
    streamReplay: vi.fn(async () => []),
  } as unknown as Parameters<typeof connectChatSession>[2];
}

describe('sseManager (STR-04 per-scope EventSource)', () => {
  beforeEach(() => {
    _resetForTests();
    useStreamStore.setState({ streams: {} });
    useConnectionStore.setState({ connections: {} });
  });

  it('opens a chat subscription keyed by chatId', () => {
    const platform = createMockPlatform();
    connectChatSession('chat-1', 'session-a', platform);
    expect(_getConnectionCount()).toBe(1);
    expect(_getRefCount('chat', 'chat-1')).toBe(1);
  });

  it('refcounts duplicate chat connections without re-opening EventSource', () => {
    const platform = createMockPlatform();
    connectChatSession('chat-1', 'session-a', platform);
    connectChatSession('chat-1', 'session-a', platform);
    expect(_getConnectionCount()).toBe(1);
    expect(_getRefCount('chat', 'chat-1')).toBe(2);
  });

  it('decrements refCount on disconnect without closing until zero', () => {
    const platform = createMockPlatform();
    connectChatSession('chat-1', 'session-a', platform);
    connectChatSession('chat-1', 'session-a', platform);
    disconnectChatSession('chat-1');
    expect(_getRefCount('chat', 'chat-1')).toBe(1);
    expect(_getConnectionCount()).toBe(1);
  });

  it('closes the subscription when refCount reaches zero', () => {
    const platform = createMockPlatform();
    connectChatSession('chat-1', 'session-a', platform);
    disconnectChatSession('chat-1');
    expect(_getConnectionCount()).toBe(0);
  });

  it('returns a disconnect function', () => {
    const platform = createMockPlatform();
    const disconnect = connectChatSession('chat-1', 'session-a', platform);
    expect(typeof disconnect).toBe('function');
    disconnect();
    expect(_getConnectionCount()).toBe(0);
  });

  it('isolates chat and run scopes independently', () => {
    const platform = createMockPlatform();
    connectChatSession('chat-1', 'session-a', platform);
    connectWorkflowRun('run-1', platform);
    expect(_getConnectionCount()).toBe(2);
    disconnectChatSession('chat-1');
    expect(_getConnectionCount()).toBe(1);
    expect(_getRefCount('run', 'run-1')).toBe(1);
  });

  it('calls platform.streamReplay on first connect', async () => {
    const platform = createMockPlatform();
    connectChatSession('chat-1', 'session-a', platform);
    await vi.waitFor(() => {
      expect((platform as unknown as { streamReplay: ReturnType<typeof vi.fn> }).streamReplay)
        .toHaveBeenCalledWith('chat', 'chat-1', 0, 500);
    });
  });

  it('does not replay again for duplicate connections', async () => {
    const platform = createMockPlatform();
    connectChatSession('chat-1', 'session-a', platform);
    await vi.waitFor(() => {
      expect((platform as unknown as { streamReplay: ReturnType<typeof vi.fn> }).streamReplay)
        .toHaveBeenCalledTimes(1);
    });
    connectChatSession('chat-1', 'session-a', platform);
    expect((platform as unknown as { streamReplay: ReturnType<typeof vi.fn> }).streamReplay)
      .toHaveBeenCalledTimes(1);
  });

  it('opens one EventSource per workflow run scope', () => {
    const platform = createMockPlatform();
    connectWorkflowRun('run-1', platform);
    connectWorkflowRun('run-2', platform);
    expect(_getConnectionCount()).toBe(2);
    expect(_getRefCount('run', 'run-1')).toBe(1);
    expect(_getRefCount('run', 'run-2')).toBe(1);
  });

  it('disconnecting a non-existent subscription is a no-op', () => {
    disconnectChatSession('non-existent');
    disconnectWorkflowRun('non-existent');
    expect(_getConnectionCount()).toBe(0);
  });

  it('disconnectAll tears down everything', () => {
    const platform = createMockPlatform();
    connectChatSession('chat-1', 'session-a', platform);
    connectChatSession('chat-2', 'session-b', platform);
    connectWorkflowRun('run-1', platform);
    expect(_getConnectionCount()).toBe(3);
    disconnectAll();
    expect(_getConnectionCount()).toBe(0);
  });

  it('_resetForTests clears all connections', () => {
    const platform = createMockPlatform();
    connectChatSession('chat-1', 'session-a', platform);
    connectWorkflowRun('run-1', platform);
    expect(_getConnectionCount()).toBe(2);
    _resetForTests();
    expect(_getConnectionCount()).toBe(0);
  });
});
