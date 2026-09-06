// ────────────────────────────────────────────────────────────────
// StepRow — one line in the activity timeline.
// Muted by design; the answer prose is the eye-catcher, not this.
//
// Shared by the workflow-run stage timeline (StageTimelineItem) and
// the chat assistant turns (via StreamPanel).
//
// StepGroupRow — one line standing in for a run of related tool calls
// ("Read 5 files"). Expands to the plain rows beneath it. See groupSteps.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import {
  BookOpen, Search, FileEdit, Play, Wrench, Brain, Bot,
  Database, StickyNote, AlertCircle, CheckCircle2, ChevronRight, Circle, PauseCircle,
  FileDiff, SquareTerminal, TriangleAlert, XCircle, Image as ImageIcon, Layers,
} from 'lucide-react';
import { useStreamActions, browserArtifactUrl } from '@/components/agent/streamActions.js';
import { Button, Spinner } from '@/components/ui/index.js';
import { InlineDiff } from '@/components/chat/InlineDiff.js';
import { ImageHoverPreview } from '@/components/shared/ImageHoverPreview.js';
import { cn } from '@/lib/utils.js';
import type { StepKind, StepStatus, TimelineStep } from '@/components/chat/redesign/types.js';
import type { StepGroup } from '@/components/agent/groupSteps.js';

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
  warning: TriangleAlert,
  error: AlertCircle,
};

function StatusDot({ status, kind }: { status: StepStatus; kind: StepKind }) {
  if (kind === 'warning') {
    return <TriangleAlert className="h-3 w-3 text-[var(--color-warning)]" />;
  }
  if (status === 'running') {
    return <Spinner size="xs" className="text-[var(--color-primary)]" />;
  }
  if (status === 'waiting') {
    return <PauseCircle className="h-3 w-3 text-[var(--color-primary)]" />;
  }
  if (status === 'done') {
    return <CheckCircle2 className="h-3 w-3 text-[var(--color-success)]" data-testid="step-status-done" />;
  }
  if (status === 'failed') {
    // A red cross, not a warning triangle: the call did not do what it said.
    return <XCircle className="h-3 w-3 text-[var(--color-danger)]" data-testid="step-status-failed" />;
  }
  return <Circle className="h-3 w-3 text-[var(--color-muted-foreground)]/40" />;
}

function formatDuration(ms?: number): string | null {
  if (!ms || ms < 50) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

/**
 * The shared shell of a timeline row: status dot over the connector line,
 * kind icon, a flexible label area and right-aligned meta. Both the plain
 * step and the group row render through it so they line up pixel for pixel.
 */
function RowShell({
  status, kind, expandable, expanded, onToggle, nested, running, children, meta, testId,
}: {
  status: StepStatus;
  kind: StepKind;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
  nested?: boolean;
  running: boolean;
  children: React.ReactNode;
  meta: React.ReactNode;
  testId: string;
}) {
  const Icon = KIND_ICON[kind];
  const isWarning = kind === 'warning';
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => expandable && onToggle()}
      data-testid={testId}
      className={cn(
        'h-auto w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors',
        expandable && 'cursor-pointer hover:bg-[var(--color-subtle)]/60',
        !expandable && 'cursor-default',
        nested && 'py-0.5',
      )}
      aria-expanded={expandable ? expanded : undefined}
      aria-busy={running}
    >
      {/* status dot — solid background occludes the timeline connector line */}
      <span
        className={cn(
          'relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
          'bg-[var(--color-background)]',
        )}
      >
        <StatusDot status={status} kind={kind} />
      </span>

      {/* kind icon */}
      <Icon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          status === 'failed'
            ? 'text-[var(--color-danger)]'
            : isWarning
              ? 'text-[var(--color-warning)]'
              : 'text-[var(--color-muted-foreground)]',
        )}
      />

      {children}

      {/* right meta */}
      <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--color-muted-foreground)]/70">
        {meta}
        {expandable && (
          <ChevronRight
            className={cn(
              'h-3 w-3 text-[var(--color-muted-foreground)]/40 transition-transform duration-200',
              expanded && 'rotate-90',
            )}
          />
        )}
      </span>
    </Button>
  );
}

/** Icon-button inside a row. A <span role=button>, not a <button>: the row
 *  is already a <button>, and nested buttons are invalid HTML that browsers
 *  may silently re-parent. */
