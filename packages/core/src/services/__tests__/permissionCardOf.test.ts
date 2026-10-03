import { describe, expect, it } from 'vitest';
import type { AgentInteraction } from '@generatorai/shared';
import { permissionCardOf } from '../ChatManagementService.js';

const base: AgentInteraction = {
  id: 'i1',
  scopeKind: 'chat',
  scopeId: 'c1',
  chatId: 'c1',
  kind: 'tool_permission',
  status: 'pending',
  payload: {
    toolName: 'Bash',
    type: 'shell_exec',
    description: 'Push the branch',
    inputSummary: '{"command":"git push"}',
    permissionMode: 'default',
    risk: 'risky',
    riskReasons: ['writes to a remote'],
  },
  createdAt: new Date(0),
};

describe('permissionCardOf', () => {
  it('keeps an allowed gate in the transcript with its verdict and order', () => {
    const card = permissionCardOf({ ...base, status: 'answered', resolution: { granted: true } }, 3);
    expect(card).toEqual({
      interactionId: 'i1',
      toolName: 'Bash',
      type: 'shell_exec',
      description: 'Push the branch',
      inputSummary: '{"command":"git push"}',
      status: 'allowed',
      sequence: 3,
      risk: 'risky',
      riskReasons: ['writes to a remote'],
    });
  });

  it('records a denial with its reason, and an unanswered gate as expired', () => {
    expect(permissionCardOf({ ...base, status: 'answered', resolution: { granted: false, reason: 'not now' } }, undefined)).toMatchObject({
      status: 'denied',
      message: 'not now',
    });
    expect(permissionCardOf({ ...base, status: 'cancelled' }, undefined).status).toBe('expired');
    expect(permissionCardOf(base, undefined).status).toBe('pending');
  });
});
