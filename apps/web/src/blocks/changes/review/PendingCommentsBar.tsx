// ────────────────────────────────────────────────────────────────
// PendingCommentsBar — "N pending comments · Note · Preview · Send all"
// (F-dock-01 ChangesPanel; board DockChanges "Review").
// ────────────────────────────────────────────────────────────────
//
// The batch is the point of the feature: a reviewer reads the whole diff,
// leaves several comments, then sends them as ONE instruction. Sending each
// comment separately would make the agent re-plan N times.

import { useState } from 'react';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { Reveal } from '@/ui/primitives/Collapsible/Collapsible.js';

export interface PendingCommentsBarProps {
  pendingCount: number;
  submittedCount: number;
  addressedCount: number;
  busy?: boolean;
  /** Undefined when there is nowhere to send (e.g. a finished run). */
  onSendAll?: (note: string) => void;
  onPreview?: (note: string) => void;
  onDiscardAll?: () => void;
  /** Explains why sending is unavailable. */
  disabledReason?: string;
}

export function PendingCommentsBar({
  pendingCount,
  submittedCount,
  addressedCount,
  busy,
  onSendAll,
  onPreview,
  onDiscardAll,
  disabledReason,
}: PendingCommentsBarProps) {
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  if (pendingCount === 0 && submittedCount === 0 && addressedCount === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 border-b border-line-soft px-3 py-1.5">
      <div className="flex min-h-control flex-wrap items-center gap-x-2.5 gap-y-1 text-ui">
        <Icon concept="message" size={14} className="text-fg-3" />
        {pendingCount > 0 ? (
          <span className="font-medium text-fg">
            {pendingCount} pending comment{pendingCount === 1 ? '' : 's'}
          </span>
        ) : null}
        {submittedCount > 0 ? <span className="text-small text-run">{submittedCount} awaiting agent</span> : null}
        {addressedCount > 0 ? <span className="text-small text-ok">{addressedCount} addressed</span> : null}

        {pendingCount > 0 ? (
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" pressed={showNote} onClick={() => setShowNote((v) => !v)}>
              Note
            </Button>
            {onPreview ? (
              <Button
                variant="ghost"
                size="sm"
                icon="view"
                title="See exactly what will be sent"
                onClick={() => onPreview(note)}
              >
                Preview
              </Button>
            ) : null}
            {onDiscardAll ? (
              <IconButton icon="trash" size="sm" label="Discard all pending comments" onClick={onDiscardAll} />
            ) : null}
            <Button
              size="sm"
              icon="send"
              disabled={!onSendAll}
              loading={busy}
              title={disabledReason ?? 'Send all pending comments to the agent'}
              onClick={() => onSendAll?.(note)}
            >
              Send all
            </Button>
          </div>
        ) : null}
      </div>

      <Reveal open={showNote && pendingCount > 0} gap={1.5}>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autosize={{ minRows: 2, maxRows: 6 }}
          placeholder="Extra instruction appended after the comments (optional)"
          aria-label="Extra instruction for the agent"
        />
      </Reveal>

      {disabledReason && pendingCount > 0 && !onSendAll ? (
        <p className="m-0 text-small text-fg-3">{disabledReason}</p>
      ) : null}
    </div>
  );
}
