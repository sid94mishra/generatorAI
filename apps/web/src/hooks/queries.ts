// ────────────────────────────────────────────────────────────────
// TanStack Query hooks — sessions, workflows, chat, templates, artifacts
// ────────────────────────────────────────────────────────────────

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';
import type { CreateSessionParams, CreateChatParams } from '@generatorai/shared';
import type { AgentMode, PlanAction } from '@generatorai/shared';
import type { HttpPlatformClient, ChatModel } from '../platform/HttpPlatformClient.js';
import { toast } from '../components/Toast.js';

// ── Query Keys ──
export const queryKeys = {
  sessions: ['sessions'] as const,
  session: (id: string) => ['session', id] as const,
  workflows: (sessionId: string) => ['workflows', sessionId] as const,
  chatHistory: (sessionId: string) => ['chat', sessionId] as const,
  templates: ['templates'] as const,
  artifacts: (sessionId: string) => ['artifacts', sessionId] as const,
  models: ['copilot-models'] as const,
  copilotState: ['copilot-state'] as const,
  // v2 Chat keys
  chats: ['chats'] as const,
  chat: (id: string) => ['chat-entity', id] as const,
  chatMessages: (chatId: string) => ['chat-messages', chatId] as const,
};

// ── Query Hooks ──

export function useSessions() {
  const platform = usePlatform();
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => platform.getSessions(),
    refetchInterval: 30_000,
  });
}

export function useSession(sessionId: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: queryKeys.session(sessionId ?? ''),
    queryFn: () => platform.getSession(sessionId!),
    enabled: !!sessionId,
    // Reduce polling for terminal states — SSE events handle active session updates.
    // Only poll as a safety net for active sessions.
    refetchInterval: (query) => {
      const session = query.state.data;
      if (session && ['completed', 'cancelled', 'deleted'].includes(session.status)) {
        return false; // No polling for terminal states
      }
      return 30_000; // Safety-net polling for active sessions (SSE is primary)
    },
  });
}

export function useWorkflows(sessionId: string | undefined, opts?: { refetchInterval?: number | false }) {
  const platform = usePlatform();
  return useQuery({
    queryKey: queryKeys.workflows(sessionId ?? ''),
    queryFn: () => platform.getWorkflows(sessionId!),
    enabled: !!sessionId,
    // Default: SSE events handle workflow invalidation, so no polling.
    // Callers can pass a specific interval if needed.
    refetchInterval: opts?.refetchInterval ?? false,
  });
}

export function useChatHistory(sessionId: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: queryKeys.chatHistory(sessionId ?? ''),
    queryFn: () => platform.getChatHistory(sessionId!),
    enabled: !!sessionId,
    refetchInterval: false,
  });
}

/** Chat history filtered by stageRunId (for per-stage display in single-session workflows) */
export function useStageChatHistory(sessionId: string | undefined, stageRunId?: string) {
  const platform = usePlatform();
  return useQuery({
    queryKey: [...queryKeys.chatHistory(sessionId ?? ''), stageRunId] as const,
    queryFn: () => platform.getChatHistory(sessionId!, undefined, undefined, stageRunId),
    enabled: !!sessionId,
    refetchInterval: false,
  });
}

export function useTemplates() {
  const platform = usePlatform();
  return useQuery({
    queryKey: queryKeys.templates,
    queryFn: () => platform.getWorkflowTemplates(),
    staleTime: Infinity,
  });
}

export function useArtifacts(sessionId: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: queryKeys.artifacts(sessionId ?? ''),
    queryFn: () => platform.getArtifacts(sessionId!),
    enabled: !!sessionId,
  });
}

/**
 * The model catalog, derived from the single `/api/harness/providers` fetch.
 *
 * This deliberately shares `useHarnessProviders`' query key rather than
 * calling `/api/harness/models` separately. Both endpoints go through
 * `HarnessRegistry.refresh()`, which spawns each provider's CLI on a cold
 * probe, so having the composer and the picker each fetch their own copy
 * meant two round trips (and two cold probes) every time a chat opened.
 * One cache entry, one request, both consumers stay in sync.
 */
