// ────────────────────────────────────────────────────────────────
// ActivityPanel — mission-control's operational feed.
// A single list (not a card grid) with three tabs:
//   • Today          — everything with activity today (top 20, newest first)
//   • Running         — ONLY what's executing right now
//   • Needs attention — failed items + anything waiting on a human
// Each row links to its detail page and, where relevant, exposes the
// correct inline action: Cancel (running run/automation), Stop (running
// chat turn), or Restart (failed run/automation).
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare, GitBranch, Zap, RotateCcw, X, Activity, CircleCheck,
} from 'lucide-react';
import { Button, StatusBadge, Badge, Spinner } from '@/components/ui/index.js';
import { FilterTabs } from '@/components/data/index.js';
import { cn } from '@/lib/utils.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';
import { useTicker, formatElapsed } from './useTicker.js';
import type { LiveItem, LiveKind } from '@/hooks/useLiveOperations.js';
import { useForkRun, useRunCommand } from '@/hooks/workflowQueries.js';
import { useCancelChat } from '@/hooks/queries.js';
import { useCancelAutomationExecution, useTriggerAutomation } from '@/hooks/automationQueries.js';

export interface ActivityPanelProps {
  today: LiveItem[];
  running: LiveItem[];
  attention: LiveItem[];
  isLoading: boolean;
}

const KIND_ICON: Record<LiveKind, React.ComponentType<{ className?: string }>> = {
  chat: MessageSquare,
  run: GitBranch,
  automation: Zap,
};
const KIND_TONE: Record<LiveKind, string> = {
  chat: 'bg-info-muted text-info',
  run: 'bg-success-muted text-success',
  automation: 'bg-warning-muted text-warning',
};
const KIND_LABEL: Record<LiveKind, string> = {
  chat: 'Chat',
  run: 'Workflow',
  automation: 'Automation',
};

const RUNNING_STATUSES = new Set(['running', 'starting', 'waiting', 'finalizing', 'cancelling', 'pending']);

type Tab = 'today' | 'running' | 'attention';

export function ActivityPanel({ today, running, attention, isLoading }: ActivityPanelProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('today');

  const hasLive = [...today, ...running].some((i) => i.live);
  const now = useTicker(hasLive);

  const runCommand = useRunCommand();
  const forkRun = useForkRun();
  const cancelChat = useCancelChat();
  const cancelExec = useCancelAutomationExecution();
  const triggerAutomation = useTriggerAutomation();
  const busy =
    runCommand.isPending || forkRun.isPending || cancelChat.isPending ||
    cancelExec.isPending || triggerAutomation.isPending;

  const items = tab === 'today' ? today : tab === 'running' ? running : attention;

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Activity</h2>
          {isLoading && <Spinner size="sm" className="text-muted-foreground" />}
        </div>
        <FilterTabs
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { id: 'today', label: 'Today', count: today.length },
            { id: 'running', label: 'Running', count: running.length },
            { id: 'attention', label: 'Needs attention', count: attention.length },
          ]}
        />
      </div>

      <div className="h-[28rem] space-y-2 overflow-y-auto p-3">
        {isLoading && items.length === 0 ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-subtle/40 px-4 py-3">
              <div className="h-9 w-9 animate-pulse rounded-lg bg-subtle" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-48 animate-pulse rounded bg-subtle" />
                <div className="h-3 w-28 animate-pulse rounded bg-subtle" />
              </div>
            </div>
          ))
        ) : items.length === 0 ? (
          <EmptyLane tab={tab} />
        ) : (
          items.map((item) => (
            <ActivityRow
              key={item.key}
              item={item}
              now={now}
              busy={busy}
              onOpen={() => navigate(item.href)}
              onCancelRun={() => runCommand.mutate({ runId: item.runId!, command: { command: 'cancel' } })}
              onRetryRun={() => {
                // "Retry failed" forks a NEW run (the failed one stays
                // terminal) — open it rather than leaving the card pointing
                // at the ancestor.
                void forkRun.mutateAsync({ runId: item.runId! }).then((fork) => {
                  // `item.href` is `/workflows/<defId>/runs/<runId>`; swap the
                  // trailing run id for the fork rather than re-deriving it.
                  if (fork?.id && item.href.includes('/runs/')) {
                    navigate(item.href.replace(/\/runs\/[^/]+$/, `/runs/${fork.id}`));
                  }
                });
              }}
              onStopChat={() => cancelChat.mutate(item.id)}
              onCancelExec={() =>
                cancelExec.mutate({ automationId: item.automationId!, executionId: item.executionId! })}
              onRestartAutomation={() => triggerAutomation.mutate({ id: item.automationId! })}
            />
          ))
        )}
      </div>
    </section>
  );
}

