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

import type { AgentEvent, AgentEventKind, FileOpHunk, FileOpStat, McpServerStartupStatus } from '@generatorai/shared';
import { createAgentEvent, mcpStartupWarnings } from '@generatorai/shared';
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

function buildMessageCompletePayload(content: string, providerMessageId?: string) {
  // The assistant message uuid is the coordinate a conversation fork or
  // rewind is expressed in (`forkSession.upToMessageId`), so it rides along
  // with the text it closed; the chat service keeps the last one of a turn.
  return providerMessageId ? { content, providerMessageId } : { content };
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

/** One API call's prompt, as `usage.iterations` reports it. */
export interface LastCallUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * The token counts for the LAST API call of a turn.
 *
 * `usage.iterations` is Anthropic's per-API-call breakdown; the field's own
 * documentation states it exists so callers can "calculate the true context
 * window size from the last iteration". That is exactly what the context
 * gauge needs, and it is NOT what the sibling totals on `usage` mean — those
 * sum every call the turn made, so they measure spend, not occupancy.
 *
 * Compaction entries are skipped: a `compaction` iteration describes the
 * summarisation pass, not the assembled prompt that followed it, so treating
 * it as the final call would report the wrong window. Returns null when the
 * array is missing or holds nothing usable, which the caller reads as "we do
 * not know" rather than substituting the aggregate.
 */
export function lastIterationUsage(usage: Record<string, unknown> | undefined): LastCallUsage | null {
  const iterations = usage?.['iterations'];
  if (!Array.isArray(iterations)) return null;
  for (let i = iterations.length - 1; i >= 0; i -= 1) {
    const it = iterations[i] as Record<string, unknown> | null;
    if (!it || typeof it !== 'object') continue;
    if (it['type'] === 'compaction') continue;
    const num = (key: string): number => {
      const v = it[key];
      return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    };
    const call: LastCallUsage = {
      input: num('input_tokens'),
      output: num('output_tokens'),
      cacheRead: num('cache_read_input_tokens'),
      cacheWrite: num('cache_creation_input_tokens'),
    };
    if (call.input + call.cacheRead + call.cacheWrite > 0) return call;
  }
  return null;
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
    // The SDK's `total_cost_usd`: a dollar figure the provider reports (P07 WP-7.3).
    ...(typeof cost === 'number' && Number.isFinite(cost) ? { costUsd: cost } : {}),
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
// ── File-op stats from structured tool output ──
//
// The SDK's `user` messages carry `tool_use_result` — the tool's full Output
// object (FileWriteOutput / FileEditOutput), not just the text the model
// sees. Its `structuredPatch` hunks are exactly the per-operation diff, so
// "+A −D" per Write/Edit costs nothing to compute here and nothing at all
// client-side. `gitDiff.additions/deletions` is preferred when present (it
// is git's own count); the hunk-line count is the fallback.
interface StructuredPatchHunk {
  oldStart?: unknown;
  oldLines?: unknown;
  newStart?: unknown;
  newLines?: unknown;
  lines?: unknown[];
}

/**
 * Hunk caps.
 *
 * The fileOp rides on `harness.tool_complete` and is persisted verbatim into
 * `chat_messages.metadata.toolCalls[].fileOp` (ChatManagementService), so an
 * unbounded patch would bloat every replay of the conversation as well as the
 * live stream. 160 lines is enough to render a typical Write/Edit inline; past
 * that the transcript links out to the Changes tab, which reads the real diff
 * from git.
 */
const MAX_HUNK_LINES = 160;
const MAX_HUNK_LINE_CHARS = 2_000;

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Truncate one diff line, preserving its leading ' ' / '+' / '-' marker. */
function capLine(line: string): string {
  return line.length <= MAX_HUNK_LINE_CHARS
    ? line
    : `${line.slice(0, MAX_HUNK_LINE_CHARS)}…`;
}

/**
 * Copy `patch` into `FileOpHunk`s under the caps above.
 *
 * Cutting is all-or-nothing per LINE, not per hunk: a hunk is emitted with as
 * many lines as fit and the remaining hunks are dropped, so the client never
 * has to reason about a hunk whose header disagrees with its body — it just
 * shows the "truncated" affordance.
 */
function capHunks(patch: StructuredPatchHunk[]): { hunks: FileOpHunk[]; truncated: boolean } {
  const hunks: FileOpHunk[] = [];
  let budget = MAX_HUNK_LINES;

  for (const hunk of patch) {
    if (!hunk || !Array.isArray(hunk.lines)) continue;
    if (budget <= 0) return { hunks, truncated: true };

    const source = hunk.lines.filter((l): l is string => typeof l === 'string');
    // An empty hunk renders as an empty box; there is nothing to show.
    if (source.length === 0) continue;
    const lines = source.slice(0, budget).map(capLine);
    budget -= lines.length;
    hunks.push({
      oldStart: toCount(hunk.oldStart),
      oldLines: toCount(hunk.oldLines),
      newStart: toCount(hunk.newStart),
      newLines: toCount(hunk.newLines),
      lines,
    });
    if (lines.length < source.length) return { hunks, truncated: true };
  }

  return { hunks, truncated: false };
}

function deriveFileOp(toolUseResult: unknown): FileOpStat | undefined {
  if (!toolUseResult || typeof toolUseResult !== 'object') return undefined;
  const r = toolUseResult as Record<string, unknown>;
  const filePath = typeof r['filePath'] === 'string' ? r['filePath'] : undefined;
  const patch = Array.isArray(r['structuredPatch']) ? (r['structuredPatch'] as StructuredPatchHunk[]) : undefined;
  if (!filePath || !patch) return undefined;

  const kind: 'create' | 'update' | 'edit' =
    r['type'] === 'create' ? 'create' : r['type'] === 'update' ? 'update' : 'edit';

  // A brand-new file arrives as `type: 'create'` with an EMPTY
  // `structuredPatch` and the whole body in `content` — there is no "before"
  // to patch against. Without this branch every Write of a new file rendered
  // as "+0 −0" with nothing to expand, which is exactly the case a user is
  // most likely to want to read inline. Synthesise the all-`+` hunk (and the
  // addition count) from `content`.
  const content = typeof r['content'] === 'string' ? r['content'] : undefined;
  if (kind === 'create' && patch.length === 0 && content !== undefined) {
    // A trailing newline terminates the last line rather than starting a new
    // empty one, so it must not be counted as a line of its own.
    const body = content.endsWith('\n') ? content.slice(0, -1) : content;
    const contentLines = body === '' ? [] : body.split('\n');
    const { hunks, truncated } = capHunks([
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: contentLines.length,
        lines: contentLines.map((l) => `+${l}`),
      },
    ]);
    return {
      kind,
      filePath,
      additions: contentLines.length,
      deletions: 0,
      ...(hunks.length > 0 ? { hunks } : {}),
      ...(truncated ? { hunksTruncated: true } : {}),
    };
  }

  const { hunks, truncated } = capHunks(patch);
  const hunkFields = {
    ...(hunks.length > 0 ? { hunks } : {}),
    ...(truncated ? { hunksTruncated: true } : {}),
  };

  const gitDiff = r['gitDiff'] as { additions?: unknown; deletions?: unknown } | undefined;
  if (gitDiff && typeof gitDiff.additions === 'number' && typeof gitDiff.deletions === 'number') {
    return { kind, filePath, additions: gitDiff.additions, deletions: gitDiff.deletions, ...hunkFields };
  }

  // Counts are derived from the FULL patch, never the capped copy — a
  // truncated preview must not understate how much the file actually changed.
  let additions = 0;
  let deletions = 0;
  for (const hunk of patch) {
    if (!hunk || !Array.isArray(hunk.lines)) continue;
    for (const line of hunk.lines) {
      if (typeof line !== 'string') continue;
      if (line.startsWith('+')) additions += 1;
      else if (line.startsWith('-')) deletions += 1;
    }
  }
  return { kind, filePath, additions, deletions, ...hunkFields };
}

// ── Tool-name correlation (bounded) ──
//
// A `tool_result` block carries only `tool_use_id`; the SDK message that
// names the tool arrived earlier. The mapper is stateless per message, so
// completions used to go out as tool "unknown" — harmless for the web UI
// (which matches on callId) but wrong for the CLI renderer, the event log
// and anything replaying the stream without reducer state.
//
// `tool_use` ids are globally unique (`toolu_…`), so one process-wide map is
// safe across conversations. Bounded FIFO: entries are only needed until the
// matching result, which follows within the same turn.
const TOOL_NAME_CACHE_MAX = 2048;
const toolNamesByCallId = new Map<string, string>();

function rememberToolName(callId: string | undefined, name: string | undefined): void {
  if (!callId || !name || name === 'unknown') return;
  if (!toolNamesByCallId.has(callId) && toolNamesByCallId.size >= TOOL_NAME_CACHE_MAX) {
    const oldest = toolNamesByCallId.keys().next().value;
    if (oldest !== undefined) toolNamesByCallId.delete(oldest);
  }
  toolNamesByCallId.set(callId, name);
}

function recallToolName(callId: string): string {
  return toolNamesByCallId.get(callId) ?? 'unknown';
}

/**
 * The SDK's own delegation tools. A `Task`/`Agent` call IS a sub-agent: its
 * `tool_use` opens one and its `tool_result` is the moment it finished.
 */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['task', 'agent']);

