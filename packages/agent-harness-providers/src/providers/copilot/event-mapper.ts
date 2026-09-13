// ────────────────────────────────────────────────────────────────
// Event mapper — maps Copilot SDK SessionEvent → AgentEvent
//
// Two-phase mapping pattern (unified with claude-agent mapper):
//   Phase 1: Resolve SDK event type → AgentEventKind (lookup table)
//   Phase 2: Populate payload via switch/case on resolved kind
//
// This ensures consistent payload shapes regardless of the source SDK.
// ────────────────────────────────────────────────────────────────

import type { SessionEvent } from '@github/copilot-sdk';
import type { AgentEvent, AgentEventKind } from '@generatorai/shared';
import { createAgentEvent } from '@generatorai/shared';

// ── Phase 1: Kind Resolution Table ──
// Maps Copilot SDK event type strings to domain AgentEventKind.
// Unknown types fall through to 'harness.unknown'.

const SDK_EVENT_TO_KIND: Record<string, AgentEventKind> = {
  // Core content events
  'assistant.message_delta': 'harness.token',
  'assistant.message': 'harness.message_complete',
  'assistant.reasoning_delta': 'harness.reasoning_delta',
  'assistant.reasoning': 'harness.reasoning_complete',
  // Tool lifecycle
  'tool.execution_start': 'harness.tool_start',
  'tool.execution_complete': 'harness.tool_complete',
  'tool.user_requested': 'harness.tool_start',
  // Session lifecycle
  'session.idle': 'harness.idle',
  'session.error': 'harness.error',
  'session.start': 'harness.session_start',
  // User/assistant turns
  'user.message': 'harness.user_message',
  'assistant.usage': 'harness.usage',
  'assistant.turn_start': 'harness.turn_start',
  'assistant.turn_end': 'harness.turn_end',
  // Informational / ephemeral — all map to session_info
  'session.info': 'harness.session_info',
  'pending_messages.modified': 'harness.session_info',
  'session.usage_info': 'harness.context_usage',
  'session.compaction_start': 'harness.session_info',
  'session.compaction_complete': 'harness.context_usage',
  'session.context_changed': 'harness.context_usage',
  'assistant.streaming_delta': 'harness.session_info',
  'tool.execution_partial_result': 'harness.session_info',
  'tool.execution_progress': 'harness.session_info',
  'session.title_changed': 'harness.session_info',
  'session.task_complete': 'harness.session_info',
  'session.shutdown': 'harness.session_info',
  'subagent.started': 'harness.session_info',
  'subagent.completed': 'harness.session_info',
  'subagent.failed': 'harness.session_info',
  'subagent.selected': 'harness.session_info',
  'subagent.deselected': 'harness.session_info',
  'permission.requested': 'harness.session_info',
  'permission.completed': 'harness.session_info',
  'assistant.intent': 'harness.session_info',
  // △ Fixed during end-to-end review — this used to map to the generic
  // 'harness.session_info', so an aborted Copilot turn was invisible to
  // every W13/X-4 cancellation-semantics fix (sseManager's settled predicate,
  // OrchestratorService's cancelled-subagent tracking, HookInterceptor's
  // on_session_cancelled phase all key off 'harness.cancelled' specifically).
  // Only Claude-agent- and Codex-routed cancellations were getting that
  // treatment; Copilot ones surfaced as an ordinary info blip.
  'abort': 'harness.cancelled',
  // PLN-01 — plan-mode passthrough (telemetry/observability only; the blocking
  // decision is owned by `SessionConfig.onExitPlanModeRequest`, so these must
  // NOT drive UI state or the gate would be double-prompted).
  'session.plan_changed': 'harness.plan_changed',
  'session.mode_changed': 'harness.mode_changed',
  'exit_plan_mode.requested': 'harness.session_info',
  'exit_plan_mode.completed': 'harness.session_info',
};

// ── Phase 2: Payload Population ──
// Each resolved kind has a consistent payload shape. The switch/case
// structure ensures new kinds are handled uniformly.

