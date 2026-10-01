import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../client.js';

function setup() {
  const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
  return { fetch, api: createApiClient(fetch) };
}

describe('workspace review contracts', () => {
  it('preserves scoped/all query filters and encodes ids', async () => {
    const { api, fetch } = setup();
    await api.review.threadsForScope('ws/a', { scope: 'chat', scopeId: 'c 1', path: 'a/b.ts', all: true });
    expect(fetch).toHaveBeenCalledWith('/api/workspaces/ws%2Fa/review/threads?scope=chat&scopeId=c+1&path=a%2Fb.ts&all=true', undefined);
    await api.review.updateComment('ws/a', 't/x', 'c/y', 'Please update');
    expect(fetch).toHaveBeenLastCalledWith('/api/workspaces/ws%2Fa/review/threads/t%2Fx/comments/c%2Fy', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ body: 'Please update' }) }));
    await api.review.deleteThread('ws/a', 't/x');
    expect(fetch).toHaveBeenLastCalledWith('/api/workspaces/ws%2Fa/review/threads/t%2Fx', { method: 'DELETE' });
  });

  it('preserves the review delivery target and optional note', async () => {
    const { api, fetch } = setup();
    const body = { threadIds: ['t1'], target: { kind: 'chat' as const, chatId: 'c1' }, note: 'Fix', preview: true };
    await api.review.submit('ws', body);
    expect(fetch).toHaveBeenCalledWith('/api/workspaces/ws/review/submit', expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }));
  });

  it('creates manual checkpoints without adding an empty label', async () => {
    const { api, fetch } = setup();
    await api.workspaces.createCheckpoint('ws/a');
    expect(fetch).toHaveBeenLastCalledWith('/api/workspaces/ws%2Fa/checkpoints', expect.objectContaining({ method: 'POST', body: '{}' }));
    await api.workspaces.createCheckpoint('ws/a', 'Before edits');
    expect(fetch).toHaveBeenLastCalledWith('/api/workspaces/ws%2Fa/checkpoints', expect.objectContaining({ body: JSON.stringify({ label: 'Before edits' }) }));
  });
});

describe('plan and worker contracts', () => {
  it('reads plan revisions and retains the optimistic revision precondition', async () => {
    const { api, fetch } = setup();
    await api.plans.get('c/a', 'p/b');
    expect(fetch).toHaveBeenLastCalledWith('/api/chats/c%2Fa/plans/p%2Fb', undefined);
    await api.plans.content('c/a', 'p/b', 2);
    expect(fetch).toHaveBeenLastCalledWith('/api/chats/c%2Fa/plans/p%2Fb/content?revision=2', undefined);
    const body = { content: 'Updated', expectedRevision: 2 };
    await api.plans.saveRevision('c/a', 'p/b', body);
    expect(fetch).toHaveBeenLastCalledWith('/api/chats/c%2Fa/plans/p%2Fb/content', expect.objectContaining({ method: 'PUT', body: JSON.stringify(body) }));
    await api.plans.addComment('c/a', 'p/b', { body: 'Review', revision: 3 });
    expect(fetch).toHaveBeenLastCalledWith('/api/chats/c%2Fa/plans/p%2Fb/comments', expect.objectContaining({ method: 'POST', body: JSON.stringify({ body: 'Review', revision: 3 }) }));
    await api.plans.saveToWorkspace('c/a', 'p/b');
    expect(fetch).toHaveBeenLastCalledWith('/api/chats/c%2Fa/plans/p%2Fb/save-to-workspace', expect.objectContaining({ method: 'POST', body: '{}' }));
  });

  it('reads a worker digest using encoded chat and task ids', async () => {
    const { api, fetch } = setup();
    await api.chats.backgroundTaskDigest('c/a', 't/b');
    expect(fetch).toHaveBeenCalledWith('/api/chats/c%2Fa/background-tasks/t%2Fb', undefined);
  });
});
