// ────────────────────────────────────────────────────────────────
// P-41 EmptyState (03 §2 P-41; Rosetta "centred icon + 13/600 title + 12px
// text + one button").
//
// Centred column, gap 8: 20px icon fg-3, title ui 600, one sentence small
// fg-3, one secondary action (margin-top 4). `framed`: 1px line-soft, card
// radius, 204h, pad 0 28. `tone="error"`: the REAL error text in mono small
// err plus a Retry action (dock "States" columns). One icon, one sentence,
// one action.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  icon: IconConcept;
  title: ReactNode;
  /** One sentence. With `tone="error"` pass the real error message. */
  description?: ReactNode;
  /** One secondary Button (or a Retry). */
  action?: ReactNode;
  tone?: 'empty' | 'error';
  framed?: boolean;
}

/** What a region shows when it has nothing (or failed): icon, title, one sentence, one action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'empty',
  framed = false,
  className,
  ...rest
}: EmptyStateProps) {
  const error = tone === 'error';
  return (
    <div
      role={error ? 'alert' : undefined}
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center',
        framed && 'min-h-51 rounded-card border border-line-soft px-7',
        className,
      )}
      {...rest}
    >
      <Icon concept={icon} size={20} className={error ? 'text-err' : 'text-fg-3'} />
      <div className="text-ui font-semibold text-fg">{title}</div>
      {description != null ? (
        <div className={cn('max-w-100', error ? 'font-mono text-small break-words text-err' : 'text-small text-fg-3')}>
          {description}
        </div>
      ) : null}
      {action != null ? <div className="mt-1 flex">{action}</div> : null}
    </div>
  );
}
