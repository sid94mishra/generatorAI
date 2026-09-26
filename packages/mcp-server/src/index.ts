// ────────────────────────────────────────────────────────────────
// @generatorai/mcp-server — an MCP server exposing a RUNNING GeneratorAI
// server to external MCP clients (Claude Desktop, another agent's MCP
// config, etc.) over stdio. Remote mode only (P04, W-58):
//
//   - `server.ts`  — `GeneratorAiMcpServer`, the MCP transport and the
//                    built-in tools (list chats, send a prompt, run a
//                    workflow through the one invocation).
//   - `remote.ts`  — pairing as an `mcp` device (PD-22) and the tools'
//                    client over `@generatorai/client-core`.
//   - `cli.ts`     — the `generatorai-mcp` bin: `pair <code>` and `serve`.
// ────────────────────────────────────────────────────────────────

export { GeneratorAiMcpServer } from './server.js';
export type { McpServerOptions, McpAdvertisedTool, AiFacade, AiChatApi, AiChatSummary, AiWorkflowApi } from './server.js';
export { createMcpRuntime, loadConnection, pairMcp, remoteFacade, mcpConfigDir, type McpConnection } from './remote.js';
