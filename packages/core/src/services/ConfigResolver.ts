// ────────────────────────────────────────────────────────────────
// ConfigResolver — gathers the client-lifecycle hooks declared by the
// registered workflow templates.
// ────────────────────────────────────────────────────────────────

import type { HookDefinition } from '@generatorai/shared';
import type { TemplateRegistry } from './TemplateRegistry.js';

export class ConfigResolver {
  constructor(public readonly templateRegistry: TemplateRegistry) {}

  /**
   * Resolve global hooks (not tied to any specific template).
   * These are hooks that trigger on Copilot CLI client lifecycle events.
   * Gathered from all templates that define client-level hooks.
   */
  resolveGlobalHooks(): HookDefinition[] {
    const globalPhases = new Set([
      'on_client_start',
      'on_client_stop',
      'on_client_error',
      'on_client_restart',
    ]);

    const hooks: HookDefinition[] = [];
    for (const template of this.templateRegistry.getAllWorkflowTemplates()) {
      for (const hook of template.hooks) {
        if (globalPhases.has(hook.phase) && hook.enabled) {
          hooks.push(hook);
        }
      }
    }

    // Deduplicate by hook ID (first wins)
    const seen = new Set<string>();
    return hooks.filter((h) => {
      if (seen.has(h.id)) return false;
      seen.add(h.id);
      return true;
    });
  }
}
