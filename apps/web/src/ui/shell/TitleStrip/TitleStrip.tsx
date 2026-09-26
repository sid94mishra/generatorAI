// ────────────────────────────────────────────────────────────────
// S-06 TitleStrip (03 §4 S-06, D-23; 06 §3.5; board DesktopWindows).
//
// The full-width 36px strip of the `strip` layout (Windows; Linux with
// GENERATORAI_LINUX_CUSTOM_TITLEBAR=1): `bg-ground`, pad-left 8. Three parts
// on one row, the centre kept centred by two equal flexible sides:
//   start   Back, Forward (ib-sm) · Toggle sidebar (margin-left 4)
//   centre  the 420px Search button (shrinks to 200 in narrow windows)
//   end     the update pill slot (P3-06) and the server chip
// The right padding is the Window Controls Overlay's caption-button area,
// `var(--gai-titlebar-inset-right)` (tracked live by lib/desktop.ts; set in
// globals.css, keyed on `data-slot="title-strip"`), so no control ever sits
// under the OS-painted min/max/close buttons.
// The strip is the window's drag region (`app-drag-region`); its buttons are
// `no-drag` through the shared rule. Presentational: app/shell wires it.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Button } from '../../primitives/Button/Button.js';
import { StatusDot, type DotTone } from '../../primitives/StatusDot/StatusDot.js';

export interface TitleStripProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Back / Forward / Toggle sidebar. */
  start?: ReactNode;
  /** The centred Search button. */
  search?: ReactNode;
  /** Update pill + server chip. */
  end?: ReactNode;
}

/** The 36px title strip. */
export function TitleStrip({ start, search, end, className, ...rest }: TitleStripProps) {
  return (
    <div
      data-slot="title-strip"
      data-drag-region="strip"
      className={cn('app-drag-region flex h-strip w-full shrink-0 items-center gap-2 bg-ground pl-2 text-fg select-none', className)}
      {...rest}
    >
      <div className="flex min-w-fit flex-1 basis-0 items-center gap-0.5">{start}</div>
      {search != null ? <div className="flex w-105 min-w-50 shrink justify-center">{search}</div> : null}
      <div className="flex min-w-fit flex-1 basis-0 items-center justify-end gap-1.5">{end}</div>
    </div>
  );
}

export interface TitleStripSearchProps extends Omit<ComponentProps<'button'>, 'children' | 'ref'> {
  /** One chord for the hint, formatted for this host: `['Ctrl', 'K']`. */
  shortcut?: readonly string[];
}

/** The centred "Search  Ctrl K" button (26h, `bg-surface`, small fg-3). */
export function TitleStripSearch({ shortcut, className, ...rest }: TitleStripSearchProps) {
  return (
    <Button
      icon="search"
      size="sm"
      shortcut={shortcut}
      className={cn(
        'w-full justify-start border-line-soft bg-surface font-normal text-fg-3 hover:not-disabled:text-fg-2 *:last:ml-auto',
        className,
      )}
      {...rest}
    >
      Search
    </Button>
  );
}

export interface TitleStripServerChipProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** The active server's name ("This computer"). */
  label: string;
  tone: DotTone;
  /** Accessible status text for the dot ("Connected"). */
  toneLabel?: string;
}

/**
 * The server chip at the right of the strip: dot · name, in the pressed-chip
 * look. Static in P3-04: P3-06 turns it into the Servers popover trigger
 * (adding the chevron), so it is never a button that does nothing.
 */
export function TitleStripServerChip({ label, tone, toneLabel, className, ...rest }: TitleStripServerChipProps) {
  return (
    <span
      className={cn(
        'flex h-control-sm max-w-60 min-w-0 items-center gap-2 rounded-control-sm bg-selected px-2 text-small font-medium text-fg',
        className,
      )}
      {...rest}
    >
      <StatusDot tone={tone} size="sm" {...(toneLabel ? { label: toneLabel } : {})} />
      <span className="truncate">{label}</span>
    </span>
  );
}