/**
 * How often to re-ask while the server is still probing in the background.
 *
 * The server now answers instantly from its disk cache after a restart rather
 * than blocking for the length of a cold probe, which is what kept the
 * composer behind a skeleton for ~22 s. The trade is that the first answer can
 * be last-known-good, so we poll at a low rate until `stale` clears and the
 * catalog converges on the live one. Polling STOPS as soon as it does.
 */
const HARNESS_PROVIDERS_STALE_POLL_MS = 3_000;

export function useModels() {
  return useQuery({
    queryKey: ['harness-providers'] as const,
    queryFn: fetchHarnessProviders,
    staleTime: 60_000 * 5,
    refetchOnWindowFocus: false,
    // Same key as `useHarnessProviders`, so keep the same convergence
    // behaviour: while the server reports a background re-probe, poll until it
    // lands. Without this the composer would render from the disk-cached
    // catalog and then hold it for the full 5-minute staleTime.
    refetchInterval: (query) => (query.state.data?.stale ? HARNESS_PROVIDERS_STALE_POLL_MS : false),
    select: (data): ChatModel[] =>
      data.providers
        .filter((p) => p.ready)
        .flatMap((p) => p.models.map((m) => ({ ...m, provider: m.provider ?? p.type }))),
  });
}

/** Active harness/agent provider ('copilot' | 'claude-agent'). */
export function useHarnessConfig() {
  const platform = usePlatform();
  return useQuery({
    queryKey: ['harness-config'] as const,
    queryFn: () => (platform as HttpPlatformClient).getHarnessConfig(),
    staleTime: 60_000 * 10,
  });
}

/** Live readiness + model catalog for every agent provider this build knows. */
export interface HarnessProviderInfo {
  type: string;
  label: string;
  installed: boolean;
  connected: boolean;
  authenticated: boolean;
  /** Usable right now — the provider answered with a live catalog. */
  ready: boolean;
  error?: string;
  checkedAt?: number;
  modelCount: number;
  models: ChatModel[];
}

/**
 * Every provider's live status + catalog.
 *
 * A cold probe spawns each provider's CLI, so this is cached generously and
 * never refetched on window focus; the picker exposes an explicit refresh.
 * `useModels` reads the same cache entry so a chat open costs one request.
 */
export interface HarnessProvidersResponse {
  primary: string;
  providers: HarnessProviderInfo[];
  /**
   * The server served a cached snapshot and is re-probing in the background.
   * Absent on older servers, which always answered from a blocking probe.
   */
  stale?: boolean;
}

async function fetchHarnessProviders(): Promise<HarnessProvidersResponse> {
  const res = await fetch('/api/harness/providers');
  if (!res.ok) throw new Error(`Failed to load providers (${res.status})`);
  return res.json() as Promise<HarnessProvidersResponse>;
}

export function useHarnessProviders() {
  return useQuery({
    queryKey: ['harness-providers'] as const,
    queryFn: fetchHarnessProviders,
    staleTime: 60_000 * 5,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.stale ? HARNESS_PROVIDERS_STALE_POLL_MS : false),
  });
}

export function useCopilotState() {
  const platform = usePlatform();
  return useQuery({
    queryKey: queryKeys.copilotState,
    queryFn: () => platform.getCopilotState(),
    refetchInterval: 10_000,
  });
}

/**
 * System health snapshot — polled every 5s to drive the dashboard heartbeat
 * card. A successful fetch means the server is reachable ("connected"); a
 * failed fetch flips the connection indicator to "disconnected". Keeps the
 * last good value so counts don't flicker between polls.
 */
export function useHealth() {
  const platform = usePlatform();
  return useQuery({
    queryKey: ['system-health'] as const,
    queryFn: () => (platform as HttpPlatformClient).getHealth(),
    refetchInterval: 5_000,
    retry: false,
    // Keep showing the last good snapshot while a poll is in flight/failing.
    placeholderData: (prev) => prev,
  });
}

// ── Mutation Hooks ──

export function useCreateSession() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateSessionParams) => platform.createSession(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}

export function useStartSession() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => platform.startSession(sessionId),
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
    },
  });
}

export function usePauseSession() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => platform.pauseSession(sessionId),
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
    },
  });
}

export function useResumeSession() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => platform.resumeSession(sessionId),
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
    },
  });
}

