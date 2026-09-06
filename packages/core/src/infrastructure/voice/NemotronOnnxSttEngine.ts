// ────────────────────────────────────────────────────────────────
// NemotronOnnxSttEngine — Nemotron streaming ASR, in process, over ONNX.
//
// WHY THIS EXISTS ALONGSIDE NemotronSttEngine
// -------------------------------------------
// `NemotronSttEngine` reaches Nemotron through NVIDIA's NeMo-Speech.cpp — a
// native executable this app deliberately refuses to download or run
// unprompted. That is still the right stance, but it has a cost the header
// there did not anticipate: without a human installing a binary first,
// `auto` can never actually choose Nemotron, so in practice the cascade
// always fell through to Moonshine. "Nemotron is available" was true of the
// code and false of every machine that had not been hand-prepared.
//
// That file's header explains why an ONNX path looked unattractive: NVIDIA
// publishes no ONNX export (its repo carries only .nemo, safetensors and a
// GGUF), and community exports "split the model into encoder/decoder/joiner
// graphs and hand-write the greedy RNNT loop and the mel extractor around
// them". What changed is that the split export now ships with the model's own
// `genai_config.json` naming every constant the loop needs — cache sizes,
// chunk length, blank id, subsampling, mel parameters — so nothing here is
// reverse-engineered, and the loop is ~120 lines of arithmetic against a
// published contract rather than a reimplementation.
//
// So both adapters stay. This one runs wherever the weights are present; the
// NeMo-Speech.cpp one remains for installs that prefer NVIDIA's own runtime
// or want GPU execution. See VoiceEngineFactory for which is chosen.
//
// WHICH WEIGHTS
// -------------
// Ours, downloaded by us — see NemotronModelStore. An earlier version read
// them out of VS Code's dictation cache, which was wrong: a user need not
// have VS Code, may never have enabled its dictation, and that directory
// belongs to another application that can clean it up underneath us.
//
// The shapes are READ FROM THE MODEL, not hardcoded, because the two
// published exports genuinely differ (English-only: vocab 1025, blank 1024,
// left-context 70, five encoder inputs; multilingual 3.5: vocab 13088, blank
// 13087, left-context 56, and a sixth `lang_id` prompt input). The shapes are
// close enough that the wrong constants still RUN — and return fluent
// nonsense — so this is not a defensive nicety.
//
// WHY THE DECODE LOOP IS NOT IN THIS FILE
// ---------------------------------------
// It lives in `VoiceWorkerPool`'s worker. onnxruntime-node executes
// `session.run()` synchronously on the calling thread despite its
// Promise-shaped API, so running it here would block the event loop for
// every user of the server (VoiceWorkerPool's header has the measurements,
// and `WedgeDetector` correctly shuts the process down when it happens).
// The encoder's attention caches are also ~6.8MB and would have to make the
// round trip twice per 560ms chunk if the state lived out here. So the state
// stays there and this class owns everything else: model discovery,
// utterance boundaries, and the engine contract.
//
// The one part with real specification risk — the mel front end — is in
// `nemotronFeatures.ts`, on this side of the boundary, where it is unit
// tested. See that file for why.
//
// CONFIG (env)
//   GENERATORAI_NEMOTRON_ONNX_DIR     explicit model directory (default: our
//                                     own cache; see NemotronModelStore)
//   GENERATORAI_NEMOTRON_ENDPOINT_MS  silence (ms) that ends an utterance
//   GENERATORAI_NEMOTRON_LANG_ID      language prompt id; 0 = auto-detect
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { ILogger } from '@generatorai/shared';
import {
  STT_STREAMING_UNSUPPORTED,
  type ISpeechToTextEngine,
  type SttStreamCallbacks,
  type SttStreamHandle,
  type SttTranscribeOptions,
  type SttTranscribeResult,
} from '../../domain/ports/ISpeechToTextEngine.js';
import type { VoiceWorkerPool } from './VoiceWorkerPool.js';
import { EnergyVad } from './EnergyVad.js';
import { hannWindow, melFilterbank, parseVocab } from './nemotronFeatures.js';
import { isNemotronModelPresent, nemotronModelDir, NEMOTRON_REPO } from './NemotronModelStore.js';

