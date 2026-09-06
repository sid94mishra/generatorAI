// ────────────────────────────────────────────────────────────────
// ComposerMenu — presentational popover for the `/` command palette
// and the `@` file picker. Keyboard state (active index) is owned by
// the parent (ChatInput); this component only renders + reports intent.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/index.js';

export interface ComposerMenuItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: string;
}

interface ComposerMenuProps {
  open: boolean;
  items: ComposerMenuItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
  header?: string;
  emptyLabel?: string;
  /** Loading spinner row (e.g. while the file index is fetching). */
  loading?: boolean;
}

export function ComposerMenu({
  open,
  items,
  activeIndex,
  onSelect,
  onHover,
  header,
  emptyLabel = 'No matches',
  loading = false,
}: ComposerMenuProps): React.JSX.Element | null {
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Keep the highlighted row in view as the user arrows through the list.
  useEffect(() => {
    if (!open) return;
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  if (!open) return null;

  return (
    <div
      className="absolute bottom-full left-0 z-50 mb-2 w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-xl animate-in fade-in slide-in-from-bottom-1 duration-150"
      // Prevent the textarea from losing focus when clicking a row.
      onMouseDown={(e) => e.preventDefault()}
    >
      {header && (
        <div className="border-b border-[var(--color-border)]/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
          {header}
        </div>
      )}
      <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
        {loading ? (
          <div className="px-3 py-3 text-xs text-[var(--color-muted-foreground)]">Loading…</div>
        ) : items.length === 0 ? (
          <div className="px-3 py-3 text-xs text-[var(--color-muted-foreground)]">{emptyLabel}</div>
        ) : (
          items.map((item, i) => (
            <Button
              key={item.id}
              ref={i === activeIndex ? activeRef : undefined}
              type="button"
              variant="ghost"
              onClick={() => onSelect(i)}
              onMouseEnter={() => onHover(i)}
              className={cn(
                'h-auto w-full justify-start gap-2.5 px-3 py-1.5 text-left font-normal transition-colors',
                i === activeIndex
                  ? 'bg-[var(--color-primary)]/12 text-[var(--color-foreground)]'
                  : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent)]',
              )}
            >
              {item.icon && (
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-[var(--color-muted-foreground)]">
                  {item.icon}
                </span>
              )}
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="flex-shrink-0 text-xs font-medium">{item.title}</span>
                {item.subtitle && (
                  <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-muted-foreground)]">
                    {item.subtitle}
                  </span>
                )}
              </span>
              {item.badge && (
                <span className="flex-shrink-0 rounded-full bg-[var(--color-subtle)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {item.badge}
                </span>
              )}
            </Button>
          ))
        )}
      </div>
    </div>
  );
}
