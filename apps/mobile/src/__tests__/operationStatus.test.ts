import { describe, expect, it } from 'vitest';

import type { Operation } from '../api/activityRanking';
import { operationState, operationStateLabel } from '../components/home/operationStatus';

const op = (over: Partial<Operation>): Operation => ({
  id: 'x',
  kind: 'run',
  name: 'Code Review Workflow',
  status: 'completed',
  updatedAt: 0,
  href: '/runs/x',
  blocked: false,
  running: false,
  ...over,
});

describe('operationState', () => {
  it('ranks a failure above waiting and running', () => {
    expect(operationState(op({ status: 'failed', blocked: true }))).toBe('failed');
    expect(operationState(op({ status: 'running', blocked: true, running: true }))).toBe('waiting');
    expect(operationState(op({ status: 'running', running: true }))).toBe('running');
    expect(operationState(op({ status: 'completed' }))).toBe('completed');
    expect(operationState(op({ status: 'cancelled' }))).toBe('cancelled');
  });

  it('words each state, and calls a chat between turns Idle', () => {
    expect(operationStateLabel(op({ status: 'failed' }))).toBe('Failed');
    expect(operationStateLabel(op({ blocked: true }))).toBe('Needs you');
    expect(operationStateLabel(op({ kind: 'chat', status: 'active' }))).toBe('Idle');
  });
});
