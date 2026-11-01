// ────────────────────────────────────────────────────────────────
// ChatGlance — the chat summary card beside the transcript: where the agent
// works and what it has done, at a glance, each line one click from its dock
// tab.
//
//   Working folder  the primary mount's live branch and what it was created
//                   from (worktree / in place / chat folder), unpushed commits
//   Changes         uncommitted files and lines (the Changes tab's default
//                   view, same query) → Changes
//   Background      the orchestrator's workers: running · done · failed → Tasks
//   Browser         each page open in the dock: favicon, title, address → its tab
//   Computer        the app and the last action the agent took → Computer
//
// Lines for panels the chat never used are left out (no fake state, D-36).
// Shown and hidden from the header (`chatGlanceStore`, one device setting).
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { describeMount } from '@generatorai/client-core';
import { useBackgroundTasks, useWorkspaceChangeSummary, useWorkspaceReadiness } from '@/hooks/queries.js';
import { useComputerActivity } from '@/hooks/computerQueries.js';
import { COMPUTER_TIMELINE_MAX } from '@/hooks/computerTimeline.js';
import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import type { BrowserTabState } from '@/blocks/browser/useBrowserTabState.js';
import { browserDockTabDetail } from '@/blocks/browser/browserDock.js';
import { cn } from '@/ui/lib/cn.js';
import { DiffStat } from '@/ui/patterns/DiffStat/DiffStat.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { SummaryLine } from '@/ui/primitives/SummaryLine/SummaryLine.js';

/** The dock tabs a line opens. */
export type ChatGlanceTarget = { type: 'changes' | 'tasks' | 'computer' } | { type: 'browser'; tabId: string };

export interface ChatGlanceProps {
  chatId: string | undefined;
  workspaceId: string | undefined;
  isOrchestrator: boolean;
  computerUseEnabled: boolean;
  /** The Browser dock tabs' pages, by tab id. */
  browserTabs: Readonly<Record<string, BrowserTabState>>;
  onOpen: (target: ChatGlanceTarget) => void;
  onHide: () => void;
  className?: string;
}

const RUNNING_TASKS = new Set(['spawned', 'running', 'needs_review']);

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function ChatGlance({ chatId, workspaceId, isOrchestrator, computerUseEnabled, browserTabs, onOpen, onHide, className }: ChatGlanceProps) {
  const pages = Object.entries(browserTabs).filter(([, page]) => !!page.url && page.url !== 'about:blank');
  return (
    <aside aria-label="Chat summary" className={cn('flex flex-col gap-0.5 p-1.5', className)} data-testid="chat-glance">
      <div className="flex h-control items-center justify-between pl-2">
        <span className="text-micro font-medium text-fg-3 uppercase">Chat summary</span>
        <IconButton size="sm" icon="x" label="Hide chat summary" onClick={onHide} />
      </div>
      <WorkingFolder workspaceId={workspaceId} />
      <ChangesLine workspaceId={workspaceId} onOpen={() => onOpen({ type: 'changes' })} />
      {isOrchestrator ? <TasksLine chatId={chatId} onOpen={() => onOpen({ type: 'tasks' })} /> : null}
      {pages.map(([tabId, page]) => (
        <SummaryLine
          key={tabId}
          icon="browser"
          image={page.favicon ?? undefined}
          title={page.title?.trim() || 'Browser'}
          detail={browserDockTabDetail(page)}
          onClick={() => onOpen({ type: 'browser', tabId })}
          data-testid="chat-glance-browser"
        />
      ))}
      {computerUseEnabled ? <ComputerLine workspaceId={workspaceId} onOpen={() => onOpen({ type: 'computer' })} /> : null}
    </aside>
  );
}

