// ────────────────────────────────────────────────────────────────
// Chat transcript helpers — turn grouping, rewind/fork cut points and the
// synthetic "conversation seed".
//
// A chat's history is a flat list of `chat_messages` rows. A TURN is one user
// prompt plus everything the assistant produced in answer to it, and both rows
// carry the same server-minted `metadata.turnId`. Rewind and fork are
// expressed in turns ("back to the start of turn N", "branch after turn N"),
// so the grouping lives here, pure and testable, rather than inline in
// ChatManagementService.
//
// The seed is the fallback for providers with no native conversation
// branching (Copilot today): a fresh provider session is opened and this
// digest of the surviving turns is prepended to the next prompt, so the model
// keeps the gist of what was said even though its own history restarted.
// ────────────────────────────────────────────────────────────────

import type { ChatMessage } from '@generatorai/shared';
import type { ConversationAnchor } from '../domain/ports/IAgentHarness.js';

export interface ChatTurn {
  /** `metadata.turnId`; rows written before turn ids existed share a synthetic id. */
  turnId: string;
  /** Index of the first row of this turn in the source list. */
  startIndex: number;
  /** Index one past the last row of this turn. */
  endIndex: number;
  userMessage?: ChatMessage;
  assistantMessages: ChatMessage[];
  /** Every row of the turn in order (user, assistant, system, tool). */
  rows: ChatMessage[];
}

/**
 * Group an ordered transcript into turns.
 *
 * A row starts a new turn when it is a user message with a turnId different
 * from the current one, or a user message with no turnId at all. Rows that
 * follow a user message and carry no turnId (legacy assistant rows, system
 * notes) belong to the turn they follow.
 */
export function groupTurns(messages: readonly ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let current: ChatTurn | undefined;
  let legacySeq = 0;

  const startTurn = (id: string, index: number): ChatTurn => {
    const turn: ChatTurn = { turnId: id, startIndex: index, endIndex: index, assistantMessages: [], rows: [] };
    turns.push(turn);
    return turn;
  };

  messages.forEach((m, index) => {
    const id = m.metadata?.turnId;
    const isUser = m.role === 'user';
    if (isUser && (!current || !id || id !== current.turnId)) {
      current = startTurn(id ?? `legacy-${legacySeq++}`, index);
    } else if (!current) {
      // An assistant/system row with no preceding user message (should not
      // happen, but a transcript must still be representable).
      current = startTurn(id ?? `legacy-${legacySeq++}`, index);
    } else if (id && id !== current.turnId && !isUser) {
      // A non-user row from a different turn: start a turn for it so the row
      // is never attributed to the wrong prompt.
      current = startTurn(id, index);
    }
    current.rows.push(m);
    current.endIndex = index + 1;
    if (isUser && !current.userMessage) current.userMessage = m;
    if (m.role === 'assistant') current.assistantMessages.push(m);
  });
  return turns;
}

/** Last provider anchor recorded in `messages` (assistant rows), if any. */
export function lastAnchor(messages: readonly ChatMessage[]): ConversationAnchor | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const a = messages[i]?.metadata?.providerAnchor;
    if (a && messages[i]?.role === 'assistant') return { kind: a.kind, id: a.id };
  }
  return undefined;
}

/** First provider anchor recorded in `messages` (assistant rows), if any. */
export function firstAnchor(messages: readonly ChatMessage[]): ConversationAnchor | undefined {
  for (const m of messages) {
    const a = m.metadata?.providerAnchor;
    if (a && m.role === 'assistant') return { kind: a.kind, id: a.id };
  }
  return undefined;
}

/** Whether every turn in `turns` that has an assistant reply also has an anchor. */
export function turnsAreAnchored(turns: readonly ChatTurn[]): boolean {
  return turns.every(
    (t) => t.assistantMessages.length === 0 || t.assistantMessages.some((m) => m.metadata?.providerAnchor),
  );
}