function populatePayload(
  kind: AgentEventKind,
  sdkEventType: string,
  eventData: Record<string, unknown>,
  sdkEvent: SessionEvent,
): Record<string, unknown> {
  switch (kind) {
    case 'harness.token':
      return {
        text: eventData.deltaContent ?? '',
        ...(eventData.parentToolCallId ? { parentToolCallId: eventData.parentToolCallId } : {}),
      };

    case 'harness.message_complete':
      return {
        content: eventData.content ?? '',
        ...(eventData.parentToolCallId ? { parentToolCallId: eventData.parentToolCallId } : {}),
      };

    case 'harness.reasoning_delta':
      return { text: eventData.deltaContent ?? '' };

    case 'harness.reasoning_complete':
      return { content: eventData.content ?? '' };

    case 'harness.tool_start': {
      const parent = parentToolCallIdOf(eventData, sdkEvent);
      return {
        tool: eventData.toolName ?? 'unknown-tool',
        args: eventData.arguments,
        callId: eventData.toolCallId ?? null,
        ...(parent ? { parentToolCallId: parent } : {}),
      };
    }

    case 'harness.tool_complete': {
      const rawResult = eventData.result;
      const result = rawResult != null && typeof rawResult === 'object' && 'content' in rawResult
        ? (rawResult as Record<string, unknown>).content
        : rawResult ?? null;
      const parent = parentToolCallIdOf(eventData, sdkEvent);
      return {
        tool: eventData.toolName ?? 'unknown-tool',
        callId: eventData.toolCallId ?? null,
        result,
        success: eventData.success ?? true,
        ...(parent ? { parentToolCallId: parent } : {}),
      };
    }

    case 'harness.idle':
      return {};

    case 'harness.error':
      return {
        message: eventData.message ?? 'Unknown error',
        provider: 'copilot',
        ...(eventData.errorType ? { errorType: eventData.errorType } : {}),
        ...(eventData.stack ? { stack: eventData.stack } : {}),
        ...(eventData.statusCode ? { statusCode: eventData.statusCode } : {}),
      };

    case 'harness.session_start':
      return { provider: 'copilot' };

    case 'harness.user_message':
      return { content: eventData.content ?? '' };

    case 'harness.usage':
      return {
        model: eventData.model ?? 'unknown',
        inputTokens: eventData.inputTokens ?? 0,
        outputTokens: eventData.outputTokens ?? 0,
        cost: eventData.cost,
        durationMs: eventData.duration,
        provider: 'copilot',
        ...(eventData.cacheReadTokens ? { cacheReadTokens: eventData.cacheReadTokens } : {}),
        ...(eventData.cacheWriteTokens ? { cacheWriteTokens: eventData.cacheWriteTokens } : {}),
        ...(eventData.parentToolCallId ? { parentToolCallId: eventData.parentToolCallId } : {}),
        // Sub-agent turns report their own usage; tagging them lets the UI keep
        // the main context gauge from being overwritten by a sub-agent's numbers.
        ...(agentIdOf(sdkEvent) ? { agentId: agentIdOf(sdkEvent) } : {}),
      };

    case 'harness.context_usage':
      return populateContextUsagePayload(sdkEventType, eventData, sdkEvent);

    case 'harness.turn_start':
    case 'harness.turn_end':
      return { turnId: eventData.turnId ?? '' };

    case 'harness.session_info':
      return populateSessionInfoPayload(sdkEventType, eventData, sdkEvent);

    case 'harness.cancelled':
      // W13 / X-4 — cancellation is a semantic success value, not an error.
      // `reason` is a closed union (AgentEvent.ts); the SDK's own free-text
      // reason, if any, still reaches the UI via the preceding info line.
      return { reason: 'user_abort', provider: 'copilot' };

    // PLN-01 — plan-mode passthrough.
    case 'harness.plan_changed':
      return { operation: String(eventData['operation'] ?? 'update') };

    case 'harness.mode_changed':
      return {
        previousMode: String(eventData['previousMode'] ?? ''),
        newMode: String(eventData['newMode'] ?? ''),
      };

    case 'harness.unknown':
    default:
      return { raw: sdkEvent, provider: 'copilot' };
  }
}

