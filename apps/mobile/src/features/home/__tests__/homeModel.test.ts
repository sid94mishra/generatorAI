import { describe, expect, it } from 'vitest';
import type { AttentionItem, RecentActivityItem } from '@generatorai/shared';

import { finishTime, finishedTodayCount, needsYouAction, needsYouMeta, recentRowView, runningMeta, startOfToday } from '../homeModel';

const ask = (kind: string, id = 'i1') => ({ kind, id, summary: 'Allow Bash?', actions: [] }) as unknown as AttentionItem['ask'];

function recent(p: Partial<RecentActivityItem>): RecentActivityItem {
  return { key: 'chat:c1', entity: 'chat', entityId: 'c1', title: 'T', href: '/chats/c1', endedAt: '2026-10-03T10:00:00Z', outcome: 'succeeded', summary: 'Turn completed', ...p };
}

describe('needsYouAction', () => {
  it('opens the approval sheet for a chat permission or question (signed path, MD-31)', () => {
    expect(needsYouAction({ entity: 'chat', entityId: 'c 1', ask: ask('tool_permission', 'x/y') })).toEqual({ label: 'Review', sheetHref: '/chats/c%201/gate/x%2Fy' });
    expect(needsYouAction({ entity: 'chat', entityId: 'c1', ask: ask('question') }).sheetHref).toBe('/chats/c1/gate/i1');
  });
  it('opens the item for plans, run approvals and anything else', () => {
    expect(needsYouAction({ entity: 'chat', entityId: 'c1', ask: ask('plan_review') })).toEqual({ label: 'Open', sheetHref: null });
    expect(needsYouAction({ entity: 'workflow_run', entityId: 'r1', ask: ask('stage_approval') })).toEqual({ label: 'Review', sheetHref: null });
    expect(needsYouAction({ entity: 'chat', entityId: 'c1' })).toEqual({ label: 'Open', sheetHref: null });
  });
});

describe('row meta', () => {
  it('needs you: the ask summary, then the project', () => {
    expect(needsYouMeta({ ask: ask('question'), project: { id: 'p', name: 'payments' } })).toEqual(['Allow Bash?', 'payments']);
  });
  it('running: the progress label, else the step count', () => {
    expect(runningMeta({ progress: { label: 'Running pnpm build' } })).toEqual({ detail: 'Running pnpm build' });
    expect(runningMeta({ progress: { step: 2, of: 4 }, project: { id: 'p', name: 'web' } })).toEqual({ project: 'web', detail: 'Step 2 of 4' });
    expect(runningMeta({})).toEqual({});
  });
});

describe('recentRowView', () => {
  it('names a PR, a commit, or the plain outcome (MG-13)', () => {
    expect(recentRowView(recent({ pullRequest: { number: 1176, url: 'u' } })).outcome).toBe('PR #1176 opened');
    expect(recentRowView(recent({ commit: { branch: 'x', sha: 'abc' } })).outcome).toBe('Done · committed');
    expect(recentRowView(recent({ entity: 'run', key: 'run:r' })).outcome).toBe('Succeeded');
    // A run's worktree branch alone is not a commit.
    expect(recentRowView(recent({ entity: 'run', key: 'run:r', commit: { branch: 'x' } })).outcome).toBe('Succeeded');
  });
  it('a failure shows its first line in the error tone; cancelled reads Cancelled', () => {
    expect(recentRowView(recent({ outcome: 'failed', summary: 'Failed at typecheck' }))).toMatchObject({ outcome: 'Failed at typecheck', outcomeTone: 'err', state: 'failed' });
    expect(recentRowView(recent({ outcome: 'cancelled' }))).toMatchObject({ outcome: 'Cancelled', state: 'skipped' });
  });
});

describe('time', () => {
  it('counts only what ended today', () => {
    const now = new Date(2026, 9, 3, 15, 0);
    const today = new Date(2026, 9, 3, 9, 0).toISOString();
    const yesterday = new Date(2026, 9, 2, 23, 0).toISOString();
    expect(finishedTodayCount([recent({ endedAt: today }), recent({ endedAt: yesterday })], now)).toBe(1);
    expect(startOfToday(now).getHours()).toBe(0);
  });
  it('shows the clock today and the date before', () => {
    const now = new Date(2026, 9, 3, 15, 0);
    expect(finishTime(new Date(2026, 9, 3, 13, 5).toISOString(), now)).toMatch(/13|1/);
    expect(finishTime(new Date(2026, 9, 1, 13, 5).toISOString(), now)).toMatch(/1/);
    expect(finishTime('nope', now)).toBe('');
  });
});
