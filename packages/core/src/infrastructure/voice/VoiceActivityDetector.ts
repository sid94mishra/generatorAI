// ────────────────────────────────────────────────────────────────
// VoiceActivityDetector — the seam SttSessionRunner segments through.
//
// Deliberately tiny and synchronous. `SttSessionRunner.pushAudio()` runs on
// the WebSocket message path, and making segmentation async would put
// ordering hazards into the hot path for every detector — including the ones
// that need nothing of the sort. A detector whose underlying model IS async
// (see SileroVad) pipelines internally and answers one chunk later rather
// than changing this contract.
// ────────────────────────────────────────────────────────────────

export interface VoiceActivityDetector {
  /**
   * Feed one chunk of mono Float32 PCM.
   *
   * Returns `0` while the utterance is still open. When sustained silence is
   * detected after voiced audio, returns the number of trailing silent
   * samples accumulated — the caller trims exactly that many off the TAIL of
   * its segment before transcribing, so the silence used to *detect* the end
   * of the utterance does not become padding on the audio sent to the engine.
   * The detector resets itself at the same moment, so the next utterance in
   * the session is detected independently.
   */
  pushChunk(pcm: Float32Array): number;

  /** Discard all state — used on pause()/cancel() so a fresh utterance starts clean. */
  reset(): void;
}
