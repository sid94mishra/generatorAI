// ────────────────────────────────────────────────────────────────
// SileroVad — neural voice-activity detection.
//
// WHY THIS REPLACES THE RMS DETECTOR
// ----------------------------------
// `EnergyVad` decides "is this speech?" from RMS amplitude alone. That is the
// weakest of the three standard approaches — neural VAD outperforms WebRTC
// VAD, which outperforms an energy baseline — and its failure mode is
// specific and visible in our own audio. Measured on the reference clip, per
// 32 ms window:
//
//   Silero says speech  202/343 windows
//   RMS    says speech  274/343 windows      (78% agreement)
//
//   silence gaps >= 300ms, Silero:  6 found
//   silence gaps >= 300ms, RMS:     2 found
//
// The 72 windows RMS calls speech and Silero does not are quiet room tone and
// breath between phrases sitting just above the 0.01 amplitude threshold. RMS
// cannot tell those from talking, because amplitude is all it looks at — so
// it under-segments, and a loud non-speech room would make it over-segment
// just as confidently. Silero scores broadband noise at 0.012 (correctly not
// speech) where RMS would call the same signal speech outright.
//
// COST, AND WHY IT STILL NEEDS ITS OWN THREAD
// -------------------------------------------
// 0.325 ms per 32 ms window — about 100x faster than real time, on a 2.2 MB
// model. Cheap enough to look like it belongs on the main thread. It does
// not, and the reason is a hard runtime constraint rather than a performance
// one:
//
//   **onnxruntime-node cannot be used from the main thread while a worker
//   thread is also using it.** Doing so segfaults the process.
//
// Verified directly: a script that loads ORT in a worker, then loads it on
// the main thread and runs both, dies with
// `FATAL ERROR: v8::HandleScope::CreateHandle() Cannot create a handle
// without a HandleScope` and exit code 139. That is exactly what happened
// when this detector first ran on the main thread beside `VoiceWorkerPool`:
// TTS kept working (it lives in the worker) while STT went silent, because
// the server had crashed.
//
// The same crash happens worker-to-worker, so a dedicated VAD thread is not
// an option either: **one thread per process, full stop.** The VAD therefore
// shares `VoiceWorkerPool`'s worker with transcription and synthesis.
//
// The obvious cost — a VAD window waiting behind a transcription — is bounded
// by giving the worker two queues: VAD windows wait only for the op actually
// running, never for the ones merely queued.
//
// THE ONE REAL WRINKLE: ORT IS ASYNC, `pushChunk` IS NOT
// -------------------------------------------------------
// `EnergyVad.pushChunk()` is a synchronous function returning a number, and
// `SttSessionRunner.pushAudio()` is called synchronously from the WebSocket
// message handler. `onnxruntime-node` has no synchronous `run()`. Rather than
// make audio ingestion async — which would put ordering hazards into the hot
// path for every engine, including the ones that do not need it — this class
// keeps the same synchronous contract and pipelines the inference:
//
//   pushChunk(n)   → returns the decision produced by windows already scored,
//                    and schedules scoring for the new ones
//   pushChunk(n+1) → returns any decision those windows produced
//
// So an endpoint is reported at most one chunk late (~128 ms at the web
// client's frame size) against a 700 ms hangover. That is a smaller error
// than the one RMS makes by mistaking room tone for speech, and it is bounded
// by the 100x compute headroom above — the queue cannot fall behind in
// practice, and `maxPendingWindows` bounds it if something pathological ever
// does.
// ────────────────────────────────────────────────────────────────

import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { dirname, join } from 'node:path';
import type { ILogger } from '@generatorai/shared';
import type { VoiceWorkerPool } from './VoiceWorkerPool.js';
import type { VoiceActivityDetector } from './VoiceActivityDetector.js';

/** Silero v5 requires exactly this window at 16 kHz. Not tunable. */
const WINDOW_SAMPLES = 512;

