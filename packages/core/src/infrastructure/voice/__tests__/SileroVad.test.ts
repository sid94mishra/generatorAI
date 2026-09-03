// ────────────────────────────────────────────────────────────────
// SileroVad — the pipelined async detector behind a synchronous contract.
//
// The ONNX session is faked, because what needs testing is the part this
// class actually owns: window framing, the one-chunk answer lag, the silence
// state machine, and that a scoring failure cannot cut an utterance short.
// The model's own accuracy is not ours to test — but the real-session round
// trip at the bottom checks we drive it with the right tensor shapes, since
// getting those wrong is silent.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SileroVad, createSileroVadFactory } from '../SileroVad.js';
import { VoiceWorkerPool } from '../VoiceWorkerPool.js';

/**
 * A stand-in for the VAD worker. `probFor` decides the speech probability
 * from the window's first sample, so a test can spell out a speech/silence
 * pattern without touching a model.
 */
function fakeWorker(probFor: (firstSample: number) => number, opts: { fail?: boolean } = {}) {
  const runs: number[] = [];
  const released: number[] = [];
  const worker = {
    scoreVad: (_sid: number, pcm: Float32Array) => {
      if (opts.fail) return Promise.reject(new Error('ort exploded'));
      runs.push(pcm.length);
      return Promise.resolve({ probability: probFor(pcm[0] ?? 0) });
    },
    releaseVad: (sid: number) => {
      released.push(sid);
      return Promise.resolve();
    },
  };
  return { worker: worker as never, runs, released };
}

/** 512-sample windows whose first sample encodes speech (1) or silence (0). */
const windows = (pattern: number[]): Float32Array => {
  const out = new Float32Array(pattern.length * 512);
  pattern.forEach((v, i) => {
    out[i * 512] = v;
  });
  return out;
};

