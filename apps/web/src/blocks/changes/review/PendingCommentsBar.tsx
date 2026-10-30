// ────────────────────────────────────────────────────────────────
// PendingCommentsBar — "N pending comments · M awaiting agent · Review & send"
// (F-dock-01 ChangesPanel; board DockChanges "Review"; D-164).
// ────────────────────────────────────────────────────────────────
//
// One line over the diff. Checking the comments, the note and the message
// preview happen in ReviewSendDialog, so the diff keeps its height.

import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';

export interface PendingCommentsBarProps {
  pendingCount: number;
  submittedCount: number;
  addressedCount: number;
  /** Opens the review dialog (comments, note, preview, send). */
  onReview: () => void;
  onDiscardAll?: () => void;
}

export function PendingCommentsBar({ pendingCount, submittedCount, addressedCount, onReview, onDiscardAll }: PendingCommentsBarProps) {
  if (pendingCount === 0 && submittedCount === 0 && addressedCount === 0) return null;

  return (
    <div className="flex h-strip shrink-0 items-center gap-2.5 border-b border-line-soft px-3 text-ui" data-testid="pending-comments-bar">
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
          {onDiscardAll ? (
            <IconButton icon="trash" size="sm" label="Discard all pending comments" onClick={onDiscardAll} />
          ) : null}
          <Button size="sm" variant="primary" icon="send" onClick={onReview} data-testid="review-open">
            Review &amp; send
          </Button>
        </div>
      ) : null}
    </div>
  );
}
