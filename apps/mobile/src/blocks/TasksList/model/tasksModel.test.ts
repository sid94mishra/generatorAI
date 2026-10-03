import { describe, expect, it } from 'vitest';
import type { BackgroundTaskListItem } from '@generatorai/shared';

import { filterTasks, taskNote, taskStatus, taskSummary } from './tasksModel';

const task = (taskName: string, status: BackgroundTaskListItem['status'], reviewRounds = 0): BackgroundTaskListItem => ({ taskId: taskName, taskName, status, reviewRounds });

describe('tasks (MB-30, MD-25)', () => {
  it('words statuses through the shared map', () => {
    expect(taskStatus('spawned')).toMatchObject({ state: 'queued', label: 'Starting' });
    expect(taskStatus('completed')).toMatchObject({ state: 'succeeded', label: 'Done' });
    expect(taskStatus('needs_review')).toMatchObject({ state: 'waiting' });
  });

  it('filters and summarises', () => {
    const list = [task('a', 'running'), task('b', 'needs_review'), task('c', 'completed', 1), task('d', 'spawned')];
    expect(filterTasks(list, 'active').map((t) => t.taskName)).toEqual(['a', 'b', 'd']);
    expect(filterTasks(list, 'done').map((t) => t.taskName)).toEqual(['c']);
    const summary = taskSummary(list);
    expect([summary.total, summary.active, summary.done]).toEqual([4, 3, 1]);
    expect(summary.legend.map((l) => `${l.count} ${l.label}`)).toEqual(['1 Running', '1 In review', '1 Done', '1 Starting']);
    expect(summary.segments).toHaveLength(4);
  });

  it('notes review rounds and cancellations', () => {
    expect(taskNote(task('c', 'completed', 1))).toBe('Accepted after 1 review round');
    expect(taskNote(task('r', 'running', 2))).toBe('Review round 2');
    expect(taskNote({ status: 'cancelled', reviewRounds: 0, cancelledBy: 'user' } as BackgroundTaskListItem)).toBe('Cancelled by you');
    expect(taskNote(task('x', 'running'))).toBeNull();
  });
});
