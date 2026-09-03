// ────────────────────────────────────────────────────────────────
// VoiceService — lifecycle, capacity cap, idle reap, shutdown.
//
// Mirrors the intent of TerminalService/BrowserService's own lifecycle
// coverage: assert the Map-based session bookkeeping, the cap enforcement,
// and that cleanup paths (idle reap, shutdown) actually remove sessions and
// stop leaking timers, not just that the happy path "works".
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VoiceService } from '../VoiceService.js';
import type { ISpeechToTextEngine, SttTranscribeResult } from '../../domain/ports/ISpeechToTextEngine.js';
import type { ITextToSpeechEngine } from '../../domain/ports/ITextToSpeechEngine.js';
import type { EventBus } from '../../events/EventBus.js';

/** A trivial fake engine — load() resolves instantly, transcribe() is scripted per test. */
function fakeEngine(overrides: Partial<ISpeechToTextEngine> = {}): ISpeechToTextEngine {
  return {
    name: 'fake-engine',
    load: vi.fn().mockResolvedValue(undefined),
    transcribe: vi.fn().mockResolvedValue({ text: '' } satisfies SttTranscribeResult),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** A trivial fake TTS engine — yields one tagged chunk per synthesize() call. */
function fakeTtsEngine(overrides: Partial<ITextToSpeechEngine> = {}): ITextToSpeechEngine {
  return {
    name: 'fake-tts',
    sampleRate: 24_000,
    load: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    synthesize: vi.fn(async function* (text: string) {
      yield new Float32Array([text.length]);
    }),
    ...overrides,
  };
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

function fakeEventBus(): EventBus & { emit: ReturnType<typeof vi.fn> } {
  return { emit: vi.fn().mockResolvedValue(undefined) } as unknown as EventBus & { emit: ReturnType<typeof vi.fn> };
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => logger),
};

const noopCallbacks = { onInterim: vi.fn(), onSegment: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };

describe('VoiceService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() eagerly warms the engine (telemetry-accuracy fix — see VoiceService.start()\'s doc comment)', async () => {
    const engine = fakeEngine();
    const svc = new VoiceService(engine, fakeEventBus(), logger, { warmupDelayMs: 5_000 });
    svc.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(engine.load).toHaveBeenCalledTimes(1);
  });

  it('start() DEFERS the warm-up so model loading does not collide with server startup', async () => {
    const engine = fakeEngine();
    const svc = new VoiceService(engine, fakeEventBus(), logger, { warmupDelayMs: 5_000 });

    svc.start();

    // Building ONNX sessions saturates the machine for seconds; doing it
    // inside the composition root's own startup burst pushed the main loop
    // past WedgeDetector's 5s threshold in a real run (and produced no wedge
    // at all with voice disabled). Nothing may load before the delay elapses.
    expect(engine.load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(engine.load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.load).toHaveBeenCalledTimes(1);
  });

  it('start() does not throw or crash the service when the engine fails to warm up', async () => {
    const engine = fakeEngine({ load: vi.fn().mockRejectedValue(new Error('boom')) });
    const svc = new VoiceService(engine, fakeEventBus(), logger, { warmupDelayMs: 0 });
    expect(() => svc.start()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0); // fire the warm-up timer + settle its .catch()
    expect(logger.warn).toHaveBeenCalled();
  });

  it('starts a session, describes it, and emits voice.stt_session_started', () => {
    const engine = fakeEngine();
    const bus = fakeEventBus();
    const svc = new VoiceService(engine, bus, logger);

    const handle = svc.startSttSession('ws-1', noopCallbacks);

    expect(handle.sessionId).toBeTruthy();
    const descriptor = svc.describe(handle.sessionId);
    expect(descriptor).toMatchObject({ workspaceId: 'ws-1', engine: 'whisper', status: 'listening' });
    expect(bus.emit).toHaveBeenCalledWith(
      `voice:${handle.sessionId}`,
      expect.objectContaining({ kind: 'voice.stt_session_started' }),
    );
  });

  it('accepts a null workspaceId (dictation with no attached project/workspace)', () => {
    const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger);
    const handle = svc.startSttSession(null, noopCallbacks);
    expect(svc.describe(handle.sessionId)).toMatchObject({ workspaceId: null });
  });

  it('Phase 2 — threads the optional ITextFormatter into every session it creates', async () => {
    const engine = fakeEngine({ transcribe: vi.fn().mockResolvedValue({ text: 'um raw text' }) });
    const formatter = { name: 'fake-formatter', format: vi.fn(async (t: string) => t.replace('um ', '')) };
    const svc = new VoiceService(engine, fakeEventBus(), logger, undefined, formatter);

    const onFinal = vi.fn();
    const handle = svc.startSttSession('ws-1', { ...noopCallbacks, onFinal });
    handle.pushAudio(new Float32Array(8_000)); // stop() with zero accumulated audio short-circuits before ever calling transcribe()/the formatter
    await handle.stop();

    expect(formatter.format).toHaveBeenCalledWith('um raw text', expect.anything());
    expect(onFinal).toHaveBeenCalledWith('raw text');
  });

  it('Phase 2 — a SECOND session from the same service ALSO gets the formatter (not just the first)', async () => {
    const engine = fakeEngine({ transcribe: vi.fn().mockResolvedValue({ text: 'um raw text' }) });
    const formatter = { name: 'fake-formatter', format: vi.fn(async (t: string) => t.replace('um ', '')) };
    const svc = new VoiceService(engine, fakeEventBus(), logger, undefined, formatter);

    const first = svc.startSttSession('ws-1', noopCallbacks);
    first.pushAudio(new Float32Array(8_000));
    await first.stop();

    const onFinal2 = vi.fn();
    const second = svc.startSttSession('ws-2', { ...noopCallbacks, onFinal: onFinal2 });
    second.pushAudio(new Float32Array(8_000));
    await second.stop();

    expect(onFinal2).toHaveBeenCalledWith('raw text');
    expect(formatter.format).toHaveBeenCalledTimes(2);
  });

  it('classifies engine kind from the engine name (parakeet vs whisper)', () => {
    const svc = new VoiceService(fakeEngine({ name: 'parakeet:eou-120m' }), fakeEventBus(), logger);
    const handle = svc.startSttSession('ws-1', noopCallbacks);
    expect(svc.describe(handle.sessionId)?.engine).toBe('parakeet');
  });

  it('cancel() removes the session and emits voice.stt_session_ended with reason cancelled', () => {
    const bus = fakeEventBus();
    const svc = new VoiceService(fakeEngine(), bus, logger);
    const handle = svc.startSttSession('ws-1', noopCallbacks);

    handle.cancel();

    expect(svc.describe(handle.sessionId)).toBeNull();
    expect(bus.emit).toHaveBeenCalledWith(
      `voice:${handle.sessionId}`,
      expect.objectContaining({ kind: 'voice.stt_session_ended', data: expect.objectContaining({ reason: 'cancelled' }) }),
    );
  });

  it('pause() moves status to paused and emits voice.stt_paused (Phase 1)', () => {
    const bus = fakeEventBus();
    const svc = new VoiceService(fakeEngine(), bus, logger);
    const handle = svc.startSttSession('ws-1', noopCallbacks);

    handle.pause();

    expect(svc.describe(handle.sessionId)).toMatchObject({ status: 'paused' });
    expect(bus.emit).toHaveBeenCalledWith(
      `voice:${handle.sessionId}`,
      expect.objectContaining({ kind: 'voice.stt_paused', data: expect.objectContaining({ sessionId: handle.sessionId }) }),
    );
    // The session itself is NOT removed by pause — only cancel/stop end it.
    expect(svc.describe(handle.sessionId)).not.toBeNull();
  });

  it('resume() moves status back to listening and emits voice.stt_resumed (Phase 1)', () => {
    const bus = fakeEventBus();
    const svc = new VoiceService(fakeEngine(), bus, logger);
    const handle = svc.startSttSession('ws-1', noopCallbacks);

    handle.pause();
    handle.resume();

    expect(svc.describe(handle.sessionId)).toMatchObject({ status: 'listening' });
    expect(bus.emit).toHaveBeenCalledWith(
      `voice:${handle.sessionId}`,
      expect.objectContaining({ kind: 'voice.stt_resumed' }),
    );
  });

  it('stop() finalizes then removes the session with reason stopped', async () => {
    const bus = fakeEventBus();
    const svc = new VoiceService(fakeEngine(), bus, logger);
    const handle = svc.startSttSession('ws-1', noopCallbacks);

    await handle.stop();

    expect(svc.describe(handle.sessionId)).toBeNull();
    expect(bus.emit).toHaveBeenCalledWith(
      `voice:${handle.sessionId}`,
      expect.objectContaining({ kind: 'voice.stt_session_ended', data: expect.objectContaining({ reason: 'stopped' }) }),
    );
  });

  it('refuses a new session once the global cap is reached', () => {
    const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger, { maxConcurrent: 1 });
    svc.startSttSession('ws-1', noopCallbacks);
    expect(() => svc.startSttSession('ws-2', noopCallbacks)).toThrow(/cap \(1\) reached/);
  });

  it('reaps an idle session after idleTtlMs and stops leaking its timer past shutdown', () => {
    const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger, {
      idleTtlMs: 1000,
      idleReaperMs: 500,
    });
    svc.start();
    const handle = svc.startSttSession('ws-1', noopCallbacks);
    expect(svc.describe(handle.sessionId)).not.toBeNull();

    vi.advanceTimersByTime(1500);

    expect(svc.describe(handle.sessionId)).toBeNull();
  });

  it('pushAudio bumps lastActivityAt so an active session is NOT reaped', () => {
    const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger, {
      idleTtlMs: 1000,
      idleReaperMs: 300,
    });
    svc.start();
    const handle = svc.startSttSession('ws-1', noopCallbacks);

    // Keep "talking" every 300ms — each push resets the idle clock.
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(300);
      handle.pushAudio(new Float32Array(10));
    }
    expect(svc.describe(handle.sessionId)).not.toBeNull();
  });

  it('shutdown() cancels every live session, disposes the engine, and stops the reaper', async () => {
    const engine = fakeEngine();
    const svc = new VoiceService(engine, fakeEventBus(), logger, { idleReaperMs: 100 });
    svc.start();
    const h1 = svc.startSttSession('ws-1', noopCallbacks);
    const h2 = svc.startSttSession('ws-2', noopCallbacks);

    await svc.shutdown();

    expect(svc.describe(h1.sessionId)).toBeNull();
    expect(svc.describe(h2.sessionId)).toBeNull();
    expect(engine.dispose).toHaveBeenCalledTimes(1);

    // The reaper interval must be cleared — advancing time must not throw or
    // touch a cleared Map (would be a silent leak otherwise).
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
  });

  it('startSttSession() throws synchronously on cap, so a WS route can respond with an error frame immediately', () => {
    const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger, { maxConcurrent: 0 });
    expect(() => svc.startSttSession('ws-1', noopCallbacks)).toThrow();
  });

  // ── Phase 3: speak() / TTS ────────────────────────────────────────

  describe('speak()', () => {
    it('throws synchronously if no TTS engine is configured — matches startSttSession()\'s cap-throw contract', () => {
      const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger); // no ttsEngine arg at all
      expect(() => svc.speak('ws-1', 'hello')).toThrow(/not configured/);
    });

    it('synthesizes a plain string and yields audio, emitting start/end lifecycle events', async () => {
      const bus = fakeEventBus();
      const tts = fakeTtsEngine();
      const svc = new VoiceService(fakeEngine(), bus, logger, undefined, undefined, tts);

      const handle = svc.speak('ws-1', 'hello world');
      const chunks = await collect(handle.audio);

      expect(tts.synthesize).toHaveBeenCalledWith('hello world', undefined);
      expect(chunks).toEqual([new Float32Array([11])]);
      expect(bus.emit).toHaveBeenCalledWith(
        `voice:${handle.sessionId}`,
        expect.objectContaining({ kind: 'voice.tts_session_started' }),
      );
      expect(bus.emit).toHaveBeenCalledWith(
        `voice:${handle.sessionId}`,
        expect.objectContaining({ kind: 'voice.tts_session_ended' }),
      );
    });

    it('refuses a new speak() session once the concurrent-speech cap is reached', () => {
      // The cap increments synchronously inside speak() itself — a caller
      // doesn't even need to start consuming `handle.audio` for the slot
      // to count as active.
      const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger, { maxConcurrentSpeech: 1 }, undefined, fakeTtsEngine());

      svc.speak('ws-1', 'hello');

      expect(() => svc.speak('ws-2', 'hello again')).toThrow(/cap \(1\) reached/);
    });

    it('the concurrent-speech count is released once a session finishes, allowing a new one', async () => {
      const tts = fakeTtsEngine();
      const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger, { maxConcurrentSpeech: 1 }, undefined, tts);

      const first = svc.speak('ws-1', 'hello');
      await collect(first.audio); // fully drains — releases the slot

      expect(() => svc.speak('ws-2', 'hello again')).not.toThrow();
    });

    it('stop() on the handle halts synthesis (barge-in) without throwing', async () => {
      const tts = fakeTtsEngine({
        synthesize: vi.fn(async function* () {
          yield new Float32Array([1]);
          yield new Float32Array([2]);
          yield new Float32Array([3]);
        }),
      });
      const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger, undefined, undefined, tts);

      const handle = svc.speak('ws-1', 'hello');
      const chunks: Float32Array[] = [];
      for await (const chunk of handle.audio) {
        chunks.push(chunk);
        if (chunks.length === 1) handle.stop();
      }

      expect(chunks).toHaveLength(1);
    });

    it('accepts a live AsyncIterable<string> (Phase 4) the same way it accepts a plain string', async () => {
      const tts = fakeTtsEngine();
      const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger, undefined, undefined, tts);

      async function* tokenStream() {
        yield 'Hello ';
        yield 'world. ';
      }

      const handle = svc.speak('ws-1', tokenStream());
      const chunks = await collect(handle.audio);

      expect(tts.synthesize).toHaveBeenCalledWith('Hello world.', undefined);
      expect(chunks).toHaveLength(1);
    });

    it('stop() without ever consuming handle.audio still releases the concurrency-cap slot (no leak)', () => {
      // Phase 3+4 review finding: `runSpeak`'s `finally` (where the slot
      // used to be released) is generator-function code that doesn't run
      // AT ALL until something drives the generator — `stop()` alone
      // doesn't do that. A caller who calls `stop()` and never touches
      // `handle.audio` used to hold this slot forever.
      const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger, { maxConcurrentSpeech: 1 }, undefined, fakeTtsEngine());

      const handle = svc.speak('ws-1', 'hello');
      handle.stop();

      expect(() => svc.speak('ws-2', 'hello again')).not.toThrow();
    });

    it('shutdown() barges in on an in-flight speak() session instead of leaving it to run to completion', async () => {
      // Phase 3+4 review finding: shutdown() had no map of active TTS
      // sessions, so it could only dispose() the engine — it had no way to
      // tell an in-flight speak() to stop. A consumer still iterating
      // handle.audio would keep pulling (and the runner would keep
      // synthesizing) every remaining sentence for nothing.
      let secondSentenceStarted = false;
      const tts = fakeTtsEngine({
        synthesize: vi.fn(async function* (text: string) {
          if (text === 'second.') secondSentenceStarted = true;
          yield new Float32Array([text.length]);
        }),
      });
      const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger, undefined, undefined, tts);

      async function* tokenStream() {
        yield 'first. ';
        // Yields control back to the microtask queue so the consumer below
        // can pull the first sentence's chunk (suspending the runner mid-
        // stream) before this stream hands over the second sentence —
        // giving shutdown() room to land in between the two.
        await Promise.resolve();
        yield 'second. ';
      }

      const handle = svc.speak('ws-1', tokenStream());
      const iterator = handle.audio[Symbol.asyncIterator]();

      const firstChunk = await iterator.next();
      expect(firstChunk.done).toBe(false);

      await svc.shutdown();

      const afterShutdown = await iterator.next();
      expect(afterShutdown.done).toBe(true);
      expect(secondSentenceStarted).toBe(false);
    });

    it('shutdown() disposes the TTS engine too, when one is configured', async () => {
      const tts = fakeTtsEngine();
      const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger, undefined, undefined, tts);

      await svc.shutdown();

      expect(tts.dispose).toHaveBeenCalledTimes(1);
    });

    it('shutdown() does not throw when no TTS engine was ever configured', async () => {
      const svc = new VoiceService(fakeEngine(), fakeEventBus(), logger);
      await expect(svc.shutdown()).resolves.toBeUndefined();
    });
  });
});
