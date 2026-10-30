// ────────────────────────────────────────────────────────────────
// Chat ingest (mobile MG-09, M9-08): "Send to agent" from the OS share sheet.
//
// One request carries the target (an existing chat or a new one), an optional
// note, shared text / a URL and up to CHAT_INGEST_MAX_FILES attachments, so a
// share survives being sent once: the server creates the chat (when asked)
// and sends the prompt in the same call. `POST /api/chats/ingest`, multipart,
// `Idempotency-Key` required — a retried share replays instead of sending
// twice. The URL is sent as text; the server never fetches it.
// ────────────────────────────────────────────────────────────────

/** Same limits as `POST /chats/:id/prompt`. */
export const CHAT_INGEST_MAX_FILES = 5;
export const CHAT_INGEST_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CHAT_INGEST_MAX_TEXT = 100_000;

/** The `target` part (JSON): an existing chat, or a new one with optional name / project / agent / model. */
export type ChatIngestTarget =
  | { chatId: string }
  | { newChat: { name?: string; projectId?: string; agentRef?: string; model?: string } };

/** `201` body. `created` is true when this request made the chat. */
export interface ChatIngestResult {
  chatId: string;
  created: boolean;
}

/** One request's content (the client builds the multipart body from it). */
export interface ChatIngestInput {
  target: ChatIngestTarget;
  note?: string;
  text?: string;
  url?: string;
  attachments?: Array<{ name: string; data: Uint8Array; mimeType?: string }>;
}

/**
 * The prompt the agent receives: the note, then the shared text, then the URL; with nothing textual, a line naming
 * the shared files. Empty when there is nothing at all (the request is refused).
 */
export function chatIngestPrompt(parts: { note?: string; text?: string; url?: string; fileNames?: readonly string[] }): string {
  const blocks = [parts.note, parts.text, parts.url].map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  if (blocks.length) return blocks.join('\n\n');
  const names = parts.fileNames ?? [];
  if (!names.length) return '';
  return names.length === 1 ? `Shared file: ${names[0]}` : `Shared files: ${names.join(', ')}`;
}

/** The name of a chat created by a share when none is given: the first line of the prompt, shortened. */
export function chatIngestName(prompt: string): string {
  const line = prompt.split('\n').find((l) => l.trim())?.trim() ?? 'Shared';
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}
