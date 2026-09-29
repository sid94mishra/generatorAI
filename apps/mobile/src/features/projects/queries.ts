import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, projectKeys, scmKeys, ApiError, type ApiClient, type AdminApi, type PullRequestListState } from '@generatorai/client-core';
import { useApi } from '../../services/api/useApi';

export function useProjects(options: { staleTime?: number } = {}) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.projects(), queryFn: () => api.projects.list(), ...options });
}

import { useAdminApi } from '../../services/api/useAdminApi';
import type { MutationCallbacks } from '../../services/api/queryCallbacks';
import { anyCloning } from './cloneState';

export function useProject(id: string, followClone = false) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.project(id), queryFn: () => api.projects.get(id),
    refetchInterval: followClone ? (query) => anyCloning(query.state.data?.codebases) ? 3_000 : false : false,
  });
}

export function useProjectChats(id: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.projectChats(id), queryFn: () => api.chats.list({ projectId: id }) });
}

export function useProjectWorkflows(id: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.projectWorkflows(id), queryFn: () => api.workflows.list(id) });
}

export function useProjectAutomations(id: string) {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.projectAutomations(id), queryFn: () => api.automations.list(id) });
}

export function useProjectPullRequests(id: string, state: PullRequestListState) {
  const { scm } = useApi();
  return useQuery({ queryKey: scmKeys.projectPullRequests(id, state), queryFn: () => scm.projectPullRequests(id, state), staleTime: 30_000 });
}

export function useCodebaseFiles(id: string, cid: string, path: string) {
  const admin = useAdminApi();
  return useQuery({
    queryKey: projectKeys.files(id, cid, path),
    queryFn: () => admin.projects.codebases.files(encodeURIComponent(id), encodeURIComponent(cid), path || undefined),
  });
}

export function useCodebaseFile(id: string, cid: string, path: string) {
  const admin = useAdminApi();
  return useQuery({
    queryKey: projectKeys.fileContent(id, cid, path),
    queryFn: () => admin.projects.codebases.fileContent(encodeURIComponent(id), encodeURIComponent(cid), path), enabled: path.length > 0,
  });
}

export function useCodebaseStatus(id: string, cid: string) {
  const admin = useAdminApi();
  return useQuery({ queryKey: queryKeys.codebaseStatus(id, cid), queryFn: () => admin.projects.codebases.status(id, cid) });
}

export function useCodebaseReadiness(id: string, cid: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.codebaseReadiness(id, cid), retry: false,
    queryFn: async () => {
      try { return await api.projects.codebaseReadiness(id, cid); }
      catch (error) { if (error instanceof ApiError && error.status === 400) return null; throw error; }
    },
  });
}

export function useCodebaseBranches(id: string, cid: string) {
  const admin = useAdminApi();
  return useQuery({ queryKey: queryKeys.codebaseBranches(id, cid), queryFn: () => admin.projects.codebases.branches(id, cid), retry: false });
}

type FetchResult = Awaited<ReturnType<AdminApi['projects']['codebases']['fetch']>>;
export function useFetchCodebase(id: string, cid: string, callbacks: MutationCallbacks<FetchResult>) {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    ...callbacks, mutationFn: () => admin.projects.codebases.fetch(id, cid),
    onSuccess: (...args) => {
      for (const queryKey of [queryKeys.codebaseStatus(id, cid), queryKeys.codebaseBranches(id, cid), queryKeys.codebaseReadiness(id, cid), queryKeys.project(id)]) void client.invalidateQueries({ queryKey });
      return callbacks.onSuccess?.(...args);
    },
  });
}

type UnlinkResult = Awaited<ReturnType<AdminApi['projects']['codebases']['unlink']>>;
export function useUnlinkCodebase(id: string, cid: string, callbacks: MutationCallbacks<UnlinkResult>) {
  const admin = useAdminApi();
  const client = useQueryClient();
  return useMutation({
    ...callbacks, mutationFn: () => admin.projects.codebases.unlink(encodeURIComponent(id), encodeURIComponent(cid)),
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.project(id) });
      return callbacks.onSuccess?.(...args);
    },
  });
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

type ChatResult = Awaited<ReturnType<ApiClient['chats']['create']>>;
export function useNewProjectChat(id: string, callbacks: MutationCallbacks<ChatResult, string>) {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    ...callbacks, mutationFn: (name: string) => api.chats.create({ name: `New chat in ${name}`, projectId: id }),
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.chats() });
      return callbacks.onSuccess?.(...args);
    },
  });
}
