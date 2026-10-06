// ────────────────────────────────────────────────────────────────
// ActivityColumn (D-92; boards EnhActivityColumn, EnhSidebarHidden,
// EnhActivityCards "Header, server filter, empty").
//
// The column between the sidebar (or rail) and the main card: on the ground
// like the sidebar, 1px `line-soft` on its left, pad 8, a 36h header
// ("Activity" + needs-you / running / failed badges, filter menu, close), the
// kind tabs, then the scrolling list. Width is the caller's (SHELL
// `activityColumn`, persisted): a 1px separator on the right edge resizes it
// by pointer or arrow keys (16px a step, Home/End = min/max, double-click =
// default).
//
// `variant="overlay"`: the same column floating over the main card (the
// window is too narrow to dock it — D-92): absolute (inside S-01's overlay
// layer, which owns the stacking and the slide-in, D-109), `shadow-pop`,
// `data-gai-overlay="sheet"` so the desktop's native browser view steps
// aside; not resizable.
// Presentational: app/shell decides the variant and owns the width.
// ────────────────────────────────────────────────────────────────

import { useRef, type ComponentProps, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';
import { focusRing, separatorHitSlop } from '../../lib/focus.js';
import { overlayProps } from '../../lib/overlay.js';

const columnVariants = cva('flex min-h-0 shrink-0 flex-col gap-1 bg-ground p-2 text-fg', {
  variants: {
    variant: {
      docked: 'relative border-l border-line-soft',
      overlay: 'absolute inset-y-0 rounded-r-panel border-r border-line-soft shadow-pop',
    },
  },
  defaultVariants: { variant: 'docked' },
});

export interface ActivityColumnProps extends Omit<ComponentProps<'aside'>, 'children'> {
  variant?: 'docked' | 'overlay';
  /** Current width in px (computed geometry: applied inline). */
  width: number;
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  /** Docked only: the user dragged or keyed the separator. */
  onWidthChange?: (width: number) => void;
  /** Overlay only: px from the frame's left edge (the rail or sidebar width). */
  offsetLeft?: number;
  header: ReactNode;
  /** Kind tabs and other controls under the header. */
  toolbar?: ReactNode;
  children: ReactNode;
}

const KEY_STEP = 16;

/** The Activity column frame: header, toolbar, scrolling body, resize separator. */
export function ActivityColumn({
  variant = 'docked',
  width,
  minWidth,
  maxWidth,
  defaultWidth,
  onWidthChange,
  offsetLeft = 0,
  header,
  toolbar,
  children,
  className,
  style,
  ...rest
}: ActivityColumnProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(maxWidth, Math.max(minWidth, w)));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onWidthChange?.(clamp(drag.current.startWidth + e.clientX - drag.current.startX));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === 'ArrowLeft' ? width - KEY_STEP : e.key === 'ArrowRight' ? width + KEY_STEP : e.key === 'Home' ? minWidth : e.key === 'End' ? maxWidth : null;
    if (next === null) return;
    e.preventDefault();
    onWidthChange?.(clamp(next));
  };

  const overlay = variant === 'overlay';
  return (
    <aside
      aria-label="Activity"
      data-testid="activity-column"
      data-variant={variant}
      {...(overlay ? overlayProps('sheet') : {})}
      className={cn(columnVariants({ variant }), className)}
      style={{ ...style, width, ...(overlay ? { left: offsetLeft } : {}) }}
      {...rest}
    >
      {header}
      {toolbar}
      {/* Not a tab stop of its own (Chrome makes scrollers focusable): the cards inside carry the focus. */}
      <div tabIndex={-1} className="-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 outline-none">
        {children}
      </div>
      {!overlay && onWidthChange ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize activity column"
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          tabIndex={0}
          data-testid="activity-column-resize"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => onWidthChange(defaultWidth)}
          onKeyDown={onKeyDown}
          className={cn(
            'absolute inset-y-0 -right-px z-sticky w-px cursor-col-resize bg-transparent transition-control hover:bg-line-strong focus-visible:bg-line-strong',
            separatorHitSlop.vertical,
            focusRing,
          )}
        />
      ) : null}
    </aside>
  );
}

export interface ActivityColumnHeaderProps extends ComponentProps<'div'> {
  /** Count badges after the title. */
  badges?: ReactNode;
  /** Filter menu and close, at the end. */
  actions?: ReactNode;
}

/** The 36h header row: "Activity", the badges, the actions. */
export function ActivityColumnHeader({ badges, actions, className, children, ...rest }: ActivityColumnHeaderProps) {
  return (
    <div className={cn('flex h-tab shrink-0 items-center gap-1.5 pl-1.5', className)} {...rest}>
      <h2 className="text-ui font-semibold text-fg">{children}</h2>
      {badges}
      {actions != null ? <span className="ml-auto flex items-center gap-0.5">{actions}</span> : null}
    </div>
  );
}

const badgeVariants = cva(
  'inline-flex min-h-4.5 min-w-4.5 items-center justify-center rounded-badge px-1.25 font-mono text-micro font-medium leading-none tabular-nums',
  {
    variants: { tone: { warn: 'bg-warn-bg text-warn', run: 'bg-run-bg text-run', err: 'bg-err-bg text-err' } },
  },
);

export interface ActivityCountBadgeProps extends Omit<ComponentProps<'span'>, 'children'> {
  tone: 'warn' | 'run' | 'err';
  count: number;
  /** Accessible name: "3 need you". */
  label: string;
}

/** A header count (needs you amber, running blue, failed red). */
export function ActivityCountBadge({ tone, count, label, className, ...rest }: ActivityCountBadgeProps) {
  return (
    <span role="img" aria-label={label} title={label} className={cn(badgeVariants({ tone }), className)} {...rest}>
      {count}
    </span>
  );
}

/** A group of cards under its SectionHeader ("Needs you 3"). */
export function ActivityGroup({ className, ...rest }: ComponentProps<'section'>) {
  return <section className={cn('mt-1.5 flex shrink-0 flex-col gap-0.5 first:mt-0', className)} {...rest} />;
}
