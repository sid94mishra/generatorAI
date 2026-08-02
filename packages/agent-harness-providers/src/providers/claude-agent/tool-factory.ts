// ────────────────────────────────────────────────────────────────
// Tool factory — wraps domain ToolDefinition[] into SDK MCP server
// ────────────────────────────────────────────────────────────────

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { ToolDefinition } from '@generatorai/core';
import { jsonSchemaToZodShape } from './jsonSchemaToZodShape.js';

const MCP_SERVER_NAME = 'generatorai-tools';

/**
 * Wraps domain ToolDefinition[] into an in-process SDK MCP server.
 * Returns the MCP server config and the list of fully-qualified tool names.
 *
 * Each tool name becomes `mcp__generatorai-tools__<name>` in the SDK's
 * tool namespace, which is how you reference them in `allowedTools`.
 */
export function buildClaudeAgentMcpTools(toolDefs: ToolDefinition[]): {
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
        try {
          const result = await def.handler(args);
          let text: string;
          try {
            text = typeof result === 'string' ? result : JSON.stringify(result);
          } catch {
            text = String(result);
          }
          return {
            content: [
              {
                type: 'text' as const,
                text,
              },
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
