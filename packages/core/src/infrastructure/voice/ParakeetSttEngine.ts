// ────────────────────────────────────────────────────────────────
// ParakeetSttEngine — NVIDIA Parakeet ASR, local, CPU, free.
//
// MODEL ID — VERIFIED, not a placeholder
// --------------------------------------
// `onnx-community/parakeet-ctc-0.6b-ONNX` was confirmed against the live
// Hugging Face Hub API (HTTP 200, `pipeline_tag: automatic-speech-recognition`,
// `model_type: "parakeet_ctc"`), and `parakeet_ctc` IS registered in the
// installed `@huggingface/transformers` (v3.8.1) — see
// `MODEL_FOR_CTC_MAPPING_NAMES` → `ParakeetForCTC` in
// node_modules/@huggingface/transformers/src/models.js — which is the map the
// `automatic-speech-recognition` pipeline resolves against. The full
// load → transcribe path was then executed locally against real speech audio.
//
// DIVERGENCE FROM THE DESIGN DOC — why, stated factually
// -----------------------------------------------------
// docs/VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part B.4 names
// `nvidia/parakeet_realtime_eou_120m-v1` "(120M params, ONNX INT8)" — a
// streaming RNNT/transducer checkpoint with an in-model end-of-utterance
// token. That repository is real, but the plan's parenthetical is not: its
// complete file list is `parakeet_realtime_eou_120m-v1.nemo`, a README, and
// two images. **There is no ONNX export and no `config.json`** — it is a
// NeMo-format checkpoint (`library_name: nemo`), so transformers.js cannot
// load it at all, at any quantization. Using it would mean adding a Python
// NeMo runtime or hand-writing an ONNX RNNT decoder against a checkpoint
// that would first have to be converted; both are far outside this module's
// "same onnxruntime-node already in the stack" constraint.
//
// The plan's optional accuracy pass, `parakeet-tdt-0.6b-v3`, is blocked for
// the same class of reason: `nvidia/parakeet-tdt-0.6b-v3` publishes no ONNX
// export, and its `model_type` is `parakeet_tdt` (`ParakeetForTDT`), which
// transformers.js v3.8.1 does not implement — only `parakeet_ctc` is in the
// CTC map above. It is therefore not wired up, deliberately, rather than
// silently omitted.
//
// What this engine actually delivers: real accuracy improvement over
// Whisper (Parakeet CTC models generally beat Whisper on WER — see
// docs/VOICE_AGENT_REALTIME_STT_PLAN.md §10 for the cited benchmarks) behind
// the exact same `ISpeechToTextEngine` contract, running on the exact same
// `onnxruntime-node` runtime already in the stack via the same
// `pipeline('automatic-speech-recognition', modelId)` call Whisper uses.
// Segmentation/endpointing for BOTH engines is handled uniformly one layer
// up, by `EnergyVad` in `SttSessionRunner.ts` — never by this class.
// `isEndOfUtterance` is therefore always left undefined here, same as
// Whisper. `CascadingSttEngine` keeps a load failure here fail-safe (falls
// back to Whisper) rather than breaking voice input outright — see its file
// header and the composition-root wiring (`GENERATORAI_STT_ENGINE` env var).
//
// KNOWN QUALITY ISSUE AT SEGMENT BOUNDARIES — upstream, measured
// --------------------------------------------------------------
// transformers.js logs `Unknown tokenizer class "ParakeetTokenizer",
// attempting to construct from base class` when loading this repo, and the
// fallback decoder is not reliable on every input length. Reproduced against
// the RAW library with no code from this repo in the path, transcribing
// prefixes of the same clean speech clip:
//
//   3.5s → "and so my fellow americans"           ✓
//   3.9s → "and so my fellow americans askeded"   ✗ duplicated subword
//   4.0s → ""                                     ✗ empty
//   4.2s → "and so my fellow americans ask not"   ✓
//
// This matters here specifically because `EnergyVad` cuts segments at
// silence, i.e. at arbitrary lengths — exactly the inputs that trigger it.
// A live dictation session was observed committing the segment
// "and so my fellowllow americans".
//
// It is NOT a defect in this file, in SttSessionRunner, or in the text
// formatter (which cannot insert text — verified). It is the model/library
// pairing.
//
// WHAT WAS RULED OUT, and what `transcribe()` does about it
// --------------------------------------------------------
// Sweeping 31 segment lengths (3.0–6.0s) against three trailing-pad values:
//
//   no pad   9/31 bad      200ms pad  8/31 bad      500ms pad  10/31 bad
//
// So padding every segment does NOT reduce the rate — but **no length was
// bad at all three pad values**, which is the useful part: the failure is
// deterministic per (audio, length) and a small alignment shift clears it.
// Also ruled out: `fp32` is not a fix worth having (2.4GB), and upgrading
// transformers.js to 4.x is blocked because `kokoro-js` depends on `^3.5.1`
// and would pull a second copy of the ONNX runtime.
//
// `transcribe()` therefore retries ONCE with 200ms of appended silence, but
// only when the first pass came back EMPTY and the audio actually had speech
// energy. That is the half of the artifact worth acting on automatically:
// an empty segment silently deletes what the user said, whereas the
// duplicated-subword half ("fellowllow") is visible and self-correctable,
// and every heuristic for detecting it also matches legitimate English
// ("that that", "had had"), so guessing there would corrupt good
// transcripts to cosmetically improve bad ones. It is left alone.
//
// HOW IT COMPARES TO WHISPER — measured, and NOT the clean win it looks
// ---------------------------------------------------------------------
// Same 31-length sweep, both engines, counting outputs inconsistent with
// the reference transcript:
//
//   parakeet q8      11/31 bad  (8 empty, 3 corrupt)   avg  411ms/clip
//   whisper base.en   6/31 bad  (0 empty, 6 corrupt)   avg 1717ms/clip
//
// Read that carefully before concluding Whisper is simply better. Most of
// Whisper's 6 are not a defect at all: cutting a clip at an arbitrary
// length truncates a word mid-utterance, and "ask not" clipped at 3.7s
// honestly transcribes as "ask me to". Real segments are cut at SILENCE by
// EnergyVad, not at arbitrary offsets, so that column overstates both
// engines' real-world error rate.
//
// What IS engine-specific: Whisper never returns empty, and never doubles a
// subword. Parakeet's empties — its dominant failure, 8 of 11 — are what
// `transcribe()`'s retry above now recovers, which leaves the rarer
// doubling as the only artifact still reaching the user. Against that,
// Parakeet is ~4× faster, which is what makes Part D's ≤500ms finalization
// target reachable at all, so it stays the preferred engine in `auto` mode.
// Whisper also emits punctuation and capitalisation, which Parakeet does
// not — a real advantage for dictation, and the reason
// `GENERATORAI_STT_ENGINE=whisper` is a legitimate preference rather than
// merely a fallback.
//
// DTYPE — pinned deliberately
// ---------------------------
// Defaults to `q8` rather than transformers.js's own `fp32` default. This is
// not a micro-optimisation: at fp32 this checkpoint is **2.4 GB** of ONNX
// weights, which blows straight through Part D's ~640 MB disk budget and
// makes a first run download 4× more than it needs to. At q8 it is ~611 MB,
// which is both what Part B.4 specifies ("ONNX INT8") and what the published
// RTF benchmarks it cites were measured at. Override with `PARAKEET_DTYPE`
// (or the shared `STT_DTYPE`) if a deployment wants full precision.
//
// Config (env):
//   PARAKEET_MODEL / STT_MODEL — HF model id (default below)
//   PARAKEET_DTYPE / STT_DTYPE — fp32 | fp16 | q8 | q4 | q4f16 (default 'q8')
//   STT_CACHE_DIR              — where to cache model files (shared with Whisper)
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

