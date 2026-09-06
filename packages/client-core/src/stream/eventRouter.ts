// ────────────────────────────────────────────────────────────────
// Stream event router — SSE event → stream mutations.
//
// This is the piece that turns the wire protocol into the block model. It is
// pure and returns EFFECTS rather than performing them, so the same logic
// drives Zustand on web and whatever store mobile uses.
//
// ── The invariant this exists to protect ─────────────────────────
// Tokens and reasoning deltas arrive interleaved and must be flushed in
// arrival order. The naive implementation keeps one buffer per kind and
// flushes both on a timer — which silently reorders them, because a token
// that arrived BEFORE a thinking delta gets flushed AFTER it.
//
// The fix is the cross-buffer flush: when a token arrives and the thinking
// buffer is non-empty, the thinking buffer is flushed FIRST (and vice versa).
// That preserves the boundary between them, which is what creates a new block
// and therefore what preserves temporal order in the transcript.
//
// AGENTS.md calls this "load-bearing" and says not to simplify it. This
// module is that logic, isolated and tested, so the rule is enforceable
// rather than a comment.
// ────────────────────────────────────────────────────────────────

import type { TransportCapabilitySet } from '@generatorai/shared';

import type {
  PermissionBlock,
  PlanBlock,
  QuestionBlock,
  SystemCategory,
  ToolFileOp,
  WidgetBlock,
} from './types.js';

/**
 * A plan filed by the non-blocking `record_plan` tool is born `recorded` and
 * never receives a follow-up status event, so pinning `drafting` here left its
 * card spinning forever.
 */
function planStatusOf(data: Record<string, unknown>): PlanBlock['status'] {
  const s = data['status'];
  return s === 'drafting' ||
    s === 'recorded' ||
    s === 'awaiting_review' ||
    s === 'changes_requested' ||
    s === 'approved' ||
    s === 'rejected' ||
    s === 'superseded' ||
    s === 'expired'
    ? s
    : 'drafting';
}

/**
 * Which flavour of system note a narration line is.
 *
 * Sub-agent lines get their own colour because a wall of them during an
 * orchestrator turn is otherwise indistinguishable from the agent's own
 * output — which is exactly when a user most needs to tell them apart.
 */
function categoryFor(message: string): SystemCategory {
  const lower = message.toLowerCase();
  return lower.includes('subagent') || lower.includes('sub-agent') || lower.includes('sub agent')
    ? 'subagent'
    : 'system';
}

/**
 * A REST resource a host should refetch.
 *
 * Deliberately a NAME, not a query key: client-core has no query library and
 * the surfaces do not agree on key shapes (web has its own `queryKeys` plus
 * `workflowKeys`; mobile uses client-core's). The router says WHAT went
 * stale; each host knows how to say it to its own cache.
 *
 * `id` is the primary entity (chatId, workspaceId, runId) when the event
 * carries one; `subId` a secondary (a planId inside a chat). Both are absent
 * when the event only implies "the thing this connection is watching", which
 * the host resolves from the connection itself.
 */
export type InvalidateResource =
  | 'messages'
  | 'chat'
  | 'chats'
  | 'session'
  | 'sessions'
  | 'run'
  | 'runs'
  | 'plans'
  | 'interactions'
  | 'workspace'
  | 'tasks'
  | 'artifacts'
  | 'agents';

/** A mutation to apply to the stream store. */
export type StreamEffect =
  | { op: 'appendToken'; key: string; text: string }
  | { op: 'appendThinking'; key: string; text: string }
  | { op: 'completeThinking'; key: string }
  | { op: 'startPending'; key: string; userMessage?: string }
  /**
   * Text that arrived only on `message_complete`, with no token stream
   * behind it. Applied ONLY when the turn produced no text block, so a
   * provider that streams normally never gets its answer duplicated.
   */
  | { op: 'appendTokenIfNoText'; key: string; text: string }
  | { op: 'addToolCall'; key: string; tool: string; args: unknown; callId?: string; parentCallId?: string }
  | { op: 'completeToolCall'; key: string; toolOrCallId: string; result: unknown; fileOp?: ToolFileOp; success?: boolean }
  | { op: 'addSystemMessage'; key: string; message: string; category: SystemCategory }
  /** `hook.started` — see `StreamHookInvocation`; routed to the stage-aware
   *  `key` so `deriveRunView` can read a stage's hooks off its own stream. */
  | {
      op: 'hookStarted';
      key: string;
      hookName: string;
      phase: string;
      hookId?: string;
      hookType?: string;
      stageRunId?: string;
    }
  /** `hook.completed` (status `'ok'`) or `hook.failed` (status `'failed'`). */
  | {
      op: 'hookCompleted';
      key: string;
      status: 'ok' | 'failed';
      hookName: string;
      phase: string;
      hookId?: string;
      hookType?: string;
      stageRunId?: string;
      durationMs?: number;
    }
  | { op: 'processInlineToolCalls'; key: string; content: string }
  | { op: 'completeStream'; key: string; force?: boolean }
  | { op: 'errorStream'; key: string }
  | { op: 'setServerTurnId'; key: string; turnId: string }
  /** W30-d — the agent is writing, but this surface is holding the text. */
  | { op: 'setTyping'; key: string; typing: boolean }
  | { op: 'setUsage'; key: string; usage: Record<string, unknown> }
  | { op: 'setContextUsage'; key: string; snapshot: Record<string, unknown> }
  | { op: 'upsertPlan'; key: string; plan: Omit<PlanBlock, 'type' | 'blockId'> }
  | {
      op: 'setPlanStatus';
      key: string;
      planId: string;
      status: PlanBlock['status'];
      extra?: { interactionId?: string; revision?: number };
    }
  | { op: 'upsertQuestion'; key: string; question: Omit<QuestionBlock, 'type' | 'blockId'> }
  | {
      op: 'answerQuestion';
      key: string;
      interactionId: string;
      answers: Record<string, string[]>;
      freeformResponse?: string;
    }
  | { op: 'expireQuestion'; key: string; interactionId: string }
  | { op: 'upsertPermission'; key: string; permission: Omit<PermissionBlock, 'type' | 'blockId'> }
  | {
      op: 'resolvePermission';
      key: string;
      interactionId: string;
      behavior: 'allow' | 'deny';
      message?: string;
    }
  | { op: 'expirePermission'; key: string; interactionId: string; reason?: string }
  | {
      op: 'addWidget';
      key: string;
      widget: Omit<WidgetBlock, 'type' | 'blockId' | 'surface'> & { surface: string };
    }
  | { op: 'updateWidgetState'; key: string; instanceId: string; state: unknown }
  | {
      op: 'setWidgetStatus';
      key: string;
      instanceId: string;
      status: WidgetBlock['status'];
      error?: string;
    }
  /**
   * Start a turn ONLY if this key has nothing in it.
   *
   * A stage going `running` is not always a new turn: after a reload the
   * replay has already rebuilt its blocks, and after pause→resume the model
   * continues where it left off. An unconditional `startPending` wipes both.
   */
  | { op: 'startPendingIfEmpty'; key: string }

  // ── Host-timer ops ────────────────────────────────────────────────
  //
  // The transcript of a settled CHAT turn is swapped for the persisted
  // messages a few seconds later; the transcript of a workflow STAGE is not,
  // because the run page is the only thing that renders it. The delay is a
  // host concern (it owns a clock), so the router only says when to arm and
  // when to cancel.
  | { op: 'scheduleTranscriptCleanup'; key: string }
  | { op: 'cancelTranscriptCleanup'; key: string }

  // ── Workflow-run store ops ───────────────────────────────────────
  //
  // `message` on the timeline ops contains `{stage}` where the stage's
  // display NAME belongs. The router cannot know it — the name lives in the
  // host's run store, keyed by `stageRunId` — so the host substitutes. Every
  // other surface simply drops these ops.
  | { op: 'runStatus'; runId?: string; status: string; data: Record<string, unknown> }
  | {
      op: 'runTimeline';
      runId?: string;
      status: string;
      message: string;
      data: Record<string, unknown>;
    }
  | { op: 'stageStatus'; stageRunId: string; status: string; data: Record<string, unknown> }
  | {
      op: 'stageTimeline';
      stageRunId: string;
      status: string;
      message: string;
      data: Record<string, unknown>;
    }
  | { op: 'registerStageSession'; stageRunId: string; sessionId: string }
  /** `data: null` clears the HITL prompt rather than raising one. */
  | { op: 'stageAwaitingInput'; stageRunId: string; data: Record<string, unknown> | null }
  | { op: 'selectStageRun'; stageRunId: string }
  /** Terminal stage: settle its stream and refetch the history it produced. */
  | { op: 'stageSettled'; stageRunId: string }

  // ── Widget bridge ops ────────────────────────────────────────────
  //
  // Imperative traffic between the agent and a live widget frame. A surface
  // with no widget runtime drops both.
  | { op: 'widgetInvoke'; instanceId: string; invokeId: string; action: string; args: unknown }
  | { op: 'widgetTeardown'; instanceId: string; teardownId: string }

  /** Refetch a REST resource. The host decides how (TanStack, manual, …). */
  | {
      op: 'invalidate';
      resource: InvalidateResource;
      /** Primary entity id, when the event carries one. */
      id?: string;
      /** Secondary id — currently only a planId inside a chat. */
      subId?: string;
    };

