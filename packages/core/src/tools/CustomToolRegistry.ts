// ────────────────────────────────────────────────────────────────
// CustomToolRegistry — TOL-01 harness-agnostic custom-tool catalog.
//
// One registry per process. Modules (workflows, platform plug-ins,
// composition root) register their custom tools once at boot; adapters
// pull the compiled list when creating a conversation. Workflows refer
// to tools by name rather than inlining the definition.
//
// Design notes
// -------------
// - The registry does NOT depend on any harness — it stores
//   `ToolDefinition` objects as defined in `IAgentHarness.ts`. When the
//   Copilot adapter creates a session it calls `registry.list()` and
//   hands the result to `buildSdkTools`. A future Claude or OpenAI
//   adapter would do the same against its own tool compiler.
// - Double-registration throws — a silent overwrite would hide collisions
//   between plug-ins.
// - `unregister` returns true/false so callers can tell if they actually
//   removed something.
// - `getSubset(names)` lets workflow definitions pick a whitelisted slice
//   without exposing the full registry, matching the Copilot SDK's
//   `availableTools` semantics.
// ────────────────────────────────────────────────────────────────

import type { ToolDefinition } from '../domain/ports/IAgentHarness.js';

export class CustomToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  /** Register a tool by name. Throws if the name is already registered. */
  register(tool: ToolDefinition): void {
    if (!tool.name || !tool.name.trim()) {
      throw new Error('CustomToolRegistry.register: tool.name is required');
    }
    if (this.tools.has(tool.name)) {
      throw new Error(
        `CustomToolRegistry: tool '${tool.name}' already registered` +
        (tool.owner ? ` (attempted by owner '${tool.owner}')` : ''),
      );
    }
    this.tools.set(tool.name, tool);
  }

  /** Remove a tool. Returns true if the tool was registered and removed. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Exact-name lookup. Returns undefined if not registered. */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** All registered tools, in registration order. */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** Tool names, in registration order. */
  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Return a filtered slice — preserves registration order, silently
   * drops unknown names. Callers that need strict resolution should
   * check `get(name)` explicitly for each entry.
   */
  getSubset(names: readonly string[]): ToolDefinition[] {
    const result: ToolDefinition[] = [];
    for (const name of names) {
      const t = this.tools.get(name);
      if (t) result.push(t);
    }
    return result;
  }

  /** Clear the registry. Primarily for tests. */
  clear(): void {
    this.tools.clear();
  }

  /** Number of registered tools. */
  get size(): number {
    return this.tools.size;
  }
}