/** Sub-agent id, when the SDK event came from a sub-agent rather than the main one. */
function agentIdOf(sdkEvent: SessionEvent): string | undefined {
  const id = (sdkEvent as unknown as { agentId?: unknown }).agentId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

// ── Sub-agent nesting ────────────────────────────────────────────
//
// `subagent.started` is the ONLY event that pairs a sub-agent instance
// (`agentId`) with the tool call that spawned it (`data.toolCallId`). Every
// later event from that sub-agent carries `agentId` but not the tool call, so
// without this table a sub-agent's Read/Grep storm arrived as top-level tool
// calls and was indistinguishable from the main agent's own work.
//
// Module-level and bounded, mirroring the claude-agent mapper's tool-name
// cache: the mapper is a pure per-event function by design, and this is the
// one piece of cross-event state the protocol forces.
const SUBAGENT_PARENT_CACHE_MAX = 64;
const parentCallByAgentId = new Map<string, string>();

function rememberSubagentParent(agentId: string | undefined, toolCallId: unknown): void {
  if (!agentId || typeof toolCallId !== 'string' || !toolCallId) return;
  if (!parentCallByAgentId.has(agentId) && parentCallByAgentId.size >= SUBAGENT_PARENT_CACHE_MAX) {
    const oldest = parentCallByAgentId.keys().next().value;
    if (oldest !== undefined) parentCallByAgentId.delete(oldest);
  }
  parentCallByAgentId.set(agentId, toolCallId);
}

/**
 * The tool call a sub-agent event nests under.
 *
 * `eventData.parentToolCallId` wins when the SDK supplies it directly; the
 * `agentId` table is the fallback that makes nesting work on the SDK as it
 * actually ships (1.0.8 sets `agentId` on sub-agent events and nothing else).
 */
function parentToolCallIdOf(
  eventData: Record<string, unknown>,
  sdkEvent: SessionEvent,
): string | undefined {
  const explicit = eventData['parentToolCallId'];
  if (typeof explicit === 'string' && explicit) return explicit;
  const agentId = agentIdOf(sdkEvent);
  return agentId ? parentCallByAgentId.get(agentId) : undefined;
}

/** Test seam: drop the sub-agent nesting table. */
export function _resetCopilotSubagentNesting(): void {
  parentCallByAgentId.clear();
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Maps the Copilot SDK's context-window reports onto the provider-neutral
 * `harness.context_usage` payload.
 *
 * Three SDK events carry the same shape:
 *   - `session.usage_info`         — live, ephemeral, emitted throughout a turn
 *   - `session.compaction_complete`— post-compaction totals (the gauge must DROP)
 *   - `session.context_changed`    — context re-computed for another reason
 *
 * `tokenLimit` is the model's PROMPT budget, which is what the gauge divides
 * by. Previously compaction/context_changed fell through to a default branch
 * and their numbers were discarded, so the gauge stayed pinned at the
 * pre-compaction value.
 */
function populateContextUsagePayload(
  sdkEventType: string,
  eventData: Record<string, unknown>,
  sdkEvent: SessionEvent,
): Record<string, unknown> {
  // `compaction_complete` nests the post-compaction window under `contextWindow`.
  const nested =
    eventData['contextWindow'] != null && typeof eventData['contextWindow'] === 'object'
      ? (eventData['contextWindow'] as Record<string, unknown>)
      : undefined;
  const src = nested ?? eventData;

  const currentTokens = num(src['currentTokens']) ?? 0;
  const promptTokenLimit = num(src['tokenLimit']) ?? num(src['promptTokenLimit']);
  const system = num(src['systemTokens']);
  const conversation = num(src['conversationTokens']);
  const tools = num(src['toolDefinitionsTokens']);
  const mcpTools = num(src['mcpToolsTokens']);
  const breakdown = {
    ...(system != null ? { system } : {}),
    ...(conversation != null ? { conversation } : {}),
    ...(tools != null ? { tools } : {}),
    ...(mcpTools != null ? { mcpTools } : {}),
  };
  const agentId = agentIdOf(sdkEvent);

  return {
    provider: 'copilot',
    source: 'provider',
    currentTokens,
    ...(promptTokenLimit != null ? { promptTokenLimit } : {}),
    ...(num(src['compactionThreshold']) != null
      ? { compactionThreshold: num(src['compactionThreshold']) }
      : {}),
    ...(num(src['messagesLength']) != null ? { messagesLength: num(src['messagesLength']) } : {}),
    ...(typeof src['modelName'] === 'string' ? { model: src['modelName'] } : {}),
    ...(agentId ? { agentId } : {}),
    ...(Object.keys(breakdown).length > 0 ? { breakdown } : {}),
    // Kept so downstream consumers can tell a live tick from a compaction drop.
    reason: sdkEventType,
  };
}

/**
 * Populates payload for session_info events. These are informational
 * events with varying structure depending on the original SDK event type.
 */
function populateSessionInfoPayload(
  sdkEventType: string,
  eventData: Record<string, unknown>,
  sdkEvent?: SessionEvent,
): Record<string, unknown> {
  switch (sdkEventType) {
    case 'session.info':
      return { infoType: eventData.infoType ?? 'info', message: eventData.message ?? '' };

    case 'pending_messages.modified':
      return { infoType: 'pending_messages', message: '' };

    case 'session.compaction_start':
      return { infoType: 'compaction_start', message: 'Compacting conversation context…' };

    case 'tool.execution_partial_result':
      return {
        infoType: 'tool_partial_result',
        message: '',
        callId: eventData.toolCallId ?? null,
        partialOutput: eventData.partialOutput ?? '',
      };

    case 'tool.execution_progress':
      return {
        infoType: 'tool_progress',
        message: '',
        callId: eventData.toolCallId ?? null,
        progressMessage: eventData.progressMessage ?? '',
      };

    case 'subagent.started':
      return {
        infoType: 'subagent_started',
        message: `Sub-agent started: ${eventData.agentDisplayName ?? eventData.agentName ?? 'unknown'}`,
        agentName: eventData.agentName,
        toolCallId: eventData.toolCallId,
        ...(eventData.model ? { model: eventData.model } : {}),
        ...(sdkEvent && agentIdOf(sdkEvent) ? { agentId: agentIdOf(sdkEvent) } : {}),
      };

    case 'subagent.completed':
      return {
        infoType: 'subagent_completed',
        message: `Sub-agent completed: ${eventData.agentDisplayName ?? eventData.agentName ?? 'unknown'}`,
        agentName: eventData.agentName,
        toolCallId: eventData.toolCallId,
        ...(sdkEvent && agentIdOf(sdkEvent) ? { agentId: agentIdOf(sdkEvent) } : {}),
      };

    case 'subagent.failed':
      return {
        infoType: 'subagent_failed',
        message: `Sub-agent failed: ${eventData.agentDisplayName ?? eventData.agentName ?? 'unknown'} — ${eventData.error ?? 'Unknown error'}`,
        agentName: eventData.agentName,
        error: eventData.error,
        toolCallId: eventData.toolCallId,
        ...(sdkEvent && agentIdOf(sdkEvent) ? { agentId: agentIdOf(sdkEvent) } : {}),
      };

    case 'session.task_complete':
      return { infoType: 'task_complete', message: eventData.summary ?? 'Task completed' };

    // 'abort' used to be handled here (it mapped to 'harness.session_info');
    // it is now its own 'harness.cancelled' kind — see SDK_EVENT_TO_KIND above.

    case 'assistant.intent':
      return { infoType: 'intent', message: eventData.intent ?? '' };

    default:
      return { infoType: sdkEventType.replace(/\./g, '_'), message: '' };
  }
}

// ── Public API ──

/**
 * Maps a raw Copilot SDK SessionEvent to our domain AgentEvent.
 *
 * Phase 1: Resolve SDK event type → AgentEventKind via lookup table
 * Phase 2: Populate payload via switch/case on the resolved kind
 */
export function mapSdkEventToAgentEvent(sdkEvent: SessionEvent): AgentEvent {
  // Phase 1: Kind resolution
  const kind = SDK_EVENT_TO_KIND[sdkEvent.type] ?? 'harness.unknown';

  // Normalize SDK event data to a safe object
  const eventData =
    sdkEvent.data != null && typeof sdkEvent.data === 'object'
      ? (sdkEvent.data as Record<string, unknown>)
      : {};

  // Learn the sub-agent → spawning-tool-call binding BEFORE the payload is
  // built, so the `subagent.started` event itself already resolves, and forget
  // it once the sub-agent has settled.
  if (sdkEvent.type === 'subagent.started') {
    rememberSubagentParent(agentIdOf(sdkEvent), eventData['toolCallId']);
  } else if (sdkEvent.type === 'subagent.completed' || sdkEvent.type === 'subagent.failed') {
    const agentId = agentIdOf(sdkEvent);
    if (agentId) parentCallByAgentId.delete(agentId);
  }

  // Phase 2: Payload population
  const payload = populatePayload(kind, sdkEvent.type, eventData, sdkEvent);

  return createAgentEvent(kind, payload);
}

/**
 * Batch mapper for arrays of SDK events.
 */
export function mapSdkEventsToAgentEvents(sdkEvents: SessionEvent[]): AgentEvent[] {
  return sdkEvents.map(mapSdkEventToAgentEvent);
}
