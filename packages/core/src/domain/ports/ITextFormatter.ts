// ────────────────────────────────────────────────────────────────
// ITextFormatter — voice-dictation transcript cleanup seam (Phase 2).
//
// Applied ONLY to a committed segment/final transcript, never to a live
// interim preview — VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md's Part B.5 flow
// diagram places this between the STT engine and caret-insertion:
// "engine → ITextFormatter → cleaned segment text → inserted at caret."
// Running it on every 900ms interim tick too would multiply latency/cost
// (especially for an LLM-backed implementation) for a preview the user
// never edits anyway.
//
// Implementations must never let a formatting failure break dictation —
// on any internal error, return the original, unformatted text rather
// than throwing. This is defense in depth, not a single point of
// responsibility: `SttSessionRunner.applyFormatter()` ALSO wraps every
// call to this port in its own try/catch and falls back to the
// unformatted text on error, so a caller of this port is protected even if
// a given implementation doesn't hold up its end of the contract above —
// but don't rely on that as a substitute for doing it right in the
// implementation too (see LlmTextFormatter.ts's own resilience handling).
// ────────────────────────────────────────────────────────────────

export interface TextFormatterOptions {
  /** BCP-47 language hint. Implementations may ignore it. */
  language?: string;
}

export interface ITextFormatter {
  /** Human-readable id for logs/telemetry (e.g. 'rule-based', 'llm:gpt-4o-mini'). */
  readonly name: string;

  /**
   * Clean up a finalized transcript segment (filler-word removal,
   * spoken-punctuation-command handling, or an LLM rewrite, depending on
   * the implementation). Must be safe to call repeatedly and concurrently
   * — implementations should not hold per-call mutable state.
   */
  format(text: string, opts?: TextFormatterOptions): Promise<string>;

  /**
   * OPTIONAL: the subset of `format` that is safe to run on a live partial.
   *
   * Streaming engines emit partials several times a second and the composer
   * now shows them directly, so a user watching their own dictation sees
   * every "um" and "uh" the model faithfully transcribed appear in the text
   * — and, on a long unbroken utterance, sit there until the segment finally
   * commits. Cleaning them as they arrive is what makes dictated text look
   * dictated rather than transcribed.
   *
   * Constraints that make this different from `format`, and why it is a
   * separate method rather than a flag:
   *   - SYNCHRONOUS. It runs on every partial; an await per partial would put
   *     a network round-trip in front of the composer.
   *   - IDEMPOTENT and monotone. A partial is re-rendered continuously as it
   *     grows, so the same prefix must clean to the same thing every time or
   *     the text visibly flickers.
   *
   * An implementation that cannot meet both (an LLM rewrite cannot) simply
   * omits this, and partials are shown unmodified.
   */
  formatInterim?(text: string, opts?: TextFormatterOptions): string;
}
