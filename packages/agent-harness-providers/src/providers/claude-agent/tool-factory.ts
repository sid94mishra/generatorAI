// ────────────────────────────────────────────────────────────────
// Tool factory — wraps domain ToolDefinition[] into SDK MCP server
// ────────────────────────────────────────────────────────────────

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { takeToolBinaries, type ToolDefinition } from '@generatorai/core';
import { jsonSchemaToZodShape } from './jsonSchemaToZodShape.js';
import { ToolSemaphore } from '../../toolSemaphore.js';

const MCP_SERVER_NAME = 'generatorai-tools';

// W13 / X-1 — `ToolSemaphore` moved to `../../toolSemaphore.js` so
// CopilotProvider's tool factory can share it instead of going without a
// concurrency bound entirely. Re-exported here so existing imports of
// `ToolSemaphore` from this module (e.g. `ClaudeAgentProvider.ts`) keep working.
export { ToolSemaphore };

/**
 * Wraps domain ToolDefinition[] into an in-process SDK MCP server.
 * Returns the MCP server config and the list of fully-qualified tool names.
 *
 * Each tool name becomes `mcp__generatorai-tools__<name>` in the SDK's
 * tool namespace, which is how you reference them in `allowedTools`.
 *
 * @param semaphore W13 / X-1 — optional semaphore bounding parallel tool
 *   execution. When provided, each tool call goes through `runGuarded`, which
 *   applies the whole W13 ladder and not just the permit: the truncation latch
 *   (B1 — a truncated response never executes a tool), the poison-pill
 *   downgrade, the per-item timeout, and the per-record byte cap on the result.
 *   All of those default to ON inside `ToolSemaphore`, so a provider that only
 *   ever wrote `new ToolSemaphore(MAX_PARALLEL_TOOLS)` gets them for free.
 * @param conversationId W13 / B1 — enables the truncation latch for this
 *   conversation's handlers. Omit and the latch is skipped (steps 2-6 still
 *   apply): a latch keyed globally would let a truncation in one conversation
 *   refuse another conversation's tools on a shared provider instance.
 */
export function buildClaudeAgentMcpTools(
  toolDefs: ToolDefinition[],
  semaphore?: ToolSemaphore,
  conversationId?: string,
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
        // W13 — the whole ladder, not just the permit. See `runGuarded`.
        const runHandler = () => def.handler(args);
        try {
          const result = semaphore
            ? await semaphore.runGuarded(def.name, runHandler, {
                ...(conversationId !== undefined ? { conversationId } : {}),
              })
            : await runHandler();
          // MCP content blocks carry images natively, so an attachment goes on
          // the wire as one rather than as base64 inside the text.
          const { text: payload, binaries } = takeToolBinaries(result);
          let text: string;
          try {
            text = typeof payload === 'string' ? payload : JSON.stringify(payload);
          } catch {
            text = String(payload);
          }
          // W13 — per-record byte cap with drop-on-exceed. Applied AFTER
          // `takeToolBinaries` so an image that was correctly moved to its own
          // content block is not counted against the text budget, and so the
          // cap measures exactly the bytes that will reach the model.
          if (semaphore) {
            text = semaphore.byteCap.apply(text, def.name).value;
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
