// ────────────────────────────────────────────────────────────────
// TurnRecorder — what one agent turn produced, for chats and stages alike
// (P02 WP-2.9).
//
// The chat's `sendPrompt` listener and the stage's three listeners each kept
// their own copy of the same accumulators, and the stage copies had fallen
// behind: no text segments, no turn id, no per-call success or file stats, no
// sequence shared with the gate cards. The recorder is the one copy. It only
// accumulates and builds the message to persist; forwarding events,
// checkpoints and persistence stay with the owner.
// ────────────────────────────────────────────────────────────────

import type { AgentEvent, AgentMode, ChatMessageMetadata } from '@generatorai/shared';

export type RecordedToolCall = NonNullable<ChatMessageMetadata['toolCalls']>[number];

/** The turn's state, as a durable journal keeps it and restores it on replay. */
export interface TurnSnapshot {
  /** The last completed assistant message (`message_complete`). */
  content: string;
  thinkingText?: string;
  toolCalls?: RecordedToolCall[];
  systemMessages?: string[];
}

/** An assistant message ready to persist. */
export interface RecordedTurn {
  content: string;
  metadata: ChatMessageMetadata;
  /**
   * RV-10 — true only when written on the provider's final turn event; false
   * for a turn cut short (stop, pause, abort), whatever it managed to say.
   */
  complete: boolean;
}

export interface TurnRecorderOptions {
  /** The turn ordinal shared with the gate cards (tool calls and text segments). */
  takeSequence?: () => number | undefined;
}

export class TurnRecorder {
  turnId: string | undefined;
  agentMode: AgentMode | undefined;
  private thinking = '';
  /** Each stretch of thinking, stamped with the ordinal it started at; `thinkingOpen` while one is still growing. */
  private thinkingSegments: Array<{ text: string; sequence?: number }> = [];
  private thinkingOpen = false;
  private calls: RecordedToolCall[] = [];
  private system: string[] = [];
  private segments: Array<{ content: string; sequence?: number }> = [];
  private text = '';
  /** Tokens since the last completed message: all a stopped turn has of its answer. */
  private streamed = '';
  private anchor: ChatMessageMetadata['providerAnchor'];
  /** The model and provider the turn's own usage report named (not a sub-agent's). */
  private model: string | undefined;
  private provider: string | undefined;
  private written = false;

  constructor(private readonly opts: TurnRecorderOptions = {}) {}

  /** Start a new turn on the same listener (a stage sends several). */
  begin(turn: { turnId?: string; agentMode?: AgentMode } = {}): void {
    this.turnId = turn.turnId;
    this.agentMode = turn.agentMode;
    this.thinking = '';
    this.thinkingSegments = [];
    this.thinkingOpen = false;
    this.calls = [];
    this.system = [];
    this.segments = [];
    this.text = '';
    this.streamed = '';
    this.anchor = undefined;
    this.model = undefined;
    this.provider = undefined;
    this.written = false;
  }

  /** The last completed assistant message of the turn. */
  get content(): string {
    return this.text;
  }

  /** Whether the turn's assistant message has been handed out already. */
  get persisted(): boolean {
    return this.written;
  }

  /** Whether the turn has any text to show, completed or streamed. */
  get hasText(): boolean {
    return this.text.trim().length > 0 || this.streamed.trim().length > 0;
  }

  addSystemMessage(message: string): void {
    this.system.push(message);
  }

  /** The stretch of thinking now growing; a new one (with its ordinal) after anything else the turn did. */
  private openThinking(): { text: string; sequence?: number } {
    if (!this.thinkingOpen || this.thinkingSegments.length === 0) {
      const sequence = this.opts.takeSequence?.();
      this.thinkingSegments.push({ text: '', ...(sequence === undefined ? {} : { sequence }) });
      this.thinkingOpen = true;
    }
    return this.thinkingSegments[this.thinkingSegments.length - 1]!;
  }

