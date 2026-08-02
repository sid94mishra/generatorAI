// Unit tests for anchor resolution + prompt serialization.
//
// These are the two pieces where a subtle bug is invisible in the UI but
// silently corrupts the feature: a comment quietly pointing at the wrong
// lines, or a prompt the agent misreads.

import { describe, it, expect } from 'vitest';
import { createTwoFilesPatch } from 'diff';
import {
  hashAnchor,
  resolveAnchor,
  mapLineThroughPatch,
  changedRangesFromPatch,
  rangesOverlap,
} from '../src/AnchorResolver.js';
import { serializeReviewThreads } from '../src/ReviewPromptSerializer.js';
import type { ReviewThread } from '../src/types.js';

function patchOf(oldText: string, newText: string): string {
  return createTwoFilesPatch('a/f.ts', 'b/f.ts', oldText, newText);
}

function anchorFor(content: string, start: number, end: number) {
  const text = content.split('\n').slice(start - 1, end).join('\n');
  return { startLine: start, endLine: end, anchorHash: hashAnchor(text) };
}

describe('hashAnchor', () => {
  it('ignores trailing whitespace and surrounding blank lines', () => {
    expect(hashAnchor('const x = 1;  \n')).toBe(hashAnchor('const x = 1;'));
    expect(hashAnchor('\n\nfoo\n\n')).toBe(hashAnchor('foo'));
  });

  it('does not ignore meaningful indentation', () => {
    expect(hashAnchor('  indented')).not.toBe(hashAnchor('indented'));
  });
});

describe('resolveAnchor', () => {
  const base = ['line1', 'line2', 'target-a', 'target-b', 'line5', 'line6'].join('\n');

  it('returns exact when nothing moved', () => {
    const anchor = anchorFor(base, 3, 4);
    const out = resolveAnchor(anchor, base);
    expect(out).toEqual({ kind: 'exact', startLine: 3, endLine: 4 });
  });

  it('follows the anchor down when lines are inserted above', () => {
    const anchor = anchorFor(base, 3, 4);
    const next = ['new1', 'new2', ...base.split('\n')].join('\n');
    const out = resolveAnchor(anchor, next, patchOf(base, next));
    expect(out.kind).not.toBe('outdated');
    if (out.kind !== 'outdated') {
      expect(out.startLine).toBe(5);
      expect(out.endLine).toBe(6);
    }
  });

  it('follows the anchor up when lines are removed above', () => {
    const anchor = anchorFor(base, 3, 4);
    const next = base.split('\n').slice(1).join('\n');
    const out = resolveAnchor(anchor, next, patchOf(base, next));
    expect(out.kind).not.toBe('outdated');
    if (out.kind !== 'outdated') {
      expect(out.startLine).toBe(2);
      expect(out.endLine).toBe(3);
    }
  });

  it('recovers the anchor without a patch (pure content search)', () => {
    const anchor = anchorFor(base, 3, 4);
    const next = ['x', 'y', 'z', 'target-a', 'target-b', 'w'].join('\n');
    const out = resolveAnchor(anchor, next);
    expect(out.kind).toBe('fuzzy');
    if (out.kind !== 'outdated') {
      expect(out.startLine).toBe(4);
      expect(out.endLine).toBe(5);
    }
  });

  it('recovers an anchor that moved far away (file reorganised)', () => {
    const anchor = anchorFor(base, 3, 4);
    const filler = Array.from({ length: 200 }, (_, i) => `filler${i}`);
    const next = [...filler, 'target-a', 'target-b'].join('\n');
    const out = resolveAnchor(anchor, next);
    expect(out.kind).toBe('fuzzy');
    if (out.kind !== 'outdated') expect(out.startLine).toBe(201);
  });

  it('reports outdated when the anchored text is rewritten', () => {
    const anchor = anchorFor(base, 3, 4);
    const next = ['line1', 'line2', 'COMPLETELY', 'DIFFERENT', 'line5', 'line6'].join('\n');
    expect(resolveAnchor(anchor, next, patchOf(base, next)).kind).toBe('outdated');
  });

  it('reports outdated when the file is deleted', () => {
    expect(resolveAnchor(anchorFor(base, 3, 4), null).kind).toBe('outdated');
  });

  it('does not drift onto a different occurrence of similar text', () => {
    // Two identical blocks: the resolver must pick the NEAREST one, not the
    // first, otherwise a comment jumps to an unrelated copy.
    const dup = ['a', 'dupe', 'b', 'c', 'd', 'e', 'f', 'dupe', 'g'].join('\n');
    const anchor = anchorFor(dup, 8, 8); // the second 'dupe'
    const next = ['PRE', ...dup.split('\n')].join('\n');
    const out = resolveAnchor(anchor, next, patchOf(dup, next));
    expect(out.kind).not.toBe('outdated');
    if (out.kind !== 'outdated') expect(out.startLine).toBe(9);
  });
});

