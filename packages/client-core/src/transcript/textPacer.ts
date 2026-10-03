// ────────────────────────────────────────────────────────────────
// Streaming-text pacer (D-91). Providers deliver text in bursts — nothing for
// 300 ms, then 400 characters at once — and painting each burst as it lands
// reads as jitter. The pacer reveals the text that has ARRIVED at a steady,
// adaptive rate, one animation frame at a time, ending on a word boundary:
//
//   rate = max(minimum, rate so far, backlog / drain)
//
// The rate rises to whatever shows the current backlog within ~`drainMs` and
// holds until the backlog is gone (then falls back to the minimum), so a burst
// is drained linearly — never later than `drainMs` after it arrived — and a
// slow stream is shown as fast as it comes. It holds nothing back for its own sake: the caller shows
// the full text the moment the turn ends, the page is hidden or the reader is
// not watching (scrolled away, switched view mode). With reduced motion it
// reveals whole bursts in steps (`reducedStepMs`) instead of animating.
//
// Pure and React-free: web (`usePacedText`) and mobile drive it from their
// own frame loops.
// ────────────────────────────────────────────────────────────────

export interface TextPacerOptions {
  /** Time to show a backlog at the adaptive rate. Default 1,200 ms. */
  drainMs?: number;
  /** Lowest reveal rate, in characters per second. Default 90. */
  minCharsPerSecond?: number;
  /** Reveal whole bursts every `reducedStepMs` instead of animating. */
  reducedMotion?: boolean;
  /** Step for reduced motion. Default 250 ms. */
  reducedStepMs?: number;
  /** How far past the target the reveal may run to finish a word. Default 24 characters. */
  wordSlack?: number;
}

export interface TextPacerState {
  /** Characters revealed. */
  shown: number;
  /** Fractional characters carried to the next frame. */
  carry: number;
  /** Reduced motion: time since the last step. */
  sinceStep: number;
  /** Current reveal rate in characters per ms (held until the backlog drains). */
  rate: number;
}

export const INITIAL_PACER_STATE: TextPacerState = { shown: 0, carry: 0, sinceStep: 0, rate: 0 };

const WORD_END = /[\s.,;:!?)\]}”’]/;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Moves `index` forward to the end of the current word (bounded), never inside a surrogate pair. */
export function snapToWordEnd(text: string, index: number, slack = 24): number {
  if (index >= text.length) return text.length;
  let i = index;
  const limit = Math.min(text.length, index + slack);
  while (i < limit && !WORD_END.test(text[i]!)) i += 1;
  if (i > 0 && i < text.length && isHighSurrogate(text.charCodeAt(i - 1))) i += 1;
  return i;
}

/**
 * Advances the reveal by one frame of `dtMs` toward `text`. Returns the new
 * state; `state.shown` is how much of `text` to paint. A text that shrank
 * (rewind, a new turn) restarts from its new length.
 */
export function advancePacer(state: TextPacerState, text: string, dtMs: number, options: TextPacerOptions = {}): TextPacerState {
  const total = text.length;
  if (state.shown >= total) return { shown: total, carry: 0, sinceStep: 0, rate: 0 };
  const dt = Math.max(0, Math.min(dtMs, 100));
  if (options.reducedMotion) {
    const sinceStep = state.sinceStep + dt;
    if (sinceStep < (options.reducedStepMs ?? 250)) return { ...state, sinceStep };
    return { shown: total, carry: 0, sinceStep: 0, rate: 0 };
  }
  const backlog = total - state.shown;
  const drainMs = options.drainMs ?? 1200;
  const minRate = (options.minCharsPerSecond ?? 90) / 1000;
  const rate = Math.max(minRate, state.rate, backlog / drainMs);
  const exact = rate * dt + state.carry;
  const step = Math.floor(exact);
  if (step <= 0) return { shown: state.shown, carry: exact, sinceStep: 0, rate };
  const target = Math.min(total, state.shown + step);
  const shown = snapToWordEnd(text, target, options.wordSlack ?? 24);
  return { shown, carry: shown > target ? 0 : exact - step, sinceStep: 0, rate: shown >= total ? 0 : rate };
}

/** Everything that has arrived, at once (turn ended, page hidden, the reader looked away). */
export function flushPacer(text: string): TextPacerState {
  return { shown: text.length, carry: 0, sinceStep: 0, rate: 0 };
}
