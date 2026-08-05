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

import type { PlanBlock, QuestionBlock, SystemCategory, WidgetBlock } from './types.js';

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
  | { op: 'addToolCall'; key: string; tool: string; args: unknown; callId?: string }
  | { op: 'completeToolCall'; key: string; toolOrCallId: string; result: unknown }
  | { op: 'addSystemMessage'; key: string; message: string; category: SystemCategory }
  | { op: 'processInlineToolCalls'; key: string; content: string }
  | { op: 'completeStream'; key: string }
  | { op: 'errorStream'; key: string }
  | { op: 'setServerTurnId'; key: string; turnId: string }
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
  /** Refetch a REST resource. The host decides how (TanStack, manual, …). */
  | {
      op: 'invalidate';
      resource: 'messages' | 'chat' | 'run' | 'plans' | 'interactions' | 'workspace' | 'tasks';
      /** Workspace the change belongs to, when the resource is workspace-scoped. */
      id?: string;
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
        this.flushKey(key, out);
        out.push({
          op: 'upsertPlan',
          key,
          plan: {
            planId: String(data['planId'] ?? ''),
            revision: Number(data['revision'] ?? 1),
            title: String(data['title'] ?? 'Plan'),
            fileName: String(data['fileName'] ?? 'plan.md'),
            summary: String(data['summary'] ?? ''),
            status: 'drafting',
            actions: [],
          },
        });
        out.push({ op: 'invalidate', resource: 'plans' });
        break;

      case 'chat.plan.updated':
        this.flushKey(key, out);
        out.push({
          op: 'setPlanStatus',
          key,
          planId: String(data['planId'] ?? ''),
          status: 'drafting',
          extra: { revision: Number(data['revision'] ?? 1) },
        });
        out.push({ op: 'invalidate', resource: 'plans' });
        break;

      case 'chat.plan.review_requested': {
        this.flushKey(key, out);
        // `upsertPlan` merges onto the card from `chat.plan.created`, so
        // absent fields must be omitted rather than blanked.
        const title =
          typeof data['title'] === 'string' && data['title']
            ? data['title']
            : String(data['summary'] ?? 'Plan');
        out.push({
          op: 'upsertPlan',
          key,
          plan: {
            planId: String(data['planId'] ?? ''),
            revision: Number(data['revision'] ?? 1),
            title,
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
          },
        });
        out.push({ op: 'invalidate', resource: 'plans' });
        out.push({ op: 'invalidate', resource: 'interactions' });
        break;
      }

      case 'chat.plan.decided': {
        this.flushKey(key, out);
        const approved = data['approved'] === true;
        const action = typeof data['action'] === 'string' ? data['action'] : undefined;
        out.push({
          op: 'setPlanStatus',
          key,
          planId: String(data['planId'] ?? ''),
          status: approved
            ? action === 'exit_only'
              ? 'rejected'
              : 'approved'
            : 'changes_requested',
        });
        out.push({ op: 'invalidate', resource: 'plans' });
        out.push({ op: 'invalidate', resource: 'interactions' });
        break;
      }

      case 'chat.plan.expired':
        this.flushKey(key, out);
        out.push({
          op: 'setPlanStatus',
          key,
          planId: String(data['planId'] ?? ''),
          status: 'expired',
        });
        out.push({ op: 'invalidate', resource: 'plans' });
        out.push({ op: 'invalidate', resource: 'interactions' });
        break;

      case 'chat.plan.extraction_failed':
        this.flushKey(key, out);
        out.push({
          op: 'addSystemMessage',
          key,
          message: `Plan mode: ${String(data['reason'] ?? 'the plan could not be captured')}`,
          category: 'error',
        });
        break;

      // The wire kinds are dot-separated (`chat.question.asked`). The
      // underscore spellings were a transcription slip that meant a phone
      // NEVER saw a clarifying question; both are accepted now so a rename
      // in either direction cannot silently break the gate again.
      case 'chat.question.asked':
      case 'chat.question_asked':
        this.flushKey(key, out);
        out.push({
          op: 'upsertQuestion',
          key,
          question: {
            interactionId: String(data['interactionId'] ?? ''),
            questions: Array.isArray(data['questions'])
              ? (data['questions'] as QuestionBlock['questions'])
              : [],
            status: 'pending',
          },
        });
        out.push({ op: 'invalidate', resource: 'interactions' });
        break;

      case 'chat.question.answered':
      case 'chat.question_answered':
        this.flushKey(key, out);
        out.push({
          op: 'answerQuestion',
          key,
          interactionId: String(data['interactionId'] ?? ''),
          answers: (data['answers'] as Record<string, string[]>) ?? {},
          ...(typeof data['freeformResponse'] === 'string'
            ? { freeformResponse: data['freeformResponse'] }
            : {}),
        });
        out.push({ op: 'invalidate', resource: 'interactions' });
        break;

      case 'chat.question.expired':
      case 'chat.question_expired':
        this.flushKey(key, out);
        out.push({
          op: 'expireQuestion',
          key,
          interactionId: String(data['interactionId'] ?? ''),
        });
        out.push({ op: 'invalidate', resource: 'interactions' });
        break;

      // ── Widgets ──
      case 'harness.widget.render':
        this.flushKey(key, out);
        out.push({
          op: 'addWidget',
          key,
          widget: {
            instanceId: String(data['instanceId'] ?? ''),
            descriptorId: String(data['descriptorId'] ?? ''),
            extensionId: String(data['extensionId'] ?? ''),
            component: String(data['component'] ?? ''),
            ...(typeof data['title'] === 'string' ? { title: data['title'] } : {}),
            surface: typeof data['surface'] === 'string' ? data['surface'] : 'widget',
            assetsBase: typeof data['assetsBase'] === 'string' ? data['assetsBase'] : '',
            entry: String(data['entry'] ?? ''),
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
          instanceId: String(data['instanceId'] ?? ''),
          state: data['state'],
        });
        break;

      case 'harness.widget.closed':
        this.flushKey(key, out);
        out.push({
          op: 'setWidgetStatus',
          key,
          instanceId: String(data['instanceId'] ?? ''),
          status: 'closed',
        });
        break;

      case 'harness.widget.error':
        this.flushKey(key, out);
        out.push({
          op: 'setWidgetStatus',
          key,
          instanceId: String(data['instanceId'] ?? ''),
          status: 'error',
          ...(typeof data['error'] === 'string' ? { error: data['error'] } : {}),
        });
        break;

      // ── Git / workspace narration ──
      case 'git.clone_start':
        this.flushKey(key, out);
        out.push({
          op: 'addSystemMessage',
          key,
          message: `Cloning repository: ${String(data['repoUrl'] ?? '')}`,
          category: 'system',
        });
        break;

      case 'git.clone_complete':
        this.flushKey(key, out);
        out.push({
          op: 'addSystemMessage',
          key,
          message: `Repository cloned to: ${String(data['localPath'] ?? '')}`,
          category: 'system',
        });
        break;

      case 'git.commit':
        this.flushKey(key, out);
        out.push({
          op: 'addSystemMessage',
          key,
          message: `Git commit: ${String(data['message'] ?? '')} (${String(data['sha'] ?? '')})`,
          category: 'system',
        });
        break;

      case 'git.push':
        this.flushKey(key, out);
        out.push({
          op: 'addSystemMessage',
          key,
          message: `Pushed to branch: ${String(data['branch'] ?? '')}`,
          category: 'system',
        });
        break;

      case 'git.pr_created':
        this.flushKey(key, out);
        out.push({
          op: 'addSystemMessage',
          key,
          message: `PR created: ${String(data['url'] ?? '')}`,
          category: 'system',
        });
        break;

      case 'hook.failed':
        this.flushKey(key, out);
        out.push({
          op: 'addSystemMessage',
          key,
          message: `Hook "${String(data['hookName'] ?? '')}" failed: ${String(data['error'] ?? '')}`,
          category: 'error',
        });
        break;

      // The Changes and Files surfaces used to poll. These are what keep a
      // sheet that is already open in step with the agent's edits.
      case 'workspace.changed':
      case 'checkpoint.created':
      case 'checkpoint.restored':
        out.push({
          op: 'invalidate',
          resource: 'workspace',
          ...(typeof data['workspaceId'] === 'string' ? { id: data['workspaceId'] } : {}),
        });
        break;

      case 'chat.background_task.spawned':
      case 'chat.background_task.status':
      case 'chat.background_task.completed':
      case 'chat.background_task.failed':
        out.push({ op: 'invalidate', resource: 'tasks' });
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
