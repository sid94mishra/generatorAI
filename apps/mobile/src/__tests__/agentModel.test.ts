import { describe, expect, it } from 'vitest';

import {
  agentBadges,
  delegateTargets,
  humanizeId,
  instructionPreview,
  resolveNames,
  runtimeRows,
  scopeLabel,
  startChatAvailability,
  startChatBody,
  summarizeUsage,
} from '../components/work/agentModel';

describe('scopeLabel', () => {
  it('maps scopes to plain words', () => {
    expect(scopeLabel('system')).toBe('Built-in');
    expect(scopeLabel('global')).toBe('Global');
    expect(scopeLabel('project')).toBe('Project');
  });
});

describe('agentBadges', () => {
  it('shows nothing for a default agent', () => {
    expect(agentBadges({ role: 'agent', enabled: true, scope: 'global' })).toEqual([]);
    expect(agentBadges({ role: 'agent', enabled: true, scope: 'system' })).toEqual([]);
  });

  it('shows only non-default state, never a decorative status hue', () => {
    const badges = agentBadges({ role: 'orchestrator', enabled: false, scope: 'project' });
    expect(badges.map((b) => b.label)).toEqual(['Disabled', 'Orchestrator', 'Project']);
    expect(badges.find((b) => b.label === 'Orchestrator')?.tone).toBe('neutral');
  });
});

describe('startChatAvailability', () => {
  it('requires the agent to be enabled', () => {
    expect(startChatAvailability({ enabled: false }, ['write:chats']).allowed).toBe(false);
  });
  it('requires write:chats', () => {
    const r = startChatAvailability({ enabled: true }, ['read:chats']);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/not allowed/);
  });
  it('allows an enabled agent with the default grant', () => {
    expect(startChatAvailability({ enabled: true }, ['read:chats', 'write:chats'])).toEqual({
      allowed: true,
      reason: null,
    });
  });
});

describe('startChatBody', () => {
  it('binds the ref and omits projectId outside project scope', () => {
    expect(startChatBody({ name: 'Reviewer', ref: 'system:reviewer', scope: 'system', projectId: '' })).toEqual({
      name: 'Reviewer',
      agentRef: 'system:reviewer',
    });
  });
  it('carries projectId for a project agent', () => {
    expect(startChatBody({ name: 'Helper', ref: 'project:helper', scope: 'project', projectId: 'p1' })).toEqual({
      name: 'Helper',
      agentRef: 'project:helper',
      projectId: 'p1',
    });
  });
  it('never sends an empty name (the server requires one)', () => {
    expect(startChatBody({ name: '  ', ref: 'global:x', scope: 'global' }).name).toBe('New chat');
  });
});

describe('runtimeRows', () => {
  it('shows "Inherits" for the model and omits unset rows', () => {
    expect(runtimeRows({})).toEqual([{ key: 'model', title: 'Model', value: 'Inherits' }]);
    expect(runtimeRows(undefined)).toHaveLength(1);
  });

  it('labels every set field', () => {
    const rows = runtimeRows(
      { model: 'claude-x', harnessType: 'claude-agent', reasoningEffort: 'xhigh', permissionMode: 'acceptEdits' },
      (id) => (id === 'claude-x' ? 'Claude X' : undefined),
    );
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ['model', 'Claude X'],
      ['provider', 'Claude Code'],
      ['effort', 'Extra high'],
      ['permission', 'Auto-accept edits'],
    ]);
  });

  it('falls back to the raw model id when no name is known', () => {
    expect(runtimeRows({ model: 'gpt-9' }, () => undefined)[0]?.value).toBe('gpt-9');
  });
});

describe('instructionPreview', () => {
  it('returns short text untouched', () => {
    expect(instructionPreview('Be concise.')).toEqual({ text: 'Be concise.', truncated: false });
  });
  it('is empty for missing instructions', () => {
    expect(instructionPreview(undefined)).toEqual({ text: '', truncated: false });
    expect(instructionPreview('  \n\n ')).toEqual({ text: '', truncated: false });
  });
  it('cuts to the first lines and marks truncation', () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    const p = instructionPreview(text, 6);
    expect(p.truncated).toBe(true);
    expect(p.text.split('\n')).toHaveLength(6);
    expect(p.text.endsWith('line 6…')).toBe(true);
  });
  it('collapses blank-line runs and caps very long lines', () => {
    expect(instructionPreview('a\n\n\n\nb').text).toBe('a\n\nb');
    const p = instructionPreview('word '.repeat(300), 6, 100);
    expect(p.truncated).toBe(true);
    expect(p.text.length).toBeLessThanOrEqual(101);
  });
});

describe('humanizeId', () => {
  it('humanises slug-like ids', () => {
    expect(humanizeId('code-review')).toBe('Code review');
    expect(humanizeId('mcp/github_server')).toBe('Github server');
    expect(humanizeId('project:my-helper')).toBe('My helper');
    expect(humanizeId('skills/writeTests.md')).toBe('Write tests');
  });
  it('shortens UUIDs instead of mangling them', () => {
    expect(humanizeId('3f2a9c1e-1111-2222-3333-444455556666')).toBe('3f2a9c1e');
  });
});

describe('resolveNames', () => {
  it('prefers earlier catalogues and falls back to a humanised id', () => {
    const result = resolveNames(
      ['a', 'b', 'unknown-skill'],
      [{ id: 'a', name: 'Project A' }],
      [
        { id: 'a', name: 'System A' },
        { id: 'b', name: 'System B' },
      ],
    );
    expect(result).toEqual([
      { id: 'a', name: 'Project A', known: true },
      { id: 'b', name: 'System B', known: true },
      { id: 'unknown-skill', name: 'Unknown skill', known: false },
    ]);
  });
  it('keys MCP entries without an id by name and tolerates missing catalogues', () => {
    expect(resolveNames(['github'], undefined, [{ name: 'github' }])[0]?.known).toBe(true);
  });
});

describe('delegateTargets', () => {
  it('returns null for "any agent"', () => {
    expect(delegateTargets(undefined, [])).toBeNull();
    expect(delegateTargets({ teamAgentRefs: [] }, [])).toBeNull();
  });
  it('resolves refs to names, humanising unknown ones', () => {
    expect(
      delegateTargets({ teamAgentRefs: ['global:tester', 'system:doc-writer'] }, [
        { ref: 'global:tester', name: 'Tester' },
      ]),
    ).toEqual([
      { ref: 'global:tester', name: 'Tester' },
      { ref: 'system:doc-writer', name: 'Doc writer' },
    ]);
  });
});

describe('summarizeUsage', () => {
  it('reads the server shape and drops empty groups', () => {
    const s = summarizeUsage({
      chats: [{ id: 'c1', name: 'Fix login' }],
      stages: [],
      workflows: [{ id: 'w1', name: '' }],
    });
    expect(s.total).toBe(2);
    expect(s.groups.map((g) => g.key)).toEqual(['workflows', 'chats']);
    expect(s.groups[0]?.items[0]?.name).toBe('Untitled');
  });
  it('treats malformed payloads as unused', () => {
    expect(summarizeUsage(null)).toEqual({ total: 0, groups: [] });
    expect(summarizeUsage({ chats: 'nope', workflows: [null, { name: 'no id' }] })).toEqual({ total: 0, groups: [] });
  });
});
