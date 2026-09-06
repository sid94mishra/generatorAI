// ────────────────────────────────────────────────────────────────
// @generatorai/mcp-server — a real MCP server exposing GeneratorAI to
// external MCP clients (Claude Desktop, another agent's MCP config, etc.)
// over stdio.
//
//   - `toolAdapter.ts`   — translates `CustomToolRegistry` entries (TOL-05)
//                          into the MCP `Tool` advertisement shape.
//   - `server.ts`        — `GeneratorAiMcpServer`, the actual MCP transport:
//                          three built-in tools (list chats, send a prompt,
//                          run a workflow) plus every registered custom tool.
//   - `cli.ts`            — `generatorai-mcp-server` bin entry: boots a
//                          `@generatorai/sdk` `GeneratorAI` instance and
//                          serves it over stdio, run the same way a bundled
//                          MCP server is (`npx @modelcontextprotocol/
//                          server-x`).
// ────────────────────────────────────────────────────────────────

export {
  toMcpTool,
  advertiseRegistry,
  invokeRegisteredTool,
} from './toolAdapter.js';
export type { McpAdvertisedTool } from './toolAdapter.js';

export { GeneratorAiMcpServer } from './server.js';
export type {
  McpServerOptions,
  AiFacade,
  AiChatApi,
  AiChatSummary,
  AiWorkflowApi,
} from './server.js';
