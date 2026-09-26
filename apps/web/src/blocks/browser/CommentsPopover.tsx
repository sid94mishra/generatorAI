// ────────────────────────────────────────────────────────────────
// CommentsPopover (F-dock-04) — the native annotate mode's comment list:
// numbered notes, per-note Send to chat / Delete, Clear, and "Send all to
// chat" once at least one note has a comment. The notes themselves are
// written inside the page (native WCV overlay); this only lists and sends.
// ────────────────────────────────────────────────────────────────

import type { AnnotationSummary } from './browserAnnotations.js';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';

export interface CommentsPopoverProps {
  items: readonly AnnotationSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sends the given keys, or every commented note when omitted. */
  onSend: (keys?: string[]) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
}

export function CommentsPopover({ items, open, onOpenChange, onSend, onRemove, onClear }: CommentsPopoverProps): React.JSX.Element {
  const count = items.length;
  return (
    <PopoverRoot open={open} onOpenChange={(next) => onOpenChange(next)}>
      <PopoverTrigger
        render={
        <Button
          variant="ghost"
          size="sm"
          icon="message"
          trailingIcon="chevron-down"
          title="Comments — view all notes and send to chat"
          aria-label={`Comments (${count})`}
          className={cn(count > 0 && 'text-run')}
        >
          Comments <span className="font-mono text-micro text-fg-3">{count}</span>
        </Button>
        }
      />
      <PopoverPopup align="start" className="w-72 p-1">
      <div className="flex items-center justify-between px-2 py-1">
        <PopoverTitle className="m-0 text-ui font-semibold text-fg">Comments {count > 0 ? `(${count})` : ''}</PopoverTitle>
        {count > 0 && (
          <Button variant="ghost" size="sm" icon="trash" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      {count === 0 ? (
        <p className="m-0 px-3 py-4 text-center text-small text-fg-3">
          Click an element or drag a region on the page to add a comment.
        </p>
      ) : (
        <ul className="m-0 flex max-h-72 list-none flex-col overflow-y-auto border-t border-line-soft p-0 py-1">
          {items.map((it) => (
            <li key={it.key} className="group flex items-start gap-2 rounded-control-sm px-2 py-1.5 hover:bg-hover">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-micro text-on-accent">
                {it.n}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-micro text-fg-2" title={it.label}>{it.label}</div>
                <div className={cn('truncate text-small', it.comment ? 'text-fg' : 'text-fg-3 italic')} title={it.comment}>
                  {it.comment || 'No comment yet'}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <IconButton
                  size="sm"
                  icon="send"
                  label="Send this comment to chat"
                  onClick={() => onSend([it.key])}
                  disabled={!it.comment}
                />
                <IconButton size="sm" icon="trash" label="Delete this comment" onClick={() => onRemove(it.key)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.some((i) => i.comment) && (
        <div className="border-t border-line-soft p-1">
          <Button variant="primary" size="sm" icon="send" fullWidth onClick={() => onSend()}>
            Send all to chat
          </Button>
        </div>
      )}
      </PopoverPopup>
    </PopoverRoot>
  );
}
