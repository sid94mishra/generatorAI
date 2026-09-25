// ────────────────────────────────────────────────────────────────
// StageTimelineItem — one stage as a timeline node.
// No card chrome. Renders:
//   ● Stage name / status pill / duration     [expand chevron]
//   │  ┌──────────────────────────────────┐
//   │  │  user prompt (right-aligned bub) │
//   │  └──────────────────────────────────┘
//   │  ● tool call: read foo.ts     120ms
//   │  ● tool call: wrote bar.ts   1.4s
//   │  ● Thinking about …
//   │  <streaming markdown answer, inline>
//   │  chips: files · summary · output
//   ●  next stage…
//
// The whole thing sits on a shared vertical timeline drawn by
// StageTimeline (below); this item just draws its dot + content.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import {
  Check, Loader2, Clock, Pause, Hand, X, SkipForward, AlertTriangle, Zap,
  ChevronRight, ChevronDown, User, FileText, Database, RefreshCw,
  PanelRightOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/index.js';
import { StreamPanel } from '@/components/agent/StreamPanel.js';
import { UsageChip } from '@/components/agent/UsageChip.js';
import { ContextUsageGauge } from '@/components/shared/ContextUsageGauge.js';
import { InlineHitlControls } from './InlineHitlControls.js';
import type { StageStatus, StageView } from './types.js';

interface StageTimelineItemProps {
  stage: StageView;
  focused: boolean;
  defaultOpen?: boolean;
  /** Collapse this stage by itself when it completes. Off once the run has
   *  finished — there is no next stage to make room for. Defaults to true. */
  autoCollapse?: boolean;
  /** Open this stage once the run is over: it holds the result the user came
   *  for. Set on the last stage only. */
  openWhenFinished?: boolean;
  /** When true, draws the connector line down to the next stage's dot.
   *  False for the final stage so the timeline doesn't dangle past it. */
  showConnector?: boolean;
  onFocus?: (id: string) => void;
  onApproveHitl?: (id: string, followUp?: string) => void;
  onRejectHitl?: (id: string, feedback?: string) => void;
  /** Terminal rejection — fails the stage and blocks the rest of the run. */
  onTerminalRejectHitl?: (id: string, reason?: string) => void;
  onRetry?: (id: string) => void;
  onSelectFiles?: (id: string) => void;
  onSelectOutput?: (id: string) => void;
  /** Open the right inspector pane focused on this stage. */
  onOpenInspector?: (id: string) => void;
}

function statusVisual(status: StageStatus) {
  switch (status) {
    case 'completed':      return { Icon: Check,          dot: 'bg-[var(--color-success)] text-white',        label: 'Completed',       tone: 'success', pulse: false };
    case 'running':        return { Icon: Loader2,        dot: 'bg-[var(--color-primary)] text-white',        label: 'Running',         tone: 'primary', pulse: 'spin' };
    case 'queued':         return { Icon: Clock,          dot: 'bg-[var(--color-primary)]/40 text-white',     label: 'Queued',          tone: 'primary', pulse: false };
    case 'pending':        return { Icon: Clock,          dot: 'bg-[var(--color-muted-foreground)]/30 text-[var(--color-muted-foreground)]', label: 'Pending', tone: 'muted', pulse: false };
    case 'paused':         return { Icon: Pause,          dot: 'bg-[var(--color-warning)] text-white',        label: 'Paused',          tone: 'warning', pulse: false };
    case 'awaiting_input': return { Icon: Hand,           dot: 'bg-[var(--color-warning)] text-white',        label: 'Awaiting input',  tone: 'warning', pulse: 'breathe' };
    case 'failed':         return { Icon: AlertTriangle,  dot: 'bg-[var(--color-danger)] text-white',         label: 'Failed',          tone: 'danger',  pulse: false };
    case 'cancelled':      return { Icon: X,              dot: 'bg-[var(--color-muted-foreground)]/40 text-white', label: 'Cancelled', tone: 'muted', pulse: false };
    case 'skipped':        return { Icon: SkipForward,    dot: 'bg-[var(--color-muted-foreground)]/40 text-white', label: 'Skipped',  tone: 'muted', pulse: false };
  }
}

