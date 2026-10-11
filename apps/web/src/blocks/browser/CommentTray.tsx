// ────────────────────────────────────────────────────────────────
// CommentTray (F-dock-04, D-140) — the browser comments, under the page.
//
//   ┌ 💬 Comments 3 ······················ Clear  Add to message  [Send to agent ⌘↵] ┐
//   │ ①  Make this button primary and say "Start free trial"     button.cta · “Get…”  🗑 │
//   │ ②  The cards overflow on narrow screens                    area 640×220         🗑 │
//   └ Click an element or drag across an area to comment · Esc to finish ─────────────┘
//
// It sits in the dock's column under the native view, never over it: an
// overlay above the WebContentsView would hide the page (D-19). A row opens
// its comment in the page (scrolled into view, card open to edit). After a
// send the tray says what happened for a moment, then goes.
// ────────────────────────────────────────────────────────────────

import type { AnnotationSummary } from './browserAnnotations.js';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Kbd } from '@/ui/primitives/Kbd/Kbd.js';
import { isMacOS } from '@/lib/desktop.js';

export interface CommentTrayProps {
  items: readonly AnnotationSummary[];
  annotating: boolean;
  sending: boolean;
  /** What the last send did ("Sent 3 comments to the agent"), shown briefly. */
  notice: string | null;
  /** Sending now is possible (a chat with a composer). */
  canSendNow: boolean;
  /** Adding to the composer is possible. */
  canAddToMessage: boolean;
  onSendNow: () => void;
  onAddToMessage: () => void;
  onOpen: (key: string) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
}

export function CommentTray({
  items, annotating, sending, notice, canSendNow, canAddToMessage, onSendNow, onAddToMessage, onOpen, onRemove, onClear,
}: CommentTrayProps): React.JSX.Element | null {
  const count = items.length;
  if (count === 0 && !annotating && !notice) return null;
  const mod = isMacOS ? '⌘' : 'Ctrl';

  return (
    <section aria-label="Browser comments" data-testid="browser-comment-tray" className="flex max-h-72 shrink-0 flex-col border-t border-line bg-surface">
      <header className="flex h-bar shrink-0 items-center gap-2 px-3">
        <Icon concept="message" size={14} className="text-fg-3" />
        <h3 className="text-ui font-semibold text-fg">Comments</h3>
        {count > 0 ? <span className="font-mono text-micro text-fg-3 tabular-nums">{count}</span> : null}
        {notice ? (
          <span role="status" className="flex min-w-0 items-center gap-1.5 truncate text-small text-ok" data-testid="browser-comment-notice">
            <Icon concept="check" size={12} className="shrink-0" />
            <span className="truncate">{notice}</span>
          </span>
        ) : null}
        <span className="flex-1" />
        {count > 0 ? (
          <>
            <Button variant="ghost" size="sm" onClick={onClear} disabled={sending}>
              Clear
            </Button>
            {canAddToMessage ? (
              <Button size="sm" onClick={onAddToMessage} disabled={sending} data-testid="browser-comments-add">
                Add to message
              </Button>
            ) : null}
            {canSendNow ? (
              <Button
                variant="primary"
                size="sm"
                icon="send"
                loading={sending}
                onClick={onSendNow}
                shortcut={[mod, '↵']}
                data-testid="browser-comments-send"
              >
                Send to agent
              </Button>
            ) : null}
          </>
        ) : null}
      </header>

      {count > 0 ? (
        <ol className="m-0 flex min-h-0 list-none flex-col overflow-y-auto border-t border-line-soft p-1" data-testid="browser-comment-list">
          {items.map((it) => (
            <li key={it.key} className="group flex items-start gap-2 rounded-control px-2 py-1.5 hover:bg-hover">
              <span
                aria-hidden
                className="mt-0.5 flex min-w-4.5 shrink-0 py-px items-center justify-center rounded-badge bg-run-bg px-1 font-mono text-micro font-semibold text-run tabular-nums"
              >
                {it.n}
              </span>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onOpen(it.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(it.key);
                  }
                }}
                title="Show on the page and edit"
                aria-label={`Comment ${it.n}: ${it.comment}. Show on the page`}
                className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-control-sm focus-ring"
                data-testid="browser-comment-row"
              >
                <span className="line-clamp-2 text-ui text-fg">{it.comment}</span>
                <span className="truncate font-mono text-micro text-fg-3">
                  {it.label}
                  {it.text ? <span className="font-sans"> · “{it.text}”</span> : null}
                </span>
              </div>
              <IconButton
                size="sm"
                icon="trash"
                label={`Delete comment ${it.n}`}
                onClick={() => onRemove(it.key)}
                className={cn('opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
              />
            </li>
          ))}
        </ol>
      ) : null}

      {annotating ? (
        <p className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-line-soft px-3 py-2 text-small text-fg-3">
          <Icon concept="pointer" size={12} className="text-run" />
          Click an element or drag across an area to comment.
          <span className="inline-flex items-center gap-1"><Kbd keys="↵" /> adds</span>
          <span className="inline-flex items-center gap-1"><Kbd keys={[mod, '↵']} /> adds and sends</span>
          <span className="inline-flex items-center gap-1"><Kbd keys="Esc" /> finishes</span>
        </p>
      ) : null}
    </section>
  );
}