export interface PersistedEventLike {
  kind: string;
  sessionId?: string;
  data?: Record<string, unknown> | undefined;
}

/** One session's pending token/thinking text, awaiting a flush. */
interface Buffers {
  tokenBuf: string;
  thinkingBuf: string;
  /**
   * W30-d — whether the text ALREADY EMITTED for this key ends inside an open
   * code fence. Tracked across flushes because a fence opened three flushes
   * ago still means the blank line we are looking at now is not a paragraph
   * break, it is a blank line inside a code block.
   */
  inFence: boolean;
  /** W30-d — whether a typing indicator is currently shown for this key. */
  typing: boolean;
}

/**
 * W30-d — the point past which held text is released even without a boundary.
 *
 * One long paragraph, or a fence the model never closes because the turn was
 * stopped, would otherwise leave the transcript blank for the whole turn.
 * A late stutter is a far better failure than a blank screen, so the hold is
 * bounded. Roughly a screenful of prose on a phone.
 */
const HELD_TEXT_CAP = 4096;

/**
 * Split pending text at the last markdown block boundary.
 *
 * W30-d asks for "assembled blocks" rather than per-chunk edits, so the unit
 * released has to be a thing a markdown renderer can render whole: a finished
 * paragraph, or a finished fenced code block. Splitting on anything smaller
 * (a token, a line) would reintroduce the stutter; splitting on anything
 * larger (the whole turn) would be indistinguishable from no streaming at all.
 *
 * `startsInFence` is the fence state at the end of the text already emitted.
 * The returned `inFence` is the state at the end of the text being emitted
 * NOW, so the caller can carry it forward.
 *
 * Exported for the enforcement test — the boundary rules are the behaviour
 * the capability claim stands on, so they get asserted directly rather than
 * only through the router.
 */
export function splitAtBlockBoundary(
  text: string,
  startsInFence: boolean,
): { emit: string; hold: string; inFence: boolean } {
  let inFence = startsInFence;
  /** Index just past the last releasable boundary, or -1 if there is none. */
  let boundary = -1;
  /** Fence state as of `boundary`. */
  let fenceAtBoundary = startsInFence;

  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    // A trailing partial line is never a boundary — the model is mid-word.
    if (nl === -1) break;
    const line = text.slice(i, nl);
    const opener = line.trimStart();
    if (opener.startsWith('```') || opener.startsWith('~~~')) {
      inFence = !inFence;
      if (!inFence) {
        // A CLOSING fence completes a code block, which is exactly the
        // assembled unit this mode exists to deliver.
        boundary = nl + 1;
        fenceAtBoundary = false;
      }
    } else if (!inFence && line.trim() === '') {
      // A blank line outside a fence ends a paragraph.
      boundary = nl + 1;
      fenceAtBoundary = false;
    }
    i = nl + 1;
  }

  if (boundary === -1) {
    if (text.length > HELD_TEXT_CAP) return { emit: text, hold: '', inFence };
    return { emit: '', hold: text, inFence: startsInFence };
  }
  return {
    emit: text.slice(0, boundary),
    hold: text.slice(boundary),
    inFence: fenceAtBoundary,
  };
}

export interface StreamEventRouterOptions {
  /**
   * W30-d — the surface's `TransportCapabilities` entry for
   * `highLatencyBlockDelivery`. Pass the ledger entry itself, not a hand-rolled
   * boolean: a capability the ledger declares and the runtime does not read is
   * the exact failure W29 exists to prevent, and passing the entry is what
   * makes the wiring greppable from the ledger.
   */
  blockDelivery?: TransportCapabilitySet['highLatencyBlockDelivery'];
}

/**
 * Accumulates deltas and emits ordered effects.
 *
 * Coalescing exists because a fast model emits hundreds of tokens per second;
 * applying each one to a store immediately means hundreds of renders per
 * second and a dropped-frame stutter on any phone. The host calls `drain()`
 * on a frame tick, so the store sees at most one update per frame regardless
 * of token rate.
 */
export class StreamEventRouter {
  private readonly buffers = new Map<string, Buffers>();
  /** Stage attribution for events that do not carry their own stageRunId. */
  private currentStageRunId: string | null = null;
  /** W30-d — resolved once from the ledger entry; see the option's doc. */
  private readonly blockDelivery: boolean;

  constructor(options: StreamEventRouterOptions = {}) {
    this.blockDelivery = options.blockDelivery?.supported === true;
  }

  private bufferFor(key: string): Buffers {
    let buf = this.buffers.get(key);
    if (!buf) {
      buf = { tokenBuf: '', thinkingBuf: '', inFence: false, typing: false };
      this.buffers.set(key, buf);
    }
    return buf;
  }

  /**
   * Stream key for an event.
   *
   * Per-EVENT routing, not per-connection: with parallel stages a shared
   * mutable "current stage" makes events from stage A land in stage B's
   * transcript whenever B happens to start first.
   */
  private streamKey(sessionId: string, data: Record<string, unknown>): string {
    const eventStageRunId = data['stageRunId'] as string | undefined;
    if (eventStageRunId) {
      this.currentStageRunId = eventStageRunId;
      return `stageRun:${eventStageRunId}`;
    }
    // Harness events (tokens, deltas, tool calls) are emitted under the
    // stage's session and carry no stageRunId, so they inherit the last one.
    return this.currentStageRunId ? `stageRun:${this.currentStageRunId}` : sessionId;
  }