export function useCancelSession() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => platform.cancelSession(sessionId),
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
    },
  });
}

export function useDeleteSession() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => platform.deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}

export function useSendPrompt(sessionId: string) {
  const platform = usePlatform();

  return useMutation({
    mutationFn: (params: { prompt: string; attachments?: File[] }) => {
      const client = platform as HttpPlatformClient;
      if (params.attachments?.length && 'sendPromptWithFiles' in client) {
        return client.sendPromptWithFiles(sessionId, params.prompt, params.attachments);
      }
      return platform.sendPrompt(sessionId, params.prompt);
    },
    // NOTE: No onSuccess chatHistory invalidation here.
    // The server route is fire-and-forget: the HTTP 202 returns BEFORE the
    // server saves the user message to the DB.  Invalidating here would
    // trigger a premature refetch that returns stale data, causing the
    // display to flash.  SSE events (copilot.user_message, copilot.idle,
    // copilot.message_complete) handle chatHistory invalidation at the
    // correct points when the data is actually persisted.
  });
}

export function usePauseWorkflow() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { workflowId: string; sessionId: string }) =>
      platform.pauseWorkflow(args.workflowId),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workflows(args.sessionId) });
    },
  });
}

export function useResumeWorkflow() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { workflowId: string; sessionId: string }) =>
      platform.resumeWorkflow(args.workflowId),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workflows(args.sessionId) });
    },
  });
}

export function useDownloadArtifact() {
  const platform = usePlatform();

  return useMutation({
    mutationFn: async (artifactId: string) => {
      const result = await platform.downloadArtifact(artifactId);
      // Trigger browser download
      const blob = new Blob([result.data as unknown as BlobPart], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Delay revocation so the browser has time to initiate the download
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
      return result;
    },
  });
}

// ════════════════════════════════════════════════════════════════
// v2: Chat Operations — first-class Chat entity hooks
// ════════════════════════════════════════════════════════════════

/** List all chats, optionally filtered by status */
export function useChats(statusFilter?: 'active' | 'archived') {
  const platform = usePlatform();
  return useQuery({
    queryKey: [...queryKeys.chats, statusFilter ?? 'all'],
    queryFn: async () => {
      const all = await platform.listChats(statusFilter ? { status: statusFilter } : undefined);
      // Hide orchestrator WORKER chats (they have a parentChatId) from the main
      // list — they live in the parent orchestrator's Background Tasks panel.
      return all.filter((c) => !(c as { parentChatId?: string }).parentChatId);
    },
    refetchInterval: 30_000,
  });
}

/** Get a single chat by ID */
export function useChat(chatId: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: queryKeys.chat(chatId ?? ''),
    queryFn: () => platform.getChat(chatId!),
    enabled: !!chatId,
  });
}

/**
 * Get chat message history (v2 — by chatId).
 *
 * P0#5 — request a bounded page (latest `limit` messages) instead of the whole
 * history. Previously this fetched every message, freezing the tab on long
 * chats. The server returns the most recent page when no offset is given; live
 * messages continue to arrive via SSE. `limit` is overridable for callers that
 * want a larger window.
 *
 * P0-48 fix: default raised from 50 → 100. The old default of 50 was lower
 * than the virtualization threshold (80), making messages 51-80 permanently
 * unreachable through the UI — a correctness bug disguised as a performance
 * optimization. Callers that call with a `limit` prop (e.g. ChatPage's
 * "Load more" pagination) still override the default.
 */
export function useChatMessages(chatId: string | undefined, limit = 100) {
  const platform = usePlatform();
  return useQuery({
    queryKey: [...queryKeys.chatMessages(chatId ?? ''), limit],
    queryFn: () => platform.getChatMessages(chatId!, limit),
    enabled: !!chatId,
    refetchInterval: false,
  });
}

/** Fetch workspace files for a chat (by workspaceId) */
export function useChatWorkspaceFiles(workspaceId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: ['workspace-files', workspaceId ?? ''],
    queryFn: () => platform.getWorkspaceFiles(workspaceId!),
    enabled: !!workspaceId,
    refetchInterval: 10_000,
  });
}

