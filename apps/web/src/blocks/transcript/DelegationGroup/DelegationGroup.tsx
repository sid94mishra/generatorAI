// ────────────────────────────────────────────────────────────────
// B-22 DelegationGroup — two or more background workers an orchestrator turn
// spawned, as one header and indented sub-rows:
//
//   ○ Delegated 4 tasks — 1 running · 1 done · 1 failed · 1 queued   Open in dock
//       (BF) Update builder snapshot tests                  ✓ Done   Open
//
// Counts come from each worker's live status (its `background_task` block,
// nested under the spawn call by `parentCallId`); they update as the workers
// report. Glyph + word per row (D-18).
// ────────────────────────────────────────────────────────────────

import { Link as RouterLink } from 'react-router';
import type { TimelineStep } from '@generatorai/client-core';
import type { StatusState } from '@generatorai/shared';
import { TRANSCRIPT_COPY } from '@generatorai/shared/ui-contract';
import { Avatar } from '@/ui/primitives/Avatar/Avatar.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { Icon } from '@/ui/icons/Icon.js';
import { taskTitle } from '../taskTitle.js';

export interface DelegatedTask {
  id: string;
  title: string;
  state: StatusState;
  /** The worker's own chat, when known. */
  chatId?: string;
}

/** Map a delegation step (and its nested Worker step) to a sub-row. */
export function delegationTasks(steps: readonly TimelineStep[]): DelegatedTask[] {
  return steps.map((step) => {
    const worker = step.children?.find((c) => c.verb === 'Worker');
    const status = worker?.status ?? step.status;
    const state: StatusState =
      status === 'running'
        ? 'running'
        : status === 'failed'
          ? 'failed'
          : status === 'waiting'
            ? 'needs_you'
            : status === 'pending'
              ? 'queued'
              : 'succeeded';
    const chatId = worker?.workerChatId ?? step.workerChatId;
    const name = worker?.target || step.target;
    return { id: step.id, title: name ? taskTitle(name) : step.verb, state, ...(chatId ? { chatId } : {}) };
  });
}

const COUNT_ORDER: readonly StatusState[] = ['running', 'needs_you', 'succeeded', 'failed', 'queued'];
const COUNT_WORD: Partial<Record<StatusState, string>> = {
  running: 'running',
  needs_you: 'needs you',
  succeeded: 'done',
  failed: 'failed',
  queued: 'queued',
};

/** "1 running · 1 needs you · 1 done · 1 queued" — only the states present. */
export function delegationSummary(tasks: readonly DelegatedTask[]): string {
  const counts = new Map<StatusState, number>();
  for (const t of tasks) counts.set(t.state, (counts.get(t.state) ?? 0) + 1);
  return COUNT_ORDER.flatMap((state) => {
    const n = counts.get(state);
    return n ? [`${n} ${COUNT_WORD[state]}`] : [];
  }).join(' · ');
}

export interface DelegationGroupProps {
  tasks: readonly DelegatedTask[];
  /** Focus the Tasks dock tab; omitted → no "Open in dock". */
  onOpenInDock?: () => void;
}

/** A delegation header with one sub-row per worker. */
export function DelegationGroup({ tasks, onOpenInDock }: DelegationGroupProps) {
  const running = tasks.some((t) => t.state === 'running');
  return (
    <div className="flex min-w-0 flex-col" data-testid="delegation-group" data-gai-block="delegation">
      <div className="flex h-step min-w-0 items-center gap-2.5 pl-0.5 text-ui">
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Icon concept="agents" size={16} className={running ? 'text-run' : 'text-fg-3'} />
        </span>
        <span className="shrink-0 font-medium text-fg">{TRANSCRIPT_COPY.delegated(tasks.length)}</span>
        <span className="min-w-0 truncate text-small text-fg-2">— {delegationSummary(tasks)}</span>
        {onOpenInDock ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onOpenInDock}>
            Open in dock
          </Button>
        ) : null}
      </div>
      <ul className="flex min-w-0 flex-col pl-6" aria-label="Delegated tasks">
        {tasks.map((task) => (
          <li key={task.id} className="flex h-step min-w-0 items-center gap-2 text-ui">
            <Avatar name={task.title} size={18} decorative />
            <span className="min-w-0 flex-1 truncate text-fg">{task.title}</span>
            <StatusBadge state={task.state} context="chat" className="shrink-0" />
            {task.chatId ? (
              <Link
                variant="muted"
                className="shrink-0 text-small"
                data-testid="step-worker-chat-link"
                aria-label={`${TRANSCRIPT_COPY.openWorkerChat}: ${task.title}`}
                render={<RouterLink to={`/chats/${task.chatId}`} />}
              >
                Open
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
