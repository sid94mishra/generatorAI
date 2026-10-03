// ────────────────────────────────────────────────────────────────
// Transcript turns (03-domain §2.4 B-24; 09 §8.2; G-06).
//
// The transcript is a column of TURNS: a user message and the agent's
// response(s) to it. A turn is the unit the view virtualizes and collapses,
// the unit Summary mode condenses, and the unit transcript find reveals.
//
// This module is React-free: it folds persisted messages (and the live turn,
// when there is one) into turns, derives each view mode's shape and builds
// the plain-text index app-level find searches (Chromium's find cannot see
// rows a virtualized list has not rendered — D-33).
// ────────────────────────────────────────────────────────────────

import type { ChatMessage } from '@generatorai/shared';
import type { TranscriptTurnMessage } from './messageInput.js';
import type { StreamBlock } from '../stream/types.js';
import { chatMessageToBlocks } from './chatMessageToBlocks.js';
import { deriveSegments, deriveTimeline } from './deriveTimeline.js';
import type { TimelineStep } from './types.js';

/** A persisted row of the transcript, or the live turn's parts. */
export type TranscriptEntry<M extends TranscriptTurnMessage = ChatMessage> =
  | { kind: 'user'; key: string; message: M }
  | { kind: 'agent'; key: string; message: M }
  | { kind: 'system'; key: string; message: M }
  /** The optimistic bubble of the turn being streamed (not persisted yet). */
  | { kind: 'pending_user'; key: string; content: string }
  /** The live stream of the current turn (its blocks live in the stream store). */
  | { kind: 'live'; key: string };

export interface TranscriptTurn<M extends TranscriptTurnMessage = ChatMessage> {
  /** Stable React / virtualizer key: the first entry's key. */
  key: string;
  entries: TranscriptEntry<M>[];
  /** True for the turn holding the live stream. */
  live: boolean;
}

export interface BuildTurnsOptions {
  /** Text of the optimistic user bubble for the turn being streamed. */
  pendingUserText?: string | null;
  /** Whether the live stream renders (blocks, a stopped note, a thinking placeholder …). */
  live?: boolean;
}

/**
 * Fold messages into turns. A user message opens a turn; everything after it
 * (assistant responses, legacy `tool` rows, system notes) belongs to it. Rows
 * before the first user message form a leading turn of their own.
 *
 * The live turn: an optimistic bubble opens a new turn that the live stream
 * joins; without one (widgets or a settled commit card that outlive the turn),
 * the live stream joins the last turn.
 */
export function buildTranscriptTurns(messages: readonly ChatMessage[], opts?: BuildTurnsOptions): TranscriptTurn[];
export function buildTranscriptTurns<M extends TranscriptTurnMessage>(messages: readonly M[], opts?: BuildTurnsOptions): TranscriptTurn<M>[];
export function buildTranscriptTurns<M extends TranscriptTurnMessage>(messages: readonly M[], opts: BuildTurnsOptions = {}): TranscriptTurn<M>[] {
  const turns: TranscriptTurn<M>[] = [];
  let current: TranscriptTurn<M> | null = null;
  const open = (entry: TranscriptEntry<M>) => {
    current = { key: entry.key, entries: [entry], live: false };
    turns.push(current);
  };
  for (const message of messages) {
    if (!isShown(message)) continue;
    if (message.role === 'user') {
      open({ kind: 'user', key: message.id, message });
      continue;
    }
    const entry: TranscriptEntry<M> =
      message.role === 'system'
        ? { kind: 'system', key: message.id, message }
        : { kind: 'agent', key: message.id, message };
    if (current) (current as TranscriptTurn<M>).entries.push(entry);
    else open(entry);
  }
  const pendingText = opts.pendingUserText;
  if (pendingText != null) {
    open({ kind: 'pending_user', key: 'pending-user', content: pendingText });
  }
  if (opts.live) {
    const liveEntry: TranscriptEntry<M> = { kind: 'live', key: 'live-turn' };
    const last = turns[turns.length - 1];
    if (last) {
      last.entries.push(liveEntry);
      last.live = true;
    } else {
      turns.push({ key: liveEntry.key, entries: [liveEntry], live: true });
    }
  }
  return turns;
}

/** User rows need text or attachments; agent rows need renderable content; system notes always show. */
function isShown(message: TranscriptTurnMessage): boolean {
  if (message.role === 'system') return true;
  if (message.role === 'user') return Boolean(message.content?.trim() || message.attachments?.length);
  return hasRenderableContent(message);
}

/**
 * The stream blocks of a persisted non-user message. Legacy `tool` rows (the
 * old harness replay path) become one completed tool call, so they render as a
 * step like every other tool call.
 */
export function messageBlocks(message: ChatMessage): StreamBlock[] {
  if (message.role === 'tool') {
    return [
      {
        type: 'tool_call',
        blockId: 0,
        callId: `legacy-tool-${message.id}`,
        tool: message.toolName ?? 'tool',
        args: message.toolArgs,
        ...(message.toolResult !== undefined ? { result: message.toolResult } : {}),
        status: 'complete',
      },
    ];
  }
  return chatMessageToBlocks(message);
}

