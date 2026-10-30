// ────────────────────────────────────────────────────────────────
// Dictation commit — where a finalized segment lands, and "scratch that".
//
// Pure function over (draft, caret, last committed range) so the retraction
// rule is unit-testable without the audio stack:
//
//   • A segment is stitched at the caret with `stitchDictation` (spacing,
//     sentence case, symbols that attach), exactly as the web composer.
//   • A segment that BEGINS with a standalone "scratch that" retracts the
//     previous committed utterance — but only if that text is still there,
//     untouched, where it was committed. Text the user has since edited is
//     never removed (web's `lastCommittedRef` rule).
//   • "scratch that" mid-utterance is resolved server-side by
//     `applyScratchCommand` before it reaches us; we only see the
//     standalone canonical form.
// ────────────────────────────────────────────────────────────────

import { splitScratchCommand, stitchDictation } from '@generatorai/shared';

export interface CommittedRange {
  start: number;
  end: number;
  /** The text that was committed, to verify it has not been edited since. */
  text: string;
}

export interface DictationState {
  draft: string;
  caret: number;
  lastCommitted: CommittedRange | null;
}

export interface DictationCommit {
  draft: string;
  caret: number;
  lastCommitted: CommittedRange | null;
  /** True when a previous utterance was removed by "scratch that". */
  retracted: boolean;
}

/** Whether `range` still describes exactly the text it was created for. */
export function committedRangeIntact(draft: string, range: CommittedRange | null): boolean {
  if (!range) return false;
  if (range.end > draft.length || range.start < 0 || range.start > range.end) return false;
  return draft.slice(range.start, range.end) === range.text;
}

export function commitDictation(state: DictationState, raw: string): DictationCommit {
  const { scratch, rest } = splitScratchCommand(raw);
  const incoming = scratch ? rest.trim() : raw.trim();

  let before: string;
  let after: string;
  let retracted = false;

  if (scratch && committedRangeIntact(state.draft, state.lastCommitted)) {
    const range = state.lastCommitted!;
    before = state.draft.slice(0, range.start).replace(/[ \t]+$/, '');
    after = state.draft.slice(range.end).replace(/^[ \t]+/, '');
    retracted = true;
  } else {
    const at = Math.max(0, Math.min(state.caret, state.draft.length));
    before = state.draft.slice(0, at);
    after = state.draft.slice(at);
  }

  if (!incoming) {
    // A bare "scratch that": the retraction is the whole effect.
    const draft = retracted ? `${before}${after}` : state.draft;
    return {
      draft,
      caret: retracted ? before.length : state.caret,
      lastCommitted: null,
      retracted,
    };
  }

  const stitched = stitchDictation(before, incoming, after);
  return {
    draft: stitched.text,
    caret: stitched.end,
    lastCommitted: {
      start: stitched.start,
      end: stitched.end,
      text: stitched.text.slice(stitched.start, stitched.end),
    },
    retracted,
  };
}

/** "0:42" for the voice pill. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 18 bar weights — a bell so the pill reads as a waveform, not a bar chart. */
export const WAVEFORM_BARS = 18;
export const WAVEFORM_WEIGHTS: readonly number[] = Array.from({ length: WAVEFORM_BARS }, (_, i) => {
  const x = (i - (WAVEFORM_BARS - 1) / 2) / ((WAVEFORM_BARS - 1) / 2);
  return 0.35 + 0.65 * (1 - x * x);
});
