// ────────────────────────────────────────────────────────────────
// SttSessionRunner — Phase 1 behavior: VAD-driven segmentation (via
// EnergyVad, NOT a model — see EnergyVad.ts for why), pause/resume, and the
// still-applicable pre-existing debounce/dedup/finalize mechanics within a
// single open segment.
//
// Test audio convention: `voiced(n)` is a constant-amplitude buffer (RMS
// well above EnergyVad's default 0.01 threshold) standing in for speech;
// `silence(n)` is all-zero (RMS 0) standing in for a pause between
// utterances. Real EnergyVad instances (not mocks) are used throughout —
// this is deliberately an integration test of runner+VAD together, since
// that interaction (not either piece alone) is what Phase 1 changed.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SttSessionRunner, type SttSessionCallbacks } from '../SttSessionRunner.js';
import type {
  ISpeechToTextEngine,
  SttStreamCallbacks,
  SttTranscribeResult,
} from '../../../domain/ports/ISpeechToTextEngine.js';
import type { ITextFormatter } from '../../../domain/ports/ITextFormatter.js';

function voiced(n: number, amplitude = 0.5): Float32Array {
  return new Float32Array(n).fill(amplitude);
}
function silence(n: number): Float32Array {
  return new Float32Array(n); // zero-filled by default
}

