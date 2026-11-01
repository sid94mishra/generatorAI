// ────────────────────────────────────────────────────────────────
// ChatGlance — the chat summary card, floating beside the transcript while the
// side pane is closed: where the agent works, what it has done, and the
// commands a person reaches for next. One P-48 card in three sections:
//
//   Where      the machine and folder (Show in Finder / Copy path) · Open in
//              the default editor, the chevron choosing another · the working
//              folder's live branch and what it was created from
//   Activity   uncommitted changes → Changes · background tasks → Tasks ·
//              each page open in the browser → its tab · the computer's last
//              action → Computer (lines for panels never used are left out,
//              D-36)
//   Commands   Open a terminal · Browse files
//
// Shown and hidden from the header (`chatGlanceStore`, one device setting);
// the page hides it while the side pane is open, which covers the same room.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { describeMount } from '@generatorai/client-core';
import { useBackgroundTasks, useWorkspaceChangeSummary, useWorkspaceReadiness } from '@/hooks/queries.js';
import { useComputerActivity } from '@/hooks/computerQueries.js';
import { COMPUTER_TIMELINE_MAX } from '@/hooks/computerTimeline.js';
import { useShellStatus } from '@/hooks/useShellStatus.js';
import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import type { BrowserTabState } from '@/blocks/browser/useBrowserTabState.js';
import { browserDockTabDetail } from '@/blocks/browser/browserDock.js';
import { EditorChoiceMenu, FALLBACK_EDITOR } from '@/blocks/editor/OpenInEditorButton.js';
import { useEditorActions, FILE_MANAGER } from '@/blocks/editor/useEditorActions.js';
import { EditorMark } from '@/ui/icons/vendor/VendorIcons.js';
import { cn } from '@/ui/lib/cn.js';
import { DiffStat } from '@/ui/patterns/DiffStat/DiffStat.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { SummaryLine } from '@/ui/primitives/SummaryLine/SummaryLine.js';

/** The dock tabs a line opens. */
export type ChatGlanceTarget =
  | { type: 'changes' | 'tasks' | 'computer' | 'terminal' | 'files' }
  | { type: 'browser'; tabId: string };

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
const SECTION = 'gap-0.5 p-1.5';

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The last two segments of a path, enough to recognise the folder. */
function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path;
}

export function ChatGlance({ chatId, workspaceId, isOrchestrator, computerUseEnabled, browserTabs, onOpen, onHide, className }: ChatGlanceProps) {
  const pages = Object.entries(browserTabs).filter(([, page]) => !!page.url && page.url !== 'about:blank');
  return (
    <Card role="complementary" aria-label="Chat summary" className={cn('flex flex-col', className)} data-testid="chat-glance">
      <div className="flex h-panel-bar items-center justify-between border-b border-line-soft pr-1.5 pl-3.5">
        <span className="text-ui font-semibold text-fg">Summary</span>
        <IconButton size="sm" icon="x" label="Hide chat summary" onClick={onHide} />
      </div>
      <div className={cn('flex flex-col', SECTION)}>
        <MachineLine />
        <EditorLine />
        <WorkingFolder workspaceId={workspaceId} />
      </div>
      <Card.Section className={SECTION} data-testid="chat-glance-activity">
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
      </Card.Section>
      {workspaceId ? (
        <Card.Section className={SECTION} data-testid="chat-glance-commands">
          <SummaryLine icon="terminal" title="Open a terminal" chevron={false} onClick={() => onOpen({ type: 'terminal' })} data-testid="chat-glance-terminal" />
          <SummaryLine icon="files" title="Browse files" chevron={false} onClick={() => onOpen({ type: 'files' })} data-testid="chat-glance-files" />
        </Card.Section>
      ) : null}
    </Card>
  );
}

/** The server the chat runs on and its working folder: Show in Finder on the desktop, else Copy path. */
function MachineLine() {
  const { serverName } = useShellStatus();
  const editor = useEditorActions();
  const path = editor.target?.path;
  const title = serverName ?? 'This computer';
  if (!path) return <SummaryLine icon="computer" title={title} data-testid="chat-glance-machine" />;
  const reveal = editor.reveal;
  return (
    <SummaryLine
      icon="computer"
      title={title}
      detail={shortPath(path)}
      chevron={false}
      onClick={reveal ? () => void reveal() : () => void editor.copyPath()}
      aria-label={reveal ? `${title}: show ${path} in ${FILE_MANAGER}` : `${title}: copy ${path}`}
      data-testid="chat-glance-machine"
    />
  );
}

/** Open in the default editor; the chevron chooses another (the header's Open, as a line). */
function EditorLine() {
  const editor = useEditorActions();
  if (!editor.target) return null;
  const current = editor.preferred?.id ?? FALLBACK_EDITOR;
  const name = editor.preferred?.name ?? 'VS Code';
  return (
    <div className="flex items-start" data-testid="chat-glance-editor">
      <SummaryLine
        icon="file"
        glyph={<EditorMark editor={current} className="size-3.5 shrink-0" />}
        title={`Open in ${name}`}
        chevron={false}
        onClick={() => editor.open(current)}
        className="flex-1"
      />
      <EditorChoiceMenu
        editor={editor}
        current={current}
        trigger={<IconButton size="sm" icon="chevron-down" label="Choose an editor" className="mt-1 mr-1 shrink-0" />}
      />
    </div>
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
    repo && !repo.isRepo ? 'not a git repository' : undefined,
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
      detail={stats.files > 0 ? 'Review and commit in Changes' : 'Everything is committed'}
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
