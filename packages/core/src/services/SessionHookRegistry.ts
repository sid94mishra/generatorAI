// ────────────────────────────────────────────────────────────────
// SessionHookRegistry — the hooks every agent session runs (W-54).
//
// `CreateConversationParams.hooks` (the synchronous HookBridge) was built
// by a `buildHookBridge` factory that no composition root ever assigned, so
// no chat hook could fire. This registry is the source that factory reads:
// in-process hooks contributed by extensions (`ai.registerHook(phase, fn)`)
// are registered here, and `sessionHookBridgeFactory` turns them into a
// bridge for each chat or stage session. With nothing registered the
// factory returns `undefined`, so a session's config is unchanged.
// ────────────────────────────────────────────────────────────────

import type { HookDefinition, HookResult } from '@generatorai/shared';
import type { StageHookPhase } from '@generatorai/workflow-spec';
import type { EventBus } from '../events/EventBus.js';
import type { FunctionHookHandlerContext, HookExecutor } from './HookExecutor.js';
import type { HookInterceptor } from './HookInterceptor.js';
import type { SessionComposerDeps } from './session/types.js';

/** A hook body registered in-process. `ctx.event` carries the tool / message the hook fires on. */
export type SessionHookHandler = (ctx: FunctionHookHandlerContext) => Promise<HookResult | void> | HookResult | void;

interface Entry {
  owner: string;
  definition: HookDefinition;
  unregisterHandler: () => void;
}

export class SessionHookRegistry {
  private readonly entries = new Map<string, Entry>();
  private seq = 0;

  constructor(private readonly hookExecutor: HookExecutor) {}

  /**
   * Register an in-process hook for `phase` on every agent session.
   * Returns its id. `owner` groups registrations for removal (an extension id).
   */
  register(
    owner: string,
    phase: StageHookPhase,
    handler: SessionHookHandler,
    opts: { priority?: number; timeoutMs?: number; failurePolicy?: HookDefinition['failurePolicy'] } = {},
  ): string {
    const id = `session-hook-${++this.seq}`;
    const handlerName = `${owner}#${id}`;
    const unregisterHandler = this.hookExecutor.registerFunctionHandler(handlerName, async (ctx) => {
      const result = await handler(ctx);
      return result ?? undefined;
    });
    const definition = {
      id,
      name: `${owner}:${phase}`,
      phase,
      type: 'function',
      priority: opts.priority ?? 0,
      enabled: true,
      failurePolicy: opts.failurePolicy ?? 'continue',
      timeoutMs: opts.timeoutMs ?? 30_000,
      retries: 0,
      config: { type: 'function', handlerName },
    } as HookDefinition;
    this.entries.set(id, { owner, definition, unregisterHandler });
    return id;
  }

  /** Remove every hook `owner` registered (extension unload). */
  unregisterByOwner(owner: string): void {
    for (const [id, entry] of this.entries) {
      if (entry.owner !== owner) continue;
      entry.unregisterHandler();
      this.entries.delete(id);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  list(): HookDefinition[] {
    return [...this.entries.values()].map((e) => e.definition);
  }
}

/**
 * The composer's `buildHookBridge`: one bridge per session over the
 * registry's hooks, for chats and stages alike. `undefined` while nothing is
 * registered, so a session without hooks keeps its config byte-identical.
 */
export function sessionHookBridgeFactory(
  registry: SessionHookRegistry,
  interceptor: HookInterceptor,
  eventBus: EventBus,
): NonNullable<SessionComposerDeps['buildHookBridge']> {
  return ({ owner, sessionId }) => {
    if (registry.size === 0) return undefined;
    return interceptor.buildHookBridge(registry.list(), {
      sessionId,
      workflowId: owner.kind === 'stage' ? owner.workflowRunId : `chat:${owner.chatId}`,
      workspacePath: '',
      variables: {},
      eventBus,
      ...(owner.kind === 'stage' ? { workflowRunId: owner.workflowRunId, stageRunId: owner.stageRunId } : {}),
    });
  };
}
