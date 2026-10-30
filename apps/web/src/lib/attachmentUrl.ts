// ────────────────────────────────────────────────────────────────
// attachmentUrl — where the web can fetch a persisted message attachment.
//
// Served through `GET /chats/:id/attachments/:artifactId`, which is why the
// chat id is needed — the artifact id alone is not a URL, and the message's
// stored `path` is a server-side disk path. Shared by the attachment chips
// and the composer's prompt history (recalled prompts re-attach their files).
// ────────────────────────────────────────────────────────────────

import type { ChatMessage } from '@generatorai/shared';

type Attachment = NonNullable<ChatMessage['attachments']>[number];

/** URL the web can fetch an attachment from, or `null` when it has none. */
export function attachmentUrl(att: Attachment, chatId: string | undefined): string | null {
  if (att.artifactId && chatId) {
    return `/api/chats/${encodeURIComponent(chatId)}/attachments/${encodeURIComponent(att.artifactId)}`;
  }
  // Legacy rows carry a URL-ish path (or a disk path, which is not fetchable).
  if (/^(https?:)?\//.test(att.path) && !/^[A-Za-z]:\\/.test(att.path)) return att.path;
  return null;
}
