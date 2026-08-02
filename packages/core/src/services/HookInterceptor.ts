// ────────────────────────────────────────────────────────────────
// HookInterceptor — intercepts SDK events and runs matching hooks
// ────────────────────────────────────────────────────────────────

import type { AgentEvent, HookDefinition, HookPhase } from '@generatorai/shared';
import type { HarnessClientEvent, IAgentHarness } from '../domain/ports/IAgentHarness.js';
import type {
  HookBridge,
  PreToolUseHookOutput,
  PostToolUseHookOutput,
  UserPromptSubmittedHookOutput,
  SessionStartHookOutput,
  SessionEndHookOutput,
  ErrorOccurredHookOutput,
} from '../domain/ports/IHookBridge.js';
import type { EventBus } from '../events/EventBus.js';
import type { HookExecutor, HookContext } from './HookExecutor.js';
import { createAgentEvent } from '@generatorai/shared';

export interface SDKHookContext extends HookContext {
  sdkEvent: AgentEvent;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  messageContent?: string;
  errorMessage?: string;
}

/** Extended hook context for v2 stage-level execution */
export interface StageHookContext extends SDKHookContext {
  workflowRunId: string;
  stageRunId: string;
  stageName: string;
  stageOrder: number;
}

export class HookInterceptor {
  /**
   * Phase 2, 2.7 — tool call IDs for which a `pre_tool_use` hook returned
   * "deny". We swallow the subsequent `harness.tool_complete` event for
   * the same callId so the UI doesn't see a phantom completion for a
   * denied tool invocation.
   *
   * Keyed by `callId` (when the SDK supplies one) or `tool` (fallback).
   * Entries auto-clear after the matching complete event arrives.
   */
  private deniedTools = new Set<string>();

  constructor(
    private hookExecutor: HookExecutor,
    private eventBus: EventBus,
  ) {}

  private toolKey(e: AgentEvent): string | null {
    if (e.kind !== 'harness.tool_start' && e.kind !== 'harness.tool_complete') {
      return null;
    }
    const data = e.data as Record<string, unknown>;
    const callId = data['callId'];
    if (typeof callId === 'string' && callId.length > 0) return `cid:${callId}`;
    const tool = data['tool'];
    if (typeof tool === 'string') return `tool:${tool}`;
    return null;
  }

  /**
   * Create an intercepted event handler that runs SDK lifecycle hooks
   * before forwarding events to the EventBus.
   */
  createInterceptedEventHandler(
    sessionId: string,
    workflowId: string,
    hooks: HookDefinition[],
    context: HookContext,
  ): (event: AgentEvent) => Promise<void> {
    return async (event: AgentEvent) => {
      // Phase 2, 2.7 — if the SDK delivers a tool_complete for a tool that
      // was denied at pre_tool_use, suppress it. Forwarding would produce
      // a phantom "tool ran and returned" event the UI misinterprets.
      if (event.kind === 'harness.tool_complete') {
        const key = this.toolKey(event);
        if (key && this.deniedTools.has(key)) {
          this.deniedTools.delete(key);
          return;
        }
      }

      const phase = this.mapEventToHookPhase(event);

      if (phase) {
        const enrichedContext: SDKHookContext = {
          ...context,
          sdkEvent: event,
          toolName: this.extractToolName(event),
          toolArgs: this.extractToolArgs(event),
          toolResult: this.extractToolResult(event),
          messageContent: this.extractMessageContent(event),
          errorMessage: this.extractErrorMessage(event),
        };

        const phaseResult = await this.hookExecutor.executePhase(
          phase,
          hooks,
          enrichedContext,
        );

        // If pre_tool_use hook aborted, block the event
        if (!phaseResult.shouldContinue && phase === 'pre_tool_use') {
          const key = this.toolKey(event);
          if (key) this.deniedTools.add(key);
          await this.eventBus.emit(sessionId, createAgentEvent('hook.skipped', {
            hookName: `pre_tool_use:${this.extractToolName(event)}`,
            phase: 'pre_tool_use',
            reason: 'Hook denied tool execution',
          }));
          return;
        }
      }

      // Forward event to EventBus
      await this.eventBus.emit(sessionId, event);
    };
  }

