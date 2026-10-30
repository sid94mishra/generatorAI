import type { HarnessProviderId, ReasoningEffort } from './ProviderConfig.js';
// ────────────────────────────────────────────────────────────────
// HarnessConfig — agent session configuration shared by chats, stages
// and workflow definitions
// ────────────────────────────────────────────────────────────────

import type { McpServerConfig } from './McpServerConfig.js';
import type { AgentMode, AgentPermissionMode } from './AgentMode.js';
import type { AgentOverrides } from './Agent.js';

export interface HarnessConfig {
  model: string;
  systemMessage?: { mode: 'append' | 'replace'; content: string };
  systemPromptAppend?: string;
  streaming: boolean;
  mcpServers: Record<string, McpServerConfig>;
  availableTools: string[];
  excludedTools: string[];
  skillDirectories: string[];
  disabledSkills: string[];
  customAgents: Array<{ name: string; description: string; instructions: string; tools?: string[] }>;
  provider?: { name: string; baseUrl: string; apiKey: string; model?: string };
  configDir?: string;
  /** Reasoning effort for models that support it (SDK 0.3.0) */
  reasoningEffort?: ReasoningEffort;
  /** Context window tier — 'long_context' pins the long-context tier for models that support it. */
  contextTier?: 'default' | 'long_context';
  /**
   * Agent provider that should run this stage / workflow / chat. Omit to route
   * by `model`, falling back to the server's primary provider.
   */
  harnessType?: HarnessProviderId;
  /** Maximum tool-call turns before forcing completion */
  maxTurns?: number;
  /** Session-level permission mode (plan / bypassPermissions / …). */
  permissionMode?: AgentPermissionMode;
  /** Workflow instructions used while the agent is planning (Claude native, folded into the prompt elsewhere). */
  planModeInstructions?: string;
  /** Sticky agent mode for this scope. */
  defaultAgentMode?: AgentMode;
  /**
   * Catalog ids of MCP servers to exclude. Replaces the historical abuse of
   * `excludedTools` for MCP toggling.
   */
  excludedMcpServerIds?: string[];
  /** Portable `scope:slug` ref of the agent driving this scope. */
  agentRef?: string;
  /** Additive capability delta applied on top of the bound agent. */
  agentOverrides?: AgentOverrides;
}
