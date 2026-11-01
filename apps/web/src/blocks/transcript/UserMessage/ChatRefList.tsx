// ────────────────────────────────────────────────────────────────
// The chats attached to a sent message as context (D-179): one chip per chat,
// like a file chip, linking to it. The tooltip says what went in — the mode it
// resolved to, turns included of total — and when the snapshot was taken.
// ────────────────────────────────────────────────────────────────

import { Link as RouterLink } from 'react-router';
import { CHAT_REFERENCE_MODE_LABEL, type ChatReferenceRecord } from '@generatorai/shared';
import { cn } from '@/ui/lib/cn.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';

/** A sent message's record, or just the chat's name while the message is still being sent. */
export type ChatRefChip = ChatReferenceRecord | Pick<ChatReferenceRecord, 'chatId' | 'name'>;

function included(ref: ChatReferenceRecord): string {
  if (ref.resolvedMode === 'summary') {
    return ref.includedTurns > 0 ? `summary + last ${ref.includedTurns} of ${ref.totalTurns} turns` : `summary of ${ref.totalTurns} turns`;
  }
  return `${ref.includedTurns} of ${ref.totalTurns} turns`;
}

export function ChatRefList({ refs, className }: { refs: readonly ChatRefChip[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)} data-testid="message-chat-refs">
      {refs.map((ref) => (
        <Chip
          key={ref.chatId}
          size="sm"
          icon="message"
          data-testid="message-chat-ref"
          title={
            'asOf' in ref
              ? `${ref.name} — ${CHAT_REFERENCE_MODE_LABEL[ref.mode]}: ${included(ref)}, as of ${new Date(ref.asOf).toLocaleString()}`
              : ref.name
          }
          render={<RouterLink to={`/chats/${ref.chatId}`} />}
        >
          {ref.name}
        </Chip>
      ))}
    </div>
  );
}
