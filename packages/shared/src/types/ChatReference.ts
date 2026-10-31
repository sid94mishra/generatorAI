// ────────────────────────────────────────────────────────────────
// Chat references (D-179) — one chat attached to another chat's message as
// quoted context, like a file. The composer sends `{chatId, mode}`; the
// server renders the referenced thread at send time (a snapshot) and keeps a
// `ChatReferenceRecord` on the user message so the transcript shows a chip,
// never the rendered text.
// ────────────────────────────────────────────────────────────────

/**
 * How much of the referenced chat goes in:
 *   auto     the whole thread when it fits, else a summary plus the last turns
 *   summary  a summary of the whole thread
 *   recent   the last few turns
 *   full     the whole thread, oldest turns dropped past the cap (said so)
 */
export type ChatReferenceMode = 'auto' | 'summary' | 'recent' | 'full';

export const CHAT_REFERENCE_MODES: readonly ChatReferenceMode[] = ['auto', 'summary', 'recent', 'full'];

/** At most this many chats per message. */
export const MAX_CHAT_REFERENCES = 5;

/** What the composer sends. */
export interface ChatReferenceInput {
  chatId: string;
  mode: ChatReferenceMode;
}

/** What the user message keeps (the transcript chip). */
export interface ChatReferenceRecord {
  chatId: string;
  /** The chat's name when it was attached. */
  name: string;
  /** The mode asked for. */
  mode: ChatReferenceMode;
  /** What `auto` resolved to (`full` or `summary`); the asked mode otherwise. */
  resolvedMode: Exclude<ChatReferenceMode, 'auto'>;
  /** Turns included verbatim. */
  includedTurns: number;
  totalTurns: number;
  /** Characters of the rendered reference. */
  chars: number;
  /** ISO time of the snapshot. */
  asOf: string;
}

/** `GET /chats/:id/reference-preview` — what attaching this chat would include. */
export interface ChatReferencePreview {
  chatId: string;
  name: string;
  mode: ChatReferenceMode;
  resolvedMode: Exclude<ChatReferenceMode, 'auto'>;
  includedTurns: number;
  totalTurns: number;
  chars: number;
  /** Rough tokens (chars / 4). */
  tokens: number;
}

/** Display word for a mode (pill and popover). */
export const CHAT_REFERENCE_MODE_LABEL: Record<ChatReferenceMode, string> = {
  auto: 'Auto',
  summary: 'Summary',
  recent: 'Recent',
  full: 'Full',
};
