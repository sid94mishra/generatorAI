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
//  6. The record is BOUNDED. Every write stamps `lastActivityAt`, and
//     `pruneStreams` evicts the least-recently-touched entries past a cap.
//     Without it, every session and every `stageRun:<id>` key ever streamed
//     retains its full block array — tool results and widget props included
//     — for the lifetime of the tab (W27 "bounded stores").
// ────────────────────────────────────────────────────────────────

import type { ScmFlowResult } from '@generatorai/shared';
import { parseInlineToolCalls } from './parseInlineToolCalls.js';
import type { ContextUsageSnapshot } from './contextUsage.js';
import {
  DEFAULT_STREAM,
  type BackgroundTaskBlock,
  type ScmResultBlock,
  type PermissionBlock,
  type PlanBlock,
  type QuestionBlock,
  type StreamBlock,
  type StreamHookInvocation,
  type StreamState,
  type StreamUsage,
  type StreamsRecord,
  type SystemBlock,
  type SystemCategory,
  type ToolCallBlock,
  type ToolFileOp,
  type WidgetBlock,
} from './types.js';

/** Read a session's state, falling back to the shared default. */
export function getStream(streams: StreamsRecord, sessionId: string): StreamState {
  return streams[sessionId] ?? DEFAULT_STREAM;
}

/**
 * Recency clock for LRU eviction.
 *
 * A counter, not `Date.now()`: a streaming turn writes dozens of times per
 * millisecond, so a millisecond clock leaves whole bursts tied and makes the
 * eviction order arbitrary — precisely under the load where eviction matters.
 * The absolute value is meaningless; only the ordering is.
 */
let activityStamp = 0;

/** Replace one session's entry, leaving the rest of the record untouched. */
function put(streams: StreamsRecord, sessionId: string, next: StreamState): StreamsRecord {
  activityStamp += 1;
  return { ...streams, [sessionId]: { ...next, lastActivityAt: activityStamp } };
}

function existingOrDefault(streams: StreamsRecord, sessionId: string): StreamState {
  return streams[sessionId] ?? { ...DEFAULT_STREAM };
}

/**
 * The status a live event wants to set, unless the user already pressed Stop.
 *
 * Aborting is a round trip: the provider keeps emitting for a moment after
 * `cancel`. Letting those events set `streaming` again flips the composer back
 * to a Stop button, which reads as "my click did nothing" and makes people
 * click repeatedly. Content still lands — only the status is pinned.
 */
function liveStatus(existing: StreamState, next: StreamState['status']): StreamState['status'] {
  return existing.cancelRequested ? existing.status : next;
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
    status: liveStatus(existing, 'streaming'),
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
    status: liveStatus(existing, 'thinking'),
    blocks,
    _nextBlockId: nextId,
  });
}

export function completeThinking(streams: StreamsRecord, sessionId: string): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  const blocks = existing.blocks.map((block) =>
    block.type === 'thinking' && !block.isComplete ? { ...block, isComplete: true } : block,
  );
  return put(streams, sessionId, { ...existing, status: liveStatus(existing, 'streaming'), blocks });
}

// ── Tool calls ──────────────────────────────────────────────────

