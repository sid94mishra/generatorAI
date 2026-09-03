// ────────────────────────────────────────────────────────────────
// VoiceWorkerPool + the engines' off-thread path.
//
// Two layers, deliberately:
//
//  1. Engine delegation (mocked pool) — proves each engine routes the heavy
//     call to the pool and keeps ALL of its surrounding logic (dtype
//     resolution, voice validation, chunking, sample-rate checks) on the main
//     thread, so the off-thread mode is not a second, untested
//     implementation.
//
//  2. A real worker round-trip — spawns the actual worker and runs a real
//     model, asserting the thing this module exists for: the main event loop
//     keeps ticking THROUGHOUT inference. That assertion is the whole point;
//     a mocked version of it would prove nothing, since the bug being
//     prevented lives entirely in what onnxruntime-node does to the calling
//     thread. Skipped unless the model cache is already populated, so it
//     never turns a clean checkout's test run into a 700MB download.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { ParakeetSttEngine } from '../ParakeetSttEngine.js';
import { WhisperSttEngine } from '../WhisperSttEngine.js';
import { KokoroTtsEngine } from '../KokoroTtsEngine.js';
import { VoiceWorkerPool } from '../VoiceWorkerPool.js';

/** Stands in for the worker, so no thread is spawned and no model is loaded. */
function fakePool(overrides: Partial<VoiceWorkerPool> = {}) {
  return {
    loadAsr: vi.fn().mockResolvedValue(undefined),
    runAsr: vi.fn().mockResolvedValue({ text: 'from the worker' }),
    loadTts: vi.fn().mockResolvedValue({ voices: ['af_heart', 'am_adam'] }),
    runTts: vi.fn().mockResolvedValue({ audio: new Float32Array(10_000), samplingRate: 24_000 }),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as VoiceWorkerPool;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('engines delegate inference to the worker pool', () => {
  beforeEach(() => {
    for (const k of ['PARAKEET_MODEL', 'STT_MODEL', 'PARAKEET_DTYPE', 'STT_DTYPE', 'KOKORO_MODEL', 'KOKORO_VOICE', 'KOKORO_DTYPE']) {
      delete process.env[k];
    }
  });

  it('ParakeetSttEngine loads and transcribes through the pool, with the dtype it resolved', async () => {
    const pool = fakePool();
    const engine = new ParakeetSttEngine({ workerPool: pool });

    const result = await engine.transcribe(new Float32Array([0.1, 0.2, 0.3]));

    expect(pool.loadAsr).toHaveBeenCalledWith('onnx-community/parakeet-ctc-0.6b-ONNX', 'q8');
    expect(pool.runAsr).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('from the worker');
  });

  it('ParakeetSttEngine still normalizes worker output, so the off-thread path is not a behaviour fork', async () => {
    const pool = fakePool({
      runAsr: vi.fn().mockResolvedValue({ text: '  ragged   spacing\nhere  ' }),
    } as Partial<VoiceWorkerPool>);

    const result = await new ParakeetSttEngine({ workerPool: pool }).transcribe(new Float32Array(4));

    expect(result.text).toBe('ragged spacing here');
  });

  it('ParakeetSttEngine coalesces concurrent loads through the pool too', async () => {
    const pool = fakePool();
    const engine = new ParakeetSttEngine({ workerPool: pool });

    await Promise.all([engine.load(), engine.load(), engine.load()]);

    expect(pool.loadAsr).toHaveBeenCalledTimes(1);
  });

  it('WhisperSttEngine delegates too, forwarding its chunking options and no dtype', async () => {
    const pool = fakePool();
    const engine = new WhisperSttEngine({ workerPool: pool });

    await engine.transcribe(new Float32Array(4));

    expect(pool.loadAsr).toHaveBeenCalledWith('Xenova/whisper-base.en');
    expect(pool.runAsr).toHaveBeenCalledWith(expect.any(Float32Array), {
      chunk_length_s: 30,
      stride_length_s: 5,
    });
  });

  it("WhisperSttEngine keeps the English-only rule on the main thread — no language/task for a '.en' model", async () => {
    const pool = fakePool();
    await new WhisperSttEngine({ workerPool: pool }).transcribe(new Float32Array(4), { language: 'fr' });

    const opts = (pool.runAsr as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, unknown>;
    expect(opts['language']).toBeUndefined();
    expect(opts['task']).toBeUndefined();
  });

  it('KokoroTtsEngine loads through the pool and validates the voice against the list it returns', async () => {
    process.env['KOKORO_VOICE'] = 'not_a_real_voice';
    const pool = fakePool();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
    logger.child.mockReturnValue(logger);

    await collect(new KokoroTtsEngine({ workerPool: pool, logger }).synthesize('hello'));

    expect(pool.loadTts).toHaveBeenCalledWith('onnx-community/Kokoro-82M-v1.0-ONNX', 'q8');
    // Fell back using the worker-reported voice list, not a local model object.
    expect(pool.runTts).toHaveBeenCalledWith('hello', 'af_heart', 1.0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("voice 'not_a_real_voice' is not available"));
  });

  it('KokoroTtsEngine chunks worker audio identically to the in-process path', async () => {
    const pool = fakePool();

    const chunks = await collect(new KokoroTtsEngine({ workerPool: pool }).synthesize('hello'));

    expect(chunks.map((c) => c.length)).toEqual([4_096, 4_096, 1_808]);
  });

  it('KokoroTtsEngine still warns when the worker reports an unexpected sample rate', async () => {
    const pool = fakePool({
      runTts: vi.fn().mockResolvedValue({ audio: new Float32Array(100), samplingRate: 16_000 }),
    } as Partial<VoiceWorkerPool>);
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
    logger.child.mockReturnValue(logger);

    await collect(new KokoroTtsEngine({ workerPool: pool, logger }).synthesize('hello'));

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('pitch-shifted'));
  });

  it('an engine dispose() does NOT dispose the shared pool — its lifecycle belongs to the composition root', async () => {
    const pool = fakePool();
    const engine = new ParakeetSttEngine({ workerPool: pool });
    await engine.load();

    await engine.dispose();

    expect(pool.dispose).not.toHaveBeenCalled();
    // …and the engine is genuinely reset, so a later use re-loads.
    await engine.load();
    expect(pool.loadAsr).toHaveBeenCalledTimes(2);
  });
});

// ────────────────────────────────────────────────────────────────
// Real worker round-trip.
// ────────────────────────────────────────────────────────────────

const CACHE_DIR = process.env['STT_CACHE_DIR'] ?? '';
const KOKORO_CACHED =
  CACHE_DIR !== '' && existsSync(`${CACHE_DIR}/onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model_quantized.onnx`);
const PARAKEET_CACHED =
  CACHE_DIR !== '' &&
  existsSync(`${CACHE_DIR}/onnx-community/parakeet-ctc-0.6b-ONNX/onnx/model_quantized.onnx`);

describe('VoiceWorkerPool — a failed model load must not poison the worker', () => {
  // A half-built ONNX session leaves state behind in the worker thread that
  // the next `pipeline()` call inherits. Measured with a truncated Parakeet
  // weight file cached beside a complete Whisper one: Parakeet failed, and
  // then Whisper failed too — reporting Parakeet's error, naming Parakeet's
  // quantized tensor and Parakeet's file length, despite loading fp32 weights
  // from a different repo. Whisper alone, on a fresh worker, loaded in 2.0s.
  //
  // That silently defeated CascadingSttEngine: the fallback ran, was told it
  // had failed too, and voice input was dead with the FIRST engine's opaque
  // onnxruntime message. Two unresolvable model ids reproduce the shape of it
  // without downloading anything — under a poisoned worker the second load
  // reports the first model's failure.
  it('recycles the worker, so the next load fails on its own terms', async () => {
    const warnings: string[] = [];
    const pool = new VoiceWorkerPool({
      warn: (m: string) => warnings.push(m),
    } as unknown as ConstructorParameters<typeof VoiceWorkerPool>[0]);
    try {
      await expect(
        pool.loadAsr('generatorai-tests/first-model-does-not-exist'),
      ).rejects.toThrow();
      expect(warnings.some((w) => w.includes('recycling'))).toBe(true);

      const second = await pool
        .loadAsr('generatorai-tests/second-model-does-not-exist')
        .then(() => null, (err: Error) => err);
      expect(second).toBeInstanceOf(Error);
      // The discriminating assertion: the second failure must describe the
      // SECOND model. A contaminated worker replays the first one's.
      expect((second as Error).message).toContain('second-model-does-not-exist');
      expect((second as Error).message).not.toContain('first-model-does-not-exist');
      expect(warnings.filter((w) => w.includes('recycling')).length).toBe(2);
    } finally {
      await pool.dispose();
    }
  }, 120_000);

  it("a recycled worker's exit does not reject its successor's in-flight work", async () => {
    // `recycle()` installs a replacement synchronously while the corpse's
    // `exit` event lands afterwards. Before the pending map was scoped by
    // worker generation, that late event cleared the live worker reference
    // and rejected work the successor was already running.
    const pool = new VoiceWorkerPool();
    try {
      await expect(pool.loadAsr('generatorai-tests/no-such-model')).rejects.toThrow();
      // Queued immediately after the recycle, i.e. squarely inside the window
      // where the dead worker's exit arrives. It must fail on its own merits
      // (unresolvable model), never with a "voice worker exited" teardown.
      const err = await pool
        .loadAsr('generatorai-tests/still-no-such-model')
        .then(() => null, (e: Error) => e);
      expect((err as Error).message).not.toMatch(/voice worker exited/i);
    } finally {
      await pool.dispose();
    }
  }, 120_000);
});

describe.skipIf(!KOKORO_CACHED)('VoiceWorkerPool — real worker, real model', () => {
  it('keeps the main event loop responsive THROUGHOUT inference', async () => {
    const pool = new VoiceWorkerPool();
    try {
      await pool.loadTts('onnx-community/Kokoro-82M-v1.0-ONNX', 'q8');
      await pool.runTts('Warm up.', 'af_heart', 1.0); // exclude lazy init

      // Sample the loop at 50ms. If inference ran on this thread, the gap
      // between consecutive samples would span the whole synthesis — which
      // is exactly the outage this class exists to prevent.
      let maxGapMs = 0;
      let last = Date.now();
      const meter = setInterval(() => {
        const now = Date.now();
        maxGapMs = Math.max(maxGapMs, now - last - 50);
        last = now;
      }, 50);

      const started = Date.now();
      const result = await pool.runTts(
        'This is a local text to speech test that runs entirely on the CPU with no cloud involved.',
        'af_heart',
        1.0,
      );
      const computeMs = Date.now() - started;
      // Keep sampling briefly after: a block only shows up on the FIRST
      // timer callback that manages to run once the thread is free again.
      await new Promise((r) => setTimeout(r, 400));
      clearInterval(meter);

      expect(result.audio.length).toBeGreaterThan(0);
      expect(result.samplingRate).toBe(24_000);
      // The work really did take a while…
      expect(computeMs).toBeGreaterThan(500);
      // …and the loop stayed live the whole time. In-process this same call
      // measured a ~10s block; the server's wedge detector fires at 5s.
      expect(maxGapMs).toBeLessThan(1_000);
    } finally {
      await pool.dispose();
    }
  }, 180_000);

  it('rejects in-flight work when disposed rather than leaving callers hanging', async () => {
    const pool = new VoiceWorkerPool();
    await pool.loadTts('onnx-community/Kokoro-82M-v1.0-ONNX', 'q8');
    const inFlight = pool.runTts('A sentence that will not finish.', 'af_heart', 1.0);
    // Attach the handler SYNCHRONOUSLY. `await pool.dispose()` yields, and the
    // rejection lands during that yield — asserting on `inFlight` only
    // afterwards would let Node flag it as an unhandled rejection first.
    const outcome = inFlight.then(
      () => null,
      (err: Error) => err,
    );
    await pool.dispose();

    await expect(outcome).resolves.toMatchObject({ message: expect.stringContaining('disposed') });
  }, 180_000);

  it('refuses new work after dispose instead of silently spawning another worker', async () => {
    const pool = new VoiceWorkerPool();
    await pool.dispose();

    await expect(pool.loadTts('onnx-community/Kokoro-82M-v1.0-ONNX', 'q8')).rejects.toThrow(/disposed/);
  });
});

describe.skipIf(!PARAKEET_CACHED)('VoiceWorkerPool — real worker, ASR round trip', () => {
  // This exists because the TTS test alone did NOT catch a real bug. The
  // worker resolved `@huggingface/transformers` to its CommonJS build, whose
  // ESM namespace exposed `env` (so the TTS path, which only touches `env`
  // and then hands off to kokoro-js, worked fine) but NOT `pipeline` — so
  // every transcription failed with "mod.pipeline is not a function" while
  // TTS looked healthy. Both entry points need their own round trip.
  it('loads and runs ASR through the worker, returning a real transcript', async () => {
    const pool = new VoiceWorkerPool();
    try {
      await pool.loadAsr('onnx-community/parakeet-ctc-0.6b-ONNX', 'q8');

      // 2s of a 440Hz tone: no words, but it proves the whole load → run →
      // reply path works and yields a well-formed string result. Transcript
      // CONTENT is asserted end-to-end against real speech elsewhere.
      const pcm = new Float32Array(16_000 * 2);
      for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * 440 * i) / 16_000) * 0.2;

      const result = await pool.runAsr(pcm);
      expect(typeof result.text).toBe('string');
    } finally {
      await pool.dispose();
    }
  }, 300_000);

  it("does not detach the caller's audio — the same buffer transcribes twice", async () => {
    const pool = new VoiceWorkerPool();
    try {
      await pool.loadAsr('onnx-community/parakeet-ctc-0.6b-ONNX', 'q8');
      const pcm = new Float32Array(16_000);

      await pool.runAsr(pcm);
      // SttSessionRunner re-transcribes a growing snapshot of the same audio
      // (interim, then final). If runAsr transferred the caller's buffer,
      // this second read would see a detached, zero-length array.
      expect(pcm.length).toBe(16_000);
      await expect(pool.runAsr(pcm)).resolves.toBeDefined();
    } finally {
      await pool.dispose();
    }
  }, 300_000);
});