  /**
   * Create an intercepted event handler for v2 stage execution.
   * Accepts StageRun context (workflowRunId, stageRunId, stageName, etc.)
   * and maps stage lifecycle events to the appropriate hook phases.
   */
  createStageEventHandler(
    sessionId: string,
    hooks: HookDefinition[],
    context: HookContext & { workflowRunId: string; stageRunId: string; stageName: string; stageOrder: number },
  ): (event: AgentEvent) => Promise<void> {
    return async (event: AgentEvent) => {
      // Phase 2, 2.7 — suppress tool_complete for denied tools (stage-level).
      if (event.kind === 'harness.tool_complete') {
        const key = this.toolKey(event);
        if (key && this.deniedTools.has(key)) {
          this.deniedTools.delete(key);
          return;
        }
      }

      const phase = this.mapEventToHookPhase(event) ?? this.mapStageEventToHookPhase(event);

      if (phase) {
        const enrichedContext: StageHookContext = {
          ...context,
          sdkEvent: event,
          workflowRunId: context.workflowRunId,
          stageRunId: context.stageRunId,
          stageName: context.stageName,
          stageOrder: context.stageOrder,
          toolName: this.extractToolName(event),
          toolArgs: this.extractToolArgs(event),
          toolResult: this.extractToolResult(event),
          messageContent: this.extractMessageContent(event),
          errorMessage: this.extractErrorMessage(event),
        };

        const phaseResult2 = await this.hookExecutor.executePhase(
          phase,
          hooks,
          enrichedContext,
        );

        if (!phaseResult2.shouldContinue && phase === 'pre_tool_use') {
          const key = this.toolKey(event);
          if (key) this.deniedTools.add(key);
          await this.eventBus.emit(sessionId, createAgentEvent('hook.skipped', {
            hookName: `pre_tool_use:${this.extractToolName(event)}`,
            phase: 'pre_tool_use',
            reason: 'Hook denied tool execution',
          }));
          return;
        }
      }

      // Forward event to EventBus
      await this.eventBus.emit(sessionId, event);
    };
  }

  /**
   * Register hooks for Copilot CLI client lifecycle events.
   * These fire regardless of any specific session/workflow.
   */
  registerClientLifecycleHooks(
    copilot: IAgentHarness,
    hooks: HookDefinition[],
    context: Omit<HookContext, 'workflowId'>,
  ): () => void {
    return copilot.onClientEvent(async (clientEvent: HarnessClientEvent) => {
      const phase = this.mapClientEventToHookPhase(clientEvent);
      if (phase) {
        const clientContext: HookContext = {
          ...context,
          workflowId: '__client__',
          variables: {
            ...context.variables,
            clientEventType: clientEvent.type,
            clientEventMessage: clientEvent.data?.message ?? '',
          },
        };
        await this.hookExecutor.executePhase(phase, hooks, clientContext);
      }

      // Emit as global AgentEvent for observability
      const agentEvent = this.mapClientEventToAgentEvent(clientEvent);
      if (agentEvent) {
        await this.eventBus.emitGlobal(agentEvent);
      }
    });
  }

  /** Map SDK conversation events → hook phases. */
  private mapEventToHookPhase(event: AgentEvent): HookPhase | null {
    switch (event.kind) {
      case 'harness.tool_start':
        return 'pre_tool_use';
      case 'harness.tool_complete':
        return 'post_tool_use';
      case 'harness.message_complete':
        return 'on_message';
      case 'harness.reasoning_complete':
        return 'on_reasoning';
      case 'harness.session_start':
        return 'on_session_start';
      case 'harness.idle':
        return 'on_session_idle';
      case 'harness.error':
        return 'on_session_error';
      default:
        return null;
    }
  }

  /** Map stage lifecycle events → hook phases (v2). */
  private mapStageEventToHookPhase(event: AgentEvent): HookPhase | null {
    switch (event.kind) {
      case 'stage_run.running':
        return 'pre_run';
      case 'stage_run.completed':
        return 'post_run';
      case 'stage_run.failed':
        return 'on_session_error';
      default:
        return null;
    }
  }

  /** Map client lifecycle events → hook phases. */
  private mapClientEventToHookPhase(event: HarnessClientEvent): HookPhase | null {
    switch (event.type) {
      case 'client.started':
        return 'on_client_start';
      case 'client.stopped':
        return 'on_client_stop';
      case 'client.error':
        return 'on_client_error';
      case 'client.restarting':
        return 'on_client_restart';
      default:
        return null;
    }
  }

  private mapClientEventToAgentEvent(event: HarnessClientEvent): AgentEvent | null {
    switch (event.type) {
      case 'client.started':
        return createAgentEvent('harness.client_started', {});
      case 'client.stopped':
        return createAgentEvent('harness.client_stopped', { message: event.data?.message });
      case 'client.error':
        return createAgentEvent('harness.client_error', { message: event.data?.message ?? 'Unknown error' });
      case 'client.restarting':
        return createAgentEvent('harness.client_restarting', { message: event.data?.message });
      default:
        return null;
    }
  }

  private extractToolName(e: AgentEvent): string | undefined {
    if (e.kind === 'harness.tool_start' || e.kind === 'harness.tool_complete') {
      return (e.data as Record<string, unknown>)['tool'] as string | undefined;
    }
    return undefined;
  }

  private extractToolArgs(e: AgentEvent): unknown | undefined {
    if (e.kind === 'harness.tool_start') {
      return (e.data as Record<string, unknown>)['args'];
    }
    return undefined;
  }

  private extractToolResult(e: AgentEvent): unknown | undefined {
    if (e.kind === 'harness.tool_complete') {
      return (e.data as Record<string, unknown>)['result'];
    }
    return undefined;
  }

