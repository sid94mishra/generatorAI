// ────────────────────────────────────────────────────────────────
// StatusBadge — the single canonical status pill for the whole app.
// Maps every workflow-run / stage-run / chat status to a semantic Badge
// tone + icon + label. Replaces the ~19 scattered status-pill impls
// (RunStatusBadge, chat/Header StatusBadge, dashboard dup, inline pills).
//
// Always pairs an icon with the label so status is never conveyed by
// color alone (WCAG 1.4.1).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import {
  CircleDot, Loader2, Play, Pause, Check, X, Clock, SkipForward, AlertCircle, Archive, Hand, Moon,
} from 'lucide-react';
import { Badge, type BadgeTone, type BadgeSize } from './Badge.js';
import { cn } from '@/lib/utils.js';

interface StatusEntry {
  tone: BadgeTone;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  spin?: boolean;
}

const STATUS: Record<string, StatusEntry> = {
  // WorkflowRun
  created: { tone: 'neutral', label: 'Created', Icon: CircleDot },
  starting: { tone: 'info', label: 'Starting', Icon: Loader2, spin: true },
  running: { tone: 'info', label: 'Running', Icon: Play },
  paused: { tone: 'warning', label: 'Paused', Icon: Pause },
  cancelling: { tone: 'danger', label: 'Cancelling', Icon: Loader2, spin: true },
  completed: { tone: 'success', label: 'Completed', Icon: Check },
  failed: { tone: 'danger', label: 'Failed', Icon: AlertCircle },
  cancelled: { tone: 'neutral', label: 'Cancelled', Icon: X },
  // StageRun-specific
  pending: { tone: 'neutral', label: 'Pending', Icon: Clock },
  queued: { tone: 'info', label: 'Queued', Icon: Clock },
  skipped: { tone: 'neutral', label: 'Skipped', Icon: SkipForward },
  sleeping: { tone: 'info', label: 'Sleeping', Icon: Moon },
  awaiting_input: { tone: 'warning', label: 'Awaiting input', Icon: Hand },
  // Chat / session
  active: { tone: 'success', label: 'Active', Icon: CircleDot },
  archived: { tone: 'neutral', label: 'Archived', Icon: Archive },
  deleted: { tone: 'neutral', label: 'Deleted', Icon: X },
  error: { tone: 'danger', label: 'Error', Icon: AlertCircle },
  idle: { tone: 'neutral', label: 'Idle', Icon: CircleDot },
};

export interface StatusBadgeProps {
  status: string;
  size?: BadgeSize;
  showIcon?: boolean;
  /** Override the default label (e.g. a live "Generating" state). */
  label?: string;
  className?: string;
}

export function StatusBadge({ status, size = 'sm', showIcon = true, label, className }: StatusBadgeProps) {
  const entry: StatusEntry = STATUS[status] ?? { tone: 'neutral', label: status, Icon: CircleDot };
  const Icon = entry.Icon;
  return (
    <Badge tone={entry.tone} size={size} className={className}>
      {showIcon && <Icon className={cn('h-3 w-3 shrink-0', entry.spin && 'animate-spin')} />}
      {label ?? entry.label}
    </Badge>
  );
}
