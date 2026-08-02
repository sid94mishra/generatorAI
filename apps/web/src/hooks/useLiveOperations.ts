// ────────────────────────────────────────────────────────────────
// useLiveOperations — the data spine of the mission-control dashboard.
// Merges the three "execution objects" (chats, workflow runs, automation
// executions) into three views:
//   • today     — everything with activity today, newest first (top 20)
//   • running   — ONLY what's executing right now (streaming chats,
//                 running runs, running automation executions)
//   • attention — anything that failed, or is waiting on a human
//                 (approval / paused / awaiting_input)
// Running chats are detected via the server's in-flight registry
// (health.runningChatIds) — a chat "active" status only means "not
// archived", not "currently generating".
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useChats, useHealth } from './queries.js';
import { useWorkflowDefinitions, useWorkflowRuns } from './workflowQueries.js';
import { useAutomations, useLatestAutomationExecutions } from './automationQueries.js';

export type LiveKind = 'chat' | 'run' | 'automation';

export interface LiveItem {
  key: string;
  kind: LiveKind;
  /** Primary entity id (chatId / runId / executionId). */
  id: string;
  name: string;
  /** Status string understood by <StatusBadge>. */
  status: string;
  /** Epoch ms used for ordering + elapsed display. */
  ts: number;
  /** Navigation target when the row is clicked. */
  href: string;
  /** Whether the item is actively executing (drives the live ticker). */
  live: boolean;
  // ── action context ──
  runId?: string;
  automationId?: string;
  executionId?: string;
}

const RUN_RUNNING = new Set(['running', 'starting', 'cancelling']);
const RUN_ATTENTION = new Set(['failed', 'paused', 'awaiting_input']);
const EXEC_RUNNING = new Set(['running', 'pending']);

function isToday(ts: number): boolean {
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export interface LiveOperations {
  today: LiveItem[];
  running: LiveItem[];
  attention: LiveItem[];
  isLoading: boolean;
}

/** Compose live chats / runs / automation executions into the dashboard model. */
export function useLiveOperations(): LiveOperations {
  const { data: chats, isLoading: chatsLoading } = useChats();
  const { data: definitions } = useWorkflowDefinitions();
  const { data: runs, isLoading: runsLoading } = useWorkflowRuns();
  const { data: automations, isLoading: autosLoading } = useAutomations();
  const { data: health } = useHealth();
  const execs = useLatestAutomationExecutions(automations ?? []);

  const defNameById = useMemo(() => {
    const m = new Map<string, string>();
    (definitions ?? []).forEach((d) => m.set(d.id, d.name));
    return m;
  }, [definitions]);

  const runningChatIds = useMemo(
    () => new Set(health?.runningChatIds ?? []),
    [health?.runningChatIds],
  );

  return useMemo(() => {
    const running: LiveItem[] = [];
    const attention: LiveItem[] = [];
    const today: LiveItem[] = [];

    const pushToday = (item: LiveItem) => {
      if (isToday(item.ts)) today.push(item);
    };

    // ── Workflow runs ──
    (runs ?? []).forEach((r) => {
      const name = defNameById.get(r.workflowDefinitionId) ?? `Run ${r.id.slice(0, 8)}`;
      const href = `/workflows/${r.workflowDefinitionId}/runs/${r.id}`;
      const base: Omit<LiveItem, 'ts' | 'live'> = {
        key: `run-${r.id}`, kind: 'run', id: r.id, name, status: r.status, href, runId: r.id,
      };
      if (RUN_RUNNING.has(r.status)) {
        running.push({ ...base, ts: new Date(r.startedAt ?? r.updatedAt).getTime(), live: true });
      } else if (RUN_ATTENTION.has(r.status)) {
        attention.push({ ...base, ts: new Date(r.updatedAt).getTime(), live: false });
      }
      pushToday({ ...base, ts: new Date(r.updatedAt).getTime(), live: RUN_RUNNING.has(r.status) });
    });

    // ── Automation executions (latest per automation) ──
    [
      ...execs.byStatus(['running', 'pending']),
      ...execs.byStatus(['failed', 'completed', 'cancelled']),
    ].forEach((e) => {
      const base: Omit<LiveItem, 'ts' | 'live'> = {
        key: `exec-${e.id}`, kind: 'automation', id: e.id, name: e.automationName, status: e.status,
        href: `/automations/${e.automationId}`, automationId: e.automationId, executionId: e.id,
      };
      const isRunning = EXEC_RUNNING.has(e.status);
      const ts = new Date(e.startedAt ?? e.completedAt ?? e.createdAt).getTime();
      if (isRunning) running.push({ ...base, ts, live: true });
      else if (e.status === 'failed') attention.push({ ...base, ts, live: false });
      pushToday({ ...base, ts, live: isRunning });
    });

    // ── Chats ──
    (chats ?? [])
      .filter((c) => c.status === 'active')
      .forEach((c) => {
        const isRunning = runningChatIds.has(c.id);
        const base: Omit<LiveItem, 'ts' | 'live'> = {
          key: `chat-${c.id}`, kind: 'chat', id: c.id, name: c.name,
          status: isRunning ? 'running' : 'active', href: `/chats/${c.id}`,
        };
        const ts = new Date(c.updatedAt).getTime();
        if (isRunning) running.push({ ...base, ts, live: true });
        pushToday({ ...base, ts, live: isRunning });
      });

    // Ordering: live first, then newest.
    const byLiveThenTime = (a: LiveItem, b: LiveItem) =>
      Number(b.live) - Number(a.live) || b.ts - a.ts;
    running.sort(byLiveThenTime);
    attention.sort((a, b) => b.ts - a.ts);
    today.sort((a, b) => b.ts - a.ts);

    return {
      today: today.slice(0, 20),
      running,
      attention,
      isLoading: chatsLoading || runsLoading || autosLoading || execs.isLoading,
    };
  }, [runs, chats, defNameById, execs, runningChatIds, chatsLoading, runsLoading, autosLoading]);
}
