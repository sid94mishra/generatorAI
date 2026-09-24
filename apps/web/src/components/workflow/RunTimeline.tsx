// ────────────────────────────────────────────────────────────────
// RunTimeline — Vertical timeline showing run and stage events
// with timestamps, durations, color-coded entries, and expandable details
// ────────────────────────────────────────────────────────────────

import React, { memo, useMemo } from 'react';
import {
  Play,
  Pause,
  Check,
  X,
  Clock,
  AlertCircle,
  SkipForward,
  CircleDot,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Spinner } from '@/components/ui/index.js';
import { useWorkflowRunStore } from '@/stores/workflowRunStore.js';
import type { StageRun } from '@generatorai/shared';

// ── Status icon mapping ──

const statusIcons: Record<string, React.ReactNode> = {
  created: <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />,
  starting: <Spinner size="sm" className="text-primary" />,
  running: <Play className="h-3.5 w-3.5 text-primary" />,
  paused: <Pause className="h-3.5 w-3.5 text-warning" />,
  cancelling: <Spinner size="sm" className="text-danger" />,
  completed: <Check className="h-3.5 w-3.5 text-success" />,
  failed: <AlertCircle className="h-3.5 w-3.5 text-danger" />,
  cancelled: <X className="h-3.5 w-3.5 text-muted-foreground" />,
  pending: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
  queued: <Clock className="h-3.5 w-3.5 text-info" />,
  skipped: <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />,
};

const statusColors: Record<string, string> = {
  created: 'border-border bg-subtle',
  starting: 'border-primary/40 bg-info-muted',
  running: 'border-primary/50 bg-info-muted',
  paused: 'border-warning/50 bg-warning-muted',
  cancelling: 'border-danger/40 bg-danger-muted',
  completed: 'border-success/50 bg-success-muted',
  failed: 'border-danger/50 bg-danger-muted',
  cancelled: 'border-border bg-subtle',
  pending: 'border-border bg-subtle',
  queued: 'border-info/30 bg-info-muted',
  skipped: 'border-border bg-subtle',
};

// ── Helpers ──

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function computeStageDuration(sr: StageRun): number | null {
  if (!sr.startedAt) return null;
  const start = new Date(sr.startedAt).getTime();
  const end = sr.completedAt ? new Date(sr.completedAt).getTime() : Date.now();
  return end - start;
}

// ── Stage timeline derived from stage runs ──

interface TimelineEntry {
  id: string;
  timestamp: Date;
  type: 'run' | 'stage';
  status: string;
  label: string;
  detail?: string;
  duration?: number | null;
  stageRunId?: string;
}

function buildTimeline(run: { status: string; createdAt: Date; startedAt?: Date; completedAt?: Date; stageRuns: StageRun[] }): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  // Run creation
  entries.push({
    id: 'run-created',
    timestamp: new Date(run.createdAt),
    type: 'run',
    status: 'created',
    label: 'Workflow run created',
  });

  if (run.startedAt) {
    entries.push({
      id: 'run-started',
      timestamp: new Date(run.startedAt),
      type: 'run',
      status: 'running',
      label: 'Workflow run started',
    });
  }

  // Stage events
  for (const sr of run.stageRuns) {
    if (sr.startedAt) {
      entries.push({
        id: `stage-started-${sr.id}`,
        timestamp: new Date(sr.startedAt),
        type: 'stage',
        status: 'running',
        label: `Stage "${sr.name}" started`,
        stageRunId: sr.id,
      });
    }

    if (sr.completedAt && sr.status !== 'pending') {
      const duration = computeStageDuration(sr);
      entries.push({
        id: `stage-${sr.status}-${sr.id}`,
        timestamp: new Date(sr.completedAt),
        type: 'stage',
        status: sr.status,
        label: `Stage "${sr.name}" ${sr.status}`,
        detail: sr.error ?? undefined,
        duration,
        stageRunId: sr.id,
      });
    }
  }

  // Run completion
  if (run.completedAt) {
    entries.push({
      id: 'run-completed',
      timestamp: new Date(run.completedAt),
      type: 'run',
      status: run.status,
      label: `Workflow run ${run.status}`,
    });
  }

  // Sort by timestamp
  entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return entries;
}

// ── Components ──

interface TimelineItemProps {
  entry: TimelineEntry;
  isLast: boolean;
  onStageClick?: (stageRunId: string) => void;
}

const TimelineItem = memo(function TimelineItem({ entry, isLast, onStageClick }: TimelineItemProps) {
  const icon = statusIcons[entry.status] ?? statusIcons.created;
  const colorClass = statusColors[entry.status] ?? statusColors.created;

  return (
    <div className="flex gap-3">
      {/* Timeline line + dot */}
      <div className="relative flex flex-col items-center">
        <div
          className={cn(
            'z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2',
            colorClass,
          )}
        >
          {icon}
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-border" />
        )}
      </div>

      {/* Content */}
      <div className={cn('pb-4', isLast && 'pb-0')}>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-sm font-medium text-foreground',
              entry.type === 'stage' && entry.stageRunId && 'cursor-pointer hover:text-primary',
            )}
            onClick={() => entry.stageRunId && onStageClick?.(entry.stageRunId)}
          >
            {entry.label}
          </span>
          {entry.duration != null && (
            <span className="text-xs text-muted-foreground">
              ({formatDuration(entry.duration)})
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {formatTime(entry.timestamp)}
        </div>
        {entry.detail && (
          <div className="mt-1 rounded bg-danger-muted px-2 py-1 text-xs text-danger">
            {entry.detail}
          </div>
        )}
      </div>
    </div>
  );
});

// ── Main Component ──

interface RunTimelineProps {
  className?: string;
}

function RunTimelineComponent({ className }: RunTimelineProps) {
  const run = useWorkflowRunStore((s) => s.run);
  const selectStageRun = useWorkflowRunStore((s) => s.selectStageRun);

  const timeline = useMemo(() => {
    if (!run) return [];
    return buildTimeline(run);
  }, [run]);

  if (!run) return null;

  if (timeline.length === 0) {
    return (
      <div className={cn('flex items-center justify-center py-8 text-sm text-muted-foreground', className)}>
        No events yet
      </div>
    );
  }

  return (
    <div className={cn('overflow-y-auto px-4 py-3', className)}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Timeline
      </h3>
      <div className="space-y-0">
        {timeline.map((entry, i) => (
          <TimelineItem
            key={entry.id}
            entry={entry}
            isLast={i === timeline.length - 1}
            onStageClick={selectStageRun}
          />
        ))}
      </div>
    </div>
  );
}

export const RunTimeline = memo(RunTimelineComponent);

/** Export formatDuration for reuse */
export { formatDuration };
