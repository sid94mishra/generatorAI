import { describe, expect, it } from 'vitest';
import { buildActivityModel } from '@generatorai/client-core';
import type { AttentionItem } from '@generatorai/shared';
import { askAnswers, stopTarget } from '@/features/activity/activityView.js';

const item = (over: Partial<AttentionItem> & Pick<AttentionItem, 'key' | 'entity' | 'entityId'>): AttentionItem => ({
  title: over.entityId,
  href: `/x/${over.entityId}`,
  state: 'running',
  since: '2026-10-04T10:00:00.000Z',
  stoppable: false,
  ...over,
});

describe('activityView (D-92)', () => {
  it('Stop acts on the running item, else on a stoppable asking run, never on a worker for its orchestrator', () => {
    const model = buildActivityModel({
      attention: {
        needsYou: [
          item({ key: 'workflow_run:r:s', entity: 'workflow_run', entityId: 'r', state: 'needs_you', stoppable: true, ask: { kind: 'stage_approval', id: 's', summary: 'Approve', actions: ['approve', 'reject', 'open'] } }),
          item({ key: 'chat:w:g', entity: 'chat', entityId: 'w', state: 'needs_you', stoppable: true, parent: { entity: 'chat', id: 'o', title: 'Orch' }, ask: { kind: 'tool_permission', id: 'g', summary: 'Allow Bash?', actions: ['allow_once', 'deny', 'open'] } }),
        ],
        running: [item({ key: 'chat:c', entity: 'chat', entityId: 'c', stoppable: true })],
      },
      recent: [],
    });
    const run = model.groups.needs_you.find((e) => e.kind === 'workflow');
    const orch = model.groups.needs_you.find((e) => e.kind === 'orchestrator');
    expect(stopTarget(run!)?.key).toBe('workflow_run:r:s');
    expect(stopTarget(orch!)).toBeUndefined();
    expect(stopTarget(model.groups.running[0]!)?.key).toBe('chat:c');
    expect(askAnswers(run!)).toEqual({ approve: { action: 'approve', label: 'Approve' }, decline: { action: 'reject', label: 'Reject' } });
    expect(askAnswers(orch!)).toEqual({ approve: { action: 'allow_once', label: 'Allow once' }, decline: { action: 'deny', label: 'Deny' } });
  });
});
