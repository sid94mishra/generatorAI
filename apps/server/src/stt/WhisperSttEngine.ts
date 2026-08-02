// ────────────────────────────────────────────────────────────────
// WhisperSttEngine — local, CPU, free speech-to-text.
//
// Runs OpenAI Whisper (base.en by default) fully on-device via
// transformers.js + onnxruntime-node. No Python, no GPU, no cloud, no
// API key, no per-use cost. The model (~140 MB for base.en) is
// downloaded once from the Hugging Face hub and cached on disk; every
// transcription after that is a local function call and works offline.
//
// The transformers.js dependency is imported dynamically so a missing
// install degrades gracefully (STT simply reports unavailable) instead
// of crashing server startup.
//
// Config (env):
//   STT_MODEL      — HF model id (default 'Xenova/whisper-base.en')
//   STT_CACHE_DIR  — where to cache model files (default: library default)
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { ISttEngine, SttTranscribeOptions, SttTranscribeResult } from './ISttEngine.js';

/** Minimal shape of the transformers.js ASR pipeline we rely on. */
type AsrPipeline = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text?: string } | Array<{ text?: string }>>;

const DEFAULT_MODEL = 'Xenova/whisper-base.en';

export class WhisperSttEngine implements ISttEngine {
  readonly name: string;

  private readonly modelId: string;
  private readonly logger?: ILogger;
  private readonly isEnglishOnly: boolean;
  private pipeline: AsrPipeline | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(opts: { modelId?: string; logger?: ILogger } = {}) {
    this.modelId = opts.modelId ?? process.env['STT_MODEL'] ?? DEFAULT_MODEL;
    this.logger = opts.logger;
    // Whisper English-only checkpoints end in `.en` (e.g. whisper-base.en).
    this.isEnglishOnly = /\.en$/i.test(this.modelId);
    this.name = `whisper:${this.modelId}`;
  }

  load(): Promise<void> {
    // Coalesce concurrent loads — the first caller triggers the download,
    // everyone else awaits the same promise.
    if (this.pipeline) return Promise.resolve();
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
    this.logger?.info?.(`[stt] loading model ${this.modelId} (first run downloads ~140MB, then cached)`);

    let mod: {
      pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<AsrPipeline>;
      env: Record<string, unknown>;
    };
    try {
      // Dynamic import keeps the optional dep out of the startup path.
      mod = (await import('@huggingface/transformers')) as unknown as typeof mod;
    } catch {
      throw new Error(
        "Speech-to-text engine unavailable: '@huggingface/transformers' is not installed. " +
          'Run `pnpm --filter @generatorai/server add @huggingface/transformers` to enable voice input.',
      );
    }

    // Cache location for downloaded model weights (persist across runs).
    const cacheDir = process.env['STT_CACHE_DIR'];
    if (cacheDir) {
      (mod.env as { cacheDir?: string }).cacheDir = cacheDir;
    }

    this.pipeline = await mod.pipeline('automatic-speech-recognition', this.modelId);
    this.logger?.info?.(`[stt] model ready in ${Date.now() - started}ms`);
  }

  async transcribe(pcm: Float32Array, options?: SttTranscribeOptions): Promise<SttTranscribeResult> {
    if (!this.pipeline) await this.load();
    const pipe = this.pipeline;
    if (!pipe) return { text: '' };

    // English-only Whisper models (id ends in `.en`) REJECT the `language`
    // and `task` options — passing them throws "Cannot specify `task` or
    // `language` for an English-only model". Only forward them for
    // multilingual models (e.g. a future `whisper-small` swap).
    const runOpts: Record<string, unknown> = { chunk_length_s: 30, stride_length_s: 5 };
    if (!this.isEnglishOnly && options?.language) {
      runOpts['language'] = options.language;
      runOpts['task'] = 'transcribe';
    }

    const out = await pipe(pcm, runOpts);
    const text = Array.isArray(out)
      ? out.map((o) => o.text ?? '').join(' ')
      : (out.text ?? '');
    return { text: normalizeTranscript(text) };
  }

  async dispose(): Promise<void> {
    // transformers.js has no explicit teardown; drop the reference so GC
    // can reclaim the session.
    this.pipeline = null;
    this.loadPromise = null;
  }
}

/** Trim whitespace and collapse Whisper's occasional leading spaces. */
function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
