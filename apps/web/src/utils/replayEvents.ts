// ────────────────────────────────────────────────────────────────
// replayEvents — Reconstruct stream blocks from persisted events
// Called on page load to restore thinking, tool call, system, and
// subagent blocks that only lived in the in-memory stream store.
// ────────────────────────────────────────────────────────────────

import { useStreamStore } from '../stores/streamStore.js';
import type { PersistedEvent } from '@generatorai/shared';
import type { SystemCategory, QuestionBlock } from '../stores/streamStore.js';
import type { ContextUsageSnapshot, ToolFileOp } from '@generatorai/client-core';

/** Apply a persisted `harness.context_usage` payload to the stream store. */
function applyContextUsage(
  store: ReturnType<typeof useStreamStore.getState>,
  streamKey: string,
  data: Record<string, unknown>,
): void {
  const current = data['currentTokens'];
  if (typeof current !== 'number' || !Number.isFinite(current)) return;
  const numOrUndef = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  store.setContextUsage(streamKey, {
    source: data['source'] === 'provider' ? 'provider' : 'derived',
    currentTokens: current,
    promptTokenLimit: numOrUndef(data['promptTokenLimit']),
    totalContextWindow: numOrUndef(data['totalContextWindow']),
    compactionThreshold: numOrUndef(data['compactionThreshold']),
    messagesLength: numOrUndef(data['messagesLength']),
    model: typeof data['model'] === 'string' ? data['model'] : undefined,
    provider: typeof data['provider'] === 'string' ? data['provider'] : undefined,
    breakdown: (data['breakdown'] as ContextUsageSnapshot['breakdown']) ?? undefined,
    apiUsage: (data['apiUsage'] as ContextUsageSnapshot['apiUsage']) ?? undefined,
  });
}

/**
 * Detect system message category for proper grouping.
 * Messages about sub-agents get 'subagent' category.
 */
function detectCategory(message: string): SystemCategory {
  const lower = message.toLowerCase();
  if (lower.includes('subagent') || lower.includes('sub-agent') || lower.includes('sub agent')) {
    return 'subagent';
  }
  return 'system';
}

/**
 * Format system message from event data, matching the formatting
 * used in the live event handler (useSessionEvents.ts).
 */
