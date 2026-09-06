// ────────────────────────────────────────────────────────────────
// AttachmentChips — the files on a persisted chat message.
//
// One chip per attachment. Image attachments show the picture on hover
// (ImageHoverPreview) and open in a new tab; everything else is a plain
// download link. Served through `GET /chats/:id/attachments/:artifactId`,
// which is why a chip needs the chat id — the artifact id alone is not a
// URL, and the message's stored `path` is a server-side disk path.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Paperclip, Image as ImageIcon, Download } from 'lucide-react';
import type { ChatMessage } from '@generatorai/shared';
import { ImageHoverPreview, isPreviewableImage } from '@/components/shared/ImageHoverPreview.js';
import { cn } from '@/lib/utils.js';

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

export function AttachmentChips({
  attachments,
  chatId,
  className,
  download = false,
}: {
  attachments: Attachment[];
  chatId: string | undefined;
  className?: string;
  /** Render non-image chips as download links (assistant artifacts). */
  download?: boolean;
}) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)} data-testid="message-attachments">
      {attachments.map((att, i) => {
        const url = attachmentUrl(att, chatId);
        const image = isPreviewableImage(att.mimeType, att.name);
        const Icon = image ? ImageIcon : download ? Download : Paperclip;
        const chipClass = cn(
          'inline-flex max-w-[240px] items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
          'border-[var(--color-primary)]/20 bg-[var(--color-primary)]/[0.07] text-[var(--color-primary)]',
          url && 'hover:bg-[var(--color-primary)]/[0.14]',
        );
        const body = (
          <>
            <Icon className="h-3 w-3 shrink-0" />
            <span className="truncate">{att.name}</span>
          </>
        );
        const chip = url ? (
          <a
            key={i}
            href={url}
            target={image ? '_blank' : undefined}
            rel={image ? 'noreferrer' : undefined}
            download={!image && download ? att.name : undefined}
            className={chipClass}
            title={att.name}
            data-testid="message-attachment"
          >
            {body}
          </a>
        ) : (
          <span key={i} className={chipClass} title={att.name} data-testid="message-attachment">
            {body}
          </span>
        );
        return image && url ? (
          <ImageHoverPreview key={i} src={url} alt={att.name}>
            {chip}
          </ImageHoverPreview>
        ) : (
          chip
        );
      })}
    </div>
  );
}
