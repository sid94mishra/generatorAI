// ────────────────────────────────────────────────────────────────
// CreateSessionParams — DTO for session creation
// ────────────────────────────────────────────────────────────────

import type { HookDefinition } from './HookDefinition.js';
import type { HarnessConfig } from './Workflow.js';

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

export interface CreateSessionParams {
  name: string;
  description?: string;
  /** Default model to use across workflows/chat in this session. */
  model?: string;
  /** Workflows to execute. Empty or omitted for free-interaction sessions. */
  workflows?: Array<{
    templateId: string;
    variables?: Record<string, unknown>;
    hookOverrides?: Record<string, Partial<HookDefinition>>;
    harnessConfigOverrides?: Partial<HarnessConfig>;
  }>;
  mcpServers?: Record<string, McpServerConfig>;
  tags?: string[];
}
