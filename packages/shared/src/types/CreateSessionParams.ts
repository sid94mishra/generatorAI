// ────────────────────────────────────────────────────────────────
// CreateSessionParams — DTO for session creation
// ────────────────────────────────────────────────────────────────

import type { HookDefinition } from './HookDefinition.js';
import type { HarnessConfig } from './Workflow.js';

export interface McpServerConfig {
  type: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
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
