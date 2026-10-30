// ────────────────────────────────────────────────────────────────
// S-03 Rail (03 §4 S-03, D-22; 06 §3.5; board ChatNarrow).
//
// The sidebar collapsed to 48px (`w-rail`): below 1200px window width, when
// the user collapses the sidebar, and always in the workflow builder. A
// centred column, pad 12 0 8 0, gap 2:
//   topRow (macOS: the empty 44px drag row the traffic lights sit over)
//   app mark 32 · Expand · divider · Search · New chat · divider ·
//   7 nav icon buttons (Home carries the needs-you dot) · divider ·
//   Activity toggle · live tiles (D-92) · spacer · connection dot · Settings
// Every icon has a tooltip (IconButton). Presentational: app/shell
// (ConnectedRail) supplies the children and decides what is omitted per
// layout (the strip layout drops the app mark and Search, which the title
// strip holds).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode, Ref } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';
import { AppMark } from '../../icons/vendor/VendorIcons.js';
import { Icon } from '../../icons/Icon.js';
import { Button } from '../../primitives/Button/Button.js';
import { StatusDot, type DotTone } from '../../primitives/StatusDot/StatusDot.js';
import { Tooltip } from '../../primitives/Tooltip/Tooltip.js';

export interface RailProps extends ComponentProps<'aside'> {
  /** The macOS drag row (S-07); the column then starts right under it. */
  topRow?: ReactNode;
  /**
   * The SidebarFlyout is open over it: the rail is covered, so it leaves the
   * tab order and the accessibility tree (one "Sidebar" landmark at a time).
   */
  covered?: boolean;
}

/** The 48px icon rail. */
export function Rail({ topRow, covered = false, className, children, ...rest }: RailProps) {
  return (
    <aside
      aria-label="Sidebar"
      data-testid="app-sidebar"
      data-collapsed="rail"
      {...(covered ? { inert: true, 'aria-hidden': true } : {})}
      className={cn(
        'flex w-rail shrink-0 flex-col items-center gap-0.5 overflow-x-hidden overflow-y-auto bg-ground pb-2 text-fg',
        topRow ? 'pt-0' : 'pt-3',
        className,
      )}
      {...rest}
    >
      {topRow}
      {children}
    </aside>
  );
}

/** The 20px hairline between rail groups. */
export function RailDivider({ className, ...rest }: Omit<ComponentProps<'div'>, 'children'>) {
  return <div role="separator" className={cn('my-1.5 w-5 shrink-0 border-t border-line-soft', className)} {...rest} />;
}

/** Pushes the connection dot and Settings to the bottom. */
export function RailSpacer() {
  return <div className="min-h-2 flex-1" />;
}

/** A vertical group of rail items (the nav). */
export function RailGroup({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col items-center gap-0.5', className)} {...rest} />;
}

export interface RailMarkProps extends Omit<ComponentProps<'button'>, 'children'> {
  /** Accessible name and tooltip, e.g. "GeneratorAI · This computer". */
  label: string;
}

/**
 * The app mark at the top of the rail, naming the active server: the rail's
 * Servers menu trigger (pass it as `Menu.Trigger`'s `render`), like the
 * sidebar's ServerSwitcher.
 */
export function RailMark({ label, className, ...rest }: RailMarkProps) {
  return (
    <Tooltip content={label} side="right">
      <Button
        variant="ghost"
        aria-label={label}
        className={cn('size-control-lg shrink-0 px-0 data-popup-open:bg-hover', className)}
        {...rest}
      >
        <AppMark className="size-5.5" />
      </Button>
    </Tooltip>
  );
}

export interface RailStatusDotProps extends Omit<ComponentProps<'span'>, 'children'> {
  tone: DotTone;
  /** Accessible name and tooltip: "Connected · local:3100". */
  label: string;
}

/** The connection dot near the bottom of the rail. */
export function RailStatusDot({ tone, label, className, ...rest }: RailStatusDotProps) {
  return (
    <Tooltip content={label} side="right">
      <span
        role="img"
        aria-label={label}
        tabIndex={0}
        className={cn('flex size-control shrink-0 items-center justify-center rounded-control', focusRing, className)}
        {...rest}
      >
        <StatusDot tone={tone} size="sm" />
      </span>
    </Tooltip>
  );
}

const LIVE_TILE_TONE = {
  warn: 'bg-warn-bg text-warn ring-1 ring-warn/40 ring-inset hover:not-disabled:bg-warn-bg hover:not-disabled:text-warn',
  err: 'bg-err-bg text-err ring-1 ring-err/40 ring-inset hover:not-disabled:bg-err-bg hover:not-disabled:text-err',
  run: 'bg-run-bg text-run hover:not-disabled:bg-run-bg hover:not-disabled:text-run',
} as const;

const LIVE_TILE_BADGE = {
  warn: 'bg-warn text-ground',
  err: 'bg-err text-ground',
  run: 'bg-run text-ground',
} as const;

export interface RailLiveTileProps extends Omit<ComponentProps<'button'>, 'children' | 'ref'> {
  /** Kind glyph (chat, orchestrator, workflow, automation). */
  icon: IconConcept;
  /** amber = needs you, red = failed, blue = running (D-92, board EnhRailQuickAccess). */
  tone: keyof typeof LIVE_TILE_TONE;
  /** Accessible name: "Nightly dependency audit · needs you". */
  label: string;
  /** Corner count (asks waiting on one card). */
  count?: number;
  /** Its popover is open (the hover ring). */
  active?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/** A live item in the rail (narrow window quick access): a 34px status-tinted kind tile. */
export function RailLiveTile({ icon, tone, label, count, active = false, className, ...rest }: RailLiveTileProps) {
  return (
    <Button
      variant="ghost"
      aria-label={label}
      data-tone={tone}
      className={cn(
        'size-8.5 rounded-card px-0',
        LIVE_TILE_TONE[tone],
        active && 'outline-2 outline-offset-2 outline-line-strong',
        className,
      )}
      {...rest}
    >
      <Icon concept={icon} size={16} />
      {count !== undefined && count > 1 ? (
        <span
          aria-hidden
          className={cn(
            'absolute -right-0.75 -bottom-0.75 flex min-h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.75 font-mono text-micro leading-none font-semibold ring-2 ring-ground',
            LIVE_TILE_BADGE[tone],
          )}
        >
          {count}
        </span>
      ) : null}
    </Button>
  );
}

export interface RailLiveOverflowProps extends Omit<ComponentProps<'button'>, 'children' | 'ref'> {
  /** How many live items did not fit. */
  count: number;
}

/** "+2": the live items that did not fit; opens the Activity column. */
export function RailLiveOverflow({ count, className, ...rest }: RailLiveOverflowProps) {
  return (
    <Tooltip content={`${count} more — show activity`} side="right">
      <Button
        variant="ghost"
        aria-label={`${count} more live items — show activity`}
        className={cn('h-control-sm w-8.5 rounded-control px-0 font-mono text-micro text-fg-3', className)}
        {...rest}
      >
        +{count}
      </Button>
    </Tooltip>
  );
}
