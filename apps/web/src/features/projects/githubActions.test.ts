import { describe, expect, it } from 'vitest';
import { issueFixPrompt, mergeBlockReason, mergeCaution, mergeHoldLabel, parseLabels } from './githubActions.js';

const open = { state: 'open' as const, draft: false, mergeable: true, mergeableState: 'clean' };

describe('mergeBlockReason', () => {
  it('offers the merge for an open, mergeable, ready PR', () => {
    expect(mergeBlockReason(open)).toBeNull();
  });

  it.each([
    [{ state: 'merged' as const }, 'already merged'],
    [{ state: 'closed' as const }, 'closed'],
    [{ draft: true }, 'Draft'],
    [{ mergeable: null }, 'still checking'],
    [{ mergeable: false, mergeableState: 'dirty' }, 'conflicts'],
    [{ mergeable: false, mergeableState: 'unknown' }, 'can’t be merged'],
  ])('blocks %o', (over, text) => {
    expect(mergeBlockReason({ ...open, ...over })).toContain(text);
  });

  it('a merged PR reads as merged even though GitHub reports mergeable false', () => {
    expect(mergeBlockReason({ ...open, state: 'merged', mergeable: false })).toBe('This pull request is already merged.');
  });
});

describe('mergeCaution', () => {
  it('warns about protection, failing checks and a stale head — only when the merge is offered', () => {
    expect(mergeCaution({ ...open, mergeableState: 'blocked' })).toContain('Branch protection');
    expect(mergeCaution({ ...open, mergeableState: 'unstable' })).toContain('checks');
    expect(mergeCaution({ ...open, mergeableState: 'behind' })).toContain('behind');
    expect(mergeCaution(open)).toBeNull();
    expect(mergeCaution({ ...open, state: 'closed', mergeableState: 'blocked' })).toBeNull();
  });
});

describe('mergeHoldLabel', () => {
  it('names what GitHub holds an open, mergeable PR back for, in words (U-74)', () => {
    expect(mergeHoldLabel({ ...open, mergeableState: 'blocked' })).toBe('Branch protection may block the merge');
    expect(mergeHoldLabel({ ...open, mergeableState: 'behind' })).toBe('Behind the base branch');
    expect(mergeHoldLabel(open)).toBeNull();
    expect(mergeHoldLabel({ ...open, state: 'merged', mergeableState: 'blocked' })).toBeNull();
  });
});

describe('issueFixPrompt', () => {
  it('states the issue, its body and the PR to open', () => {
    expect(issueFixPrompt({ number: 12, title: 'Login loops', body: 'Steps:\n1. sign in' })).toBe(
      'Fix #12: Login loops\n\nSteps:\n1. sign in\n\nOpen a PR that closes #12.',
    );
  });

  it('skips an empty body', () => {
    expect(issueFixPrompt({ number: 3, title: 'Typo', body: '  ' })).toBe('Fix #3: Typo\n\nOpen a PR that closes #3.');
  });
});

describe('parseLabels', () => {
  it('trims, drops empties and duplicates', () => {
    expect(parseLabels(' bug, ui ,, bug,p1 ')).toEqual(['bug', 'ui', 'p1']);
    expect(parseLabels('')).toEqual([]);
  });
});
