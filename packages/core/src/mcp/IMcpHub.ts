// ────────────────────────────────────────────────────────────────
// IMcpHub — TOL-06 harness-agnostic MCP server registry.
//
// Model Context Protocol (MCP) is a cross-vendor protocol; both the
// Copilot SDK and Claude Agent SDK consume MCP servers natively. This hub
// owns the **configuration** side (which servers a run gets, disable
// toggles, credential injection) without caring which harness ultimately
// connects to them.
//
// Current responsibilities
// -------------------------
// - Strip disabled entries from the declared map.
// - Swap `secretref:` credential pointers for the real values, immediately
//   before the map reaches the adapter — the ONLY place values appear in a
//   config. Everything upstream (catalog, resolver, chat snapshot, DB) holds
//   pointers, so a persisted projection never contains a token.
// - Hand the resolved config to the harness adapter through the
//   `CreateConversationParams.mcpServers` field.
//
// Not in scope
// -------------
// - Launching or speaking to servers. The harness SDK does that. The hub only
//   decides **which** servers to use and with **what** credentials.
// ────────────────────────────────────────────────────────────────

import type { ILogger, McpServerConfig } from '@generatorai/shared';
import type { McpCredentialVault } from './McpCredentialVault.js';

export interface ResolvedMcpConfig {
  /** Map of `serverName → config` that the adapter should attach to the session. */
  servers: Record<string, McpServerConfig>;
  /**
   * Servers that were declared but could not be sent — today, only because a
   * credential pointer had no value in the vault. Callers should surface these
   * (a `harness.warning`) rather than let the server silently vanish.
   */
  dropped: Array<{ server: string; reason: string }>;
}

export interface IMcpHub {
  /**
   * Resolve the effective MCP config for a run. Implementations MUST return a
   * fresh object — callers are allowed to mutate the returned `servers` map.
   */
  resolveForRun(input: {
    workflowDefinitionId: string;
    workflowRunId: string;
    /** Config the caller declared (already merged — see `mergeMcpServers`). */
    declared?: Record<string, McpServerConfig>;
  }): Promise<ResolvedMcpConfig>;
}

export interface InMemoryMcpHubOptions {
  /** When set, `secretref:` pointers are resolved to values on the way out. */
  vault?: McpCredentialVault;
  logger?: Pick<ILogger, 'warn'>;
}

/**
 * Default implementation. Pass-through minus disabled entries, plus
 * credential injection when a vault is wired.
 */
export class InMemoryMcpHub implements IMcpHub {
  private disabled = new Set<string>();

  constructor(private readonly opts: InMemoryMcpHubOptions = {}) {}

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
    const filtered: Record<string, McpServerConfig> = {};
    for (const [name, cfg] of Object.entries(input.declared ?? {})) {
      if (this.disabled.has(name) || cfg.enabled === false) continue;
      filtered[name] = cfg;
    }
    if (!this.opts.vault) return { servers: filtered, dropped: [] };

    const injected = await this.opts.vault.injectSecrets(filtered);
    const dropped = injected.missing.map((m) => ({
      server: m.server,
      reason: `credential ${m.ref} is not in the secrets vault — re-enter it in Settings → MCP Servers`,
    }));
    for (const d of dropped) {
      this.opts.logger?.warn(
        `[McpHub] ${input.workflowDefinitionId}/${input.workflowRunId}: dropping MCP server "${d.server}": ${d.reason}`,
      );
    }
    return { servers: injected.servers, dropped };
  }
}
