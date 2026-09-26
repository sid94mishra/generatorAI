// ────────────────────────────────────────────────────────────────
// RunHeaderBar — 54px sticky bar. Status pill, name, progress, controls.
// Single source of truth for run-level state (replaced the V1 header,
// activity bar and status strip).
//
// It owns the run's ONE ticking clock (D-24): nothing else on the run page
// re-renders every second. The permission-mode control is the run row's
// layer (W-65); stages read it from their next turn.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import {
  Pause, Play, Square, RefreshCw, Hand, Zap, CheckCircle2, AlertTriangle, Clock,
  Network, ChevronDown, GitBranch, FolderOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button, Select, Spinner } from '@/components/ui/index.js';
import type { WorkflowRunPermissionMode } from '@generatorai/shared';
import type { RunView } from './types.js';
import { runTitle } from '@generatorai/client-core';

/** The chat's permission-mode wording (SessionSpecEditor), for the run row's layer. */
const PERMISSION_OPTIONS: Array<{ value: WorkflowRunPermissionMode; label: string }> = [
  { value: 'default', label: 'Ask before tools run' },
  { value: 'acceptEdits', label: 'Accept edits, ask for the rest' },
  { value: 'plan', label: 'Plan only (no changes)' },
  { value: 'bypassPermissions', label: 'Full access (never ask)' },
];

interface RunHeaderBarProps {
  run: Pick<RunView, 'name' | 'status' | 'startedAt' | 'completedAt' | 'permissionMode' | 'stages'>;
  awaitingCount: number;
  parallelCount: number;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onOpenGraph?: () => void;
  /** Whether the inline DAG graph panel is currently open (drives the button pressed state). */
  graphOpen?: boolean;
  /** Whether the horizontal pipeline flow is visible. */
  pipelineOpen?: boolean;
  onTogglePipeline?: () => void;
  /** Toggle the run-scoped Files & artifacts side pane (git-style diff + tree). */
  onOpenFiles?: () => void;
  filesOpen?: boolean;
  /** Change the run's permission mode (omit to show it read-only). */
  onPermissionModeChange?: (mode: WorkflowRunPermissionMode) => void;
  /** A permission-mode change is in flight. */
  permissionBusy?: boolean;
}

