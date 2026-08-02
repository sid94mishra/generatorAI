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

import type { SystemCategory } from './types.js';

/** A mutation to apply to the stream store. */
export type StreamEffect =
  | { op: 'appendToken'; key: string; text: string }
  | { op: 'appendThinking'; key: string; text: string }
  | { op: 'completeThinking'; key: string }
  | { op: 'startPending'; key: string; userMessage?: string }
  | { op: 'addToolCall'; key: string; tool: string; args: unknown; callId?: string }
  | { op: 'completeToolCall'; key: string; toolOrCallId: string; result: unknown }
  | { op: 'addSystemMessage'; key: string; message: string; category: SystemCategory }
  | { op: 'processInlineToolCalls'; key: string; content: string }
  | { op: 'completeStream'; key: string }
  | { op: 'errorStream'; key: string }
  | { op: 'setServerTurnId'; key: string; turnId: string }
  | { op: 'setUsage'; key: string; usage: Record<string, unknown> }
  | { op: 'setContextUsage'; key: string; snapshot: Record<string, unknown> }
  /** Refetch a REST resource. The host decides how (TanStack, manual, …). */
  | { op: 'invalidate'; resource: 'messages' | 'chat' | 'run' | 'plans' | 'interactions' };

export interface PersistedEventLike {
  kind: string;
  sessionId?: string;
  data?: Record<string, unknown> | undefined;
}

/** One session's pending token/thinking text, awaiting a flush. */
interface Buffers {
  tokenBuf: string;
  thinkingBuf: string;
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

  private bufferFor(key: string): Buffers {
    let buf = this.buffers.get(key);
    if (!buf) {
      buf = { tokenBuf: '', thinkingBuf: '' };
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
   * Flush pending text for one key, newest-kind-last.
   *
   * Order here IS the temporal order of the transcript.
   */
  private flushKey(key: string, out: StreamEffect[]): void {
    const buf = this.buffers.get(key);
    if (!buf) return;
    if (buf.thinkingBuf) {
      out.push({ op: 'appendThinking', key, text: buf.thinkingBuf });
      buf.thinkingBuf = '';
    }
    if (buf.tokenBuf) {
      out.push({ op: 'appendToken', key, text: buf.tokenBuf });
      buf.tokenBuf = '';
    }
  }

  /** Flush every buffer. Called on a frame tick and before ordered events. */
  drain(): StreamEffect[] {
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
   * Effects are returned in the order they must be applied.
   */
  handle(sessionId: string, event: PersistedEventLike): StreamEffect[] {
    if (!event?.kind) return [];
    const data = event.data ?? {};

    // Orchestrator worker turns are bookkeeping, not transcript. Rendering
    // them would show the user their own agent talking to itself.
    if (data['__isInternalTurn'] && event.kind !== 'harness.user_message') {
      return [];
    }

    const key = this.streamKey(sessionId, data);
    const out: StreamEffect[] = [];

    switch (event.kind) {
      case 'harness.token': {
        const text = data['text'] as string | undefined;
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
        const text = data['text'] as string | undefined;
        if (!text) break;
        const buf = this.bufferFor(key);
        if (buf.tokenBuf) {
          out.push({ op: 'appendToken', key, text: buf.tokenBuf });
          buf.tokenBuf = '';
        }
        buf.thinkingBuf += text;
        break;
      }

      case 'harness.reasoning_complete':
        this.flushKey(key, out);
        out.push({ op: 'completeThinking', key });
        break;

      case 'harness.message_complete': {
        this.flushKey(key, out);
        const content = data['content'] as string | undefined;
        if (content && /<function_calls>|<tool_calls>/.test(content)) {
          // The model emitted tool-call XML in the token stream instead of
          // using the SDK protocol; restructure it into real blocks.
          out.push({ op: 'processInlineToolCalls', key, content });
        }
        out.push({ op: 'invalidate', resource: 'messages' });
        break;
      }

      case 'harness.user_message': {
        this.flushKey(key, out);
        if (data['__isInternalTurn']) {
          out.push({ op: 'invalidate', resource: 'messages' });
          break;
        }
        // Clear buffers: anything pending belongs to the previous turn.
        const buf = this.buffers.get(key);
        if (buf) {
          buf.tokenBuf = '';
          buf.thinkingBuf = '';
        }
        out.push({
          op: 'startPending',
          key,
          ...(typeof data['content'] === 'string' ? { userMessage: data['content'] } : {}),
        });
        out.push({ op: 'invalidate', resource: 'messages' });
        break;
      }

      case 'harness.tool_start': {
        this.flushKey(key, out);
        out.push({
          op: 'addToolCall',
          key,
          tool: String(data['tool'] ?? 'tool'),
          args: data['args'],
          ...(typeof data['callId'] === 'string' ? { callId: data['callId'] } : {}),
        });
        break;
      }

      case 'harness.tool_complete': {
        this.flushKey(key, out);
        const id = (data['callId'] ?? data['tool']) as string | undefined;
        if (id) out.push({ op: 'completeToolCall', key, toolOrCallId: id, result: data['result'] });
        break;
      }

      case 'harness.error': {
        this.flushKey(key, out);
        const message = String(data['message'] ?? data['error'] ?? 'The agent reported an error.');
        out.push({ op: 'addSystemMessage', key, message, category: 'error' });
        out.push({ op: 'errorStream', key });
        break;
      }

      case 'harness.idle':
        this.flushKey(key, out);
        out.push({ op: 'completeStream', key });
        out.push({ op: 'invalidate', resource: 'messages' });
        break;

      case 'copilot.turn_start': {
        const turnId = data['turnId'] as string | undefined;
        if (turnId) out.push({ op: 'setServerTurnId', key, turnId });
        break;
      }

      case 'copilot.usage':
      case 'harness.usage': {
        // Recorded even on a settled stream: the context gauge describes the
        // conversation, not the turn.
        out.push({ op: 'setUsage', key, usage: data });
        break;
      }

      case 'harness.context_usage':
        out.push({ op: 'setContextUsage', key, snapshot: data });
        break;

      case 'chat.plan.created':
      case 'chat.plan.updated':
      case 'chat.plan.review_requested':
      case 'chat.plan.decided':
      case 'chat.plan.expired':
        this.flushKey(key, out);
        out.push({ op: 'invalidate', resource: 'plans' });
        break;

      case 'chat.question_asked':
      case 'chat.question_answered':
      case 'chat.question_expired':
        this.flushKey(key, out);
        out.push({ op: 'invalidate', resource: 'interactions' });
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
