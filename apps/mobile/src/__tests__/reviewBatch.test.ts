import { describe, expect, it } from 'vitest';

import {
  batchSummary,
  buildReviewBatch,
  countThreads,
  groupThreadsByFile,
  isPendingThread,
} from '../components/review/reviewBatch';
import { checkCapability } from '../components/review/scopes';

const thread = (id: string, status: string, path = 'a.ts', repoAlias = '.') =>
  ({ id, status, path, repoAlias, comments: [] }) as never;

describe('reviewBatch', () => {
  it('treats draft and pending as sendable, nothing else', () => {
    expect(isPendingThread({ status: 'pending' })).toBe(true);
    expect(isPendingThread({ status: 'draft' })).toBe(true);
    expect(isPendingThread({ status: 'submitted' })).toBe(false);
    expect(isPendingThread({ status: 'resolved' })).toBe(false);
  });

  it('builds the exact submit body web posts: pending ids, chat target, trimmed note', () => {
    const threads = [thread('t1', 'pending'), thread('t2', 'submitted'), thread('t3', 'draft'), thread('t4', 'resolved')];
    expect(buildReviewBatch(threads, { kind: 'chat', chatId: 'c1' }, { note: '  be terse  ' })).toEqual({
      threadIds: ['t1', 't3'],
      target: { kind: 'chat', chatId: 'c1' },
      note: 'be terse',
    });
  });

  it('drops an empty note and adds preview only when asked', () => {
    const threads = [thread('t1', 'pending')];
    expect(buildReviewBatch(threads, { kind: 'chat', chatId: 'c1' }, { note: '   ' })).toEqual({
      threadIds: ['t1'],
      target: { kind: 'chat', chatId: 'c1' },
    });
    expect(buildReviewBatch(threads, { kind: 'chat', chatId: 'c1' }, { preview: true })).toMatchObject({ preview: true });
  });

  it('restricts to the given ids and returns null when nothing is pending', () => {
    const threads = [thread('t1', 'pending'), thread('t2', 'pending')];
    expect(buildReviewBatch(threads, { kind: 'clipboard' }, { onlyIds: ['t2'] })?.threadIds).toEqual(['t2']);
    expect(buildReviewBatch([thread('t1', 'submitted')], { kind: 'clipboard' })).toBeNull();
    expect(buildReviewBatch(threads, { kind: 'clipboard' }, { onlyIds: ['nope'] })).toBeNull();
  });

  it('counts and summarises like the web batch bar', () => {
    const counts = countThreads([
      thread('1', 'pending'),
      thread('2', 'draft'),
      thread('3', 'submitted'),
      thread('4', 'addressed'),
      thread('5', 'resolved'),
      thread('6', 'outdated'),
    ]);
    expect(counts).toEqual({ pending: 2, submitted: 1, addressed: 1, resolved: 1 });
    expect(batchSummary(counts)).toBe('2 pending · 1 awaiting agent · 1 addressed');
    expect(batchSummary({ pending: 0, submitted: 0, addressed: 0, resolved: 3 })).toBe('');
  });

  it('groups threads by alias:path in first-seen order', () => {
    const map = groupThreadsByFile([thread('1', 'pending', 'b.ts'), thread('2', 'pending', 'a.ts', 'api'), thread('3', 'pending', 'b.ts')]);
    expect([...map.keys()]).toEqual(['.:b.ts', 'api:a.ts']);
    expect(map.get('.:b.ts')?.map((t: { id: string }) => t.id)).toEqual(['1', '3']);
  });
});

describe('workbench scopes', () => {
  it('gates on the route policy scopes and explains the gap', () => {
    expect(checkCapability('writeReviews', ['read:reviews'])).toMatchObject({ available: false, missing: ['write:reviews'] });
    expect(checkCapability('writeReviews', ['read:reviews', 'write:reviews'])).toEqual({ available: true, missing: [], reason: null });
    expect(checkCapability('commit', [])).toMatchObject({ available: false, missing: ['write:workspaces'] });
    expect(checkCapability('restoreCheckpoints', ['write:workspaces']).available).toBe(true);
    expect(checkCapability('decidePlan', ['write:chats']).available).toBe(true);
    expect(checkCapability('cancelTask', ['read:chats']).reason).toMatch(/chat-write/);
  });
});
