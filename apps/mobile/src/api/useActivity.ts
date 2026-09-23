// ────────────────────────────────────────────────────────────────
// Activity feed — the merged operations stream.
//
// The web dashboard builds this from three independent queries and folds them
// into one list. Mobile does the same; the ordering RULE itself lives in
// `activityRanking.ts` so it can be tested without React Native in the runner
// (this module transitively imports the auth provider, which imports
// `react-native`, whose Flow-typed entry point vitest cannot parse).
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  isArchived,
  queryKeys,
  toEpochMs,
  type AutomationSummary,
  type ChatSummary,
  type HealthSnapshot,
  type WorkflowRunSummary,
} from '@generatorai/client-core';

import { useApi } from './useApi';
import {
  hasPendingGate,
  primaryGate,
  rankOperations,
  selectGateCandidates,
  type GateInfo,
  type Operation,
} from './activityRanking';
import { isActive, needsAttention } from '../components/runs/statusStyle';

export {
  filterOperations,
  rankOperations,
  selectGateCandidates,
  hasPendingGate,
  gateFromInteraction,
  primaryGate,
  groupApprovals,
  needsYouCount,
  GATE_PROBE_LIMIT,
  type ActivityFilter,
  type ApprovalGroups,
  type GateInfo,
  type GateKind,
  type Operation,
  type OperationKind,
} from './activityRanking';

export function useActivity() {
  const api = useApi();

  const results = useQueries({
    queries: [
      {
        queryKey: queryKeys.health(),
        queryFn: () => api.health(),
        refetchInterval: 10_000,
      },
      {
        queryKey: queryKeys.chats(),
        queryFn: () => api.chats.list({ limit: 50 }),
      },
      {
        queryKey: queryKeys.runs(),
        queryFn: () => api.runs.list(),
        refetchInterval: 15_000,
      },
      {
        queryKey: queryKeys.automations(),
        queryFn: () => api.automations.list(),
        refetchInterval: 30_000,
      },
    ],
  });

  const [health, chats, runs, automations] = results;

  const runningChatIds = (health.data as HealthSnapshot | undefined)?.runningChatIds;
  const chatRows = chats.data as ChatSummary[] | undefined;

  /**
   * D10 — chats parked on a gate (tool permission, question, plan review).
   *
   * Nothing list-level says so: `ChatSummary.status` is active/archived and
   * the health snapshot only knows what is streaming. The pending-gate source
   * is per chat (`api.chats.interactions`, which the server answers from
   * `listPendingByChat`), so a bounded, ordered set of chats is probed. The
   * query key is the one the chat screen invalidates on interaction events,
   * so answering a gate anywhere clears the badge here without a poll.
   */
  const gateCandidates = useMemo(
    () => selectGateCandidates(chatRows ?? [], runningChatIds ?? []),
    [chatRows, runningChatIds],
  );
  const gates = useQueries({
    queries: gateCandidates.map((chatId) => ({
      queryKey: queryKeys.chatInteractions(chatId),
      queryFn: () => api.chats.interactions(chatId),
      refetchInterval: 15_000,
      staleTime: 10_000,
    })),
  });
  // A string rather than the `gates` array: `useQueries` hands back a new
  // array every render, which would defeat the memo below.
  const gatedKey = gateCandidates
    .filter((_, index) => hasPendingGate(gates[index]?.data))
    .join(',');

  // The gate itself (kind, tool name, plan id) for the Home queue and the
  // approvals sheet. Serialised for the same reason as `gatedKey`: a card's
  // label must change exactly when its gate does, not on every poll.
  const gateInfoKey = gateCandidates
    .map((chatId, index) => {
      const gate = primaryGate(gates[index]?.data);
      return gate ? `${chatId}\t${JSON.stringify(gate)}` : '';
    })
    .filter(Boolean)
    .join('\n');

  const operations = useMemo<Operation[]>(() => {
    const out: Operation[] = [];
    const runningChats = new Set(runningChatIds ?? []);
    const gatedChats = new Set(gatedKey.split(',').filter(Boolean));
    const gateByChat = new Map<string, GateInfo>();
    for (const line of gateInfoKey.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab <= 0) continue;
      try {
        gateByChat.set(line.slice(0, tab), JSON.parse(line.slice(tab + 1)) as GateInfo);
      } catch {
        // A malformed line only loses the card's label, never the card.
      }
    }

    for (const chat of chatRows ?? []) {
      if (isArchived(chat)) continue;
      const running = runningChats.has(chat.id);
      const gated = gatedChats.has(chat.id);
      out.push({
        id: `chat:${chat.id}`,
        kind: 'chat',
        name: chat.name,
        // The chat entity has no live turn status; the health snapshot is the
        // authoritative "is it streaming right now" signal, and an open gate
        // outranks it — `awaiting_input` is what the run surfaces already
        // label "Needs you".
        status: gated ? 'awaiting_input' : running ? 'running' : chat.status,
        // Normalised at the boundary: the wire value is an ISO string, and
        // every downstream comparison here is arithmetic.
        updatedAt: toEpochMs(chat.updatedAt) ?? 0,
        href: `/chats/${chat.id}`,
        blocked: gated,
        running,
        ...(gated && gateByChat.has(chat.id) ? { gate: gateByChat.get(chat.id)! } : {}),
      });
    }

    const runList = (runs.data as WorkflowRunSummary[] | undefined) ?? [];
    // A failed run that was retried has been dealt with; the retry is the
    // one to watch. Without this, every retried failure stayed on Home's
    // "Waiting for you" for good.
    const retried = new Set(runList.map((run) => run.ancestorRunId).filter((id): id is string => Boolean(id)));
    for (const run of runList) {
      out.push({
        id: `run:${run.id}`,
        kind: 'run',
        name: run.name ?? 'Workflow run',
        status: run.status,
        updatedAt: toEpochMs(run.updatedAt) ?? 0,
        href: `/runs/${run.id}`,
        blocked: needsAttention(run.status) && !retried.has(run.id),
        running: isActive(run.status),
      });
    }

    for (const automation of (automations.data as AutomationSummary[] | undefined) ?? []) {
      out.push({
        id: `automation:${automation.id}`,
        kind: 'automation',
        name: automation.name,
        status: automation.enabled ? 'enabled' : 'disabled',
        updatedAt: toEpochMs(automation.lastRunAt ?? automation.createdAt) ?? 0,
        href: `/automations/${automation.id}`,
        blocked: false,
        running: false,
      });
    }

    return rankOperations(out);
  }, [runningChatIds, chatRows, gatedKey, gateInfoKey, runs.data, automations.data]);

  return {
    operations,
    health: health.data as HealthSnapshot | undefined,
    counts: {
      chats: ((chats.data as ChatSummary[] | undefined) ?? []).filter((c) => !isArchived(c)).length,
      runs: ((runs.data as WorkflowRunSummary[] | undefined) ?? []).length,
      automations: ((automations.data as AutomationSummary[] | undefined) ?? []).length,
      attention: operations.filter((op) => op.blocked).length,
      running: operations.filter((op) => op.running).length,
    },
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    isFetching: results.some((r) => r.isFetching),
    refetch: () => {
      for (const result of results) void result.refetch();
      for (const gate of gates) void gate.refetch();
    },
  };
}
