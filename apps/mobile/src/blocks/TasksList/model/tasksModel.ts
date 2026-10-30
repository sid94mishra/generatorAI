// MB-30 TasksList model (MPaneTasks, MPaneTaskDetail; MD-25), pure: a worker's status words through the shared
// status map (Starting, Running, In review, Done, Failed, Cancelled), the All / Active / Done filter, the summary
// card's segments and legend, and the row's note. The wave and the worker limit are not shown (MG-36).
import { STATUS_MAPS, type StatusMapping, type StatusState } from '@generatorai/shared';
import type { BackgroundTaskListItem } from '@generatorai/shared';

export type TaskFilter = 'all' | 'active' | 'done';

const ACTIVE: ReadonlySet<string> = new Set(['spawned', 'running', 'reviewing', 'queued', 'needs_review']);

export function isActiveTask(task: Pick<BackgroundTaskListItem, 'status'>): boolean {
  return ACTIVE.has(task.status);
}

export function taskStatus(status: string): StatusMapping {
  return (STATUS_MAPS.backgroundTask as Record<string, StatusMapping | null>)[status] ?? { state: 'queued' as StatusState, label: status };
}

export function filterTasks<T extends Pick<BackgroundTaskListItem, 'status'>>(tasks: readonly T[], filter: TaskFilter): T[] {
  if (filter === 'all') return [...tasks];
  return tasks.filter((t) => (filter === 'active' ? isActiveTask(t) : !isActiveTask(t)));
}

export interface TaskSummary {
  total: number;
  active: number;
  done: number;
  /** One segment per worker, in list order (the summary bar). */
  segments: Array<{ state: StatusState; label: string }>;
  /** "1 running · 1 in review · 1 completed · 1 starting" — counts per status word, in first-seen order. */
  legend: Array<{ state: StatusState; label: string; count: number }>;
}

export function taskSummary(tasks: readonly Pick<BackgroundTaskListItem, 'status' | 'taskName'>[]): TaskSummary {
  const legend = new Map<string, { state: StatusState; label: string; count: number }>();
  const segments = tasks.map((t) => {
    const s = taskStatus(t.status);
    const label = s.label ?? STATE_WORD[s.state] ?? s.state;
    const entry = legend.get(label);
    if (entry) entry.count += 1;
    else legend.set(label, { state: s.state, label, count: 1 });
    return { state: s.state, label: `${t.taskName}: ${label}` };
  });
  const active = tasks.filter(isActiveTask).length;
  return { total: tasks.length, active, done: tasks.length - active, segments, legend: [...legend.values()] };
}

const STATE_WORD: Partial<Record<StatusState, string>> = { running: 'Running', succeeded: 'Done', failed: 'Failed', waiting: 'In review', queued: 'Starting', skipped: 'Cancelled' };

/** The row's second line: review rounds, or how it was cancelled. */
export function taskNote(task: Pick<BackgroundTaskListItem, 'status' | 'reviewRounds' | 'cancelledBy'>): string | null {
  if (task.status === 'cancelled') return task.cancelledBy ? `Cancelled by ${task.cancelledBy === 'user' ? 'you' : task.cancelledBy}` : 'Cancelled';
  if (task.reviewRounds > 0) {
    const rounds = `${task.reviewRounds} review ${task.reviewRounds === 1 ? 'round' : 'rounds'}`;
    return task.status === 'completed' ? `Accepted after ${rounds}` : `Review round ${task.reviewRounds}`;
  }
  return null;
}
