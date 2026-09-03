// ────────────────────────────────────────────────────────────────
// ITextToSpeechEngine — text-to-speech engine seam.
//
// Defined in Phase 0 alongside ISpeechToTextEngine even though the first
// implementation (Kokoro) doesn't land until Phase 3 — see
// docs/VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part E: "speak()'s signature
// already accepts a text stream from Phase 0 onward, so Phase 4 is a pure
// addition to an already-correct interface, not a redesign of it." The
// stream-composition (buffering an agent's token stream into sentences) is
// `VoiceService.speak()`'s job, not this port's — the port itself
// synthesizes one already-assembled string at a time (Part B.2).
// ────────────────────────────────────────────────────────────────

export interface TtsSynthesizeOptions {
  /** BCP-47 language hint. Engines may ignore it. */
  language?: string;
  /** Voice/speaker id, engine-specific. Engines fall back to a default. */
  voice?: string;
  /** Playback speed multiplier (1.0 = normal). Engines may clamp/ignore. */
  speed?: number;
}

export interface ITextToSpeechEngine {
  /** Human-readable id for logs/telemetry (e.g. 'kokoro-82m'). */
  readonly name: string;

  /** Sample rate (Hz) of every Float32Array chunk yielded by `synthesize`. */
  readonly sampleRate: number;

  /**
   * Ensure the model is loaded and ready. Safe to call repeatedly. Throws if
   * the engine cannot be initialised (e.g. optional dependency missing).
   */
  load(): Promise<void>;

  /**
   * Streams audio as it's synthesized — callers never block on the whole
   * utterance. Each yielded chunk is mono Float32 PCM at `sampleRate`.
   */
  synthesize(text: string, opts?: TtsSynthesizeOptions): AsyncIterable<Float32Array>;

  /** Release model resources. Best-effort. */
  dispose(): Promise<void>;
}
