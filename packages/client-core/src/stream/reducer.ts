// ────────────────────────────────────────────────────────────────
// Pure stream reducers.
//
// Every function here is `(streams, sessionId, …args) => StreamsRecord`:
// no framework, no clock beyond `Date.now()`, no I/O. apps/web wraps them
// in Zustand; apps/mobile wraps the same functions in its own store, so
// the two cannot diverge in behaviour.
//
// ── Invariants these functions encode ────────────────────────────
//
//  1. `blocks` is append-ordered and never re-sorted. Temporal order IS
//     the data; re-deriving it later is impossible.
//  2. `_nextBlockId` is monotonic ACROSS turns. Resetting it collides
//     React keys when a node is reused between turns.
//  3. Terminal statuses (`complete` / `idle` / `error`) are never revived
//     by a late event. A tool result arriving after idle must not drag the
//     stream back to `streaming`, or auto-clear never fires.
//  4. Widget blocks survive turn boundaries and `clearStream`. They are
//     sandboxed iframes holding their own DOM state and are carried by no
//     chat message, so dropping them silently destroys user-visible UI.
//  5. `usage` / `contextUsage` survive `clearStream`. The context gauge
//     describes the conversation, not the turn; resetting it to 0% the
//     instant a turn ends is wrong.
// ────────────────────────────────────────────────────────────────

import { parseInlineToolCalls } from './parseInlineToolCalls.js';
import type { ContextUsageSnapshot } from './contextUsage.js';
import {
  DEFAULT_STREAM,
  type PlanBlock,
  type QuestionBlock,
  type StreamBlock,
  type StreamState,
  type StreamUsage,
  type StreamsRecord,
  type SystemBlock,
  type SystemCategory,
  type ToolCallBlock,
  type WidgetBlock,
} from './types.js';

/** Read a session's state, falling back to the shared default. */
export function getStream(streams: StreamsRecord, sessionId: string): StreamState {
  return streams[sessionId] ?? DEFAULT_STREAM;
}

/** Replace one session's entry, leaving the rest of the record untouched. */
function put(streams: StreamsRecord, sessionId: string, next: StreamState): StreamsRecord {
  return { ...streams, [sessionId]: next };
}

function existingOrDefault(streams: StreamsRecord, sessionId: string): StreamState {
  return streams[sessionId] ?? { ...DEFAULT_STREAM };
}

/**
 * Replace a single block matched by predicate. Returns the ORIGINAL record
 * when nothing matches, so callers naturally skip a re-render.
 */
function replaceBlock(
  streams: StreamsRecord,
  sessionId: string,
  match: (b: StreamBlock) => boolean,
  update: (b: StreamBlock) => StreamBlock,
): StreamsRecord {
  const existing = streams[sessionId];
  if (!existing) return streams;
  const idx = existing.blocks.findIndex(match);
  if (idx < 0) return streams;
  const prior = existing.blocks[idx];
  // `noUncheckedIndexedAccess` cannot see that findIndex >= 0 implies a hit.
  if (!prior) return streams;
  const blocks = existing.blocks.slice();
  blocks[idx] = update(prior);
  return put(streams, sessionId, { ...existing, blocks });
}

// ── Text and thinking ───────────────────────────────────────────

export function appendToken(
  streams: StreamsRecord,
  sessionId: string,
  token: string,
): StreamsRecord {
  // Empty tokens would create empty blocks and pointless re-renders.
  if (!token) return streams;

  const existing = existingOrDefault(streams, sessionId);
  const blocks = [...existing.blocks];
  const lastBlock = blocks[blocks.length - 1];
  let nextId = existing._nextBlockId;

  if (lastBlock && lastBlock.type === 'text') {
    blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + token };
  } else {
    // A new text block: this is what breaks text at thinking / tool-call
    // boundaries and preserves interleaving.
    blocks.push({ type: 'text', blockId: nextId, content: token });
    nextId += 1;
  }

  return put(streams, sessionId, {
    ...existing,
    text: existing.text + token,
    status: 'streaming',
    blocks,
    _nextBlockId: nextId,
    // pendingUserMessage is deliberately NOT cleared here. Consumers hide it
    // once history includes the user message; clearing it now causes a flash
    // where the message vanishes between status change and refetch.
  });
}

/**
 * Commit an answer that only ever arrived on `message_complete`.
 *
 * Some providers deliver the whole response in one event with no token
 * deltas behind it. Appending unconditionally would duplicate the answer for
 * every provider that DOES stream, so this is a no-op once any text block
 * exists for the turn.
 */
