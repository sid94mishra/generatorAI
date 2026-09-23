import { describe, expect, it } from 'vitest';

import type { Operation } from '../api/activityRanking';
import { operationActionFor } from '../components/home/operationActions';

const op = (partial: Partial<Operation>): Operation => ({
  id: 'chat:c1', kind: 'chat', name: 'x', status: 'active', updatedAt: 0, href: '/chats/c1', blocked: false, running: false,
  ...partial,
});

describe('operationActionFor', () => {
  it('stops a running chat turn, but never one parked on a gate', () => {
    expect(operationActionFor(op({ running: true }))).toMatchObject({ kind: 'stop-chat', id: 'c1', confirm: false });
    expect(operationActionFor(op({ running: true, blocked: true }))).toBeNull();
    expect(operationActionFor(op({}))).toBeNull();
  });

  it('cancels a running run behind a confirmation and retries a failed one', () => {
    expect(operationActionFor(op({ id: 'run:r1', kind: 'run', running: true, status: 'running' }))).toMatchObject({
      kind: 'cancel-run', id: 'r1', confirm: true,
    });
    expect(operationActionFor(op({ id: 'run:r1', kind: 'run', status: 'failed', blocked: true }))).toMatchObject({
      kind: 'retry-run', label: 'Retry',
    });
    expect(operationActionFor(op({ id: 'run:r1', kind: 'run', status: 'completed' }))).toBeNull();
  });

  it('offers nothing on automations', () => {
    expect(operationActionFor(op({ id: 'automation:a1', kind: 'automation', status: 'enabled' }))).toBeNull();
  });
});
