import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@generatorai/shared';

import { askDetailLine, askHint, attentionLabel, sectionRows } from './attentionModel';

const item = (over: Partial<AttentionItem>): AttentionItem => ({
  key: 'chat:c1:i1', entity: 'chat', entityId: 'c1', title: 'Fix flaky checkout test', href: '/chats/c1',
  state: 'needs_you', since: '2026-10-02T10:00:00Z', stoppable: false, ...over,
});

describe('AttentionList model (MB-19)', () => {
  it('derives the drawer hint from the ask', () => {
    expect(askHint(item({ ask: { kind: 'plan_review', id: 'p', summary: 'Review plan', actions: [] } }))).toBe('Plan');
    expect(askHint(item({ ask: { kind: 'stage_approval', id: 's', summary: 'Approve', actions: [] } }))).toBe('Approve');
    expect(askHint(item({ ask: { kind: 'tool_permission', id: 'i', summary: 'Allow Bash?', detail: 'git push -u origin fix', actions: [] } }))).toBe('git push');
    expect(askHint(item({ ask: { kind: 'tool_permission', id: 'i', summary: 'Allow Bash?', actions: [] } }))).toBe('Allow');
    expect(askHint(item({}))).toBeUndefined();
    // The feed's detail is the clipped JSON tool input: the hint names the command, never `{ "command":`.
    expect(askHint(item({ ask: { kind: 'tool_permission', id: 'i', summary: 'Allow shell_exec?', detail: '{\n "command": "pnpm test --watch', actions: [] } }))).toBe('pnpm test');
    expect(askHint(item({ ask: { kind: 'tool_permission', id: 'i', summary: 'Allow file_write?', detail: '{ "path": "src/config.ts" }', actions: [] } }))).toBe('src/config.ts');
  });

  it('reads the command, path or url out of a JSON detail', () => {
    expect(askDetailLine('{ "command": "git push -u origin \\"x\\"" }')).toBe('git push -u origin "x"');
    expect(askDetailLine('{ "count": 3 }')).toBe('{ "count": 3 }');
    expect(askDetailLine('plain words')).toBe('plain words');
    expect(askDetailLine(undefined)).toBeUndefined();
  });

  it('shows five rows and offers the rest behind "Show all"', () => {
    expect(sectionRows([1, 2, 3])).toEqual({ rows: [1, 2, 3], total: 3, overflow: false });
    const many = sectionRows([1, 2, 3, 4, 5, 6, 7]);
    expect(many.rows).toHaveLength(5);
    expect(many).toMatchObject({ total: 7, overflow: true });
  });

  it('labels rows for screen readers', () => {
    expect(attentionLabel(item({ ask: { kind: 'stage_approval', id: 's', summary: 'Approve “Apply upgrades”', actions: [] } }))).toBe('Fix flaky checkout test, needs you, Approve “Apply upgrades”');
    expect(attentionLabel(item({ state: 'running' }), '4:12')).toBe('Fix flaky checkout test, running, 4:12');
  });
});
