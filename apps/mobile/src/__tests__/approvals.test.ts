import { describe, expect, it } from 'vitest';

import type { InteractionSummary } from '@generatorai/client-core';

import {
  gateFromInteraction,
  groupApprovals,
  needsYouCount,
  primaryGate,
  type Operation,
} from '../api/activityRanking';

function op(partial: Partial<Operation> & Pick<Operation, 'id' | 'kind'>): Operation {
  return {
    name: partial.id,
    status: 'active',
    updatedAt: 0,
    href: '/',
    blocked: false,
    running: false,
    ...partial,
  };
}

function interaction(kind: string, payload: Record<string, unknown>, status = 'pending'): InteractionSummary {
  return { interactionId: `${kind}-1`, kind, status, payload };
}

describe('gateFromInteraction', () => {
  it('reads the tool-permission payload the server opened the gate with', () => {
    const gate = gateFromInteraction(interaction('tool_permission', { toolName: 'Bash', type: 'shell' }));
    expect(gate).toEqual({
      interactionId: 'tool_permission-1',
      kind: 'tool_permission',
      summary: 'Allow Bash?',
      subject: 'Bash',
    });
  });

  it('counts questions and carries the plan id', () => {
    expect(gateFromInteraction(interaction('question', { questions: [{}, {}] }))?.summary).toBe(
      'Answer 2 questions',
    );
    expect(gateFromInteraction(interaction('question', { questions: [{}] }))?.summary).toBe(
      'Answer a question',
    );
    const plan = gateFromInteraction(interaction('plan_review', { planId: 'p1', title: 'Ship it' }));
    expect(plan).toMatchObject({ kind: 'plan_review', planId: 'p1', subject: 'Ship it' });
  });

  it('ignores resolved rows and unknown kinds', () => {
    expect(gateFromInteraction(interaction('question', {}, 'answered'))).toBeNull();
    expect(gateFromInteraction(interaction('something_new', {}))).toBeNull();
  });
});

describe('primaryGate', () => {
  it('ranks a permission over a question over a plan, like the chat screen', () => {
    const gate = primaryGate([
      interaction('plan_review', { planId: 'p' }),
      interaction('question', { questions: [{}] }),
      interaction('tool_permission', { toolName: 'Edit' }),
    ]);
    expect(gate?.kind).toBe('tool_permission');
    expect(primaryGate(undefined)).toBeNull();
    expect(primaryGate([interaction('question', {}, 'expired')])).toBeNull();
  });
});

describe('groupApprovals / needsYouCount', () => {
  const ops = [
    op({ id: 'chat:a', kind: 'chat', blocked: true }),
    op({ id: 'chat:b', kind: 'chat', running: true }),
    op({ id: 'run:c', kind: 'run', blocked: true, status: 'awaiting_input' }),
    op({ id: 'run:d', kind: 'run', blocked: true, status: 'failed' }),
    op({ id: 'automation:e', kind: 'automation', blocked: true }),
  ];

  it('groups only blocked chats and runs', () => {
    const groups = groupApprovals(ops);
    expect(groups.chats.map((o) => o.id)).toEqual(['chat:a']);
    expect(groups.runs.map((o) => o.id)).toEqual(['run:c', 'run:d']);
    expect(groups.total).toBe(3);
  });

  it('is the number the tab badge and the accessory strip show', () => {
    // Automations never block, so a stray flag on one must not count.
    expect(needsYouCount(ops)).toBe(3);
    expect(needsYouCount([])).toBe(0);
  });
});
