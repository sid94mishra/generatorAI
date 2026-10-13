// Pure view model for the "Background tasks" Tasks section (F-dock-06):
// buckets, filter, progress segments and the small text helpers. Only data
// the API provides — no wave / worker limit / review-round maximum (D-36).

import type { BackgroundTaskCancelledBy, BackgroundTaskListItem, BackgroundTaskStatus } from '@generatorai/shared';

export type TaskFilter = 'all' | 'active' | 'done';

const ACTIVE: ReadonlySet<BackgroundTaskStatus> = new Set(['spawned', 'running', 'needs_review']);

/** The filter earns its space only on a long list that mixes running and finished tasks. */
export function showTaskFilter(b: TaskBuckets): boolean {
  return b.total > 6 && b.active > 0 && b.done > 0;
}

export function isActiveTask(status: BackgroundTaskStatus): boolean {
  return ACTIVE.has(status);
}

/** D-100: Resume is offered only for a worker a restart interrupted. */
export function canResumeTask(status: BackgroundTaskStatus): boolean {
  return status === 'interrupted';
}

/** Cancel is offered only while a task is starting or running (the board's rule). */
export function canCancelTask(status: BackgroundTaskStatus): boolean {
  return status === 'spawned' || status === 'running';
}

export function filterTasks(tasks: readonly BackgroundTaskListItem[], filter: TaskFilter): BackgroundTaskListItem[] {
  if (filter === 'all') return [...tasks];
  return tasks.filter((t) => isActiveTask(t.status) === (filter === 'active'));
}

export interface TaskBuckets {
  total: number;
  active: number;
  done: number;
  running: number;
  inReview: number;
  completed: number;
  failed: number;
  /** D-100: stopped by a restart, resumable. */
  interrupted: number;
  cancelled: number;
}

export function bucketTasks(tasks: readonly BackgroundTaskListItem[]): TaskBuckets {
  const b: TaskBuckets = { total: tasks.length, active: 0, done: 0, running: 0, inReview: 0, completed: 0, failed: 0, interrupted: 0, cancelled: 0 };
  for (const t of tasks) {
    if (isActiveTask(t.status)) b.active += 1;
    else b.done += 1;
    if (t.status === 'spawned' || t.status === 'running') b.running += 1;
    else if (t.status === 'needs_review') b.inReview += 1;
    else if (t.status === 'completed') b.completed += 1;
    else if (t.status === 'failed') b.failed += 1;
    else if (t.status === 'interrupted') b.interrupted += 1;
    else if (t.status === 'cancelled') b.cancelled += 1;
  }
  return b;
}

export type SegmentTone = 'warn' | 'run' | 'line' | 'ok' | 'err' | 'muted';

export interface ProgressSegment {
  key: string;
  tone: SegmentTone;
  count: number;
  label: string;
}

/**
 * The 4h segmented bar + legend (board: warn / run / line-strong / ok). Tasks
 * waiting on the person come from the attention feed and are taken out of
 * the running count so no task is drawn twice. Empty buckets are dropped.
 */
export function progressSegments(b: TaskBuckets, needsYou: number): ProgressSegment[] {
  const waiting = Math.min(needsYou, b.running);
  const all: ProgressSegment[] = [
    { key: 'needs-you', tone: 'warn', count: waiting, label: 'needs you' },
    { key: 'running', tone: 'run', count: b.running - waiting, label: 'running' },
    { key: 'review', tone: 'line', count: b.inReview, label: 'in review' },
    { key: 'completed', tone: 'ok', count: b.completed, label: 'completed' },
    { key: 'failed', tone: 'err', count: b.failed, label: 'failed' },
    { key: 'interrupted', tone: 'warn', count: b.interrupted, label: 'interrupted' },
    { key: 'cancelled', tone: 'muted', count: b.cancelled, label: 'cancelled' },
  ];
  return all.filter((s) => s.count > 0);
}

/** `m:ss`, or `h:mm:ss` from one hour. Negative input clamps to 0:00. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "by you at 14:09" / "by Orchestrator at 14:09" (G-20), or null when not attributed. */
export function cancelledLine(
  task: { cancelledBy?: BackgroundTaskCancelledBy; cancelledAt?: number },
  formatTime: (epochMs: number) => string = (t) =>
    new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
): string | null {
  if (!task.cancelledBy) return null;
  const who = task.cancelledBy === 'user' ? 'you' : 'Orchestrator';
  return task.cancelledAt ? `by ${who} at ${formatTime(task.cancelledAt)}` : `by ${who}`;
}
