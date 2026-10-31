// ────────────────────────────────────────────────────────────────
// useTextToSpeech (web) — Phase 3+4 review flagged this hook as having NO
// test coverage at all, and found two real races through that gap: a
// stale delayed-teardown timer that could cut off a LATER utterance (this
// file's own instance or a different AssistantMessage's), and no
// coordination between two AssistantMessage instances' independent hooks
// letting them both speak at once. Both are regression-tested below.
//
// WebSocket/AudioContext are stubbed rather than left to happy-dom's own
// (network-attempting, audio-less) implementations — see the mocks below.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTextToSpeech } from '@/hooks/useTextToSpeech.js';

vi.mock('@/platform/authTransport.js', () => ({
  buildAuthenticatedSocketUrl: vi.fn().mockResolvedValue('ws://mock/api/tts/stream'),
}));

class MockAudioContext {
  currentTime = 0;
  destination = {};
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, copyToChannel: vi.fn() };
  }
  createBufferSource() {
    return { buffer: null, connect: vi.fn(), start: vi.fn() };
  }
  close = vi.fn().mockResolvedValue(undefined);
}

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly CONNECTING = MockWebSocket.CONNECTING;
  readonly OPEN = MockWebSocket.OPEN;
  readonly CLOSING = MockWebSocket.CLOSING;
  readonly CLOSED = MockWebSocket.CLOSED;

  readyState = MockWebSocket.CONNECTING;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: unknown[] = [];
  closeCalls = 0;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.closeCalls += 1;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  /** Test helper — simulate the connection actually opening. */
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  /** Test helper — simulate a server frame (string control frame or binary PCM chunk). */
  emit(data: unknown): void {
    this.onmessage?.({ data });
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('AudioContext', MockAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Flush the microtask queue (e.g. the mocked `buildAuthenticatedSocketUrl()` await) inside `act()`. */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useTextToSpeech (web)', () => {
  it('reports supported and plays back a synthesized utterance end to end', async () => {
    const { result } = renderHook(() => useTextToSpeech());
    expect(result.current.isSupported).toBe(true);

    let speakPromise!: Promise<void>;
    act(() => {
      speakPromise = result.current.speak('hello world');
    });
    await flushMicrotasks();

    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toContain('/api/tts/stream');
    act(() => ws.open());
    expect(ws.sent[0]).toBe(JSON.stringify({ t: 'speak', text: 'hello world' }));

    act(() => ws.emit(JSON.stringify({ t: 'ready', sampleRate: 24_000 })));
    act(() => ws.emit(new Float32Array(2_400).buffer)); // 0.1s of audio at 24kHz
    expect(result.current.status).toBe('speaking');

    act(() => ws.emit(JSON.stringify({ t: 'done' })));
    await act(async () => {
      await speakPromise;
    });

    expect(result.current.status).toBe('idle');
    expect(ws.closeCalls).toBe(1);
  });

  it('stop() sends {t:"stop"} and tears down immediately', async () => {
    const { result } = renderHook(() => useTextToSpeech());
    act(() => {
      void result.current.speak('hello');
    });
    await flushMicrotasks();
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());

    act(() => result.current.stop());

    expect(ws.sent).toContain(JSON.stringify({ t: 'stop' }));
    expect(ws.closeCalls).toBe(1);
    expect(result.current.status).toBe('idle');
  });

  // Phase 3+4 review finding: the 'done' handler's delayed teardown
  // (`setTimeout(..., remainingMs)`) never stored its timer id, so it could
  // never be cancelled — a still-pending timer from a FINISHED utterance
  // could fire mid-playback of the NEXT one and tear it down out of nowhere.
  it('a stale delayed teardown from a finished utterance does not cut off a new utterance started before it fired', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTextToSpeech());

    // Utterance A: gets far enough to schedule a delayed ~1s teardown.
    act(() => {
      void result.current.speak('utterance A');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const wsA = MockWebSocket.instances[0]!;
    act(() => wsA.open());
    act(() => wsA.emit(JSON.stringify({ t: 'ready', sampleRate: 24_000 })));
    act(() => wsA.emit(new Float32Array(24_000).buffer)); // 1s of scheduled audio
    act(() => wsA.emit(JSON.stringify({ t: 'done' }))); // schedules the ~1s delayed teardown

    // Utterance B starts before that timer fires — its own speak() call
    // synchronously tears down / cancels whatever A left pending.
    act(() => {
      void result.current.speak('utterance B');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const wsB = MockWebSocket.instances[1]!;
    expect(wsB).not.toBe(wsA);
    act(() => wsB.open());
    const wsBCloseCallsBefore = wsB.closeCalls;

    // Advance well past when A's stale timer would have fired.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    // B must be untouched by A's leftover timer.
    expect(wsB.closeCalls).toBe(wsBCloseCallsBefore);
    expect(wsB.readyState).not.toBe(MockWebSocket.CLOSED);
  });

  // Phase 3+4 review finding: each AssistantMessage owns its own
  // useTextToSpeech() instance with zero shared state, so clicking "Read
  // aloud" on message B while message A was still speaking left A running
  // untouched — both played back at once.
  it('starting speak() on a DIFFERENT hook instance barges over one that is still speaking', async () => {
    const a = renderHook(() => useTextToSpeech());
    const b = renderHook(() => useTextToSpeech());

    act(() => {
      void a.result.current.speak('hello from A');
    });
    await flushMicrotasks();
    const wsA = MockWebSocket.instances[0]!;
    act(() => wsA.open());
    expect(wsA.closeCalls).toBe(0);

    act(() => {
      void b.result.current.speak('hello from B');
    });
    await flushMicrotasks();

    // A's own connection was barged over by B's speak(), not left running.
    expect(wsA.closeCalls).toBeGreaterThan(0);
  });

  it('does not barge over itself when a DIFFERENT instance never spoke', async () => {
    // Guards against a too-eager fix that clears/stops based on identity
    // alone without checking whether anything else is actually active.
    const { result } = renderHook(() => useTextToSpeech());
    act(() => {
      void result.current.speak('only speaker');
    });
    await flushMicrotasks();
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());

    expect(ws.closeCalls).toBe(0);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  // ── Phase 4: speak-while-streaming ──────────────────────────────

  it('speakStream() opens the same socket but sends the live speak_stream frame', async () => {
    const { result } = renderHook(() => useTextToSpeech());

    let streamPromise!: Promise<void>;
    act(() => {
      streamPromise = result.current.speakStream('sess-42');
    });
    await flushMicrotasks();

    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toContain('/api/tts/stream');
    act(() => ws.open());
    // `sessionId`, NOT the chat id — the server subscribes to the EventBus
    // channel harness events are actually emitted on.
    expect(ws.sent[0]).toBe(JSON.stringify({ t: 'speak_stream', sessionId: 'sess-42' }));

    act(() => ws.emit(JSON.stringify({ t: 'ready', sampleRate: 24_000 })));
    act(() => ws.emit(new Float32Array(2_400).buffer));
    expect(result.current.status).toBe('speaking');

    act(() => ws.emit(JSON.stringify({ t: 'done' })));
    await act(async () => {
      await streamPromise;
    });
    expect(result.current.status).toBe('idle');
  });

  it('speakStream() is a no-op for an empty sessionId, and never opens a socket', async () => {
    const { result } = renderHook(() => useTextToSpeech());

    await act(async () => {
      await result.current.speakStream('');
    });

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(result.current.status).toBe('idle');
  });

  it('speakStream() barges over an in-flight speak() — one pair of speakers', async () => {
    const a = renderHook(() => useTextToSpeech());
    act(() => {
      void a.result.current.speak('finished message');
    });
    await flushMicrotasks();
    const wsA = MockWebSocket.instances[0]!;
    act(() => wsA.open());

    const b = renderHook(() => useTextToSpeech());
    act(() => {
      void b.result.current.speakStream('sess-1');
    });
    await flushMicrotasks();

    expect(wsA.closeCalls).toBeGreaterThan(0);
  });

  it('stop() during a live stream sends {t:"stop"} so the server drops its EventBus subscription', async () => {
    const { result } = renderHook(() => useTextToSpeech());
    act(() => {
      void result.current.speakStream('sess-9');
    });
    await flushMicrotasks();
    const ws = MockWebSocket.instances[0]!;
    act(() => ws.open());

    act(() => result.current.stop());

    expect(ws.sent).toContain(JSON.stringify({ t: 'stop' }));
    expect(result.current.status).toBe('idle');
  });
});
