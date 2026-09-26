// ────────────────────────────────────────────────────────────────
// S-03 Rail (03 §4 S-03, D-22; 06 §3.5; board ChatNarrow).
//
// The sidebar collapsed to 48px (`w-rail`): below 1200px window width, when
// the user collapses the sidebar, and always in the workflow builder. A
// centred column, pad 12 0 8 0, gap 2:
//   topRow (macOS: the empty 44px drag row the traffic lights sit over)
//   app mark 32 · Expand · divider · Search · New chat · divider ·
//   7 nav icon buttons (Home carries the needs-you dot) · divider ·
//   running counter · spacer · connection dot · Settings
// Every icon has a tooltip (IconButton). Presentational: app/shell
// (ConnectedRail) supplies the children and decides what is omitted per
// layout (the strip layout drops the app mark and Search, which the title
// strip holds).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
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

export interface RailMarkProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Accessible name and tooltip, e.g. "GeneratorAI · This computer". */
  label: string;
}

/**
 * The app mark at the top of the rail, naming the active server. Static in
 * P3-04 like the sidebar's ServerSwitcher; P3-06 makes it the Servers trigger.
 */
export function RailMark({ label, className, ...rest }: RailMarkProps) {
  return (
    <Tooltip content={label} side="right">
      <span
        role="img"
        aria-label={label}
        tabIndex={0}
        className={cn('flex size-control-lg shrink-0 items-center justify-center rounded-control', focusRing, className)}
        {...rest}
      >
        <AppMark className="size-5.5" />
      </span>
    </Tooltip>
  );
}

export interface RailCounterButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'ref'> {
  count: number;
  /** Accessible name and tooltip, e.g. "3 running". */
  label: string;
}

/** The running counter: a run-coloured spinner glyph with the count under it (40h). */
export function RailCounterButton({ count, label, className, ...rest }: RailCounterButtonProps) {
  return (
    <Tooltip content={label} side="right">
      <Button
        variant="ghost"
        aria-label={label}
        className={cn('h-auto min-h-10 w-8 flex-col gap-px px-0 py-1 text-run hover:not-disabled:text-run', className)}
        {...rest}
      >
        <span className="flex flex-col items-center gap-px">
          <Icon concept="status-running" size={16} />
          <span className="font-mono text-micro leading-none text-fg-3 tabular-nums">{count}</span>
        </span>
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
