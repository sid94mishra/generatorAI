// ────────────────────────────────────────────────────────────────
// Tool factory — wraps domain ToolDefinition[] into SDK tools
// ────────────────────────────────────────────────────────────────

import { defineTool } from '@github/copilot-sdk';
import type { Tool } from '@github/copilot-sdk';
import type { ToolDefinition } from '@generatorai/core';

/**
 * Wraps a single domain ToolDefinition into a Copilot SDK tool
 * using the `defineTool` helper from @github/copilot-sdk.
 */
export function createSdkTool(toolDef: ToolDefinition): Tool {
  return defineTool(toolDef.name, {
    description: toolDef.description,
    parameters: toolDef.parametersSchema,
    ...(toolDef.skipPermission ? { skipPermission: true } : {}),
    handler: async (args: unknown) => {
      // Validate args is a proper object before passing to domain handler.
      // The SDK may pass null, undefined, or a primitive; normalise to {}.
      const safeArgs =
        args != null && typeof args === 'object' && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      return toolDef.handler(safeArgs);
    },
  });
}

/**
 * Batch-converts domain ToolDefinition[] into SDK tool objects
 * suitable for passing to CopilotSession creation.
 */
export function buildSdkTools(toolDefs: ToolDefinition[]): Tool[] {
  return toolDefs.map(createSdkTool);
}