describe('mapLineThroughPatch', () => {
  it('returns null for a deleted line', () => {
    const oldText = ['a', 'b', 'c'].join('\n');
    const newText = ['a', 'c'].join('\n');
    expect(mapLineThroughPatch(patchOf(oldText, newText), 2)).toBeNull();
  });

  it('shifts lines after an insertion', () => {
    const oldText = ['a', 'b', 'c'].join('\n');
    const newText = ['a', 'NEW', 'b', 'c'].join('\n');
    expect(mapLineThroughPatch(patchOf(oldText, newText), 3)).toBe(4);
  });

  it('is a no-op for an unparseable patch', () => {
    expect(mapLineThroughPatch('not a patch', 7)).toBe(7);
  });
});

describe('changedRangesFromPatch', () => {
  it('reports the new-side ranges that were touched', () => {
    const oldText = ['a', 'b', 'c', 'd'].join('\n');
    const newText = ['a', 'B2', 'c', 'd'].join('\n');
    const ranges = changedRangesFromPatch(patchOf(oldText, newText));
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.some((r) => rangesOverlap(r, { startLine: 2, endLine: 2 }))).toBe(true);
  });
});

describe('serializeReviewThreads', () => {
  const thread = (over: Partial<ReviewThread> = {}): ReviewThread => ({
    id: 'rt_1',
    workspaceId: 'ws',
    scope: 'chat',
    scopeId: 'chat_1',
    repoAlias: '.',
    path: 'src/auth.ts',
    baseCheckpointId: 'ck_1',
    headCheckpointId: 'ck_2',
    side: 'additions',
    startLine: 42,
    endLine: 45,
    anchorText: 'const payload = {\n  sub: userId,\n  role,\n};',
    anchorHash: 'h',
    status: 'pending',
    reviewRound: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    comments: [
      {
        id: 'rc_1',
        threadId: 'rt_1',
        author: 'user',
        body: 'Validate `role` against an allow-list.',
        intent: 'fix',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    ...over,
  });

  it('emits a structured envelope with path, lines and the anchored code', () => {
    const out = serializeReviewThreads([thread()], { round: 2, workspaceId: 'ws' });
    expect(out).toContain('<review_feedback round="2" workspace="ws">');
    expect(out).toContain('path="src/auth.ts"');
    expect(out).toContain('lines="42-45"');
    expect(out).toContain('side="additions"');
    expect(out).toContain('const payload = {');
    expect(out).toContain('Validate `role` against an allow-list.');
    expect(out).toContain('intent="fix"');
    expect(out).toContain('Address every comment above.');
  });

  it('uses a single line number when the range is one line', () => {
    const out = serializeReviewThreads([thread({ startLine: 7, endLine: 7 })]);
    expect(out).toContain('lines="7"');
  });

  it('groups multiple threads under their file, in line order', () => {
    const out = serializeReviewThreads([
      thread({ id: 'rt_b', startLine: 90, endLine: 90 }),
      thread({ id: 'rt_a', startLine: 10, endLine: 10 }),
    ]);
    expect(out.indexOf('lines="10"')).toBeLessThan(out.indexOf('lines="90"'));
  });

  it('separates threads from different files', () => {
    const out = serializeReviewThreads([
      thread({ id: 'rt_1', path: 'b.ts' }),
      thread({ id: 'rt_2', path: 'a.ts' }),
    ]);
    expect(out.indexOf('path="a.ts"')).toBeLessThan(out.indexOf('path="b.ts"'));
  });

  it('omits agent-authored comments from the instruction', () => {
    const t = thread();
    t.comments.push({
      id: 'rc_agent',
      threadId: 'rt_1',
      author: 'agent',
      body: 'I already looked at this.',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const out = serializeReviewThreads([t]);
    expect(out).not.toContain('I already looked at this.');
  });

  it('escapes markup in the comment body', () => {
    const out = serializeReviewThreads([
      thread({
        comments: [
          {
            id: 'rc_x',
            threadId: 'rt_1',
            author: 'user',
            body: 'Use <Foo> & <Bar>',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
    ]);
    expect(out).toContain('Use &lt;Foo&gt; &amp; &lt;Bar&gt;');
  });

  it('elides an over-long anchor rather than blowing the budget', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
    const out = serializeReviewThreads([thread({ anchorText: huge })]);
    expect(out).toContain('chars elided');
    expect(out.length).toBeLessThan(30_000);
  });

  it('returns an empty string for no threads', () => {
    expect(serializeReviewThreads([])).toBe('');
  });

  it('appends the user note after the structured block', () => {
    const out = serializeReviewThreads([thread()], { note: 'Prioritise the auth fix.' });
    expect(out.trimEnd().endsWith('Prioritise the auth fix.')).toBe(true);
  });
});
