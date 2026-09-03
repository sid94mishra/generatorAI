// ────────────────────────────────────────────────────────────────
// KokoroTtsEngine — local, CPU, free text-to-speech (Kokoro-82M).
//
// Phase 3 (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part E): "ITextToSpeechEngine
// + Kokoro implementation... proves the entire chain (port → service →
// engine → audio playback) end-to-end."
//
// WHY `kokoro-js` AND NOT `@huggingface/transformers` DIRECTLY
// ------------------------------------------------------------
// An earlier version of this file called
// `pipeline('text-to-speech', 'onnx-community/Kokoro-82M-v1.0-ONNX')` on
// transformers.js directly. That does not work, and fails at load time with:
//
//     Error: Unsupported model type: style_text_to_speech_2
//
// This was verified empirically against the installed build, not inferred.
// The root cause is in the library's own model registry: Kokoro's
// architecture (`model_type: "style_text_to_speech_2"`) IS registered in
// `MODEL_MAPPING_NAMES` as a bare `StyleTextToSpeech2Model`, but it is NOT
// in `MODEL_FOR_TEXT_TO_WAVEFORM_MAPPING_NAMES` (`vits`, `musicgen`,
// `supertonic`) nor `MODEL_FOR_TEXT_TO_SPECTROGRAM_MAPPING_NAMES`
// (`speecht5`) — the two maps the `text-to-speech` pipeline resolves
// against. See node_modules/@huggingface/transformers/src/models.js.
//
// Two further gaps make the raw-pipeline route wrong even in principle:
//   1. Kokoro's tokenizer is PHONEME-level. Its input must be run through
//      eSpeak-NG-style grapheme-to-phoneme conversion first; feeding it raw
//      English text tokenizes garbage.
//   2. Voice selection is a 510-float style vector loaded from the repo's
//      `voices/<name>.bin` and passed as a model input. transformers.js's
//      `TextToAudioPipeline._call` has no `voice` option at all — it only
//      understands `speaker_embeddings`, so the `{ voice }` we used to pass
//      was silently ignored.
//
// `kokoro-js` (from the same author as transformers.js) is the purpose-built
// wrapper that closes all three gaps: it drives `StyleTextToSpeech2Model`
// directly, bundles the phonemizer, and resolves voice names to their style
// vectors. It depends on `@huggingface/transformers` itself, and pnpm dedupes
// it to the exact same physical package instance this repo already installs —
// so it adds a wrapper, not a second copy of the ONNX runtime.
//
// MODEL ID — VERIFIED, not a placeholder
// --------------------------------------
// `onnx-community/Kokoro-82M-v1.0-ONNX` was confirmed against the live
// Hugging Face Hub API (HTTP 200, `pipeline_tag: text-to-speech`,
// `library_name: transformers.js`, Apache-2.0, ~1.1M downloads), and the
// full load → synthesize path was then executed locally end-to-end: it
// returns real, non-silent 24 kHz audio. Both the model id and the default
// voice name (`af_heart`, one of the 28 the repo ships) are therefore
// verified facts, not conventions guessed at from a naming pattern.
//
// DTYPE — pinned deliberately
// ---------------------------
// Defaults to `q8` (~92 MB) rather than the library's own `fp32` default
// (~325 MB). The plan's Part B.4 specifies ONNX INT8 for exactly this
// reason: it is the quantization Kokoro is distributed and benchmarked at
// for CPU use, and it keeps the module inside Part D's disk budget.
// Override with `KOKORO_DTYPE` if a deployment wants full precision.
//
// `sampleRate` (24000 Hz) is Kokoro's own model-inherent property, and is
// re-checked against what the library actually returns on the first
// synthesis (see `warnOnSampleRateMismatch`) — the WS transport publishes
// this number to clients so they can interpret the raw PCM frames, and a
// silent mismatch would play every utterance back at the wrong pitch.
//
// The underlying `generate()` call is NOT internally streaming (it returns
// the whole synthesized `Float32Array` at once). `synthesize()` still yields
// it in fixed-size chunks: this doesn't reduce synthesis latency, but it
// lets `VoiceService.speak()`/the WS transport start forwarding audio to the
// client without holding the entire (possibly multi-second) buffer in memory
// as one send, and lets client playback begin buffering before the last
// chunk is even off the wire. Sentence-level pipelining — which DOES reduce
// perceived latency — happens one layer up, in TtsSessionRunner.
//
// Config (env):
//   KOKORO_MODEL   — HF model id (default below)
//   KOKORO_VOICE   — voice name (default 'af_heart')
//   KOKORO_DTYPE   — fp32 | fp16 | q8 | q4 | q4f16 (default 'q8')
//   STT_CACHE_DIR  — where to cache model files (shared with the STT engines)
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { ITextToSpeechEngine, TtsSynthesizeOptions } from '../../domain/ports/ITextToSpeechEngine.js';
import type { VoiceWorkerPool } from './VoiceWorkerPool.js';

