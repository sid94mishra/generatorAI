import { describe, expect, it } from 'vitest';
import { approvalFailureNote, approvalPrompt, permissionCategory, permissionRisk, permissionView, resolvedWords, riskyActionState } from './gateModel';

const perm = (over: Record<string, unknown> = {}) =>
  ({ type: 'permission', blockId: 1, interactionId: 'i1', toolName: 'Bash', permissionType: 'shell_exec', description: 'Publishes the branch', inputSummary: JSON.stringify({ command: 'git push -u origin fix' }), permissionMode: 'default', status: 'pending', ...over }) as never;

describe('gate model (MB-15)', () => {
  it('takes the server risk, else the shared rule (MD-31)', () => {
    expect(permissionRisk({ risk: 'standard', permissionType: 'shell_exec', toolName: 'Bash', inputSummary: '' })).toBe('standard');
    expect(permissionRisk({ permissionType: 'shell_exec', toolName: 'Bash', inputSummary: '' })).toBe('risky');
    expect(permissionRisk({ permissionType: 'file_read', toolName: 'Read', inputSummary: 'a.ts' })).toBe('standard');
    expect(permissionCategory('network')).toBe('Network');
  });

  it('shows the command once, with the agent note as the explanation', () => {
    expect(permissionView(perm())).toEqual({ code: 'git push -u origin fix', explanation: 'Publishes the branch', edit: null });
  });

  it('words settled gates; pending ones have none', () => {
    expect(resolvedWords(perm({ status: 'allowed' }))).toMatchObject({ words: 'Allowed once', detail: 'git push -u origin fix', tone: 'ok' });
    expect(resolvedWords(perm({ status: 'denied' }))?.words).toBe('Denied');
    expect(resolvedWords(perm())).toBeNull();
    expect(resolvedWords({ type: 'plan', status: 'approved', title: 'Fix' } as never)?.words).toBe('Approved: Fix');
  });

  it('tells a risky gate what this device can do (register, unsupported, old app)', () => {
    expect(riskyActionState('ok', 'Face ID')).toMatchObject({ canAnswer: true, note: 'Face ID required' });
    expect(riskyActionState('missing', 'fingerprint')).toMatchObject({ canAnswer: false, needsRegistration: true });
    expect(riskyActionState('unsupported', 'Face ID').note).toBe('Needs Face ID or a passcode on this device');
    expect(riskyActionState('unavailable', 'Face ID').needsRegistration).toBe(false);
    expect(approvalPrompt('allow', 'git push').title).toBe('Approve "git push"?');
  });

  it('says something visible for every way the approval prompt can end without a signature', () => {
    expect(approvalFailureNote('timeout', 'register', 'Face ID')).toBe('Couldn’t complete — try again.');
    for (const code of ['cancelled', 'timeout', 'unsupported', 'missing', 'invalidated', 'failed'] as const) {
      expect(approvalFailureNote(code, 'register', 'Face ID').length).toBeGreaterThan(0);
      expect(approvalFailureNote(code, 'sign', 'Face ID').length).toBeGreaterThan(0);
    }
    expect(approvalFailureNote('cancelled', 'sign', 'Face ID')).toMatch(/still waiting/);
  });
});