// ── Row ──

interface ActivityRowProps {
  item: LiveItem;
  now: number;
  busy: boolean;
  onOpen: () => void;
  onCancelRun: () => void;
  onRetryRun: () => void;
  onStopChat: () => void;
  onCancelExec: () => void;
  onRestartAutomation: () => void;
}

function ActivityRow({
  item, now, busy, onOpen, onCancelRun, onRetryRun, onStopChat, onCancelExec, onRestartAutomation,
}: ActivityRowProps) {
  const Icon = KIND_ICON[item.kind];
  const isFailed = item.status === 'failed';
  const isRunning = RUNNING_STATUSES.has(item.status);
  // Runs / automations expose a real start time, so show a live elapsed timer.
  // Chats have no dashboard-visible turn-start, so a "since last update" timer
  // would mislead — show a plain "Generating…" label instead.
  const timing = item.live
    ? item.kind === 'chat'
      ? 'Generating…'
      : formatElapsed(now - item.ts)
    : formatRelativeTime(new Date(item.ts));

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
      className="group flex items-center gap-3 rounded-lg border border-border bg-subtle/40 px-4 py-3 transition-colors hover:border-[color-mix(in_srgb,var(--primary)_30%,var(--border))] hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className={cn('relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', KIND_TONE[item.kind])}>
        <Icon className="h-4 w-4" />
        {item.live && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-card bg-success animate-status-breathe" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
          <Badge tone="neutral" size="sm" className="shrink-0">{KIND_LABEL[item.kind]}</Badge>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn('tabular-nums', item.live && 'font-mono text-foreground')}>{timing}</span>
        </div>
      </div>

      <StatusBadge status={item.status} size="sm" className="shrink-0" />

      {/* Inline actions — status-driven so they're correct in every tab. */}
      <div className="flex shrink-0 items-center gap-1.5">
        {item.kind === 'run' && isRunning && (
          <Button variant="secondary" size="sm" disabled={busy}
            leftIcon={<X className="h-3.5 w-3.5" />} onClick={stop(onCancelRun)}>
            Cancel
          </Button>
        )}
        {item.kind === 'run' && isFailed && (
          <Button variant="secondary" size="sm" disabled={busy}
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={stop(onRetryRun)}>
            Retry failed
          </Button>
        )}
        {item.kind === 'automation' && isRunning && (
          <Button variant="secondary" size="sm" disabled={busy}
            leftIcon={<X className="h-3.5 w-3.5" />} onClick={stop(onCancelExec)}>
            Cancel
          </Button>
        )}
        {item.kind === 'automation' && isFailed && (
          <Button variant="secondary" size="sm" disabled={busy}
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={stop(onRestartAutomation)}>
            Restart
          </Button>
        )}
        {item.kind === 'chat' && item.status === 'running' && (
          <Button variant="secondary" size="sm" disabled={busy}
            leftIcon={<X className="h-3.5 w-3.5" />} onClick={stop(onStopChat)}>
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Empty states ──

function EmptyLane({ tab }: { tab: Tab }) {
  if (tab === 'attention') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
        <CircleCheck className="h-8 w-8 text-success" />
        <p className="text-sm font-medium text-foreground">Nothing needs attention</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          No runs or automations have failed, and nothing is waiting on approval.
        </p>
      </div>
    );
  }
  if (tab === 'today') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
        <Activity className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">No activity today</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Chats, workflow runs, and automations you touch today will appear here, newest first.
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="relative flex h-10 w-10 items-center justify-center">
        <span className="absolute h-2.5 w-2.5 rounded-full bg-success animate-status-breathe" />
      </div>
      <p className="text-sm font-medium text-foreground">All systems idle</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Nothing is running right now. Start a chat, workflow, or automation and it will show up here live.
      </p>
    </div>
  );
}