/** Elapsed run time, ticking once a second while the run is live — in this component only. */
function useElapsed(startedAt: number, completedAt: number | undefined, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return Math.max(0, (completedAt ?? (live ? now : Date.now())) - startedAt);
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, '0')}m`;
}

function StatusPill({ status }: { status: RunView['status'] }) {
  const map: Record<RunView['status'], { icon: React.ReactNode; label: string; tone: string }> = {
    pending:    { icon: <Clock className="h-3.5 w-3.5" />, label: 'Pending',    tone: 'muted' },
    starting:   { icon: <Spinner size="sm" />, label: 'Starting', tone: 'primary' },
    running:    { icon: <Spinner size="sm" />, label: 'Running',  tone: 'primary' },
    waiting:    { icon: <Clock className="h-3.5 w-3.5" />, label: 'Waiting', tone: 'warning' },
    finalizing: { icon: <Spinner size="sm" />, label: 'Finalizing', tone: 'primary' },
    paused:     { icon: <Pause className="h-3.5 w-3.5" />, label: 'Paused',    tone: 'warning' },
    cancelling: { icon: <Spinner size="sm" />, label: 'Cancelling', tone: 'warning' },
    cancelled:  { icon: <Square className="h-3.5 w-3.5" />, label: 'Cancelled', tone: 'muted' },
    completed:  { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: 'Completed', tone: 'success' },
    failed:     { icon: <AlertTriangle className="h-3.5 w-3.5" />, label: 'Failed',    tone: 'danger' },
  };
  const s = map[status];
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
      s.tone === 'primary' && 'bg-[var(--color-primary)]/12 text-[var(--color-primary)]',
      s.tone === 'success' && 'bg-[var(--color-success)]/12 text-[var(--color-success)]',
      s.tone === 'warning' && 'bg-[var(--color-warning)]/12 text-[var(--color-warning)]',
      s.tone === 'danger'  && 'bg-[var(--color-danger)]/12 text-[var(--color-danger)]',
      s.tone === 'muted'   && 'bg-[var(--color-muted-foreground)]/12 text-[var(--color-muted-foreground)]',
    )}>
      {s.icon}
      {s.label}
    </span>
  );
}

export const RunHeaderBar = React.memo(function RunHeaderBar({
  run, awaitingCount, parallelCount, onPause, onResume, onCancel, onRetry, onOpenGraph, graphOpen,
  pipelineOpen, onTogglePipeline, onOpenFiles, filesOpen, onPermissionModeChange, permissionBusy,
}: RunHeaderBarProps) {
  const total = run.stages.length;
  const done = run.stages.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  const failed = run.stages.filter((s) => s.status === 'failed').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const isRunning = run.status === 'running' || run.status === 'starting' || run.status === 'waiting';
  const isPaused = run.status === 'paused';
  const isTerminal = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
  const elapsedMs = useElapsed(run.startedAt, run.completedAt, !isTerminal && run.status !== 'pending');

  return (
    <header className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2.5">
      {/* Status + name */}
      <StatusPill status={run.status} />
      <h1 className="min-w-0 truncate text-sm font-semibold text-[var(--color-foreground)]">
        {runTitle(run.name)}
      </h1>

      {/* Progress cluster */}
      <div className="hidden items-center gap-2 md:flex">
        <span className="text-[11.5px] text-[var(--color-muted-foreground)]">
          <span className="font-semibold text-[var(--color-foreground)]/90">{done}</span>
          /{total}
          {failed > 0 && <span className="ml-1 text-[var(--color-danger)]">· {failed} failed</span>}
        </span>
        <span className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--color-border)]/60">
          <span
            className="block h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="font-mono text-[11px] tabular-nums text-[var(--color-muted-foreground)]">
          {formatDuration(elapsedMs)}
        </span>
      </div>

      {/* Live badges */}
      {parallelCount > 0 && (
        <span className="hidden items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10.5px] font-medium text-cyan-400 md:inline-flex">
          <Zap className="h-2.5 w-2.5" />
          {parallelCount} parallel
        </span>
      )}
      {awaitingCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning)]/12 px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-warning)]">
          <Hand className="h-2.5 w-2.5 animate-status-breathe" />
          {awaitingCount} awaiting
        </span>
      )}

      {/* Controls */}
      <div className="ml-auto flex items-center gap-1.5">
        {/* Permission mode — the run row's layer (W-65); stages read it on their next turn. */}
        <div className="hidden w-[210px] md:block" title="Tool approvals for this run's stages (from their next turn)">
          <Select
            aria-label="Run permission mode"
            value={run.permissionMode}
            disabled={isTerminal || !onPermissionModeChange || permissionBusy}
            onChange={(v) => onPermissionModeChange?.(v as WorkflowRunPermissionMode)}
            options={PERMISSION_OPTIONS}
          />
        </div>
        {isRunning && (
          <Button
            onClick={onPause}
            variant="ghost"
            size="sm"
            className="h-auto flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--color-foreground)] hover:bg-[var(--color-subtle)]"
          >
            <Pause className="h-3.5 w-3.5" />
            Pause
          </Button>
        )}
        {isPaused && (
          <Button
            onClick={onResume}
            variant="ghost"
            size="sm"
            className="h-auto flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2.5 py-1 text-[11.5px] font-medium text-white hover:brightness-110"
          >
            <Play className="h-3.5 w-3.5" />
            Resume
          </Button>
        )}
        {(isRunning || isPaused) && (
          <Button
            onClick={onCancel}
            variant="ghost"
            size="sm"
            className="h-auto flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--color-foreground)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"
          >
            <Square className="h-3.5 w-3.5" />
            Cancel
          </Button>
        )}
        {isTerminal && run.status !== 'completed' && (
          <Button
            onClick={onRetry}
            title="Re-run every stage that did not complete in a new run"
            variant="ghost"
            size="sm"
            className="h-auto flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2.5 py-1 text-[11.5px] font-medium text-white hover:brightness-110"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry failed
          </Button>
        )}
        <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
        <Button
          onClick={onTogglePipeline}
          aria-pressed={pipelineOpen}
          title={pipelineOpen ? 'Hide pipeline' : 'Show pipeline'}
          variant="ghost"
          size="sm"
          className={cn(
            'h-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors',
            pipelineOpen
              ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10'
              : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]',
          )}
        >
          <GitBranch className="h-3.5 w-3.5" />
          Pipeline
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', pipelineOpen && 'rotate-180')} />
        </Button>
        <Button
          onClick={onOpenGraph}
          aria-pressed={graphOpen}
          title={graphOpen ? 'Hide graph' : 'Show graph'}
          variant="ghost"
          size="sm"
          className={cn(
            'h-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors',
            graphOpen
              ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10'
              : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]',
          )}
        >
          <Network className="h-3.5 w-3.5" />
          Graph
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', graphOpen && 'rotate-180')} />
        </Button>
        {onOpenFiles && (
          <Button
            onClick={onOpenFiles}
            aria-pressed={filesOpen}
            title={filesOpen ? 'Hide files' : 'Show files & artifacts'}
            variant="ghost"
            size="sm"
            className={cn(
              'h-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors',
              filesOpen
                ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10'
                : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]',
            )}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Files
          </Button>
        )}
      </div>
    </header>
  );
});
