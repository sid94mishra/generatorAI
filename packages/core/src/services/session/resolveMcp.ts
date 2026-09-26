// ────────────────────────────────────────────────────────────────
// resolveMcp — the MCP servers a session gets, for either owner (W-18).
//
// One merge (`mergeMcpServers`: the agent's resolved servers, then the
// session's explicit servers LAST, so an explicit override beats an agent
// default for chats and stages alike), then the hub: disable flags and
// `secretref:` pointers swapped for their values. Servers the hub had to
// drop come back as composer warnings; a pointer never reaches the provider.
// ────────────────────────────────────────────────────────────────

import type { McpServerConfig } from '@generatorai/shared';
import { mergeMcpServers } from '../../mcp/mergeMcpServers.js';
import type { IMcpHub } from '../../mcp/IMcpHub.js';
import type { ConversationConfig } from './cfg.js';
import type { ComposeWarning, SessionOwner } from './types.js';

/** The hub's run coordinates for an owner: a chat is its own "definition". */
function hubScope(owner: SessionOwner, conversationId: string): { workflowDefinitionId: string; workflowRunId: string } {
  return owner.kind === 'chat'
    ? { workflowDefinitionId: `chat:${owner.chatId}`, workflowRunId: conversationId }
    : { workflowDefinitionId: owner.workflowDefinitionId, workflowRunId: owner.workflowRunId };
}

/**
 * Put the session's MCP servers on `cfg`. `cfg.mcpServers` holds the agent
 * projection's servers when this runs; `explicit` is the session spec's own
 * map. Returns one warning per server the hub dropped.
 */
export async function resolveMcp(
  cfg: ConversationConfig,
  explicit: Record<string, McpServerConfig> | undefined,
  owner: SessionOwner,
  conversationId: string,
  hub: IMcpHub | undefined,
): Promise<ComposeWarning[]> {
  const declared = mergeMcpServers({
    agent: cfg['mcpServers'] as Record<string, McpServerConfig> | undefined,
    chatOverrides: explicit,
  });
  if (!hub) {
    cfg['mcpServers'] = declared;
    return [];
  }
  const resolved = await hub.resolveForRun({ ...hubScope(owner, conversationId), declared });
  if (Object.keys(resolved.servers).length > 0) {
    cfg['mcpServers'] = resolved.servers;
  } else if (cfg['mcpServers'] !== undefined) {
    // Everything was disabled or dropped: never leave the agent's unresolved
    // map (with its credential pointers) on the config.
    delete cfg['mcpServers'];
  }
  return resolved.dropped.map((d) => ({
    code: 'mcp_dropped' as const,
    message: `MCP server "${d.server}" was not started: ${d.reason}`,
    params: { server: d.server },
  }));
}