  observe(event: AgentEvent): void {
    const data = event.data as Record<string, unknown> | undefined;
    if (event.kind === 'harness.token' || event.kind === 'harness.tool_start' || event.kind === 'harness.message_complete') {
      this.thinkingOpen = false;
    }
    switch (event.kind) {
      case 'harness.token':
        this.streamed += (data?.['text'] as string) ?? '';
        break;
      case 'harness.reasoning_delta': {
        const text = (data?.['text'] as string) ?? '';
        this.thinking += text;
        if (text) this.openThinking().text += text;
        break;
      }
      case 'harness.reasoning_complete': {
        // Providers that emit only the finished block never send deltas.
        const full = (data?.['content'] as string) ?? '';
        if (!full) break;
        const seg = this.openThinking();
        if (full.length > seg.text.length) {
          this.thinking = this.thinking.slice(0, this.thinking.length - seg.text.length) + full;
          seg.text = full;
        }
        break;
      }
      case 'harness.tool_start': {
        const callId = data?.['callId'] as string | undefined;
        const args = data?.['args'];
        // A call can be announced before its arguments finish streaming: the
        // Claude Agent SDK sends `tool_start` twice for one callId (empty args,
        // then the materialized ones). Merge on callId, and never let the
        // empty announcement erase args, or revive a call already completed.
        const existing = callId ? this.calls.find((t) => t.id === callId) : undefined;
        if (existing) {
          const hasArgs =
            args != null && (typeof args !== 'object' || Object.keys(args as Record<string, unknown>).length > 0);
          if (hasArgs) existing.args = args;
          if (!existing.tool || existing.tool === 'unknown') {
            existing.tool = (data?.['tool'] as string) ?? existing.tool;
          }
          break;
        }
        const sequence = this.opts.takeSequence?.();
        const parentId = data?.['parentToolCallId'];
        this.calls.push({
          id: callId ?? `tc_${this.calls.length}`,
          tool: (data?.['tool'] as string) ?? 'unknown',
          args,
          status: 'running',
          ...(sequence === undefined ? {} : { sequence }),
          // SDK-subagent nesting: history groups the call under its Agent step.
          ...(typeof parentId === 'string' && parentId ? { parentId } : {}),
        });
        break;
      }
      case 'harness.tool_complete': {
        const matchKey = (data?.['callId'] as string) ?? (data?.['tool'] as string);
        const tc = this.calls.find((t) => t.status === 'running' && (t.id === matchKey || t.tool === matchKey));
        if (!tc) break;
        tc.result = data?.['result'];
        tc.status = 'complete';
        const success = data?.['success'];
        if (typeof success === 'boolean') tc.success = success;
        const fileOp = data?.['fileOp'];
        if (fileOp && typeof fileOp === 'object') tc.fileOp = fileOp as NonNullable<RecordedToolCall['fileOp']>;
        break;
      }
      case 'harness.error':
        this.system.push(`Error: ${data?.['message']}`);
        break;
      case 'harness.message_complete': {
        // The provider's coordinate for this turn is what a later fork/rewind
        // branches at. Last one wins: a turn ends on its final message.
        if (typeof data?.['providerMessageId'] === 'string') {
          this.anchor = { kind: 'message', id: data['providerMessageId'] as string };
        }
        // Segments are discrete, not cumulative: an agentic turn narrates
        // between tool waves. Completion is authoritative even when the final
        // answer is shorter than the commentary before it.
        const content = (data?.['content'] as string) ?? '';
        if (content.trim().length > 0) {
          const sequence = this.opts.takeSequence?.();
          this.segments.push({ content, ...(sequence === undefined ? {} : { sequence }) });
          this.text = content;
        }
        // The completed message supersedes the tokens that built it.
        this.streamed = '';
        break;
      }
      case 'harness.usage':
        if (typeof data?.['agentId'] === 'string') break;
        if (typeof data?.['model'] === 'string' && data['model'] && data['model'] !== 'unknown') this.model = data['model'] as string;
        if (typeof data?.['provider'] === 'string' && data['provider']) this.provider = data['provider'] as string;
        break;
      case 'harness.turn_end':
        if (typeof data?.['providerTurnId'] === 'string') {
          this.anchor = { kind: 'turn', id: data['providerTurnId'] as string };
        }
        break;
    }
  }

  snapshot(): TurnSnapshot {
    return {
      content: this.text,
      ...(this.thinking ? { thinkingText: this.thinking } : {}),
      ...(this.calls.length > 0 ? { toolCalls: this.calls.map((c) => ({ ...c })) } : {}),
      ...(this.system.length > 0 ? { systemMessages: [...this.system] } : {}),
    };
  }

  /** A settled turn replayed from a journal: its message is already in the transcript. */
  restore(snapshot: TurnSnapshot): void {
    this.begin();
    this.text = snapshot.content;
    this.thinking = snapshot.thinkingText ?? '';
    this.calls = (snapshot.toolCalls ?? []).map((c) => ({ ...c }));
    this.system = [...(snapshot.systemMessages ?? [])];
    this.written = true;
  }

  /**
   * The assistant message for this turn, once. `partial` marks a turn cut
   * short: it keeps whichever record is richer (the last completed message or
   * the tokens streamed since), settles calls still in flight as stopped, and
   * is recorded even when empty. A completed turn needs text; `fallbackContent`
   * is what the provider call returned, for providers that emit no message
   * events.
   */
  take(opts: { partial?: boolean; fallbackContent?: string } = {}): RecordedTurn | undefined {
    if (this.written) return undefined;
    const partial = opts.partial === true;
    // A turn that failed keeps what it streamed and its error even with no final
    // message (a provider error ends a turn without `message_complete`); it is not
    // "stopped", so it is not marked partial.
    const failed = !partial && this.system.some((m) => m.startsWith('Error: '));
    let content =
      (partial || failed) && this.streamed.trim().length > this.text.trim().length ? this.streamed : this.text;
    if (content.trim().length === 0 && opts.fallbackContent) content = opts.fallbackContent;
    if (!partial && !failed && content.trim().length === 0) return undefined;
    this.written = true;

    // A stopped turn cannot have a call still in flight.
    if (partial) {
      for (const tc of this.calls) {
        if (tc.status !== 'running') continue;
        tc.status = 'complete';
        tc.success = false;
        tc.result ??= 'Stopped before it finished.';
      }
    }

    const metadata: ChatMessageMetadata = {};
    if (this.thinking) metadata.thinkingText = this.thinking;
    const thoughts = this.thinkingSegments.filter((t) => t.text.trim());
    if (thoughts.some((t) => t.sequence !== undefined)) metadata.thinkingSegments = thoughts;
    if (this.calls.length > 0) metadata.toolCalls = this.calls;
    if (this.system.length > 0) metadata.systemMessages = this.system;
    // Only worth keeping when the turn said more than the line in `content`.
    if (this.segments.length > 1) metadata.textSegments = this.segments;
    if (this.turnId) metadata.turnId = this.turnId;
    if (this.agentMode) metadata.agentMode = this.agentMode;
    if (partial) metadata.partial = true;
    if (this.anchor) metadata.providerAnchor = this.anchor;
    if (this.model) metadata.model = this.model;
    if (this.provider) metadata.provider = this.provider;
    return { content, metadata, complete: !partial };
  }
}