export function appendTokenIfNoText(
  streams: StreamsRecord,
  sessionId: string,
  text: string,
): StreamsRecord {
  if (!text) return streams;
  const existing = streams[sessionId];
  if (existing && existing.blocks.some((block) => block.type === 'text')) return streams;
  return appendToken(streams, sessionId, text);
}

export function appendThinking(
  streams: StreamsRecord,
  sessionId: string,
  text: string,
): StreamsRecord {
  if (!text) return streams;

  const existing = existingOrDefault(streams, sessionId);
  const blocks = [...existing.blocks];
  const lastBlock = blocks[blocks.length - 1];
  let nextId = existing._nextBlockId;

  if (lastBlock && lastBlock.type === 'thinking' && !lastBlock.isComplete) {
    blocks[blocks.length - 1] = { ...lastBlock, text: lastBlock.text + text };
  } else {
    blocks.push({ type: 'thinking', blockId: nextId, text, isComplete: false });
    nextId += 1;
  }

  return put(streams, sessionId, {
    ...existing,
    thinkingText: existing.thinkingText + text,
    status: 'thinking',
    blocks,
    _nextBlockId: nextId,
  });
}

export function completeThinking(streams: StreamsRecord, sessionId: string): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  const blocks = existing.blocks.map((block) =>
    block.type === 'thinking' && !block.isComplete ? { ...block, isComplete: true } : block,
  );
  return put(streams, sessionId, { ...existing, status: 'streaming', blocks });
}

// ── Tool calls ──────────────────────────────────────────────────

export function addToolCall(
  streams: StreamsRecord,
  sessionId: string,
  tool: string,
  args: unknown,
  callId?: string,
): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  const id = callId ?? `tc_${existing._toolCallCounter}`;

  // De-dup by callId. Some providers (Claude Agent SDK) emit tool_start twice:
  // once with empty args when the tool_use block opens, then again with the
  // materialized args, both carrying the same callId. Without this, the second
  // block is never completed by tool_complete and spins forever.
  if (callId) {
    const hasBlockWithId = existing.blocks.some(
      (b) => b.type === 'tool_call' && b.callId === callId,
    );
    if (hasBlockWithId) {
      const hasIncomingArgs =
        args != null &&
        (typeof args !== 'object' || Object.keys(args as Record<string, unknown>).length > 0);

      const blocks = existing.blocks.map((b) => {
        if (b.type === 'tool_call' && b.callId === callId) {
          return {
            ...b,
            args: hasIncomingArgs ? args : b.args,
            // Status is preserved — never revive a completed tool call.
            tool: b.tool || tool,
          };
        }
        return b;
      });
      const toolCalls = existing.toolCalls.map((tc) =>
        tc.id === callId
          ? { ...tc, args: hasIncomingArgs ? args : tc.args, tool: tc.tool || tool }
          : tc,
      );
      return put(streams, sessionId, { ...existing, toolCalls, blocks });
    }
  }

  const newBlock: ToolCallBlock = {
    type: 'tool_call',
    blockId: existing._nextBlockId,
    callId: id,
    tool,
    args,
    status: 'running',
  };

  return put(streams, sessionId, {
    ...existing,
    toolCalls: [...existing.toolCalls, { id, tool, args, status: 'running' }],
    status: 'streaming',
    blocks: [...existing.blocks, newBlock],
    _nextBlockId: existing._nextBlockId + 1,
    _toolCallCounter: existing._toolCallCounter + 1,
  });
}

export function completeToolCall(
  streams: StreamsRecord,
  sessionId: string,
  toolOrCallId: string,
  result: unknown,
): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);

  // Match by callId first, then by tool name — and only the FIRST running
  // match, so two concurrent calls to the same tool complete independently.
  let foundFlat = false;
  const toolCalls = existing.toolCalls.map((tc) => {
    if (foundFlat || tc.status !== 'running') return tc;
    if (tc.id === toolOrCallId || tc.tool === toolOrCallId) {
      foundFlat = true;
      return { ...tc, result, status: 'complete' as const };
    }
    return tc;
  });

  let foundBlock = false;
  const blocks = existing.blocks.map((block) => {
    if (foundBlock || block.type !== 'tool_call' || block.status !== 'running') return block;
    if (block.callId === toolOrCallId || block.tool === toolOrCallId) {
      foundBlock = true;
      return { ...block, result, status: 'complete' as const };
    }
    return block;
  });

  return put(streams, sessionId, {
    ...existing,
    toolCalls,
    blocks,
    // Invariant 3: a late tool_complete after idle must not resurrect
    // 'streaming', or the auto-clear never detects completion.
    status:
      existing.status === 'complete' || existing.status === 'idle' || existing.status === 'error'
        ? existing.status
        : 'streaming',
  });
}

