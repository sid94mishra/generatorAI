// ────────────────────────────────────────────────────────────────
// TanStack Query hooks — Projects, Codebases, Configs, Worktrees
// ────────────────────────────────────────────────────────────────

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';
import type {
  Project,
  ProjectCodebase,
  ProjectConfig,
  WorktreeInfo,
  ProjectSettings,
  CodebaseType,
  CodebaseSettings,
  ConfigType,
  ArtifactWithSource,
  McpServerEntry,
  SystemConfig,
  FileEntry,
} from '@generatorai/shared';

// ── Query Keys ──
export const projectKeys = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  codebases: (projectId: string) => ['project-codebases', projectId] as const,
  codebase: (projectId: string, codebaseId: string) => ['project-codebase', projectId, codebaseId] as const,
  branches: (projectId: string, codebaseId: string) => ['codebase-branches', projectId, codebaseId] as const,
  configs: (projectId: string) => ['project-configs', projectId] as const,
  worktrees: (projectId: string) => ['project-worktrees', projectId] as const,
  systemArtifacts: (type?: string) => ['system-artifacts', type] as const,
  availableArtifacts: (projectId: string, type?: string) => ['available-artifacts', projectId, type] as const,
  codebaseWorktrees: (projectId: string, codebaseId: string) => ['codebase-worktrees', projectId, codebaseId] as const,
  codebaseFiles: (projectId: string, codebaseId: string, path?: string) => ['codebase-files', projectId, codebaseId, path] as const,
  codebaseFileContent: (projectId: string, codebaseId: string, filePath: string) => ['codebase-file-content', projectId, codebaseId, filePath] as const,
  artifactContent: (artifactId: string, source: string) => ['artifact-content', artifactId, source] as const,
  mcpServers: (projectId: string) => ['project-mcp-servers', projectId] as const,
  systemMcpServers: ['system-mcp-servers'] as const,
};

// ════════════════════════════════════════════════════════════════
// Project Queries & Mutations
// ════════════════════════════════════════════════════════════════

export function useProjects() {
  const platform = usePlatform();
  return useQuery({
    queryKey: projectKeys.projects,
    queryFn: () => platform.listProjects(),
    staleTime: 30_000,
  });
}

export function useProject(id: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: projectKeys.project(id ?? ''),
    queryFn: () => platform.getProject(id!),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { name: string; description?: string; settings?: Partial<ProjectSettings> }) =>
      platform.createProject(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.projects });
    },
  });
}

export function useUpdateProject() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...params }: { id: string; name?: string; description?: string; settings?: Partial<ProjectSettings>; status?: 'active' | 'archived' }) =>
      platform.updateProject(id, params),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.projects });
      queryClient.invalidateQueries({ queryKey: projectKeys.project(vars.id) });
    },
  });
}

export function useDeleteProject() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => platform.deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.projects });
    },
  });
}

// ════════════════════════════════════════════════════════════════
// Codebase Queries & Mutations
// ════════════════════════════════════════════════════════════════

export function useProjectCodebases(projectId: string | undefined, options?: { refetchInterval?: number | false }) {
  const platform = usePlatform();
  return useQuery({
    queryKey: projectKeys.codebases(projectId ?? ''),
    queryFn: () => platform.listCodebases(projectId!),
    enabled: !!projectId,
    refetchInterval: options?.refetchInterval,
  });
}

export function useCodebaseBranches(projectId: string | undefined, codebaseId: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: projectKeys.branches(projectId ?? '', codebaseId ?? ''),
    queryFn: () => platform.getCodebaseBranches(projectId!, codebaseId!),
    enabled: !!projectId && !!codebaseId,
  });
}

export function useLinkCodebase() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      ...params
    }: {
      projectId: string;
      alias: string;
      type: CodebaseType;
      url?: string;
      localPath?: string;
      defaultBranch?: string;
      subdirectory?: string;
      settings?: Partial<CodebaseSettings>;
    }) => platform.linkCodebase(projectId, params),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.codebases(vars.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.project(vars.projectId) });
    },
  });
}

