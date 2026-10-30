// ────────────────────────────────────────────────────────────────
// C-09 EntityCard / CardGrid (03 §3 C-09): Agents grid, WorkflowNew templates.
//
// Built on P-48 Card: pad 16 gap 12, header (`leading` — an Avatar/AgentGlyph
// · `title` `text-body` 600 · `badge` · ib-sm `actions`), `description`
// (`text-ui text-fg-2`, clamped to 2 lines), `meta` (mono line), `footer`
// (border-t, scope text / tag chips / version). `CardGrid` lays cards out
// `repeat(3, minmax(0,1fr))` with a 12px gap.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Card } from '../../primitives/Card/Card.js';

export interface EntityCardProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
  /** An Avatar or AgentGlyph. */
  leading?: ReactNode;
  badge?: ReactNode;
  /** Clamped to 2 lines. */
  description?: ReactNode;
  /** A mono detail line under the description. */
  meta?: ReactNode;
  footer?: ReactNode;
  /** ib-sm actions in the header, trailing. */
  actions?: ReactNode;
  selected?: boolean;
}

/** A card summarising one entity (agent, workflow template …). */
export function EntityCard({ title, leading, badge, description, meta, footer, actions, selected = false, className, ...rest }: EntityCardProps) {
  return (
    <Card selected={selected} className={cn('flex flex-col gap-3 p-4', className)} {...rest}>
      <div className="flex items-center gap-2.5">
        {leading}
        <div className="min-w-0 flex-1 truncate text-body font-semibold text-fg">{title}</div>
        {badge}
        {actions != null ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {description != null ? <div className="line-clamp-2 text-ui text-fg-2">{description}</div> : null}
      {meta != null ? <div className="truncate font-mono text-micro text-fg-3">{meta}</div> : null}
      {footer != null ? <div className="flex items-center gap-2 border-t border-line-soft pt-3">{footer}</div> : null}
    </Card>
  );
}

export interface CardGridProps extends ComponentProps<'div'> {
  /** Columns at full width; the caller's container query narrows it further. */
  columns?: 2 | 3 | 4;
}

const COLUMNS: Record<NonNullable<CardGridProps['columns']>, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

/** Lays out EntityCards (or any grid children) with a 12px gap. */
export function CardGrid({ columns = 3, className, ...rest }: CardGridProps) {
  return <div className={cn('grid gap-3', COLUMNS[columns], className)} {...rest} />;
}
