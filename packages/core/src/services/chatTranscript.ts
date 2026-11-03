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

import type { ChatMessage, PlanCardSummary, QuestionCardSummary } from '@generatorai/shared';
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
export const SEED_MAX_CHARS = 100_000;
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
export function renderTurnForSeed(turn: ChatTurn): string {
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
    // A chat moved between providers: the new one was asked "which model did what" and could only say "not recorded".
    const by = [a.metadata?.model, a.metadata?.provider].filter((v): v is string => typeof v === 'string' && v.length > 0);
    parts.push(
      `Assistant${by.length ? ` [${by.join(' · ')}]` : ''}${partial}:` +
        (toolLines.length ? `\n[actions]\n${toolLines.join('\n')}` : '') +
        (body ? `\n${body}` : ''),
    );
  }
  return parts.join('\n\n');
}

// The seed is what a fresh provider session knows of the chat, so the newest turns go in whole — every
// text the agent wrote between its actions, each action with the start of what it returned, the plans it
// proposed and the answers the user gave — and older ones as the compact digest above. Past the budget the
// oldest turns shrink to their prompt, then go.
const SEED_DETAILED_TURNS = 4;
const SEED_DETAIL_TEXT_MAX = 8_000;
const SEED_RESULT_MAX = 1_500;
const SEED_DETAIL_TOOL_MAX = 40;
const SEED_PROMPT_LINE_MAX = 200;

type SeedToolCall = NonNullable<NonNullable<ChatMessage['metadata']>['toolCalls']>[number];

/** What a tool returned, as text: providers hand back strings, content blocks or objects. */
function resultText(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    const texts = result
      .map((r) => (typeof r === 'string' ? r : r && typeof r === 'object' && typeof (r as { text?: unknown }).text === 'string' ? (r as { text: string }).text : ''))
      .filter(Boolean);
    return texts.length ? texts.join('\n') : JSON.stringify(result);
  }
  if (typeof result === 'object') {
    const o = result as Record<string, unknown>;
    for (const key of ['content', 'output', 'stdout', 'text', 'result']) {
      if (typeof o[key] === 'string') return o[key];
    }
    return JSON.stringify(result);
  }
  return String(result);
}

function renderToolInDetail(tc: SeedToolCall): string {
  const out = resultText(tc.result).trim();
  if (!out) return `- ${summariseToolCall(tc)}`;
  const excerpt = out.length > SEED_RESULT_MAX ? `${out.slice(0, SEED_RESULT_MAX)}\n…[output truncated]` : out;
  return `- ${summariseToolCall(tc)}\n  output:\n${excerpt.replace(/^/gm, '    ')}`;
}

function renderQuestions(card: QuestionCardSummary): string {
  const lines = card.questions.map((q) => {
    const picked = card.response?.answers?.[q.id];
    const answer = picked?.length ? picked.join(', ') : card.status === 'answered' ? '(no choice)' : '(not answered)';
    return `- ${q.question} → ${answer}`;
  });
  if (card.response?.freeformResponse) lines.push(`- The user replied instead: ${clip(card.response.freeformResponse, 1_000)}`);
  return `[asked the user]\n${lines.join('\n')}`;
}

function renderPlan(card: PlanCardSummary): string {
  const notes = (card.notes ?? []).map((n) => `\n  ${n.decision === 'approved' ? 'Approved' : 'Changes requested'}: ${clip(n.text, 1_000)}`);
  return `[plan: ${card.title} — ${card.status}]\n${clip(card.summary, 2_000)}${notes.join('')}`;
}

/** One reply in full: its texts, actions (with output), plans and questions in the order they happened. */
function renderReplyInDetail(a: ChatMessage): string {
  const meta = a.metadata ?? {};
  const items: Array<{ seq: number; order: number; text: string }> = [];
  const push = (seq: number | undefined, text: string) => {
    if (text.trim()) items.push({ seq: seq ?? Number.MAX_SAFE_INTEGER, order: items.length, text });
  };
  const segments = meta.textSegments ?? [];
  for (const seg of segments) push(seg.sequence, clip(seg.content, SEED_DETAIL_TEXT_MAX));
  const tools = meta.toolCalls ?? [];
  for (const tc of tools.slice(0, SEED_DETAIL_TOOL_MAX)) push(tc.sequence, renderToolInDetail(tc));
  if (tools.length > SEED_DETAIL_TOOL_MAX) push(undefined, `- …and ${tools.length - SEED_DETAIL_TOOL_MAX} more tool calls`);
  for (const card of meta.planCards ?? []) push(card.sequence, renderPlan(card));
  for (const card of meta.questionCards ?? []) push(card.sequence, renderQuestions(card));
  // Rows written before every text segment was kept carry only the final answer.
  if (segments.length === 0) push(undefined, clip(a.content, SEED_DETAIL_TEXT_MAX));
  items.sort((x, y) => x.seq - y.seq || x.order - y.order);
  const by = [meta.model, meta.provider].filter((v): v is string => typeof v === 'string' && v.length > 0);
  const partial = meta.partial ? ' (stopped before finishing)' : '';
  return `Assistant${by.length ? ` [${by.join(' · ')}]` : ''}${partial}:\n${items.map((i) => i.text).join('\n')}`;
}