/**
 * Silence that ends an utterance.
 *
 * 500ms rather than `EnergyVad`'s 700ms default: this is the dominant term in
 * "how long until my sentence is committed", and dictation into a composer is
 * a stop-start activity where the extra 200ms of dead air is noticeable.
 */
const ENDPOINT_SILENCE_MS = Number(process.env['GENERATORAI_NEMOTRON_ENDPOINT_MS'] ?? '800');

/**
 * Language conditioning for the multilingual build.
 *
 * The 3.5 encoder takes a `lang_id` prompt input, and 0 is auto-detect.
 * Measured on this repo's English reference clips, auto is also the best
 * setting rather than merely the most convenient one: it returned the
 * transcript with full punctuation and capitalization, while forcing a
 * specific locale id returned the same words with the punctuation stripped,
 * and out-of-range ids returned nothing at all. NVIDIA does not publish the
 * id->locale mapping, so a "force this language" control would be guesswork;
 * auto covers all 40 locales without one.
 *
 * The English-only export has no `lang_id` input at all, and this is simply
 * not sent for it — which is why the engine reads the encoder's declared
 * inputs rather than assuming a build.
 */
const LANG_ID_AUTO = Number(process.env['GENERATORAI_NEMOTRON_LANG_ID'] ?? '0');

/** The model's own runtime contract, read from the weights we downloaded. */
interface NemotronModelConfig {
  sampleRate: number; nFft: number; hopLength: number; winLength: number; nMels: number;
  preemphasis: number; logEpsilon: number; chunkFrames: number; windowFrames: number;
  preEncodeCacheFrames: number; encoderLayers: number; hiddenSize: number; leftContext: number;
  convContext: number; decoderHidden: number; decoderLayers: number; blankId: number;
  maxSymbolsPerStep: number; langId: number;
}

/**
 * Read `genai_config.json` rather than hardcoding the shapes.
 *
 * The two published exports genuinely disagree: the English build is
 * vocab 1025 / blank 1024 / left-context 70 with a five-input encoder, the
 * multilingual 3.5 is vocab 13088 / blank 13087 / left-context 56 with a
 * sixth `lang_id` input. Hardcoding either set silently produces confident
 * nonsense on the other — the encoder shapes are close enough to run.
 */
function readModelConfig(dir: string): NemotronModelConfig {
  const raw = JSON.parse(readFileSync(join(dir, 'genai_config.json'), 'utf8')) as {
    model: Record<string, number> & {
      encoder: { hidden_size: number; num_hidden_layers: number };
      decoder: { hidden_size: number; num_hidden_layers: number };
    };
  };
  const m = raw.model;
  const chunkFrames = m['chunk_samples']! / m['hop_length']!;
  return {
    sampleRate: m['sample_rate']!,
    nFft: m['fft_size']!,
    hopLength: m['hop_length']!,
    winLength: m['win_length']!,
    nMels: m['num_mels']!,
    preemphasis: m['preemph']!,
    logEpsilon: m['log_eps']!,
    chunkFrames,
    windowFrames: chunkFrames + m['pre_encode_cache_size']!,
    preEncodeCacheFrames: m['pre_encode_cache_size']!,
    encoderLayers: m.encoder.num_hidden_layers,
    hiddenSize: m.encoder.hidden_size,
    leftContext: m['left_context']!,
    convContext: m['conv_context']!,
    decoderHidden: m.decoder.hidden_size,
    decoderLayers: m.decoder.num_hidden_layers,
    blankId: m['blank_id']!,
    maxSymbolsPerStep: m['max_symbols_per_step']!,
    langId: LANG_ID_AUTO,
  };
}

