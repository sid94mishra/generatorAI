// ────────────────────────────────────────────────────────────────
// Platform tools (D-181): chats, projects, agents, automations, activity and
// chat files as tools, ONE registry for in-app sessions (the `platform` tool
// group) and external agents (`/api/platform-tools`, served by
// `generatorai-mcp`). The registry itself lives in
// `@generatorai/core/tools/platform`; these are the shapes clients see.
// ────────────────────────────────────────────────────────────────

/** The toolsets, in binding order. `generatorai-mcp --toolsets` takes these names. */
export const PLATFORM_TOOLSETS = ['chats', 'projects', 'agents', 'automations', 'activity', 'files'] as const;
export type PlatformToolset = (typeof PLATFORM_TOOLSETS)[number];

/** One platform tool as `GET /platform-tools` lists it. */
export interface PlatformToolAdvert {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  toolset: PlatformToolset;
  /** Changes nothing. */
  readOnly: boolean;
  /** May destroy or overwrite something (none of the current tools do). */
  destructive: boolean;
  /** Calling it twice with the same arguments has no further effect. */
  idempotent: boolean;
  /** The scopes the calling principal must hold. */
  scopes: string[];
}

/** How an external MCP client starts `generatorai-mcp` (the CLI's `skill install` prints the same). */
export const MCP_SERVER_COMMAND = 'generatorai-mcp';
export const MCP_SERVER_ARGS: readonly string[] = ['serve'];

/** A copy-ready MCP config for one external agent (Settings › Security › Connect an external agent). */
export interface ExternalAgentSetup {
  id: 'claude-code' | 'codex' | 'cursor';
  label: string;
  /** Where the snippet goes, said the way the client's docs say it. */
  where: string;
  lang: 'bash' | 'toml' | 'json';
  snippet: string;
}

/** The config for Claude Code, Codex and Cursor. */
export function externalAgentSetups(): ExternalAgentSetup[] {
  const args = MCP_SERVER_ARGS.join(' ');
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      where: 'Run in a terminal',
      lang: 'bash',
      snippet: `claude mcp add --scope user generatorai -- ${MCP_SERVER_COMMAND} ${args}`,
    },
    {
      id: 'codex',
      label: 'Codex',
      where: 'Add to ~/.codex/config.toml',
      lang: 'toml',
      snippet: ['[mcp_servers.generatorai]', `command = "${MCP_SERVER_COMMAND}"`, `args = [${MCP_SERVER_ARGS.map((a) => `"${a}"`).join(', ')}]`].join('\n'),
    },
    {
      id: 'cursor',
      label: 'Cursor',
      where: 'Add to .cursor/mcp.json (or ~/.cursor/mcp.json for every project)',
      lang: 'json',
      snippet: JSON.stringify({ mcpServers: { generatorai: { command: MCP_SERVER_COMMAND, args: [...MCP_SERVER_ARGS] } } }, null, 2),
    },
  ];
}
