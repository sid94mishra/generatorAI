// ────────────────────────────────────────────────────────────────
// InterruptedTurnRecoveryService — close chat turns the last process died in.
//
// Stream durability covered two of three failure shapes: a client reload and a
// transport drop both replay from the durable log and pick the turn back up.
// The third — the SERVER restarting mid-turn — was not handled at all:
// boot housekeeping skips chat sessions by design (re-hydrating them
// without their tool handlers would poison the SDK session), the per-turn
// finalizers live in `ChatManagementService`'s memory, and nothing at boot
// wrote a terminal event. A client reconnecting after the restart replayed the
// deltas, then waited for a `harness.idle` that could never come; the partial
// answer was never persisted, so the next page load lost it entirely.
//
// This service runs once at boot, after the durable stores are up. For every
// active chat it reads the TAIL of the session's event log (two indexed
// queries per chat, bounded), and when the last `harness.turn_start` has no
// terminal event after it:
//
//   1. persists what streamed — the discrete `harness.message_complete`
//      segments plus any trailing `harness.token` text — as a partial
//      assistant message, exactly the shape `cancelTurn` writes, so the
//      transcript shows what the user saw;
//   2. emits `harness.error` (code `INTERRUPTED_BY_RESTART`) and
//      `harness.idle` on the session, so a reconnecting client leaves the
//      thinking state and the chat accepts a new prompt.
//
// It deliberately does not touch the harness: the conversation is resumed
// with its tools by `ChatManagementService.sendPrompt` on the next message,
// which is the path that already knows how to do that.
// ────────────────────────────────────────────────────────────────

import type { Chat, ChatMessageMetadata, ILogger, PersistedEvent } from '@generatorai/shared';
import { generateId } from '@generatorai/shared';
import type { IChatRepository } from '../domain/ports/IChatRepository.js';
import type { IChatMessageRepository } from '../domain/ports/IRepositories.js';
import type { EventBus } from '../events/EventBus.js';

/** How many trailing events to inspect per chat. A turn longer than this still
 *  recovers; only text older than the window is lost from the partial message. */
const TAIL_EVENTS = 400;

/** Kinds that end a turn. `harness.error` alone does not — the service
 *  layer always follows it with `harness.idle`, which is what clients wait on. */
const TERMINAL_KINDS: ReadonlySet<string> = new Set(['harness.idle', 'harness.cancelled']);

export const INTERRUPTED_BY_RESTART_CODE = 'INTERRUPTED_BY_RESTART';
export const INTERRUPTED_BY_RESTART_MESSAGE =
  'The server restarted while this response was being generated. What had streamed so far is kept; send your message again to continue.';

export interface InterruptedTurnRecoverySummary {
  scanned: number;
  interrupted: number;
  persistedPartials: number;
  failures: string[];
}

export class InterruptedTurnRecoveryService {
  constructor(
    private readonly chatRepo: IChatRepository,
    private readonly messageRepo: IChatMessageRepository,
    private readonly eventBus: EventBus,
    private readonly logger: ILogger,
  ) {}

