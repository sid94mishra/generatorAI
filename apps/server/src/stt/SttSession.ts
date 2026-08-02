// ────────────────────────────────────────────────────────────────
// SttSession — per-connection speech-to-text state machine.
//
// One instance per open WebSocket. It accumulates the incoming 16 kHz
// mono Float32 audio, runs debounced *interim* transcriptions on the
// growing buffer while the user speaks (so the chat box fills in near
// real time), and one *final* pass when the user stops.
//
// Whisper is not natively streaming, so we approximate live results by
// re-transcribing the accumulated buffer on a short debounce. For the
// short-to-medium utterances typical of a chat prompt this is fast
// enough on a laptop CPU. A future optimisation could switch to a
// sliding-window / chunked strategy for very long dictations.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { ISttEngine } from './ISttEngine.js';

/** How often (ms) to run an interim pass while audio keeps arriving. */
const INTERIM_DEBOUNCE_MS = 900;
/** Don't bother transcribing until we have at least this much audio. */
const MIN_INTERIM_SAMPLES = 16_000 * 0.6; // 0.6s @ 16 kHz
/** Safety cap so a stuck client can't grow the buffer unbounded (~120s). */
const MAX_SAMPLES = 16_000 * 120;

export interface SttSessionCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

export class SttSession {
  private chunks: Float32Array[] = [];
  private totalSamples = 0;
  private language?: string;
  private transcribing = false;
  private interimTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingInterim = false;
  private stopped = false;
  private lastInterim = '';

  constructor(
    private readonly engine: ISttEngine,
    private readonly cb: SttSessionCallbacks,
    private readonly logger?: ILogger,
  ) {}

  /** Configure the session (language hint) and warm the model. */
  start(language?: string): void {
    this.language = language;
    // Kick off model load so the first interim isn't blocked on download.
    void this.engine.load().catch((err) => {
      this.cb.onError((err as Error).message);
    });
  }

  /** Append a chunk of 16 kHz mono Float32 PCM. */
  pushAudio(pcm: Float32Array): void {
    if (this.stopped) return;
    if (this.totalSamples >= MAX_SAMPLES) return;
    this.chunks.push(pcm);
    this.totalSamples += pcm.length;
    this.scheduleInterim();
  }

  private scheduleInterim(): void {
    if (this.interimTimer) return;
    this.interimTimer = setTimeout(() => {
      this.interimTimer = null;
      void this.runInterim();
    }, INTERIM_DEBOUNCE_MS);
  }

  private merged(): Float32Array {
    const out = new Float32Array(this.totalSamples);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }

  private async runInterim(): Promise<void> {
    if (this.stopped || this.transcribing) {
      // A pass is already running (or we're finalising); mark that fresh
      // audio arrived so we run again right after.
      this.pendingInterim = true;
      return;
    }
    if (this.totalSamples < MIN_INTERIM_SAMPLES) return;
    this.transcribing = true;
    try {
      const { text } = await this.engine.transcribe(this.merged(), { language: this.language });
      if (!this.stopped && text && text !== this.lastInterim) {
        this.lastInterim = text;
        this.cb.onInterim(text);
      }
    } catch (err) {
      this.logger?.warn?.(`[stt] interim transcribe failed: ${(err as Error).message}`);
    } finally {
      this.transcribing = false;
      if (this.pendingInterim && !this.stopped) {
        this.pendingInterim = false;
        this.scheduleInterim();
      }
    }
  }

  /** Finalise: run one last transcription and emit the final transcript. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.interimTimer) {
      clearTimeout(this.interimTimer);
      this.interimTimer = null;
    }
    // Wait for any in-flight interim to settle so we don't overlap.
    for (let i = 0; i < 50 && this.transcribing; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    if (this.totalSamples === 0) {
      this.cb.onFinal('');
      return;
    }
    try {
      const { text } = await this.engine.transcribe(this.merged(), { language: this.language });
      this.cb.onFinal(text);
    } catch (err) {
      this.cb.onError((err as Error).message);
    }
  }

  /** Discard everything without emitting a final transcript. */
  cancel(): void {
    this.stopped = true;
    if (this.interimTimer) {
      clearTimeout(this.interimTimer);
      this.interimTimer = null;
    }
    this.chunks = [];
    this.totalSamples = 0;
  }
}