/** Shape of the `RawAudio` kokoro-js returns. */
interface RawAudioLike {
  audio: Float32Array;
  sampling_rate: number;
}

/** Minimal shape of the loaded kokoro-js model we rely on. */
interface KokoroModel {
  readonly voices: Record<string, unknown>;
  generate(text: string, options?: { voice?: string; speed?: number }): Promise<RawAudioLike>;
}

interface KokoroModule {
  KokoroTTS: {
    from_pretrained(
      modelId: string,
      options?: { dtype?: string; device?: string | null },
    ): Promise<KokoroModel>;
  };
}

const DEFAULT_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE = 'af_heart';
const DEFAULT_DTYPE = 'q8';
const VALID_DTYPES = new Set(['fp32', 'fp16', 'q8', 'q4', 'q4f16']);
const KOKORO_SAMPLE_RATE = 24_000;
/** ~170ms per chunk at 24kHz — small enough to start playback quickly, large enough to avoid excessive WS frame overhead. */
const CHUNK_SAMPLES = 4_096;

export class KokoroTtsEngine implements ITextToSpeechEngine {
  readonly name: string;
  readonly sampleRate = KOKORO_SAMPLE_RATE;

  private readonly modelId: string;
  private readonly configuredVoice: string;
  private readonly dtype: string;
  private readonly logger?: ILogger;
  /**
   * When set, inference runs on a worker thread instead of the main one.
   * See VoiceWorkerPool.ts for the measurements that make this mandatory in
   * production; the in-process path is kept for unit tests, which mock the
   * model libraries directly and must not spawn a worker or touch real
   * weights.
   */
  private readonly pool?: VoiceWorkerPool;
  private model: KokoroModel | null = null;
  private loadPromise: Promise<void> | null = null;
  /** Off-thread mode has no local model object — track readiness separately. */
  private ready = false;
  /** Resolved once at load time against the model's own voice list. */
  private resolvedVoice = DEFAULT_VOICE;
  /** Voice names the loaded model ships, for validating per-call overrides. */
  private availableVoices: string[] = [];
  private sampleRateWarned = false;

  constructor(opts: { modelId?: string; defaultVoice?: string; dtype?: string; logger?: ILogger; workerPool?: VoiceWorkerPool } = {}) {
    this.modelId = opts.modelId ?? process.env['KOKORO_MODEL'] ?? DEFAULT_MODEL;
    this.configuredVoice = opts.defaultVoice ?? process.env['KOKORO_VOICE'] ?? DEFAULT_VOICE;
    const requestedDtype = opts.dtype ?? process.env['KOKORO_DTYPE'] ?? DEFAULT_DTYPE;
    // An unrecognised dtype would otherwise surface as an opaque 404 for a
    // model file that doesn't exist. Fail soft to the default instead.
    this.dtype = VALID_DTYPES.has(requestedDtype) ? requestedDtype : DEFAULT_DTYPE;
    this.logger = opts.logger;
    if (opts.workerPool) this.pool = opts.workerPool;
    this.name = `kokoro:${this.modelId}`;
    if (this.dtype !== requestedDtype) {
      this.logger?.warn?.(
        `[tts] ignoring unsupported KOKORO_DTYPE='${requestedDtype}' (expected one of ${[...VALID_DTYPES].join(', ')}); using '${DEFAULT_DTYPE}'`,
      );
    }
  }