  async recover(): Promise<InterruptedTurnRecoverySummary> {
    const summary: InterruptedTurnRecoverySummary = { scanned: 0, interrupted: 0, persistedPartials: 0, failures: [] };
    let chats: Chat[];
    try {
      chats = await this.chatRepo.getByStatus('active');
    } catch (err) {
      summary.failures.push(`list chats: ${err instanceof Error ? err.message : String(err)}`);
      return summary;
    }

    for (const chat of chats) {
      if (!chat.sessionId) continue;
      summary.scanned += 1;
      try {
        const recovered = await this.recoverChat(chat);
        if (recovered.interrupted) summary.interrupted += 1;
        if (recovered.persisted) summary.persistedPartials += 1;
      } catch (err) {
        summary.failures.push(`${chat.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (summary.interrupted > 0 || summary.failures.length > 0) {
      this.logger.info('[Recovery] interrupted chat turns closed', { ...summary } as Record<string, unknown>);
    }
    return summary;
  }

  private async recoverChat(chat: Chat): Promise<{ interrupted: boolean; persisted: boolean }> {
    const sessionId = chat.sessionId;
    const lastSeq = await this.eventBus.getLastSequence(sessionId);
    if (lastSeq === undefined || lastSeq <= 0) return { interrupted: false, persisted: false };

    const tail = await this.eventBus.getSessionEvents(sessionId, Math.max(0, lastSeq - TAIL_EVENTS));
    if (tail.length === 0) return { interrupted: false, persisted: false };

    const last = tail[tail.length - 1]!;
    if (TERMINAL_KINDS.has(last.kind)) return { interrupted: false, persisted: false };

    // The turn we are closing starts at the most recent turn_start in the
    // window. A tail with no turn_start at all is a turn longer than the
    // window: still open, still interrupted — we just recover less text.
    let start = -1;
    for (let i = tail.length - 1; i >= 0; i -= 1) {
      if (tail[i]!.kind === 'harness.turn_start') { start = i; break; }
    }
    const turnEvents = tail.slice(start + 1);
    // A window that holds a terminal event after the start is not interrupted
    // (the last event was just a late non-turn frame such as a warning).
    if (turnEvents.some((e) => TERMINAL_KINDS.has(e.kind))) return { interrupted: false, persisted: false };
    // Nothing turn-shaped at all (a chat whose newest rows are e.g. a rename)
    // is not an open turn either.
    if (start === -1 && !turnEvents.some((e) => isTurnActivity(e))) return { interrupted: false, persisted: false };

    const turnId = start >= 0 ? readTurnId(tail[start]!) : undefined;
    const content = reconstructText(turnEvents);

    let persisted = false;
    if (content.trim().length > 0) {
      const metadata: ChatMessageMetadata = { partial: true } as ChatMessageMetadata;
      (metadata as Record<string, unknown>)['interrupted'] = 'server_restart';
      if (turnId) metadata.turnId = turnId;
      await this.messageRepo.create({
        id: generateId(),
        sessionId,
        chatId: chat.id,
        role: 'assistant',
        content,
        metadata,
        timestamp: new Date(),
      });
      persisted = true;
    }

    await this.eventBus.emit(sessionId, {
      kind: 'harness.error',
      data: { message: INTERRUPTED_BY_RESTART_MESSAGE, code: INTERRUPTED_BY_RESTART_CODE, chatId: chat.id, ...(turnId ? { turnId } : {}) },
    } as never);
    await this.eventBus.emit(sessionId, {
      kind: 'harness.idle',
      data: { chatId: chat.id, ...(turnId ? { turnId } : {}) },
    } as never);

    this.logger.warn(
      `[Recovery] chat ${chat.id} had a turn open across the restart` +
        (persisted ? ` — persisted ${content.length} chars of partial output` : ' — no output had streamed'),
    );
    return { interrupted: true, persisted };
  }
}

function isTurnActivity(e: PersistedEvent): boolean {
  return (
    e.kind === 'harness.token' ||
    e.kind === 'harness.message_complete' ||
    e.kind === 'harness.tool_start' ||
    e.kind === 'harness.tool_complete' ||
    e.kind === 'harness.reasoning_delta' ||
    e.kind === 'harness.user_message'
  );
}

function readTurnId(e: PersistedEvent): string | undefined {
  const data = e.data as Record<string, unknown> | undefined;
  const turnId = data?.['turnId'];
  return typeof turnId === 'string' ? turnId : undefined;
}

/**
 * Rebuild the assistant text of an open turn the way the live transcript was
 * built: each `message_complete` is a discrete segment that supersedes the
 * tokens before it; tokens after the last completed segment are the trailing
 * partial paragraph.
 */
export function reconstructText(events: ReadonlyArray<PersistedEvent>): string {
  const segments: string[] = [];
  let trailing = '';
  for (const e of events) {
    const data = e.data as Record<string, unknown> | undefined;
    if (e.kind === 'harness.token') {
      trailing += typeof data?.['text'] === 'string' ? (data['text'] as string) : '';
    } else if (e.kind === 'harness.message_complete') {
      const content = typeof data?.['content'] === 'string' ? (data['content'] as string) : '';
      if (content.trim().length > 0) segments.push(content);
      trailing = '';
    }
  }
  if (trailing.trim().length > 0) segments.push(trailing);
  return segments.join('\n\n');
}
