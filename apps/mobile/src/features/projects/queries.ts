// Projects data (M7-02): the list with summaries (G-13), a project and its codebases (polled while one clones), its
// chats (G-14), runs (G-15), pull requests (MG-22), codebase worktrees with sizes and links (G-17), fetch + logs
// (G-16), customization (system + project artifacts, MCP, the per-project prefs G-19), configs, remote branches before
// a clone (MG-11), the server folder browser (MG-22) and every project / codebase write.
import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  chatLiveSets,
  projectKeys,
  queryKeys,
  scmKeys,
  toChatRowModel,
  type ApiClient,
  type PullRequestListState,
} from '@generatorai/client-core';
import type { CodebaseLogsResponse, ProjectArtifactPrefs, ProjectConfig, WorktreeInfo, WorktreeListEnriched } from '@generatorai/shared';

import { chatRowView } from '../../blocks/ChatRow';
import { useAdminApi } from '../../services/api/useAdminApi';
import { useApi } from '../../services/api/useApi';
import type { MutationCallbacks } from '../../services/api/queryCallbacks';
import { useAttention } from '../../services/stream/AttentionProvider';
import { anyCloning, codebaseBodies, type CodebaseDraft, type CustomizationKind } from './model/projectsModel';

const enc = encodeURIComponent;

// ── Reads ───────────────────────────────────────────────────────

export function useProjects(options: { staleTime?: number } = {}) {
  const api = useApi();
  return useQuery({ queryKey: [...queryKeys.projects(), 'summary'], meta: { persist: true }, queryFn: () => api.projects.list({ includeSummary: true }), ...options });
}

export function useProject(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.project(id), 'summary'],
    meta: { persist: true },
    queryFn: () => api.projects.get(enc(id), { includeSummary: true }),
    enabled: Boolean(id),
    refetchInterval: (query) => (anyCloning(query.state.data?.codebases) ? 3_000 : false),
  });
}

export function useProjectAttention(id: string) {
  const attention = useAttention();
  return useMemo(() => attention.snapshot?.needsYou.filter((item) => item.project?.id === id) ?? [], [attention.snapshot, id]);
}

export function useProjectChats(id: string, enabled: boolean) {
  const api = useApi();
  const attention = useAttention();
  const result = useQuery({ queryKey: queryKeys.projectChats(id), queryFn: () => api.chats.list({ projectId: id, limit: 50, sort: 'activity' }), enabled });
  const live = useMemo(() => chatLiveSets(attention.snapshot), [attention.snapshot]);
  const rows = useMemo(() => (result.data?.items ?? []).map((item) => chatRowView(toChatRowModel(item, live))), [result.data, live]);
  return { ...result, rows, total: result.data?.counts.all };
}

