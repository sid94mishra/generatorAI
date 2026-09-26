// ────────────────────────────────────────────────────────────────
// P-05 Badge — a non-status label: Draft, Agent, Worker, Published v7, counts
// (03 §2 P-05; Rosetta `.bdg.s-idle` / `.bdg.s-warn` …).
//
// 20h, pad 0 6, badge radius, small 500, optional 12px icon and a mono
// `suffix`. Tones neutral (`bg-selected text-fg-2`) | run | ok | warn | err
// (`bg-<tone>-bg text-<tone>`, the AA-safe status text colour, D-12).
// Run states use StatusBadge (P-06), never a hand-picked Badge tone.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';

export const badgeVariants = cva(
  'inline-flex h-badge shrink-0 items-center gap-1 rounded-badge px-1.5 text-small font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-selected text-fg-2',
        run: 'bg-run-bg text-run',
        ok: 'bg-ok-bg text-ok',
        warn: 'bg-warn-bg text-warn',
        err: 'bg-err-bg text-err',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone;
  /** Leading 12px glyph. */
  icon?: IconConcept;
  /** Trailing mono part ("v7"). */
  suffix?: ReactNode;
}

/** A small tinted label for non-status metadata. */
export function Badge({ tone = 'neutral', icon, suffix, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...rest}>
      {icon ? <Icon concept={icon} size={12} /> : null}
      {children}
      {suffix != null ? <span className="font-mono text-micro">{suffix}</span> : null}
    </span>
  );
}