function WorkingFolder({ workspaceId }: { workspaceId: string | undefined }) {
  const info = useWorkspaceInfo(workspaceId);
  const readiness = useWorkspaceReadiness(workspaceId);
  const mounts = info.data?.mounts ?? [];
  const primary = mounts.find((m) => m.position === 0) ?? mounts[0];
  if (!primary) return null;
  const shown = describeMount(primary);
  const repo = readiness.data?.repos.find((r) => r.alias === primary.alias);
  // The live branch (the agent may have switched), else the one recorded when the folder was prepared.
  const branch = repo?.branch ?? shown.branch;
  const base = primary.git?.baseRef;
  const parts = [
    branch ? shown.label : undefined,
    base && base !== branch ? `from ${base}` : undefined,
    shown.modeLabel,
    repo?.unborn ? 'no commits yet' : undefined,
    repo?.ahead ? `${plural(repo.ahead, 'commit')} not pushed` : undefined,
    mounts.length > 1 ? `+${plural(mounts.length - 1, 'source')}` : undefined,
  ].filter(Boolean);
  return (
    <SummaryLine
      icon={branch ? 'branch' : 'projects'}
      title={branch ?? shown.label}
      mono={!!branch}
      detail={parts.join(' · ') || undefined}
      data-testid="chat-glance-branch"
    />
  );
}

function ChangesLine({ workspaceId, onOpen }: { workspaceId: string | undefined; onOpen: () => void }) {
  // The Changes tab's default view in a chat (uncommitted), so the two share one query.
  const summary = useWorkspaceChangeSummary(workspaceId, { base: 'head', head: 'working' });
  const stats = summary.data?.stats;
  if (!workspaceId || !stats) return null;
  return (
    <SummaryLine
      icon="changes"
      title={stats.files > 0 ? `${plural(stats.files, 'file')} changed` : 'No uncommitted changes'}
      detail={stats.files > 0 ? 'Not committed yet' : 'Everything is committed'}
      trailing={stats.additions > 0 || stats.deletions > 0 ? <DiffStat added={stats.additions} removed={stats.deletions} /> : null}
      onClick={onOpen}
      data-testid="chat-glance-changes"
    />
  );
}

function TasksLine({ chatId, onOpen }: { chatId: string | undefined; onOpen: () => void }) {
  const tasks = useBackgroundTasks(chatId, true);
  const counts = useMemo(() => {
    const list = tasks.data?.tasks ?? [];
    return {
      total: list.length,
      running: list.filter((t) => RUNNING_TASKS.has(t.status)).length,
      done: list.filter((t) => t.status === 'completed').length,
      failed: list.filter((t) => t.status === 'failed' || t.status === 'interrupted').length,
    };
  }, [tasks.data]);
  if (counts.total === 0) return null;
  const detail = [counts.done ? `${counts.done} done` : undefined, counts.failed ? `${counts.failed} failed` : undefined]
    .filter(Boolean)
    .join(' · ');
  return (
    <SummaryLine
      icon="tasks"
      title={counts.running > 0 ? `${plural(counts.running, 'background task')} running` : `${plural(counts.total, 'background task')}, none running`}
      detail={detail || undefined}
      onClick={onOpen}
      data-testid="chat-glance-tasks"
    />
  );
}

function ComputerLine({ workspaceId, onOpen }: { workspaceId: string | undefined; onOpen: () => void }) {
  const activity = useComputerActivity(workspaceId);
  const last = activity.entries[0];
  if (!last) return null;
  const app = activity.windowTitle || last.appLabel;
  const step = [last.action, last.target].filter(Boolean).join(' ');
  return (
    <SummaryLine
      icon="computer"
      title={app ? `Computer · ${app}` : 'Computer'}
      // The log keeps the newest COMPUTER_TIMELINE_MAX: a full log means at least that many.
      detail={[step, activity.entries.length >= COMPUTER_TIMELINE_MAX ? `${COMPUTER_TIMELINE_MAX}+ actions` : plural(activity.entries.length, 'action')]
        .filter(Boolean)
        .join(' · ')}
      onClick={onOpen}
      data-testid="chat-glance-computer"
    />
  );
}
