// ────────────────────────────────────────────────────────────────
// The files on a persisted message (B-14 attachment chips). Images open in a
// new tab and preview in a tooltip; other files are links (downloads for the
// agent's artifacts). Served through `GET /chats/:id/attachments/:artifactId`
// — the stored `path` is a server disk path, not a URL.
// ────────────────────────────────────────────────────────────────

import type { ChatMessage } from '@generatorai/shared';
import { attachmentUrl } from '@/lib/attachmentUrl.js';
import { cn } from '@/ui/lib/cn.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Tooltip } from '@/ui/primitives/Tooltip/Tooltip.js';

type Attachment = NonNullable<ChatMessage['attachments']>[number];

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

function isImage(att: Attachment): boolean {
  return att.mimeType.startsWith('image/') || IMAGE_EXT.test(att.name);
}

export interface AttachmentListProps {
  attachments: readonly Attachment[];
  chatId: string | undefined;
  /** Non-image files download (the agent's artifacts) instead of opening. */
  download?: boolean;
  className?: string;
}

/** One chip per attachment. */
export function AttachmentList({ attachments, chatId, download = false, className }: AttachmentListProps) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)} data-testid="message-attachments">
      {attachments.map((att, i) => {
        const url = attachmentUrl(att, chatId);
        const image = isImage(att);
        const icon = image ? 'image' : download ? 'download' : 'file';
        if (!url) {
          return (
            <Chip key={i} size="sm" icon={icon} title={att.name} data-testid="message-attachment">
              {att.name}
            </Chip>
          );
        }
        const chip = (
          <Chip
            key={i}
            size="sm"
            icon={icon}
            title={att.name}
            data-testid="message-attachment"
            render={
              <a
                href={url}
                {...(image ? { target: '_blank', rel: 'noreferrer' } : {})}
                {...(!image && download ? { download: att.name } : {})}
              />
            }
          >
            {att.name}
          </Chip>
        );
        return image ? (
          <Tooltip key={i} content={<img src={url} alt={att.name} className="max-h-60 max-w-80 rounded-control" />}>
            {chip}
          </Tooltip>
        ) : (
          chip
        );
      })}
    </div>
  );
}