// ── System messages ─────────────────────────────────────────────

export function addSystemMessage(
  streams: StreamsRecord,
  sessionId: string,
  message: string,
  category: SystemCategory = 'system',
): StreamsRecord {
  if (!message?.trim()) return streams;

  const existing = existingOrDefault(streams, sessionId);
  const newBlock: SystemBlock = {
    type: 'system',
    blockId: existing._nextBlockId,
    message,
    category,
  };

  return put(streams, sessionId, {
    ...existing,
    systemMessages: [...existing.systemMessages, message],
    blocks: [...existing.blocks, newBlock],
    _nextBlockId: existing._nextBlockId + 1,
  });
}

// ── Turn lifecycle ──────────────────────────────────────────────

export function startPending(
  streams: StreamsRecord,
  sessionId: string,
  userMessage?: string,
): StreamsRecord {
  const existing = streams[sessionId];
  // Invariant 4 — carry widgets across the turn barrier.
  const priorWidgets = (existing?.blocks ?? []).filter((b) => b.type === 'widget');

  return put(streams, sessionId, {
    ...DEFAULT_STREAM,
    status: 'pending',
    pendingUserMessage: userMessage ?? null,
    turnUserMessage: userMessage ?? null,
    // The new turn's turn_start has not arrived; consumers fall back to
    // content matching until it does.
    serverTurnId: null,
    // Invariant 2 — DEFAULT_STREAM would reset this to 0 and collide keys.
    _nextBlockId: existing?._nextBlockId ?? 0,
    turnId: (existing?.turnId ?? 0) + 1,
    blocks: priorWidgets,
  });
}

/**
 * Begin a turn in response to a `harness.user_message` event.
 *
 * `startPending` resets the block list, which is correct for a genuinely new
 * turn and destructive for a replayed one — and every gap-fill after a
 * dropped connection replays the user message. So the reset is skipped while
 * a turn with the SAME prompt is already in flight; a different prompt still
 * starts a new turn, because that is a real second turn arriving from
 * another client.
 */
export function startTurn(
  streams: StreamsRecord,
  sessionId: string,
  userMessage?: string,
): StreamsRecord {
  const existing = streams[sessionId];
  const inTurn =
    existing !== undefined &&
    (existing.status === 'pending' ||
      ((existing.status === 'streaming' || existing.status === 'thinking') &&
        existing.blocks.length > 0));

  if (inTurn) {
    const incoming = (userMessage ?? '').trim();
    const current = (existing.turnUserMessage ?? '').trim();
    if (!incoming || !current || incoming === current) return streams;
  }
  return startPending(streams, sessionId, userMessage);
}

export function setServerTurnId(
  streams: StreamsRecord,
  sessionId: string,
  turnId: string,
): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  if (existing.serverTurnId === turnId) return streams;
  return put(streams, sessionId, { ...existing, serverTurnId: turnId });
}

export function completeStream(streams: StreamsRecord, sessionId: string): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  // Do not overwrite 'pending' — a new turn has already started.
  if (existing.status === 'pending') return streams;
  return put(streams, sessionId, { ...existing, status: 'complete' });
}

export function errorStream(streams: StreamsRecord, sessionId: string): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  return put(streams, sessionId, { ...existing, status: 'error', pendingUserMessage: null });
}

export function clearStreamText(streams: StreamsRecord, sessionId: string): StreamsRecord {
  const existing = streams[sessionId];
  if (!existing) return streams;
  return put(streams, sessionId, { ...existing, text: '' });
}

export function clearStream(streams: StreamsRecord, sessionId: string): StreamsRecord {
  const existing = streams[sessionId];
  // Invariant 4 — callers that truly want widgets gone must close them first.
  const priorWidgets = (existing?.blocks ?? []).filter((b) => b.type === 'widget');

  return put(streams, sessionId, {
    ...DEFAULT_STREAM,
    // Invariant 2.
    _nextBlockId: existing?._nextBlockId ?? 0,
    blocks: priorWidgets,
    // Invariant 5.
    usage: existing?.usage ?? null,
    contextUsage: existing?.contextUsage ?? null,
  });
}

// ── Usage ───────────────────────────────────────────────────────

