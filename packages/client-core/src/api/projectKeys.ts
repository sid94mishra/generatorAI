// Project detail resources share one invalidation vocabulary.
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