function RowAction({
  title, onActivate, children, className, testId,
}: {
  title: string;
  onActivate: () => void;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      aria-label={title}
      data-testid={testId}
      className={cn(
        'rounded p-0.5 text-[var(--color-muted-foreground)]/60 hover:bg-[var(--color-subtle)] hover:text-[var(--color-primary)]',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onActivate();
        }
      }}
    >
      {children}
    </span>
  );
}

/**
 * Capped, scrollable container for whatever a row reveals on expand. A
 * multi-thousand-line tool result used to push the whole transcript down by
 * its full height; now the row grows to at most this panel and the user
 * scrolls inside it.
 */
export function DetailPanel({ children, className, testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div
      data-testid={testId ?? 'step-detail-panel'}
      className={cn(
        'step-detail-panel mt-1 ml-8 max-h-[260px] overflow-auto rounded-md border border-[var(--color-border)]/70',
        'bg-[var(--color-subtle)]/35 px-3 py-2 text-[11.5px] leading-relaxed',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface StepRowProps {
  step: TimelineStep;
  /** If true, the row belongs to a nested subagent block / group (indent + smaller). */
  nested?: boolean;
}

export const StepRow = React.memo(function StepRow({ step, nested }: StepRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const actions = useStreamActions();
  const isRunning = step.status === 'running';
  const isWaiting = step.status === 'waiting';
  const isPending = step.status === 'pending';
  const isWarning = step.kind === 'warning';
  const hasExpandable =
    (step.children && step.children.length > 0) ||
    !!step.detail ||
    !!step.diff;

  // `detail` may be a thunk (see deriveTimeline) so multi-MB tool args/results
  // are only serialised when the user actually opens the row.
  const diff = useMemo(() => (expanded && step.diff ? step.diff() : null), [expanded, step.diff]);
  // A file op shows its diff first; the raw tool I/O stays one click away.
  const wantDetail = expanded && !!step.detail && (!diff || showRaw);
  const detailText = useMemo(() => {
    if (!wantDetail || !step.detail) return null;
    return typeof step.detail === 'function' ? step.detail() : step.detail;
  }, [wantDetail, step.detail]);

  const imageUrl = step.image && actions.workspaceId
    ? browserArtifactUrl(actions.workspaceId, step.image.relativePath)
    : null;

  return (
    <div className={cn('group animate-step-in', nested && 'ml-6')}>
      <RowShell
        status={step.status}
        kind={step.kind}
        expandable={!!hasExpandable}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        nested={nested}
        running={isRunning}
        testId="step-row"
        meta={
          <>
            {isWaiting && <span className="text-[var(--color-primary)]">Waiting for you</span>}
            {step.status === 'failed' && !isWarning && step.kind !== 'error' && (
              <span className="font-medium text-[var(--color-danger)]">Failed</span>
            )}
            {step.fileOp ? (
              <span className="font-mono text-[10.5px]">
                <span className="text-[var(--color-success)]">+{step.fileOp.additions}</span>{' '}
                <span className="text-[var(--color-danger)]">−{step.fileOp.deletions}</span>
              </span>
            ) : (
              step.meta && <span>{step.meta}</span>
            )}
            {step.durationMs != null && <span>{formatDuration(step.durationMs)}</span>}
            {imageUrl && step.image && (
              <ImageHoverPreview src={imageUrl} alt={step.image.label} caption={`Screenshot · ${step.image.label}`} side="left">
                <a
                  href={imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${step.image.label}`}
                  aria-label={`Open screenshot ${step.image.label}`}
                  data-testid="step-image-link"
                  className="rounded p-0.5 text-[var(--color-muted-foreground)]/60 hover:bg-[var(--color-subtle)] hover:text-[var(--color-primary)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ImageIcon className="h-3 w-3" />
                </a>
              </ImageHoverPreview>
            )}
            {step.fileOp && actions.onOpenChanges && (
              <RowAction
                title={`Show ${step.fileOp.filePath} in changes view`}
                onActivate={() => actions.onOpenChanges?.(step.fileOp?.filePath)}
              >
                <FileDiff className="h-3 w-3" />
              </RowAction>
            )}
            {step.isShell && step.callId && actions.onOpenShell && (
              <RowAction
                title="Open this command in the terminal view"
                onActivate={() => { if (step.callId) actions.onOpenShell?.(step.callId); }}
              >
                <SquareTerminal className="h-3 w-3" />
              </RowAction>
            )}
          </>
        }
      >
        {/* verb + target */}
        <span className="min-w-0 flex-1 truncate text-[12px] leading-5 text-[var(--color-muted-foreground)]">
          <span className={cn('font-medium', isWarning ? 'text-[var(--color-warning)]' : 'text-[var(--color-foreground)]/85')}>{step.verb}</span>{' '}
          {step.mono ? (
            <span className="font-mono text-[11.5px] text-[var(--color-foreground)]/70">{step.target}</span>
          ) : (
            <span className="text-[var(--color-foreground)]/70">{step.target}</span>
          )}
        </span>
      </RowShell>

      {/* running — one thin indeterminate bar, not a fake paragraph */}
      {isRunning && !expanded && (
        <div className="ml-8 mr-2 mt-0.5 mb-1">
          <div className="step-progress" aria-hidden />
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
        <DetailPanel>
          {diff && (
            <InlineDiff
              hunks={diff.hunks}
              truncated={diff.truncated}
              truncatedAction={
                step.fileOp && actions.onOpenChanges ? (
                  <button
                    type="button"
                    className="font-medium text-[var(--color-primary)] hover:underline"
                    onClick={() => actions.onOpenChanges?.(step.fileOp?.filePath)}
                  >
                    Open full diff
                  </button>
                ) : undefined
              }
            />
          )}
          {diff && step.detail && (
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              aria-expanded={showRaw}
              className="mt-1.5 text-[10.5px] text-[var(--color-muted-foreground)]/80 hover:text-[var(--color-foreground)]"
            >
              {showRaw ? 'Hide raw tool call' : 'Show raw tool call'}
            </button>
          )}
          {detailText && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--color-muted-foreground)]/90">
              {detailText}
            </pre>
          )}
          {step.children && step.children.length > 0 && (
            <div className="-ml-1">
              {step.children.map((child) => (
                <StepRow key={child.id} step={child} nested />
              ))}
            </div>
          )}
        </DetailPanel>
      )}
    </div>
  );
});

// ── Group row ────────────────────────────────────────────────────

export const StepGroupRow = React.memo(function StepGroupRow({ group }: { group: StepGroup }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = group.status === 'running';
  const last = group.steps[group.steps.length - 1]!;
  // While live, the sub-line tracks whatever the agent is on right now.
  const subline = isRunning ? last.target : group.summary;
  return (
    <div className="group animate-step-in" data-testid="step-group" data-group-kind={group.kind}>
      <RowShell
        status={group.status}
        kind={group.kind}
        expandable
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        running={isRunning}
        testId="step-group-row"
        meta={
          <>
            {group.failed > 0 && (
              <span className="font-medium text-[var(--color-danger)]">
                {group.failed} failed
              </span>
            )}
            {group.fileOps && (
              <span className="font-mono text-[10.5px]">
                <span className="text-[var(--color-success)]">+{group.fileOps.additions}</span>{' '}
                <span className="text-[var(--color-danger)]">−{group.fileOps.deletions}</span>
              </span>
            )}
            <span
              className="inline-flex h-4 min-w-[1.25rem] items-center justify-center gap-1 rounded-full bg-[var(--color-subtle)] px-1.5 font-mono text-[10px] text-[var(--color-muted-foreground)]"
              title={`${group.steps.length} tool calls`}
              data-testid="step-group-count"
            >
              <Layers className="h-2.5 w-2.5" />
              {group.steps.length}
            </span>
            {group.durationMs != null && <span>{formatDuration(group.durationMs)}</span>}
          </>
        }
      >
        <span className="min-w-0 flex-1 truncate text-[12px] leading-5 text-[var(--color-muted-foreground)]">
          <span className="font-medium text-[var(--color-foreground)]/85">{group.label}</span>
          {subline && (
            <>
              {' '}
              <span className="font-mono text-[11px] text-[var(--color-foreground)]/55">{subline}</span>
            </>
          )}
        </span>
      </RowShell>

      {isRunning && !expanded && (
        <div className="ml-8 mr-2 mt-0.5 mb-1">
          <div className="step-progress" aria-hidden />
        </div>
      )}

      {expanded && (
        <div className="relative ml-4 mt-0.5 border-l border-[var(--color-border)]/60 pl-1" data-testid="step-group-children">
          {group.steps.map((step) => (
            <StepRow key={step.id} step={step} nested />
          ))}
        </div>
      )}
    </div>
  );
});
