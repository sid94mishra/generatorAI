// ────────────────────────────────────────────────────────────────
// MoonshineSttEngine — Useful Sensors' Moonshine, local, CPU, free.
//
// WHY THIS ENGINE EXISTS ALONGSIDE PARAKEET AND WHISPER
// -----------------------------------------------------
// Moonshine is built for exactly the workload this module has: short,
// on-device dictation. Two properties matter here and neither is shared by
// the alternatives:
//
//   1. Compute scales with the ACTUAL audio length. Whisper zero-pads every
//      input to 30 seconds, so a 1-second interim costs the same as an
//      11-second one (measured: 1249ms vs 957ms — effectively flat).
//      Moonshine measured 85ms at 1s rising to 509ms at 11s. For a live
//      preview that re-runs on a debounce over a short buffer, that is the
//      difference between usable and not.
//   2. It emits capitalization and punctuation. Parakeet emits neither, and
//      no rule-based formatter can add them back — see
//      RuleBasedTextFormatter.ts, which can only handle SPOKEN punctuation
//      commands ("comma"), not inferred sentence structure. For text landing
//      in a chat composer that is a per-message quality difference.
//
// It is also ~63MB at q8 against Parakeet's 611MB.
//
// MEASURED TRADE-OFF, so this is a choice and not a claim
// -------------------------------------------------------
// Over a 31-length sweep (3.0-6.0s, 0.1s steps) on the same clean fixture:
//
//   parakeet-ctc-0.6b q8   clean 20/31   8 empty, 3 doubled-subword   avg 284ms
//   moonshine-base    q8   clean 25/31   0 empty, 6 repetition-loops  avg 146ms
//
// Moonshine never silently returns empty — Parakeet's dominant failure, and
// the damaging one, since an empty segment deletes what the user said. But
// Moonshine's own failure is an autoregressive repetition loop ("And so my
// fellow Americans and so my fellow Americans and…") which is more visible
// and more frequent than Parakeet's doubling. Parakeet is also more accurate
// when it succeeds.
//
// After ParakeetSttEngine's empty-retry mitigation the two are close, so
// this is a genuine product choice rather than a strict upgrade. See
// VoiceEngineFactory.ts for how it is selected.
//
// Config (env):
//   MOONSHINE_MODEL — HF model id (default below)
//   MOONSHINE_DTYPE / STT_DTYPE — fp32 | fp16 | q8 | q4 | q4f16 (default 'q8')
//   STT_CACHE_DIR   — shared model cache with the other engines
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type {
  ISpeechToTextEngine,
  SttTranscribeOptions,
  SttTranscribeResult,
} from '../../domain/ports/ISpeechToTextEngine.js';
import type { VoiceWorkerPool } from './VoiceWorkerPool.js';

/** Minimal shape of the transformers.js ASR pipeline we rely on. */
type AsrPipeline = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text?: string } | Array<{ text?: string }>>;

/**
 * Hub-verified: `model_type: moonshine`, `MoonshineForConditionalGeneration`,
 * which IS in the installed transformers.js speech-seq2seq map. The `base`
 * variant rather than `tiny` because `tiny`'s q8 weights fail to load in
 * onnxruntime-node ("failed:sys"); tiny works only at fp32, which gives up
 * the size advantage that was its whole point.
 */
const DEFAULT_MODEL = 'onnx-community/moonshine-base-ONNX';
const DEFAULT_DTYPE = 'q8';
const VALID_DTYPES = new Set(['fp32', 'fp16', 'q8', 'q4', 'q4f16']);

export class MoonshineSttEngine implements ISpeechToTextEngine {
  readonly name: string;

  private readonly modelId: string;
  private readonly dtype: string;
  private readonly logger?: ILogger;
  /** Off-thread inference — see VoiceWorkerPool.ts. */
  private readonly pool?: VoiceWorkerPool;
  private pipeline: AsrPipeline | null = null;
  private loadPromise: Promise<void> | null = null;
  private ready = false;

  constructor(opts: { modelId?: string; dtype?: string; logger?: ILogger; workerPool?: VoiceWorkerPool } = {}) {
    this.modelId = opts.modelId ?? process.env['MOONSHINE_MODEL'] ?? DEFAULT_MODEL;
    const requested = opts.dtype ?? process.env['MOONSHINE_DTYPE'] ?? process.env['STT_DTYPE'] ?? DEFAULT_DTYPE;
    this.dtype = VALID_DTYPES.has(requested) ? requested : DEFAULT_DTYPE;
    this.logger = opts.logger;
    if (opts.workerPool) this.pool = opts.workerPool;
    this.name = `moonshine:${this.modelId}`;
    if (this.dtype !== requested) {
      this.logger?.warn?.(
        `[stt] ignoring unsupported Moonshine dtype='${requested}' (expected one of ${[...VALID_DTYPES].join(', ')}); using '${DEFAULT_DTYPE}'`,
      );
    }
  }

  load(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad().catch((err) => {
      this.loadPromise = null;
      throw err;
    });
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    const started = Date.now();
    this.logger?.info?.(`[stt] loading Moonshine model ${this.modelId} (dtype=${this.dtype}, first run downloads ~63MB at q8, then cached)`);

    if (this.pool) {
      await this.pool.loadAsr(this.modelId, this.dtype);
      this.ready = true;
      this.logger?.info?.(`[stt] Moonshine model ready in ${Date.now() - started}ms (off-thread)`);
      return;
    }

    let mod: {
      pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<AsrPipeline>;
      env: Record<string, unknown>;
    };
    try {
      mod = (await import('@huggingface/transformers')) as unknown as typeof mod;
    } catch {
      throw new Error(
        "Speech-to-text engine unavailable: '@huggingface/transformers' is not installed. " +
          'Run `pnpm --filter @generatorai/core add @huggingface/transformers` to enable voice input.',
      );
    }

    const cacheDir = process.env['STT_CACHE_DIR'];
    if (cacheDir) (mod.env as { cacheDir?: string }).cacheDir = cacheDir;

    this.pipeline = await mod.pipeline('automatic-speech-recognition', this.modelId, { dtype: this.dtype });
    this.ready = true;
    this.logger?.info?.(`[stt] Moonshine model ready in ${Date.now() - started}ms`);
  }

  async transcribe(pcm: Float32Array, _options?: SttTranscribeOptions): Promise<SttTranscribeResult> {
    // No `language`/`task` forwarding and no `chunk_length_s`: Moonshine is an
    // English short-form model with no multilingual prompt tokens, and it does
    // not use Whisper's 30-second windowing (that is the property this engine
    // is chosen for — see the file header).
    if (!this.ready) await this.load();

    if (this.pool) {
      const { text } = await this.pool.runAsr(pcm);
      return { text: normalizeTranscript(text) };
    }

    const pipe = this.pipeline;
    if (!pipe) return { text: '' };
    const out = await pipe(pcm);
    const text = Array.isArray(out) ? out.map((o) => o.text ?? '').join(' ') : (out.text ?? '');
    return { text: normalizeTranscript(text) };
  }

  async dispose(): Promise<void> {
    this.pipeline = null;
    this.loadPromise = null;
    this.ready = false;
  }
}

function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
