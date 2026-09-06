// ────────────────────────────────────────────────────────────────
// mergeMcpServers — THE rule for which MCP servers a conversation gets.
//
//   effective = system ∪ project ∪ agent, then chatOverrides LAST
//
//   system         globally-enabled, fully-configured bundled + custom servers
//   project        the project's own enabled servers
//   agent          servers the bound agent (and its binding-site overrides)
//                  resolved by id — already minus removals/exclusions
//   chatOverrides  inline `harnessConfig.mcpServers` on the chat/stage itself
//
// Keys are the NAME the harness will expose the server under. A later level
// wins on a name collision (a chat can override a bundled server's URL), and
// an override entry with `enabled: false` REMOVES that name — that is how a
// single chat opts out of a server that every level above turned on.
//
// `AgentResolver` already produces `system ∪ project ∪ agent` in one map (it
// applies `removeMcpServerIds` / `excludedMcpServerIds` by id, which is why
// the id-based subtraction is not repeated here). The builder that hands the
// config to the harness therefore calls this with `{ agent: projection.
// mcpServers, chatOverrides: chat.harnessConfig.mcpServers }` — and MUST do so
// identically on the create path and the rebuild/resume path. The bug this
// replaces was two hand-rolled merges that disagreed: creation used only the
// chat's inline map (dropping the agent's servers), resume spread both.
// ────────────────────────────────────────────────────────────────

import type { McpServerConfig } from '@generatorai/shared';

export interface MergeMcpServersInput {
  system?: Record<string, McpServerConfig> | undefined;
  project?: Record<string, McpServerConfig> | undefined;
  agent?: Record<string, McpServerConfig> | undefined;
  chatOverrides?: Record<string, McpServerConfig> | undefined;
}

export function mergeMcpServers(input: MergeMcpServersInput): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  for (const level of [input.system, input.project, input.agent]) {
    for (const [name, cfg] of Object.entries(level ?? {})) {
      if (!cfg || cfg.enabled === false) continue;
      out[name] = cfg;
    }
  }
  for (const [name, cfg] of Object.entries(input.chatOverrides ?? {})) {
    if (!cfg || cfg.enabled === false) {
      delete out[name];
      continue;
    }
    out[name] = cfg;
  }
  return out;
}