export interface SileroVadOptions {
  /**
   * Speech probability at or above which a window counts as speech. Silero's
   * own maintainers call 0.5 a "lazy" default that works across most data;
   * production voice stacks commonly run 0.7–0.75 to avoid triggering on
   * background chatter. 0.5 is kept here because this is push-to-talk
   * dictation — the user has already declared intent by pressing the mic, so
   * the cost of a missed quiet word is higher than the cost of a false accept.
   */
  speechThreshold?: number;
  /** Consecutive silence (ms) that ends an utterance. Default 700ms, matching EnergyVad. */
  silenceHangoverMs?: number;
  sampleRate?: number;
  /** Safety bound on un-scored backlog before further windows are dropped. */
  maxPendingWindows?: number;
  /** Override the cached model location. Mainly for tests. */
  modelPath?: string;
}

/**
 * Silero publishes no transformers.js-loadable package, so the weights are a
 * plain ONNX file fetched once and cached beside the speech models.
 * `STT_CACHE_DIR` is honoured so one cache root holds everything.
 */
const MODEL_SOURCES = [
  'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx',
  'https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx',
];

function cachedModelPath(): string {
  const root = process.env['STT_CACHE_DIR'] ?? join(process.cwd(), '.cache');
  return join(root, 'silero', 'silero_vad.onnx');
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    httpsGet(url, { headers: { 'user-agent': 'generatorai' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        const next = res.headers.location;
        if (!next) return reject(new Error(`redirect without location from ${url}`));
        return download(next, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      mkdirSync(dirname(dest), { recursive: true });
      // Write to a temp name and rename: an interrupted download must never
      // leave a truncated file that loads as a corrupt model forever after.
      const tmp = `${dest}.partial`;
      const file = createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () =>
        file.close(() => {
          try {
            renameSync(tmp, dest);
            resolve();
          } catch (err) {
            reject(err as Error);
          }
        }),
      );
      file.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Fetch the weights if needed, load them into the shared voice worker, and
 * return a factory for per-session detectors.
 *
 * The graph is stateless as we drive it — the LSTM state is passed in and out
 * on every call, keyed by session — so one loaded session backs every
 * concurrent dictation.
 */
export async function createSileroVadFactory(
  pool: VoiceWorkerPool,
  opts: SileroVadOptions = {},
  logger?: ILogger,
  // The returned factory takes per-session overrides so a setting the user
  // can change at runtime (Settings > Audio's "Pause before committing")
  // reaches the NEXT dictation session without rebuilding the detector — the
  // model load and its 2MB fetch happen once, here.
): Promise<(override?: SileroVadOptions) => VoiceActivityDetector> {
  const modelPath = opts.modelPath ?? cachedModelPath();
  if (!existsSync(modelPath)) {
    let lastErr: Error | undefined;
    for (const url of MODEL_SOURCES) {
      try {
        logger?.info?.(`[stt] downloading Silero VAD (~2MB) from ${url}`);
        await download(url, modelPath);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err as Error;
      }
    }
    if (lastErr) throw new Error(`Could not fetch the Silero VAD model: ${lastErr.message}`);
  }

  await pool.loadVad(modelPath);
  // Prove the graph really loaded before declaring it ready — otherwise a bad
  // model surfaces much later as "dictation never segments", instead of
  // falling back to the RMS detector here and now.
  await pool.scoreVad(0, new Float32Array(WINDOW_SAMPLES), opts.sampleRate ?? 16_000);
  await pool.releaseVad(0);
  logger?.info?.(`[stt] Silero VAD ready (${modelPath})`);

  let nextSid = 1;
  return (override: SileroVadOptions = {}) => new SileroVad(pool, nextSid++, { ...opts, ...override }, logger);
}

export class SileroVad implements VoiceActivityDetector {
  private readonly threshold: number;
  private readonly hangoverSamples: number;
  private readonly sampleRate: number;
  private readonly maxPendingWindows: number;
  private readonly logger?: ILogger;
  private readonly pool: VoiceWorkerPool;
  /** Identifies this detector's LSTM state inside the worker. */
  private readonly sid: number;

  /** Samples not yet forming a whole window, carried to the next push. */
  private leftover = new Float32Array(0);
  /** FIFO so windows are always scored in audio order. */
  private queue: Promise<void> = Promise.resolve();
  private pendingWindows = 0;

  private everVoiced = false;
  private silentSamplesRun = 0;
  /** Set by the async scorer; drained by the next `pushChunk`. */
  private triggered: number | null = null;

  constructor(pool: VoiceWorkerPool, sid: number, opts: SileroVadOptions = {}, logger?: ILogger) {
    this.pool = pool;
    this.sid = sid;
    this.threshold = opts.speechThreshold ?? 0.5;
    this.sampleRate = opts.sampleRate ?? 16_000;
    this.hangoverSamples = Math.round(((opts.silenceHangoverMs ?? 700) / 1000) * this.sampleRate);
    this.maxPendingWindows = opts.maxPendingWindows ?? 256; // ~8s of backlog
    this.logger = logger;
  }

  /**
   * Same contract as `EnergyVad.pushChunk`: returns 0 while nothing has
   * triggered, or the number of trailing silent samples at the moment
   * sustained silence was detected — which the caller trims off the tail of
   * its segment before transcribing.
   *
   * See the file header for why the answer can lag by one chunk.
   */
  pushChunk(pcm: Float32Array): number {
    // Drain a decision the scorer reached since the last call.
    const fired = this.triggered;
    this.triggered = null;

    this.enqueueWindows(pcm);

    return fired ?? 0;
  }

  /** Split into whole 512-sample windows and schedule them, in order. */
  private enqueueWindows(pcm: Float32Array): void {
    const joined = new Float32Array(this.leftover.length + pcm.length);
    joined.set(this.leftover, 0);
    joined.set(pcm, this.leftover.length);

    const wholeWindows = Math.floor(joined.length / WINDOW_SAMPLES);
    const consumed = wholeWindows * WINDOW_SAMPLES;
    this.leftover = joined.slice(consumed);

    for (let i = 0; i < wholeWindows; i += 1) {
      if (this.pendingWindows >= this.maxPendingWindows) {
        // Cannot happen with 100x headroom; if it ever does, dropping the
        // NEWEST keeps the already-ordered backlog coherent rather than
        // scoring windows out of sequence.
        this.logger?.warn?.('[stt] Silero VAD backlog exceeded its bound; dropping a window.');
        break;
      }
      const window = joined.subarray(i * WINDOW_SAMPLES, (i + 1) * WINDOW_SAMPLES);
      // Copy: `joined` is reused by the next push, and the tensor is read
      // asynchronously.
      const owned = new Float32Array(window);
      this.pendingWindows += 1;
      this.queue = this.queue.then(() => this.scoreWindow(owned)).catch(() => undefined);
    }
  }

  private async scoreWindow(window: Float32Array): Promise<void> {
    try {
      const { probability } = await this.pool.scoreVad(this.sid, window, this.sampleRate);
      this.applyDecision(probability >= this.threshold, WINDOW_SAMPLES);
    } catch (err) {
      // A scoring failure must never break dictation; treat the window as
      // speech so the segment stays open rather than being cut on an error.
      this.logger?.warn?.(`[stt] Silero VAD window failed, treating as speech: ${(err as Error).message}`);
      this.applyDecision(true, WINDOW_SAMPLES);
    } finally {
      this.pendingWindows = Math.max(0, this.pendingWindows - 1);
    }
  }

  /** Identical state machine to EnergyVad, driven by the model instead of RMS. */
  private applyDecision(isSpeech: boolean, samples: number): void {
    if (isSpeech) {
      this.everVoiced = true;
      this.silentSamplesRun = 0;
      return;
    }
    if (!this.everVoiced) return; // Leading silence never triggers.
    this.silentSamplesRun += samples;
    if (this.silentSamplesRun >= this.hangoverSamples && this.triggered === null) {
      this.triggered = this.silentSamplesRun;
      this.everVoiced = false;
      this.silentSamplesRun = 0;
    }
  }

  /** Discard all state, including the model's recurrent state. */
  reset(): void {
    this.everVoiced = false;
    this.silentSamplesRun = 0;
    this.triggered = null;
    this.leftover = new Float32Array(0);
    // Drop the model's recurrent state too: a resumed session must not carry
    // the previous utterance's context. Releasing the id is enough — the
    // worker allocates a fresh zeroed state on the next window for it.
    void this.pool.releaseVad(this.sid).catch(() => undefined);
  }
}
