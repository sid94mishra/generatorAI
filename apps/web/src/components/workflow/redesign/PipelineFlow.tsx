// ────────────────────────────────────────────────────────────────
// PipelineFlow — horizontal chain of stages.
// Sequential stages render inline on one row connected by arrows.
// Parallel stages render inside a shared cyan-outlined group with the
// stacked stage pills side-by-side (or stacked on narrow screens).
// Horizontally scrollable on overflow.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import {
  Check, Loader2, Clock, Pause, Hand, X, SkipForward, AlertTriangle, Zap, Moon, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import type { StageStatus, StageView } from './types.js';

interface PipelineFlowProps {
  stages: StageView[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  className?: string;
}

function statusVisual(status: StageStatus): { Icon: React.ComponentType<{ className?: string }>; classes: string; pulse: boolean } {
  switch (status) {
    case 'completed':      return { Icon: Check,          classes: 'text-[var(--color-success)]',           pulse: false };
    case 'running':        return { Icon: Loader2,        classes: 'text-[var(--color-primary)]',           pulse: true };
    case 'queued':         return { Icon: Clock,          classes: 'text-[var(--color-primary)]/70',        pulse: false };
    case 'pending':        return { Icon: Clock,          classes: 'text-[var(--color-muted-foreground)]/50', pulse: false };
    case 'paused':         return { Icon: Pause,          classes: 'text-[var(--color-warning)]',           pulse: false };
    case 'awaiting_input': return { Icon: Hand,           classes: 'text-[var(--color-warning)]',           pulse: true };
    case 'sleeping':       return { Icon: Moon,           classes: 'text-indigo-400',                       pulse: false };
    case 'failed':         return { Icon: AlertTriangle,  classes: 'text-[var(--color-danger)]',            pulse: false };
    case 'cancelled':      return { Icon: X,              classes: 'text-[var(--color-muted-foreground)]/60', pulse: false };
    case 'skipped':        return { Icon: SkipForward,    classes: 'text-[var(--color-muted-foreground)]/60', pulse: false };
  }
}

function formatShort(ms?: number): string | null {
  if (!ms || ms < 500) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

interface StagePillProps {
  stage: StageView;
  focused: boolean;
  onFocus: (id: string) => void;
  compact?: boolean;
}

const StagePill = React.memo(function StagePill({ stage, focused, onFocus, compact }: StagePillProps) {
  const v = statusVisual(stage.status);
  const isActive = stage.status === 'running' || stage.status === 'awaiting_input';
  const dur = formatShort(stage.durationMs);

  return (
    <button
      onClick={() => onFocus(stage.id)}
      title={`${stage.name} — ${stage.status.replace(/_/g, ' ')}`}
      aria-current={focused ? 'true' : undefined}
      className={cn(
        'group flex items-center gap-1.5 rounded-full border px-2 py-1 text-left transition-all',
        'text-[11.5px] font-medium shrink-0 max-w-[220px]',
        focused
          ? 'border-[var(--color-primary)]/50 bg-[var(--color-primary)]/10 text-[var(--color-foreground)]'
          : isActive
            ? 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/[0.04] text-[var(--color-foreground)] hover:bg-[var(--color-primary)]/[0.08]'
            : 'border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]',
      )}
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
          focused ? 'bg-[var(--color-primary)]/15' : 'bg-[var(--color-subtle)]',
        )}
      >
        <v.Icon className={cn(
          'h-2.5 w-2.5', v.classes,
          v.pulse && (stage.status === 'running' ? 'animate-spin' : 'animate-status-breathe'),
        )} />
      </span>
      <span className="min-w-0 truncate">{stage.name}</span>
      {(stage.parallelWith?.length ?? 0) > 0 && (
        <span
          className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-cyan-500/12 px-1 py-px text-[9px] font-semibold text-cyan-500"
          title={`Parallel with ${stage.parallelWith!.length} other stage(s)`}
        >
          <Zap className="h-2 w-2" />
        </span>
      )}
      {dur && !compact && (
        <span className="shrink-0 tabular-nums text-[10.5px] text-[var(--color-muted-foreground)]/80">{dur}</span>
      )}
    </button>
  );
});

export function PipelineFlow({ stages, focusedId, onFocus, className }: PipelineFlowProps) {
  if (stages.length === 0) return null;

  return (
    <nav
      className={cn(
        'flex items-center gap-1.5 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-card)]/40 px-3 py-2',
        className,
      )}
      aria-label="Pipeline flow"
    >
      {stages.map((stage, i) => {
        const isLast = i === stages.length - 1;
        return (
          <React.Fragment key={stage.id}>
            <StagePill
              stage={stage}
              focused={focusedId === stage.id}
              onFocus={onFocus}
            />
            {!isLast && (
              <span
                aria-hidden
                className="flex shrink-0 items-center text-[var(--color-muted-foreground)]/40"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
