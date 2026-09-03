// ────────────────────────────────────────────────────────────────
// CascadingSttEngine — tries a list of engines in order, sticks with the
// first one that loads successfully.
//
// This is how "Parakeet primary, Whisper kept as an explicit fallback, never
// removed" (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part E, Phase 1) is
// implemented safely. The Parakeet model id IS Hub-verified and loads (see
// ParakeetSttEngine.ts's header) — this is not a hedge against a guessed
// id any more. What it still guards is everything that can go wrong at
// load time on a real machine: no network on first run, a wiped model
// cache, a `PARAKEET_MODEL` override pointing somewhere that 404s, or an
// out-of-memory ONNX session. Composing engines this way means any of
// those degrades to "exactly today's Whisper behavior," never to "voice
// input stops working."
//
// Note the asymmetry this creates, because it is deliberate: whichever
// engine wins the race stays active for the process's lifetime. There is no
// per-request retry back to Parakeet once Whisper has taken over — a
// dictation session must not change engine mid-utterance, and a user who
// started the day on Whisper gets a consistent experience rather than one
// that silently changes latency and punctuation behaviour halfway through.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import {
  STT_STREAMING_UNSUPPORTED,
  type ISpeechToTextEngine,
  type SttStreamCallbacks,
  type SttStreamHandle,
  type SttTranscribeOptions,
  type SttTranscribeResult,
} from '../../domain/ports/ISpeechToTextEngine.js';

export class CascadingSttEngine implements ISpeechToTextEngine {
  private active: ISpeechToTextEngine | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(
    private readonly candidates: ISpeechToTextEngine[],
    private readonly logger?: ILogger,
  ) {
    if (candidates.length === 0) {
      throw new Error('[CascadingSttEngine] requires at least one candidate engine');
    }
  }

  get name(): string {
    return this.active ? this.active.name : `cascading:${this.candidates.map((c) => c.name).join('|')}`;
  }

  load(): Promise<void> {
    if (this.active) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad().catch((err) => {
      this.loadPromise = null;
      throw err;
    });
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    let lastError: Error | null = null;
    for (const candidate of this.candidates) {
      try {
        await candidate.load();
        this.active = candidate;
        if (lastError) {
          this.logger?.warn?.(
            `[CascadingSttEngine] falling back to ${candidate.name} after an earlier candidate failed to load: ${lastError.message}`,
          );
        }
        return;
      } catch (err) {
        lastError = err as Error;
        this.logger?.warn?.(`[CascadingSttEngine] candidate ${candidate.name} failed to load: ${lastError.message}`);
      }
    }
    throw lastError ?? new Error('[CascadingSttEngine] no candidate engines');
  }

  async transcribe(pcm: Float32Array, options?: SttTranscribeOptions): Promise<SttTranscribeResult> {
    if (!this.active) await this.load();
    if (!this.active) return { text: '' };
    return this.active.transcribe(pcm, options);
  }

  /**
   * Forward live streaming to whichever candidate actually won.
   *
   * Without this the cascade silently erased the capability: `SttSessionRunner`
   * checks `typeof engine.createStream === 'function'`, the wrapper did not
   * define it, so a Nemotron session behind `auto` fell back to VAD-segmented
   * batch transcription and the user got blocks of text instead of words as
   * they spoke. The wrapper has to expose the method unconditionally — it
   * cannot know which candidate will load until it tries — and report
   * unsupported at call time.
   */
  async createStream(cb: SttStreamCallbacks, options?: SttTranscribeOptions): Promise<SttStreamHandle> {
    if (!this.active) await this.load();
    const active = this.active;
    if (!active?.createStream) throw new Error(STT_STREAMING_UNSUPPORTED);
    return active.createStream(cb, options);
  }

  async dispose(): Promise<void> {
    await Promise.all(this.candidates.map((c) => c.dispose().catch(() => undefined)));
    this.active = null;
    this.loadPromise = null;
  }
}