/** Hub-verified — see file header. */
const DEFAULT_MODEL = 'onnx-community/parakeet-ctc-0.6b-ONNX';
/** INT8, per plan Part B.4 — see the DTYPE note in the file header. */
const DEFAULT_DTYPE = 'q8';
const VALID_DTYPES = new Set(['fp32', 'fp16', 'q8', 'q4', 'q4f16']);
/**
 * Trailing silence added on the retry pass. 200ms at 16kHz — long enough to
 * shift the model's frame alignment, short enough that the extra decode is
 * negligible next to an RTF of ~0.045.
 */
const RETRY_PAD_SAMPLES = 16_000 * 0.2;
/**
 * RMS below this counts as silence. Deliberately low: the cost of guessing
 * "silent" wrongly is a lost sentence, while guessing "speech" wrongly is
 * one extra ~100ms decode.
 */
const SILENCE_RMS_THRESHOLD = 0.005;

export class ParakeetSttEngine implements ISpeechToTextEngine {
  readonly name: string;

  private readonly modelId: string;
  private readonly dtype: string;
  private readonly logger?: ILogger;
  /**
   * When set, inference runs on a worker thread instead of the main one.
   * See VoiceWorkerPool.ts for the measurements that make this mandatory in
   * production (a 120s segment blocks the event loop for ~14s otherwise);
   * the in-process path is kept for unit tests, which mock transformers.js
   * directly and must not spawn a worker or touch real weights.
   */
  private readonly pool?: VoiceWorkerPool;
  private pipeline: AsrPipeline | null = null;
  private loadPromise: Promise<void> | null = null;
  /** Off-thread mode has no local pipeline object — track readiness separately. */
  private ready = false;

