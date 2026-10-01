import type { AdminApi, ProjectSummary, CodebaseSummary } from '@generatorai/client-core';
import type { GitCodebaseBody, ProjectUpdateBody } from './projectEditModel';

export type ProjectDetailWire = ProjectSummary & { codebases: CodebaseSummary[] };
export type CodebaseWire = CodebaseSummary;

/** Presentation names for the legacy editor, over the shared admin client. */
export function createProjectActions(admin: AdminApi) {
  const { projects } = admin;
  const enc = encodeURIComponent;
  return {
    create: (body: { name: string; description?: string }) => projects.create(body),
    update: (id: string, body: ProjectUpdateBody & { status?: 'active' | 'archived' }) => projects.update(enc(id), { ...body }),
    remove: (id: string) => projects.remove(enc(id), true),
    linkGit: (id: string, body: GitCodebaseBody) => projects.codebases.link(enc(id), { ...body }),
    unlinkCodebase: (id: string, cid: string) => projects.codebases.unlink(enc(id), enc(cid)),
    configs: (id: string) => projects.configs.list(enc(id)),
    configContent: (id: string, cid: string) => projects.configs.content(id, cid),
    removeConfig: (id: string, cid: string) => projects.configs.remove(enc(id), enc(cid)),
    mcpServers: (id: string) => projects.mcp.list(enc(id)),
    updateMcpServer: (id: string, mid: string, body: Record<string, unknown>) => projects.mcp.update(enc(id), enc(mid), body),
    removeMcpServer: (id: string, mid: string) => projects.mcp.remove(enc(id), enc(mid)),
    worktrees: (id: string, cid: string) => projects.codebases.worktrees(enc(id), enc(cid)),
    removeWorktree: projects.codebases.removeWorktree,
    cleanupWorktrees: projects.codebases.cleanupWorktrees,
    files: (id: string, cid: string, path: string) => projects.codebases.files(enc(id), enc(cid), path || undefined),
    fileContent: (id: string, cid: string, path: string) => projects.codebases.fileContent(enc(id), enc(cid), path),
    updateGlobalMcp: admin.systemAdmin.updateMcp,
  };
}
