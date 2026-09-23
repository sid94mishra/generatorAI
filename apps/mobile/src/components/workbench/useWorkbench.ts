// Gathers what the workbench index needs to describe each tool. Every query
// here is one the tools themselves already make (same keys), so the index
// warms their caches rather than adding traffic, and polling only runs while
// the index or a tool is actually open (`live`).

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';

import { useApi } from '../../api/useApi';
import { useAuth } from '../../auth/AuthProvider';
import { checkFeature } from '../../auth/featureGate';
import { useCapability } from '../review/useScopes';
import { scmKeys } from '../scm/api';
import { useScmApi } from '../scm/useScmApi';
import { useChangesSummary } from '../chat/panes/useChangesSummary';
import { COMPUTER_SCOPE, computerFeature } from '../chat/panes/paneModel';
import { computerConsentKey } from '../chat/panes/ComputerPane';
import type { PendingConsent } from '../chat/panes/computerModel';
import type { TasksSummary } from '../chat/panes/useTasksSummary';
import { workbenchBadge, workbenchTools, type ToolDescriptor, type WorkbenchInput } from './workbenchModel';

export interface UseWorkbenchInput {
  surface: 'chat' | 'run';
  workspaceId: string | null;
  chatId?: string | null;
  scopes: readonly string[];
  orchestrator?: boolean;
  tasksSummary?: TasksSummary;
  model?: string | null;
  contextPercent?: number | null;
  /** The index or a tool is on screen: poll the live bits. */
  live: boolean;
}

export interface WorkbenchState {
  tools: ToolDescriptor[];
  badge: ReturnType<typeof workbenchBadge>;
}

export function useWorkbench(input: UseWorkbenchInput): WorkbenchState {
  const { surface, workspaceId, chatId, scopes, live } = input;
  const api = useApi();
  const scm = useScmApi();
  const { fetch: authFetch } = useAuth();
  const commitCap = useCapability('commit');

  const terminal = checkFeature('terminal', scopes);
  const browser = checkFeature('browser', scopes);

  const changes = useChangesSummary(workspaceId);

  const readiness = useQuery({
    queryKey: scmKeys.readiness(workspaceId ?? ''),
    queryFn: () => scm.readiness(workspaceId!),
    // A git status on the host: only worth asking once the index or a tool is
    // on screen. The header badge never needs it (it reads the change count).
    enabled: Boolean(workspaceId) && commitCap.available && live,
    staleTime: 15_000,
    retry: false,
  });

  const browserDescriptor = useQuery<{ ready?: boolean; currentUrl?: string | null }>({
    queryKey: ['workspaces', workspaceId, 'browser', 'descriptor'] as const,
    queryFn: async () => {
      const response = await authFetch(`/api/workspaces/${workspaceId}/browser/descriptor`);
      if (!response.ok) throw new Error(String(response.status));
      return (await response.json()) as { ready?: boolean; currentUrl?: string | null };
    },
    enabled: Boolean(workspaceId) && browser.available && live,
    refetchInterval: live ? 5_000 : false,
    staleTime: 5_000,
  });

  const computerUse = useQuery({
    queryKey: ['computer-use-settings'],
    queryFn: async () => {
      const res = await authFetch('/api/system/computer-use');
      if (!res.ok) return { enabled: false };
      return (await res.json()) as { enabled: boolean };
    },
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
  const computerEnabled = computerUse.data?.enabled === true;
  const holdsComputer = scopes.includes(COMPUTER_SCOPE);

  const computerConsent = useQuery({
    queryKey: computerConsentKey(workspaceId),
    queryFn: async () => {
      const res = await authFetch(`/api/workspaces/${workspaceId}/computer/consent`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { pending?: PendingConsent[] };
    },
    enabled: Boolean(workspaceId) && computerEnabled && holdsComputer,
    refetchInterval: live ? 5_000 : 20_000,
  });
  const computerNeedsAnswer = (computerConsent.data?.pending ?? []).some((p) => p.expiresAt > Date.now());

  const plans = useQuery({
    queryKey: queryKeys.chatPlans(chatId ?? ''),
    queryFn: () => api.chats.plans(chatId!),
    enabled: surface === 'chat' && Boolean(chatId),
  });

  const tools = useMemo(() => {
    const summary = changes.data;
    const firstPaths: string[] = [];
    for (const repo of summary?.repos ?? []) {
      for (const file of repo.files) {
        if (firstPaths.length < 2) firstPaths.push(file.path);
      }
    }
    const repos = readiness.data?.repos ?? [];
    const repo = repos.find((r) => r.isRepo) ?? null;
    const latestPlan =
      plans.data?.find((p) => p.status === 'awaiting_review') ?? plans.data?.[plans.data.length - 1];

    const model: WorkbenchInput = {
      surface,
      workspaceId,
      ...(summary
        ? {
            changes: {
              files: summary.stats.files,
              additions: summary.stats.additions,
              deletions: summary.stats.deletions,
              firstPaths,
            },
          }
        : {}),
      ...(repo
        ? {
            scm: {
              branch: repo.branch,
              detached: repo.detached,
              ahead: repo.ahead,
              behind: repo.behind,
              openPullRequest: repo.openPullRequest ? { number: repo.openPullRequest.number } : null,
              conflicts: repos.reduce((n, r) => n + r.conflictedFiles.length, 0),
              repoCount: repos.filter((r) => r.isRepo).length,
            },
          }
        : {}),
      ...(input.tasksSummary
        ? {
            tasks: {
              orchestrator: input.orchestrator === true,
              total: input.tasksSummary.total,
              running: input.tasksSummary.running,
            },
          }
        : {}),
      ...(latestPlan ? { plan: { title: latestPlan.title, status: latestPlan.status } } : {}),
      browser: {
        ready: browserDescriptor.data?.ready === true,
        url: browserDescriptor.data?.currentUrl ?? null,
      },
      terminalLocked: !terminal.available,
      browserLocked: !browser.available,
      computer: {
        enabled: computerEnabled,
        locked: !computerFeature(scopes).available,
        needsAnswer: computerNeedsAnswer,
      },
      session: { model: input.model ?? null, contextPercent: input.contextPercent ?? null },
    };
    return workbenchTools(model);
  }, [
    surface, workspaceId, changes.data, readiness.data, plans.data, browserDescriptor.data,
    terminal.available, browser.available, computerEnabled, computerNeedsAnswer, scopes,
    input.tasksSummary, input.orchestrator, input.model, input.contextPercent,
  ]);

  return useMemo(() => ({ tools, badge: workbenchBadge(tools) }), [tools]);
}