function fakeEngine(transcribe: (pcm: Float32Array) => SttTranscribeResult): ISpeechToTextEngine {
  return {
    name: 'fake',
    load: vi.fn().mockResolvedValue(undefined),
    transcribe: vi.fn((pcm: Float32Array) => Promise.resolve(transcribe(pcm))),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

function callbacks(overrides: Partial<SttSessionCallbacks> = {}): SttSessionCallbacks {
  return { onInterim: vi.fn(), onSegment: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), ...overrides };
}

/** Default EnergyVad hangover is 700ms @16kHz = 11_200 samples. */
const HANGOVER_SAMPLES = 11_200;

describe('SttSessionRunner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('start() warms the engine via load()', () => {
    const engine = fakeEngine(() => ({ text: '' }));
    const runner = new SttSessionRunner(engine, callbacks());
    runner.start('en');
    expect(engine.load).toHaveBeenCalledTimes(1);
  });

  it('runs an interim pass ~900ms after enough voiced audio arrives, re-transcribing the OPEN SEGMENT so far', async () => {
    const engine = fakeEngine((pcm) => ({ text: `len=${pcm.length}` }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    runner.pushAudio(voiced(16_000)); // 1s — above MIN_INTERIM_SAMPLES, below hangover-triggering silence
    await vi.advanceTimersByTimeAsync(900);
    expect(cb.onInterim).toHaveBeenCalledWith('len=16000');

    runner.pushAudio(voiced(16_000)); // still one open segment — now 2s
    await vi.advanceTimersByTimeAsync(900);
    expect(cb.onInterim).toHaveBeenLastCalledWith('len=32000');
    expect(cb.onSegment).not.toHaveBeenCalled();
  });

  it("uses the native streaming decoder when the engine has one, bypassing the VAD", async () => {
    // The behaviour the user actually feels: on a streaming engine, words come
    // back WHILE they are speaking. The batch path cannot do this at all — it
    // has to wait for the VAD to call end-of-utterance before it transcribes
    // anything, so nothing appears until after the speaker stops.
    const pushed: number[] = [];
    let cbs: SttStreamCallbacks | null = null;
    const engine = {
      name: 'fake-streaming',
      load: vi.fn().mockResolvedValue(undefined),
      transcribe: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
      createStream: vi.fn(async (c: SttStreamCallbacks) => {
        cbs = c;
        return {
          pushAudio: (pcm: Float32Array) => pushed.push(pcm.length),
          finish: async () => undefined,
          cancel: () => undefined,
        };
      }),
    } as unknown as ISpeechToTextEngine;

    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);
    runner.start('en');
    await vi.advanceTimersByTimeAsync(0);

    runner.pushAudio(voiced(16_000));
    expect(pushed).toEqual([16_000]);
    // Never re-transcribes a buffer, and never consults a VAD.
    expect(engine.transcribe).not.toHaveBeenCalled();

    // Partials reach the client immediately — no debounce, no silence needed.
    cbs!.onPartial('Hello, how');
    expect(cb.onInterim).toHaveBeenCalledWith('Hello, how');
    cbs!.onFinal('Hello, how are you?');
    await vi.advanceTimersByTimeAsync(0);
    expect(cb.onSegment).toHaveBeenCalledWith('Hello, how are you?');
  });

  it('does not re-emit the last utterance on stop() — it already went out as a segment', async () => {
    // Emitting it again would duplicate the sentence in the composer.
    let cbs: SttStreamCallbacks | null = null;
    const engine = {
      name: 'fake-streaming',
      load: vi.fn().mockResolvedValue(undefined),
      transcribe: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
      createStream: vi.fn(async (c: SttStreamCallbacks) => {
        cbs = c;
        return {
          pushAudio: () => undefined,
          finish: async () => { c.onFinal('the last thing I said'); },
          cancel: () => undefined,
        };
      }),
    } as unknown as ISpeechToTextEngine;

    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);
    runner.start('en');
    await vi.advanceTimersByTimeAsync(0);
    await runner.stop();
    await vi.advanceTimersByTimeAsync(0);

    expect(cb.onSegment).toHaveBeenCalledWith('the last thing I said');
    expect(cb.onSegment).toHaveBeenCalledTimes(1);
    expect(cb.onFinal).toHaveBeenCalledWith('');
  });

  it('falls back to segmented transcription when opening the stream fails', async () => {
    // A streaming engine that cannot open its socket must still dictate.
    const engine = fakeEngine(() => ({ text: 'batch still works' }));
    (engine as { createStream?: unknown }).createStream = vi.fn().mockRejectedValue(new Error('socket refused'));

    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);
    runner.start('en');
    await vi.advanceTimersByTimeAsync(0);

    runner.pushAudio(voiced(16_000));
    runner.pushAudio(silence(HANGOVER_SAMPLES));
    await vi.advanceTimersByTimeAsync(50);
    expect(cb.onSegment).toHaveBeenCalledWith('batch still works');
  });

  it('start({ interim: false }) suppresses preview passes entirely', async () => {
    // The web composer no longer renders a running preview, so it asks the
    // server not to compute one. This is not just a client-side saving:
    // interim passes share the single transcribe queue with the segment
    // finalizations that actually produce text, so on an accurate (rather
    // than merely fast) engine they delay the words the user is waiting for.
    const engine = fakeEngine((pcm) => ({ text: `len=${pcm.length}` }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);
    runner.start('en', { interim: false });

    runner.pushAudio(voiced(16_000));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cb.onInterim).not.toHaveBeenCalled();
    expect(engine.transcribe).not.toHaveBeenCalled();

    // Committed segments are unaffected — silence still finalizes one.
    runner.pushAudio(silence(HANGOVER_SAMPLES));
    await vi.advanceTimersByTimeAsync(50);
    expect(cb.onSegment).toHaveBeenCalledTimes(1);
  });

  it('leaves interim passes ON when the client does not opt out', async () => {
    const engine = fakeEngine(() => ({ text: 'preview' }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);
    runner.start('en');

    runner.pushAudio(voiced(16_000));
    await vi.advanceTimersByTimeAsync(900);
    expect(cb.onInterim).toHaveBeenCalledWith('preview');
  });

  it('does not fire an interim callback twice in a row with identical text (dedup)', async () => {
    const engine = fakeEngine(() => ({ text: 'same' }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    runner.pushAudio(voiced(16_000));
    await vi.advanceTimersByTimeAsync(900);
    runner.pushAudio(voiced(1_000));
    await vi.advanceTimersByTimeAsync(900);

    expect(cb.onInterim).toHaveBeenCalledTimes(1);
  });

  it('does not run an interim pass before MIN_INTERIM_SAMPLES (0.6s) of audio has arrived', async () => {
    const engine = fakeEngine(() => ({ text: 'too-early' }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    runner.pushAudio(voiced(1_000)); // well under 0.6s @16kHz
    await vi.advanceTimersByTimeAsync(900);

    expect(cb.onInterim).not.toHaveBeenCalled();
  });

  it('Phase 1: sustained silence after voiced audio finalizes a SEGMENT (not the whole session)', async () => {
    const engine = fakeEngine((pcm) => ({ text: `seg:${pcm.length}` }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    runner.pushAudio(voiced(16_000)); // 1s of speech
    runner.pushAudio(silence(HANGOVER_SAMPLES)); // sustained silence trips the VAD
    await vi.advanceTimersByTimeAsync(0); // let the fire-and-forget finalize settle

    expect(cb.onSegment).toHaveBeenCalledWith('seg:16000');
    expect(cb.onFinal).not.toHaveBeenCalled(); // segment != final; session is still open
  });

  it('Phase 1: after a segment finalizes, the NEXT utterance is a fresh segment, not merged with the previous one', async () => {
    const engine = fakeEngine((pcm) => ({ text: `seg:${pcm.length}` }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    runner.pushAudio(voiced(16_000));
    runner.pushAudio(silence(HANGOVER_SAMPLES));
    await vi.advanceTimersByTimeAsync(0);
    expect(cb.onSegment).toHaveBeenNthCalledWith(1, 'seg:16000');

    // A second utterance, shorter than the first — if segments weren't
    // resetting, this would report a merged/larger length instead.
    runner.pushAudio(voiced(8_000));
    runner.pushAudio(silence(HANGOVER_SAMPLES));
    await vi.advanceTimersByTimeAsync(0);
    expect(cb.onSegment).toHaveBeenNthCalledWith(2, 'seg:8000');
  });

  it('Phase 1: leading silence before any speech never triggers a segment', async () => {
    const engine = fakeEngine(() => ({ text: 'should-not-fire' }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    runner.pushAudio(silence(HANGOVER_SAMPLES * 3));
    await vi.advanceTimersByTimeAsync(0);

    expect(cb.onSegment).not.toHaveBeenCalled();
  });

  it('Phase 1: pause() discards the open segment\'s not-yet-committed audio', async () => {
    const engine = fakeEngine((pcm) => ({ text: `seg:${pcm.length}` }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    runner.pushAudio(voiced(16_000)); // mid-utterance, not yet silence-terminated
    runner.pause();

    // Audio arriving while paused is a no-op — proves the server-side
    // suspension, not just "the client stopped sending".
    runner.pushAudio(voiced(16_000));
    await vi.advanceTimersByTimeAsync(2000);

    expect(cb.onInterim).not.toHaveBeenCalled();
    expect(cb.onSegment).not.toHaveBeenCalled();
    expect(engine.transcribe).not.toHaveBeenCalled();
  });

  it('Phase 1: resume() continues the SAME runner with a clean segment — no leftover audio from before pause', async () => {
    const engine = fakeEngine((pcm) => ({ text: `seg:${pcm.length}` }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    runner.pushAudio(voiced(16_000)); // discarded by the pause below
    runner.pause();
    runner.resume();

    runner.pushAudio(voiced(8_000)); // the only audio that should survive
    runner.pushAudio(silence(HANGOVER_SAMPLES));
    await vi.advanceTimersByTimeAsync(0);

    expect(cb.onSegment).toHaveBeenCalledWith('seg:8000'); // not 24000
    expect(engine.load).toHaveBeenCalledTimes(0); // resume() never reloads the engine
  });

  it('stop() flushes any open segment and reports it via onFinal', async () => {
    const engine = fakeEngine((pcm) => ({ text: `final:${pcm.length}` }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    runner.pushAudio(voiced(8_000));
    await runner.stop();

    expect(cb.onFinal).toHaveBeenCalledWith('final:8000');
  });

  it('stop() with zero audio reports an empty final transcript without calling the engine', async () => {
    const engine = fakeEngine(() => ({ text: 'should-not-be-called' }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    await runner.stop();

    expect(cb.onFinal).toHaveBeenCalledWith('');
    expect(engine.transcribe).not.toHaveBeenCalled();
  });

  it('cancel() discards the buffer — a subsequent stop() reports empty, not the discarded audio', async () => {
    const engine = fakeEngine((pcm) => ({ text: `len=${pcm.length}` }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    runner.pushAudio(voiced(8_000));
    runner.cancel();
    await runner.stop(); // stop() after cancel() is a no-op (stopped already true)

    expect(cb.onFinal).not.toHaveBeenCalled();
  });

  it('pushAudio() after stop() is ignored (no further transcribe calls)', async () => {
    const engine = fakeEngine(() => ({ text: 'x' }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);
    await runner.stop();
    runner.pushAudio(voiced(16_000));
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.transcribe).not.toHaveBeenCalled();
  });

  it('routes a transcribe() rejection during stop() to onError', async () => {
    const engine: ISpeechToTextEngine = {
      name: 'fake',
      load: vi.fn().mockResolvedValue(undefined),
      transcribe: vi.fn().mockRejectedValue(new Error('boom')),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    runner.pushAudio(voiced(8_000));
    await runner.stop();

    expect(cb.onError).toHaveBeenCalledWith('boom');
  });

  it('Phase 1: routes a transcribe() rejection during VAD-triggered segment finalize to onError, and does not wedge the next segment', async () => {
    let calls = 0;
    const engine: ISpeechToTextEngine = {
      name: 'fake',
      load: vi.fn().mockResolvedValue(undefined),
      transcribe: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error('first segment boom');
        return { text: 'second segment ok' } satisfies SttTranscribeResult;
      }),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    runner.pushAudio(voiced(8_000));
    runner.pushAudio(silence(HANGOVER_SAMPLES));
    await vi.advanceTimersByTimeAsync(0);
    expect(cb.onError).toHaveBeenCalledWith('first segment boom');
    expect(cb.onSegment).not.toHaveBeenCalled();

    // The failed segment must not have left leftover audio merged into the next one.
    runner.pushAudio(voiced(4_000));
    runner.pushAudio(silence(HANGOVER_SAMPLES));
    await vi.advanceTimersByTimeAsync(0);
    expect(cb.onSegment).toHaveBeenCalledWith('second segment ok');
  });

  // ── Post-review fixes: concurrency + audio isolation ─────────────
  // The original version of this rewrite waited for an in-flight
  // transcribe() call via a 1-second POLL with a hard give-up. On a real
  // model whose call legitimately takes longer than that, the poll would
  // abandon the wait and start a SECOND concurrent transcribe() call,
  // violating ISpeechToTextEngine's documented "one at a time" contract.
  // These tests prove the fix: a strict FIFO queue with no timeout.

  it('never starts a second transcribe() call while a slow one is still in flight, no matter how long it takes', async () => {
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;
    const pending: Array<() => void> = [];
    const engine: ISpeechToTextEngine = {
      name: 'fake',
      load: vi.fn().mockResolvedValue(undefined),
      transcribe: vi.fn((pcm: Float32Array) => {
        concurrentCalls += 1;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
        return new Promise<SttTranscribeResult>((resolve) => {
          pending.push(() => {
            concurrentCalls -= 1;
            resolve({ text: `len=${pcm.length}` });
          });
        });
      }),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    // Trigger an interim pass — its transcribe() call starts and is
    // deliberately never resolved yet (simulating a slow real model).
    runner.pushAudio(voiced(16_000));
    await vi.advanceTimersByTimeAsync(900);
    expect(engine.transcribe).toHaveBeenCalledTimes(1);
    expect(concurrentCalls).toBe(1);

    // While it's still in flight, more audio arrives and a VAD segment
    // boundary fires. Under the OLD (buggy) design this would start a
    // second, concurrent transcribe() call once its 1s poll gave up.
    runner.pushAudio(voiced(8_000));
    runner.pushAudio(silence(HANGOVER_SAMPLES));
    expect(engine.transcribe).toHaveBeenCalledTimes(1);
    expect(maxConcurrentCalls).toBe(1);

    // Wait far longer than the old poll's 1-second ceiling — the queue has
    // no timeout, so the finalize must still not have jumped ahead.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(engine.transcribe).toHaveBeenCalledTimes(1);
    expect(maxConcurrentCalls).toBe(1);

    // Only once the interim's call resolves may the queued finalize's
    // transcribe() call start.
    pending.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.transcribe).toHaveBeenCalledTimes(2);
    expect(maxConcurrentCalls).toBe(1); // never more than one in flight, at any point in the test

    pending.shift()!(); // drain so nothing dangles past the test
    await vi.advanceTimersByTimeAsync(0);
    // The finalized segment correctly covers the WHOLE open segment
    // (16000 + 8000 = 24000) — the interim pass was a non-destructive peek
    // that never reset the accumulator, so nothing was lost or duplicated.
    expect(cb.onSegment).toHaveBeenCalledWith('len=24000');
  });

  it('a second utterance never bleeds into a first segment still waiting in the queue behind a slow transcribe()', async () => {
    let resolveFirst: ((r: SttTranscribeResult) => void) | null = null;
    let callIndex = 0;
    const seenLengths: number[] = [];
    const engine: ISpeechToTextEngine = {
      name: 'fake',
      load: vi.fn().mockResolvedValue(undefined),
      transcribe: vi.fn((pcm: Float32Array) => {
        seenLengths.push(pcm.length);
        callIndex += 1;
        if (callIndex === 1) {
          return new Promise<SttTranscribeResult>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve({ text: `len=${pcm.length}` } satisfies SttTranscribeResult);
      }),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb);

    // First utterance — VAD fires, its transcribe() call starts but is
    // held open (simulating a slow model).
    runner.pushAudio(voiced(16_000));
    runner.pushAudio(silence(HANGOVER_SAMPLES));
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.transcribe).toHaveBeenCalledTimes(1);
    expect(seenLengths[0]).toBe(16_000); // exactly the first segment's own audio

    // A second, completely separate utterance arrives WHILE the first is
    // still "processing". Under the pre-fix design (reset deferred to
    // inside the async continuation), this second utterance's audio could
    // get merged into the buffer the first call eventually reads.
    runner.pushAudio(voiced(4_000));
    runner.pushAudio(silence(HANGOVER_SAMPLES));
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.transcribe).toHaveBeenCalledTimes(1); // still queued behind the first

    resolveFirst!({ text: 'first segment text' });
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.transcribe).toHaveBeenCalledTimes(2);
    expect(seenLengths[1]).toBe(4_000); // its OWN 4000 samples, not 16000+4000
    expect(cb.onSegment).toHaveBeenNthCalledWith(1, 'first segment text');
    expect(cb.onSegment).toHaveBeenNthCalledWith(2, 'len=4000');
  });

  // ── Phase 2: optional ITextFormatter cleanup pass ────────────────
  // Applied ONLY to a committed segment/final transcript, never to the
  // live interim preview — see ITextFormatter.ts's file header for why.

  it('applies the formatter to a VAD-finalized segment before onSegment', async () => {
    const engine = fakeEngine(() => ({ text: 'um raw text' }));
    const formatter: ITextFormatter = { name: 'fake-formatter', format: vi.fn(async (t) => t.replace('um ', '')) };
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb, undefined, undefined, formatter);

    runner.pushAudio(voiced(8_000));
    runner.pushAudio(silence(HANGOVER_SAMPLES));
    await vi.advanceTimersByTimeAsync(0);

    expect(cb.onSegment).toHaveBeenCalledWith('raw text');
    expect(formatter.format).toHaveBeenCalledWith('um raw text', expect.anything());
  });

  it('applies the formatter to the final transcript after stop()', async () => {
    const engine = fakeEngine(() => ({ text: 'um raw text' }));
    const formatter: ITextFormatter = { name: 'fake-formatter', format: vi.fn(async (t) => t.replace('um ', '')) };
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb, undefined, undefined, formatter);

    runner.pushAudio(voiced(8_000));
    await runner.stop();

    expect(cb.onFinal).toHaveBeenCalledWith('raw text');
  });

  it('never applies the formatter to interim text', async () => {
    const engine = fakeEngine(() => ({ text: 'um raw text' }));
    const formatter: ITextFormatter = { name: 'fake-formatter', format: vi.fn(async (t) => t.replace('um ', '')) };
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb, undefined, undefined, formatter);

    runner.pushAudio(voiced(16_000));
    await vi.advanceTimersByTimeAsync(900);

    expect(cb.onInterim).toHaveBeenCalledWith('um raw text'); // unformatted
    expect(formatter.format).not.toHaveBeenCalled();
  });

  it('falls back to the unformatted text if the formatter itself throws', async () => {
    const engine = fakeEngine(() => ({ text: 'raw text' }));
    const formatter: ITextFormatter = { name: 'broken-formatter', format: vi.fn().mockRejectedValue(new Error('formatter boom')) };
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb, undefined, undefined, formatter);

    runner.pushAudio(voiced(8_000));
    await runner.stop();

    // The segment/final text is not lost just because the OPTIONAL cleanup
    // pass failed — dictation must never break because of it.
    expect(cb.onFinal).toHaveBeenCalledWith('raw text');
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('with no formatter configured, passes text through exactly as the engine produced it (Phase 1 behavior preserved)', async () => {
    const engine = fakeEngine(() => ({ text: 'raw text' }));
    const cb = callbacks();
    const runner = new SttSessionRunner(engine, cb); // no formatter argument at all

    runner.pushAudio(voiced(8_000));
    await runner.stop();

    expect(cb.onFinal).toHaveBeenCalledWith('raw text');
  });

  // Final end-to-end review finding: the cap check only looked at state
  // BEFORE a call, so a single chunk larger than the whole remaining
  // budget (e.g. mobile's useVoiceInput.ts sends an entire long recording
  // as ONE binary frame, unlike the web client's small streaming chunks)
  // could sail straight past MAX_SEGMENT_SAMPLES (16_000 * 120) in one shot.
  describe('MAX_SEGMENT_SAMPLES safety cap', () => {
    const MAX_SEGMENT_SAMPLES = 16_000 * 120;

    it('truncates a single push that alone exceeds the cap, instead of accepting it unbounded', async () => {
      const engine = fakeEngine((pcm) => ({ text: `len=${pcm.length}` }));
      const cb = callbacks();
      const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
      const runner = new SttSessionRunner(engine, cb, logger);

      // One push, 1s of audio OVER the cap — everything mobile's batch
      // upload would otherwise deliver as a single WS binary frame.
      runner.pushAudio(voiced(MAX_SEGMENT_SAMPLES + 16_000));
      await runner.stop();

      // The accumulated/transcribed segment is truncated to exactly the
      // cap, not the full oversized push.
      expect(cb.onFinal).toHaveBeenCalledWith(`len=${MAX_SEGMENT_SAMPLES}`);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('truncated to fit'));
    });

    it('does not warn twice for the SAME truncation event (log-spam guard)', () => {
      const engine = fakeEngine(() => ({ text: '' }));
      const cb = callbacks();
      const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
      const runner = new SttSessionRunner(engine, cb, logger);

      runner.pushAudio(voiced(MAX_SEGMENT_SAMPLES + 16_000)); // truncated — warns once
      runner.pushAudio(voiced(1_000)); // already at the cap — warns via the OTHER (pre-existing) message

      const warnMessages = logger.warn.mock.calls.map((call) => call[0] as string);
      expect(warnMessages.filter((m) => m.includes('truncated to fit'))).toHaveLength(1);
    });

    it('a normal small streaming chunk that crosses the cap by a small margin is truncated to land EXACTLY at the cap, never overshooting it', async () => {
      const engine = fakeEngine((pcm) => ({ text: `len=${pcm.length}` }));
      const cb = callbacks();
      const runner = new SttSessionRunner(engine, cb);

      // A run of small (web-sized) chunks approaching the cap. A size that
      // does NOT evenly divide the cap is deliberate, so the last push
      // genuinely straddles the boundary instead of landing on it exactly.
      const chunkSize = 15_999;
      let pushed = 0;
      while (pushed + chunkSize <= MAX_SEGMENT_SAMPLES) {
        runner.pushAudio(voiced(chunkSize));
        pushed += chunkSize;
      }
      runner.pushAudio(voiced(chunkSize)); // straddles the cap — truncated to fit exactly, not accepted whole

      // A push AFTER the cap is already reached is dropped entirely.
      runner.pushAudio(voiced(1_000));

      await runner.stop();
      expect(cb.onFinal).toHaveBeenCalledWith(`len=${MAX_SEGMENT_SAMPLES}`);
    });
  });

  // ── Bounded interim window ──────────────────────────────────────
  //
  // Root cause 1 in the plan: the live preview used to re-transcribe the
  // whole open segment on every tick, so its cost grew without limit as the
  // user kept talking (measured: 789ms per pass over a 20s utterance vs
  // 136ms with a 2s window). Committed segments must still see everything.

  /** Loud audio so EnergyVad treats it as speech and never closes the segment. */
  const speech = (samples: number): Float32Array => {
    const a = new Float32Array(samples);
    for (let i = 0; i < samples; i += 1) a[i] = Math.sin(i / 8) * 0.5;
    return a;
  };

  it('an interim pass sees at most the trailing window, however long the segment gets', async () => {
    const seen: number[] = [];
    const engine = fakeEngine((pcm) => {
      seen.push(pcm.length);
      return { text: 'x' };
    });
    const runner = new SttSessionRunner(engine, callbacks());
    runner.start();

    // 20 seconds of continuous speech, fed in 1s pushes with an interim
    // debounce elapsing between each.
    for (let i = 0; i < 20; i += 1) {
      runner.pushAudio(speech(16_000));
      await vi.advanceTimersByTimeAsync(900);
    }

    expect(seen.length).toBeGreaterThan(5);
    // Default window is 5s @16kHz. Nothing may exceed it.
    const cap = 16_000 * 5;
    expect(Math.max(...seen)).toBeLessThanOrEqual(cap);
    // …and it really did reach the cap rather than staying tiny.
    expect(Math.max(...seen)).toBe(cap);
  });

  it('the window takes the NEWEST audio, not the oldest', async () => {
    // A preview must show what is being said now. Taking from the front
    // would freeze the preview on the first few seconds forever.
    const seen: Array<{ head: number; tail: number }> = [];
    const engine = fakeEngine((pcm) => {
      seen.push({ head: pcm[0] ?? 0, tail: pcm[pcm.length - 1] ?? 0 });
      return { text: 'x' };
    });
    const runner = new SttSessionRunner(engine, callbacks());
    runner.start();

    // Distinctive marker at the very end of a segment longer than the window.
    runner.pushAudio(speech(16_000 * 6));
    const marker = new Float32Array(16_000);
    marker.fill(0.9);
    runner.pushAudio(marker);
    await vi.advanceTimersByTimeAsync(900);

    const last = seen[seen.length - 1]!;
    // 7s of audio against a 5s window, so the window spans the last 4s of
    // sine plus the 1s marker: the marker lands at the END of the window.
    // Its presence there proves the newest audio was kept; the head being
    // ordinary sine proves the window really did slide past the start.
    expect(last.tail).toBeCloseTo(0.9, 5);
    expect(Math.abs(last.head)).toBeLessThan(0.9);
  });

  it('a COMMITTED segment still transcribes in full, not just the window', async () => {
    const seen: number[] = [];
    const engine = fakeEngine((pcm) => {
      seen.push(pcm.length);
      return { text: 'committed' };
    });
    const onSegment = vi.fn();
    const runner = new SttSessionRunner(engine, callbacks({ onSegment }));
    runner.start();

    // 8s of speech — longer than the 5s interim window — then silence to
    // close the segment.
    runner.pushAudio(speech(16_000 * 8));
    runner.pushAudio(new Float32Array(HANGOVER_SAMPLES));
    await vi.advanceTimersByTimeAsync(50);

    expect(onSegment).toHaveBeenCalled();
    // The segment pass must have seen more than one window's worth.
    expect(Math.max(...seen)).toBeGreaterThan(16_000 * 5);
  });

  it('a segment shorter than the window is passed whole, with no padding', async () => {
    const seen: number[] = [];
    const engine = fakeEngine((pcm) => {
      seen.push(pcm.length);
      return { text: 'x' };
    });
    const runner = new SttSessionRunner(engine, callbacks());
    runner.start();

    runner.pushAudio(speech(16_000 * 2));
    await vi.advanceTimersByTimeAsync(900);

    expect(seen[0]).toBe(16_000 * 2);
  });
});
