// ────────────────────────────────────────────────────────────────
// TtsSessionRunner — per-speak() session, text-in/audio-out.
//
// Mirrors SttSessionRunner's shape for the opposite direction of the same
// module. Accepts EITHER a plain string (Phase 3 — "read this message
// aloud") or a live `AsyncIterable<string>` (Phase 4 — the agent's own
// token stream). Both paths funnel through the SAME sentence-at-a-time
// synthesis loop, via SentenceBoundaryBuffer, so synthesis of sentence N
// overlaps whatever produces sentence N+1 (further generation on the live
// path; nothing on the string path, where the win is purely that playback
// starts after the first sentence instead of the last). Phase 4 is
// additive, not a redesign, exactly as
// VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part E predicts.
//
// `stop()` (Part E Phase 4 — barge-in/interruption) sets a flag checked
// between every yielded audio chunk and before starting each new sentence,
// so playback/synthesis halts promptly without needing to cancel an
// in-flight `engine.synthesize()` call.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { ITextToSpeechEngine, TtsSynthesizeOptions } from '../../domain/ports/ITextToSpeechEngine.js';
import { SentenceBoundaryBuffer } from './SentenceBoundaryBuffer.js';

/**
 * Engine options plus the run-level hooks that are this runner's business
 * rather than the engine's — `onSentence` never reaches `ITextToSpeechEngine`.
 */
export interface TtsRunOptions extends TtsSynthesizeOptions {
  /**
   * Called immediately BEFORE the audio for each sentence is yielded, so a
   * transport can mark where one sentence's audio ends and the next begins.
   *
   * Raw PCM chunks carry no boundaries of their own, and a client that can
   * only play whole files (React Native — expo-audio has no PCM queue) has
   * to cut the stream somewhere. Cutting on sentences means the unavoidable
   * gap between files lands where a speaker would pause anyway, instead of
   * mid-word. Web ignores it and schedules the chunks gaplessly as before.
   */
  onSentence?: () => void;
}

export class TtsSessionRunner {
  private stopped = false;

  constructor(
    private readonly engine: ITextToSpeechEngine,
    private readonly logger?: ILogger,
  ) {}

  /** Barge-in: stop synthesizing/yielding further audio. Idempotent. */
  stop(): void {
    this.stopped = true;
  }

  /**
   * Synthesize `text` (or a live token stream) and yield audio chunks as
   * they become available, in speech order. Never throws — a failed
   * sentence is logged and skipped so the rest of the utterance still
   * plays, matching every other engine's graceful-degradation posture in
   * this module.
   */
  async *run(text: string | AsyncIterable<string>, opts?: TtsRunOptions): AsyncGenerator<Float32Array> {
    // A finished string is just a token stream of length one. Funnelling it
    // through the SAME buffer as the live path is what makes this class's
    // header claim true, and it is not cosmetic: synthesis cost scales with
    // the text handed to the engine in ONE call, so a 3-sentence message
    // synthesized whole produces NO audio for ~6.5s, while the same message
    // synthesized sentence-at-a-time starts playing after ~2.3s and streams
    // the rest underneath it (measured on the reference machine with
    // Kokoro q8 — RTF ≈0.9, so wall-clock ≈ length of the text). Time to
    // first audio is the number a listener actually experiences, and this
    // is the single biggest lever on it.
    const deltas = typeof text === 'string' ? once(text) : text;
    const buffer = new SentenceBoundaryBuffer();
    for await (const delta of deltas) {
      if (this.stopped) return;
      for (const sentence of buffer.push(delta)) {
        if (this.stopped) return;
        yield* this.synthesizeSentence(sentence, opts);
      }
    }
    if (this.stopped) return;
    const tail = buffer.flush();
    if (tail) yield* this.synthesizeSentence(tail, opts);
  }

  private async *synthesizeSentence(sentence: string, opts?: TtsRunOptions): AsyncGenerator<Float32Array> {
    if (!sentence.trim() || this.stopped) return;
    // Announce the boundary before any of this sentence's audio is yielded,
    // and only for a sentence we are actually going to synthesize.
    opts?.onSentence?.();
    try {
      for await (const chunk of this.engine.synthesize(sentence, engineOptionsOf(opts))) {
        if (this.stopped) return;
        yield chunk;
      }
    } catch (err) {
      this.logger?.warn?.(`[tts] synthesize failed for one sentence, skipping it: ${(err as Error).message}`);
    }
  }
}

/** Adapt a finished string to the same one-delta-at-a-time shape as a live stream. */
async function* once(text: string): AsyncIterable<string> {
  yield text;
}

/**
 * Strip the runner-level hooks so the engine port only ever sees its own
 * options — and hand it `undefined` rather than an empty object when there
 * is nothing to pass, since "no options" is the shape engines are written
 * and tested against.
 */
function engineOptionsOf(opts?: TtsRunOptions): TtsSynthesizeOptions | undefined {
  if (!opts) return undefined;
  const { onSentence: _hook, ...engineOpts } = opts;
  void _hook;
  return Object.keys(engineOpts).length > 0 ? engineOpts : undefined;
}
