// ────────────────────────────────────────────────────────────────
// P-48 Card (03 §2 P-48; Rosetta `.card`).
//
// `bg-raised`, 1px `border-line-soft` (`selected`: `border-line-strong`),
// card radius. `Card.Header` 40h (`h-panel-bar`), pad 0 14 (0 8 0 14 with an
// `action`), border-b `line-soft`: `title` (`text-ui` 600) or custom
// `children`, `meta` (`font-mono text-micro text-fg-3 ml-auto`) or a ghost sm
// `action`. `Card.Body` pad 12 14 by default (`padding="sm"` 12, `"lg"` 16).
// `Card.Section` is a Body that also draws a `border-t line-soft` divider
// (sections stacked inside one card). No Base UI part — a plain composite.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface CardProps extends ComponentProps<'div'> {
  /** Emphasised border (a selected row/card in a list). */
  selected?: boolean;
}

/** The card shell; compose with `Card.Header` / `Card.Body` / `Card.Section`. */
export function Card({ selected = false, className, ...rest }: CardProps) {
  return (
    <div
      className={cn('overflow-hidden rounded-card border bg-raised text-fg', selected ? 'border-line-strong' : 'border-line-soft', className)}
      {...rest}
    />
  );
}

export interface CardHeaderProps extends Omit<ComponentProps<'div'>, 'title'> {
  title?: ReactNode;
  /** Trailing mono context text (right-aligned unless `action` is also given). */
  meta?: ReactNode;
  /** A ghost sm button or icon button at the trailing end. */
  action?: ReactNode;
}

/** 40px header row with a border-bottom divider. */
export function CardHeader({ title, meta, action, className, children, ...rest }: CardHeaderProps) {
  return (
    <div
      className={cn('flex h-panel-bar shrink-0 items-center gap-2 border-b border-line-soft pl-3.5', action ? 'pr-2' : 'pr-3.5', className)}
      {...rest}
    >
      {title != null ? <div className="min-w-0 flex-1 truncate text-ui font-semibold">{title}</div> : children}
      {meta != null ? <div className="ml-auto shrink-0 font-mono text-micro text-fg-3">{meta}</div> : null}
      {action}
    </div>
  );
}

export interface CardBodyProps extends ComponentProps<'div'> {
  padding?: 'sm' | 'md' | 'lg';
}

const BODY_PADDING: Record<NonNullable<CardBodyProps['padding']>, string> = {
  sm: 'p-3',
  md: 'py-3 px-3.5',
  lg: 'p-4',
};

/** The card's content area. */
export function CardBody({ padding = 'md', className, ...rest }: CardBodyProps) {
  return <div className={cn('flex flex-col gap-3', BODY_PADDING[padding], className)} {...rest} />;
}

/** A Body that also draws a top divider, for stacking several sections in one card. */
export function CardSection({ padding = 'md', className, ...rest }: CardBodyProps) {
  return <div className={cn('flex flex-col gap-3 border-t border-line-soft', BODY_PADDING[padding], className)} {...rest} />;
}

Card.Header = CardHeader;
Card.Body = CardBody;
Card.Section = CardSection;