  load(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad().catch((err) => {
      // Reset so a later call can retry (e.g. after a transient network
      // failure during the first-time model download).
      this.loadPromise = null;
      throw err;
    });
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    const started = Date.now();
    this.logger?.info?.(`[tts] loading Kokoro model ${this.modelId} (dtype=${this.dtype}, first run downloads ~92MB at q8, then cached)`);

    if (this.pool) {
      const { voices } = await this.pool.loadTts(this.modelId, this.dtype);
      this.availableVoices = voices;
      this.resolvedVoice = this.resolveVoice(voices, this.configuredVoice);
      this.ready = true;
      this.logger?.info?.(`[tts] Kokoro model ready in ${Date.now() - started}ms (voice=${this.resolvedVoice}, off-thread)`);
      return;
    }

    let mod: KokoroModule;
    try {
      mod = (await import('kokoro-js')) as unknown as KokoroModule;
    } catch {
      throw new Error(
        "Text-to-speech engine unavailable: 'kokoro-js' is not installed. " +
          'Run `pnpm --filter @generatorai/core add kokoro-js` to enable voice output.',
      );
    }

    // kokoro-js downloads through `@huggingface/transformers`, which pnpm
    // dedupes to the same physical module instance the STT engines import —
    // so setting `env.cacheDir` here really does redirect kokoro-js's own
    // fetches, keeping every voice model under one cache root. Best-effort:
    // if that ever stopped being the same instance, the only consequence is
    // that TTS weights land in the library's default cache dir instead.
    const cacheDir = process.env['STT_CACHE_DIR'];
    if (cacheDir) {
      try {
        const transformers = (await import('@huggingface/transformers')) as unknown as {
          env: { cacheDir?: string };
        };
        transformers.env.cacheDir = cacheDir;
      } catch {
        /* transformers.js missing — kokoro-js's own import will report it */
      }
    }

    const model = await mod.KokoroTTS.from_pretrained(this.modelId, {
      dtype: this.dtype,
      device: 'cpu',
    });
    this.availableVoices = Object.keys(model.voices ?? {});
    this.resolvedVoice = this.resolveVoice(this.availableVoices, this.configuredVoice);
    this.model = model;
    this.ready = true;
    this.logger?.info?.(`[tts] Kokoro model ready in ${Date.now() - started}ms (voice=${this.resolvedVoice})`);
  }

  /**
   * Map a requested voice name onto one the loaded model actually ships.
   * kokoro-js THROWS on an unknown voice; letting that propagate would turn
   * a typo in `KOKORO_VOICE` into total, silent TTS failure (TtsSessionRunner
   * catches per-sentence errors, so every sentence would simply produce no
   * audio with no obvious cause). Degrade to a working voice and say so.
   */
  private resolveVoice(available: readonly string[], requested: string): string {
    if (available.includes(requested)) return requested;
    const fallback = available.includes(DEFAULT_VOICE) ? DEFAULT_VOICE : available[0];
    if (!fallback) {
      // No voice list at all — hand back what was asked for and let the
      // library decide; nothing better is knowable here.
      return requested;
    }
    this.logger?.warn?.(
      `[tts] voice '${requested}' is not available in ${this.modelId}; falling back to '${fallback}'. Available: ${available.join(', ')}`,
    );
    return fallback;
  }

  async *synthesize(text: string, opts?: TtsSynthesizeOptions): AsyncIterable<Float32Array> {
    if (!text.trim()) return;
    if (!this.ready) await this.load();

    // A per-call voice override goes through the same validation as the
    // configured default, for the same reason.
    const voice = opts?.voice ? this.resolveVoice(this.availableVoices, opts.voice) : this.resolvedVoice;
    const speed = opts?.speed ?? 1.0;

    let audio: Float32Array;
    let samplingRate: number;
    if (this.pool) {
      const result = await this.pool.runTts(text, voice, speed);
      audio = result.audio;
      samplingRate = result.samplingRate;
    } else {
      const model = this.model;
      if (!model) return;
      const result = await model.generate(text, { voice, speed });
      audio = result.audio;
      samplingRate = result.sampling_rate;
    }
    this.warnOnSampleRateMismatch(samplingRate);

    for (let offset = 0; offset < audio.length; offset += CHUNK_SAMPLES) {
      yield audio.subarray(offset, Math.min(offset + CHUNK_SAMPLES, audio.length));
    }
  }

  /**
   * `this.sampleRate` is published to clients (via `VoiceService.ttsSampleRate`
   * → the `ready` frame) BEFORE any audio is synthesized, so it has to be a
   * constant. If the model ever disagreed, playback would be pitch-shifted
   * with no error anywhere — warn once rather than let that pass silently.
   */
  private warnOnSampleRateMismatch(actual: number): void {
    if (actual === KOKORO_SAMPLE_RATE || this.sampleRateWarned) return;
    this.sampleRateWarned = true;
    this.logger?.warn?.(
      `[tts] ${this.modelId} produced ${actual}Hz audio but this engine advertises ${KOKORO_SAMPLE_RATE}Hz to clients — playback will be pitch-shifted.`,
    );
  }

  async dispose(): Promise<void> {
    this.model = null;
    this.loadPromise = null;
    this.ready = false;
    this.availableVoices = [];
    this.sampleRateWarned = false;
    // The pool is shared process-wide and may back other engines — its
    // lifecycle belongs to the composition root, not to one engine.
  }
}