function isSubagentTool(name: string): boolean {
  return SUBAGENT_TOOLS.has(name.toLowerCase());
}

/** The sub-agent's own label, from the `Task` tool's arguments. */
function describeSubagentTask(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const a = input as Record<string, unknown>;
  for (const key of ['subagent_type', 'description', 'name']) {
    const v = a[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

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
              buildMessageCompletePayload(block.text, message.uuid),
            ));
            break;

          case 'tool_use':
            rememberToolName(block.id, block.name);
            events.push(createAgentEvent(
              'harness.tool_start',
              buildToolStartPayload(
                block.name,
                block.input,
                block.id,
                message.parent_tool_use_id ?? undefined,
              ),
            ));
            if (isSubagentTool(block.name)) {
              // The `task_started` system message is the SDK's own signal, but
              // it is not guaranteed and carries no tool-call id, so the step
              // it opened could never be matched to the call that settles it.
              // This one does, and it arrives with the call itself.
              events.push(createAgentEvent('harness.session_info', {
                ...buildSessionInfoPayload(
                  'subagent_started',
                  `Sub-agent started: ${describeSubagentTask(block.input) ?? block.name}`,
                ),
                toolCallId: block.id,
              }));
            }
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

      // `tool_use_result` is per-message; only attach its stats when the
      // message carries exactly one tool_result, so they cannot be
      // mis-attributed in a (rare) batched-results message.
      const resultBlocks = betaMsg.content.filter(
        (b: { type: string }) => b.type === 'tool_result',
      );
      const fileOp = resultBlocks.length === 1
        ? deriveFileOp((message as unknown as { tool_use_result?: unknown }).tool_use_result)
        : undefined;

      for (const block of betaMsg.content) {
        if (block.type === 'tool_result') {
          const resultContent = Array.isArray(block.content)
            ? block.content
                .map((c: { type: string; text?: string }) => c.type === 'text' ? (c.text ?? '') : '')
                .join('')
            : typeof block.content === 'string'
              ? block.content
              : '';

          const completedTool = recallToolName(block.tool_use_id);
          events.push(createAgentEvent(
            'harness.tool_complete',
            {
              ...buildToolCompletePayload(
                completedTool,
                block.tool_use_id,
                resultContent,
                !block.is_error,
              ),
              ...(fileOp ? { fileOp } : {}),
              ...(message.parent_tool_use_id
                ? { parentToolCallId: message.parent_tool_use_id }
                : {}),
            },
          ));
          if (isSubagentTool(completedTool)) {
            // The SDK never emits a `task_completed` system message, so a
            // sub-agent step opened by `task_started` had nothing to settle it
            // and spun until the whole turn ended. The tool result IS the
            // completion, and it arrives while the turn is still live.
            events.push(createAgentEvent('harness.session_info', {
              ...buildSessionInfoPayload(
                block.is_error ? 'subagent_failed' : 'subagent_completed',
                block.is_error ? 'Sub-agent failed' : 'Sub-agent completed',
              ),
              toolCallId: block.tool_use_id,
            }));
          }
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
            rememberToolName(contentBlock.id, contentBlock.name);
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
      // when the control-channel breakdown does not arrive. `contextWindow`
      // here is the total window; the prompt budget excludes the completion
      // reserve.
      //
      // The numerator is the LAST API call's prompt, never the turn's totals.
      // `message.usage` (and `modelUsage`) aggregate every API call the turn
      // made, so a turn with five tool round-trips re-counts the same cached
      // prefix five times. That is correct for *spend* — which is what
      // `harness.usage` above reports — and badly wrong for *occupancy*: two
      // messages in a fresh chat read as 212k tokens / 23% full, and the
      // figure climbed every turn because it was a running total of billing,
      // not a measure of the window.
      //
      // `usage.iterations` is the per-API-call breakdown, and the SDK's own
      // documentation for it says: "Calculate the true context window size
      // from the last iteration." Measured against `getContextUsage()`, the
      // CLI's authoritative answer, on the same turns:
      //
      //   aggregate 188,441   last iteration 41,932   getContextUsage 41,932
      //   aggregate 101,003   last iteration 35,368   getContextUsage 35,368
      //
      // Exact, not approximate. When `iterations` is absent (an older API
      // build) we publish no snapshot at all rather than the aggregate — this
      // module's stated rule is to say nothing instead of inventing a number,
      // and `ClaudeAgentProvider.emitContextUsageSnapshot` still supplies the
      // provider-reported one.
      //
      // Skipped entirely when the turn reported no tokens at all — that means
      // the query failed (auth, abort) rather than that the context is empty,
      // and publishing "0 / 200k · 0%" would state a falsehood confidently.
      const lastCall = lastIterationUsage(message.usage as unknown as Record<string, unknown> | undefined);
      const contextTokens = lastCall
        ? lastCall.input + lastCall.cacheRead + lastCall.cacheWrite
        : 0;
      if (contextTokens > 0 && lastCall) {
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
          // The same call the total describes, so the popover's Input /
          // Cache read / Cache write rows add up to the number above them.
          // Turn-wide spend stays on `harness.usage`.
          apiUsage: {
            input: lastCall.input,
            output: lastCall.output,
            cacheRead: lastCall.cacheRead,
            cacheWrite: lastCall.cacheWrite,
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
        case 'init': {
          events.push(createAgentEvent('harness.session_start', { provider: 'claude-agent' }));
          // The init frame is the ONLY place the SDK reports how each MCP
          // server actually started. Discarding it is why a user who
          // configured a server watched it fail with no explanation
          // anywhere — the documentation claimed this was surfaced, and
          // nothing surfaced it (review 2.4).
          for (const warning of mcpStartupWarnings(
            sys['mcp_servers'] as McpServerStartupStatus[] | undefined,
          )) {
            events.push(
              createAgentEvent('harness.warning', {
                message: warning.message,
                code: warning.code,
                provider: 'claude-agent',
                details: warning.details,
              }),
            );
          }
          break;
        }

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

        case 'task_notification': {
          // Forwarded as a sub-agent PROGRESS note (the transcript attaches it
          // to the matching sub-agent step) as well as under its raw type, so
          // nothing that already keys off `task_<status>` changes behaviour.
          const summary = String(sys.summary ?? sys.description ?? sys.status ?? '');
          events.push(createAgentEvent(kind, buildSessionInfoPayload(
            `task_${String(sys.status ?? 'unknown')}`,
            `Task ${String(sys.task_id ?? '')}: ${String(sys.status ?? '')}`,
          )));
          if (summary) {
            events.push(createAgentEvent('harness.session_info', {
              ...buildSessionInfoPayload('subagent_progress', summary),
              ...(sys.task_id ? { toolCallId: String(sys.task_id) } : {}),
            }));
          }
          break;
        }

        case 'task_started':
          events.push(createAgentEvent(kind, buildSessionInfoPayload(
            'subagent_started',
            `Sub-agent started: ${String(sys.description ?? '')}`,
          )));
          break;

        case 'task_progress': {
          const summary = String(sys.summary ?? sys.description ?? '');
          events.push(createAgentEvent(kind, buildSessionInfoPayload('task_progress', summary)));
          if (summary) {
            events.push(createAgentEvent('harness.session_info', {
              ...buildSessionInfoPayload('subagent_progress', summary),
              ...(sys.task_id ? { toolCallId: String(sys.task_id) } : {}),
            }));
          }
          break;
        }

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
