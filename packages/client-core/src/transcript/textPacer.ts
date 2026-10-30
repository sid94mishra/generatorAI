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
// With `easeMs` (D-152) the rate is a velocity that eases toward
// `backlog / drain` instead of jumping to it and holding: a burst speeds the
// reveal up gradually and the end of a burst slows it down gradually, so text
// glides rather than lurching. The lag stays bounded: the rate never falls
// below `backlog / (2 × drainMs)`.
//
// With `maxCharsPerSecond` (D-160) the reveal holds a reading pace instead of
// matching the model, which streams far faster than anyone reads: the rate is
// capped there until the backlog would show later than `maxLagMs`, then it
// rises just enough to keep within it.
//
// `visibleLength` (D-160) paints only markdown that renders as it will stay:
// a table row, a code line or a fence appears once it is complete, a table's
// header with its delimiter row, and a list item or heading with its first
// word. Painted half-typed, each of those rendered as something else for a
// few frames (pipes as a paragraph, `-` as a setext underline) and flickered.
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
  /** How far past the target the reveal may run to finish a word. Default 24 characters; 0 reveals by character. */
  wordSlack?: number;
  /** Time constant, in ms, of the eased rate; omitted = the rate jumps to the backlog and holds per burst. */
  easeMs?: number;
  /** Reading pace: the rate is held at or below this (characters per second) while the lag stays within `maxLagMs`. */
  maxCharsPerSecond?: number;
  /** Longest the reveal may trail what arrived, in ms. Default twice `drainMs`. */
  maxLagMs?: number;
}

export interface TextPacerState {
  /** Characters revealed. */
  shown: number;
  /** Fractional characters carried to the next frame (negative: owed after finishing a word). */
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
  const dt = Math.max(0, Math.min(dtMs, 100));
  const ease = options.easeMs;
  // Caught up: an eased rate coasts down, so the next burst starts from where this one left off.
  if (state.shown >= total) return { shown: total, carry: 0, sinceStep: 0, rate: ease ? state.rate * Math.exp(-dt / ease) : 0 };
  if (options.reducedMotion) {
    const sinceStep = state.sinceStep + dt;
    if (sinceStep < (options.reducedStepMs ?? 250)) return { ...state, sinceStep };
    return { shown: total, carry: 0, sinceStep: 0, rate: 0 };
  }
  const backlog = total - state.shown;
  const drainMs = options.drainMs ?? 1200;
  const minRate = (options.minCharsPerSecond ?? 90) / 1000;
  const lagMs = options.maxLagMs ?? 2 * drainMs;
  // The rate a backlog asks for, held to the reading pace unless that would trail by more than `maxLagMs`.
  let goal = minRate + backlog / drainMs;
  if (options.maxCharsPerSecond !== undefined) goal = Math.min(goal, Math.max(options.maxCharsPerSecond / 1000, backlog / lagMs));
  // Eased: the velocity glides toward the goal (it never stalls on a small backlog), and is never below
  // `backlog / maxLag`, so a big burst is not left far behind. Not eased: it jumps to the backlog and holds.
  const rate = ease
    ? Math.max(backlog / lagMs, state.rate + (goal - state.rate) * (1 - Math.exp(-dt / ease)))
    : Math.max(minRate, state.rate, backlog / drainMs);
  const exact = rate * dt + state.carry;
  const step = Math.floor(exact);
  if (step <= 0) return { shown: state.shown, carry: exact, sinceStep: 0, rate };
  const target = Math.min(total, state.shown + step);
  const shown = snapToWordEnd(text, target, options.wordSlack ?? 24);
  // Finishing a word runs ahead of the rate: the overshoot is a debt the next frames pay, so whole-word
  // reveal keeps the same pace as by-character.
  return { shown, carry: exact - (shown - state.shown), sinceStep: 0, rate: shown >= total && !ease ? 0 : rate };
}

// ── What to paint ────────────────────────────────────────────────

const FENCE = /^ {0,3}(?:```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
/** A line-start marker: list bullet or number, heading hashes, blockquote — and the space after it. */
const LINE_MARKER = /^\s*(?:[-*+]|\d{1,9}[.)]|#{1,6}|>)(?:\s+|$)/;
/** Only rule characters (`---`, `===`, `***`): a thematic break or a setext underline once complete. */
const RULE_LINE = /^\s*[-=*_]+\s*$/;

function lineAt(text: string, start: number): { end: number; complete: boolean } {
  const nl = text.indexOf('\n', start);
  return nl === -1 ? { end: text.length, complete: false } : { end: nl, complete: true };
}

/**
 * How much of `text[0, shown)` to paint (D-160): `shown`, floored to the start
 * of a markdown unit that would render as something else while half-typed —
 * an unfinished table row, fence or line of code; a table header before its
 * delimiter row; a list marker or heading before its first word; a rule line.
 * `complete` says no more text will arrive (the last line then counts as done).
 */
export function visibleLength(text: string, shown: number, complete = false): number {
  const n = Math.max(0, Math.min(shown, text.length));
  if (n === 0) return 0;
  const start = text.lastIndexOf('\n', n - 1) + 1;
  if (start === n) return n;
  const line = lineAt(text, start);
  const lineText = text.slice(start, line.end);
  // Done once every character of it is shown and either its newline arrived or nothing more will.
  const done = n >= line.end && (line.complete || complete);
  if (!done) {
    // Inside an open fence (an odd number of fence lines above), or on a fence line: whole lines only.
    let fences = 0;
    for (let i = 0; i < start; ) {
      const l = lineAt(text, i);
      if (FENCE.test(text.slice(i, l.end))) fences += 1;
      i = l.end + 1;
    }
    if (fences % 2 === 1 || FENCE.test(lineText)) return start;
    if (TABLE_ROW.test(lineText)) {
      // A delimiter row under a header hides the header too: the pair renders as a table only together.
      const prevStart = start > 0 ? text.lastIndexOf('\n', start - 2) + 1 : -1;
      if (prevStart >= 0 && TABLE_DELIMITER.test(lineText) && TABLE_ROW.test(text.slice(prevStart, start - 1))) return prevStart;
      return start;
    }
    if (RULE_LINE.test(lineText)) return start;
    const marker = LINE_MARKER.exec(lineText);
    if (marker && n - start <= marker[0].length) return start;
    return n;
  }
  // A finished header row waits for its delimiter row (shown with it, from the delimiter's own line).
  if (TABLE_ROW.test(lineText) && !TABLE_DELIMITER.test(lineText) && !(complete && line.end === text.length)) {
    const prevStart = start > 0 ? text.lastIndexOf('\n', start - 2) + 1 : -1;
    if (prevStart < 0 || !TABLE_ROW.test(text.slice(prevStart, start - 1))) return start;
  }
  return n;
}

/** Everything that has arrived, at once (turn ended, page hidden, the reader looked away). */
export function flushPacer(text: string): TextPacerState {
  return { shown: text.length, carry: 0, sinceStep: 0, rate: 0 };
}
