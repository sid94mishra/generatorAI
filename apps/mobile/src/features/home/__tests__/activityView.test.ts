import { describe, expect, it } from 'vitest';
import { countAttention, type AttentionItem, type AttentionSnapshot, type RecentActivityItem } from '@generatorai/shared';
import { activityOperations } from '../activityView';
import { operationActionFor } from '../../../components/home/operationActions';
import { groupApprovals } from '../../../services/api/activityRanking';

const item = (patch: Partial<AttentionItem> = {}): AttentionItem => ({
  key: 'chat:chat-1:ask-1', entity: 'chat', entityId: 'chat-1', title: 'Review changes',
  href: '/chats/chat-1', state: 'needs_you', since: '2026-09-29T10:00:00Z', stoppable: true,
  ask: { id: 'ask-1', kind: 'tool_permission', summary: 'Allow test command?', actions: ['allow_once', 'deny', 'open'] }, ...patch,
});
const snapshot = (needsYou: AttentionItem[], running: AttentionItem[] = []): AttentionSnapshot => ({ seq: 1, generatedAt: '2026-09-29T10:00:00Z', needsYou, running, counts: countAttention(needsYou, running) });

describe('legacy Home over the shared attention feed', () => {
  it('retains each ask key while actions address the real entity', () => {
    const rows = activityOperations(snapshot([item(), item({ key: 'chat:chat-1:ask-2', ask: { id: 'ask-2', kind: 'question', summary: 'Which branch?', actions: ['answer', 'open'] } })]), []);
    expect(rows.map((row) => row.id)).toEqual(['chat:chat-1:ask-1', 'chat:chat-1:ask-2']);
    expect(rows.map((row) => row.entityId)).toEqual(['chat-1', 'chat-1']);
    expect(rows.map((row) => row.gate?.interactionId)).toEqual(['ask-1', 'ask-2']);
  });
  it('does not offer actions omitted by the server', () => {
    const [gate] = activityOperations(snapshot([item({ ask: { id: 'ask-1', kind: 'tool_permission', summary: 'Open to review', actions: ['open'] } })]), []);
    expect(gate?.gate?.permissionAllowed).toBe(false);
    const [running] = activityOperations(snapshot([], [item({ key: 'chat:chat-1', ask: undefined, state: 'running', stoppable: false })]), []);
    expect(operationActionFor(running!)).toBeNull();
  });
  it('does not invent retry for a finished run without a server action', () => {
    const recent: RecentActivityItem = { key: 'run:r1', entity: 'run', entityId: 'r1', title: 'Failed run', href: '/runs/r1', endedAt: '2026-09-29T09:00:00Z', outcome: 'failed', summary: 'Failure' };
    expect(operationActionFor(activityOperations(null, [recent])[0]!)).toBeNull();
    expect(operationActionFor(activityOperations(null, [{ ...recent, retry: 'run_retry' }])[0]!)?.kind).toBe('retry-run');
  });
  it('keeps automation asks in the approval queue', () => {
    const rows = activityOperations(snapshot([item({ key: 'automation_execution:exec-1:ask-1', entity: 'automation_execution', entityId: 'exec-1' })]), []);
    expect(groupApprovals(rows).total).toBe(1);
    expect(rows[0]?.kind).toBe('automation');
  });
  it('deduplicates recent outcomes against active entities without losing other outcomes', () => {
    const recent: RecentActivityItem[] = ['chat-1', 'chat-2'].map((id) => ({ key: `chat:${id}`, entity: 'chat', entityId: id, title: id, href: `/chats/${id}`, endedAt: '2026-09-29T09:00:00Z', outcome: 'succeeded', summary: 'Done' }));
    const rows = activityOperations(snapshot([item()]), recent);
    expect(rows.map((row) => row.id)).toEqual(['chat:chat-1:ask-1', 'chat:chat-2']);
    expect(rows[1]?.status).toBe('completed');
  });
});
