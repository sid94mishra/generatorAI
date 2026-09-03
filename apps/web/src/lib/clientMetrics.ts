// ────────────────────────────────────────────────────────────────
// clientMetrics — counters for the expensive fallback paths.
//
// L15 of the plan: every expensive fallback increments a counter a test
// asserts on. A fallback nobody counts is a fallback nobody notices — the
// browser screencast silently degrading from a WebSocket to 5 HTTP GETs a
// second, or a resume skipping events older than the dedup window, both look
// exactly like "working" from the outside.
//
// Deliberately separate from any server-side counter registry: those are
// built on `@opentelemetry/api`, and importing an OTel facade into the browser
// bundle to increment three integers is not a trade the 800 KB budget can
// afford. The names here mirror the server's where a fallback exists on both
// sides (`browser_screencast_http_poll`).
//
// Modelled on the CLI's `StreamReconciler.metrics`: a plain object of
// monotonically increasing counters, no sampling, no transport. The UI reads
// what it needs to surface (see `connectionStore.recordGap`); everything else
// is here for `window.__generatoraiMetrics` in a devtools console and for
// tests that assert a fallback did — or did not — fire.
// ────────────────────────────────────────────────────────────────

export interface ClientMetrics {
  /**
   * The browser live view gave up on its WebSocket and fell back to polling
   * `screencast.jpg`. That is ~5 HTTP round trips a second per visible tab.
   */
  browserScreencastHttpFallback: number;
  /** Screencast frames dropped without decoding because the tab was hidden. */
  browserFramesDroppedHidden: number;
  /** Stall-watchdog / resync refills of the event stream. */
  streamGapFills: number;
  /** Events recovered by those refills. */
  streamGapFilledEvents: number;
  /**
   * Sequences a resume could NOT recover: the hole was older than the dedup
   * window, so gap fill clamped past it. This is silent data loss unless
   * something says so — N4.
   */
  streamGapSkippedEvents: number;
  /**
   * Markdown rendered without the incremental fast path — the whole buffer
   * re-parsed because a link-reference definition made block splitting
   * unsafe (see IncrementalMarkdown).
   */
  markdownFullReparse: number;
  /** Incremental markdown splits that reused the previous prefix state. */
  markdownIncrementalReuse: number;
}

const ZERO: ClientMetrics = {
  browserScreencastHttpFallback: 0,
  browserFramesDroppedHidden: 0,
  streamGapFills: 0,
  streamGapFilledEvents: 0,
  streamGapSkippedEvents: 0,
  markdownFullReparse: 0,
  markdownIncrementalReuse: 0,
};

export const clientMetrics: ClientMetrics = { ...ZERO };

/** Bump a counter. Named rather than `metrics.x++` so every call site greps. */
export function countFallback(name: keyof ClientMetrics, by = 1): void {
  clientMetrics[name] += by;
}

/** Reset every counter. Test-only; there is no production reason to zero these. */
export function _resetClientMetrics(): void {
  Object.assign(clientMetrics, ZERO);
}

// Expose for devtools. Guarded because this module is imported by the
// vitest suite too, where `window` exists but nothing should be attached to
// a shared global between files.
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as unknown as { __generatoraiMetrics?: ClientMetrics }).__generatoraiMetrics =
    clientMetrics;
}
