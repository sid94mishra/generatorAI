// ────────────────────────────────────────────────────────────────
// C-12 SectionHeader (03 §3 C-12; Rosetta `.sec`, h2 13/600, h2 16/600).
//
// `label`: 28h (h-step; 24 compact), pad 0 8, gap 6, small 500 fg-3 + a
// Count at the end (sidebar "Needs you 2", menus). `title`: 24h, ui 600 +
// count or hint, spacer, a ghost sm action (Home, Security). `form`: title
// step 600 with a baseline hint (C-14 form sections). `title` and `form`
// render a real heading (`level`, default h2); `label` is a plain caption.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Count, type CountTone } from '../../primitives/Count/Count.js';

export interface SectionHeaderProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
  count?: ReactNode;
  countTone?: CountTone;
  hint?: ReactNode;
  action?: ReactNode;
  variant?: 'label' | 'title' | 'form';
  /** Heading level for `title` / `form`. */
  level?: 2 | 3 | 4;
}

/** A section's heading row: caption + count, or a heading with a hint and an action. */
export function SectionHeader({
  title,
  count,
  countTone = 'neutral',
  hint,
  action,
  variant = 'title',
  level = 2,
  className,
  ...rest
}: SectionHeaderProps) {
  if (variant === 'label') {
    return (
      <div className={cn('flex h-step min-w-0 items-center gap-1.5 px-2 text-small font-medium text-fg-3', className)} {...rest}>
        <span className="truncate">{title}</span>
        {count != null ? (
          <Count tone={countTone} align="end">
            {count}
          </Count>
        ) : null}
        {action}
      </div>
    );
  }
  const Heading = `h${level}` as const;
  const form = variant === 'form';
  return (
    <div className={cn('flex min-w-0 items-baseline gap-2', form ? 'min-h-6' : 'min-h-6 items-center', className)} {...rest}>
      {/* The hint gives way first: a long hint truncates, the title never does ("Acco…"). */}
      <Heading className={cn('truncate text-fg', hint != null && 'shrink-0', form ? 'text-title' : 'text-ui font-semibold')}>{title}</Heading>
      {count != null ? <Count tone={countTone}>{count}</Count> : null}
      {hint != null ? <span className="min-w-0 truncate text-small text-fg-3">{hint}</span> : null}
      {action != null ? <div className="ml-auto flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}
