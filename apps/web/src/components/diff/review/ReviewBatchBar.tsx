// ────────────────────────────────────────────────────────────────
// ReviewBatchBar — "N pending · Send all to agent"
// ────────────────────────────────────────────────────────────────
//
// The batch is the point of the feature: a reviewer reads the whole diff,
// leaves several comments, then sends them as ONE instruction. Sending each
// comment separately would make the agent re-plan N times.

import { useState } from 'react';
import { Eye, Loader2, Send, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils.js';

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
              <button
                type="button"
                onClick={() => setShowNote((v) => !v)}
                className={cn(
                  'inline-flex h-6 items-center rounded border px-1.5 text-[10px] hover:bg-accent',
                  showNote && 'bg-accent',
                )}
              >
                Note
              </button>
              {onPreview && (
                <button
                  type="button"
                  onClick={() => onPreview(note)}
                  className="inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[10px] hover:bg-accent"
                  title="See exactly what will be sent"
                >
                  <Eye className="h-3 w-3" />
                  Preview
                </button>
              )}
              {onDiscardAll && (
                <button
                  type="button"
                  onClick={onDiscardAll}
                  className="inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[10px] hover:bg-accent"
                  title="Discard all pending comments"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                disabled={!onSendAll || busy}
                onClick={() => onSendAll?.(note)}
                title={disabledReason ?? 'Send all pending comments to the agent'}
                className="inline-flex h-6 items-center gap-1 rounded border px-2 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Send all
              </button>
            </>
          )}
        </div>
      </div>

      {showNote && pendingCount > 0 && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Extra instruction appended after the comments (optional)"
          className="mt-1.5 w-full resize-none rounded border bg-transparent px-2 py-1 text-xs"
        />
      )}

      {disabledReason && pendingCount > 0 && !onSendAll && (
        <p className="mt-1 text-[10px] text-muted-foreground">{disabledReason}</p>
      )}
    </div>
  );
}