  private extractMessageContent(e: AgentEvent): string | undefined {
    if (e.kind === 'harness.message_complete') {
      return (e.data as Record<string, unknown>)['content'] as string | undefined;
    }
    return undefined;
  }

  private extractErrorMessage(e: AgentEvent): string | undefined {
    if (e.kind === 'harness.error') {
      return (e.data as Record<string, unknown>)['message'] as string | undefined;
    }
    return undefined;
  }

  // ───────────────────────────────────────────────────────────────
  // HKS-01 — Synchronous HookBridge construction.
  //
  // `createInterceptedEventHandler` above observes AgentEvents AFTER the
  // harness emitted them — it can't actually block a tool call before it
  // runs, it can only suppress the downstream `tool_complete` when a
  // `pre_tool_use` hook denies. That works for observability but is a
  // half-measure: the tool has already partially executed by the time our
  // code sees the event.
  //
  // `buildHookBridge` returns a **domain `HookBridge`** that the adapter
  // installs into the harness's synchronous hook surface. For Copilot this
  // goes into `SessionConfig.hooks` (SDK `SessionHooks`); for future
  // Claude / OpenAI adapters it goes into whatever equivalent mechanism
  // the vendor exposes. Returning `{decision: 'deny'}` from the bridge
  // causes the harness to skip the tool call — no partial execution.
  //
  // The bridge runs the same HookExecutor + HookDefinition[] as the
  // passive path, so user-configured hooks fire in both worlds and the
  // phase semantics stay identical.
  // ───────────────────────────────────────────────────────────────
  buildHookBridge(
    hooks: HookDefinition[],
    context: HookContext,
  ): HookBridge {
    return {
      onPreToolUse: async (input) => {
        const enriched: SDKHookContext = {
          ...context,
          // Synthesise an AgentEvent shape so hook bodies that read
          // `sdkEvent.*` keep working across both passive and active paths.
          sdkEvent: { kind: 'harness.tool_start', data: { tool: input.toolName, args: input.toolArgs } },
          toolName: input.toolName,
          toolArgs: input.toolArgs,
        };
        const preToolResult = await this.hookExecutor.executePhase('pre_tool_use', hooks, enriched);
        const out: PreToolUseHookOutput = {};
        if (!preToolResult.shouldContinue) {
          out.decision = 'deny';
          out.reason = `pre_tool_use hook denied tool '${input.toolName}'`;
        }
        return out;
      },

      onPostToolUse: async (input) => {
        const enriched: SDKHookContext = {
          ...context,
          sdkEvent: { kind: 'harness.tool_complete', data: { tool: input.toolName, result: input.toolResult } },
          toolName: input.toolName,
          toolArgs: input.toolArgs,
          toolResult: input.toolResult,
        };
        await this.hookExecutor.executePhase('post_tool_use', hooks, enriched);
        const out: PostToolUseHookOutput = {};
        return out;
      },

      onUserPromptSubmitted: async (input) => {
        const enriched: SDKHookContext = {
          ...context,
          sdkEvent: { kind: 'harness.user_message', data: { content: input.prompt } },
          messageContent: input.prompt,
        };
        // The shared `HookPhase` union already has `pre_prompt`; we treat
        // `user_prompt_submit` as a synonym for user-facing consistency
        // with Claude naming. Reusing `pre_prompt` keeps existing hook
        // definitions that target "before prompt sent" working.
        await this.hookExecutor.executePhase('pre_prompt', hooks, enriched);
        const out: UserPromptSubmittedHookOutput = {};
        return out;
      },

      onSessionStart: async (input) => {
        const enriched: SDKHookContext = {
          ...context,
          sdkEvent: { kind: 'harness.session_start', data: {} },
          variables: { ...context.variables, sessionStartSource: input.source },
        };
        await this.hookExecutor.executePhase('on_session_start', hooks, enriched);
        const out: SessionStartHookOutput = {};
        return out;
      },

      onSessionEnd: async (input) => {
        const enriched: SDKHookContext = {
          ...context,
          sdkEvent: { kind: 'harness.idle', data: {} },
          variables: {
            ...context.variables,
            sessionEndReason: input.reason,
            sessionEndError: input.error ?? '',
          },
        };
        // Idle is the closest existing phase; MEM-03 will add a dedicated
        // `session_end` / `pre_compact` phase pair.
        await this.hookExecutor.executePhase('on_session_idle', hooks, enriched);
        const out: SessionEndHookOutput = {};
        return out;
      },

      onErrorOccurred: async (input) => {
        const enriched: SDKHookContext = {
          ...context,
          sdkEvent: { kind: 'harness.error', data: { message: input.error } },
          errorMessage: input.error,
          variables: {
            ...context.variables,
            errorContext: input.errorContext,
            errorRecoverable: String(input.recoverable),
          },
        };
        const errResult = await this.hookExecutor.executePhase('on_error', hooks, enriched);
        const out: ErrorOccurredHookOutput = {};
        if (!errResult.shouldContinue) out.errorHandling = 'abort';
        return out;
      },
    };
  }
}

