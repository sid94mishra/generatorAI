// The Tasks-panel section registry is an extension point the Workflow
// Overhaul (P06) builds on (D-35): pin its contract.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chat } from '@generatorai/shared';
import {
  listTasksSections,
  registerTasksSection,
  visibleTasksSections,
  type TasksSectionDefinition,
} from '../tasksSections.js';
import { bucketTasks, cancelledLine, filterTasks, formatElapsed, progressSegments } from '../backgroundTasksModel.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function section(id: string, order: number, extra: Partial<TasksSectionDefinition> = {}): TasksSectionDefinition {
  return { id, title: id, order, render: () => null, ...extra };
}
function add(def: TasksSectionDefinition) {
  cleanups.push(registerTasksSection(def));
}

const chat = { id: 'c1', name: 'Orchestrator', sessionId: 's1', orchestratorMode: true } as unknown as Chat;

describe('tasks section registry', () => {
  it('orders by `order`, then id', () => {
    add(section('drafts', 300));
    add(section('workflow-runs', 200));
    add(section('b-agents', 200));
    expect(listTasksSections().map((s) => s.id)).toEqual(['b-agents', 'workflow-runs', 'drafts']);
  });

  it('rejects duplicate and non-kebab ids', () => {
    add(section('background-agents', 100));
    expect(() => registerTasksSection(section('background-agents', 150))).toThrow(/already registered/);
    expect(() => registerTasksSection(section('Workflow Runs', 200))).toThrow(/kebab-case/);
  });

  it('`replace` (hot reload) swaps the entry in place of throwing', () => {
    add(section('background-agents', 100));
    expect(() => registerTasksSection(section('background-agents', 100, { title: 'v2' }))).toThrow();
    cleanups.push(registerTasksSection(section('background-agents', 100, { title: 'v3' }), { replace: true }));
    expect(listTasksSections().map((s) => s.title)).toEqual(['v3']);
  });

  it('unregister removes only that entry and is idempotent', () => {
    const off = registerTasksSection(section('one', 1));
    add(section('two', 2));
    off();
    off();
    expect(listTasksSections().map((s) => s.id)).toEqual(['two']);
  });

  it('`when` filters per chat', () => {
    const when = vi.fn(({ chat: c }: { chat: Chat }) => c.orchestratorMode === false);
    add(section('shown', 1));
    add(section('hidden', 2, { when }));
    expect(visibleTasksSections(listTasksSections(), { chatId: 'c1', chat }).map((s) => s.id)).toEqual(['shown']);
    expect(when).toHaveBeenCalledWith({ chatId: 'c1', chat });
  });
});

describe('background tasks model', () => {
  const tasks = [
    { taskId: 'a', taskName: 'A', status: 'running', reviewRounds: 0 },
    { taskId: 'b', taskName: 'B', status: 'needs_review', reviewRounds: 1 },
    { taskId: 'c', taskName: 'C', status: 'completed', reviewRounds: 1 },
    { taskId: 'd', taskName: 'D', status: 'cancelled', reviewRounds: 0, cancelledBy: 'user', cancelledAt: 0 },
  ] as const;

  it('buckets, filters and draws only non-empty segments; asks come out of running', () => {
    const b = bucketTasks([...tasks]);
    expect(b).toMatchObject({ total: 4, active: 2, done: 2, running: 1, inReview: 1, completed: 1, cancelled: 1 });
    expect(filterTasks([...tasks], 'active').map((t) => t.taskId)).toEqual(['a', 'b']);
    expect(progressSegments(b, 1).map((s) => [s.key, s.count])).toEqual([
      ['needs-you', 1],
      ['review', 1],
      ['completed', 1],
      ['cancelled', 1],
    ]);
  });

  it('formats elapsed time and the G-20 attribution', () => {
    expect(formatElapsed(96_000)).toBe('1:36');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
    expect(formatElapsed(-5)).toBe('0:00');
    expect(cancelledLine({ cancelledBy: 'user', cancelledAt: 1 }, () => '14:09')).toBe('by you at 14:09');
    expect(cancelledLine({ cancelledBy: 'orchestrator' })).toBe('by Orchestrator');
    expect(cancelledLine({})).toBeNull();
  });
});