export function setUsage(
  streams: StreamsRecord,
  sessionId: string,
  usage: StreamUsage,
): StreamsRecord {
  const existing = streams[sessionId];
  // Do not conjure a ghost entry for an unknown session — but DO allow
  // recording on an idle (completed) stream: replay applies usage after
  // clearStream, and blocking idle would freeze the gauge at 0%.
  if (!existing) return streams;
  return put(streams, sessionId, { ...existing, usage });
}

export function setContextUsage(
  streams: StreamsRecord,
  sessionId: string,
  snapshot: ContextUsageSnapshot,
  now: number = Date.now(),
): StreamsRecord {
  const existing = streams[sessionId];
  if (!existing) return streams;
  // Last write wins, deliberately. Within a turn the derived estimate lands
  // first and the provider's authoritative breakdown lands immediately after,
  // so the accurate one ends up on top; if the provider call fails we fall
  // back to the estimate rather than freezing on a stale snapshot. It also
  // lets the value go DOWN after compaction, which a max() would prevent.
  return put(streams, sessionId, {
    ...existing,
    contextUsage: { ...snapshot, at: now },
  });
}

// ── Widgets ─────────────────────────────────────────────────────

export function addWidget(
  streams: StreamsRecord,
  sessionId: string,
  widget: Omit<WidgetBlock, 'type' | 'blockId' | 'surface'> & { surface: string },
): StreamsRecord {
  // Normalize legacy surfaces to the two canonical ones.
  const normalizedSurface: 'inline' | 'widget' =
    widget.surface === 'inline' || widget.surface === 'chat' ? 'inline' : 'widget';
  const normalized = { ...widget, surface: normalizedSurface };

  const existing = existingOrDefault(streams, sessionId);
  // De-dup by instanceId — a resume/replay can re-emit the same render.
  const idx = existing.blocks.findIndex(
    (b) => b.type === 'widget' && b.instanceId === normalized.instanceId,
  );
  if (idx >= 0) {
    const blocks = existing.blocks.slice();
    blocks[idx] = { ...(blocks[idx] as WidgetBlock), ...normalized };
    return put(streams, sessionId, { ...existing, blocks });
  }

  const block: WidgetBlock = { type: 'widget', blockId: existing._nextBlockId, ...normalized };
  return put(streams, sessionId, {
    ...existing,
    blocks: [...existing.blocks, block],
    _nextBlockId: existing._nextBlockId + 1,
  });
}

export function updateWidgetState(
  streams: StreamsRecord,
  sessionId: string,
  instanceId: string,
  state: unknown,
): StreamsRecord {
  return replaceBlock(
    streams,
    sessionId,
    (b) => b.type === 'widget' && b.instanceId === instanceId,
    (b) => ({ ...(b as WidgetBlock), state }),
  );
}

export function setWidgetStatus(
  streams: StreamsRecord,
  sessionId: string,
  instanceId: string,
  status: WidgetBlock['status'],
  error?: string,
): StreamsRecord {
  return replaceBlock(
    streams,
    sessionId,
    (b) => b.type === 'widget' && b.instanceId === instanceId,
    (b) => ({
      ...(b as WidgetBlock),
      status,
      ...(error !== undefined ? { error } : {}),
    }),
  );
}

// ── Plan and question cards ─────────────────────────────────────

export function upsertPlan(
  streams: StreamsRecord,
  sessionId: string,
  plan: Omit<PlanBlock, 'type' | 'blockId'>,
  now: number = Date.now(),
): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  // De-dup by planId — a revision updates the card in place, so "request
  // changes" does not stack a new card on every review round.
  const idx = existing.blocks.findIndex((b) => b.type === 'plan' && b.planId === plan.planId);
  const openedAt = plan.status === 'awaiting_review' ? { openedAt: now } : {};

  if (idx >= 0) {
    const blocks = existing.blocks.slice();
    blocks[idx] = { ...(blocks[idx] as PlanBlock), ...plan, ...openedAt };
    return put(streams, sessionId, { ...existing, blocks });
  }

  const block: PlanBlock = {
    type: 'plan',
    blockId: existing._nextBlockId,
    ...plan,
    ...openedAt,
  };
  return put(streams, sessionId, {
    ...existing,
    blocks: [...existing.blocks, block],
    _nextBlockId: existing._nextBlockId + 1,
  });
}