/** One turn as the seed's newest turns are given: in full. */
export function renderTurnInDetail(turn: ChatTurn): string {
  const parts: string[] = [];
  if (turn.userMessage) {
    const att = turn.userMessage.attachments?.length
      ? ` [attachments: ${turn.userMessage.attachments.map((a) => a.name).join(', ')}]`
      : '';
    parts.push(`User:${att}\n${clip(turn.userMessage.content, SEED_DETAIL_TEXT_MAX)}`);
  }
  for (const a of turn.assistantMessages) parts.push(renderReplyInDetail(a));
  return parts.join('\n\n');
}

function promptLine(turn: ChatTurn): string {
  const text = (turn.userMessage?.content ?? '').replace(/\s+/g, ' ').trim();
  return `- ${text.length > SEED_PROMPT_LINE_MAX ? `${text.slice(0, SEED_PROMPT_LINE_MAX)}…` : text || '(no prompt)'}`;
}

export interface ConversationSeedOptions {
  /**
   * The provider resumes its own session, which remembers the chat up to its last reply: the seed is only what
   * was said since (by another model), and says so.
   */
  since?: boolean;
}

/**
 * Build the digest a fresh provider session receives — after a synthetic rewind or fork, or when the chat
 * moved to another provider. Empty string when there is nothing to seed.
 */
export function buildConversationSeed(messages: readonly ChatMessage[], options: ConversationSeedOptions = {}): string {
  const turns = groupTurns(messages).filter((t) => t.userMessage || t.assistantMessages.length > 0);
  if (turns.length === 0) return '';
  const n = turns.length;
  const full = turns.map((t, i) => (i >= n - SEED_DETAILED_TURNS ? renderTurnInDetail(t) : renderTurnForSeed(t)));
  const brief = turns.map((t, i) => (i >= n - SEED_DETAILED_TURNS ? renderTurnForSeed(t) : full[i]!));
  const rendered = [...full];
  const cost = (r: string) => (r ? r.length + 7 : 0);
  let size = rendered.reduce((total, r) => total + cost(r), 0);
  const replace = (i: number, text: string) => {
    size += cost(text) - cost(rendered[i]!);
    rendered[i] = text;
  };
  // Over budget: the oldest detailed turns become digests, the oldest digests become their prompt, the
  // oldest prompts go — and the newest turn always stays.
  for (let i = Math.max(0, n - SEED_DETAILED_TURNS); i < n - 1 && size > SEED_MAX_CHARS; i += 1) replace(i, brief[i]!);
  let indexed = 0;
  while (size > SEED_MAX_CHARS && indexed < n - 1) {
    replace(indexed, promptLine(turns[indexed]!));
    indexed += 1;
  }
  let dropped = 0;
  while (size > SEED_MAX_CHARS && dropped < indexed) {
    replace(dropped, '');
    dropped += 1;
  }
  const index = rendered.slice(dropped, indexed);
  const body = rendered.slice(indexed);
  const header = options.since
    ? '[While you were away — this chat went on with another model. You still remember the chat up to your own last reply; ' +
      'this is what was said after it, so treat it as part of the same conversation and continue from here. ' +
      'Files on disk reflect the current state, not necessarily every action below.]'
    : '[Conversation history — this chat continues in a fresh agent session (it was rewound, branched, or moved to another model provider). ' +
      'This is what was said so far in this chat; treat it as your own memory and continue from here. ' +
      'Files on disk reflect the current state, not necessarily every action below.]';
  const omitted = dropped > 0 ? `\n[${dropped} earlier turn${dropped === 1 ? '' : 's'} omitted]` : '';
  const earlier = index.length ? `\n\n[Earlier turns — the user's prompts only]\n${index.join('\n')}` : '';
  return `${header}${omitted}${earlier}\n\n${body.join('\n\n---\n\n')}\n\n[End of restored history]`;
}

/** Wrap a seed and the new prompt into one message for the provider. */
export function applyConversationSeed(seed: string, prompt: string): string {
  const s = seed.trim();
  if (!s) return prompt;
  return `${s}\n\n[New message from the user]\n${prompt}`;
}

/** How much of an interrupted reply goes back to the agent: its tail is what it continues from. */
const INTERRUPTED_REPLY_MAX_CHARS = 8_000;

/**
 * When the chat's last reply was cut off before it finished (`metadata.partial`) and nothing has been said since,
 * the notice that tells the agent what it had written (E-5); otherwise ''.
 */
export function interruptedReplyNotice(messages: readonly ChatMessage[]): string {
  let last = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') {
      last = i;
      break;
    }
  }
  if (last < 0) return '';
  const reply = messages[last]!;
  // The prompt being sent may already be saved; any earlier user message means a later turn answered already.
  if (messages.slice(last + 1).filter((m) => m.role === 'user').length > 1) return '';
  const text = typeof reply.content === 'string' ? reply.content.trim() : '';
  if (!(reply.metadata as { partial?: boolean } | undefined)?.partial || !text) return '';
  const shown = text.length > INTERRUPTED_REPLY_MAX_CHARS ? `…${text.slice(-INTERRUPTED_REPLY_MAX_CHARS)}` : text;
  return `[Your previous reply was cut off before it finished. The user saw this much of it:]\n${shown}\n[End of the interrupted reply]\n\n`;
}