export function useUpdateCodebase() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      codebaseId,
      ...params
    }: {
      projectId: string;
      codebaseId: string;
      defaultBranch?: string;
      subdirectory?: string;
      settings?: Partial<CodebaseSettings>;
    }) => platform.updateCodebase(projectId, codebaseId, params),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.codebases(vars.projectId) });
    },
  });
}

export function useUnlinkCodebase() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, codebaseId }: { projectId: string; codebaseId: string }) =>
      platform.unlinkCodebase(projectId, codebaseId),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.codebases(vars.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.project(vars.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.worktrees(vars.projectId) });
    },
  });
}

export function useFetchCodebase() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, codebaseId }: { projectId: string; codebaseId: string }) =>
      platform.fetchCodebase(projectId, codebaseId),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.codebases(vars.projectId) });
    },
  });
}

// ════════════════════════════════════════════════════════════════
// Config Queries & Mutations
// ════════════════════════════════════════════════════════════════

export function useProjectConfigs(projectId: string | undefined, type?: ConfigType) {
  const platform = usePlatform();
  return useQuery({
    queryKey: [...projectKeys.configs(projectId ?? ''), type],
    queryFn: () => platform.listProjectConfigs(projectId!, type),
    enabled: !!projectId,
  });
}

export function useUploadConfig() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      type,
      file,
    }: {
      projectId: string;
      type: ConfigType;
      file: File;
    }) => platform.uploadProjectConfig(projectId, type, file),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.configs(vars.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.availableArtifacts(vars.projectId) });
    },
  });
}

export function useDeleteConfig() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, configId }: { projectId: string; configId: string }) =>
      platform.deleteProjectConfig(projectId, configId),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.configs(vars.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.availableArtifacts(vars.projectId) });
    },
  });
}

// ════════════════════════════════════════════════════════════════
// Worktree Queries & Mutations
// ════════════════════════════════════════════════════════════════

export function useProjectWorktrees(projectId: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: projectKeys.worktrees(projectId ?? ''),
    queryFn: () => platform.listWorktrees(projectId!),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });
}

export function useRemoveWorktree() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, worktreeId }: { projectId: string; worktreeId: string }) =>
      platform.removeWorktree(projectId, worktreeId),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.worktrees(vars.projectId) });
      // Also invalidate codebase-level worktree queries so CodebaseDetailPage refreshes
      queryClient.invalidateQueries({ queryKey: ['codebase-worktrees'] });
    },
  });
}

export function useCleanupWorktrees() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => platform.cleanupWorktrees(projectId),
    onSuccess: (_data, projectId) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.worktrees(projectId) });
      // Also invalidate codebase-level worktree queries so CodebaseDetailPage refreshes
      queryClient.invalidateQueries({ queryKey: ['codebase-worktrees'] });
    },
  });
}

// ════════════════════════════════════════════════════════════════
// System Artifacts & Available Artifacts
// ════════════════════════════════════════════════════════════════

export function useSystemArtifacts(type?: ConfigType) {
  const platform = usePlatform();
  return useQuery({
    queryKey: projectKeys.systemArtifacts(type),
    queryFn: () => platform.listSystemArtifacts(type),
    staleTime: 60_000,
  });
}

export function useAvailableArtifacts(projectId: string | undefined, type?: ConfigType) {
  const platform = usePlatform();
  return useQuery({
    queryKey: projectKeys.availableArtifacts(projectId ?? '', type),
    queryFn: () => platform.listAvailableArtifacts(projectId!, type),
    enabled: !!projectId,
  });
}

// ════════════════════════════════════════════════════════════════
// Codebase-level Worktrees & Files
// ════════════════════════════════════════════════════════════════

export function useCodebaseWorktrees(projectId: string | undefined, codebaseId: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: projectKeys.codebaseWorktrees(projectId ?? '', codebaseId ?? ''),
    queryFn: () => platform.listCodebaseWorktrees(projectId!, codebaseId!),
    enabled: !!projectId && !!codebaseId,
    refetchInterval: 30_000,
  });
}

export function useCodebaseFiles(projectId: string | undefined, codebaseId: string | undefined, subPath?: string) {
  const platform = usePlatform();
  return useQuery({
    queryKey: projectKeys.codebaseFiles(projectId ?? '', codebaseId ?? '', subPath),
    queryFn: () => platform.listCodebaseFiles(projectId!, codebaseId!, subPath),
    enabled: !!projectId && !!codebaseId && subPath !== undefined ? true : (!!projectId && !!codebaseId),
  });
}