  constructor(opts: { modelId?: string; dtype?: string; logger?: ILogger; workerPool?: VoiceWorkerPool } = {}) {
    this.modelId = opts.modelId ?? process.env['PARAKEET_MODEL'] ?? process.env['STT_MODEL'] ?? DEFAULT_MODEL;
    const requestedDtype = opts.dtype ?? process.env['PARAKEET_DTYPE'] ?? process.env['STT_DTYPE'] ?? DEFAULT_DTYPE;
    // An unrecognised dtype would otherwise surface as an opaque 404 for a
    // model file that doesn't exist. Fail soft to the default instead.
    this.dtype = VALID_DTYPES.has(requestedDtype) ? requestedDtype : DEFAULT_DTYPE;
    this.logger = opts.logger;
    if (opts.workerPool) this.pool = opts.workerPool;
    this.name = `parakeet:${this.modelId}`;
    if (this.dtype !== requestedDtype) {
      this.logger?.warn?.(
        `[stt] ignoring unsupported Parakeet dtype='${requestedDtype}' (expected one of ${[...VALID_DTYPES].join(', ')}); using '${DEFAULT_DTYPE}'`,
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
    this.logger?.info?.(`[stt] loading Parakeet model ${this.modelId} (dtype=${this.dtype}, first run downloads ~611MB at q8, then cached)`);

    if (this.pool) {
      await this.pool.loadAsr(this.modelId, this.dtype);
      this.ready = true;
      this.logger?.info?.(`[stt] Parakeet model ready in ${Date.now() - started}ms (off-thread)`);
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
    if (cacheDir) {
      (mod.env as { cacheDir?: string }).cacheDir = cacheDir;
    }

    this.pipeline = await mod.pipeline('automatic-speech-recognition', this.modelId, { dtype: this.dtype });
    this.ready = true;
    this.logger?.info?.(`[stt] Parakeet model ready in ${Date.now() - started}ms`);
  }

  async transcribe(pcm: Float32Array, _options?: SttTranscribeOptions): Promise<SttTranscribeResult> {
    // `_options.language` is intentionally not forwarded: ParakeetForCTC's
    // pipeline call takes no language/task options (that's a Whisper
    // multilingual-checkpoint concept — see WhisperSttEngine.ts). Passing
    // them here would be guessing at an option this model class doesn't
    // define.
    if (!this.ready) await this.load();

    const text = await this.decode(pcm);
    if (text) return { text };

    // Empty result. Either the audio really was silent, or we hit the
    // decoder artifact documented in the file header — which loses the
    // user's words with no error anywhere. Distinguish by energy, and only
    // spend a second pass when there was something to hear.
    if (!hasSpeechEnergy(pcm)) return { text: '' };

    // Retrying the SAME samples would be pointless — the artifact is
    // deterministic for a given input. It IS length-sensitive though:
    // sweeping 31 segment lengths, ~29% produced empty or duplicated text,
    // but no length failed at every trailing-pad value. A short pad changes
    // the frame alignment enough to decode cleanly.
    const retried = await this.decode(padWithSilence(pcm, RETRY_PAD_SAMPLES));
    if (retried) {
      this.logger?.debug?.('[stt] empty transcript recovered on a padded retry (see ParakeetSttEngine.ts header)');
      return { text: retried };
    }
    this.logger?.warn?.(
      '[stt] Parakeet returned an empty transcript for audio that had speech energy, and a padded retry did not recover it.',
    );
    return { text: '' };
  }

  /** One decode pass, whichever side of the worker boundary we are on. */
  private async decode(pcm: Float32Array): Promise<string> {
    if (this.pool) {
      const { text } = await this.pool.runAsr(pcm);
      return normalizeTranscript(text);
    }
    const pipe = this.pipeline;
    if (!pipe) return '';
    const out = await pipe(pcm);
    const text = Array.isArray(out) ? out.map((o) => o.text ?? '').join(' ') : (out.text ?? '');
    return normalizeTranscript(text);
  }

  async dispose(): Promise<void> {
    this.pipeline = null;
    this.loadPromise = null;
    this.ready = false;
    // The pool is shared process-wide and may back other engines — its
    // lifecycle belongs to the composition root, not to one engine.
  }
}

function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Root-mean-square loud enough that an empty transcript is suspicious. */
function hasSpeechEnergy(pcm: Float32Array): boolean {
  if (pcm.length === 0) return false;
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 1) sum += pcm[i]! * pcm[i]!;
  return Math.sqrt(sum / pcm.length) > SILENCE_RMS_THRESHOLD;
}

/** A copy of `pcm` with `padSamples` of digital silence appended. */
function padWithSilence(pcm: Float32Array, padSamples: number): Float32Array {
  const out = new Float32Array(pcm.length + padSamples);
  out.set(pcm, 0);
  return out;
}