export function useProjectRuns(id: string, enabled: boolean) {
  const api = useApi();
  const result = useInfiniteQuery({
    queryKey: [...queryKeys.project(id), 'runs'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.projects.runs(enc(id), { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  });
  const pages = result.data;
  const data = useMemo(() => {
    const rows = new Map<string, NonNullable<typeof pages>['pages'][number]['items'][number]>();
    for (const page of pages?.pages ?? []) for (const run of page.items) if (!rows.has(run.id)) rows.set(run.id, run);
    return pages ? [...rows.values()] : undefined;
  }, [pages]);
  return { ...result, data, total: result.data?.pages[0]?.total };
}

export function useProjectPullRequests(id: string, state: PullRequestListState, enabled = true) {
  const { scm } = useApi();
  return useQuery({ queryKey: scmKeys.projectPullRequests(id, state), queryFn: () => scm.projectPullRequests(id, state), staleTime: 30_000, enabled });
}

export function usePullRequest(id: string, cid: string, number: number) {
  const { scm } = useApi();
  return useQuery({ queryKey: scmKeys.pullRequest(id, cid, number), queryFn: () => scm.pullRequest(id, cid, number) });
}
export function usePullRequestFiles(id: string, cid: string, number: number, enabled: boolean) {
  const { scm } = useApi();
  return useQuery({ queryKey: scmKeys.pullRequestFiles(id, cid, number), queryFn: () => scm.pullRequestFiles(id, cid, number), enabled });
}
export function usePullRequestComments(id: string, cid: string, number: number, enabled: boolean) {
  const { scm } = useApi();
  return useQuery({ queryKey: scmKeys.pullRequestComments(id, cid, number), queryFn: () => scm.pullRequestComments(id, cid, number), enabled });
}

type ReviewResult = Awaited<ReturnType<ApiClient['scm']['reviewChat']>>;
export function useReviewPullRequest(id: string, cid: string, number: number, callbacks: MutationCallbacks<ReviewResult, string>) {
  const { scm } = useApi();
  return useMutation({ ...callbacks, mutationFn: (instructions: string) => scm.reviewChat(id, cid, number, instructions.trim() ? { instructions: instructions.trim() } : {}) });
}

/** G-17 — worktrees with sizes and the chat / run each one is checked out for. */
export function useCodebaseWorktrees(id: string, cid: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...projectKeys.worktrees(id, cid), 'enriched'],
    queryFn: async (): Promise<WorktreeListEnriched> => {
      const raw = await api.projects.codebaseWorktrees(enc(id), enc(cid), { include: ['usage', 'link'] });
      return Array.isArray(raw) ? { items: raw as WorktreeInfo[] } : raw;
    },
    enabled,
    // Sizes arrive after an async directory walk: look again shortly while some are unknown.
    refetchInterval: (query) => (query.state.data?.items.some((w) => w.sizeBytes === undefined) ? 5_000 : false),
  });
}

/** G-16 — the last clone / fetch log lines; polled every second while the job runs. */
export function useCodebaseLogs(id: string, cid: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.codebases(id), cid, 'logs'],
    queryFn: (): Promise<CodebaseLogsResponse> => api.projects.codebaseLogs(enc(id), enc(cid), { limit: 500 }),
    refetchInterval: (query) => (query.state.data?.job?.status === 'running' ? 1_000 : false),
  });
}

export function useCodebaseBranches(id: string, cid: string, enabled: boolean) {
  const admin = useAdminApi();
  return useQuery({ queryKey: queryKeys.codebaseBranches(id, cid), queryFn: () => admin.projects.codebases.branches(enc(id), enc(cid)), retry: false, enabled });
}

export function useCodebaseFiles(id: string, cid: string, path: string, enabled = true) {
  const admin = useAdminApi();
  return useQuery({ queryKey: projectKeys.files(id, cid, path), queryFn: () => admin.projects.codebases.files(enc(id), enc(cid), path || undefined), enabled });
}

export function useCodebaseFile(id: string, cid: string, path: string) {
  const admin = useAdminApi();
  return useQuery({ queryKey: projectKeys.fileContent(id, cid, path), queryFn: () => admin.projects.codebases.fileContent(enc(id), enc(cid), path), enabled: path.length > 0 });
}

/** MG-11 — the remote's branches before the codebase exists; 401/404/504 come back as the error. */
export function useRemoteRefs(url: string, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: ['source-control', 'remote-refs', url], queryFn: () => api.sourceControl.remoteRefs({ url }), enabled, retry: false, staleTime: 60_000 });
}

/** MG-22 — the server's folders (local / administrative sessions only; others get 403 → the S state). */
export function useServerDirs(path: string, enabled: boolean) {
  const admin = useAdminApi();
  return useQuery({ queryKey: ['fs', 'dirs', path], queryFn: () => admin.fs.dirs(path), enabled, retry: false });
}

