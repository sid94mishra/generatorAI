// ────────────────────────────────────────────────────────────────
// Tool factory — wraps domain ToolDefinition[] into SDK tools
// ────────────────────────────────────────────────────────────────

import { defineTool } from '@github/copilot-sdk';
import type { Tool } from '@github/copilot-sdk';
import { takeToolBinaries, type ToolDefinition } from '@generatorai/core';
import type { ToolSemaphore } from '../../toolSemaphore.js';

/**
 * Wraps a single domain ToolDefinition into a Copilot SDK tool
 * using the `defineTool` helper from @github/copilot-sdk.
 *
 * @param semaphore W13 — optional semaphore bounding parallel tool execution,
 *   same mechanism `ClaudeAgentProvider` uses. Without one, a model emitting N
 *   tool calls in one turn spawns N concurrent handler invocations with no
 *   limit — this used to be true for every Copilot session regardless of
 *   `MAX_PARALLEL_TOOLS`, since only the claude-agent tool factory applied it.
 *
 *   As of W13 the call goes through `runGuarded`, so the semaphore also
 *   carries the truncation latch (B1), the poison-pill downgrade, the per-item
 *   timeout and the per-record byte cap. Those default to ON inside
 *   `ToolSemaphore`; passing one is all a provider has to do.
 * @param conversationId W13 / B1 — enables the truncation latch for this
 *   conversation's handlers. See the claude-agent factory for why it is keyed.
 */
export function createSdkTool(
  toolDef: ToolDefinition,
  semaphore?: ToolSemaphore,
  conversationId?: string,
): Tool {
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
      const runHandler = () => toolDef.handler(safeArgs);
      const result = semaphore
        ? await semaphore.runGuarded(toolDef.name, runHandler, {
            ...(conversationId !== undefined ? { conversationId } : {}),
          })
        : await runHandler();

      // A tool that captured an image meant the MODEL to see it. Left in the
      // text channel it would arrive as a wall of base64; the SDK carries it
      // properly on `binaryResultsForLlm`.
      const { text, binaries } = takeToolBinaries(result);

      // W13 — per-record byte cap with drop-on-exceed, applied after
      // `takeToolBinaries` so images are measured on their own channel and the
      // cap counts exactly the text that will reach the model.
      const capped = semaphore ? semaphore.byteCap.apply(text, toolDef.name) : undefined;
      if (binaries.length === 0) {
        // Preserve the SDK-native passthrough when nothing was capped: the
        // domain handler's own result shape (which may carry `resultType`,
        // structured fields, etc.) is richer than a bare string.
        return capped?.capped ? capped.value : result;
      }
      return {
        textResultForLlm: capped
          ? capped.value
          : typeof text === 'string' ? text : JSON.stringify(text),
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
export function buildSdkTools(
  toolDefs: ToolDefinition[],
  semaphore?: ToolSemaphore,
  conversationId?: string,
): Tool[] {
  return toolDefs.map((def) => createSdkTool(def, semaphore, conversationId));
}