/** Fetch a single file's content from a workspace */
export function useWorkspaceFileContent(
  workspaceId: string | undefined,
  filePath: string | undefined,
  source: 'workspace' | 'artifacts' | 'source' | 'worktree',
  worktreeAlias?: string,
) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: ['workspace-file-content', workspaceId, filePath, source, worktreeAlias],
    queryFn: () => platform.getWorkspaceFileContent(workspaceId!, filePath!, source, worktreeAlias),
    enabled: !!workspaceId && !!filePath,
    staleTime: 60_000,
  });
}

/**
 * v2 change summary — per-file metadata only. This is the single source of
 * truth for "what changed?" in the UI.
 *
 * `base` / `head` accept: 'baseline' | 'working' | 'checkpoint:<id>' |
 * 'turn:<turnId>' | 'stage:<stageRunId>' | 'ref:<rev>'.
 *
 * No polling: the Changes panel is invalidated by the `workspace.changed`
 * SSE event instead, so an idle workspace costs zero requests.
 */
export function useWorkspaceChangeSummary(
  workspaceId: string | undefined,
  options: { base?: string; head?: string; alias?: string; includeTree?: boolean } = {},
  enabled = true,
) {
  const platform = usePlatform() as HttpPlatformClient;
  const { base = 'baseline', head = 'working', alias, includeTree } = options;
  return useQuery({
    queryKey: [
      'workspace-change-summary',
      workspaceId ?? '',
      base,
      head,
      alias ?? '',
      includeTree ? 'tree' : '',
    ],
    queryFn: () =>
      platform.getWorkspaceChangeSummary(workspaceId!, {
        base,
        head,
        ...(alias ? { alias } : {}),
        ...(includeTree ? { includeTree: true } : {}),
      }),
    enabled: !!workspaceId && enabled,
    staleTime: 5_000,
  });
}

/**
 * Both versions of one changed file. Keyed by the blob pair so the entry is
 * reused across panel re-opens, and never refetched while the content is
 * unchanged.
 */
export function useWorkspaceChangeFile(
  workspaceId: string | undefined,
  filePath: string | undefined,
  options: { alias?: string; base?: string; head?: string } = {},
  enabled = true,
) {
  const platform = usePlatform() as HttpPlatformClient;
  const { alias = '.', base = 'baseline', head = 'working' } = options;
  return useQuery({
    queryKey: ['workspace-change-file', workspaceId ?? '', alias, filePath ?? '', base, head],
    queryFn: () =>
      platform.getWorkspaceChangeFile(workspaceId!, filePath!, { alias, base, head }),
    enabled: !!workspaceId && !!filePath && enabled,
    staleTime: 30_000,
  });
}

/** Unified patch for one file (fallback when the bodies are too large). */
export function useWorkspaceChangeFilePatch(
  workspaceId: string | undefined,
  filePath: string | undefined,
  options: { alias?: string; base?: string; head?: string } = {},
  enabled = true,
) {
  const platform = usePlatform() as HttpPlatformClient;
  const { alias = '.', base = 'baseline', head = 'working' } = options;
  return useQuery({
    queryKey: ['workspace-change-patch', workspaceId ?? '', alias, filePath ?? '', base, head],
    queryFn: () =>
      platform.getWorkspaceChangeFilePatch(workspaceId!, filePath!, { alias, base, head }),
    enabled: !!workspaceId && !!filePath && enabled,
    staleTime: 30_000,
  });
}

// ── Workspace file tree (browsing, not diffing) ──

/**
 * Every browsable path in the workspace, grouped by repo.
 *
 * Kept apart from the change summary on purpose. The path list only moves
 * when files are created or deleted, so toggling "all files" vs "changed
 * only" — or switching the diff base — never refetches it, and the diff
 * queries never refetch the tree.
 */
export function useWorkspaceTree(
  workspaceId: string | undefined,
  options: { alias?: string } = {},
  enabled = true,
) {
  const platform = usePlatform() as HttpPlatformClient;
  const { alias } = options;
  return useQuery({
    queryKey: ['workspace-tree', workspaceId ?? '', alias ?? ''],
    queryFn: () => platform.getWorkspaceTree(workspaceId!, alias ? { alias } : {}),
    enabled: !!workspaceId && enabled,
    staleTime: 15_000,
  });
}

