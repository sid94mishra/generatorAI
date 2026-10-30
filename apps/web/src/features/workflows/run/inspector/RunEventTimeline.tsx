// ────────────────────────────────────────────────────────────────
// RunEventTimeline — the run's event timeline: run created/started, each
// stage (or loop) started and finished, the run's outcome, oldest first,
// with times, durations and errors. A stage entry focuses its stage.
// Reads the run from stores/workflowRunStore.
// ────────────────────────────────────────────────────────────────

import { memo, useMemo } from 'react';
import {
  resolveStatus,
  STATUS_STATE_DEFS,
  type StageRun,
  type StageRunStatus,
  type StatusState,
  type WorkflowRunWithStages,
} from '@generatorai/shared';
import type { IconConcept } from '@generatorai/design-tokens';
import { useWorkflowRunStore } from '@/stores/workflowRunStore.js';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { STATUS_TONE_TEXT } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { iterationSuffix } from '../model/loopView.js';

interface TimelineEntry {
  id: string;
  timestamp: Date;
  type: 'run' | 'stage';
  state: StatusState;
  label: string;
  detail?: string;
  duration?: number | null;
  stageRunId?: string;
}

/** A timeline duration: 850ms, 42s, 3m 7s, 1h 5m. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function stageDuration(sr: StageRun): number | null {
  if (!sr.startedAt) return null;
  const start = new Date(sr.startedAt).getTime();
  const end = sr.completedAt ? new Date(sr.completedAt).getTime() : Date.now();
  return end - start;
}

const runState = (status: WorkflowRunWithStages['status']): StatusState => resolveStatus('workflowRun', status)?.state ?? 'queued';
const stageState = (status: StageRunStatus): StatusState => resolveStatus('stageRun', status)?.state ?? 'queued';

function buildTimeline(run: WorkflowRunWithStages): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    { id: 'run-created', timestamp: new Date(run.createdAt), type: 'run', state: 'queued', label: 'Workflow run created' },
  ];
  if (run.startedAt) {
    entries.push({ id: 'run-started', timestamp: new Date(run.startedAt), type: 'run', state: 'running', label: 'Workflow run started' });
  }

  // Stage events (a loop body instance names its iteration).
  for (const sr of run.stageRuns) {
    const name = `${sr.name}${iterationSuffix(sr)}`;
    const noun = sr.kind === 'loop' ? 'Loop' : 'Stage';
    const exit = sr.kind === 'loop' && sr.loopState?.exitReason ? ` (${sr.loopState.exitReason})` : '';
    if (sr.startedAt) {
      entries.push({
        id: `stage-started-${sr.id}`,
        timestamp: new Date(sr.startedAt),
        type: 'stage',
        state: 'running',
        label: `${noun} "${name}" started`,
        stageRunId: sr.id,
      });
    }
    if (sr.completedAt && sr.status !== 'pending') {
      entries.push({
        id: `stage-${sr.status}-${sr.id}`,
        timestamp: new Date(sr.completedAt),
        type: 'stage',
        state: stageState(sr.status),
        label: `${noun} "${name}" ${sr.status}${exit}`,
        ...(sr.error ? { detail: sr.error } : {}),
        duration: stageDuration(sr),
        stageRunId: sr.id,
      });
    }
  }

  if (run.completedAt) {
    entries.push({
      id: 'run-completed',
      timestamp: new Date(run.completedAt),
      type: 'run',
      state: runState(run.status),
      label: `Workflow run ${run.status}`,
    });
  }

  entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return entries;
}

const TimelineItem = memo(function TimelineItem({
  entry,
  isLast,
  onStageClick,
}: {
  entry: TimelineEntry;
  isLast: boolean;
  onStageClick: (stageRunId: string) => void;
}) {
  const def = STATUS_STATE_DEFS[entry.state];
  const stageRunId = entry.type === 'stage' ? entry.stageRunId : undefined;
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-raised">
          {/* A past "started" is not a live spinner: it gets the static play glyph. */}
          <Icon
            concept={entry.state === 'running' ? 'play' : (def.glyph as IconConcept)}
            size={14}
            className={STATUS_TONE_TEXT[def.tone]}
          />
        </span>
        {!isLast ? <span aria-hidden className="w-px flex-1 bg-line-soft" /> : null}
      </div>
      <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-4')}>
        <div className="flex min-w-0 items-center gap-2">
          {stageRunId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onStageClick(stageRunId)}
              className="-ml-2 min-w-0 text-ui text-fg"
            >
              {entry.label}
            </Button>
          ) : (
            <span className="min-w-0 truncate text-ui font-medium text-fg">{entry.label}</span>
          )}
          {entry.duration != null ? (
            <span className="shrink-0 font-mono text-micro text-fg-3">({formatDuration(entry.duration)})</span>
          ) : null}
        </div>
        <div className="mt-0.5 font-mono text-micro text-fg-3">{formatTime(entry.timestamp)}</div>
        {entry.detail ? (
          <div className="mt-1 rounded-control bg-err-bg px-2 py-1 text-small break-words text-err">{entry.detail}</div>
        ) : null}
      </div>
    </li>
  );
});

function RunEventTimelineComponent({ className }: { className?: string }) {
  const run = useWorkflowRunStore((s) => s.run);
  const selectStageRun = useWorkflowRunStore((s) => s.selectStageRun);
  const timeline = useMemo(() => (run ? buildTimeline(run) : []), [run]);

  if (!run) return null;
  if (timeline.length === 0) {
    return <div className={cn('flex items-center justify-center py-8 text-ui text-fg-3', className)}>No events yet</div>;
  }
  return (
    <div className={cn('overflow-y-auto px-4 py-3', className)}>
      <SectionHeader variant="title" level={3} title="Timeline" className="mb-3" />
      <ol aria-label="Run timeline">
        {timeline.map((entry, i) => (
          <TimelineItem key={entry.id} entry={entry} isLast={i === timeline.length - 1} onStageClick={selectStageRun} />
        ))}
      </ol>
    </div>
  );
}

/** The run's event timeline. */
export const RunEventTimeline = memo(RunEventTimelineComponent);
