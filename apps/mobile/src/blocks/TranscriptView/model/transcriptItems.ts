// MB-07 transcript items (pure): persisted messages + the live stream's structure → the rows of the Legend List.
// Turns come from client-core `buildTranscriptTurns`; a user message is one item, each persisted agent message one
// item (blocks via `wireChatMessageToBlocks`; the header on the first of its turn, the turn footer on the last),
// the live turn one item that subscribes to the stream itself. De-duplication follows the legacy screen: the live
// turn is fully represented by its blocks, so its persisted twin is skipped. Settled source-control results that
// only exist as replayed events are appended to their turn's last agent message as an `scm_result` block.
import {
  buildTranscriptTurns,
  messageAttachments,
  messageTime,
  messageWasStopped,
  transcriptMessageInput,
  wireChatMessageToBlocks,
  type ChatMessage,
  type MessageAttachment,
  type StreamBlock,
} from '@generatorai/client-core';
import type { ScmFlowResult } from '@generatorai/shared';

export type TranscriptItem =
  | { kind: 'user'; key: string; text: string; attachments: MessageAttachment[]; time: string | null; turnId?: string; pending?: boolean }
  | {
      kind: 'agent';
      key: string;
      blocks: StreamBlock[];
      time: string | null;
      /** First agent message of its turn: draws the AgentTurnHeader. */
      header: boolean;
      /** Last agent message of a settled turn: draws the turn footer. */
      footer: boolean;
      stopped: boolean;
      durationMs?: number;
      turnId?: string;
    }
  | { kind: 'system'; key: string; text: string }
  | { kind: 'live'; key: string }
  | { kind: 'activity'; key: string; label: string };

export interface TranscriptLiveInput {
  /** The live stream's status ('pending' until the server's first event for the turn). */
  status?: 'idle' | 'pending' | 'thinking' | 'streaming' | 'complete' | 'error';
  /** The server turn id of the live stream, once known. */
  serverTurnId: string | null;
  /** The optimistic bubble of the turn being sent. */
  pendingUserMessage: string | null;
  /** The prompt of the live turn, to find its persisted twin before the turn id is known. */
  turnUserMessage: string | null;
  /** Local turn counter (keys the pending bubble). */
  turnId: number;
  /** The live stream has blocks or is running. */
  hasLive: boolean;
  activityLabel: string | null;
}

const blockCache = new WeakMap<ChatMessage, StreamBlock[]>();

/** Persisted message → stream blocks, once per message object (history never changes). */
export function messageBlocksOf(message: ChatMessage): StreamBlock[] {
  let blocks = blockCache.get(message);
  if (!blocks) {
    blocks = wireChatMessageToBlocks(message);
    blockCache.set(message, blocks);
  }
  return blocks;
}

function ms(from: ChatMessage | null, to: ChatMessage): number | undefined {
  if (!from) return undefined;
  const a = messageTime(from);
  const b = messageTime(to);
  if (a == null || b == null) return undefined;
  const diff = new Date(b).getTime() - new Date(a).getTime();
  return Number.isFinite(diff) && diff > 0 ? diff : undefined;
}

const iso = (message: ChatMessage): string | null => {
  const t = messageTime(message);
  return t == null ? null : new Date(t).toISOString();
};

/** A replayed source-control block for a settled turn (the live stream carries its own). */
export function replayedScmBlock(turnId: string, result: ScmFlowResult): StreamBlock {
  return { type: 'scm_result', blockId: 1_000_000, turnId, result };
}

/**
 * The persisted user message that opened the live turn: the one carrying the server turn id, or — before the id is
 * known — the last user message when it is the newest row and has the live prompt's text (an identical older prompt
 * is never taken for it, desktop WEB-02).
 */
function liveAnchor(messages: readonly ChatMessage[], live: TranscriptLiveInput): string | null {
  if (live.serverTurnId) {
    const hit = messages.find((m) => m.role === 'user' && m.metadata?.turnId === live.serverTurnId);
    return hit?.id ?? null;
  }
  const prompt = live.turnUserMessage?.trim();
  if (!prompt) return null;
  const last = messages[messages.length - 1];
  return last?.role === 'user' && last.content.trim() === prompt ? last.id : null;
}