/**
 * One file's current content. Works for any tracked path, not just files
 * that appear in a diff — which is the whole point of the Files view.
 *
 * The key carries the path only; the server ETags on mtime+size so a
 * refetch after an agent write is a cheap 304 when nothing actually moved.
 */
export function useWorkspaceTreeFile(
  workspaceId: string | undefined,
  filePath: string | undefined,
  options: { alias?: string } = {},
  enabled = true,
) {
  const platform = usePlatform() as HttpPlatformClient;
  const { alias = '.' } = options;
  return useQuery({
    queryKey: ['workspace-tree-file', workspaceId ?? '', alias, filePath ?? ''],
    queryFn: () => platform.getWorkspaceTreeFile(workspaceId!, filePath!, { alias }),
    enabled: !!workspaceId && !!filePath && enabled,
    staleTime: 15_000,
  });
}

// ── Checkpoints (snapshots / rewind) ──

/** Checkpoint timeline for the rewind picker and the baseline selector. */
export function useWorkspaceCheckpoints(
  workspaceId: string | undefined,
  options: { alias?: string; includeLive?: boolean; limit?: number } = {},
  enabled = true,
) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: ['workspace-checkpoints', workspaceId ?? '', options.alias ?? ''],
    queryFn: () => platform.listWorkspaceCheckpoints(workspaceId!, options),
    enabled: !!workspaceId && enabled,
    staleTime: 5_000,
  });
}

/** Create a user-initiated checkpoint. */
export function useCreateWorkspaceCheckpoint(workspaceId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (label?: string) => platform.createWorkspaceCheckpoint(workspaceId!, label),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-checkpoints', workspaceId] });
    },
  });
}

/**
 * Restore the workspace to a checkpoint. Invalidates every change query
 * because the working tree just moved underneath them.
 */
export function useRestoreWorkspaceCheckpoint(workspaceId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { checkpointId: string; paths?: string[] }) =>
      platform.restoreWorkspaceCheckpoint(workspaceId!, params.checkpointId, params.paths),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-change-summary', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['workspace-change-file', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['workspace-change-patch', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['workspace-checkpoints', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['workspace-files', workspaceId] });
    },
  });
}

/**
 * Legacy v1 change set (full diffs inline). Retained so the old
 * ChangesPanel keeps working until the renderer swap lands.
 */
export function useWorkspaceChanges(workspaceId: string | undefined, enabled = true) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: ['workspace-changes', workspaceId ?? ''],
    queryFn: () => platform.getWorkspaceChanges(workspaceId!),
    enabled: !!workspaceId && enabled,
    refetchInterval: 10_000,
  });
}

/** Old-vs-new content for a single changed file. */
export function useWorkspaceChangeContent(
  workspaceId: string | undefined,
  filePath: string | undefined,
  alias = '.',
) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: ['workspace-change-content', workspaceId, filePath, alias],
    queryFn: () => platform.getWorkspaceChangeContent(workspaceId!, filePath!, alias),
    enabled: !!workspaceId && !!filePath,
    staleTime: 30_000,
  });
}

/** Source-control provider config (active provider + GitHub settings). */
export function useSourceControlConfig() {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: ['source-control-config'],
    queryFn: () => platform.getSourceControlConfig(),
    staleTime: 30_000,
  });
}

/** Update source-control provider config. */
export function useUpdateSourceControlConfig() {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: {
      activeProvider?: 'github' | 'none';
      github?: { token?: string | null; host?: string | null; defaultBase?: string | null };
    }) => platform.updateSourceControlConfig(update),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['source-control-config'] });
      void queryClient.invalidateQueries({ queryKey: ['source-control-status'] });
    },
  });
}

/** Whether the active source-control provider is usable. */
export function useSourceControlStatus() {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: ['source-control-status'],
    queryFn: () => platform.getSourceControlStatus(),
    staleTime: 30_000,
  });
}

/** Create a pull request for a workspace repo. */
export function useCreateWorkspacePullRequest(workspaceId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; body?: string; base?: string; head?: string; alias?: string; draft?: boolean }) =>
      platform.createWorkspacePullRequest(workspaceId!, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-pull-requests', workspaceId] });
    },
  });
}