export function useCustomization(id: string, kind: CustomizationKind, enabled: boolean) {
  const api = useApi();
  const admin = useAdminApi();
  const system = useQuery({
    queryKey: kind === 'mcp' ? ['system', 'mcp-servers'] : ['system', 'artifacts', kind],
    queryFn: async () =>
      kind === 'mcp'
        ? (await api.system.mcpServers()).map((m) => ({ id: m.id ?? m.name, type: 'mcp', name: m.name, ...(m.description ? { description: m.description } : {}) }))
        : await api.system.artifacts(kind),
    enabled,
    staleTime: 5 * 60_000,
  });
  const project = useQuery({
    queryKey: kind === 'mcp' ? projectKeys.mcpServers(id) : [...projectKeys.configs(id), kind],
    queryFn: async () =>
      kind === 'mcp'
        ? (await admin.projects.mcp.list(enc(id))).map((m) => ({ id: m.id ?? m.name, type: 'mcp', name: m.name, ...(m.description ? { description: m.description } : {}) }))
        : await admin.projects.configs.list(enc(id), kind),
    enabled,
  });
  return { system, project };
}

export function useArtifactPrefs(id: string, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: [...queryKeys.project(id), 'artifact-prefs'], queryFn: () => api.projects.artifactPrefs.get(enc(id)), enabled });
}

export function useProjectConfig(id: string, configId: string) {
  const admin = useAdminApi();
  const list = useQuery({ queryKey: [...projectKeys.configs(id), 'all'], queryFn: () => admin.projects.configs.list(enc(id)) });
  const content = useQuery({ queryKey: projectKeys.configContent(id, configId), queryFn: () => admin.projects.configs.content(id, configId) });
  const config = useMemo(() => list.data?.find((c) => c.id === configId) ?? null, [list.data, configId]);
  return { list, content, config };
}

// ── Writes ──────────────────────────────────────────────────────

function useInvalidateProject(id?: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.projects() });
    if (id) void client.invalidateQueries({ queryKey: queryKeys.project(id) });
  };
}

export interface CreateProjectInput {
  name: string;
  description: string;
  settings: { worktreeRetention: string; maxCodebases: number };
  codebases: readonly CodebaseDraft[];
}

/** Create, then link each codebase; a failed link is reported, the project stays (its codebase screen can retry). */
export function useCreateProject() {
  const admin = useAdminApi();
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: async (input: CreateProjectInput) => {
      const project = await admin.projects.create({
        name: input.name.trim(),
        ...(input.description.trim() ? { description: input.description.trim() } : {}),
        settings: input.settings,
      });
      const failed: string[] = [];
      for (const body of codebaseBodies(input.codebases)) {
        try {
          await admin.projects.codebases.link(enc(project.id), { ...body });
        } catch {
          failed.push(body.alias);
        }
      }
      return { project, failed };
    },
    onSettled: invalidate,
  });
}

export function useLinkCodebase(id: string) {
  const admin = useAdminApi();
  const invalidate = useInvalidateProject(id);
  return useMutation({ mutationFn: (body: Record<string, unknown>) => admin.projects.codebases.link(enc(id), body), onSettled: invalidate });
}

export function useUpdateProject(id: string) {
  const admin = useAdminApi();
  const invalidate = useInvalidateProject(id);
  return useMutation({ mutationFn: (body: Record<string, unknown>) => admin.projects.update(enc(id), body), onSettled: invalidate });
}

export function useProjectWrites() {
  const admin = useAdminApi();
  const client = useQueryClient();
  const invalidate = () => void client.invalidateQueries({ queryKey: queryKeys.projects() });
  return {
    setArchived: (id: string, archived: boolean) => admin.projects.update(enc(id), { status: archived ? 'archived' : 'active' }).finally(invalidate),
    remove: (id: string) => admin.projects.remove(enc(id), true).finally(invalidate),
  };
}

