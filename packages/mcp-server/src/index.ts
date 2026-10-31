// ────────────────────────────────────────────────────────────────
// @generatorai/mcp-server — an MCP server exposing a RUNNING GeneratorAI
// server to external MCP clients (Claude Desktop, another agent's MCP
// config, etc.) over stdio. Remote mode only (P04, W-58):
//
//   - `server.ts`  — `GeneratorAiMcpServer`, the MCP transport: the
//                    server's platform and workflow tools
//                    (`generatorai_<name>`), send_prompt, and the
//                    authoring skill as resources.
//   - `remote.ts`  — pairing as an `mcp` device (PD-22) and the tools'
//                    client over `@generatorai/client-core`.
//   - `cli.ts`     — the `generatorai-mcp` bin: `pair <code>` and `serve [--toolsets …] [--read-only]`.
// ────────────────────────────────────────────────────────────────

export { GeneratorAiMcpServer } from './server.js';
export {
  TOOL_PREFIX,
  MCP_TOOLSETS,
  MAX_WAIT_SECONDS,
  toMcpTool,
  toMcpPlatformTool,
  serverInstructions,
  parseToolsets,
  parseServeArgs,
  skillMimeType,
} from './server.js';
export type {
  McpServerOptions,
  McpAdvertisedTool,
  McpAdvertisedResource,
  AiFacade,
  AiChatApi,
  AiPlatformToolApi,
  AiWorkflowToolApi,
  McpToolset,
  AiSkillApi,
} from './server.js';
export { createMcpRuntime, loadConnection, pairMcp, remoteFacade, mcpConfigDir, type McpConnection } from './remote.js';