/** List pull requests for a workspace repo. */
export function useWorkspacePullRequests(workspaceId: string | undefined, alias = '.', enabled = true) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: ['workspace-pull-requests', workspaceId ?? '', alias],
    queryFn: () => platform.listWorkspacePullRequests(workspaceId!, alias),
    enabled: !!workspaceId && enabled,
    staleTime: 15_000,
  });
}

/** Commit all workspace changes. */
export function useCommitWorkspaceChanges(workspaceId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message?: string) => platform.commitWorkspaceChanges(workspaceId!, message),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-changes', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['workspace-change-summary', workspaceId] });
    },
  });
}

/** Create a new chat */
export function useCreateChat() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateChatParams) => platform.createChat(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });
}

/** Update chat metadata (model, gitRepositories) */
export function useUpdateChat(chatId: string) {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updates: Parameters<typeof platform.updateChat>[1]) =>
      platform.updateChat(chatId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId) });
    },
  });
}

// ── Orchestrator background tasks ──

export const backgroundTasksKeys = {
  list: (chatId: string) => ['background-tasks', chatId] as const,
  detail: (chatId: string, taskId: string) => ['background-tasks', chatId, taskId] as const,
};

/** Poll the list of background worker tasks spawned by an orchestrator chat. */
export function useBackgroundTasks(chatId: string | undefined, enabled = true) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: backgroundTasksKeys.list(chatId ?? ''),
    queryFn: () => platform.getBackgroundTasks(chatId!),
    enabled: !!chatId && enabled,
    refetchInterval: 2500,
  });
}

/** Poll the compact digest for one background worker task. */
export function useBackgroundTaskDigest(chatId: string | undefined, taskId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: backgroundTasksKeys.detail(chatId ?? '', taskId ?? ''),
    queryFn: () => platform.getBackgroundTaskDigest(chatId!, taskId!),
    enabled: !!chatId && !!taskId,
    refetchInterval: 3000,
  });
}

/** Send a prompt to a v2 Chat */
export function useSendChatPrompt(chatId: string) {
  const platform = usePlatform();

  return useMutation({
    // PLN-01 — `mode` selects the per-turn agent mode from the composer.
    mutationFn: (params: { prompt: string; attachments?: File[]; mode?: AgentMode }) => {
      const client = platform as HttpPlatformClient;
      // v2 chat prompt endpoint — uses chatId, not sessionId
      if (params.attachments?.length && 'sendChatPromptWithFiles' in client) {
        return client.sendChatPromptWithFiles(
          chatId,
          params.prompt,
          params.attachments,
          params.mode,
        );
      }
      return platform.sendChatPrompt(chatId, params.prompt, undefined, params.mode);
    },
    // Fire-and-forget: SSE events handle chatMessages invalidation
  });
}

// ── PLN-01: plan mode ──

/** Plan documents for a chat (newest first). */
export function usePlans(chatId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: ['chat', chatId, 'plans'],
    queryFn: () => platform.getChatPlans(chatId!),
    enabled: !!chatId,
  });
}

/** A single plan with all its revisions and comments. */
export function usePlan(chatId: string | undefined, planId: string | undefined) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: ['chat', chatId, 'plan', planId],
    queryFn: () => platform.getChatPlan(chatId!, planId!),
    enabled: !!chatId && !!planId,
  });
}

/**
 * Human gates still awaiting a response.
 *
 * Polled while the tab is open so a card reappears after a reload even when
 * the SSE replay window has moved on. The blocking promise lives server-side,
 * so nothing depends on the browser staying connected.
 */
export function usePendingInteractions(chatId: string | undefined, enabled = true) {
  const platform = usePlatform() as HttpPlatformClient;
  return useQuery({
    queryKey: ['chat', chatId, 'interactions'],
    queryFn: () => platform.getChatInteractions(chatId!),
    enabled: !!chatId && enabled,
    refetchInterval: enabled ? 5000 : false,
  });
}

