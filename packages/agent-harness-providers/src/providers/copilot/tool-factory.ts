// ────────────────────────────────────────────────────────────────
// Tool factory — wraps domain ToolDefinition[] into SDK tools
// ────────────────────────────────────────────────────────────────

import { defineTool } from '@github/copilot-sdk';
import type { Tool } from '@github/copilot-sdk';
import { takeToolBinaries, type ToolDefinition } from '@generatorai/core';

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
      const result = await toolDef.handler(safeArgs);

      // A tool that captured an image meant the MODEL to see it. Left in the
      // text channel it would arrive as a wall of base64; the SDK carries it
      // properly on `binaryResultsForLlm`.
      const { text, binaries } = takeToolBinaries(result);
      if (binaries.length === 0) return result;
      return {
        textResultForLlm: typeof text === 'string' ? text : JSON.stringify(text),
        binaryResultsForLlm: binaries.map((b) => ({
          data: b.data,
          mimeType: b.mimeType,
          type: 'image' as const,
          ...(b.description ? { description: b.description } : {}),
        })),
        resultType: 'success' as const,
      };
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