function formatSystemMessage(kind: string, data: Record<string, unknown>): { message: string; category: SystemCategory } | null {
  switch (kind) {
    // Git events
    case 'git.clone_start':
      return { message: `Cloning repository: ${data['repoUrl']}`, category: detectCategory(`Cloning: ${data['repoUrl']}`) };
    case 'git.clone_complete':
      return { message: `Repository cloned to: ${data['localPath']}`, category: 'system' };
    case 'git.commit':
      return { message: `Git commit: ${data['message']} (${data['sha']})`, category: 'system' };
    case 'git.push':
      return { message: `Pushed to branch: ${data['branch']}`, category: 'system' };
    case 'git.pr_created':
      return { message: `PR created: ${data['url']}`, category: 'system' };

    // Script events
    case 'script.stdout':
      return { message: `[stdout] ${data['line']}`, category: 'system' };
    case 'script.stderr':
      return { message: `[stderr] ${data['line']}`, category: 'system' };
    case 'script.exit':
      return { message: `Script exited with code: ${data['code']}`, category: 'system' };

    // Hook events
    case 'hook.started':
      return { message: `Hook "${data['hookName']}" started (phase: ${data['phase']})`, category: 'system' };
    case 'hook.completed':
      return { message: `Hook "${data['hookName']}" completed`, category: 'system' };
    case 'hook.failed':
      return { message: `Hook "${data['hookName']}" failed: ${data['error']}`, category: 'error' };

    // Artifact events
    case 'artifact.created':
      return { message: `Artifact created: ${data['name']}`, category: 'system' };

    // Copilot client lifecycle
    case 'harness.client_error':
      return { message: `Copilot client error: ${data['message'] ?? 'Unknown error'}`, category: 'error' };
    case 'harness.client_restarting':
      return { message: 'Copilot client restarting...', category: 'system' };
    case 'harness.client_started':
      return { message: 'Copilot client started', category: 'system' };
    case 'harness.client_stopped':
      return { message: 'Copilot client stopped', category: 'system' };

    // Session errors
    case 'session.error':
      return { message: `Session error: ${data['message']}`, category: 'error' };

    // Workflow failures
    case 'workflow.failed':
      return { message: `Workflow failed: ${data['error']}`, category: 'error' };

    // Permission events
    case 'permission.requested':
      return { message: `Permission requested: ${data['permission']}`, category: 'system' };
    case 'permission.granted':
      return { message: `Permission granted: ${data['permission']}`, category: 'system' };
    case 'permission.denied':
      return { message: `Permission denied: ${data['permission']}`, category: 'system' };

    // Sub-agent and session_info events with displayable messages
    case 'harness.session_info': {
      const infoType = data['infoType'] as string | undefined;
      if (infoType === 'subagent_started') {
        return { message: (data['message'] as string) ?? 'Sub-agent started', category: 'subagent' };
      }
      if (infoType === 'subagent_completed') {
        return { message: (data['message'] as string) ?? 'Sub-agent completed', category: 'subagent' };
      }
      if (infoType === 'subagent_failed') {
        return { message: (data['message'] as string) ?? 'Sub-agent failed', category: 'error' };
      }
      if (infoType === 'abort') {
        return { message: (data['message'] as string) ?? 'Turn aborted', category: 'error' };
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Replay persisted events into the stream store for a given session.
 *
 * This reconstructs the stream blocks (thinking, tool calls, text, system)
 * from the event history. For multi-turn conversations, only the LAST
 * assistant response turn's blocks are kept (earlier turns are served
 * by persisted ChatMessage records in the chat history).
 *
 * Optimisation: if the session's final turn already ended with copilot.idle,
 * we skip the expensive per-event replay entirely — chatHistory is the sole
 * data source and no stream blocks are needed.
 *
 * Tokens are batched to avoid triggering one store update per token.
 */
export function replayEventsIntoStore(sessionId: string, events: PersistedEvent[]): void {
  const store = useStreamStore.getState();

  // ── Detect per-stage stream key for workflow stage runs ──
  // Events from workflow stages carry stageRunId in their data. When present,
  // the live processEvent handler in sseManager routes to `stageRun:${stageRunId}`
  // as the stream key. Replay must use the same key so StageOutput can find blocks.
  let activeStageRunId: string | null = null;
  for (const ev of events) {
    const data = (ev.data ?? {}) as Record<string, unknown>;
    const srid = data['stageRunId'] as string | undefined;
    if (srid) { activeStageRunId = srid; break; }
  }
  const streamKey = activeStageRunId ? `stageRun:${activeStageRunId}` : sessionId;

  // Guard: if the stream is already in an active state (user just sent a
  // message via ChatInput.startPending), skip replay to avoid wiping the
  // pending state. The live SSE events will continue filling in the response.
  const existingStream = store.streams[streamKey];
  if (existingStream && (
    existingStream.status === 'pending' ||
    existingStream.status === 'streaming' ||
    existingStream.status === 'thinking'
  )) {
    return;
  }

  // Clear stream before replay to start fresh
  store.clearStream(streamKey);

  if (events.length === 0) return;

  // ── Fast-path: skip full replay for fully-completed sessions ──
  // Scan backwards to find the last copilot.idle and last copilot.user_message.
  // If the final turn already completed (idle AFTER the last user_message),
  // chatHistory has everything and no stream blocks are needed. This avoids
  // processing thousands of events for completed sessions on every page refresh.
  // NOTE: stageRun:* keys are EXEMPTED from this fast-path (see below) because
  // the chat history API collapses multi-turn tool calls into a single metadata
  // array, losing temporal interleaving. Stream block replay preserves the
  // correct text→tool→text order that WorkflowMessages relies on.
  let lastIdleIdx = -1;
  let lastUserMsgIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const evData = (events[i]!.data ?? {}) as Record<string, unknown>;
    const isInternalEv = !!evData['__isInternalTurn'];
    if (lastIdleIdx === -1 && events[i]!.kind === 'harness.idle' && !isInternalEv) {
      lastIdleIdx = i;
    }
    if (lastUserMsgIdx === -1 && events[i]!.kind === 'harness.user_message' && !isInternalEv) {
      lastUserMsgIdx = i;
    }
    if (lastIdleIdx !== -1 && lastUserMsgIdx !== -1) break;
  }

  if (lastIdleIdx !== -1 && lastUserMsgIdx >= 0 && lastIdleIdx > lastUserMsgIdx) {
    // Last interactive turn fully completed — chatHistory serves all messages.
    // EXCEPTIONS that still need full replay:
    //   1. stageRun:* keys — the chat history API collapses multi-turn
    //      agentic tool calls into a single metadata array, losing temporal
    //      interleaving. Stream block replay preserves the correct order.
    //   2. Widget events — inline widgets live only in the event stream
    //      (they're not part of ChatMessage content), so skipping replay
    //      would drop them on refresh.
    const hasWidgetEvents = events.some((e) => e.kind.startsWith('harness.widget.'));
    if (!streamKey.startsWith('stageRun:') && !hasWidgetEvents) {
      // Even though we skip block replay, still surface the LAST usage event
      // so the context-window gauge reflects how full the window is. Usage is
      // not carried in chat history, so without this it would read 0% after a
      // refresh even though the conversation occupies the context.
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]!;
        if (ev.kind !== 'harness.usage') continue;
        const d = (ev.data ?? {}) as Record<string, unknown>;
        if (typeof d['agentId'] === 'string' && d['agentId']) continue;
        store.setUsage(streamKey, {
          model: (d['model'] as string) ?? 'unknown',
          inputTokens: (d['inputTokens'] as number) ?? 0,
          outputTokens: (d['outputTokens'] as number) ?? 0,
          durationMs: (d['durationMs'] as number) ?? undefined,
          cacheReadTokens: (d['cacheReadTokens'] as number) ?? undefined,
          cacheWriteTokens: (d['cacheWriteTokens'] as number) ?? undefined,
          cost: (d['cost'] as number) ?? undefined,
          provider: (d['provider'] as string) ?? undefined,
        });
        break;
      }
      // Also surface the LAST context-window snapshot so the gauge shows
      // where the tokens went after a refresh. Sub-agent snapshots are
      // skipped — they describe a different window.
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]!;
        if (ev.kind !== 'harness.context_usage') continue;
        const d = (ev.data ?? {}) as Record<string, unknown>;
        if (typeof d['agentId'] === 'string' && d['agentId']) continue;
        if (typeof d['currentTokens'] !== 'number') continue;
        applyContextUsage(store, streamKey, d);
        break;
      }
      return;
    }
  }

  // ── Optimisation: only process events from the last turn ──
  // Earlier turns are fully represented in chatHistory. Processing them
  // just to discard via the next copilot.user_message's startPending() reset
  // wastes CPU and triggers unnecessary Zustand store updates.
  // Slice from the last copilot.user_message (the start of the active turn).
  // However, we ALWAYS keep every `harness.widget.*` event (from any turn)
  // because inline widget blocks live only in the event stream — the
  // ChatMessage record doesn't carry widget content, so widgets from earlier
  // turns must be replayed too.
  const replayStart = lastUserMsgIdx >= 0 ? lastUserMsgIdx : 0;
  const earlierWidgetEvents = replayStart > 0
    ? events.slice(0, replayStart).filter((e) => e.kind.startsWith('harness.widget.'))
    : [];
  const replayEvents = earlierWidgetEvents.concat(events.slice(replayStart));

  let tokenBuf = '';
  let thinkingBuf = '';
  // Track the last meaningful copilot event in the current turn
  // so we know whether to auto-complete at the end of replay.
  let sawIdleInCurrentTurn = false;
  let sawMessageCompleteInCurrentTurn = false;

  const flushTokens = () => {
    if (tokenBuf) {
      store.appendToken(streamKey, tokenBuf);
      tokenBuf = '';
    }
  };

  const flushThinking = () => {
    if (thinkingBuf) {
      store.appendThinking(streamKey, thinkingBuf);
      thinkingBuf = '';
    }
  };

  const flushAll = () => {
    // Flush in order: thinking first (it typically precedes text)
    flushThinking();
    flushTokens();
  };

  for (const event of replayEvents) {
    const data = (event.data ?? {}) as Record<string, unknown>;

    // Skip all stream-affecting events from internal turns (context, summary).
    // These should not affect the stream blocks during replay either.
    const isInternal = !!data['__isInternalTurn'];

    switch (event.kind) {
      // ── Streaming tokens (batched) ──
      case 'harness.token':
        if (isInternal) break;
        // If we had thinking buffered, flush it before switching to text
        if (thinkingBuf) flushThinking();
        {
          const tokenText = (data['text'] as string) ?? '';
          if (tokenText) tokenBuf += tokenText;
        }
        break;

      case 'harness.reasoning_delta':
        if (isInternal) break;
        // If we had text buffered, flush it before switching to thinking
        if (tokenBuf) flushTokens();
        {
          const thinkText = (data['text'] as string) ?? '';
          if (thinkText) thinkingBuf += thinkText;
        }
        break;

      case 'harness.reasoning_complete':
        if (isInternal) break;
        flushAll();
        store.completeThinking(streamKey);
        break;

      // ── Tool calls ──
      case 'harness.tool_start':
        if (isInternal) break;
        flushAll();
        store.addToolCall(
          streamKey,
          data['tool'] as string,
          data['args'],
          (data['callId'] as string) ?? undefined,
          typeof data['parentToolCallId'] === 'string' ? data['parentToolCallId'] : undefined,
        );
        break;

      case 'harness.tool_complete':
        if (isInternal) break;
        flushAll();
        store.completeToolCall(
          streamKey,
          (data['callId'] as string) ?? (data['tool'] as string),
          data['result'],
          data['fileOp'] && typeof data['fileOp'] === 'object'
            ? (data['fileOp'] as ToolFileOp)
            : undefined,
        );
        break;

      // A warning does not end the turn; it names something the user has to
      // act on, most often an MCP server that failed to start. Without this
      // case a page reload dropped it entirely (review 2.4).
      case 'harness.warning':
        if (isInternal) break;
        store.addSystemMessage(streamKey, String(data['message'] ?? 'Warning'), 'warning');
        break;

      // ── Errors ──
      case 'harness.error':
        if (isInternal) break;
        flushAll();
        store.errorStream(streamKey);
        store.addSystemMessage(streamKey, `Error: ${data['message']}`, 'error');
        break;

      // ── Stream completion markers ──
      case 'harness.message_complete':
        if (isInternal) break;
        flushAll();
        // When the model outputs <function_calls> XML inline (no SDK tool events),
        // parse them from the message content and inject as completed ToolCallBlocks.
        {
          const msgContent = data['content'] as string | undefined;
          if (msgContent && (/<function_calls>/.test(msgContent) || /<tool_calls>/.test(msgContent))) {
            store.processInlineToolCalls(streamKey, msgContent);
          } else if (msgContent) {
            // When SDK delivers content only via message_complete (no token
            // streaming), inject the full response so stream blocks have
            // displayable content for active stages on refresh.
            const existingStream = useStreamStore.getState().streams[streamKey];
            const hasNoTextBlocks = !existingStream || existingStream.blocks.every(
              (b) => b.type !== 'text',
            );
            if (hasNoTextBlocks) {
              flushAll();
              tokenBuf = msgContent;
              flushTokens();
            }
          }
        }
        // Don't call completeStream — message_complete fires mid-turn
        // (e.g. before tool calls). Only copilot.idle marks true completion.
        sawMessageCompleteInCurrentTurn = true;
        break;

      case 'harness.idle':
        if (isInternal) break;
        flushAll();
        store.completeStream(streamKey);
        sawIdleInCurrentTurn = true;
        break;

      // ── Usage stats ──
      // Usage and context telemetry are NOT gated on `isInternal`: a
      // framework-issued turn (context injection, summarisation) spends real
      // tokens and occupies the real context window. The internal flag only
      // means "don't reset the stream blocks".
      case 'harness.usage':
        if (typeof data['agentId'] === 'string' && data['agentId']) break;
        store.setUsage(streamKey, {
          model: (data['model'] as string) ?? 'unknown',
          inputTokens: (data['inputTokens'] as number) ?? 0,
          outputTokens: (data['outputTokens'] as number) ?? 0,
          durationMs: (data['durationMs'] as number) ?? undefined,
          cacheReadTokens: (data['cacheReadTokens'] as number) ?? undefined,
          cacheWriteTokens: (data['cacheWriteTokens'] as number) ?? undefined,
          cost: (data['cost'] as number) ?? undefined,
          provider: (data['provider'] as string) ?? undefined,
        });
        break;

      // ── Context-window snapshot (harness.context_usage) ──
      case 'harness.context_usage':
        if (typeof data['agentId'] === 'string' && data['agentId']) break;
        applyContextUsage(store, streamKey, data);
        break;

      case 'harness.session_info':
        break;

      // ── Widget events (extension-rendered UI) ──
      case 'harness.widget.render':
        flushAll();
        store.addWidget(streamKey, {
          instanceId: String(data['instanceId'] ?? ''),
          descriptorId: String(data['descriptorId'] ?? ''),
          extensionId: String(data['extensionId'] ?? ''),
          component: String(data['component'] ?? ''),
          title: typeof data['title'] === 'string' ? data['title'] : undefined,
          surface: typeof data['surface'] === 'string' ? data['surface'] : 'widget',
          assetsBase: typeof data['assetsBase'] === 'string' ? data['assetsBase'] : '',
          entry: String(data['entry'] ?? ''),
          props: data['props'],
          state: data['state'],
          status: 'active',
        });
        break;
      case 'harness.widget.state':
        flushAll();
        store.updateWidgetState(streamKey, String(data['instanceId'] ?? ''), data['state']);
        break;
      case 'harness.widget.closed':
        flushAll();
        store.setWidgetStatus(streamKey, String(data['instanceId'] ?? ''), 'closed');
        break;
      case 'harness.widget.error':
        flushAll();
        store.setWidgetStatus(
          streamKey,
          String(data['instanceId'] ?? ''),
          'error',
          typeof data['error'] === 'string' ? data['error'] : undefined,
        );
        break;

      // ── PLN-01: plan mode cards ──
      //
      // Only relevant for a turn that has NOT reached idle (i.e. a gate is
      // still open). Completed turns take the fast path above and rebuild
      // their cards from the assistant message metadata instead.
      case 'chat.plan.created':
        flushAll();
        store.upsertPlan(streamKey, {
          planId: String(data['planId'] ?? ''),
          revision: Number(data['revision'] ?? 1),
          title: String(data['title'] ?? 'Plan'),
          fileName: String(data['fileName'] ?? 'plan.md'),
          summary: String(data['summary'] ?? ''),
          status: 'drafting',
          actions: [],
        });
        break;
      case 'chat.plan.review_requested':
        flushAll();
        // Omit title/fileName when absent so the merge keeps the values that
        // `chat.plan.created` already put on the card.
        store.upsertPlan(streamKey, {
          planId: String(data['planId'] ?? ''),
          revision: Number(data['revision'] ?? 1),
          ...(typeof data['title'] === 'string' && data['title']
            ? { title: data['title'] }
            : { title: String(data['summary'] ?? 'Plan') }),
          ...(typeof data['fileName'] === 'string' && data['fileName']
            ? { fileName: data['fileName'] }
            : {}),
          summary: String(data['summary'] ?? ''),
          status: 'awaiting_review',
          actions: Array.isArray(data['actions']) ? (data['actions'] as string[]) : [],
          ...(typeof data['recommendedAction'] === 'string'
            ? { recommendedAction: data['recommendedAction'] }
            : {}),
          interactionId: String(data['interactionId'] ?? ''),
        });
        break;
      case 'chat.plan.decided': {
        flushAll();
        const approved = data['approved'] === true;
        const action = typeof data['action'] === 'string' ? data['action'] : undefined;
        store.setPlanStatus(
          streamKey,
          String(data['planId'] ?? ''),
          approved ? (action === 'exit_only' ? 'rejected' : 'approved') : 'changes_requested',
        );
        break;
      }
      case 'chat.plan.expired':
        flushAll();
        store.setPlanStatus(streamKey, String(data['planId'] ?? ''), 'expired');
        break;
      case 'chat.question.asked':
        flushAll();
        store.upsertQuestion(streamKey, {
          interactionId: String(data['interactionId'] ?? ''),
          questions: Array.isArray(data['questions'])
            ? (data['questions'] as QuestionBlock['questions'])
            : [],
          status: 'pending',
        });
        break;
      case 'chat.question.answered':
        flushAll();
        store.answerQuestion(
          streamKey,
          String(data['interactionId'] ?? ''),
          (data['answers'] as Record<string, string[]>) ?? {},
          typeof data['freeformResponse'] === 'string' ? data['freeformResponse'] : undefined,
        );
        break;
      case 'chat.question.expired':
        flushAll();
        store.expireQuestion(streamKey, String(data['interactionId'] ?? ''));
        break;

      // ── Tool-permission gate (review finding 5.1) ──
      case 'chat.permission.requested':
        flushAll();
        store.upsertPermission(streamKey, {
          interactionId: String(data['interactionId'] ?? ''),
          toolName: String(data['toolName'] ?? ''),
          permissionType: String(data['type'] ?? ''),
          description: String(data['description'] ?? ''),
          inputSummary: String(data['inputSummary'] ?? ''),
          permissionMode: String(data['permissionMode'] ?? ''),
          status: 'pending',
        });
        break;
      case 'chat.permission.resolved':
        flushAll();
        store.resolvePermission(
          streamKey,
          String(data['interactionId'] ?? ''),
          data['behavior'] === 'deny' ? 'deny' : 'allow',
          typeof data['message'] === 'string' ? data['message'] : undefined,
        );
        break;
      case 'chat.permission.expired':
        flushAll();
        store.expirePermission(streamKey, String(data['interactionId'] ?? ''));
        break;

      // ── Turn separator ──
      case 'harness.user_message':
        // Internal turns (context, summary) should not reset stream blocks
        if (isInternal) break;
        // New turn started — discard local buffers and reset stream for the new turn.
        // Only the latest turn's blocks survive, matching live behavior.
        tokenBuf = '';
        thinkingBuf = '';
        // Reset per-turn tracking
        sawIdleInCurrentTurn = false;
        sawMessageCompleteInCurrentTurn = false;
        // Use startPending directly (NOT clearStream + startPending).
        // startPending already resets all stream fields via ...DEFAULT_STREAM
        // and crucially preserves _nextBlockId so React keys don't collide
        // across turns. clearStream would reset _nextBlockId to 0 first,
        // then startPending would capture that 0 — losing any accumulated
        // block IDs from previous turns during this replay.
        //
        // Widget blocks from earlier turns are preserved by `startPending`
        // itself (see streamStore.ts) — widgets live only in the event
        // stream, so wiping them here would drop rendered iframes.
        {
          const userContent = (data['content'] as string) ?? '';
          store.startPending(streamKey, userContent || undefined);
        }
        break;

      // ── System messages ──
      default: {
        if (isInternal) break;
        const sysMsg = formatSystemMessage(event.kind, data);
        if (sysMsg) {
          flushAll();
          store.addSystemMessage(streamKey, sysMsg.message, sysMsg.category);
        }
        // Other events (session.*, workflow.*, etc.) are ignored during replay
        // since they affect query caches, not stream blocks.
        break;
      }
    }
  }

  // Final flush of any remaining buffered tokens
  flushAll();

  // Decide whether to mark the stream as complete.
  // - If we saw copilot.idle in the current turn, the turn is fully finished.
  //   chatHistory already has the assistant message. Clear the stream to 'idle'
  //   so that chatHistory becomes the sole data source — no dedup needed.
  // - If we saw copilot.message_complete (but no idle), the turn likely
  //   finished but idle wasn't persisted — force-complete it so the UI
  //   shows the accumulated blocks.
  // - Otherwise (no idle, no message_complete) the session may still be
  //   actively streaming (e.g. page refresh mid-turn). Leave the stream
  //   in its current status so live SSE events can continue seamlessly.
  if (sawIdleInCurrentTurn) {
    // Turn fully completed. For regular chat sessions, clear the stream so
    // chatHistory becomes the sole data source. For stageRun:* keys, keep
    // the replayed blocks and mark complete — they preserve correct temporal
    // interleaving of text and tool calls that chatHistory loses.
    //
    // Widget blocks: `clearStream` preserves widgets automatically (see
    // streamStore.ts). If any survived, restore 'complete' status so the
    // UI keeps rendering them (clearStream would otherwise leave 'idle').
    if (streamKey.startsWith('stageRun:')) {
      store.completeStream(streamKey);
    } else {
      store.clearStream(streamKey);
      const remaining = useStreamStore.getState().streams[streamKey]?.blocks.length ?? 0;
      if (remaining > 0) {
        store.completeStream(streamKey);
      }
    }
  } else if (sawMessageCompleteInCurrentTurn) {
    const stream = useStreamStore.getState().streams[streamKey];
    if (
      stream &&
      stream.blocks.length > 0 &&
      stream.status !== 'complete' &&
      stream.status !== 'error'
    ) {
      store.completeStream(streamKey);
    }
  }
}