/** Record an approve / request-changes decision on a plan. */
export function useDecidePlan(chatId: string) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      planId: string;
      approved: boolean;
      action?: PlanAction;
      feedback?: string;
      useEditedContent?: boolean;
      expectedRevision?: number;
    }) => {
      const { planId, ...decision } = params;
      return platform.decideChatPlan(chatId, planId, decision);
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['chat', chatId, 'plans'] });
      void queryClient.invalidateQueries({ queryKey: ['chat', chatId, 'plan', variables.planId] });
      void queryClient.invalidateQueries({ queryKey: ['chat', chatId, 'interactions'] });
    },
    onError: (error, variables) => {
      // A 409 means the gate is gone — expired by a restart, resolved from
      // another tab, or timed out. Clicking used to fail silently and leave
      // an approvable-looking card (observed live after a mid-review server
      // crash). Tell the user, and refetch so the stale card reconciles.
      toast({
        variant: 'error',
        title: 'Plan decision failed',
        description:
          error instanceof Error && /409|conflict/i.test(error.message)
            ? 'This plan is no longer awaiting review — it may have expired or been decided elsewhere.'
            : error instanceof Error
              ? error.message
              : 'The plan decision could not be recorded.',
      });
      void queryClient.invalidateQueries({ queryKey: ['chat', chatId, 'plans'] });
      void queryClient.invalidateQueries({ queryKey: ['chat', chatId, 'plan', variables.planId] });
      void queryClient.invalidateQueries({ queryKey: ['chat', chatId, 'interactions'] });
    },
  });
}

/** Save a user edit as a new plan revision. */
export function useUpdatePlanContent(chatId: string) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      planId: string;
      content: string;
      summary?: string;
      expectedRevision: number;
    }) => {
      const { planId, ...body } = params;
      return platform.updateChatPlanContent(chatId, planId, body);
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['chat', chatId, 'plan', variables.planId] });
      void queryClient.invalidateQueries({ queryKey: ['chat', chatId, 'plans'] });
    },
  });
}

/** Add an inline review comment to a plan. */
export function useAddPlanComment(chatId: string) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      planId: string;
      body: string;
      revision: number;
      anchor?: { startLine: number; endLine: number; quotedText: string; contentHash: string };
    }) => {
      const { planId, ...body } = params;
      return platform.addChatPlanComment(chatId, planId, body);
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['chat', chatId, 'plan', variables.planId] });
    },
  });
}

/** Answer an agent-authored clarifying question. */
export function useAnswerQuestion(chatId: string) {
  const platform = usePlatform() as HttpPlatformClient;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      interactionId: string;
      answers: Record<string, string[]>;
      freeformResponse?: string;
    }) => {
      const { interactionId, ...response } = params;
      return platform.respondToChatInteraction(chatId, interactionId, response);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['chat', chatId, 'interactions'] });
    },
  });
}

/** Promote an approved plan into the tracked working tree. */
export function useSavePlanToWorkspace(chatId: string) {
  const platform = usePlatform() as HttpPlatformClient;
  return useMutation({
    mutationFn: (planId: string) => platform.savePlanToWorkspace(chatId, planId),
  });
}

/** Archive (soft delete) a chat */
export function useArchiveChat() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (chatId: string) => platform.archiveChat(chatId),
    onSuccess: (_data, chatId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
      // Also refresh the specific chat so the open page reflects the archived
      // status immediately (banner + disabled input), not just the list.
      queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId) });
    },
  });
}

/** Stop the in-flight turn for a chat */
export function useCancelChat() {
  const platform = usePlatform();

  return useMutation({
    mutationFn: (chatId: string) => (platform as HttpPlatformClient).cancelChat(chatId),
  });
}

/** Delete a single chat (calls deleteChat on platform client) */
export function useDeleteChat() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (chatId: string) => platform.deleteChat(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });
}

/**
 * Bulk-delete multiple chats in parallel.
 * Calls the single-delete endpoint for each ID and invalidates
 * the chats cache once after all deletions complete.
 */
export function useBulkDeleteChats() {
  const platform = usePlatform();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (chatIds: string[]) => {
      const results = await Promise.allSettled(
        chatIds.map((id) => platform.deleteChat(id)),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        throw new Error(`Failed to delete ${failed.length} of ${chatIds.length} chats`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
    onError: () => {
      // Still refresh — some deletions may have succeeded
      queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });
}
