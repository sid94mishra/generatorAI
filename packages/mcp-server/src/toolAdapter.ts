// ────────────────────────────────────────────────────────────────
// toolAdapter — TOL-05 translate `CustomToolRegistry` entries into the
// Model Context Protocol `Tool` shape that external MCP clients consume.
//
// MCP's wire format for tool advertisement is:
//   { name: string, description: string, inputSchema: JSONSchema }
//
// Our `ToolDefinition` already uses a JSON-schema-like `parametersSchema`,
// so this adapter is mostly a renaming pass. The value is centralising
// it so the MCP server can evolve without touching the registry or any
// harness adapter, and vice-versa.
//
// This module is harness-agnostic: it reads only from `ToolDefinition`,
// which knows nothing about Copilot, Claude, OpenAI, etc. An MCP client
// calling our server will see the same tool schema regardless of which
// harness the current workflow is running against.
// ────────────────────────────────────────────────────────────────

import type { ToolDefinition } from '@generatorai/core';
import type { CustomToolRegistry } from '@generatorai/core';

/** Minimal MCP tool advertisement shape. Aligns with MCP spec 2025-06-18. */
export interface McpAdvertisedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Optional — MCP extension, preserved so clients can honour it. */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/** Convert a single ToolDefinition to the MCP advertisement shape. */
export function toMcpTool(tool: ToolDefinition): McpAdvertisedTool {
  // Infer a conservative "destructive" hint from declared permissions so
  // MCP clients can surface it in their UI. Tools declaring `file_write`
  // or `shell_exec` are flagged as potentially destructive; pure readers
  // get the `readOnlyHint`.
  const kinds = new Set(
    (tool.requiredPermissions ?? []).map((p) => p.kind),
  );
  const readOnly = kinds.has('file_read') && kinds.size === 1;
  const destructive = kinds.has('file_write') || kinds.has('shell_exec');

  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parametersSchema,
    annotations: {
      readOnlyHint: readOnly || undefined,
      destructiveHint: destructive || undefined,
    },
  };
}

/** Convert every tool in a registry. Preserves registration order. */
export function advertiseRegistry(registry: CustomToolRegistry): McpAdvertisedTool[] {
  return registry.list().map(toMcpTool);
}

/** Invoke a tool from its registry entry. Thin pass-through for the
 *  server layer; kept here so the registry does not have to implement
 *  an MCP-aware invocation path. */
export async function invokeRegisteredTool(
  registry: CustomToolRegistry,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = registry.get(toolName);
  if (!tool) throw new Error(`MCP: tool '${toolName}' not registered`);
  return tool.handler(args);
}
