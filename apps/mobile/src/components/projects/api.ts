// ────────────────────────────────────────────────────────────────
// Project authoring endpoints (apps/server/src/routes/projects.ts, system.ts).
//
// Hand-written over `requestJson` rather than `createAdminApi` for two
// reasons: the server's `{ error: { message } }` reason reaches the toast
// (a clone or validation failure is only useful with its message), and a
// few routes the phone needs — codebase-scoped worktree removal, global MCP
// toggles — have no client-core wrapper. React-free so it is testable
// against a mocked fetch.
// ────────────────────────────────────────────────────────────────

import type { McpServerEntry, ProjectConfig, WorktreeInfo } from '@generatorai/shared';

import { json, requestJson, type AuthedFetch } from '../../api/http';
import type { GitCodebaseBody, ProjectUpdateBody } from './projectEditModel';

const enc = encodeURIComponent;

/** `GET /projects/:id` — the project row plus its codebases (loosely typed wire dates). */
export interface ProjectDetailWire {
  id: string;
  name: string;
  description?: string;
  status?: string;
  rootPath?: string;
  createdAt: string | number;
  settings?: { worktreeRetention?: string; maxCodebases?: number; [key: string]: unknown };
  codebases: CodebaseWire[];
}

export interface CodebaseWire {
  id: string;
  projectId: string;
  alias: string;
  type: 'git-remote' | 'git-local' | 'local-dir';
  url?: string;
  localPath?: string;
  defaultBranch?: string;
  status?: string;
  lastError?: string;
  lastFetchedAt?: string | number | null;
}

export interface CodebaseFileEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
}

export interface ProjectsApi {
  create: (body: { name: string; description?: string }) => Promise<ProjectDetailWire>;
  update: (projectId: string, body: ProjectUpdateBody & { status?: 'active' | 'archived' }) => Promise<ProjectDetailWire>;
  /** `DELETE /projects/:id?force=true` — removes the project, its codebases and its folder. */
  remove: (projectId: string) => Promise<void>;

  linkGit: (projectId: string, body: GitCodebaseBody) => Promise<CodebaseWire>;
  unlinkCodebase: (projectId: string, codebaseId: string) => Promise<void>;

  configs: (projectId: string) => Promise<ProjectConfig[]>;
  configContent: (projectId: string, configId: string) => Promise<{ content: string }>;
  removeConfig: (projectId: string, configId: string) => Promise<void>;

  mcpServers: (projectId: string) => Promise<McpServerEntry[]>;
  updateMcpServer: (projectId: string, serverId: string, body: Record<string, unknown>) => Promise<void>;
  removeMcpServer: (projectId: string, serverId: string) => Promise<void>;

  worktrees: (projectId: string, codebaseId: string) => Promise<WorktreeInfo[]>;
  removeWorktree: (projectId: string, codebaseId: string, worktreeId: string) => Promise<void>;
  cleanupWorktrees: (projectId: string, codebaseId: string) => Promise<unknown>;

  files: (projectId: string, codebaseId: string, path: string) => Promise<CodebaseFileEntry[]>;
  fileContent: (projectId: string, codebaseId: string, path: string) => Promise<{ content: string }>;

  /** `PUT` to a path from `globalMcpToggle` (system prefs or custom replacement). */
  putJson: (path: string, body: Record<string, unknown>) => Promise<void>;
}

function codebasePath(projectId: string, codebaseId: string): string {
  return `/api/projects/${enc(projectId)}/codebases/${enc(codebaseId)}`;
}

export function createProjectsApi(fetchImpl: AuthedFetch): ProjectsApi {
  const project = (id: string): string => `/api/projects/${enc(id)}`;
  return {
    create: (body) => requestJson(fetchImpl, '/api/projects', json(body)),
    update: (projectId, body) => requestJson(fetchImpl, project(projectId), json(body, 'PUT')),
    remove: (projectId) => requestJson(fetchImpl, `${project(projectId)}?force=true`, { method: 'DELETE' }),

    linkGit: (projectId, body) => requestJson(fetchImpl, `${project(projectId)}/codebases`, json(body)),
    unlinkCodebase: (projectId, codebaseId) =>
      requestJson(fetchImpl, codebasePath(projectId, codebaseId), { method: 'DELETE' }),

    configs: (projectId) => requestJson(fetchImpl, `${project(projectId)}/configs`),
    configContent: (projectId, configId) =>
      requestJson(fetchImpl, `${project(projectId)}/configs/${enc(configId)}`),
    removeConfig: (projectId, configId) =>
      requestJson(fetchImpl, `${project(projectId)}/configs/${enc(configId)}`, { method: 'DELETE' }),

    mcpServers: (projectId) => requestJson(fetchImpl, `${project(projectId)}/mcp-servers`),
    updateMcpServer: (projectId, serverId, body) =>
      requestJson(fetchImpl, `${project(projectId)}/mcp-servers/${enc(serverId)}`, json(body, 'PUT')),
    removeMcpServer: (projectId, serverId) =>
      requestJson(fetchImpl, `${project(projectId)}/mcp-servers/${enc(serverId)}`, { method: 'DELETE' }),

    worktrees: (projectId, codebaseId) => requestJson(fetchImpl, `${codebasePath(projectId, codebaseId)}/worktrees`),
    removeWorktree: (projectId, codebaseId, worktreeId) =>
      requestJson(fetchImpl, `${codebasePath(projectId, codebaseId)}/worktrees/${enc(worktreeId)}`, {
        method: 'DELETE',
      }),
    cleanupWorktrees: (projectId, codebaseId) =>
      requestJson(fetchImpl, `${codebasePath(projectId, codebaseId)}/worktrees/cleanup`, json({})),

    files: (projectId, codebaseId, path) =>
      requestJson(fetchImpl, `${codebasePath(projectId, codebaseId)}/files${path ? `?path=${enc(path)}` : ''}`),
    fileContent: (projectId, codebaseId, path) =>
      requestJson(fetchImpl, `${codebasePath(projectId, codebaseId)}/files/content?path=${enc(path)}`),

    putJson: (path, body) => requestJson(fetchImpl, path, json(body, 'PUT')),
  };
}

// ── Query keys ───────────────────────────────────────────────────
// `queryKeys.project(id)` / `queryKeys.projects()` from client-core stay the
// keys for the project row itself; these cover what only the phone reads.

export const projectKeys = {
  configs: (projectId: string) => ['projects', projectId, 'configs'] as const,
  configContent: (projectId: string, configId: string) => ['projects', projectId, 'configs', configId, 'content'] as const,
  /** Same key the agent detail sheet uses for project MCP names. */
  mcpServers: (projectId: string) => ['projects', projectId, 'mcp-servers'] as const,
  availableSkills: (projectId: string) => ['projects', projectId, 'available-artifacts'] as const,
  worktrees: (projectId: string, codebaseId: string) => ['projects', projectId, 'codebases', codebaseId, 'worktrees'] as const,
  files: (projectId: string, codebaseId: string, path: string) =>
    ['projects', projectId, 'codebases', codebaseId, 'files', path] as const,
  fileContent: (projectId: string, codebaseId: string, path: string) =>
    ['projects', projectId, 'codebases', codebaseId, 'file', path] as const,
};
