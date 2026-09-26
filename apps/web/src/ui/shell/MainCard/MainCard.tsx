// ────────────────────────────────────────────────────────────────
// S-04 MainCard (03 §4 S-04, D-21; 06 §2.5).
//
// The inset card every page renders in: `flex-1 min-w-0`, `bg-surface`, 1px
// `border-line-soft`, `rounded-panel`, overflow hidden, `relative` (the
// containing block of the dock sheet and the bulk bar) and `@container/main`
// (templates respond to the card's width, not the viewport's).
// Margins from the boards: `8 8 8 0` (the sidebar's own padding, or the
// rail's edge, supplies the left gap); under the title strip `0 8 8 0`.
// A `<main>` landmark: the page's h1 lives inside it.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn.js';

export interface MainCardProps extends ComponentProps<'main'> {
  /** Sits under the title strip (Windows / Linux custom): no top margin. */
  underStrip?: boolean;
}

/** The inset card that holds the page. */
export function MainCard({ underStrip = false, className, ...rest }: MainCardProps) {
  return (
    <main
      data-testid="main-card"
      className={cn(
        '@container/main relative mr-2 mb-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-line-soft bg-surface text-fg',
        underStrip ? 'mt-0' : 'mt-2',
        className,
      )}
      {...rest}
    />
  );
}

/**
 * The page's box under the header row: fills the rest of the card, clips, and
 * is a plain block so a legacy page's `h-full` root resolves as it did under
 * the old `<main className="flex-1 overflow-hidden">`.
 */
export function MainCardBody({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cn('relative min-h-0 flex-1 overflow-hidden', className)} {...rest} />;
}