  /**
   * Release ALL buffered prose for one key.
   *
   * Used by the cross-buffer flush, which must never be partial: its whole job
   * is to commit the token run that arrived BEFORE a thinking delta, so
   * holding part of it back would reorder the transcript — the one thing this
   * module exists to prevent.
   */
  private flushTokens(key: string, buf: Buffers, out: StreamEffect[]): void {
    if (!buf.tokenBuf) return;
    out.push({ op: 'appendToken', key, text: buf.tokenBuf });
    buf.inFence = splitAtBlockBoundary(buf.tokenBuf, buf.inFence).inFence;
    buf.tokenBuf = '';
    this.setTyping(key, buf, false, out);
  }

  /** W30-d — emit the typing indicator only when its value actually changes. */
  private setTyping(key: string, buf: Buffers, typing: boolean, out: StreamEffect[]): void {
    if (buf.typing === typing) return;
    buf.typing = typing;
    out.push({ op: 'setTyping', key, typing });
  }

  /**
   * Flush pending text for one key, newest-kind-last.
   *
   * Order here IS the temporal order of the transcript.
   *
   * `partial` is the W30-d path and applies only to prose: on a surface that
   * declared `highLatencyBlockDelivery`, a frame tick releases text only up to
   * the last markdown block boundary and raises the typing indicator for the
   * remainder. Every OTHER caller — an ordered event, a turn boundary, the
   * final drain on teardown — passes `partial: false`, so held text is always
   * released before anything that must appear after it. The mode changes when
   * text lands, never whether it lands.
   *
   * Thinking text is never held: it is already a low-fidelity summary, and a
   * reasoning run frequently contains no blank line at all.
   */
  private flushKey(key: string, out: StreamEffect[], partial = false): void {
    const buf = this.buffers.get(key);
    if (!buf) return;
    if (buf.thinkingBuf) {
      out.push({ op: 'appendThinking', key, text: buf.thinkingBuf });
      buf.thinkingBuf = '';
    }
    if (!buf.tokenBuf) {
      if (!partial) this.setTyping(key, buf, false, out);
      return;
    }

    if (!partial || !this.blockDelivery) {
      out.push({ op: 'appendToken', key, text: buf.tokenBuf });
      // Fence state has to keep tracking even on a full flush, or the next
      // partial flush would mistake a blank line inside an open fence for a
      // paragraph break.
      buf.inFence = splitAtBlockBoundary(buf.tokenBuf, buf.inFence).inFence;
      buf.tokenBuf = '';
      if (!partial) this.setTyping(key, buf, false, out);
      return;
    }

    const { emit, hold, inFence } = splitAtBlockBoundary(buf.tokenBuf, buf.inFence);
    if (emit) {
      out.push({ op: 'appendToken', key, text: emit });
      buf.inFence = inFence;
    }
    buf.tokenBuf = hold;
    this.setTyping(key, buf, hold.length > 0, out);
  }

  /**
   * Flush every buffer. Called on a frame tick.
   *
   * This is the partial path — see `flushKey`. Ordered events flush in full
   * through `handle()` instead, which is what keeps W30-d from ever reordering
   * or losing text.
   */
  drain(): StreamEffect[] {
    const out: StreamEffect[] = [];
    for (const key of this.buffers.keys()) this.flushKey(key, out, true);
    return out;
  }

  /**
   * Release everything, held text included.
   *
   * The teardown counterpart to `drain()`: a view unmounting mid-block must
   * commit what it is holding, or W30-d turns a stutter into a silent loss.
   */
  drainFinal(): StreamEffect[] {
    const out: StreamEffect[] = [];
    for (const key of this.buffers.keys()) this.flushKey(key, out);
    return out;
  }

  /** True when there is buffered text waiting for a flush. */
  get hasPending(): boolean {
    for (const buf of this.buffers.values()) {
      if (buf.tokenBuf || buf.thinkingBuf) return true;
    }
    return false;
  }

  /** Drop all state (session ended, or the view was torn down). */
  reset(): void {
    this.buffers.clear();
    this.currentStageRunId = null;
  }