// ════════════════════════════════════════════════════════════════
// Artifact Content Viewer
// ════════════════════════════════════════════════════════════════

export function useArtifactContent(
  projectId: string | undefined,
  artifactId: string | undefined,
  source: 'system' | 'project' | undefined,
) {
  const platform = usePlatform();
  return useQuery({
    queryKey: projectKeys.artifactContent(artifactId ?? '', source ?? ''),
    queryFn: async () => {
      if (source === 'system') {
        return platform.getSystemArtifactContent(artifactId!);
      }
      return platform.getProjectConfigContent(projectId!, artifactId!);
    },
    enabled: !!artifactId && !!source && (source === 'system' || !!projectId),
  });
}

// ════════════════════════════════════════════════════════════════
// Artifact Content Update
// ════════════════════════════════════════════════════════════════

export function useUpdateArtifactContent() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, configId, content }: { projectId: string; configId: string; content: string }) =>
      platform.updateProjectConfigContent(projectId, configId, content),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.artifactContent(variables.configId, 'project') });
    },
  });
}

// ════════════════════════════════════════════════════════════════
// Codebase File Content
// ════════════════════════════════════════════════════════════════

export function useCodebaseFileContent(projectId: string | undefined, codebaseId: string | undefined, filePath: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: projectKeys.codebaseFileContent(projectId ?? '', codebaseId ?? '', filePath ?? ''),
    queryFn: () => platform.getCodebaseFileContent(projectId!, codebaseId!, filePath!),
    enabled: !!projectId && !!codebaseId && !!filePath,
  });
}

// ════════════════════════════════════════════════════════════════
// MCP Servers
// ════════════════════════════════════════════════════════════════

export function useSystemMcpServers() {
  const platform = usePlatform();
  return useQuery({
    queryKey: projectKeys.systemMcpServers,
    queryFn: () => platform.listSystemMcpServers() as Promise<McpServerEntry[]>,
    staleTime: 5 * 60_000,
  });
}

/** Per-bundled-server prefs: on/off, `{{input}}` values, credentials (W48). */
export function useUpdateSystemMcpServerPrefs() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { enabled?: boolean; inputs?: Record<string, string>; headers?: Record<string, string>; env?: Record<string, string> } }) =>
      platform.updateSystemMcpServerPrefs(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.systemMcpServers });
    },
  });
}

/** Add a custom MCP server (Settings → MCP Servers), persisted server-side (W48). */
export function useCreateCustomMcpServer() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string; description?: string; serverType: string; url?: string; command?: string; args?: string[];
      timeoutMs?: number; headers?: Record<string, string>; env?: Record<string, string>;
    }) => platform.createCustomMcpServer(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.systemMcpServers });
    },
  });
}

export function useUpdateCustomMcpServer() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: {
      id: string; data: {
        name: string; description?: string; serverType: string; url?: string; command?: string; args?: string[];
        timeoutMs?: number; enabled?: boolean; headers?: Record<string, string>; env?: Record<string, string>;
      };
    }) => platform.updateCustomMcpServer(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.systemMcpServers });
    },
  });
}

export function useDeleteCustomMcpServer() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => platform.deleteCustomMcpServer(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.systemMcpServers });
    },
  });
}

export function useProjectMcpServers(projectId: string | undefined) {
  const platform = usePlatform();
  return useQuery({
    queryKey: projectKeys.mcpServers(projectId ?? ''),
    queryFn: () => platform.listProjectMcpServers(projectId!),
    enabled: !!projectId,
  });
}

export function useCreateMcpServer() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: { name: string; description?: string; serverType: string; url?: string; command?: string; args?: string[] } }) =>
      platform.createProjectMcpServer(projectId, data),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.mcpServers(variables.projectId) });
    },
  });
}

export function useDeleteMcpServer() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, serverId }: { projectId: string; serverId: string }) =>
      platform.deleteProjectMcpServer(projectId, serverId),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.mcpServers(variables.projectId) });
    },
  });
}
