// Seeding the chat screen's pinned gate from `GET /chats/:id/interactions`
// when the stream has no block for it (cold load, Home card, push deep link).

import { describe, expect, it } from 'vitest';

import { gateFromPayload, pendingGateFrom } from '../components/chat/gateFromInteraction';

describe('gateFromPayload', () => {
  it('rebuilds a tool_permission row into the PermissionBlock shape', () => {
    const gate = gateFromPayload('i1', 'tool_permission', {
      toolName: 'Bash',
      type: 'shell_exec',
      description: 'Run a command',
      inputSummary: 'pwsh -c ls',
      permissionMode: 'default',
    });
    expect(gate).toEqual({
      kind: 'permission',
      block: {
        type: 'permission',
        blockId: 0,
        interactionId: 'i1',
        toolName: 'Bash',
        permissionType: 'shell_exec',
        description: 'Run a command',
        inputSummary: 'pwsh -c ls',
        permissionMode: 'default',
        status: 'pending',
      },
    });
  });

  it('rebuilds a question row, tolerating a missing questions list', () => {
    expect(gateFromPayload('q1', 'question', {})).toEqual({
      kind: 'question',
      block: { type: 'question', blockId: 0, interactionId: 'q1', questions: [], status: 'pending' },
    });
  });

  it('rebuilds a plan_review row as an awaiting_review plan', () => {
    const gate = gateFromPayload('p1', 'plan_review', { planId: 'plan-9', title: 'Do it', actions: ['implement'] });
    expect(gate.kind).toBe('plan');
    if (gate.kind !== 'plan') return;
    expect(gate.plan.planId).toBe('plan-9');
    expect(gate.plan.status).toBe('awaiting_review');
    expect(gate.plan.interactionId).toBe('p1');
  });

  it('does not invent a card for a kind this build cannot render', () => {
    expect(gateFromPayload('x', 'something_new', {}).kind).toBe('unknown');
  });
});

describe('pendingGateFrom', () => {
  it('returns null with no rows, or with nothing pending', () => {
    expect(pendingGateFrom(undefined)).toBeNull();
    expect(pendingGateFrom([])).toBeNull();
    expect(
      pendingGateFrom([{ interactionId: 'a', kind: 'tool_permission', status: 'resolved', payload: {} }]),
    ).toBeNull();
  });

  it('surfaces the first pending row and skips resolved ones', () => {
    const gate = pendingGateFrom([
      { interactionId: 'old', kind: 'question', status: 'answered', payload: {} },
      { interactionId: 'now', kind: 'tool_permission', status: 'pending', payload: { toolName: 'PowerShell' } },
      { interactionId: 'later', kind: 'question', status: 'pending', payload: {} },
    ]);
    expect(gate?.kind).toBe('permission');
    if (gate?.kind !== 'permission') return;
    expect(gate.block.interactionId).toBe('now');
    expect(gate.block.toolName).toBe('PowerShell');
  });

  it('treats an unrenderable pending kind as no gate rather than a blank card', () => {
    expect(pendingGateFrom([{ interactionId: 'z', kind: 'mystery', status: 'pending' }])).toBeNull();
  });
});