  /**
   * Translate one event into effects.
   *
   * ── W26: this switch is the ONLY event-routing implementation ────
   * There used to be three. `apps/web/src/stores/sseManager.ts` carried a
   * ~1000-line copy that had drifted in a dozen small ways; the CLI carries a
   * third in `apps/cli/src/tui/store.ts`. Every fix had to be made three
   * times, and in practice was made once — which is how mobile ended up with
   * no `harness.message_complete` fallback and web with no replay-safe turn
   * guard, each surface missing whatever the other had learned.
   *
   * Effects are returned in the order they must be applied. The host owns
   * HOW: `applyStreamEffect` folds the transcript ops into the block model,
   * and the surface maps `invalidate` / run-store / widget-bridge ops onto
   * whatever it actually has.
   *
   * Two stream keys are in play and the difference is deliberate:
   *   `key`        — stage-aware (`stageRun:<id>` during a workflow run). The
   *                  transcript of the thing that produced the event.
   *   `sessionKey` — the connection's own session. Narration that belongs to
   *                  the RUN rather than to a stage (git, hooks, scripts,
   *                  orchestration progress) goes here, so it does not land
   *                  inside whichever stage happened to be streaming.
   */
  handle(sessionId: string, event: PersistedEventLike): StreamEffect[] {
    if (!event?.kind) return [];
    const kind = event.kind;
    const data = event.data ?? {};

    /**
     * Orchestrator worker turns are bookkeeping, not transcript: rendering
     * them would show the user their own agent talking to itself. They still
     * WRITE messages, though, so the kinds that mark a turn boundary keep
     * their invalidation — otherwise the history a worker produced never
     * appears until something else happens to refetch.
     */
    const internal = data['__isInternalTurn'] === true;

    const key = this.streamKey(sessionId, data);
    const sessionKey = sessionId;
    const out: StreamEffect[] = [];

    /** `String(x ?? fallback)`, which this switch does constantly. */
    const str = (value: unknown, fallback = ''): string =>
      value === undefined || value === null ? fallback : String(value);
    const optStr = (value: unknown): string | undefined =>
      typeof value === 'string' && value ? value : undefined;
    /** Run-level narration: flushed for ordering, filed on the session key. */
    const note = (message: string, category: SystemCategory = 'system'): void => {
      this.flushKey(sessionKey, out);
      out.push({ op: 'addSystemMessage', key: sessionKey, message, category });
    };
    const stageRunIdOf = (): string | undefined => optStr(data['stageRunId']);
    const chatId = (): Record<string, never> | { id: string } =>
      optStr(data['chatId']) ? { id: str(data['chatId']) } : ({} as Record<string, never>);

    switch (kind) {
      // ── Transcript text ──────────────────────────────────────────
      case 'harness.token': {
        if (internal) break;
        const text = optStr(data['text']);
        if (!text) break;
        const buf = this.bufferFor(key);
        // Cross-buffer flush: a thinking run that ENDED before this token
        // must be committed first, or the two get reordered.
        if (buf.thinkingBuf) {
          out.push({ op: 'appendThinking', key, text: buf.thinkingBuf });
          buf.thinkingBuf = '';
        }
        buf.tokenBuf += text;
        break;
      }

      case 'harness.reasoning_delta': {
        if (internal) break;
        const text = optStr(data['text']);
        if (!text) break;
        const buf = this.bufferFor(key);
        this.flushTokens(key, buf, out);
        buf.thinkingBuf += text;
        break;
      }

      case 'harness.reasoning_complete':
        this.flushKey(key, out);
        if (internal) break;
        out.push({ op: 'completeThinking', key });
        break;

      case 'harness.message_complete': {
        this.flushKey(key, out);
        if (internal) break;
        const content = optStr(data['content']);
        if (content && /<function_calls>|<tool_calls>/.test(content)) {
          // The model emitted tool-call XML in the token stream instead of
          // using the SDK protocol; restructure it into real blocks.
          out.push({ op: 'processInlineToolCalls', key, content });
        } else if (content) {
          // Some providers never emit token deltas and deliver the whole
          // answer here. Without this the transcript stays empty until the
          // history refetch lands — the single most visible way mobile fell
          // out of step with web.
          out.push({ op: 'appendTokenIfNoText', key, text: content });
        }
        out.push({ op: 'invalidate', resource: 'messages' });
        break;
      }

      case 'harness.user_message': {
        this.flushKey(key, out);
        if (internal) {
          out.push({ op: 'invalidate', resource: 'messages' });
          break;
        }
        // Clear buffers: anything pending belongs to the previous turn.
        // `inFence`/`typing` go with them — a fence the previous turn left
        // open would otherwise swallow this turn's first paragraph break.
        const buf = this.buffers.get(key);
        if (buf) {
          buf.tokenBuf = '';
          buf.thinkingBuf = '';
          buf.inFence = false;
          buf.typing = false;
        }
        // A new turn cancels the settle-and-clear timer the last one armed.
        out.push({ op: 'cancelTranscriptCleanup', key });
        out.push({
          op: 'startPending',
          key,
          ...(optStr(data['content']) ? { userMessage: str(data['content']) } : {}),
        });
        out.push({ op: 'invalidate', resource: 'messages' });
        break;
      }

      case 'harness.turn_end':
        // Commit this turn's text before the next one can start writing.
        this.flushKey(key, out);
        break;

      case 'harness.turn_start':
      case 'copilot.turn_start': {
        // Latched so consumers can de-dup history by `metadata.turnId`
        // (O(1), collision-free) instead of comparing message content.
        const turnId = optStr(data['turnId']);
        if (turnId) out.push({ op: 'setServerTurnId', key, turnId });
        break;
      }

      // ── Tools ────────────────────────────────────────────────────
      case 'harness.tool_start': {
        this.flushKey(key, out);
        if (internal) break;
        out.push({
          op: 'addToolCall',
          key,
          tool: str(data['tool'], 'tool'),
          args: data['args'],
          ...(optStr(data['callId']) ? { callId: str(data['callId']) } : {}),
          ...(optStr(data['parentToolCallId'])
            ? { parentCallId: str(data['parentToolCallId']) }
            : {}),
        });
        break;
      }

      case 'harness.tool_complete': {
        this.flushKey(key, out);
        if (internal) break;
        const id = optStr(data['callId']) ?? optStr(data['tool']);
        if (id) {
          const fileOp = data['fileOp'];
          out.push({
            op: 'completeToolCall',
            key,
            toolOrCallId: id,
            result: data['result'],
            ...(fileOp && typeof fileOp === 'object' ? { fileOp: fileOp as ToolFileOp } : {}),
            ...(typeof data['success'] === 'boolean' ? { success: data['success'] } : {}),
          });
        }
        break;
      }

      // ── Turn termination ─────────────────────────────────────────
      case 'harness.error': {
        this.flushKey(key, out);
        const message = str(data['message'] ?? data['error'], 'The agent reported an error.');
        out.push({ op: 'errorStream', key });
        out.push({ op: 'addSystemMessage', key, message: `Error: ${message}`, category: 'error' });
        out.push({ op: 'invalidate', resource: 'session' });
        out.push({ op: 'invalidate', resource: 'messages' });
        break;
      }

      // A warning is NOT an error: the turn carries on. It exists so a
      // problem the user has to act on — most often an MCP server that failed
      // to start or needs credentials — is visible instead of silent. This
      // case was missing entirely, so those warnings fell through to the
      // "ignored on purpose" default (review 2.4).
      case 'harness.warning': {
        const message = str(data['message'], 'The agent reported a warning.');
        out.push({ op: 'addSystemMessage', key, message, category: 'warning' });
        break;
      }

      case 'harness.idle':
        this.flushKey(key, out);
        out.push({ op: 'invalidate', resource: 'messages' });
        if (internal) break;
        out.push({ op: 'completeStream', key });
        out.push({ op: 'invalidate', resource: 'session' });
        out.push({ op: 'invalidate', resource: 'sessions' });
        out.push({ op: 'cancelTranscriptCleanup', key });
        // A stage's transcript is owned by the run page and must survive the
        // turn; only a chat's own transcript is swapped for persisted history.
        if (!key.startsWith('stageRun:')) {
          out.push({ op: 'scheduleTranscriptCleanup', key });
        }
        break;

      case 'harness.cancelled':
        // W13's semantic `cancelled`: a user Stop is terminal exactly like
        // idle. Without it a stopped turn never settles, and the replay path
        // never treats the stage as finished.
        this.flushKey(key, out);
        if (internal) break;
        // Forced: the user pressed Stop, so this settles even a turn that had
        // not produced a single block yet (status still 'pending').
        out.push({ op: 'completeStream', key, force: true });
        out.push({ op: 'invalidate', resource: 'messages' });
        out.push({ op: 'invalidate', resource: 'session' });
        break;

      // ── Usage and context ────────────────────────────────────────
      //
      // Neither is gated on `__isInternalTurn`. That flag exists to stop the
      // client resetting stream BLOCKS for framework-issued turns (context
      // injection, summarisation); those turns still spend real tokens and
      // still consume the real context window, so skipping their telemetry
      // left every workflow stage gauge empty and under-reported chats.
      case 'harness.usage':
      case 'copilot.usage':
        // A sub-agent reports usage against its OWN window; attributing it to
        // the main conversation made the gauge and the cost chip jump around
        // mid-turn.
        if (optStr(data['agentId'])) break;
        out.push({ op: 'setUsage', key, usage: data });
        break;

      case 'harness.context_usage': {
        if (optStr(data['agentId'])) break;
        // A snapshot with no numeric fill is not a snapshot; forwarding it
        // would blank a gauge that currently reads correctly.
        const current = data['currentTokens'];
        if (typeof current !== 'number' || !Number.isFinite(current)) break;
        out.push({ op: 'setContextUsage', key, snapshot: data });
        break;
      }

      // ── Plan mode (PLN-01) ───────────────────────────────────────
      //
      // Cards are pushed into the stream so they interleave with the rest of
      // the turn, and are ALSO persisted into the assistant message metadata,
      // which is what rebuilds them for completed chats.
      //
      // Every gate-lifecycle event refreshes the pending-interaction list too:
      // that list is polled, and it is what the chat page reconciles card
      // state against, so refreshing it here keeps the two views from
      // disagreeing for up to a full poll period.
      case 'chat.plan.created':
        this.flushKey(key, out);
        out.push({
          op: 'upsertPlan',
          key,
          plan: {
            planId: str(data['planId']),
            revision: Number(data['revision'] ?? 1),
            title: str(data['title'], 'Plan'),
            fileName: str(data['fileName'], 'plan.md'),
            summary: str(data['summary']),
            status: planStatusOf(data),
            actions: [],
          },
        });
        out.push({
          op: 'invalidate',
          resource: 'plans',
          ...chatId(),
          ...(optStr(data['planId']) ? { subId: str(data['planId']) } : {}),
        });
        break;

      case 'chat.plan.updated':
        this.flushKey(key, out);
        out.push({
          op: 'setPlanStatus',
          key,
          planId: str(data['planId']),
          status: planStatusOf(data),
          extra: { revision: Number(data['revision'] ?? 1) },
        });
        out.push({
          op: 'invalidate',
          resource: 'plans',
          ...chatId(),
          ...(optStr(data['planId']) ? { subId: str(data['planId']) } : {}),
        });
        break;

      case 'chat.plan.review_requested':
        this.flushKey(key, out);
        // `upsertPlan` merges onto the card from `chat.plan.created`, so
        // absent fields must be omitted rather than blanked.
        out.push({
          op: 'upsertPlan',
          key,
          plan: {
            planId: str(data['planId']),
            revision: Number(data['revision'] ?? 1),
            title: optStr(data['title']) ?? str(data['summary'], 'Plan'),
            ...(optStr(data['fileName']) ? { fileName: str(data['fileName']) } : {}),
            summary: str(data['summary']),
            status: 'awaiting_review',
            actions: Array.isArray(data['actions']) ? (data['actions'] as string[]) : [],
            ...(optStr(data['recommendedAction'])
              ? { recommendedAction: str(data['recommendedAction']) }
              : {}),
            interactionId: str(data['interactionId']),
          },
        });
        out.push({
          op: 'invalidate',
          resource: 'plans',
          ...chatId(),
          ...(optStr(data['planId']) ? { subId: str(data['planId']) } : {}),
        });
        out.push({ op: 'invalidate', resource: 'interactions', ...chatId() });
        break;

      case 'chat.plan.decided': {
        this.flushKey(key, out);
        const approved = data['approved'] === true;
        const action = optStr(data['action']);
        out.push({
          op: 'setPlanStatus',
          key,
          planId: str(data['planId']),
          status: approved ? (action === 'exit_only' ? 'rejected' : 'approved') : 'changes_requested',
        });
        out.push({
          op: 'invalidate',
          resource: 'plans',
          ...chatId(),
          ...(optStr(data['planId']) ? { subId: str(data['planId']) } : {}),
        });
        out.push({ op: 'invalidate', resource: 'interactions', ...chatId() });
        break;
      }

      case 'chat.plan.expired':
        this.flushKey(key, out);
        out.push({ op: 'setPlanStatus', key, planId: str(data['planId']), status: 'expired' });
        out.push({
          op: 'invalidate',
          resource: 'plans',
          ...chatId(),
          ...(optStr(data['planId']) ? { subId: str(data['planId']) } : {}),
        });
        out.push({ op: 'invalidate', resource: 'interactions', ...chatId() });
        break;

      case 'chat.plan.extraction_failed':
        this.flushKey(key, out);
        out.push({
          op: 'addSystemMessage',
          key,
          message: `Plan mode: ${str(data['reason'], 'the plan could not be captured')}`,
          category: 'error',
        });
        break;

      // The wire kinds are dot-separated (`chat.question.asked`). The
      // underscore spellings were a transcription slip that meant a phone
      // NEVER saw a clarifying question; both are accepted now so a rename in
      // either direction cannot silently break the gate again.
      case 'chat.question.asked':
      case 'chat.question_asked':
        this.flushKey(key, out);
        out.push({
          op: 'upsertQuestion',
          key,
          question: {
            interactionId: str(data['interactionId']),
            questions: Array.isArray(data['questions'])
              ? (data['questions'] as QuestionBlock['questions'])
              : [],
            status: 'pending',
          },
        });
        out.push({ op: 'invalidate', resource: 'interactions', ...chatId() });
        break;

      case 'chat.question.answered':
      case 'chat.question_answered':
        this.flushKey(key, out);
        out.push({
          op: 'answerQuestion',
          key,
          interactionId: str(data['interactionId']),
          answers: (data['answers'] as Record<string, string[]>) ?? {},
          ...(optStr(data['freeformResponse'])
            ? { freeformResponse: str(data['freeformResponse']) }
            : {}),
        });
        out.push({ op: 'invalidate', resource: 'interactions', ...chatId() });
        break;

      case 'chat.question.expired':
      case 'chat.question_expired':
        this.flushKey(key, out);
        out.push({ op: 'expireQuestion', key, interactionId: str(data['interactionId']) });
        out.push({ op: 'invalidate', resource: 'interactions', ...chatId() });
        break;

      // ── Tool-permission gate (review finding 5.1) ───────────────────
      //
      // A chat set to `default`/`acceptEdits` blocks the agent on every
      // (or every non-edit) tool call until the user allows or denies it.
      // Mirrors the question-card wiring above field-for-field — same
      // pending → resolved/expired lifecycle, same pending-interaction
      // invalidation so the poll-based reconciliation in ChatPage sees it.
      case 'chat.permission.requested':
        this.flushKey(key, out);
        out.push({
          op: 'upsertPermission',
          key,
          permission: {
            interactionId: str(data['interactionId']),
            toolName: str(data['toolName']),
            permissionType: str(data['type']),
            description: str(data['description']),
            inputSummary: str(data['inputSummary']),
            permissionMode: str(data['permissionMode']),
            status: 'pending',
          },
        });
        out.push({ op: 'invalidate', resource: 'interactions', ...chatId() });
        break;

      case 'chat.permission.resolved':
        this.flushKey(key, out);
        out.push({
          op: 'resolvePermission',
          key,
          interactionId: str(data['interactionId']),
          behavior: data['behavior'] === 'deny' ? 'deny' : 'allow',
          ...(optStr(data['message']) ? { message: str(data['message']) } : {}),
        });
        out.push({ op: 'invalidate', resource: 'interactions', ...chatId() });
        break;

      case 'chat.permission.expired':
        this.flushKey(key, out);
        out.push({
          op: 'expirePermission',
          key,
          interactionId: str(data['interactionId']),
          ...(optStr(data['reason']) ? { reason: str(data['reason']) } : {}),
        });
        out.push({ op: 'invalidate', resource: 'interactions', ...chatId() });
        break;

      // ── Widgets ──────────────────────────────────────────────────
      case 'harness.widget.render':
        this.flushKey(key, out);
        out.push({
          op: 'addWidget',
          key,
          widget: {
            instanceId: str(data['instanceId']),
            descriptorId: str(data['descriptorId']),
            extensionId: str(data['extensionId']),
            component: str(data['component']),
            ...(optStr(data['title']) ? { title: str(data['title']) } : {}),
            surface: optStr(data['surface']) ?? 'widget',
            assetsBase: optStr(data['assetsBase']) ?? '',
            entry: str(data['entry']),
            props: data['props'],
            state: data['state'],
            status: 'active',
          },
        });
        break;

      case 'harness.widget.state':
        this.flushKey(key, out);
        out.push({
          op: 'updateWidgetState',
          key,
          instanceId: str(data['instanceId']),
          state: data['state'],
        });
        break;

      case 'harness.widget.action':
        // Informational — the widget UI already shows it. Flushed only so
        // ordering with the tool/token events around it is preserved.
        this.flushKey(key, out);
        break;

      case 'harness.widget.invoke':
        // Agent → widget imperative dispatch. The host forwards it over its
        // postMessage bridge; a surface with no widget runtime drops it.
        this.flushKey(key, out);
        out.push({
          op: 'widgetInvoke',
          instanceId: str(data['instanceId']),
          invokeId: str(data['invokeId']),
          action: str(data['action']),
          args: data['args'],
        });
        break;

      case 'harness.widget.teardown':
        this.flushKey(key, out);
        out.push({
          op: 'widgetTeardown',
          instanceId: str(data['instanceId']),
          teardownId: str(data['teardownId']),
        });
        break;

      case 'harness.widget.closed':
        this.flushKey(key, out);
        out.push({
          op: 'setWidgetStatus',
          key,
          instanceId: str(data['instanceId']),
          status: 'closed',
        });
        break;

      case 'harness.widget.error':
        this.flushKey(key, out);
        out.push({
          op: 'setWidgetStatus',
          key,
          instanceId: str(data['instanceId']),
          status: 'error',
          ...(optStr(data['error']) ? { error: str(data['error']) } : {}),
        });
        break;

      // ── Git narration ────────────────────────────────────────────
      case 'git.clone_start':
        note(
          `Cloning repository: ${str(data['repoUrl'])}`,
          categoryFor(`Cloning: ${str(data['repoUrl'])}`),
        );
        break;
      case 'git.clone_complete':
        note(`Repository cloned to: ${str(data['localPath'])}`);
        break;
      case 'git.commit':
        note(`Git commit: ${str(data['message'])} (${str(data['sha'])})`);
        break;
      case 'git.push':
        note(`Pushed to branch: ${str(data['branch'])}`);
        break;
      case 'git.pr_created':
        note(`PR created: ${str(data['url'])}`);
        break;

      // ── Workspace / checkpoints ──────────────────────────────────
      //
      // These replaced the Changes panel's polling loop. Keyed by workspace
      // id, which every workspace-scoped query shares as a prefix.
      case 'workspace.changed':
      case 'checkpoint.created':
        out.push({
          op: 'invalidate',
          resource: 'workspace',
          ...(optStr(data['workspaceId']) ? { id: str(data['workspaceId']) } : {}),
        });
        break;

      // Mount preparation moved (preparing → ready / error): the workspace
      // info and the chat DTO (which carries `workspacePrep`) both change.
      case 'workspace.prep': {
        out.push({
          op: 'invalidate',
          resource: 'workspace',
          ...(optStr(data['workspaceId']) ? { id: str(data['workspaceId']) } : {}),
        });
        if (optStr(data['chatId'])) {
          out.push({ op: 'invalidate', resource: 'chat', id: str(data['chatId']) });
        }
        if (data['status'] === 'error') {
          note(`Workspace preparation failed: ${str(data['error'] ?? 'unknown error')}`);
        }
        break;
      }

      case 'checkpoint.restored': {
        out.push({
          op: 'invalidate',
          resource: 'workspace',
          ...(optStr(data['workspaceId']) ? { id: str(data['workspaceId']) } : {}),
        });
        const skipped = Array.isArray(data['skipped']) ? data['skipped'].length : 0;
        const restored = typeof data['restoredCount'] === 'number' ? data['restoredCount'] : 0;
        const deleted = typeof data['deletedCount'] === 'number' ? data['deletedCount'] : 0;
        note(
          `Restored checkpoint — ${restored} file(s) restored, ${deleted} removed` +
            (skipped > 0 ? `, ${skipped} skipped` : ''),
        );
        break;
      }

      // ── Scripts, hooks, permissions ──────────────────────────────
      case 'script.stdout':
        note(`[stdout] ${str(data['line'])}`);
        break;
      case 'script.stderr':
        note(`[stderr] ${str(data['line'])}`);
        break;
      case 'script.exit':
        note(`Script exited with code: ${str(data['code'])}`);
        break;
      case 'hook.started':
        note(`Hook "${str(data['hookName'])}" started (phase: ${str(data['phase'])})`);
        // Filed on `key` (stage-aware), not `sessionKey` like the note above:
        // `deriveRunView` reads a stage's hooks off that stage's own stream.
        out.push({
          op: 'hookStarted',
          key,
          hookName: str(data['hookName']),
          phase: str(data['phase']),
          ...(optStr(data['hookId']) ? { hookId: str(data['hookId']) } : {}),
          ...(optStr(data['hookType']) ? { hookType: str(data['hookType']) } : {}),
          ...(optStr(data['stageRunId']) ? { stageRunId: str(data['stageRunId']) } : {}),
        });
        break;
      case 'hook.completed':
        note(`Hook "${str(data['hookName'])}" completed`);
        out.push({
          op: 'hookCompleted',
          key,
          status: 'ok',
          hookName: str(data['hookName']),
          phase: str(data['phase']),
          ...(optStr(data['hookId']) ? { hookId: str(data['hookId']) } : {}),
          ...(optStr(data['hookType']) ? { hookType: str(data['hookType']) } : {}),
          ...(optStr(data['stageRunId']) ? { stageRunId: str(data['stageRunId']) } : {}),
          ...(typeof data['durationMs'] === 'number' ? { durationMs: data['durationMs'] } : {}),
        });
        break;
      case 'hook.failed':
        note(`Hook "${str(data['hookName'])}" failed: ${str(data['error'])}`, 'error');
        out.push({
          op: 'hookCompleted',
          key,
          status: 'failed',
          hookName: str(data['hookName']),
          phase: str(data['phase']),
          ...(optStr(data['hookId']) ? { hookId: str(data['hookId']) } : {}),
          ...(optStr(data['hookType']) ? { hookType: str(data['hookType']) } : {}),
          ...(optStr(data['stageRunId']) ? { stageRunId: str(data['stageRunId']) } : {}),
          ...(typeof data['durationMs'] === 'number' ? { durationMs: data['durationMs'] } : {}),
        });
        break;
      case 'permission.requested':
        note(`Permission requested: ${str(data['permission'])}`);
        break;
      case 'permission.granted':
        note(`Permission granted: ${str(data['permission'])}`);
        break;
      case 'permission.denied':
        note(`Permission denied: ${str(data['permission'])}`);
        break;

      // ── Artifacts ────────────────────────────────────────────────
      case 'artifact.created':
        out.push({ op: 'invalidate', resource: 'artifacts' });
        note(`Artifact created: ${str(data['name'])}`);
        break;
      case 'artifact.available':
        out.push({ op: 'invalidate', resource: 'artifacts' });
        break;

      // ── Harness client lifecycle ─────────────────────────────────
      case 'harness.client_error':
        note(`Copilot client error: ${str(data['message'], 'Unknown error')}`, 'error');
        break;
      case 'harness.client_restarting':
        note('Copilot client restarting...');
        break;
      case 'harness.client_started':
        note('Copilot client started');
        break;
      case 'harness.client_stopped':
        note('Copilot client stopped');
        break;

      // ── Session lifecycle ────────────────────────────────────────
      case 'session.created':
      case 'session.active':
      case 'session.closing':
      case 'session.closed':
      case 'session.paused':
        out.push({ op: 'invalidate', resource: 'session' });
        out.push({ op: 'invalidate', resource: 'sessions' });
        break;
      case 'session.error':
        out.push({ op: 'invalidate', resource: 'session' });
        out.push({ op: 'invalidate', resource: 'sessions' });
        note(`Session error: ${str(data['message'], 'Unknown error')}`, 'error');
        break;

      // ── Sub-agent / abort notices ────────────────────────────────
      //
      // `harness.session_info` is raw SDK passthrough and made up 98% of one
      // orchestrator turn's traffic. Only these four types are transcript;
      // everything else (pending_messages, …) is silent on purpose.
      case 'harness.session_info': {
        if (internal) break;
        const infoType = optStr(data['infoType']);
        const notice: Record<string, { message: string; category: SystemCategory }> = {
          subagent_started: { message: 'Sub-agent started', category: 'subagent' },
          subagent_completed: { message: 'Sub-agent completed', category: 'subagent' },
          subagent_failed: { message: 'Sub-agent failed', category: 'error' },
          abort: { message: 'Turn aborted', category: 'error' },
        };
        const match = infoType ? notice[infoType] : undefined;
        if (!match) break;
        this.flushKey(key, out);
        out.push({
          op: 'addSystemMessage',
          key,
          message: str(data['message'], match.message),
          category: match.category,
        });
        break;
      }

      // ── Chat entity lifecycle ────────────────────────────────────
      case 'chat.created':
      case 'chat.archived':
      case 'chat.deleted':
        out.push({ op: 'invalidate', resource: 'chats' });
        break;

      case 'agent.created':
      case 'agent.updated':
      case 'agent.deleted':
        // The catalog is cached, so without this a newly created agent never
        // shows up in an already-open picker.
        out.push({ op: 'invalidate', resource: 'agents' });
        break;

      case 'chat.agent_changed':
        out.push({ op: 'invalidate', resource: 'chat', ...chatId() });
        out.push({ op: 'invalidate', resource: 'chats' });
        break;

      case 'chat.prompt_sent':
        out.push({ op: 'invalidate', resource: 'messages', ...chatId() });
        break;

      case 'chat.prompt_failed':
        out.push({ op: 'invalidate', resource: 'messages', ...chatId() });
        // The send never reached the provider, so nothing else will settle
        // this turn — the spinner would run until the page was reloaded.
        out.push({ op: 'errorStream', key: sessionKey });
        break;

      case 'chat.background_task.spawned':
      case 'chat.background_task.status':
      case 'chat.background_task.completed':
      case 'chat.background_task.failed':
        out.push({ op: 'invalidate', resource: 'tasks', ...chatId() });
        break;

      // ── Workflow run lifecycle ───────────────────────────────────
      case 'workflow_run.created':
      case 'workflow_run.starting':
      case 'workflow_run.running':
      case 'workflow_run.paused':
      case 'workflow_run.completed':
      case 'workflow_run.failed':
      case 'workflow_run.cancelled':
      case 'workflow_run.resumed':
      case 'workflow_run.cancelling': {
        // `resumed` is not a run status — the server has already set the row
        // to `running` before emitting it.
        const status =
          kind === 'workflow_run.resumed' ? 'running' : kind.replace('workflow_run.', '');
        const runId = optStr(data['runId']) ?? optStr(data['workflowRunId']);
        const verb = kind === 'workflow_run.resumed' ? 'resumed' : status;
        out.push({ op: 'runStatus', ...(runId ? { runId } : {}), status, data });
        out.push({
          op: 'runTimeline',
          ...(runId ? { runId } : {}),
          status,
          message:
            status === 'cancelling'
              ? 'Workflow run cancelling...'
              : `Workflow run ${verb}${optStr(data['error']) ? `: ${str(data['error'])}` : ''}`,
          data,
        });
        if (runId) out.push({ op: 'invalidate', resource: 'run', id: runId });
        // `cancelling` is a transient state the LIST does not render, so it
        // does not earn a refetch of every run.
        if (kind !== 'workflow_run.cancelling') {
          out.push({ op: 'invalidate', resource: 'runs' });
        }
        break;
      }

      // Orchestration / pre- and post-processing progress. Narration for the
      // RUN, so it goes on the session key rather than into a stage.
      case 'workflow_run.orchestration_started':
        note('Orchestration started — preparing workflow execution');
        break;
      case 'workflow_run.orchestration_completed':
        note('Orchestration completed');
        break;
      case 'workflow_run.orchestration_failed':
        note(`Orchestration failed: ${str(data['error'], 'Unknown error')}`, 'error');
        break;
      case 'workflow_run.worktree_creating':
        note('Creating worktree...');
        break;
      case 'workflow_run.worktree_created':
        note(`Worktree created: ${str(data['path'])}`);
        break;
      case 'workflow_run.preprocessing_started':
        note('Preprocessing started');
        break;
      case 'workflow_run.preprocessing_completed':
        note('Preprocessing completed');
        break;
      case 'workflow_run.preprocessing_step_started':
        note(`Preprocessing: ${str(data['stepName'] ?? data['step'], 'step')} started`);
        break;
      case 'workflow_run.preprocessing_step_completed':
        note(`Preprocessing: ${str(data['stepName'] ?? data['step'], 'step')} completed`);
        break;
      case 'workflow_run.preprocessing_step_failed':
        note(`Preprocessing step failed: ${str(data['error'], 'Unknown')}`, 'error');
        break;
      case 'workflow_run.postprocessing_started':
        note('Post-processing started');
        break;
      case 'workflow_run.postprocessing_completed':
        note('Post-processing completed');
        break;
      case 'workflow_run.postprocessing_step_started':
        note(`Post-processing: ${str(data['stepName'] ?? data['step'], 'step')} started`);
        break;
      case 'workflow_run.postprocessing_step_completed':
        note(`Post-processing: ${str(data['stepName'] ?? data['step'], 'step')} completed`);
        break;
      case 'workflow_run.postprocessing_step_failed':
        note(`Post-processing step failed: ${str(data['error'], 'Unknown')}`, 'error');
        break;
      case 'workflow_run.sandbox_created':
        note(`Sandbox created: ${str(data['sandboxId'])}`);
        break;
      case 'workflow_run.sandbox_destroyed':
        note('Sandbox destroyed');
        break;
      case 'workflow_run.stage_validation':
        note(`Stage validation: ${str(data['message'], 'validating stages')}`);
        break;
      case 'workflow_run.permission_mode_changed':
        note(`Permission mode changed to: ${str(data['mode'], 'unknown')}`);
        break;

      // ── Stage run lifecycle ──────────────────────────────────────
      case 'stage_run.pending':
      case 'stage_run.queued':
      case 'stage_run.running':
      case 'stage_run.paused':
      case 'stage_run.completed':
      case 'stage_run.failed':
      case 'stage_run.cancelled':
      case 'stage_run.skipped':
      case 'stage_run.resumed': {
        const status = kind === 'stage_run.resumed' ? 'running' : kind.replace('stage_run.', '');
        const stageRunId = stageRunIdOf();
        if (stageRunId) {
          out.push({ op: 'stageStatus', stageRunId, status, data });
          const stageSessionId = optStr(data['sessionId']);
          // Registered here because after a reload the run page needs the
          // stage's session id to fetch its history, and nothing else on the
          // wire carries the pair.
          if (stageSessionId) {
            out.push({ op: 'registerStageSession', stageRunId, sessionId: stageSessionId });
          }
          out.push({
            op: 'stageTimeline',
            stageRunId,
            status,
            message: `Stage "{stage}" ${status}${
              optStr(data['error']) ? `: ${str(data['error'])}` : ''
            }`,
            data,
          });
          if (status === 'running') {
            out.push({ op: 'selectStageRun', stageRunId });
            // Not an unconditional reset: after a reload the replay has
            // already filled this stage's blocks, and after pause→resume the
            // model continues from where it left off. Either way wiping is
            // wrong — hence a start that only applies to an empty stage.
            out.push({ op: 'startPendingIfEmpty', key: `stageRun:${stageRunId}` });
          }
          if (
            status === 'completed' ||
            status === 'failed' ||
            status === 'cancelled' ||
            status === 'skipped'
          ) {
            // Terminal: settle the stage's own stream. `harness.idle` may
            // arrive while the shared `currentStageRunId` already points at a
            // sibling, which is how a parallel stage used to be left showing
            // "Generating…" forever.
            this.flushKey(key, out);
            out.push({ op: 'stageSettled', stageRunId });
          }
        }
        const parentRunId = optStr(data['workflowRunId']);
        if (parentRunId) out.push({ op: 'invalidate', resource: 'run', id: parentRunId });
        out.push({ op: 'invalidate', resource: 'runs' });
        break;
      }

      case 'stage_run.step_started':
      case 'stage_run.step_completed': {
        // Flush BEFORE recording the transition so the step boundary keeps
        // its place in the transcript.
        this.flushKey(key, out);
        const stageRunId = stageRunIdOf();
        if (!stageRunId) break;
        const started = kind === 'stage_run.step_started';
        const label = optStr(data['label']) ?? `Step ${str(data['step'])}`;
        out.push({
          op: 'stageTimeline',
          stageRunId,
          status: started ? 'running' : 'completed',
          message: `{stage}: ${label} ${started ? 'started' : 'completed'}`,
          data,
        });
        if (started && data['step'] !== undefined) {
          out.push({
            op: 'stageStatus',
            stageRunId,
            status: 'running',
            data: { currentStep: data['step'], totalSteps: data['totalSteps'] },
          });
        }
        break;
      }

      // ── Stage durability (HITL, sleep, retry) ────────────────────
      case 'stage_run.awaiting_input': {
        this.flushKey(key, out);
        const stageRunId = stageRunIdOf();
        const stageKey = stageRunId ? `stageRun:${stageRunId}` : key;
        if (stageRunId) {
          out.push({ op: 'stageStatus', stageRunId, status: 'awaiting_input', data });
          out.push({
            op: 'stageTimeline',
            stageRunId,
            status: 'awaiting_input',
            message: 'Stage "{stage}" awaiting input',
            data,
          });
          out.push({ op: 'stageAwaitingInput', stageRunId, data });
        }
        out.push({
          op: 'addSystemMessage',
          key: stageKey,
          message: '⏸ Awaiting human input — check the HITL panel to approve or reject',
          category: 'system',
        });
        break;
      }

      case 'stage_run.input_received': {
        this.flushKey(key, out);
        const stageRunId = stageRunIdOf();
        const stageKey = stageRunId ? `stageRun:${stageRunId}` : key;
        if (stageRunId) {
          out.push({ op: 'stageStatus', stageRunId, status: 'running', data });
          out.push({
            op: 'stageTimeline',
            stageRunId,
            status: 'running',
            message: 'Stage "{stage}" input received — resuming',
            data,
          });
          out.push({ op: 'stageAwaitingInput', stageRunId, data: null });
        }
        out.push({
          op: 'addSystemMessage',
          key: stageKey,
          message: '▶ Input received — stage resuming',
          category: 'system',
        });
        break;
      }

      case 'stage_run.sleeping': {
        this.flushKey(key, out);
        const stageRunId = stageRunIdOf();
        const stageKey = stageRunId ? `stageRun:${stageRunId}` : key;
        const wake =
          typeof data['wakeAt'] === 'number'
            ? new Date(data['wakeAt']).toLocaleTimeString()
            : null;
        if (stageRunId) {
          out.push({ op: 'stageStatus', stageRunId, status: 'sleeping', data });
          out.push({
            op: 'stageTimeline',
            stageRunId,
            status: 'sleeping',
            message: `Stage "{stage}" sleeping${wake ? ` until ${wake}` : ''}`,
            data,
          });
        }
        out.push({
          op: 'addSystemMessage',
          key: stageKey,
          message: `💤 Stage sleeping${wake ? ` — wake at ${wake}` : ''}`,
          category: 'system',
        });
        break;
      }

      case 'stage_run.woken': {
        this.flushKey(key, out);
        const stageRunId = stageRunIdOf();
        const stageKey = stageRunId ? `stageRun:${stageRunId}` : key;
        if (stageRunId) {
          out.push({ op: 'stageStatus', stageRunId, status: 'running', data });
          out.push({
            op: 'stageTimeline',
            stageRunId,
            status: 'running',
            message: 'Stage "{stage}" woken — resuming',
            data,
          });
        }
        out.push({
          op: 'addSystemMessage',
          key: stageKey,
          message: '⏰ Stage woken — resuming execution',
          category: 'system',
        });
        break;
      }

      case 'stage_run.retrying': {
        this.flushKey(key, out);
        const stageRunId = stageRunIdOf();
        const stageKey = stageRunId ? `stageRun:${stageRunId}` : key;
        const attempt = str(data['attempt'], '?');
        if (stageRunId) {
          out.push({
            op: 'stageTimeline',
            stageRunId,
            status: 'running',
            message: `Stage "{stage}" retrying (attempt ${attempt})`,
            data,
          });
        }
        out.push({
          op: 'addSystemMessage',
          key: stageKey,
          message: `🔄 Retrying (attempt ${attempt})`,
          category: 'system',
        });
        break;
      }

      // Known and deliberately silent.
      case 'git.clone_progress':
      case 'harness.session_start':
      case 'harness.unknown':
      case 'hook.skipped':
      case 'subscriber.error':
        break;

      default:
        // Unknown kinds are ignored on purpose: a newer server must not break
        // an older client, and an unrecognised event is never a reason to
        // drop the buffered text that arrived before it.
        break;
    }

    return out;
  }
}
