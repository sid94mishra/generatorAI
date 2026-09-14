import { describe, expect, it } from 'vitest';
import type { ProjectPullRequest, PullRequestDetail } from '@generatorai/shared';

import {
  PR_STATE_SEGMENTS,
  checksSummaryLabel,
  checksTone,
  diffStatLabel,
  fileStat,
  fileStatusLetter,
  groupByCodebase,
  matchesState,
  mergeability,
  parsePatchRows,
  prStateLabel,
  prStateTone,
} from '../prModel';

function pr(over: Partial<ProjectPullRequest> = {}): ProjectPullRequest {
  return {
    provider: 'github',
    number: 1,
    url: 'https://example.test/pr/1',
    title: 'Fix the cart',
    state: 'open',
    head: 'generatorai/cart',
    base: 'main',
    codebaseId: 'cb-1',
    codebaseAlias: 'frontend',
    ...over,
  };
}

describe('the list', () => {
  it('offers the three filters web offers', () => {
    expect(PR_STATE_SEGMENTS.map((s) => s.value)).toEqual(['open', 'closed', 'all']);
  });

  it('keeps the rendered list honest about the filter', () => {
    const merged = pr({ state: 'merged' });
    expect(matchesState(merged, 'open')).toBe(false);
    expect(matchesState(merged, 'closed')).toBe(true);
    expect(matchesState(merged, 'all')).toBe(true);
    expect(matchesState(pr(), 'open')).toBe(true);
  });

  it('groups by codebase in first-seen order', () => {
    const groups = groupByCodebase([
      pr({ number: 1 }),
      pr({ number: 2, codebaseId: 'cb-2', codebaseAlias: 'api' }),
      pr({ number: 3 }),
    ]);
    expect(groups.map((g) => g.alias)).toEqual(['frontend', 'api']);
    expect(groups[0]!.items.map((p) => p.number)).toEqual([1, 3]);
  });

  it('labels a draft as a draft, not as open', () => {
    expect(prStateLabel('open', true)).toBe('Draft');
    expect(prStateLabel('merged')).toBe('Merged');
    expect(prStateTone('merged')).toBe('primary');
    expect(prStateTone('closed')).toBe('neutral');
  });
});

function detail(over: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    ...pr(),
    body: '',
    mergeable: true,
    mergeableState: 'clean',
    additions: 48,
    deletions: 12,
    changedFiles: 3,
    commits: 2,
    headSha: 'aaa',
    baseSha: 'bbb',
    labels: [],
    ...over,
  } as PullRequestDetail;
}

describe('the detail header', () => {
  it('says whether it can be merged, and why not', () => {
    expect(mergeability(detail())).toEqual({ label: 'Ready to merge', tone: 'success' });
    expect(mergeability(detail({ mergeable: null, mergeableState: 'unknown' })).tone).toBe('info');
    expect(mergeability(detail({ mergeable: false, mergeableState: 'dirty' }))).toEqual({
      label: 'Conflicts with the base branch',
      tone: 'danger',
    });
    expect(mergeability(detail({ mergeableState: 'blocked' })).tone).toBe('warning');
    expect(mergeability(detail({ state: 'merged' })).label).toBe('Merged');
  });

  it('summarises the checks and the diff', () => {
    expect(
      checksSummaryLabel({ total: 4, passed: 3, failed: 1, pending: 0, conclusion: 'failure' }),
    ).toBe('3 passed · 1 failed');
    expect(checksTone({ total: 4, passed: 3, failed: 1, pending: 0, conclusion: 'failure' })).toBe('danger');
    expect(checksSummaryLabel(undefined)).toBeNull();
    expect(diffStatLabel(detail())).toBe('3 files · +48 −12');
    expect(fileStat({ additions: 2, deletions: 0 })).toBe('+2 −0');
    expect(fileStatusLetter('removed')).toBe('D');
  });
});

describe('patches', () => {
  it('colours hunks, additions, deletions and context', () => {
    const rows = parsePatchRows('@@ -1,3 +1,4 @@\n context\n+added\n-removed\n\\ No newline at end of file');
    expect(rows.map((r) => r.kind)).toEqual(['hunk', 'context', 'add', 'del', 'meta']);
    expect(rows[2]!.text).toBe('+added');
  });

  it('normalises CRLF and drops the trailing blank line', () => {
    expect(parsePatchRows('+a\r\n+b\r\n').map((r) => r.text)).toEqual(['+a', '+b']);
  });

  it('caps a huge patch and says how much it hid', () => {
    const patch = Array.from({ length: 60 }, (_, i) => `+line ${i}`).join('\n');
    const rows = parsePatchRows(patch, 10);
    expect(rows).toHaveLength(11);
    expect(rows[10]).toEqual({ kind: 'meta', text: '… 50 more lines' });
  });

  it('has nothing to render for a binary file', () => {
    expect(parsePatchRows(undefined)).toEqual([]);
  });
});
