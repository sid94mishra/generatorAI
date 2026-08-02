// ────────────────────────────────────────────────────────────────
// Event mapper — maps Claude Agent SDK messages → domain AgentEvent
//
// Two-phase mapping pattern (unified with copilot mapper):
//   Phase 1: Resolve SDK message type → AgentEventKind(s)
//   Phase 2: Populate payload via switch/case on resolved kind
//
// Unlike the Copilot SDK (which emits one event per callback), the
// Claude Agent SDK can emit a single message containing multiple
// content blocks → multiple AgentEvents. The architecture handles
// this by processing each block independently through the same
// two-phase pipeline.
// ────────────────────────────────────────────────────────────────

import type { AgentEvent, AgentEventKind } from '@generatorai/shared';
import { createAgentEvent } from '@generatorai/shared';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// Helper type for narrowing system messages
type SystemLike = { type: 'system'; subtype: string; [key: string]: unknown };

// ── Phase 1: Kind Resolution ──
// For Claude Agent SDK, kind resolution is per-block/per-event-type
// since one message can produce multiple events. These tables map
// the deterministic subtypes.

const SYSTEM_SUBTYPE_TO_KIND: Record<string, AgentEventKind> = {
  'init': 'harness.session_start',
  'compact_boundary': 'harness.session_info',
  'notification': 'harness.session_info',
  'status': 'harness.session_info',
  'task_notification': 'harness.session_info',
  'task_started': 'harness.session_info',
  'task_progress': 'harness.session_info',
  'task_updated': 'harness.session_info',
  'session_state_changed': 'harness.session_info',
};

const STREAM_EVENT_TYPE_TO_KIND: Record<string, AgentEventKind> = {
  'message_start': 'harness.turn_start',
  'message_stop': 'harness.turn_end',
};

const EPHEMERAL_MESSAGE_TYPE_TO_KIND: Record<string, AgentEventKind> = {
  'rate_limit_event': 'harness.session_info',
  'tool_progress': 'harness.session_info',
  'auth_status': 'harness.session_info',
  'prompt_suggestion': 'harness.session_info',
  'tool_use_summary': 'harness.session_info',
};

// ── Phase 2: Payload Builders ──
// Consistent payload shapes matching the copilot mapper output.
// Each function produces the exact same data keys for the same kind.

function buildTokenPayload(text: string) {
  return { text };
}

function buildMessageCompletePayload(content: string) {
  return { content };
}

function buildReasoningDeltaPayload(text: string) {
  return { text };
}

function buildReasoningCompletePayload(content: string) {
  return { content };
}

function buildToolStartPayload(
  tool: string,
  args: unknown,
  callId: string | null,
  parentToolCallId?: string,
) {
  return {
    tool,
    args,
    callId,
    ...(parentToolCallId ? { parentToolCallId } : {}),
  };
}

function buildToolCompletePayload(
  tool: string,
  callId: string | null,
  result: unknown,
  success: boolean,
) {
  return { tool, callId, result, success };
}

/**
 * Per-model usage stats from a `result` message.
 *
 * The SDK reports these per model id; `contextWindow` / `maxOutputTokens` are
 * the model's real limits as served to THIS account, which is strictly better
 * than inferring them from the alias name.
 */
interface ClaudeModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
}

/**
 * Pick the model that actually did the work.
 *
 * `Object.keys(modelUsage)[0]` is insertion-ordered, so a cheap sub-agent
 * model (haiku for a summary, say) could shadow the main model. Choosing the
 * entry with the most tokens is stable and matches what the user selected.
 */
function dominantModelUsage(
  modelUsage: Record<string, unknown> | undefined,
): { model: string; usage: ClaudeModelUsage } | null {
  const entries = Object.entries(modelUsage ?? {});
  if (entries.length === 0) return null;
  let best: { model: string; usage: ClaudeModelUsage; total: number } | null = null;
  for (const [model, raw] of entries) {
    const usage = (raw ?? {}) as ClaudeModelUsage;
    const total =
      (usage.inputTokens ?? 0) +
      (usage.cacheReadInputTokens ?? 0) +
      (usage.cacheCreationInputTokens ?? 0) +
      (usage.outputTokens ?? 0);
    if (!best || total > best.total) best = { model, usage, total };
  }
  return best ? { model: best.model, usage: best.usage } : null;
}

