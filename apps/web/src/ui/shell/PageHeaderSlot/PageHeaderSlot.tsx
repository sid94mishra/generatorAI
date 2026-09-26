// ────────────────────────────────────────────────────────────────
// S-05 PageHeaderSlot / LegacyHeaderSlot (03 §4 S-05, D-21; 06 §2.3, §3.5).
//
// The first row of the main card. A ported page renders its own C-01
// PageHeader there; a route still marked `legacyHeader: true` gets the old
// global Header (components/layout/Header.tsx) inside a LegacyHeaderSlot,
// rendered by app/routes/RouteSlot INSIDE the route element so the old
// header's `useParams()` still resolves (D-21). P7 deletes the legacy branch.
//
// The slot is where the title-bar geometry applies (globals.css, desktop
// chrome block):
//   - on macOS it is a drag region (`data-drag-region="mac"`, active only
//     under `.titlebar-inset`); its interactive children are `no-drag`;
//   - in macOS rail mode its leading padding grows to clear the traffic
//     lights: `max(<own padding>, var(--gai-page-inset-left))` = 30px
//     (06 §3.5). PageHeader carries the same attributes itself, so a ported
//     page gets both without a wrapper.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn.js';

export type PageHeaderSlotProps = ComponentProps<'div'>;

/** Reserves the main card's first row for a page's own header. */
export function PageHeaderSlot({ className, ...rest }: PageHeaderSlotProps) {
  return <div data-slot="page-header-slot" data-drag-region="mac" className={cn('shrink-0', className)} {...rest} />;
}

/** The first row for a route that still renders the legacy global Header (D-21). */
export function LegacyHeaderSlot({ className, ...rest }: PageHeaderSlotProps) {
  return (
    <div
      data-testid="legacy-header"
      data-slot="legacy-header"
      data-drag-region="mac"
      className={cn('shrink-0', className)}
      {...rest}
    />
  );
}
