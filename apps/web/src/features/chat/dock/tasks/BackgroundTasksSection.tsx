// ────────────────────────────────────────────────────────────────
// "Background tasks" — the redesign's Tasks-panel section (F-dock-06,
// DockTasks board). The worker chats an orchestrator spawned: live status,
// what each is doing now, its digest, Cancel with an inline confirm and the
// G-20 attribution ("Cancelled · by you at 14:09").
//
// Rendered only from data the API has (D-36): no wave, worker limit, review
// round maximum, brief or step rail — those wait for the DTO fields in
// 05-gap-matrix (F-dock-06). "Needs you" asks come from the attention feed
// (worker chats roll up to this orchestrator via `parent`).
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { resolveStatus, type AttentionItem, type BackgroundTaskListItem } from '@generatorai/shared';
import { taskDetailSteps, taskReviewLine, type BackgroundTaskBlock } from '@generatorai/client-core';
import {
  useBackgroundTaskDetail,
  useBackgroundTaskDigest,
  useBackgroundTasks,
  useCancelBackgroundTask,
} from '@/hooks/queries.js';
import { StepList } from '@/blocks/transcript/StepRow/StepList.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';
import { useAttention } from '@/hooks/attentionQueries.js';
import { useStreamStore } from '@/stores/streamStore.js';
import { Avatar } from '@/ui/primitives/Avatar/Avatar.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Count } from '@/ui/primitives/Count/Count.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { SegmentedControl, type SegmentedItem } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { focusRing } from '@/ui/lib/focus.js';
import type { TasksSectionContext } from './tasksSections.js';
import {
  bucketTasks,
  canCancelTask,
  cancelledLine,
  filterTasks,
  formatElapsed,
  progressSegments,
  type SegmentTone,
  type TaskFilter,
} from './backgroundTasksModel.js';

const SEGMENT_CLASS: Record<SegmentTone, string> = {
  warn: 'border-warn',
  run: 'border-run',
  line: 'border-line-strong',
  ok: 'border-ok',
  err: 'border-err',
  muted: 'border-line',
};
const DOT_CLASS: Record<SegmentTone, string> = {
  warn: 'bg-warn',
  run: 'bg-run',
  line: 'bg-fg-3',
  ok: 'bg-ok',
  err: 'bg-err',
  muted: 'bg-line',
};

/** Live progress per worker, folded from the orchestrator's own stream (no polling of worker chats). */
function useLiveTaskBlocks(sessionId: string | undefined): Map<string, BackgroundTaskBlock> {
  const blocks = useStreamStore((state) => (sessionId ? state.streams[sessionId]?.blocks : undefined));
  return useMemo(() => {
    const map = new Map<string, BackgroundTaskBlock>();
    for (const b of blocks ?? []) if (b.type === 'background_task') map.set(b.taskId, b);
    return map;
  }, [blocks]);
}

