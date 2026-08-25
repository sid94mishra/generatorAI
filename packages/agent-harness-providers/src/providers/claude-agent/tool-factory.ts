// ────────────────────────────────────────────────────────────────
// Tool factory — wraps domain ToolDefinition[] into SDK MCP server
// ────────────────────────────────────────────────────────────────

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { takeToolBinaries, type ToolDefinition } from '@generatorai/core';
import { jsonSchemaToZodShape } from './jsonSchemaToZodShape.js';

const MCP_SERVER_NAME = 'generatorai-tools';

/**
 * W13 / X-1 — Minimal FIFO semaphore for bounding parallel tool execution.
 *
 * Declared locally (rather than imported from @generatorai/core) because
 * agent-harness-providers must not import from the services layer, only from
 * the domain ports layer, and Semaphore lives in core/utils (services layer).
 */
export class ToolSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  /** @param permits Max concurrent tool calls. <= 0 means unlimited. */
  constructor(readonly permits: number) {
    this.available = permits > 0 ? permits : Number.POSITIVE_INFINITY;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>((resolve) => { this.waiters.push(resolve); });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) { next(); } else { this.available++; }
  }

  /** Run `fn` with one permit held, releasing it on completion or error. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); } finally { this.release(); }
  }
}

/**
 * Wraps domain ToolDefinition[] into an in-process SDK MCP server.
 * Returns the MCP server config and the list of fully-qualified tool names.
 *
 * Each tool name becomes `mcp__generatorai-tools__<name>` in the SDK's
 * tool namespace, which is how you reference them in `allowedTools`.
 *
 * @param semaphore W13 / X-1 — optional semaphore bounding parallel tool
 *   execution. When provided, each tool call acquires one permit before
 *   running the handler, bounding concurrent executions to `permits`.
 */
export function buildClaudeAgentMcpTools(
  toolDefs: ToolDefinition[],
  semaphore?: ToolSemaphore,
): {
  mcpServerConfig: ReturnType<typeof createSdkMcpServer>;
  toolNames: string[];
} {
  if (toolDefs.length === 0) {
    return { mcpServerConfig: createSdkMcpServer({ name: MCP_SERVER_NAME, version: '1.0.0', tools: [] }), toolNames: [] };
  }

  // The SDK's tool() helper (and the underlying @modelcontextprotocol/sdk
  // v1.29+) require `inputSchema` to be a Zod raw shape — a raw JSON Schema
  // object is rejected. Our domain tools describe parameters as JSON Schema,
  // so we translate to a Zod raw shape here. The domain handler still does
  // the authoritative arg validation.
  const sdkTools = toolDefs.map((def) => {
    return {
      name: def.name,
      description: def.description,
      inputSchema: jsonSchemaToZodShape(def.parametersSchema),
      handler: async (args: Record<string, unknown>) => {
        // W13 / X-1 — apply the parallel-tool semaphore when provided.
        const runHandler = () => def.handler(args);
        try {
          const result = semaphore ? await semaphore.run(runHandler) : await runHandler();
          // MCP content blocks carry images natively, so an attachment goes on
          // the wire as one rather than as base64 inside the text.
          const { text: payload, binaries } = takeToolBinaries(result);
          let text: string;
          try {
            text = typeof payload === 'string' ? payload : JSON.stringify(payload);
          } catch {
            text = String(payload);
          }
          return {
            content: [
              {
                type: 'text' as const,
                text,
              },
              ...binaries.map((b) => ({
                type: 'image' as const,
                data: b.data,
                mimeType: b.mimeType,
              })),
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    };
  });

  const mcpServerConfig = createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: '1.0.0',
    tools: sdkTools as Parameters<typeof createSdkMcpServer>[0]['tools'],
  });

  const toolNames = toolDefs.map(
    (d) => `mcp__${MCP_SERVER_NAME}__${d.name}`,
  );

  return { mcpServerConfig, toolNames };
}

/**
 * Returns the fully-qualified MCP tool name for a domain tool.
 */
export function getQualifiedToolName(toolName: string): string {
  return `mcp__${MCP_SERVER_NAME}__${toolName}`;
}