function buildUsagePayload(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cost?: number,
  durationMs?: number,
  cacheReadTokens?: number,
  cacheWriteTokens?: number,
) {
  return {
    model,
    inputTokens,
    outputTokens,
    cost,
    durationMs,
    provider: 'claude-agent' as const,
    ...(cacheReadTokens != null ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens != null ? { cacheWriteTokens } : {}),
  };
}

function buildErrorPayload(message: string) {
  return { message, provider: 'claude-agent' as const };
}

function buildSessionInfoPayload(infoType: string, message: string) {
  return { infoType, message } as { infoType: string; message: string; [key: string]: unknown };
}

// ── Public API ──

/**
 * Maps a single Claude Agent SDK message to one or more domain AgentEvents.
 *
 * Phase 1: Determine which AgentEventKind(s) this message produces
 * Phase 2: Populate consistent payload for each resolved kind
 *
 * A single SDK message can produce multiple events (e.g. AssistantMessage
 * with both text and tool_use content blocks).
 */
export function mapClaudeAgentMessageToAgentEvents(message: SDKMessage): AgentEvent[] {
  const events: AgentEvent[] = [];

  switch (message.type) {
    // ── Assistant message (full, non-streaming) ──
    case 'assistant': {
      const betaMsg = message.message;
      if (!betaMsg?.content) break;

      for (const block of betaMsg.content) {
        switch (block.type) {
          case 'text':
            events.push(createAgentEvent(
              'harness.message_complete',
              buildMessageCompletePayload(block.text),
            ));
            break;

          case 'tool_use':
            events.push(createAgentEvent(
              'harness.tool_start',
              buildToolStartPayload(
                block.name,
                block.input,
                block.id,
                message.parent_tool_use_id ?? undefined,
              ),
            ));
            break;

          case 'thinking':
            events.push(createAgentEvent(
              'harness.reasoning_complete',
              buildReasoningCompletePayload(
                (block as unknown as { thinking: string }).thinking ?? '',
              ),
            ));
            break;
        }
      }

      if (message.error) {
        events.push(createAgentEvent('harness.error', buildErrorPayload(message.error)));
      }
      break;
    }

    // ── User message (tool results) ──
    case 'user': {
      const betaMsg = message.message;
      if (!betaMsg?.content || !Array.isArray(betaMsg.content)) break;

      for (const block of betaMsg.content) {
        if (block.type === 'tool_result') {
          const resultContent = Array.isArray(block.content)
            ? block.content
                .map((c: { type: string; text?: string }) => c.type === 'text' ? (c.text ?? '') : '')
                .join('')
            : typeof block.content === 'string'
              ? block.content
              : '';

          events.push(createAgentEvent(
            'harness.tool_complete',
            buildToolCompletePayload('unknown', block.tool_use_id, resultContent, !block.is_error),
          ));
        }
      }
      break;
    }

    // ── Stream event (partial/delta) ──
    case 'stream_event': {
      const streamEvent = message.event;
      if (!streamEvent) break;

      switch (streamEvent.type) {
        case 'content_block_delta': {
          const delta = streamEvent.delta;
          if (!delta || !('type' in delta)) break;

          switch (delta.type) {
            case 'text_delta':
              events.push(createAgentEvent(
                'harness.token',
                buildTokenPayload((delta as unknown as { text: string }).text ?? ''),
              ));
              break;

            case 'thinking_delta':
              events.push(createAgentEvent(
                'harness.reasoning_delta',
                buildReasoningDeltaPayload((delta as unknown as { thinking: string }).thinking ?? ''),
              ));
              break;

            case 'input_json_delta':
              events.push(createAgentEvent(
                'harness.session_info',
                buildSessionInfoPayload(
                  'tool_input_delta',
                  (delta as unknown as { partial_json: string }).partial_json ?? '',
                ),
              ));
              break;
          }
          break;
        }

        case 'content_block_start': {
          const contentBlock = (streamEvent as unknown as { content_block?: { type: string; id?: string; name?: string } }).content_block;
          if (contentBlock?.type === 'tool_use') {
            events.push(createAgentEvent(
              'harness.tool_start',
              buildToolStartPayload(
                contentBlock.name ?? 'unknown',
                {},
                contentBlock.id ?? null,
                message.parent_tool_use_id ?? undefined,
              ),
            ));
          }
          break;
        }

        case 'message_start':
          events.push(createAgentEvent('harness.turn_start', { turnId: message.uuid ?? '' }));
          break;

        case 'message_stop':
          events.push(createAgentEvent('harness.turn_end', { turnId: message.uuid ?? '' }));
          break;
      }
      break;
    }

    // ── Result message ──
    case 'result': {
      const dominant = dominantModelUsage(
        message.modelUsage as unknown as Record<string, unknown> | undefined,
      );
      const model = dominant?.model ?? 'unknown';
      const mu = dominant?.usage;

      // Anthropic's `usage.input_tokens` EXCLUDES cached tokens, so the raw
      // value badly understates how much context was actually sent. Cache
      // reads and cache writes both occupy the window and must be added back.
      const cacheReadTokens =
        mu?.cacheReadInputTokens ?? message.usage?.cache_read_input_tokens ?? 0;
      const cacheWriteTokens =
        mu?.cacheCreationInputTokens ?? message.usage?.cache_creation_input_tokens ?? 0;
      const inputTokens = mu?.inputTokens ?? message.usage?.input_tokens ?? 0;
      const outputTokens = mu?.outputTokens ?? message.usage?.output_tokens ?? 0;

      events.push(createAgentEvent(
        'harness.usage',
        buildUsagePayload(
          model,
          inputTokens,
          outputTokens,
          message.total_cost_usd,
          message.duration_ms,
          cacheReadTokens,
          cacheWriteTokens,
        ),
      ));

      // A derived context snapshot so the gauge has something truthful even
      // before `getContextUsage()` answers. `contextWindow` here is the total
      // window; the prompt budget excludes the completion reserve.
      //
      // Skipped entirely when the turn reported no tokens at all — that means
      // the query failed (auth, abort) rather than that the context is empty,
      // and publishing "0 / 200k · 0%" would state a falsehood confidently.
      const contextTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
      if (contextTokens > 0) {
        const totalContextWindow = mu?.contextWindow;
        const maxOutputTokens = mu?.maxOutputTokens;
        const promptTokenLimit =
          totalContextWindow != null
            ? Math.max(0, totalContextWindow - (maxOutputTokens ?? 0))
            : undefined;
        events.push(createAgentEvent('harness.context_usage', {
          provider: 'claude-agent',
          model,
          source: 'derived',
          currentTokens: contextTokens,
          ...(promptTokenLimit != null ? { promptTokenLimit } : {}),
          ...(totalContextWindow != null ? { totalContextWindow } : {}),
          apiUsage: {
            input: inputTokens,
            output: outputTokens,
            cacheRead: cacheReadTokens,
            cacheWrite: cacheWriteTokens,
          },
        }));
      }

      if (message.subtype === 'success') {
        events.push(createAgentEvent('harness.idle', {} as Record<string, never>));
      } else {
        events.push(createAgentEvent(
          'harness.error',
          buildErrorPayload(message.errors?.join('; ') ?? `Query failed: ${message.subtype}`),
        ));
      }
      break;
    }

    // ── System messages ──
    case 'system': {
      const sys = message as unknown as SystemLike;
      const kind = SYSTEM_SUBTYPE_TO_KIND[sys.subtype] ?? 'harness.session_info';

      switch (sys.subtype) {
        case 'init':
          events.push(createAgentEvent('harness.session_start', { provider: 'claude-agent' }));
          break;

        case 'compact_boundary': {
          // The gauge must DROP after compaction. `post_tokens` is the
          // authoritative post-compaction fill; when the SDK omits it (older
          // builds) we still surface the boundary so the UI can invalidate.
          const meta = (sys['compact_metadata'] ?? {}) as {
            trigger?: string;
            pre_tokens?: number;
            post_tokens?: number;
          };
          events.push(createAgentEvent(kind, buildSessionInfoPayload(
            'compact_boundary',
            `Context compacted (${meta.trigger ?? 'auto'})`,
          )));
          if (typeof meta.post_tokens === 'number') {
            events.push(createAgentEvent('harness.context_usage', {
              provider: 'claude-agent',
              source: 'provider',
              currentTokens: meta.post_tokens,
            }));
          }
          break;
        }

        case 'notification':
          events.push(createAgentEvent(kind, buildSessionInfoPayload('notification', String(sys.text ?? ''))));
          break;

        case 'status':
          events.push(createAgentEvent(kind, buildSessionInfoPayload('status', String(sys.status ?? ''))));
          break;

        case 'task_notification':
          events.push(createAgentEvent(kind, buildSessionInfoPayload(
            `task_${String(sys.status ?? 'unknown')}`,
            `Task ${String(sys.task_id ?? '')}: ${String(sys.status ?? '')}`,
          )));
          break;

        case 'task_started':
          events.push(createAgentEvent(kind, buildSessionInfoPayload(
            'subagent_started',
            `Sub-agent started: ${String(sys.description ?? '')}`,
          )));
          break;

        case 'task_progress':
          events.push(createAgentEvent(kind, buildSessionInfoPayload(
            'task_progress',
            String(sys.summary ?? sys.description ?? ''),
          )));
          break;

        case 'task_updated':
          events.push(createAgentEvent(kind, buildSessionInfoPayload(
            'task_updated',
            String((sys.patch as Record<string, unknown>)?.status ?? ''),
          )));
          break;

        case 'session_state_changed':
          events.push(createAgentEvent(kind, buildSessionInfoPayload(
            'session_state_changed',
            String(sys.state ?? ''),
          )));
          break;

        default:
          events.push(createAgentEvent('harness.session_info', buildSessionInfoPayload(String(sys.subtype), '')));
          break;
      }
      break;
    }

    // ── Ephemeral message types (rate_limit, tool_progress, auth, etc.) ──
    case 'rate_limit_event':
      events.push(createAgentEvent(
        'harness.session_info',
        buildSessionInfoPayload('rate_limit', `Rate limit: ${message.rate_limit_info?.status ?? 'unknown'}`),
      ));
      break;

    case 'tool_progress':
      events.push(createAgentEvent(
        'harness.session_info',
        buildSessionInfoPayload('tool_progress', String((message as unknown as Record<string, unknown>).content ?? '')),
      ));
      break;

    case 'auth_status':
      events.push(createAgentEvent(
        'harness.session_info',
        buildSessionInfoPayload('auth_status', `Auth: ${message.isAuthenticating ? 'authenticating' : 'ready'}`),
      ));
      break;

    case 'prompt_suggestion':
      events.push(createAgentEvent(
        'harness.session_info',
        buildSessionInfoPayload('prompt_suggestion', String((message as unknown as Record<string, unknown>).suggestion ?? '')),
      ));
      break;

    case 'tool_use_summary':
      events.push(createAgentEvent(
        'harness.session_info',
        buildSessionInfoPayload('tool_use_summary', ''),
      ));
      break;

    // ── Catch-all ──
    default:
      events.push(createAgentEvent('harness.unknown', { raw: message, provider: 'claude-agent' }));
      break;
  }

  return events;
}

/**
 * Batch mapper for arrays of SDK messages.
 */
export function mapClaudeAgentMessagesToAgentEvents(messages: SDKMessage[]): AgentEvent[] {
  return messages.flatMap(mapClaudeAgentMessageToAgentEvents);
}