/** Ticks once a second while `on`, so elapsed times move. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [on]);
  return now;
}

function elapsedOf(block: BackgroundTaskBlock | undefined, now: number): string | null {
  if (!block?.startedAt) return null;
  return formatElapsed((block.endedAt ?? now) - block.startedAt);
}

function TaskStatus({ status }: { status: BackgroundTaskListItem['status'] }) {
  const resolved = resolveStatus('backgroundTask', status);
  return resolved ? <StatusBadge state={resolved.state} label={resolved.label} /> : null;
}

function LiveStep({ block }: { block: BackgroundTaskBlock | undefined }) {
  if (!block || (block.status !== 'running' && block.status !== 'spawned')) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-small text-fg-2" data-testid="bg-task-live">
      <Spinner size={12} className="text-run" />
      <span className="shrink-0 text-fg">{block.currentStep ?? 'starting'}</span>
      {block.toolCalls > 0 ? (
        <span className="shrink-0 text-fg-3">
          · {block.toolCalls} tool{block.toolCalls === 1 ? '' : 's'}
        </span>
      ) : null}
      {block.lastText ? <span className="min-w-0 truncate font-mono text-fg-3">{block.lastText}</span> : null}
    </div>
  );
}

function TaskMeta({ task, showModel = true }: { task: BackgroundTaskListItem; showModel?: boolean }) {
  const parts: string[] = [];
  if (task.reviewRounds > 0) parts.push(`${task.reviewRounds} review round${task.reviewRounds === 1 ? '' : 's'}`);
  const cancelled = task.status === 'cancelled' ? cancelledLine(task) : null;
  if (cancelled) parts.push(cancelled);
  const model = showModel ? task.model : undefined;
  if (!model && parts.length === 0) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-small text-fg-3">
      {model ? <span className="truncate font-mono">{model}</span> : null}
      {parts.map((p, i) => (
        <span key={p} className="shrink-0">
          {model || i > 0 ? '· ' : ''}
          {p}
        </span>
      ))}
    </div>
  );
}

function activateOnKey(event: KeyboardEvent, run: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    run();
  }
}

function TaskRow({
  task,
  block,
  now,
  onOpen,
  onCancel,
  cancelling,
}: {
  task: BackgroundTaskListItem;
  block: BackgroundTaskBlock | undefined;
  now: number;
  onOpen: () => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const elapsed = elapsedOf(block, now);

  if (confirming && canCancelTask(task.status)) {
    return (
      <li className="flex flex-col gap-2 bg-sunken px-3 py-3" data-testid="bg-task-cancel-confirm">
        <div className="flex items-center gap-2">
          <Avatar name={task.taskName} size={24} decorative />
          <span className="min-w-0 truncate text-ui font-medium text-fg">Cancel “{task.taskName}”?</span>
        </div>
        <div className="flex items-center gap-2 pl-8">
          <span className="min-w-0 flex-1 text-small text-fg-3">Edits so far stay in the workspace.</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep running
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={cancelling}
            onClick={() => {
              onCancel();
              setConfirming(false);
            }}
          >
            Cancel task
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="group flex items-start gap-2 px-3 py-2.5 hover:bg-hover">
      <Avatar name={task.taskName} size={24} decorative className="mt-0.5" />
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open task ${task.taskName}`}
        onClick={onOpen}
        onKeyDown={(e) => activateOnKey(e, onOpen)}
        className={cn('flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-control', focusRing)}
      >
        <span className="truncate text-ui font-medium text-fg">{task.taskName}</span>
        <TaskMeta task={task} />
        <LiveStep block={block} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <TaskStatus status={task.status} />
        {elapsed ? <Count>{elapsed}</Count> : null}
        {canCancelTask(task.status) ? (
          <IconButton icon="x" size="sm" label={`Cancel ${task.taskName}`} onClick={() => setConfirming(true)} />
        ) : (
          <IconButton icon="chevron-right" size="sm" label={`Details for ${task.taskName}`} onClick={onOpen} />
        )}
      </div>
    </li>
  );
}

function AskCard({ item, now }: { item: AttentionItem; now: number }) {
  const navigate = useNavigate();
  const since = Date.parse(item.since);
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-raised p-3" data-testid="bg-task-ask">
      <div className="flex items-center gap-2">
        <Icon concept="hand" size={14} className="text-warn" />
        <span className="min-w-0 flex-1 truncate text-ui font-semibold text-fg">{item.title} asks</span>
        {Number.isFinite(since) ? <Count>waiting {formatElapsed(now - since)}</Count> : null}
      </div>
      {item.ask ? <p className="text-ui text-fg">{item.ask.summary}</p> : null}
      {item.ask?.detail ? <p className="text-small break-words text-fg-2">{item.ask.detail}</p> : null}
      <div className="flex justify-end">
        <Button size="sm" variant="primary" onClick={() => navigate(item.href)}>
          {item.ask?.actions.includes('answer') ? 'Answer' : 'Open task chat'}
        </Button>
      </div>
    </div>
  );
}

interface Digest {
  status?: string;
  summary?: string;
  keyFindings?: string[];
  artifacts?: Array<{ path: string; kind?: string }>;
  risks?: string[];
  openQuestions?: string[];
}

function DigestList({ title, items, tone }: { title: string; items: string[] | undefined; tone?: 'warn' }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-small font-medium text-fg-3">{title}</div>
      <ul className="flex flex-col gap-1">
        {items.map((text, i) => (
          <li key={i} className="flex items-start gap-1.5 text-ui text-fg-2">
            {tone === 'warn' ? <Icon concept="warning" size={14} className="mt-0.5 text-warn" /> : <span aria-hidden>·</span>}
            <span className="min-w-0 break-words">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TaskDetail({
  chatId,
  task,
  block,
  now,
  onBack,
  onCancel,
  cancelling,
}: {
  chatId: string;
  task: BackgroundTaskListItem;
  block: BackgroundTaskBlock | undefined;
  now: number;
  onBack: () => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const navigate = useNavigate();
  const { data, isLoading } = useBackgroundTaskDigest(chatId, task.taskId);
  const digest = data as Digest | undefined;
  // D-89: the brief, the orchestrator's review and the worker's latest steps (board DockTasks).
  const working = task.status === 'spawned' || task.status === 'running' || task.status === 'needs_review';
  const { data: detail } = useBackgroundTaskDetail(chatId, task.taskId, working);
  const lastSteps = useMemo(() => (detail ? taskDetailSteps(detail) : []), [detail]);
  const reviewLine = detail ? taskReviewLine(detail) : undefined;
  const elapsed = elapsedOf(block, now);
  const hasResult =
    !!digest &&
    (!!digest.summary ||
      !!digest.keyFindings?.length ||
      !!digest.artifacts?.length ||
      !!digest.risks?.length ||
      !!digest.openQuestions?.length);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="bg-task-detail">
      <div className="flex shrink-0 items-center px-2 pt-2">
        <Button size="sm" variant="ghost" icon="back" onClick={onBack}>
          All tasks
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pt-2 pb-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Avatar name={task.taskName} size={24} decorative />
            <h3 className="min-w-0 truncate text-title text-fg">{task.taskName}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-8">
            <TaskStatus status={task.status} />
            {task.model ? <span className="font-mono text-small text-fg-3">{task.model}</span> : null}
            {elapsed ? <Count>{elapsed}</Count> : null}
          </div>
          <div className="pl-8">
            <TaskMeta task={task} showModel={false} />
            <LiveStep block={block} />
          </div>
        </div>

        {reviewLine ? (
          <section
            className="flex flex-col gap-1.5 rounded-card border border-line-soft bg-sunken px-3 py-2"
            aria-label="Review"
            data-testid="bg-task-review"
          >
            <p className="flex items-center gap-2 text-ui text-fg">
              <Icon concept={detail?.outcome === 'accepted' ? 'check' : 'view'} size={14} className="shrink-0 text-fg-3" />
              <span className="min-w-0">{reviewLine}</span>
            </p>
            {detail?.rounds.map((r) => (
              <p key={r.round} className="pl-5.5 text-small break-words text-fg-2">
                Round {r.round} asked for: {firstLine(r.request)}
              </p>
            ))}
          </section>
        ) : null}

        {detail?.brief ? (
          <section className="flex flex-col gap-2" aria-label="Brief" data-testid="bg-task-brief">
            <SectionHeader title="Brief" hint="what the orchestrator asked" level={4} />
            <Markdown size="compact">{detail.brief.objective ?? detail.brief.text}</Markdown>
            {detail.brief.boundaries ? (
              <p className="text-small break-words text-fg-3">Out of scope: {detail.brief.boundaries}</p>
            ) : null}
          </section>
        ) : null}

        {lastSteps.length > 0 ? (
          <section className="flex flex-col gap-2" aria-label="Last steps" data-testid="bg-task-last-steps">
            <SectionHeader title="Last steps" level={4} />
            <StepList steps={lastSteps} label="Last steps" />
          </section>
        ) : null}

        <section className="flex flex-col gap-2" aria-label="Result">
          <SectionHeader title="Result" hint="from the task’s digest" level={4} />
          {isLoading ? (
            <Spinner size={14} label="Loading the digest" />
          ) : hasResult ? (
            <div className="flex flex-col gap-3">
              {digest?.summary ? <p className="text-ui break-words whitespace-pre-wrap text-fg">{digest.summary}</p> : null}
              <DigestList title="Key findings" items={digest?.keyFindings} />
              {digest?.artifacts && digest.artifacts.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {digest.artifacts.map((a) => (
                    <li key={a.path} className="flex items-center gap-2 text-small">
                      <Icon concept="file" size={14} className="text-fg-3" />
                      <span className="min-w-0 flex-1 truncate font-mono text-fg-2">{a.path}</span>
                      {a.kind ? <span className="shrink-0 font-mono text-fg-3">{a.kind}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <DigestList title="Risks" items={digest?.risks} tone="warn" />
              <DigestList title="Open questions" items={digest?.openQuestions} />
            </div>
          ) : (
            <p className="text-small text-fg-3">No result yet. The worker writes its digest when it settles.</p>
          )}
        </section>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line-soft px-3 py-2">
        <Button size="sm" icon="message" onClick={() => navigate(`/chats/${task.taskId}`)}>
          Open task chat
        </Button>
        {canCancelTask(task.status) ? (
          <Button size="sm" variant="danger-ghost" className="ml-auto" loading={cancelling} onClick={onCancel}>
            Cancel task
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The first line of a follow-up request, for the review round list. */
function firstLine(text: string): string {
  const line = text.trim().split('\n').find((l) => l.trim()) ?? '';
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

export function BackgroundTasksSection({ chatId, chat, stacked }: TasksSectionContext) {
  const { data, isLoading } = useBackgroundTasks(chatId);
  const cancelTask = useCancelBackgroundTask(chatId);
  const live = useLiveTaskBlocks(chat.sessionId);
  const attention = useAttention();
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const buckets = useMemo(() => bucketTasks(tasks), [tasks]);
  const asks = useMemo(
    () =>
      (attention.data?.needsYou ?? []).filter((item) => item.parent?.id === chatId && item.ask !== undefined),
    [attention.data, chatId],
  );
  const segments = useMemo(() => progressSegments(buckets, asks.length), [buckets, asks.length]);
  const now = useNow(buckets.running > 0 || asks.length > 0);
  const shown = useMemo(() => filterTasks(tasks, filter), [tasks, filter]);
  const openTask = openTaskId ? tasks.find((t) => t.taskId === openTaskId) : undefined;

  const cancel = (taskId: string) => cancelTask.mutate(taskId);
  const cancellingId = cancelTask.isPending ? cancelTask.variables : undefined;

  if (openTask) {
    return (
      <TaskDetail
        chatId={chatId}
        task={openTask}
        block={live.get(openTask.taskId)}
        now={now}
        onBack={() => setOpenTaskId(null)}
        onCancel={() => cancel(openTask.taskId)}
        cancelling={cancellingId === openTask.taskId}
      />
    );
  }

  if (tasks.length === 0) {
    return isLoading ? (
      <div className="flex flex-1 items-center justify-center p-6">
        <Spinner size={16} label="Loading background tasks" />
      </div>
    ) : (
      <EmptyState
        icon="tasks"
        title="No background tasks"
        description="The orchestrator starts them when it splits the work. Each one runs as its own chat."
        className="flex-1 px-6 py-8"
      />
    );
  }

  const filterItems: SegmentedItem<TaskFilter>[] = [
    { value: 'all', label: 'All', count: buckets.total },
    { value: 'active', label: 'Active', count: buckets.active },
    { value: 'done', label: 'Done', count: buckets.done },
  ];

  return (
    <div className={cn('flex min-h-0 flex-col', !stacked && 'h-full')}>
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 pb-2">
        {stacked ? null : (
          <SectionHeader title="Background tasks" level={3} hint={`${buckets.total} task${buckets.total === 1 ? '' : 's'}`} />
        )}
        {segments.length > 0 ? (
          <>
            <div className="flex gap-0.5" aria-hidden>
              {segments.map((s) => (
                <span
                  key={s.key}
                  className={cn('min-w-2 rounded-badge border-t-4', SEGMENT_CLASS[s.tone])}
                  // Computed geometry: each segment's share of the bar.
                  style={{ flexGrow: s.count }}
                />
              ))}
            </div>
            <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Task progress">
              {segments.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5 text-small text-fg-2">
                  <span className={cn('size-1.5 rounded-full', DOT_CLASS[s.tone])} aria-hidden />
                  {s.count} {s.label}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <SegmentedControl label="Show tasks" value={filter} onValueChange={setFilter} items={filterItems} className="self-start" />
      </div>
      <div className={cn('flex flex-col', !stacked && 'min-h-0 flex-1 overflow-y-auto')}>
        {asks.length > 0 ? (
          <div className="flex flex-col gap-2 px-3 pb-2">
            {asks.map((item) => (
              <AskCard key={item.key} item={item} now={now} />
            ))}
          </div>
        ) : null}
        {shown.length === 0 ? (
          <p className="px-3 py-4 text-small text-fg-3">{filter === 'active' ? 'No active tasks.' : 'No finished tasks yet.'}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft border-t border-line-soft">
            {shown.map((task) => (
              <TaskRow
                key={task.taskId}
                task={task}
                block={live.get(task.taskId)}
                now={now}
                onOpen={() => setOpenTaskId(task.taskId)}
                onCancel={() => cancel(task.taskId)}
                cancelling={cancellingId === task.taskId}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The registry hook for this section: the number of tasks, once known. */
export function useBackgroundTasksCount({ chatId }: TasksSectionContext): number | undefined {
  return useBackgroundTasks(chatId).data?.tasks.length;
}
