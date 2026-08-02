// ────────────────────────────────────────────────────────────────
// IMcpHub — TOL-06 harness-agnostic MCP server registry.
//
// Model Context Protocol (MCP) is a cross-vendor protocol; both the
// Copilot SDK and Claude Agent SDK consume MCP servers natively, and
// future adapters (OpenAI, Bedrock) bridge via a stdio proxy. This hub
// owns the **configuration** side (what servers exist, per-workflow
// overrides, enable/disable toggles) without caring which harness
// ultimately connects to them.
//
// Current responsibilities
// -------------------------
// - Hold per-workflow `McpServerConfig` declarations.
// - Resolve the effective config for a given workflow run (merging
//   workflow-scoped defaults + any run-level overrides).
// - Hand the resolved config to the harness adapter through the
//   `CreateConversationParams.mcpServers` field.
//
// Not in scope
// -------------
// - Launching stdio servers. For Copilot that's the SDK's job; for future
//   adapters it's the adapter's job. The hub only decides **which**
//   servers to use; the adapter decides **how** to speak to them.
//
// When TOL-05 lands we'll add an outbound side: registering our own
// `CustomToolRegistry` as an MCP server for external clients to consume.
// ────────────────────────────────────────────────────────────────

import type { McpServerConfig } from '@generatorai/shared';

export interface ResolvedMcpConfig {
  /** Map of `serverName → config` that the adapter should attach to the session. */
  servers: Record<string, McpServerConfig>;
}

export interface IMcpHub {
  /**
   * Resolve the effective MCP config for a workflow run. Usually this just
   * returns the workflow definition's `harnessConfig.mcpServers` — but
   * keeping this behind a port lets future features (run-level overrides,
   * org-level defaults, credential injection) land without touching every
   * caller.
   *
   * Implementations MUST return a fresh object — callers are allowed to
   * mutate the returned `servers` map.
   */
  resolveForRun(input: {
    workflowDefinitionId: string;
    workflowRunId: string;
    /** Config the workflow definition declared. */
    declared?: Record<string, McpServerConfig>;
  }): Promise<ResolvedMcpConfig>;
}

/**
 * Default in-memory implementation. Pass-through: returns whatever the
 * workflow declared, stripping disabled entries. No persistence layer
 * today — TOL-06 full wiring stores the config alongside the workflow
 * definition (already natively supported via `workflow_definitions.copilot_config.mcpServers`).
 */
export class InMemoryMcpHub implements IMcpHub {
  private disabled = new Set<string>();

  disable(serverName: string): void {
    this.disabled.add(serverName);
  }

  enable(serverName: string): void {
    this.disabled.delete(serverName);
  }

  isDisabled(serverName: string): boolean {
    return this.disabled.has(serverName);
  }

  async resolveForRun(input: {
    workflowDefinitionId: string;
    workflowRunId: string;
    declared?: Record<string, McpServerConfig>;
  }): Promise<ResolvedMcpConfig> {
    const out: Record<string, McpServerConfig> = {};
    const declared = input.declared ?? {};
    for (const [name, cfg] of Object.entries(declared)) {
      if (this.disabled.has(name)) continue;
      out[name] = cfg;
    }
    return { servers: out };
  }
}
