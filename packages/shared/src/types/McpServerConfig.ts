// ────────────────────────────────────────────────────────────────
// McpServerConfig — MCP server attachment for a harness session
// ────────────────────────────────────────────────────────────────

/**
 * Superset of what both harness SDKs accept. Copilot uses `<server>-<tool>`
 * tool naming, Claude uses `mcp__<server>__<tool>`; the providers translate.
 */
export interface McpServerConfig {
  type: 'http' | 'sse' | 'stdio';
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Working directory for a stdio server. */
  cwd?: string;
  /** Include-list of tool names to expose from this server. Omit for all. */
  tools?: string[];
  timeoutMs?: number;
  /** `false` means the server is NOT mounted at session creation. */
  enabled?: boolean;
}
