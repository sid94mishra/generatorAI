// ────────────────────────────────────────────────────────────────
// stageTranscript — a stage session's persisted messages → timeline items.
//
// `GET /sessions/:sessionId/chat?stageRunId=` returns the same ChatMessage
// rows a chat has, so a stage transcript renders through the chat's own
// adapter (`chatMessageToBlocks` → `deriveTimeline`) and looks identical to a
// chat — read-only, with no composer and no per-turn actions.
// ────────────────────────────────────────────────────────────────

import type { ChatMessage } from '@generatorai/client-core';

import { chatMessageToBlocks, messageWasStopped } from '../chat/timeline/chatMessageToBlocks';
import { deriveTimeline, type TimelineRow } from '../chat/timeline/deriveTimeline';

export type TranscriptItem =
  | { kind: 'user'; id: string; message: ChatMessage }
  | { kind: 'row'; id: string; row: TimelineRow };

function isMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v['id'] === 'string' && typeof v['role'] === 'string' && typeof v['content'] === 'string';
}

function epoch(message: ChatMessage): number {
  const raw = message.createdAt ?? message.timestamp;
  if (raw == null) return 0;
  const n = typeof raw === 'number' ? raw : Date.parse(String(raw));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the transcript. `live` marks the stage as still running, so the last
 * message's open tool calls spin instead of reading as finished.
 */
export function transcriptItems(raw: unknown, live: boolean): TranscriptItem[] {
  if (!Array.isArray(raw)) return [];
  const messages = raw.filter(isMessage);
  // Stable sort by time; the endpoint's order is not a documented contract.
  const ordered = messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => epoch(a.message) - epoch(b.message) || a.index - b.index)
    .map((entry) => entry.message);

  const items: TranscriptItem[] = [];
  ordered.forEach((message, index) => {
    if (message.role === 'user') {
      items.push({ kind: 'user', id: message.id, message });
      return;
    }
    if (message.role !== 'assistant') return;
    const isLast = index === ordered.length - 1;
    const rows = deriveTimeline(chatMessageToBlocks(message), {
      active: live && isLast,
      idPrefix: `${message.id}:`,
      stopped: messageWasStopped(message),
    });
    for (const row of rows) items.push({ kind: 'row', id: row.id, row });
  });
  return items;
}

/**
 * A running stage: its saved history up to and including the latest prompt,
 * then the rows streaming for that prompt. The live stream only holds the
 * current turn (a new prompt starts a fresh block list), and nothing after
 * the latest prompt is saved until the turn ends, so the two never overlap.
 */
export function withLiveRows(items: TranscriptItem[], live: TimelineRow[]): TranscriptItem[] {
  if (live.length === 0) return items;
  let lastPrompt = -1;
  items.forEach((item, index) => {
    if (item.kind === 'user') lastPrompt = index;
  });
  return [...items.slice(0, lastPrompt + 1), ...live.map((row) => ({ kind: 'row' as const, id: row.id, row }))];
}
