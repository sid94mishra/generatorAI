import { describe, expect, it } from 'vitest';


import {
  groupApprovals,
  needsYouCount,
  type Operation,
} from '../services/api/activityRanking';

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

describe('groupApprovals / needsYouCount', () => {
  const ops = [
    op({ id: 'chat:a', kind: 'chat', blocked: true }),
    op({ id: 'chat:b', kind: 'chat', running: true }),
    op({ id: 'run:c', kind: 'run', blocked: true, status: 'awaiting_input' }),
    op({ id: 'run:d', kind: 'run', blocked: true, status: 'failed' }),
    op({ id: 'automation:e', kind: 'automation', blocked: true }),
  ];

  it('groups every server-provided ask', () => {
    const groups = groupApprovals(ops);
    expect(groups.chats.map((o) => o.id)).toEqual(['chat:a']);
    expect(groups.runs.map((o) => o.id)).toEqual(['run:c', 'run:d', 'automation:e']);
    expect(groups.total).toBe(4);
  });

  it('is the number the tab badge and the accessory strip show', () => {
    expect(needsYouCount(ops)).toBe(4);
    expect(needsYouCount([])).toBe(0);
  });
});