export function setPlanStatus(
  streams: StreamsRecord,
  sessionId: string,
  planId: string,
  status: PlanBlock['status'],
  extra?: { interactionId?: string; revision?: number },
  now: number = Date.now(),
): StreamsRecord {
  return replaceBlock(
    streams,
    sessionId,
    (b) => b.type === 'plan' && b.planId === planId,
    (b) => ({
      ...(b as PlanBlock),
      status,
      ...(status === 'awaiting_review' ? { openedAt: now } : {}),
      ...(extra?.interactionId ? { interactionId: extra.interactionId } : {}),
      ...(extra?.revision !== undefined ? { revision: extra.revision } : {}),
    }),
  );
}

export function upsertQuestion(
  streams: StreamsRecord,
  sessionId: string,
  question: Omit<QuestionBlock, 'type' | 'blockId'>,
  now: number = Date.now(),
): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  const idx = existing.blocks.findIndex(
    (b) => b.type === 'question' && b.interactionId === question.interactionId,
  );
  const openedAt = question.status === 'pending' ? { openedAt: now } : {};

  if (idx >= 0) {
    const blocks = existing.blocks.slice();
    blocks[idx] = { ...(blocks[idx] as QuestionBlock), ...question, ...openedAt };
    return put(streams, sessionId, { ...existing, blocks });
  }

  const block: QuestionBlock = {
    type: 'question',
    blockId: existing._nextBlockId,
    ...question,
    ...openedAt,
  };
  return put(streams, sessionId, {
    ...existing,
    blocks: [...existing.blocks, block],
    _nextBlockId: existing._nextBlockId + 1,
  });
}

export function answerQuestion(
  streams: StreamsRecord,
  sessionId: string,
  interactionId: string,
  answers: Record<string, string[]>,
  freeformResponse?: string,
): StreamsRecord {
  return replaceBlock(
    streams,
    sessionId,
    (b) => b.type === 'question' && b.interactionId === interactionId,
    (b) => ({
      ...(b as QuestionBlock),
      status: 'answered',
      answers,
      ...(freeformResponse ? { freeformResponse } : {}),
    }),
  );
}

export function expireQuestion(
  streams: StreamsRecord,
  sessionId: string,
  interactionId: string,
): StreamsRecord {
  const existing = streams[sessionId];
  if (!existing) return streams;
  const idx = existing.blocks.findIndex(
    (b) => b.type === 'question' && b.interactionId === interactionId,
  );
  if (idx < 0) return streams;
  const prior = existing.blocks[idx] as QuestionBlock;
  // An answered card is terminal: a late expiry must not undo the answer.
  if (prior.status === 'answered') return streams;

  const blocks = existing.blocks.slice();
  blocks[idx] = { ...prior, status: 'expired' };
  return put(streams, sessionId, { ...existing, blocks });
}

// ── Inline tool calls ───────────────────────────────────────────

/**
 * Restructure the transcript when the model emitted `<function_calls>` XML in
 * the token stream instead of using the SDK tool protocol.
 *
 * Text blocks are replaced wholesale by the parsed text + tool_call sequence;
 * non-text blocks (thinking, system, real tool calls) are preserved.
 */
export function processInlineToolCalls(
  streams: StreamsRecord,
  sessionId: string,
  content: string,
): StreamsRecord {
  const segments = parseInlineToolCalls(content);
  if (!segments) return streams;

  const existing = existingOrDefault(streams, sessionId);

  const nonTextBlocks = existing.blocks.filter((b) => b.type !== 'text');
  let nextId = existing._nextBlockId;
  let tcCounter = existing._toolCallCounter;
  const newBlocks: StreamBlock[] = [...nonTextBlocks];
  const newToolCalls = [...existing.toolCalls];

  for (const seg of segments) {
    if (seg.type === 'text' && seg.content) {
      newBlocks.push({ type: 'text', blockId: nextId, content: seg.content });
      nextId += 1;
    } else if (seg.type === 'tool_call' && seg.toolCall) {
      const tc = seg.toolCall;
      const callId = `inline_tc_${tcCounter}`;
      newBlocks.push({
        type: 'tool_call',
        blockId: nextId,
        callId,
        tool: tc.name,
        args: tc.args,
        result: tc.result ?? 'Completed',
        status: 'complete',
      });
      newToolCalls.push({
        id: callId,
        tool: tc.name,
        args: tc.args,
        result: tc.result ?? 'Completed',
        status: 'complete',
      });
      nextId += 1;
      tcCounter += 1;
    }
  }

  return put(streams, sessionId, {
    ...existing,
    blocks: newBlocks,
    toolCalls: newToolCalls,
    _nextBlockId: nextId,
    _toolCallCounter: tcCounter,
  });
}
