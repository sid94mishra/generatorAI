import { describe, expect, it } from 'vitest';
import { classifyPermissionRisk } from '../gateRisk.js';

describe('classifyPermissionRisk (MG-04)', () => {
  it('marks shell and network gates risky', () => {
    expect(classifyPermissionRisk({ type: 'shell_exec', toolName: 'Bash', inputSummary: 'ls' })).toEqual({
      risk: 'risky',
      reasons: ['runs a shell command'],
    });
    expect(classifyPermissionRisk({ type: 'network', toolName: 'WebFetch' }).risk).toBe('risky');
  });

  it('marks a git push risky, with both reasons when it is also a shell command', () => {
    expect(classifyPermissionRisk({ type: 'shell_exec', toolName: 'Bash', inputSummary: 'git -C repo push -u origin main' }).reasons).toEqual([
      'runs a shell command',
      'pushes to a git remote',
    ]);
    expect(classifyPermissionRisk({ type: 'other', toolName: 'git', inputSummary: 'git push' }).risk).toBe('risky');
    expect(classifyPermissionRisk({ type: 'other', toolName: 'git', inputSummary: 'git pushd-helper' }).risk).toBe('standard');
  });

  it('marks a write that leaves the workspace risky, not one inside it', () => {
    expect(classifyPermissionRisk({ type: 'file_write', toolName: 'Write', inputSummary: '../secrets/.env' }).risk).toBe('risky');
    expect(classifyPermissionRisk({ type: 'file_write', toolName: 'Write', inputSummary: '~/.ssh/config' }).risk).toBe('risky');
    expect(classifyPermissionRisk({ type: 'file_write', toolName: 'Write', inputSummary: 'src/app.ts' })).toEqual({ risk: 'standard', reasons: [] });
    expect(classifyPermissionRisk({ type: 'file_read', toolName: 'Read', inputSummary: '../x' }).risk).toBe('standard');
  });
});