export function useCodebaseWrites(id: string) {
  const api = useApi();
  const admin = useAdminApi();
  const client = useQueryClient();
  const refresh = (cid?: string) => {
    void client.invalidateQueries({ queryKey: queryKeys.project(id) });
    if (cid) void client.invalidateQueries({ queryKey: [...queryKeys.codebases(id), cid, 'logs'] });
  };
  return {
    fetch: (cid: string) => api.projects.fetchCodebase(enc(id), enc(cid)).finally(() => refresh(cid)),
    unlink: (cid: string) => admin.projects.codebases.unlink(enc(id), enc(cid)).finally(() => refresh()),
    setDefaultBranch: (cid: string, branch: string) => admin.projects.codebases.update(enc(id), enc(cid), { defaultBranch: branch }).finally(() => refresh()),
    removeWorktree: (cid: string, wid: string) =>
      admin.projects.codebases.removeWorktree(id, cid, wid).finally(() => void client.invalidateQueries({ queryKey: projectKeys.worktrees(id, cid) })),
    cleanupWorktrees: (cid: string) =>
      admin.projects.codebases.cleanupWorktrees(id, cid).finally(() => void client.invalidateQueries({ queryKey: projectKeys.worktrees(id, cid) })),
  };
}

export function useSetArtifactEnabled(id: string) {
  const api = useApi();
  const client = useQueryClient();
  const key = [...queryKeys.project(id), 'artifact-prefs'];
  return useMutation({
    mutationFn: (prefs: ProjectArtifactPrefs) => api.projects.artifactPrefs.update(enc(id), prefs),
    // Optimistic: the switch moves now; an error puts it back.
    onMutate: async (prefs) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<ProjectArtifactPrefs>(key);
      client.setQueryData(key, prefs);
      return { previous };
    },
    onError: (_e, _p, ctx) => client.setQueryData(key, ctx?.previous),
    onSuccess: (data) => client.setQueryData(key, data),
  });
}

export function useConfigWrites(id: string) {
  const admin = useAdminApi();
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: projectKeys.configs(id) });
  return {
    save: (configId: string, content: string) =>
      admin.projects.configs.update(enc(id), enc(configId), { content }).finally(() => {
        refresh();
        void client.invalidateQueries({ queryKey: projectKeys.configContent(id, configId) });
      }),
    remove: (configId: string) => admin.projects.configs.remove(enc(id), enc(configId)).finally(refresh),
    removeMcp: (mid: string) => admin.projects.mcp.remove(enc(id), enc(mid)).finally(() => void client.invalidateQueries({ queryKey: projectKeys.mcpServers(id) })),
    /** A single prompt / agent / skill file (SKILL.md); `content` is the file's text. */
    upload: (type: 'skill' | 'prompt' | 'agent', name: string, filePath: string, content: string): Promise<ProjectConfig> =>
      admin.projects.configs.create(enc(id), { type, name, filePath, content }).finally(refresh),
  };
}

/** Whether a failed request was the server refusing this device (403 → the S state, MD-30). */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

/** G-17 — every codebase's worktrees, summed: what deleting the project removes ("6 worktrees · 1.27 GB"). */
export function useProjectFootprint(id: string) {
  const api = useApi();
  return async (codebaseIds: readonly string[]): Promise<{ worktrees: number; bytes: number | null }> => {
    const lists = await Promise.all(
      codebaseIds.map(async (cid) => {
        const raw = await api.projects.codebaseWorktrees(enc(id), enc(cid), { include: ['usage'] }).catch(() => null);
        return raw && !Array.isArray(raw) ? raw : { items: Array.isArray(raw) ? raw : [], totalBytes: undefined };
      }),
    );
    const worktrees = lists.reduce((n, l) => n + l.items.length, 0);
    const known = lists.every((l) => l.items.length === 0 || l.totalBytes !== undefined);
    return { worktrees, bytes: known ? lists.reduce((n, l) => n + (l.totalBytes ?? 0), 0) : null };
  };
}

/** A system artifact's text and catalog row (read-only in a project). */
export function useSystemArtifact(id: string, kind: 'skill' | 'prompt' | 'agent', enabled: boolean) {
  const api = useApi();
  const list = useQuery({ queryKey: ['system', 'artifacts', kind], queryFn: () => api.system.artifacts(kind), enabled, staleTime: 5 * 60_000 });
  const content = useQuery({ queryKey: ['system', 'artifacts', kind, id, 'content'], queryFn: () => api.system.artifactContent(id), enabled });
  const artifact = useMemo(() => list.data?.find((a) => a.id === id) ?? null, [list.data, id]);
  return { list, content, artifact };
}