/** Chunk of audio the encoder consumes per step, in samples. */
function chunkSamples(cfg: NemotronModelConfig): number {
  return cfg.chunkFrames * cfg.hopLength;
}

export interface NemotronOnnxSttEngineOptions {
  /** Overrides discovery entirely. */
  modelDir?: string;
  workerPool?: VoiceWorkerPool;
  logger?: ILogger;
  /** Silence (ms) that ends an utterance; overrides the env default. */
  endpointSilenceMs?: number;
}

export class NemotronOnnxSttEngine implements ISpeechToTextEngine {
  readonly name = 'nemotron-onnx:nvidia/nemotron-3.5-asr-streaming-0.6b';

  private readonly workerPool: VoiceWorkerPool | undefined;
  private readonly logger: ILogger | undefined;
  private readonly configuredDir: string | undefined;
  private readonly endpointSilenceMs: number;
  private loadPromise: Promise<void> | null = null;
  private nextSid = 1;
  /** Set by `load()` from the model's own genai_config.json. */
  private config: NemotronModelConfig | null = null;

  constructor(opts: NemotronOnnxSttEngineOptions = {}) {
    this.workerPool = opts.workerPool;
    this.logger = opts.logger;
    this.configuredDir = opts.modelDir ?? process.env['GENERATORAI_NEMOTRON_ONNX_DIR'];
    this.endpointSilenceMs = opts.endpointSilenceMs ?? ENDPOINT_SILENCE_MS;
  }