export function addToolCall(
  streams: StreamsRecord,
  sessionId: string,
  tool: string,
  args: unknown,
  callId?: string,
  parentCallId?: string,
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
    ...(parentCallId ? { parentCallId } : {}),
  };

  return put(streams, sessionId, {
    ...existing,
    toolCalls: [
      ...existing.toolCalls,
      { id, tool, args, status: 'running', ...(parentCallId ? { parentCallId } : {}) },
    ],
    status: liveStatus(existing, 'streaming'),
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
  fileOp?: ToolFileOp,
  success?: boolean,
): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  // Only an explicit failure marks the call; providers that never report
  // `success` leave the flag off, exactly as before.
  const failed = success === false ? { error: true as const } : {};

  // Match by callId first, then by tool name — and only the FIRST running
  // match, so two concurrent calls to the same tool complete independently.
  let foundFlat = false;
  const toolCalls = existing.toolCalls.map((tc) => {
    if (foundFlat || tc.status !== 'running') return tc;
    if (tc.id === toolOrCallId || tc.tool === toolOrCallId) {
      foundFlat = true;
      return { ...tc, result, status: 'complete' as const, ...(fileOp ? { fileOp } : {}), ...failed };
    }
    return tc;
  });

  let foundBlock = false;
  const blocks = existing.blocks.map((block) => {
    if (foundBlock || block.type !== 'tool_call' || block.status !== 'running') return block;
    if (block.callId === toolOrCallId || block.tool === toolOrCallId) {
      foundBlock = true;
      return { ...block, result, status: 'complete' as const, ...(fileOp ? { fileOp } : {}), ...failed };
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

// ── Hooks ───────────────────────────────────────────────────────
//
// The run inspector's Hooks tab was always empty (deriveRunView hardcoded
// `hooks: undefined`) because nothing turned `hook.*` events into structured
// data — `eventRouter` only narrated them as system-message text. These two
// functions pair `hook.started` with its `hook.completed`/`hook.failed` so
// the tab has something to render.

export function addHookStarted(
  streams: StreamsRecord,
  sessionId: string,
  hookName: string,
  phase: string,
  opts?: { hookId?: string; hookType?: string; stageRunId?: string },
): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  const record: StreamHookInvocation = {
    id: opts?.hookId ?? `hook_${existing._hookCounter}`,
    hookName,
    phase,
    status: 'running',
    ...(opts?.hookType ? { hookType: opts.hookType } : {}),
    ...(opts?.stageRunId ? { stageRunId: opts.stageRunId } : {}),
  };
  return put(streams, sessionId, {
    ...existing,
    hooks: [...existing.hooks, record],
    _hookCounter: opts?.hookId ? existing._hookCounter : existing._hookCounter + 1,
  });
}

/**
 * Finalise a hook invocation on `hook.completed` (`status: 'ok'`) or
 * `hook.failed` (`status: 'failed'`).
 *
 * Matches by `hookId` when the event carries one; otherwise falls back to
 * the most recent RUNNING record with the same `hookName` + `phase`, since
 * `hookId` is optional on the wire (see `AgentEvent.ts`). A completed/failed
 * event with no matching started record still produces a finished record —
 * replay can begin mid-hook, and dropping it would silently under-report.
 */
export function completeHook(
  streams: StreamsRecord,
  sessionId: string,
  status: 'ok' | 'failed',
  hookName: string,
  phase: string,
  opts?: { hookId?: string; hookType?: string; stageRunId?: string; durationMs?: number },
): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);

  let idx = opts?.hookId
    ? existing.hooks.findIndex((h) => h.id === opts.hookId)
    : -1;
  if (idx < 0) {
    for (let i = existing.hooks.length - 1; i >= 0; i--) {
      const h = existing.hooks[i];
      if (h && h.status === 'running' && h.hookName === hookName && h.phase === phase) {
        idx = i;
        break;
      }
    }
  }

  const finalize = (prior: Partial<StreamHookInvocation>): StreamHookInvocation => ({
    id: prior.id ?? opts?.hookId ?? `hook_${existing._hookCounter}`,
    hookName,
    phase,
    status,
    ...(opts?.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
    ...(opts?.hookType ?? prior.hookType ? { hookType: opts?.hookType ?? prior.hookType } : {}),
    ...(opts?.stageRunId ?? prior.stageRunId
      ? { stageRunId: opts?.stageRunId ?? prior.stageRunId }
      : {}),
  });

  if (idx >= 0) {
    const hooks = existing.hooks.slice();
    const prior = hooks[idx]!;
    hooks[idx] = finalize(prior);
    return put(streams, sessionId, { ...existing, hooks });
  }

  return put(streams, sessionId, {
    ...existing,
    hooks: [...existing.hooks, finalize({})],
    _hookCounter: opts?.hookId ? existing._hookCounter : existing._hookCounter + 1,
  });
}

// ── Background tasks (orchestrator workers) ─────────────────────

/**
 * Insert or merge one orchestrator worker's block, keyed by `taskId`.
 *
 * The `chat.background_task.*` family is five separate events describing ONE
 * worker over its lifetime, so this is an upsert rather than an append: the
 * `spawned` event creates the block and every later event narrows it. Fields
 * the incoming patch does not mention are preserved — `progress` carries no
 * `model` and `completed` carries no `currentStep`, and losing either would
 * make the row flicker between half-populated states.
 *
 * Returns the ORIGINAL record when the patch changes nothing, so a repeated
 * status event is a genuine no-op rather than a re-render.
 */
export function upsertBackgroundTask(
  streams: StreamsRecord,
  sessionId: string,
  task: Partial<Omit<BackgroundTaskBlock, 'type' | 'blockId'>> & { taskId: string },
): StreamsRecord {
  if (!task.taskId) return streams;
  const existing = existingOrDefault(streams, sessionId);
  const index = existing.blocks.findIndex(
    (b) => b.type === 'background_task' && b.taskId === task.taskId,
  );

  if (index === -1) {
    const block: BackgroundTaskBlock = {
      type: 'background_task',
      blockId: existing._nextBlockId,
      taskId: task.taskId,
      taskName: task.taskName ?? task.taskId,
      status: task.status ?? 'running',
      toolCalls: task.toolCalls ?? 0,
      startedAt: task.startedAt ?? 0,
      ...(task.model ? { model: task.model } : {}),
      ...(task.currentStep ? { currentStep: task.currentStep } : {}),
      ...(task.lastText ? { lastText: task.lastText } : {}),
      ...(task.endedAt ? { endedAt: task.endedAt } : {}),
      ...(task.summary ? { summary: task.summary } : {}),
      ...(task.parentCallId ? { parentCallId: task.parentCallId } : {}),
    };
    return put(streams, sessionId, {
      ...existing,
      // A worker's progress is not the orchestrator's turn. While the parent
      // is streaming its status stays; when it is idle (workers outlive the
      // turn that spawned them, and a page reload starts from `idle`) the
      // stream only needs to be non-idle so the row renders — `complete`
      // keeps the composer enabled and the Stop button hidden. Escalating to
      // `streaming` here made an idle orchestrator read "Generating response…"
      // with its input disabled until the next reload.
      status: existing.status === 'idle' ? liveStatus(existing, 'complete') : existing.status,
      blocks: [...existing.blocks, block],
      _nextBlockId: existing._nextBlockId + 1,
    });
  }

  const prior = existing.blocks[index] as BackgroundTaskBlock;
  // Only defined keys of the patch win; `undefined` means "unchanged".
  const merged: BackgroundTaskBlock = { ...prior };
  let changed = false;
  for (const key of [
    'taskName', 'model', 'status', 'currentStep', 'lastText',
    'toolCalls', 'startedAt', 'endedAt', 'summary', 'parentCallId',
  ] as const) {
    const value = task[key];
    if (value === undefined) continue;
    if (prior[key] === value) continue;
    (merged as unknown as Record<string, unknown>)[key] = value;
    changed = true;
  }
  // A settled worker never goes back to a live step line.
  if (task.status && task.status !== 'running' && task.status !== 'spawned' && prior.currentStep) {
    delete (merged as { currentStep?: string }).currentStep;
    changed = true;
  }
  if (!changed) return streams;

  const blocks = existing.blocks.slice();
  blocks[index] = merged;
  return put(streams, sessionId, { ...existing, blocks });
}

// ── Source-control results ──────────────────────────────────────

/**
 * Insert or replace the source-control result for one turn.
 *
 * Upsert rather than append, keyed by `turnId`: a turn runs the flow once,
 * but the user may resolve a merge conflict and re-run it, and the second
 * outcome is a correction of the first — not a second event. Appending
 * would leave "conflicts" standing above "pushed" forever.
 *
 * Returns the ORIGINAL record when the result is identical, so a replayed
 * event is a genuine no-op.
 */
export function upsertScmResult(
  streams: StreamsRecord,
  sessionId: string,
  turnId: string,
  result: ScmFlowResult,
): StreamsRecord {
  if (!turnId || !result) return streams;
  const existing = existingOrDefault(streams, sessionId);
  const index = existing.blocks.findIndex(
    (b) => b.type === 'scm_result' && b.turnId === turnId,
  );

  if (index === -1) {
    const block: ScmResultBlock = {
      type: 'scm_result',
      blockId: existing._nextBlockId,
      turnId,
      result,
    };
    return put(streams, sessionId, {
      ...existing,
      // The flow runs AFTER the turn settles, so the stream is usually idle
      // by the time this lands. Nudging it off `idle` is what makes the block
      // render at all; `complete` keeps the composer enabled and Stop hidden.
      status: existing.status === 'idle' ? liveStatus(existing, 'complete') : existing.status,
      blocks: [...existing.blocks, block],
      _nextBlockId: existing._nextBlockId + 1,
    });
  }

  const prior = existing.blocks[index] as ScmResultBlock;
  if (prior.result === result) return streams;
  const blocks = existing.blocks.slice();
  blocks[index] = { ...prior, result };
  return put(streams, sessionId, { ...existing, blocks });
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
  /**
   * A `harness.user_message` echo carries no content of its own for some
   * providers. Falling back to the optimistic message the composer already
   * showed keeps the user's own prompt on screen; without it the turn's
   * prompt blinked out the moment the server acknowledged it.
   */
  const text = userMessage ?? existing?.pendingUserMessage ?? undefined;

  return put(streams, sessionId, {
    ...DEFAULT_STREAM,
    status: 'pending',
    pendingUserMessage: text ?? null,
    turnUserMessage: text ?? null,
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

/**
 * Begin a turn only if this key is genuinely empty.
 *
 * A workflow stage reporting `running` is not always a new turn. After a page
 * reload the REST replay has already rebuilt that stage's blocks, and after a
 * pause→resume the model continues from where it stopped — in both cases
 * `startPending`'s reset would delete content the user is looking at and
 * cannot get back without another replay.
 *
 * "Empty" therefore means no blocks AND no live status, not merely "not
 * currently streaming": a settled stage that already has blocks stays as it
 * is.
 */
export function startPendingIfEmpty(streams: StreamsRecord, sessionId: string): StreamsRecord {
  const existing = streams[sessionId];
  const hasContent =
    existing !== undefined &&
    (existing.blocks.length > 0 ||
      existing.status === 'streaming' ||
      existing.status === 'thinking');
  if (hasContent) return streams;
  return startPending(streams, sessionId);
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

/**
 * W30-d — show or hide the "the agent is writing" indicator.
 *
 * Set only by `StreamEventRouter` on a surface that declares
 * `highLatencyBlockDelivery`, and only while text is genuinely being held back
 * to a block boundary. Returning the original record on a no-op matters here:
 * this is called on every frame tick of a fast token stream.
 */
export function setTyping(
  streams: StreamsRecord,
  sessionId: string,
  typing: boolean,
): StreamsRecord {
  const existing = streams[sessionId];
  // A typing indicator for a session that has never streamed is noise, and
  // creating the entry here would resurrect a key eviction just dropped.
  if (!existing) {
    if (!typing) return streams;
    return put(streams, sessionId, { ...DEFAULT_STREAM, typing: true });
  }
  if (existing.typing === typing) return streams;
  return put(streams, sessionId, { ...existing, typing });
}

export function completeStream(
  streams: StreamsRecord,
  sessionId: string,
  opts: { force?: boolean } = {},
): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  // A terminal event that lands while the stream is 'pending' is one of two
  // things. Either it is the PREVIOUS turn's idle arriving after the user has
  // already sent the next prompt (`startPending` resets `serverTurnId`, so
  // the new turn has no server id yet) — and must be ignored, or it is THIS
  // turn's own end: `turn_start` has latched its id and the user stopped it
  // before any token or tool call moved the status on. Treating both as
  // "ignore" left a Stop pressed during the opening seconds of a turn stuck
  // on "Processing…" forever, with the server long since idle.
  if (existing.status === 'pending' && !opts.force && existing.serverTurnId == null) {
    return streams;
  }
  // A forced settle is the user's own Stop: latch it, so the transcript can
  // say the turn was stopped even when nothing had streamed yet.
  //
  // `pendingUserMessage` survives, for the reason given on `appendToken`: a
  // consumer that dedupes the history copy against the LIVE TURN ID (both
  // apps do) still hides it, so clearing it here made the user's own prompt
  // disappear from the transcript the moment they pressed Stop, and stay
  // gone until the screen was reloaded.
  if (opts.force) {
    return put(streams, sessionId, {
      ...existing,
      status: 'complete',
      typing: false,
      cancelRequested: true,
    });
  }
  // A settled turn has no held text left (the router force-flushes before the
  // terminal event), so an indicator surviving here would never clear.
  return put(streams, sessionId, { ...existing, status: 'complete', typing: false });
}

/**
 * The user pressed Stop.
 *
 * Settles the turn immediately so the composer re-enables, and latches the
 * stream so the events still draining out of the provider cannot drag it back
 * to `streaming`. Blocks are kept — stopping is how you say "that is enough,
 * let me read it".
 */
export function requestCancel(streams: StreamsRecord, sessionId: string): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  // `pendingUserMessage` is kept — see `completeStream`. Stopping a turn must
  // not take the prompt that started it off the screen.
  return put(streams, sessionId, {
    ...existing,
    cancelRequested: true,
    status: 'complete',
    typing: false,
  });
}

export function errorStream(streams: StreamsRecord, sessionId: string): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  // Same as the two above: a failed turn still has to show what was asked,
  // otherwise the error row sits alone with no question attached to it.
  return put(streams, sessionId, {
    ...existing,
    status: 'error',
    typing: false,
  });
}

export function clearStreamText(streams: StreamsRecord, sessionId: string): StreamsRecord {
  const existing = streams[sessionId];
  if (!existing) return streams;
  return put(streams, sessionId, { ...existing, text: '' });
}

export function clearStream(streams: StreamsRecord, sessionId: string): StreamsRecord {
  const existing = streams[sessionId];
  // Invariant 4 — callers that truly want widgets gone must close them first.
  // Orchestrator workers still running are kept for the same reason: they
  // live only in the event stream, and they outlive the turn that spawned
  // them — the transcript cleanup after that turn used to drop their rows
  // while they were still working. Settled workers go with the rest.
  // Source-control results are kept too: the commit / PR / conflict card is
  // only ever in the stream (nothing in the message history carries it), and
  // the conflict card in particular is something the user still has to act on.
  const carried = (existing?.blocks ?? []).filter(
    (b) =>
      b.type === 'widget' ||
      b.type === 'scm_result' ||
      (b.type === 'background_task' && (b.status === 'running' || b.status === 'spawned')),
  );

  return put(streams, sessionId, {
    ...DEFAULT_STREAM,
    // Invariant 2.
    _nextBlockId: existing?._nextBlockId ?? 0,
    blocks: carried,
    // Invariant 5.
    usage: existing?.usage ?? null,
    contextUsage: existing?.contextUsage ?? null,
  });
}

// ── Eviction (invariant 6) ──────────────────────────────────────

/**
 * Drop one session's entry entirely.
 *
 * `clearStream` resets the CONTENT but keeps the key, which is right for a
 * session the user is still looking at and wrong for one they have closed:
 * the entry, its `usage` and its carried widget blocks stay resident forever.
 * This is the close-driven counterpart — use it when the owner knows the key
 * will never be rendered again.
 */
export function evictStream(streams: StreamsRecord, sessionId: string): StreamsRecord {
  if (!(sessionId in streams)) return streams;
  const next = { ...streams };
  delete next[sessionId];
  return next;
}

export interface PruneOptions {
  /** Hard cap on retained entries, excluding `protect`. */
  maxEntries: number;
  /**
   * Keys that must survive regardless of age — what the UI is rendering
   * right now. A user reading an idle chat while twenty stage runs stream
   * would otherwise watch their own transcript get evicted underneath them.
   */
  protect?: Iterable<string>;
}

/**
 * Bound the record by evicting the least-recently-touched entries.
 *
 * A live turn needs no special case: it writes on every token, so LRU ranks
 * it as the most recent entry there is. What gets evicted is what nothing has
 * touched — a chat left three navigations ago, a stage run that finished
 * hours of wall-clock time earlier.
 *
 * Returns the ORIGINAL record when it is already within the cap, so the
 * common path allocates nothing and callers skip a re-render.
 */
export function pruneStreams(
  streams: StreamsRecord,
  { maxEntries, protect }: PruneOptions,
): StreamsRecord {
  const keys = Object.keys(streams);
  if (keys.length <= maxEntries) return streams;

  const protectedKeys = protect ? new Set(protect) : null;
  const evictable = protectedKeys ? keys.filter((k) => !protectedKeys.has(k)) : keys;
  // Protected keys are exempt, so the retained size is `maxEntries` plus at
  // most however many keys the UI is currently rendering — still bounded,
  // because that count is bounded by what fits on screen.
  const excess = keys.length - maxEntries;
  if (excess <= 0 || evictable.length === 0) return streams;

  evictable.sort(
    (a, b) => (streams[a]?.lastActivityAt ?? 0) - (streams[b]?.lastActivityAt ?? 0),
  );

  const next = { ...streams };
  for (let i = 0; i < excess && i < evictable.length; i++) {
    delete next[evictable[i]!];
  }
  return next;
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

// ── Tool-permission gate (review finding 5.1) ───────────────────
//
// Same shape as the question-card trio above: `upsertPermission` opens or
// merges the card, `resolvePermission`/`expirePermission` settle it. Kept
// separate rather than folded into the question functions because the two
// card kinds carry unrelated payloads (`answers` vs `behavior`/`message`)
// and diverging status enums (`answered`/`expired` vs `allowed`/`denied`/
// `expired`).

export function upsertPermission(
  streams: StreamsRecord,
  sessionId: string,
  permission: Omit<PermissionBlock, 'type' | 'blockId'>,
  now: number = Date.now(),
): StreamsRecord {
  const existing = existingOrDefault(streams, sessionId);
  const idx = existing.blocks.findIndex(
    (b) => b.type === 'permission' && b.interactionId === permission.interactionId,
  );
  const openedAt = permission.status === 'pending' ? { openedAt: now } : {};

  if (idx >= 0) {
    const blocks = existing.blocks.slice();
    blocks[idx] = { ...(blocks[idx] as PermissionBlock), ...permission, ...openedAt };
    return put(streams, sessionId, { ...existing, blocks });
  }

  const block: PermissionBlock = {
    type: 'permission',
    blockId: existing._nextBlockId,
    ...permission,
    ...openedAt,
  };
  return put(streams, sessionId, {
    ...existing,
    blocks: [...existing.blocks, block],
    _nextBlockId: existing._nextBlockId + 1,
  });
}

export function resolvePermission(
  streams: StreamsRecord,
  sessionId: string,
  interactionId: string,
  behavior: 'allow' | 'deny',
  message?: string,
): StreamsRecord {
  return replaceBlock(
    streams,
    sessionId,
    (b) => b.type === 'permission' && b.interactionId === interactionId,
    (b) => ({
      ...(b as PermissionBlock),
      status: behavior === 'allow' ? 'allowed' : 'denied',
      ...(message ? { message } : {}),
    }),
  );
}

export function expirePermission(
  streams: StreamsRecord,
  sessionId: string,
  interactionId: string,
): StreamsRecord {
  const existing = streams[sessionId];
  if (!existing) return streams;
  const idx = existing.blocks.findIndex(
    (b) => b.type === 'permission' && b.interactionId === interactionId,
  );
  if (idx < 0) return streams;
  const prior = existing.blocks[idx] as PermissionBlock;
  // A settled card is terminal: a late expiry must not undo the decision.
  if (prior.status === 'allowed' || prior.status === 'denied') return streams;

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
