// ────────────────────────────────────────────────────────────────
// P-08 Count — a mono number after a label (03 §2 P-08; Rosetta `.cnt`).
//
// `font-mono text-micro text-fg-3`; `align="end"` pushes it to the end of a
// row (`ml-auto`, nav rows and section headers). Tones warn | run | err colour
// the number. `bubble` is the small tinted pill on rail icons (11px, lh 14,
// pad 0 3, badge radius).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

export type CountTone = 'neutral' | 'warn' | 'run' | 'err';

export const countVariants = cva('shrink-0 font-mono text-micro tabular-nums', {
  variants: {
    tone: { neutral: 'text-fg-3', warn: 'text-warn', run: 'text-run', err: 'text-err' },
    bubble: {
      false: '',
      true: 'inline-flex min-w-3.5 items-center justify-center rounded-badge px-0.75 leading-3.5',
    },
    align: { inline: '', end: 'ml-auto' },
  },
  compoundVariants: [
    { bubble: true, tone: 'neutral', className: 'bg-selected text-fg-2' },
    { bubble: true, tone: 'warn', className: 'bg-warn-bg' },
    { bubble: true, tone: 'run', className: 'bg-run-bg' },
    { bubble: true, tone: 'err', className: 'bg-err-bg' },
  ],
  defaultVariants: { tone: 'neutral', bubble: false, align: 'inline' },
});

export interface CountProps extends ComponentProps<'span'> {
  tone?: CountTone;
  /** Tinted pill form for rail icon counters. */
  bubble?: boolean;
  /** `end` = `ml-auto` inside a flex row. */
  align?: 'end' | 'inline';
}

/** A mono count (items in a list, a tab, a section). */
export function Count({ tone = 'neutral', bubble = false, align = 'inline', className, ...rest }: CountProps) {
  return <span className={cn(countVariants({ tone, bubble, align }), className)} {...rest} />;
}
