// ────────────────────────────────────────────────────────────────
// ReviewBatchBar — "N pending · Send all to agent"
// ────────────────────────────────────────────────────────────────
//
// The batch is the point of the feature: a reviewer reads the whole diff,
// leaves several comments, then sends them as ONE instruction. Sending each
// comment separately would make the agent re-plan N times.

import { useState } from 'react';
import { Eye, Send, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Button, Textarea } from '@/components/ui/index.js';

export interface ReviewBatchBarProps {
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

export function ReviewBatchBar({
  pendingCount,
  submittedCount,
  addressedCount,
  busy,
  onSendAll,
  onPreview,
  onDiscardAll,
  disabledReason,
}: ReviewBatchBarProps) {
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  if (pendingCount === 0 && submittedCount === 0 && addressedCount === 0) return null;

  return (
    <div className="border-b bg-accent/30 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {pendingCount > 0 && (
          <span className="font-medium">
            {pendingCount} pending comment{pendingCount === 1 ? '' : 's'}
          </span>
        )}
        {submittedCount > 0 && (
          <span className="text-sky-500">{submittedCount} awaiting agent</span>
        )}
        {addressedCount > 0 && (
          <span className="text-emerald-500">{addressedCount} addressed</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {pendingCount > 0 && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-pressed={showNote}
                onClick={() => setShowNote((v) => !v)}
                className={cn(showNote && 'bg-subtle')}
              >
                Note
              </Button>
              {onPreview && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onPreview(note)}
                  title="See exactly what will be sent"
                  leftIcon={<Eye className="h-3 w-3" />}
                >
                  Preview
                </Button>
              )}
              {onDiscardAll && (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  onClick={onDiscardAll}
                  title="Discard all pending comments"
                  aria-label="Discard all pending comments"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!onSendAll}
                loading={busy}
                onClick={() => onSendAll?.(note)}
                title={disabledReason ?? 'Send all pending comments to the agent'}
                leftIcon={<Send className="h-3 w-3" />}
              >
                Send all
              </Button>
            </>
          )}
        </div>
      </div>

      {showNote && pendingCount > 0 && (
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Extra instruction appended after the comments (optional)"
          aria-label="Extra instruction for the agent"
          className="mt-1.5 resize-none px-2 py-1 text-xs"
        />
      )}

      {disabledReason && pendingCount > 0 && !onSendAll && (
        <p className="mt-1 text-[10px] text-muted-foreground">{disabledReason}</p>
      )}
    </div>
  );
}
