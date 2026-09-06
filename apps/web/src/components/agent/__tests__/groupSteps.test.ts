import { describe, expect, it } from 'vitest';
import { groupSteps } from '../groupSteps.js';
import type { TimelineStep, StepKind, StepStatus } from '@/components/chat/redesign/types.js';

let n = 0;
function step(kind: StepKind, target: string, extra: Partial<TimelineStep> = {}): TimelineStep {
  n += 1;
  return { id: `s${n}`, kind, verb: kind, target, status: 'done' as StepStatus, ...extra };
}

describe('groupSteps', () => {
  it('folds consecutive same-kind tool calls and leaves singles alone', () => {
    const entries = groupSteps([
      step('read', 'a.ts'),
      step('read', 'b.ts'),
      step('read', 'c.ts'),
      step('edit', 'a.ts', { fileOp: { kind: 'edit', filePath: 'a.ts', additions: 3, deletions: 1 } }),
      step('run', 'npm test'),
    ]);
    expect(entries.map((e) => e.type)).toEqual(['group', 'step', 'step']);
    const g = entries[0]!;
    if (g.type !== 'group') throw new Error('expected group');
    expect(g.label).toBe('Read 3 files');
    expect(g.summary).toBe('c.ts, b.ts, a.ts');
    expect(g.status).toBe('done');
    expect(g.id).toBe('group-s1');
  });

  it('never folds thinking, sub-agents, warnings or errors', () => {
    const entries = groupSteps([
      step('think', 'x'),
      step('think', 'y'),
      step('warning', 'w'),
      step('error', 'e'),
      step('subagent', 'Explore', { children: [step('read', 'z')] }),
    ]);
    expect(entries.every((e) => e.type === 'step')).toBe(true);
  });

  it('a running tail makes the group live and keeps its id stable', () => {
    const a = step('search', 'foo');
    const b = step('search', 'bar', { status: 'running' });
    const first = groupSteps([a, b]);
    const g1 = first[0]!;
    if (g1.type !== 'group') throw new Error('expected group');
    expect(g1.status).toBe('running');
    expect(g1.label).toBe('Searching (2)');
    const c = step('search', 'baz');
    const second = groupSteps([a, { ...b, status: 'done' }, c]);
    const g2 = second[0]!;
    if (g2.type !== 'group') throw new Error('expected group');
    expect(g2.id).toBe(g1.id);
    expect(g2.label).toBe('Searched 3 times');
  });

  it('counts failures and aggregates file-op stats for edit groups', () => {
    const entries = groupSteps([
      step('edit', 'a.ts', { fileOp: { kind: 'edit', filePath: 'a.ts', additions: 3, deletions: 1 } }),
      step('edit', 'a.ts', { fileOp: { kind: 'edit', filePath: 'a.ts', additions: 2, deletions: 0 } }),
      step('edit', 'b.ts', { status: 'failed' }),
    ]);
    const g = entries[0]!;
    if (g.type !== 'group') throw new Error('expected group');
    expect(g.label).toBe('Edited 2 files');
    expect(g.failed).toBe(1);
    expect(g.status).toBe('failed');
    expect(g.fileOps).toEqual({ files: 1, additions: 5, deletions: 1 });
  });

  it('names a run of one generic tool after that tool and pluralises singles', () => {
    const same = groupSteps([step('tool', 'a', { verb: 'navigate_page' }), step('tool', 'b', { verb: 'navigate_page' })]);
    const g = same[0]!;
    if (g.type !== 'group') throw new Error('expected group');
    expect(g.label).toBe('navigate_page ×2');
    const one = groupSteps([step('read', 'x.ts'), step('read', 'x.ts')]);
    const g2 = one[0]!;
    if (g2.type !== 'group') throw new Error('expected group');
    expect(g2.label).toBe('Read 1 file');
  });

  it('breaks a run when the kind changes', () => {
    const entries = groupSteps([step('read', 'a'), step('read', 'b'), step('search', 'x'), step('search', 'y')]);
    expect(entries.map((e) => e.type)).toEqual(['group', 'group']);
  });
});