  load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.doLoad().catch((err: unknown) => {
        // Let the cascade retry on a later session rather than caching the
        // failure for the lifetime of the process.
        this.loadPromise = null;
        throw err;
      });
    }
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    const pool = this.workerPool;
    if (!pool) {
      // In-process execution is not offered even as a debug path: a 0.6B
      // encoder run per 560ms of audio on the event loop is an outage, not a
      // slow path.
      throw new Error(
        'Nemotron (ONNX) requires the voice worker pool; it cannot run on the main thread. ' +
          'Unset GENERATORAI_VOICE_IN_PROCESS=1 to enable it.',
      );
    }

    const dir = this.configuredDir ?? nemotronModelDir();
    if (!(await isNemotronModelPresent(dir))) {
      // Phrased for a person, because this string is what Settings and the
      // composer show when voice input is unavailable.
      throw new Error(
        'Nemotron speech model is not downloaded. Open Settings -> Audio and choose ' +
          `"Download model" to fetch it (about 790MB, from ${NEMOTRON_REPO}). ` +
          'Voice input stays unavailable until then.',
      );
    }

    const started = Date.now();
    const cfg = readModelConfig(dir);
    this.config = cfg;
    const vocab = parseVocab(readFileSync(join(dir, 'vocab.txt'), 'utf8'));
    await pool.loadNemotron({
      // The worker builds file paths from this, so hand it forward slashes.
      dir: dir.split(sep).join('/'),
      filters: melFilterbank(),
      window: hannWindow(cfg.winLength),
      vocab,
      config: { ...cfg },
    });
    this.logger?.info?.(
      `[stt] Nemotron (ONNX) ready in ${Date.now() - started}ms ` +
        `(vocab ${vocab.length}, blank ${cfg.blankId}, ${cfg.chunkFrames * cfg.hopLength / cfg.sampleRate}s chunks) from ${dir}`,
    );
  }

  /**
   * Batch transcription, expressed as a one-utterance stream.
   *
   * Nemotron has no separate batch mode — the streaming encoder IS the model
   * — so rather than keep a second code path, this opens a private stream,
   * feeds it everything and flushes. Used for the mobile record-then-upload
   * shape and by any caller that is not driving `createStream`.
   */
  async transcribe(pcm: Float32Array, _options?: SttTranscribeOptions): Promise<SttTranscribeResult> {
    await this.load();
    const pool = this.workerPool;
    if (!pool) return { text: '' };
    const sid = this.nextSid++;
    await pool.openNemotron(sid);
    try {
      await pool.pushNemotron(sid, pcm);
      const { text } = await pool.flushNemotron(sid);
      return { text };
    } finally {
      await pool.releaseNemotron(sid).catch(() => undefined);
    }
  }

  async createStream(cb: SttStreamCallbacks, _options?: SttTranscribeOptions): Promise<SttStreamHandle> {
    await this.load();
    const pool = this.workerPool;
    if (!pool) throw new Error(STT_STREAMING_UNSUPPORTED);

    const sid = this.nextSid++;
    const chunk = chunkSamples(this.config!);
    await pool.openNemotron(sid);

    // Endpointing is ours, not the model's: an RNNT emits blanks during
    // silence but never says "that was the end of a sentence". Same detector
    // the batch path segments with, so both behave identically at a pause.
    const vad = new EnergyVad({ silenceHangoverMs: this.endpointSilenceMs });

    let cancelled = false;
    let lastPartial = '';
    /** Audio handed to the worker since the last flush — a flush with none is a no-op. */
    let pushedSinceFlush = false;
    let pending: Float32Array[] = [];
    let pendingLength = 0;
    // Every worker call for this stream goes through one chain. The pool's
    // queue already preserves submission order; this additionally keeps
    // `pushAudio` (which is synchronous by contract) from interleaving a
    // flush between a push and its own partial.
    let chain: Promise<void> = Promise.resolve();

    const drainPending = (): Float32Array | null => {
      if (pendingLength === 0) return null;
      const merged = new Float32Array(pendingLength);
      let offset = 0;
      for (const part of pending) { merged.set(part, offset); offset += part.length; }
      pending = [];
      pendingLength = 0;
      return merged;
    };

    const pushToWorker = (audio: Float32Array): void => {
      chain = chain.then(async () => {
        if (cancelled) return;
        pushedSinceFlush = true;
        const { text } = await pool.pushNemotron(sid, audio);
        if (cancelled || !text || text === lastPartial) return;
        lastPartial = text;
        cb.onPartial(text);
      }).catch((err: unknown) => {
        if (!cancelled) cb.onError((err as Error).message);
      });
    };

    const flushUtterance = (): void => {
      chain = chain.then(async () => {
        if (cancelled || !pushedSinceFlush) return;
        pushedSinceFlush = false;
        const { text } = await pool.flushNemotron(sid);
        lastPartial = '';
        if (!cancelled && text) cb.onFinal(text);
      }).catch((err: unknown) => {
        if (!cancelled) cb.onError((err as Error).message);
      });
    };

    return {
      pushAudio: (pcm: Float32Array): void => {
        if (cancelled) return;
        // The VAD sees every chunk, at the cadence the client sends them.
        const endpointed = vad.pushChunk(pcm);
        pending.push(new Float32Array(pcm));
        pendingLength += pcm.length;

        if (endpointed > 0) {
          // Trailing silence is NOT trimmed the way the batch path trims it:
          // it is what lets the encoder decode the final words of the
          // utterance, and the model is untroubled by a few hundred ms of it.
          const audio = drainPending();
          if (audio) pushToWorker(audio);
          flushUtterance();
          return;
        }
        // Otherwise hand over whole encoder chunks. Sending each 100ms client
        // frame separately would be five round trips per chunk that the
        // worker could not act on anyway.
        if (pendingLength >= chunk) {
          const audio = drainPending();
          if (audio) pushToWorker(audio);
        }
      },
      finish: async (): Promise<void> => {
        if (cancelled) return;
        const audio = drainPending();
        if (audio) pushToWorker(audio);
        flushUtterance();
        await chain;
        await pool.releaseNemotron(sid).catch(() => undefined);
      },
      cancel: (): void => {
        cancelled = true;
        void pool.releaseNemotron(sid).catch(() => undefined);
      },
    };
  }

  async dispose(): Promise<void> {
    this.loadPromise = null;
  }
}
