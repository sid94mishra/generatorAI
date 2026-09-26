// ────────────────────────────────────────────────────────────────
// F-composer-15/16 — the `/` command menu and the `@` file menu.
//
// One panel above the box (ComposerStates "Input aids"): header with the
// count, rows grouped Tools / Skills / Prompts for `/` (the rows arrive in
// that order from `useComposerMenus`, so the keyboard index and the visual
// order agree), and a key-hint footer. A `/` row is "icon · /name · description
// · kind badge"; an `@` row is "file · name · path · mount badge". The panel
// never takes focus: the textarea keeps it and drives the highlight.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, type ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '@/ui/lib/cn.js';
import { overlayProps } from '@/ui/lib/overlay.js';
import { floatSurface } from '@/ui/lib/popup.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { KbdHintRow, type KbdHint } from '@/ui/patterns/KbdHintRow/KbdHintRow.js';

export interface ComposerMenuItem {
  id: string;
  title: string;
  subtitle?: string | undefined;
  icon: IconConcept;
  badge?: string | undefined;
  /** Group heading this row starts (the first row of each group). */
  group?: string | undefined;
  /** Mono title (commands) vs ui text (file names). */
  monoTitle?: boolean;
}

export interface ComposerMenuProps {
  open: boolean;
  kind: 'slash' | 'mention';
  items: ComposerMenuItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
  loading?: boolean;
  /** Footer note after the hints (the highlighted command's argument hint). */
  footerNote?: ReactNode;
}

const SLASH_HINTS: readonly KbdHint[] = [{ keys: '↵', label: 'Select' }];
const MENTION_HINTS: readonly KbdHint[] = [
  { keys: '↵', label: 'Attach contents' },
  { keys: 'Esc', label: 'Close' },
];

export function ComposerMenu({ open, kind, items, activeIndex, onSelect, onHover, loading = false, footerNote }: ComposerMenuProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  if (!open) return null;

  const header = kind === 'slash' ? 'Commands & skills' : 'Attach a file';
  const empty = kind === 'slash' ? 'No matching commands' : 'No matching files';

  return (
    <div
      {...overlayProps('menu')}
      className={cn(
        floatSurface,
        'absolute bottom-full left-0 z-dropdown mb-2 flex max-w-full flex-col overflow-hidden rounded-card',
        kind === 'slash' ? 'w-115' : 'w-110',
      )}
      // The textarea keeps focus: a press on a row must not blur it.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex h-step shrink-0 items-center justify-between px-3 text-small text-fg-3">
        <span>{header}</span>
        {kind === 'slash' && !loading && items.length > 0 ? <span className="font-mono text-micro">{items.length}</span> : null}
      </div>
      <div className="max-h-72 overflow-y-auto px-1 pb-1">
        {loading ? (
          <p className="px-2 py-2 text-small text-fg-3">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-2 text-small text-fg-3">{empty}</p>
        ) : (
          items.map((item, i) => (
            <div key={item.id}>
              {item.group ? <p className="flex h-step items-center px-2 text-small text-fg-3">{item.group}</p> : null}
              <Button
                ref={i === activeIndex ? activeRef : undefined}
                variant="ghost"
                onClick={() => onSelect(i)}
                onMouseEnter={() => onHover(i)}
                className={cn(
                  // The kit button wraps its content in one span; let it take the row.
                  'h-item w-full justify-start rounded-control-sm px-2 text-left font-normal text-fg *:flex-1',
                  i === activeIndex && 'bg-selected',
                )}
              >
                <span className="flex w-full items-center gap-2">
                <Icon concept={item.icon} size={14} className="shrink-0 text-fg-3" />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className={cn('shrink-0', item.monoTitle ? 'font-mono text-small' : 'text-ui')}>{item.title}</span>
                  {item.subtitle ? (
                    <span className={cn('min-w-0 flex-1 truncate text-fg-3', kind === 'mention' ? 'font-mono text-micro' : 'text-small')}>
                      {item.subtitle}
                    </span>
                  ) : null}
                </span>
                {item.badge ? (
                  <span
                    className={cn(
                      'shrink-0 text-micro text-fg-3',
                      kind === 'mention' && 'rounded-badge bg-sunken px-1.5 font-mono',
                    )}
                  >
                    {item.badge}
                  </span>
                ) : null}
                </span>
              </Button>
            </div>
          ))
        )}
      </div>
      <div className="flex min-h-8 shrink-0 items-center border-t border-line-soft px-3">
        <KbdHintRow hints={kind === 'slash' ? SLASH_HINTS : MENTION_HINTS} />
        {footerNote ? <span className="ml-3 min-w-0 truncate text-micro text-fg-3">{footerNote}</span> : null}
      </div>
    </div>
  );
}
