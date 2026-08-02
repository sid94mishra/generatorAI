// ────────────────────────────────────────────────────────────────
// HookFacade — ai.hooks.*
//
// Register custom function-based hook handlers that can be referenced
// in workflow definitions via { type: 'function', handlerName: '...' }.
// ────────────────────────────────────────────────────────────────

import type { CoreServices, HookExecutor } from '@generatorai/core';

export interface HookContext {
  workflowId: string;
  stageId?: string;
  runId?: string;
  variables: Record<string, unknown>;
  args?: Record<string, unknown>;
}

export interface HookResult {
  variables?: Record<string, unknown>;
  contextMessages?: Array<{ content: string }>;
  attachments?: Array<{
    filename: string;
    content: string;
    contentType?: string;
  }>;
}

export type HookHandler = (ctx: HookContext) => Promise<HookResult | void>;

export class HookFacade {
  private hookExecutor: HookExecutor;
  private unregisterFns = new Map<string, () => void>();

  constructor(private services: CoreServices) {
    this.hookExecutor = services.hookExecutor;
  }

  /**
   * Register a named function hook handler.
   *
   * Usage in workflow definition:
   * ```json
   * { "phase": "pre_stage", "config": { "type": "function", "handlerName": "myHandler" } }
   * ```
   *
   * SDK registration:
   * ```typescript
   * ai.hooks.register('myHandler', async (ctx) => {
   *   return { variables: { processed: true } };
   * });
   * ```
   */
  register(handlerName: string, handler: HookHandler): () => void {
    const unregister = this.hookExecutor.registerFunctionHandler(handlerName, handler as never);
    this.unregisterFns.set(handlerName, unregister);
    return unregister;
  }

  /**
   * Unregister a function hook handler.
   */
  unregister(handlerName: string): void {
    const fn = this.unregisterFns.get(handlerName);
    if (fn) {
      fn();
      this.unregisterFns.delete(handlerName);
    }
  }

  /**
   * Check if a named handler is registered.
   */
  has(handlerName: string): boolean {
    return this.hookExecutor.hasFunctionHandler(handlerName);
  }

  /**
   * List all registered handler names tracked by this facade.
   */
  list(): string[] {
    return Array.from(this.unregisterFns.keys());
  }
}
