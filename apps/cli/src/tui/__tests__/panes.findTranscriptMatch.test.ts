import { describe, expect, it } from 'vitest';
import { findTranscriptMatch } from '../panes.js';
import type { TimelineItem } from '@generatorai/cli-core';

function item(id: string, text: string): TimelineItem {
  return { id, kind: 'assistant', text, complete: true, at: 0 };
}

// Phase 4 item 7 — real in-transcript search, jumping `scrollBack` to a
// match, instead of `app.search`'s row-FILTER behavior for list panes.
describe('findTranscriptMatch', () => {
  const items = [
    item('a', 'hello world'),
    item('b', 'nothing here'),
    item('c', 'the answer is 42'),
    item('d', 'another line'),
    item('e', 'the final answer'),
  ];
  // oldest-first: a(idx0) b(1) c(2) d(3) e(4, newest)

  it('is case-insensitive and returns the scrollBack that reveals the match', () => {
    // "world" only matches item a (index 0) — scrollBack to reveal it is
    // items.length - 1 - 0 = 4.
    expect(findTranscriptMatch(items, 'WORLD')).toBe(4);
  });

  it('returns null when nothing matches', () => {
    expect(findTranscriptMatch(items, 'xyzzy')).toBeNull();
  });

  it('returns null for an empty/whitespace query rather than matching everything', () => {
    expect(findTranscriptMatch(items, '   ')).toBeNull();
    expect(findTranscriptMatch(items, '')).toBeNull();
  });

  it('finds the newest match by default (no current position)', () => {
    // "answer" matches c (idx2) and e (idx4) — default search starts from
    // "newest", so it should find e (idx4) first: scrollBack 0.
    expect(findTranscriptMatch(items, 'answer')).toBe(0);
  });

  it('walks to the NEXT OLDER match when already at a match, instead of finding the same one again', () => {
    // Already viewing e's match (scrollBack 0) — searching again for
    // "answer" should walk back to c (idx2): scrollBack = 4 - 2 = 2.
    expect(findTranscriptMatch(items, 'answer', 0)).toBe(2);
  });

  it('wraps around to the newest match once it walks past the oldest', () => {
    // Already at c's match (scrollBack 2, the oldest "answer") — nothing
    // older matches, so it should wrap to e (idx4, scrollBack 0).
    expect(findTranscriptMatch(items, 'answer', 2)).toBe(0);
  });

  it('returns null for an empty transcript', () => {
    expect(findTranscriptMatch([], 'anything')).toBeNull();
  });
});
