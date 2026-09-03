// ────────────────────────────────────────────────────────────────
// StepRow — one line in the activity timeline.
// Muted by design; the answer prose is the eye-catcher, not this.
//
// Shared by the workflow-run stage timeline (StageTimelineItem) and
// the chat assistant turns (via StreamPanel).
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import {
  BookOpen, Search, FileEdit, Play, Wrench, Brain, Bot,
  Database, StickyNote, AlertCircle, CheckCircle2, Loader2, ChevronRight, Circle, PauseCircle,
  FileDiff, SquareTerminal,
} from 'lucide-react';
import { useStreamActions } from '@/components/agent/streamActions.js';
import { cn } from '@/lib/utils.js';
import type { StepKind, StepStatus, TimelineStep } from '@/components/chat/redesign/types.js';

const KIND_ICON: Record<StepKind, React.ComponentType<{ className?: string }>> = {
  read: BookOpen,
  search: Search,
  edit: FileEdit,
  run: Play,
  tool: Wrench,
  think: Brain,
  subagent: Bot,
  memory: Database,
  note: StickyNote,
  error: AlertCircle,
};

function StatusDot({ status }: { status: StepStatus }) {
  if (status === 'running') {
    return <Loader2 className="h-3 w-3 animate-spin text-[var(--color-primary)]" />;
  }
  if (status === 'waiting') {
    return <PauseCircle className="h-3 w-3 text-[var(--color-primary)]" />;
  }
  if (status === 'done') {
    return <CheckCircle2 className="h-3 w-3 text-[var(--color-success)]" />;
  }
  if (status === 'failed') {
    return <AlertCircle className="h-3 w-3 text-[var(--color-danger)]" />;
  }
  return <Circle className="h-3 w-3 text-[var(--color-muted-foreground)]/40" />;
}

function formatDuration(ms?: number): string | null {
  if (!ms || ms < 50) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

interface StepRowProps {
  step: TimelineStep;
  /** If true, the row belongs to a nested subagent block (indent + smaller). */
  nested?: boolean;
}

export const StepRow = React.memo(function StepRow({ step, nested }: StepRowProps) {
  const [expanded, setExpanded] = useState(false);
  const actions = useStreamActions();
  const Icon = KIND_ICON[step.kind];
  const isRunning = step.status === 'running';
  const isWaiting = step.status === 'waiting';
  const isPending = step.status === 'pending';
  const hasExpandable =
    (step.children && step.children.length > 0) ||
    !!step.detail;

  // `detail` may be a thunk (see deriveTimeline) so multi-MB tool args/results
  // are only serialised when the user actually opens the row.
  const detailText = useMemo(() => {
    if (!expanded || !step.detail) return null;
    return typeof step.detail === 'function' ? step.detail() : step.detail;
  }, [expanded, step.detail]);

  return (
    <div className={cn('group', nested && 'ml-6')}>
      <button
        onClick={() => hasExpandable && setExpanded((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors',
          hasExpandable && 'cursor-pointer hover:bg-[var(--color-subtle)]/60',
          !hasExpandable && 'cursor-default',
        )}
        aria-expanded={hasExpandable ? expanded : undefined}
        aria-busy={isRunning}
      >
        {/* status dot — solid background occludes the timeline connector line */}
        <span
          className={cn(
            'relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
            'bg-[var(--color-background)]',
          )}
        >
          <StatusDot status={step.status} />
        </span>

        {/* kind icon */}
        <Icon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            step.status === 'failed'
              ? 'text-[var(--color-danger)]'
              : 'text-[var(--color-muted-foreground)]',
          )}
        />

        {/* verb + target */}
        <span className="min-w-0 flex-1 truncate text-[12px] leading-5 text-[var(--color-muted-foreground)]">
          <span className="font-medium text-[var(--color-foreground)]/85">{step.verb}</span>{' '}
          {step.mono ? (
            <span className="font-mono text-[11.5px] text-[var(--color-foreground)]/70">{step.target}</span>
          ) : (
            <span className="text-[var(--color-foreground)]/70">{step.target}</span>
          )}
        </span>

        {/* right meta */}
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--color-muted-foreground)]/70">
          {isWaiting && <span className="text-[var(--color-primary)]">Waiting for you</span>}
          {step.fileOp ? (
            <span className="font-mono text-[10.5px]">
              <span className="text-[var(--color-success)]">+{step.fileOp.additions}</span>{' '}
              <span className="text-[var(--color-danger)]">−{step.fileOp.deletions}</span>
            </span>
          ) : (
            step.meta && <span>{step.meta}</span>
          )}
          {step.durationMs != null && <span>{formatDuration(step.durationMs)}</span>}
          {/* Click-throughs — a <span role=button>, not a <button>: this row
              is already inside a <button>, and nested buttons are invalid
              HTML that browsers may silently re-parent. */}
          {step.fileOp && actions.onOpenChanges && (
            <span
              role="button"
              tabIndex={0}
              title="Show in changes view"
              aria-label={`Show ${step.fileOp.filePath} in changes view`}
              className="rounded p-0.5 text-[var(--color-muted-foreground)]/60 hover:bg-[var(--color-subtle)] hover:text-[var(--color-primary)]"
              onClick={(e) => {
                e.stopPropagation();
                actions.onOpenChanges?.(step.fileOp?.filePath);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  actions.onOpenChanges?.(step.fileOp?.filePath);
                }
              }}
            >
              <FileDiff className="h-3 w-3" />
            </span>
          )}
          {step.isShell && step.callId && actions.onOpenShell && (
            <span
              role="button"
              tabIndex={0}
              title="Open in terminal view"
              aria-label="Open this command in the terminal view"
              className="rounded p-0.5 text-[var(--color-muted-foreground)]/60 hover:bg-[var(--color-subtle)] hover:text-[var(--color-primary)]"
              onClick={(e) => {
                e.stopPropagation();
                if (step.callId) actions.onOpenShell?.(step.callId);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (step.callId) actions.onOpenShell?.(step.callId);
                }
              }}
            >
              <SquareTerminal className="h-3 w-3" />
            </span>
          )}
          {hasExpandable && (
            <ChevronRight
              className={cn(
                'h-3 w-3 text-[var(--color-muted-foreground)]/40 transition-transform',
                expanded && 'rotate-90',
              )}
            />
          )}
        </span>
      </button>

      {/* running shimmer — only when this row is the tail of an active step */}
      {isRunning && !expanded && (
        <div className="mt-0.5 ml-8 space-y-1">
          <div className="skeleton-shimmer h-2 w-[62%] rounded" />
          <div className="skeleton-shimmer h-2 w-[38%] rounded" />
        </div>
      )}

      {/* pending placeholder — only for rows with nothing else to show, so a
          settled-but-unresolved tool call doesn't gain a phantom bar. */}
      {isPending && !hasExpandable && (
        <div className="mt-0.5 ml-8">
          <div className="h-2 w-[24%] rounded bg-[var(--color-muted-foreground)]/10" />
        </div>
      )}

      {/* expanded content */}
      {expanded && (
        <div className="mt-1 ml-8 space-y-1 border-l border-[var(--color-border)]/50 pl-3">
          {detailText && (
            <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-[var(--color-muted-foreground)]/85">
              {detailText}
            </p>
          )}
          {step.children?.map((child) => (
            <StepRow key={child.id} step={child} nested />
          ))}
        </div>
      )}
    </div>
  );
});
