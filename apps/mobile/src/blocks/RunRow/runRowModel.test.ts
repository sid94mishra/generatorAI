import { describe, expect, it } from 'vitest';

import { runRowView, shortDuration, triggerLabel } from './runRowModel';

const base = { id: 'r1', workflowDefinitionId: 'w1', name: 'Nightly audit - Run 1789753968513', createdAt: '2026-10-01T10:00:00.000Z' };

describe('runRowView (MB-49)', () => {
  it('inside a workflow: the status word is the title; time · version · trigger', () => {
    const v = runRowView({ ...base, status: 'completed', startedAt: '2026-10-01T10:00:00.000Z', completedAt: '2026-10-01T10:12:40.000Z', trigger: { kind: 'user', client: 'mobile' } }, { context: 'workflow', versionLabel: 'v7' });
    expect(v.title).toBe('Succeeded');
    expect(v.meta.slice(1)).toEqual(['v7', 'Manual']);
    expect(v.duration).toBe('12m 40s');
    expect(v.live).toBe(false);
  });

  it('across workflows: the run name without its epoch suffix, the status word first', () => {
    const v = runRowView({ ...base, status: 'waiting', trigger: { kind: 'automation' } }, { context: 'any', workflowName: 'Nightly audit' });
    expect(v.title).toBe('Nightly audit');
    expect(v.meta[0]).toBe('Waiting');
    expect(v.meta).toContain('Automation');
    expect(v.duration).toBeNull();
  });

  it('a live run counts from its start', () => {
    const v = runRowView({ ...base, status: 'running', startedAt: '2026-10-01T10:00:00.000Z' }, { context: 'workflow', now: Date.parse('2026-10-01T10:04:12.000Z') });
    expect(v.duration).toBe('4m 12s');
    expect(v.live).toBe(true);
  });

  it('names triggers and forks', () => {
    expect(triggerLabel({ kind: 'user', client: 'cli' })).toBe('CLI');
    expect(triggerLabel({ kind: 'user', client: 'web' }, 'r0')).toBe('Fork');
    expect(triggerLabel({ kind: 'chat' })).toBe('Chat');
    expect(triggerLabel(undefined)).toBe('Manual');
    expect(shortDuration(3_900_000)).toBe('1h 5m');
  });
});
