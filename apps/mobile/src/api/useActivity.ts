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
import { rankOperations, type Operation } from './activityRanking';
import { isActive, needsAttention } from '../components/runs/statusStyle';

export {
  filterOperations,
  rankOperations,
  type ActivityFilter,
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

  const operations = useMemo<Operation[]>(() => {
    const out: Operation[] = [];
    const runningChats = new Set(
      (health.data as HealthSnapshot | undefined)?.runningChatIds ?? [],
    );

    for (const chat of (chats.data as ChatSummary[] | undefined) ?? []) {
      if (isArchived(chat)) continue;
      out.push({
        id: `chat:${chat.id}`,
        kind: 'chat',
        name: chat.name,
        // The chat entity has no live turn status; the health snapshot is the
        // authoritative "is it streaming right now" signal.
        status: runningChats.has(chat.id) ? 'running' : chat.status,
        // Normalised at the boundary: the wire value is an ISO string, and
        // every downstream comparison here is arithmetic.
        updatedAt: toEpochMs(chat.updatedAt) ?? 0,
        href: `/chats/${chat.id}`,
        blocked: false,
        running: runningChats.has(chat.id),
      });
    }

    for (const run of (runs.data as WorkflowRunSummary[] | undefined) ?? []) {
      out.push({
        id: `run:${run.id}`,
        kind: 'run',
        name: run.name ?? 'Workflow run',
        status: run.status,
        updatedAt: toEpochMs(run.updatedAt) ?? 0,
        href: `/runs/${run.id}`,
        blocked: needsAttention(run.status),
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
  }, [health.data, chats.data, runs.data, automations.data]);

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
    },
  };
}