/** Does this persisted assistant message have anything to show? (thinking/tools/cards/partial count, not only prose) */
export function hasRenderableContent(message: ChatMessage): boolean;
export function hasRenderableContent(message: TranscriptTurnMessage): boolean;
export function hasRenderableContent(message: TranscriptTurnMessage): boolean {
  if (message.role === 'tool') return true;
  if (message.content?.trim()) return true;
  const meta = message.metadata;
  if (!meta) return false;
  if (message.role === 'assistant' && meta.partial) return true;
  return Boolean(
    meta.thinkingText?.trim() ||
      meta.toolCalls?.length ||
      meta.planCards?.length ||
      meta.questionCards?.length ||
      meta.permissionCards?.length ||
      meta.widgetInstanceIds?.length ||
      meta.systemMessages?.length ||
      meta.textSegments?.length,
  );
}

// ── View modes (G-06, client-only) ───────────────────────────────

/** One line that stands for a whole agent response in Summary mode and on a collapsed turn. */
export interface TurnDigest {
  /** Tool-call and worker steps (the rail's rows), nested ones included. */
  steps: number;
  /** Aggregate +/− over file ops. */
  additions: number;
  deletions: number;
  /** Steps that failed. */
  failed: number;
  /** The response's last answer segment — what Summary mode shows. */
  finalText: string;
  /** Wall-clock duration when known (live turns report it through usage). */
  durationMs?: number;
}

function countSteps(steps: readonly TimelineStep[], acc: { steps: number; failed: number }): void {
  for (const s of steps) {
    if (s.kind !== 'note' && s.kind !== 'think') {
      acc.steps += 1;
      if (s.status === 'failed') acc.failed += 1;
    }
    if (s.children) countSteps(s.children, acc);
  }
}

/** Tool-call and worker steps in a timeline (nested ones included), as the digest counts them. */
export function countTimelineSteps(steps: readonly TimelineStep[]): { steps: number; failed: number } {
  const acc = { steps: 0, failed: 0 };
  countSteps(steps, acc);
  return acc;
}

/** Digest of one response's blocks (Summary mode; the collapsed-turn header). */
export function digestBlocks(blocks: readonly StreamBlock[] | undefined, durationMs?: number): TurnDigest {
  const list = blocks ? [...blocks] : [];
  const acc = { steps: 0, failed: 0 };
  countSteps(deriveTimeline(list, { active: false }), acc);
  let additions = 0;
  let deletions = 0;
  for (const b of list) {
    if (b.type === 'tool_call' && b.fileOp) {
      additions += b.fileOp.additions;
      deletions += b.fileOp.deletions;
    }
  }
  const segments = deriveSegments(list, { active: false });
  let finalText = '';
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i]!;
    if (seg.type === 'answer') {
      finalText = seg.text;
      break;
    }
  }
  return {
    steps: acc.steps,
    additions,
    deletions,
    failed: acc.failed,
    finalText,
    ...(durationMs != null ? { durationMs } : {}),
  };
}

/** "6 steps · 2m 44s · +14 −6" — only the parts that are known. */
export function formatDigest(digest: TurnDigest, formatDuration: (ms?: number) => string | null): string {
  const parts = [`${digest.steps} step${digest.steps === 1 ? '' : 's'}`];
  const duration = formatDuration(digest.durationMs);
  if (duration) parts.push(duration);
  if (digest.additions > 0 || digest.deletions > 0) parts.push(`+${digest.additions} −${digest.deletions}`);
  if (digest.failed > 0) parts.push(`${digest.failed} failed`);
  return parts.join(' · ');
}

// ── App-level find (D-33) ────────────────────────────────────────

/** The searchable text of a persisted turn: what the reader sees, not the raw tool payloads. */
export function turnSearchText(turn: TranscriptTurn): string {
  const parts: string[] = [];
  for (const entry of turn.entries) {
    if (entry.kind === 'pending_user') parts.push(entry.content);
    else if (entry.kind === 'user' || entry.kind === 'system') parts.push(entry.message.content ?? '');
    else if (entry.kind === 'agent') parts.push(blocksSearchText(messageBlocks(entry.message)));
  }
  return parts.join('\n');
}

/** Searchable text of a block list: prose, step verbs + targets, card titles and questions. */
export function blocksSearchText(blocks: readonly StreamBlock[]): string {
  const parts: string[] = [];
  const walk = (steps: readonly TimelineStep[]) => {
    for (const s of steps) {
      parts.push(`${s.verb} ${s.target}`);
      if (s.children) walk(s.children);
    }
  };
  for (const seg of deriveSegments([...blocks], { active: false })) {
    switch (seg.type) {
      case 'answer':
        parts.push(seg.text);
        break;
      case 'steps':
        walk(seg.steps);
        break;
      case 'plan':
        parts.push(seg.plan.title, seg.plan.summary);
        break;
      case 'question':
        for (const q of seg.question.questions) parts.push(q.header, q.question, ...q.options.map((o) => o.label));
        break;
      case 'permission':
        parts.push(seg.permission.toolName, seg.permission.description, seg.permission.inputSummary);
        break;
      case 'thinking':
      case 'widget':
      case 'scm_result':
        break;
    }
  }
  return parts.join('\n');
}

/** One turn that contains the query, with how many times. */
export interface FindHit {
  turn: number;
  occurrences: number;
}

/** Case-insensitive occurrences of `query` per turn text, in turn order. Empty query → no hits. */
export function findInTexts(texts: readonly string[], query: string): FindHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: FindHit[] = [];
  texts.forEach((text, turn) => {
    const hay = text.toLowerCase();
    let occurrences = 0;
    let at = hay.indexOf(q);
    while (at !== -1) {
      occurrences += 1;
      at = hay.indexOf(q, at + q.length);
    }
    if (occurrences > 0) hits.push({ turn, occurrences });
  });
  return hits;
}
