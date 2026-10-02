// MB-42 data: the facts behind the pane's tabs (changed files, background tasks, the plan, computer consent) and
// the claim a chat or run screen makes. Every query shares its key with the tab body that shows the same data, so
// the counts and the bodies refresh together (the stream's `workspace` invalidation reaches them all).
import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, queryKeys, type ChangeSummary } from '@generatorai/client-core';
import type { BackgroundTaskListItem } from '@generatorai/shared';

import { useAdminApi } from '../../services/api/useAdminApi';
import { useApi } from '../../services/api/useApi';
import { useAuth } from '../../services/auth/AuthProvider';
import { ACTIVE_TASK_STATUSES, paneTabs, type PaneTabEntry } from './paneFacts';
import type { MobilePaneTab } from './paneRegistry';
import { usePaneStore, type PaneClaim } from './paneStore';
import { useClaimPaneScope } from './WorkspacePane';

/** The compare base the Changes tab opens on (and the toggle count reads). */
export const DEFAULT_CHANGES_BASE = 'baseline';

export const changesKey = (workspaceId: string, base: string = DEFAULT_CHANGES_BASE): readonly unknown[] => [...queryKeys.changes(workspaceId), base];
export const computerConsentKey = (workspaceId: string | null): readonly unknown[] => ['workspaces', workspaceId, 'computer', 'consent'];
export const COMPUTER_SCOPE = 'exec:computer';

/** The workspace's changes against a base (the summary every Changes surface reads). */
export function useChangesSummary(workspaceId: string | null, options: { base?: string; enabled?: boolean } = {}) {
  const api = useApi();
  const base = options.base ?? DEFAULT_CHANGES_BASE;
  return useQuery<ChangeSummary>({
    queryKey: changesKey(workspaceId ?? '', base),
    queryFn: () => api.workspaces.changes(workspaceId!, { base, head: 'working' }),
    enabled: Boolean(workspaceId) && (options.enabled ?? true),
    staleTime: 10_000,
  });
}

/** A chat's background workers; polls slowly while one is in flight and the Tasks tab (which polls itself) is not open. */
export function useBackgroundTasks(chatId: string | null, options: { poll?: boolean } = {}) {
  const api = useApi();
  const poll = options.poll ?? true;
  return useQuery({
    queryKey: queryKeys.chatTasks(chatId ?? ''),
    queryFn: () => api.chats.backgroundTasks(chatId!),
    enabled: Boolean(chatId),
    staleTime: 15_000,
    retry: false,
    refetchInterval: (query) =>
      poll && (query.state.data?.tasks ?? []).some((t: BackgroundTaskListItem) => ACTIVE_TASK_STATUSES.has(t.status)) ? 10_000 : false,
  });
}

export interface PaneTabsInput {
  kind: 'chat' | 'run';
  workspaceId: string | null;
  chatId?: string | null;
  scopes: readonly string[];
  /** An orchestrator chat shows Tasks before its first worker. */
  orchestrator?: boolean;
  /** The pane is on screen: poll the live bits. */
  live: boolean;
}

/** The tabs for a scope, with counts and needs-you dots. */
export function usePaneTabs(input: PaneTabsInput): PaneTabEntry[] {
  const { kind, workspaceId, chatId = null, scopes, orchestrator = false, live } = input;
  const api = useApi();
  const admin = useAdminApi();
  const changes = useChangesSummary(workspaceId);
  const tasks = useBackgroundTasks(kind === 'chat' ? chatId : null, { poll: !(live && usePaneStore.getState().active === 'tasks') });
  const plans = useQuery({ queryKey: queryKeys.chatPlans(chatId ?? ''), queryFn: () => api.chats.plans(chatId!), enabled: kind === 'chat' && Boolean(chatId) });
  const computerUse = useQuery({
    queryKey: ['computer-use-settings'],
    queryFn: () => api.system.computerUse().catch((error: unknown) => (error instanceof ApiError ? { enabled: false } : Promise.reject(error))),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
  const computerEnabled = computerUse.data?.enabled === true;
  const consent = useQuery({
    queryKey: computerConsentKey(workspaceId),
    queryFn: () => admin.computer.consent(encodeURIComponent(workspaceId!)),
    enabled: Boolean(workspaceId) && computerEnabled && scopes.includes(COMPUTER_SCOPE),
    refetchInterval: live ? 5_000 : 20_000,
    // An ask that expired no longer needs anyone (evaluated per fetch, not per render).
    select: (data) => (data.pending ?? []).some((p) => p.expiresAt > Date.now()),
  });
  const list = tasks.data?.tasks;
  const latestPlan = plans.data?.find((p) => p.status === 'awaiting_review') ?? plans.data?.[plans.data.length - 1];
  const changedFiles = changes.data?.stats.files;
  const needsAnswer = consent.data === true;
  return useMemo(
    () =>
      paneTabs({
        kind,
        ...(changedFiles !== undefined ? { changedFiles } : {}),
        tasks: {
          orchestrator,
          total: list?.length ?? 0,
          running: (list ?? []).filter((t: BackgroundTaskListItem) => ACTIVE_TASK_STATUSES.has(t.status)).length,
        },
        planStatus: latestPlan?.status ?? null,
        computer: { enabled: computerEnabled, needsAnswer },
      }),
    [kind, changedFiles, orchestrator, list, latestPlan?.status, computerEnabled, needsAnswer],
  );
}

export interface WorkspacePaneClaimInput extends PaneTabsInput {
  id: string | undefined;
  title: string;
  path: string;
  renderTab: (type: MobilePaneTab, ctx: { active: boolean }) => ReactNode;
}

/** A chat or run screen claims the pane with its tabs and the body renderer (MB-42). */
export function useWorkspacePaneClaim(input: WorkspacePaneClaimInput): void {
  const { serverId } = useAuth();
  const tabs = usePaneTabs(input);
  const { id, kind, title, path, renderTab } = input;
  const claim = useMemo<PaneClaim | null>(
    () => (id && serverId ? { scope: { serverId, kind, id }, title, path, tabs, renderTab } : null),
    [id, serverId, kind, title, path, tabs, renderTab],
  );
  useClaimPaneScope(claim);
}