/**
 * The transcript rows. The live turn renders right after the user message that started it (M6 device review): its
 * persisted user message is drawn in place (sent, with its time and turn id), the persisted agent messages of that
 * turn are skipped (the live blocks represent them), and every later message — prompts sent while the turn ran —
 * follows its output. Until the server has persisted the prompt, the optimistic bubble stands in at the end; it is
 * "sending" (clock glyph) only until the server acknowledges the turn (its turn id, or any status past `pending`).
 */
export function buildTranscriptItems(
  messages: readonly ChatMessage[],
  live: TranscriptLiveInput,
  scm?: { results: ReadonlyMap<string, ScmFlowResult> | undefined; liveTurnIds: ReadonlySet<string> },
): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  const anchor = liveAnchor(messages, live);
  const liveRows = (): void => {
    if (live.hasLive) out.push({ kind: 'live', key: 'live-turn' });
    if (live.activityLabel) out.push({ kind: 'activity', key: `activity-${live.turnId}`, label: live.activityLabel });
  };
  const turns = buildTranscriptTurns(
    messages.map((message) => ({ id: message.id, role: message.role, ...transcriptMessageInput(message), attachments: messageAttachments(message), source: message })),
  );
  for (const turn of turns) {
    const user = turn.entries.find((e) => e.kind === 'user');
    const prompt = user?.kind === 'user' ? user.message.source : null;
    const anchored = prompt !== null && prompt.id === anchor;
    const agents: Array<Extract<TranscriptItem, { kind: 'agent' }>> = [];
    for (const entry of turn.entries) {
      if (entry.kind === 'live' || entry.kind === 'pending_user') continue;
      const message = entry.message.source;
      const turnId = message.metadata?.turnId;
      if (entry.kind === 'user') {
        out.push({ kind: 'user', key: message.id, text: message.content, attachments: entry.message.attachments ?? [], time: iso(message), ...(turnId ? { turnId } : {}) });
        if (anchored) liveRows();
        continue;
      }
      // The live turn's own persisted output: its blocks are already on screen.
      if (anchored || (live.serverTurnId && turnId === live.serverTurnId)) continue;
      if (entry.kind === 'system') {
        out.push({ kind: 'system', key: message.id, text: message.content });
        continue;
      }
      const item: Extract<TranscriptItem, { kind: 'agent' }> = {
        kind: 'agent',
        key: message.id,
        blocks: messageBlocksOf(message),
        time: iso(message),
        header: agents.length === 0,
        footer: false,
        stopped: messageWasStopped(message),
        ...(turnId ? { turnId } : {}),
      };
      const duration = ms(prompt, message);
      if (duration !== undefined) item.durationMs = duration;
      agents.push(item);
      out.push(item);
    }
    const last = agents[agents.length - 1];
    if (last) {
      last.footer = true;
      const result = last.turnId ? scm?.results?.get(last.turnId) : undefined;
      if (result && last.turnId && !scm?.liveTurnIds.has(last.turnId)) {
        last.blocks = [...last.blocks, replayedScmBlock(last.turnId, result)];
      }
    }
  }
  if (anchor === null) {
    if (live.pendingUserMessage) {
      const sending = live.serverTurnId === null && (live.status === undefined || live.status === 'pending');
      out.push({ kind: 'user', key: `pending-${live.turnId}`, text: live.pendingUserMessage, attachments: [], time: null, pending: sending });
    }
    liveRows();
  }
  return out;
}

/** Turn ids whose `scm_result` the live stream already holds (their replayed copy would be a duplicate). */
export function liveScmTurnIds(blocks: readonly StreamBlock[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const b of blocks ?? []) if (b.type === 'scm_result') ids.add(b.turnId);
  return ids;
}

/** Every tool call of the chat in order (persisted, then live), for the step detail screen and its ↑ / ↓. */
export function chatToolCalls(messages: readonly ChatMessage[], liveBlocks: readonly StreamBlock[] | undefined): Array<Extract<StreamBlock, { type: 'tool_call' }>> {
  const out: Array<Extract<StreamBlock, { type: 'tool_call' }>> = [];
  const seen = new Set<string>();
  const take = (blocks: readonly StreamBlock[]) => {
    for (const b of blocks) {
      if (b.type !== 'tool_call' || seen.has(b.callId)) continue;
      seen.add(b.callId);
      out.push(b);
    }
  };
  for (const message of messages) if (message.role === 'assistant') take(messageBlocksOf(message));
  take(liveBlocks ?? []);
  return out;
}