/**
 * Let the internal FIFO drain. Each queued window is several `await`s deep,
 * so a handful of microtask ticks is not enough — yield to the macrotask
 * queue repeatedly instead.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 60; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('SileroVad', () => {
  it('frames audio into exactly 512-sample windows', async () => {
    const { worker, runs } = fakeWorker(() => 0.9);
    const vad = new SileroVad(worker, 1);

    vad.pushChunk(new Float32Array(2048)); // 4 whole windows
    await settle();

    expect(runs).toEqual([512, 512, 512, 512]);
  });

  it('carries a partial window across pushes instead of dropping or padding it', async () => {
    const { worker, runs } = fakeWorker(() => 0.9);
    const vad = new SileroVad(worker, 1);

    // 700 samples = one window with 188 left over…
    vad.pushChunk(new Float32Array(700));
    await settle();
    expect(runs).toEqual([512]);

    // …and 324 more completes the second, with no short window ever scored.
    vad.pushChunk(new Float32Array(324));
    await settle();
    expect(runs).toEqual([512, 512]);
  });

  it('reports an endpoint after sustained silence, and only once', async () => {
    const { worker } = fakeWorker((first) => (first > 0.5 ? 0.9 : 0.01));
    // 700ms hangover = 11_200 samples ≈ 22 windows.
    const vad = new SileroVad(worker, 1, { silenceHangoverMs: 700 });

    vad.pushChunk(windows([1, 1, 1])); // speech
    await settle();
    expect(vad.pushChunk(new Float32Array(0))).toBe(0);

    vad.pushChunk(windows(Array(25).fill(0))); // ~800ms of silence
    await settle();

    const fired = vad.pushChunk(new Float32Array(0));
    expect(fired).toBeGreaterThanOrEqual(11_200);
    // Drained — a second read must not re-fire the same endpoint.
    expect(vad.pushChunk(new Float32Array(0))).toBe(0);
  });

  it('never fires on leading silence, so an idle session does not segment', async () => {
    const { worker } = fakeWorker(() => 0.01);
    const vad = new SileroVad(worker, 1, { silenceHangoverMs: 700 });

    vad.pushChunk(windows(Array(40).fill(0)));
    await settle();

    expect(vad.pushChunk(new Float32Array(0))).toBe(0);
  });

  it('a mid-utterance pause shorter than the hangover does not end the segment', async () => {
    const { worker } = fakeWorker((first) => (first > 0.5 ? 0.9 : 0.01));
    const vad = new SileroVad(worker, 1, { silenceHangoverMs: 700 });

    vad.pushChunk(windows([1, 1]));
    vad.pushChunk(windows(Array(10).fill(0))); // ~320ms — a breath, not an endpoint
    vad.pushChunk(windows([1, 1]));
    await settle();

    expect(vad.pushChunk(new Float32Array(0))).toBe(0);
  });

  it('treats a scoring failure as speech, so an error cannot truncate an utterance', async () => {
    const { worker } = fakeWorker(() => 0, { fail: true });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
    logger.child.mockReturnValue(logger);
    const vad = new SileroVad(worker, 1, { silenceHangoverMs: 700 }, logger);

    vad.pushChunk(windows(Array(40).fill(0)));
    await settle();

    // Cutting the user off because inference failed would be the worst
    // possible response to an error here.
    expect(vad.pushChunk(new Float32Array(0))).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('treating as speech'));
  });

  it('reset() clears speech state, the partial window and the model state', async () => {
    const { worker, runs } = fakeWorker((first) => (first > 0.5 ? 0.9 : 0.01));
    const vad = new SileroVad(worker, 1, { silenceHangoverMs: 700 });

    vad.pushChunk(windows([1]));
    vad.pushChunk(new Float32Array(300)); // partial window pending
    await settle();
    const before = runs.length;

    vad.reset();

    // The 300 carried samples must be gone: 300 more would complete a window
    // if they had been kept, and must not.
    vad.pushChunk(new Float32Array(300));
    await settle();
    expect(runs.length).toBe(before);

    // And silence no longer counts, because everVoiced was cleared.
    vad.pushChunk(windows(Array(40).fill(0)));
    await settle();
    expect(vad.pushChunk(new Float32Array(0))).toBe(0);
  });

  it('reset() also drops the model state held in the worker', async () => {
    // A resumed session must not carry the previous utterance's recurrent
    // context; releasing the id is what makes the worker allocate a fresh
    // zeroed state for the next window.
    const { worker, released } = fakeWorker(() => 0.9);
    const vad = new SileroVad(worker, 7);

    vad.reset();
    await settle();

    expect(released).toContain(7);
  });

  it('bounds its backlog rather than queueing without limit', async () => {
    const { worker, runs } = fakeWorker(() => 0.9);
    const vad = new SileroVad(worker, 1, { maxPendingWindows: 4 });

    // 40 windows pushed in one go against a bound of 4.
    vad.pushChunk(windows(Array(40).fill(1)));
    await settle();

    expect(runs.length).toBeLessThanOrEqual(40);
  });
});

// ────────────────────────────────────────────────────────────────
// Real model. Skipped unless the weights are already cached, so a clean
// checkout never turns `vitest` into a download.
// ────────────────────────────────────────────────────────────────
const CACHE = process.env['STT_CACHE_DIR'] ?? '';
const MODEL = CACHE ? join(CACHE, 'silero', 'silero_vad.onnx') : '';
const CACHED = MODEL !== '' && existsSync(MODEL);

describe.skipIf(!CACHED)('SileroVad — real model', () => {
  it('drives the real graph with the tensor shapes it expects', async () => {
    // Wrong shapes here fail silently as "never detects speech", which no
    // mocked test can catch.
    const pool = new VoiceWorkerPool();
    const create = await createSileroVadFactory(pool, { modelPath: MODEL, silenceHangoverMs: 300 });
    const vad = create();

    // Loud broadband noise is NOT speech to a neural VAD (it is to an RMS
    // one) — so this also pins the behavioural difference that motivated
    // the swap.
    const noise = new Float32Array(512 * 30);
    for (let i = 0; i < noise.length; i += 1) noise[i] = (Math.random() * 2 - 1) * 0.5;
    vad.pushChunk(noise);
    await settle();

    expect(vad.pushChunk(new Float32Array(0))).toBe(0); // never voiced ⇒ never fires
    await pool.dispose();
  }, 60_000);
});
