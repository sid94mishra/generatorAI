// ────────────────────────────────────────────────────────────────
// P-37 Skeleton (03 §2 P-37; Rosetta "rows of `--selected` bars 8h/6h,
// aria-busy").
//
// No shimmer, no spinner (D-20). Shapes: `line` (8h, badge radius), `meta`
// (6h), `block` (a square/box, control radius — size it with `className`,
// e.g. `size-6`). All `bg-selected`. Width is a prop (px or %). Skeletons are
// decorative: the CONTAINER announces loading (`aria-busy` + a label), see
// `SkeletonRows` and DataTable `loading`.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

export const skeletonVariants = cva('block shrink-0 bg-selected', {
  variants: {
    shape: {
      line: 'min-h-2 rounded-badge',
      meta: 'min-h-1.5 rounded-badge',
      block: 'rounded-control',
    },
  },
  defaultVariants: { shape: 'line' },
});

export interface SkeletonProps extends Omit<ComponentProps<'span'>, 'children'> {
  shape?: 'line' | 'meta' | 'block';
  /** px number or any CSS length ('60%'). Lines default to 100 %. */
  width?: number | string;
}

/** A static placeholder bar or box in the shape of content that is loading. */
export function Skeleton({ shape = 'line', width, className, style, ...rest }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn(skeletonVariants({ shape }), className)}
      style={width !== undefined ? { ...style, width } : style}
      {...rest}
    />
  );
}

export interface SkeletonRowsProps extends ComponentProps<'div'> {
  /** How many 44h rows (3–8 in the design). */
  rows?: number;
  /** Accessible name of the busy region ("Loading chats"). */
  label?: string;
}

/**
 * The loaded-row shape (Components board "Skeleton rows"): a 24px block, a
 * title line and a meta line, and a short trailing line, per 44h row.
 */
export function SkeletonRows({ rows = 3, label = 'Loading', className, ...rest }: SkeletonRowsProps) {
  const widths = ['62%', '48%', '70%', '55%', '66%', '44%', '58%', '52%'];
  return (
    <div role="status" aria-busy="true" aria-label={label} className={cn('flex flex-col', className)} {...rest}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-row items-center gap-3 border-b border-line-soft px-4 last:border-b-0">
          <Skeleton shape="block" className="size-6" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton width={widths[i % widths.length]} />
            <Skeleton shape="meta" width="28%" />
          </div>
          <Skeleton width={40} />
        </div>
      ))}
    </div>
  );
}