// ── Synthetic seed ──────────────────────────────────────────────

/** Upper bound on the seed; older turns are dropped first. */
export const SEED_MAX_CHARS = 24_000;
const SEED_TEXT_MAX = 4_000;
const SEED_TOOL_MAX = 12;

function summariseToolCall(tc: NonNullable<ChatMessage['metadata']>['toolCalls'] extends Array<infer T> | undefined ? T : never): string {
  const args = (tc.args ?? {}) as Record<string, unknown>;
  const target =
    (typeof args['file_path'] === 'string' && args['file_path']) ||
    (typeof args['path'] === 'string' && args['path']) ||
    (typeof args['command'] === 'string' && args['command']) ||
    (typeof args['pattern'] === 'string' && args['pattern']) ||
    (typeof args['query'] === 'string' && args['query']) ||
    '';
  const op = tc.fileOp ? ` (+${tc.fileOp.additions ?? 0} −${tc.fileOp.deletions ?? 0})` : '';
  const failed = tc.success === false ? ' [failed]' : '';
  const t = target ? `: ${String(target).slice(0, 160)}` : '';
  return `${tc.tool}${t}${op}${failed}`;
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}\n…[truncated]` : t;
}

/** One turn rendered for the seed. */
function renderTurnForSeed(turn: ChatTurn): string {
  const parts: string[] = [];
  if (turn.userMessage) {
    const att = turn.userMessage.attachments?.length
      ? ` [attachments: ${turn.userMessage.attachments.map((a) => a.name).join(', ')}]`
      : '';
    parts.push(`User:${att}\n${clip(turn.userMessage.content, SEED_TEXT_MAX)}`);
  }
  for (const a of turn.assistantMessages) {
    const tools = a.metadata?.toolCalls ?? [];
    const toolLines = tools.slice(0, SEED_TOOL_MAX).map((tc) => `  - ${summariseToolCall(tc)}`);
    if (tools.length > SEED_TOOL_MAX) toolLines.push(`  - …and ${tools.length - SEED_TOOL_MAX} more tool calls`);
    const body = clip(a.content, SEED_TEXT_MAX);
    const partial = a.metadata?.partial ? ' (stopped before finishing)' : '';
    parts.push(
      `Assistant${partial}:` +
        (toolLines.length ? `\n[actions]\n${toolLines.join('\n')}` : '') +
        (body ? `\n${body}` : ''),
    );
  }
  return parts.join('\n\n');
}

/**
 * Build the digest a provider without native branching receives after a
 * synthetic rewind or fork. Empty string when there is nothing to seed.
 */
export function buildConversationSeed(messages: readonly ChatMessage[]): string {
  const turns = groupTurns(messages).filter((t) => t.userMessage || t.assistantMessages.length > 0);
  if (turns.length === 0) return '';
  const rendered = turns.map(renderTurnForSeed);
  // Keep the newest turns whole; drop from the front until it fits.
  let total = rendered.reduce((n, r) => n + r.length + 2, 0);
  let dropped = 0;
  while (total > SEED_MAX_CHARS && rendered.length > 1) {
    total -= rendered[0]!.length + 2;
    rendered.shift();
    dropped += 1;
  }
  const header =
    '[Conversation history — restored after the conversation was rewound or branched. ' +
    'This is what was said so far in this chat; treat it as your own memory and continue from here. ' +
    'Files on disk reflect the current state, not necessarily every action below.]';
  const omitted = dropped > 0 ? `\n[${dropped} earlier turn${dropped === 1 ? '' : 's'} omitted]` : '';
  return `${header}${omitted}\n\n${rendered.join('\n\n---\n\n')}\n\n[End of restored history]`;
}

/** Wrap a seed and the new prompt into one message for the provider. */
export function applyConversationSeed(seed: string, prompt: string): string {
  const s = seed.trim();
  if (!s) return prompt;
  return `${s}\n\n[New message from the user]\n${prompt}`;
}