function formatDuration(ms?: number): string | null {
  if (!ms || ms < 500) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export const StageTimelineItem = React.memo(function StageTimelineItem({
  stage, focused, defaultOpen, autoCollapse = true, openWhenFinished = false, showConnector = true, onFocus, onApproveHitl, onRejectHitl, onTerminalRejectHitl, onRetry, onSelectFiles, onSelectOutput, onOpenInspector,
}: StageTimelineItemProps) {
  const v = statusVisual(stage.status);
  const isActive = stage.status === 'running' || stage.status === 'awaiting_input';
  const isTerminal = stage.status === 'completed' || stage.status === 'failed' || stage.status === 'cancelled' || stage.status === 'skipped';
  const isAwaiting = stage.status === 'awaiting_input';
  const isFailed = stage.status === 'failed';
  const isSkippedOrCancelled = stage.status === 'skipped' || stage.status === 'cancelled';

  // Open state: streaming/awaiting/failed default open, pending/completed closed.
  // Completed = user can click to expand if they want details.
  const [open, setOpen] = useState(defaultOpen ?? (isActive || isFailed));
  const [userToggled, setUserToggled] = useState(false);

  // Auto-open the moment a pending stage flips to active; auto-close when it
  // transitions from active → terminal (completed) — unless the user has
  // explicitly toggled the section themselves.
  //
  // `autoCollapse` is what stops that from emptying the page at the end of a
  // run: collapsing a finished stage makes room for the NEXT one, but when
  // nothing follows it the user was left staring at a blank page, one
  // unlabelled row away from the output they had just been reading.
  useEffect(() => {
    if (userToggled) return;
    if (isActive) setOpen(true);
    else if (stage.status === 'completed' && autoCollapse) setOpen(false);
    // Re-open when the run ends. The final stage collapses on the same tick it
    // completes — the run is still "active" for another beat — so opening it
    // only at mount left a finished run showing nothing at all.
    else if (openWhenFinished && !autoCollapse) setOpen(true);
  }, [isActive, stage.status, userToggled, autoCollapse, openWhenFinished]);

  const toggle = () => {
    setUserToggled(true);
    setOpen((o) => !o);
  };

  const dur = formatDuration(stage.durationMs);
  const fileCount = stage.files?.length ?? 0;

  return (
    <div
      className={cn('relative', showConnector && 'pb-3')}
      data-stage-id={stage.id}
    >
      {/* Per-item connector line — runs from just below this dot down to
          the very bottom of this item (whose pb-3 provides the gap to the
          next stage's dot). Not drawn for the last stage. */}
      {showConnector && (
        <div
          className="pointer-events-none absolute w-0.5 bg-[var(--color-border)]"
          style={{ left: '11px', top: '28px', bottom: '-4px' }}
          aria-hidden
        />
      )}

      {/* Row: dot + header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => { onFocus?.(stage.id); toggle(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus?.(stage.id); toggle(); }
        }}
        aria-expanded={open}
        className={cn(
          'group relative flex cursor-pointer items-center gap-2.5 rounded-md py-1 pr-2 transition-colors',
          focused && 'bg-[var(--color-primary)]/[0.04]',
          'hover:bg-[var(--color-subtle)]/40',
        )}
      >
        {/* dot */}
        <span
          className={cn(
            'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ring-[var(--color-background)]',
            v.dot,
          )}
        >
          <v.Icon className={cn(
            'h-3 w-3',
            v.pulse === 'spin' && 'animate-spin',
            v.pulse === 'breathe' && 'animate-status-breathe',
          )} />
        </span>

        {/* order */}
        <span className="hidden shrink-0 text-[10.5px] font-mono text-[var(--color-muted-foreground)]/60 md:inline">
          #{stage.order}
        </span>

        {/* name */}
        <span className={cn(
          'min-w-0 flex-1 truncate text-[13px] font-semibold',
          isSkippedOrCancelled ? 'text-[var(--color-muted-foreground)]' : 'text-[var(--color-foreground)]',
        )}>
          {stage.name}
        </span>

        {/* status label */}
        <span className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium',
          v.tone === 'success' && 'bg-[var(--color-success)]/12 text-[var(--color-success)]',
          v.tone === 'primary' && 'bg-[var(--color-primary)]/12 text-[var(--color-primary)]',
          v.tone === 'warning' && 'bg-[var(--color-warning)]/12 text-[var(--color-warning)]',
          v.tone === 'danger'  && 'bg-[var(--color-danger)]/12  text-[var(--color-danger)]',
          v.tone === 'indigo'  && 'bg-indigo-500/12 text-indigo-400',
          v.tone === 'muted'   && 'bg-[var(--color-muted-foreground)]/10 text-[var(--color-muted-foreground)]',
        )}>
          {v.label}
        </span>

        {/* parallel badge */}
        {(stage.parallelWith?.length ?? 0) > 0 && (
          <span className="hidden shrink-0 items-center gap-0.5 rounded-full bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-400 md:inline-flex">
            <Zap className="h-2.5 w-2.5" />
            parallel({(stage.parallelWith?.length ?? 0) + 1})
          </span>
        )}

        {/* right meta */}
        <span className="flex shrink-0 items-center gap-2 text-[10.5px] text-[var(--color-muted-foreground)]/80">
          {isActive && stage.stepsTotal > 0 && (
            <span className="tabular-nums text-[var(--color-primary)]">{stage.stepsDone}/{stage.stepsTotal}</span>
          )}
          {fileCount > 0 && (
            <span className="hidden items-center gap-1 md:inline-flex">
              <FileText className="h-2.5 w-2.5" />
              {fileCount}
            </span>
          )}
          {dur && <span className="tabular-nums">{dur}</span>}
          {(stage.contextUsage || stage.usage) && (
            <ContextUsageGauge
              snapshot={stage.contextUsage ?? null}
              usage={stage.usage ?? null}
              placement="bottom"
              showLabel={false}
              {...(stage.sharedContext
                ? { scopeNote: 'This run shares one conversation across stages, so this is the run’s context window — not this stage alone.' }
                : {})}
            />
          )}
          {isFailed && onRetry && (
            <Button
              onClick={(e) => { e.stopPropagation(); onRetry(stage.id); }}
              title="Retry stage"
              variant="ghost"
              size="icon-sm"
              className="h-auto w-auto rounded-md border border-[var(--color-border)] p-0.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-primary)]/10 hover:text-[var(--color-primary)]"
            >
              <RefreshCw className="h-2.5 w-2.5" />
            </Button>
          )}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform text-[var(--color-muted-foreground)]/60', !open && '-rotate-90')} />
        </span>
      </div>

      {/* Body — indented under the dot with the vertical line continuing */}
      {open && !isSkippedOrCancelled && (
        <div className="pl-[34px] pt-1.5 pb-3 space-y-2.5">
          {/* User prompt bubble — right-aligned */}
          {stage.prompt && (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--color-primary)]/[0.08] border border-[var(--color-primary)]/20 px-3 py-2">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-primary)]/80">
                  <User className="h-2.5 w-2.5" />
                  Stage prompt
                </div>
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--color-foreground)]/90">
                  {stage.prompt}
                </p>
              </div>
            </div>
          )}

          {/* Steps + streaming answer + error — the shared stream body.
              Skeleton placeholder is never shown while the stage is parked
              in HITL (`awaiting_input`), since the InlineHitlControls below
              already communicate the state and a shimmer there is
              misleading (the model isn't producing tokens). Usage is NOT
              rendered here — it lives in the chips row below. */}
          <StreamPanel
            segments={stage.segments}
            steps={stage.steps}
            answer={stage.answer}
            active={stage.status === 'running'}
            answerStreaming={isActive && !isAwaiting}
            loading={isActive && !isAwaiting && stage.steps.length === 0}
            error={isFailed ? stage.error : undefined}
          />


          {/* Chips row — files · output · details (inspector) · usage */}
          {isTerminal && (stage.files?.length || stage.outputData || stage.summary || stage.usage || onOpenInspector) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {stage.files?.length ? (
                <Button
                  onClick={(e) => { e.stopPropagation(); onSelectFiles?.(stage.id); onOpenInspector?.(stage.id); }}
                  variant="ghost"
                  size="sm"
                  className="h-auto flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-subtle)]/50 px-2 py-1 text-[10.5px] font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]"
                >
                  <FileText className="h-3 w-3" />
                  {stage.files.length} file{stage.files.length !== 1 ? 's' : ''}
                </Button>
              ) : null}
              {stage.outputData && (
                <Button
                  onClick={(e) => { e.stopPropagation(); onSelectOutput?.(stage.id); onOpenInspector?.(stage.id); }}
                  variant="ghost"
                  size="sm"
                  className="h-auto flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/[0.06] px-2 py-1 text-[10.5px] font-medium text-cyan-400 hover:bg-cyan-500/[0.12]"
                >
                  <Database className="h-3 w-3" />
                  Structured output
                </Button>
              )}
              {onOpenInspector && (
                <Button
                  onClick={(e) => { e.stopPropagation(); onOpenInspector(stage.id); }}
                  variant="ghost"
                  size="sm"
                  className="h-auto flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-subtle)]/50 px-2 py-1 text-[10.5px] font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]"
                  title="Open inspector for this stage"
                >
                  <PanelRightOpen className="h-3 w-3" />
                  Details
                </Button>
              )}
              {stage.usage && <UsageChip usage={stage.usage} />}
            </div>
          )}

          {/* HITL controls — rendered at the bottom so the reviewer sees the
              stage output above the approval block. */}
          {isAwaiting && stage.interrupt && (
            <InlineHitlControls
              reason={stage.interrupt.reason}
              tool={stage.interrupt.tool}
              args={stage.interrupt.args}
              onApprove={(fu) => onApproveHitl?.(stage.id, fu)}
              onReject={(feedback) => onRejectHitl?.(stage.id, feedback)}
              {...(onTerminalRejectHitl
                ? { onTerminalReject: (reason?: string) => onTerminalRejectHitl(stage.id, reason) }
                : {})}
            />
          )}
        </div>
      )}

      {/* Skipped / cancelled inline note */}
      {isSkippedOrCancelled && (
        <div className="pl-[34px] py-1 text-[10.5px] text-[var(--color-muted-foreground)]/70">
          {stage.status === 'skipped'
            ? (stage.error ?? 'Condition not met')
            : 'Cancelled'}
        </div>
      )}
    </div>
  );
});
