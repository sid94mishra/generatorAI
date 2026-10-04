// ────────────────────────────────────────────────────────────────
// ActivityPopover (D-92; boards EnhActivityPopovers, EnhActivityColumn,
// EnhSidebarHidden, EnhRailQuickAccess) — the body of the hover/focus card
// beside an Activity row or a rail tile. Same layout for every kind: what it
// is, what it needs, where and how it runs, then actions.
//
//   header   kind glyph + label · context (micro fg-3), title (body 600) and
//            a status badge
//   band     the ask (amber), the error (red) or the progress (sunken):
//            `margin 0 10 10`, pad 10, card radius
//   details  KeyValueList (84px labels, dense), border-top line-soft
//   sections titled lists (Workers · 4, Stages · 5) of ActivityListRow
//   footer   sunken bar: primary actions start, the destructive one at the end
// The box (`w-aside` 320, panel radius, the overlay surface) is the
// caller's Popover popup; this is its content.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';
import { KeyValueList, type KeyValueItem } from '../KeyValueList/KeyValueList.js';

export interface ActivityPopoverBodyProps extends Omit<ComponentProps<'div'>, 'title'> {
  kindIcon: IconConcept;
  kindLabel: string;
  /** After the kind: the project, "platform-deps". */
  context?: ReactNode;
  title: ReactNode;
  /** A StatusBadge. */
  status?: ReactNode;
  /** The ask / error / progress block. */
  band?: ReactNode;
  details?: readonly KeyValueItem[];
  /** ActivityPopoverSection blocks. */
  sections?: ReactNode;
  /** Actions at the start of the footer (Open). */
  footerStart?: ReactNode;
  /** Actions at the end of the footer (Stop all, Cancel run, Dismiss). */
  footerEnd?: ReactNode;
  /** Id for the title, so the popup can be labelled by it. */
  titleId?: string;
}

/** The popover body: header, band, details, sections, footer. */
export function ActivityPopoverBody({
  kindIcon,
  kindLabel,
  context,
  title,
  status,
  band,
  details,
  sections,
  footerStart,
  footerEnd,
  titleId,
  className,
  ...rest
}: ActivityPopoverBodyProps) {
  return (
    <div className={cn('flex min-w-0 flex-col text-small', className)} {...rest}>
      <div className="flex flex-col gap-1 px-3.5 pt-3 pb-2.5">
        <div className="flex min-w-0 items-center gap-1.5 text-micro text-fg-3">
          <Icon concept={kindIcon} size={12} className="shrink-0" />
          <span className="shrink-0">{kindLabel}</span>
          {context != null ? (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate">{context}</span>
            </>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span id={titleId} className="min-w-0 flex-1 truncate text-body font-semibold text-fg">
            {title}
          </span>
          {status != null ? <span className="flex shrink-0">{status}</span> : null}
        </div>
      </div>
      {band}
      {details && details.length > 0 ? (
        <div className="border-t border-line-soft px-3.5 py-2.5">
          <KeyValueList items={details} labelWidth={84} dense className="gap-1.5" />
        </div>
      ) : null}
      {sections}
      {footerStart != null || footerEnd != null ? (
        <div className="flex min-h-11 items-center gap-1.5 border-t border-line-soft bg-sunken px-2.5 py-2">
          {footerStart}
          {footerEnd != null ? <span className="ml-auto flex items-center gap-1.5">{footerEnd}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

const bandVariants = cva('mx-2.5 mb-2.5 flex flex-col gap-2 rounded-card p-2.5', {
  variants: {
    tone: { warn: 'bg-warn-bg', err: 'bg-err-bg', neutral: 'bg-sunken' },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface ActivityPopoverBandProps extends Omit<ComponentProps<'div'>, 'title'> {
  tone?: 'warn' | 'err' | 'neutral';
  /** The band's first line ("Worker api-migrator asks to run"). */
  title?: ReactNode;
  /** Right of the title (mono micro: "stage 4 of 6", "HTTP 529", "exit 2"). */
  aside?: ReactNode;
}

/** The ask / error / progress block under the header. */
export function ActivityPopoverBand({ tone = 'neutral', title, aside, className, children, ...rest }: ActivityPopoverBandProps) {
  return (
    <div className={cn(bandVariants({ tone }), className)} {...rest}>
      {title != null || aside != null ? (
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-small font-medium text-fg">{title}</span>
          {aside != null ? <span className="shrink-0 font-mono text-micro text-fg-2">{aside}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** A mono excerpt inside a band (a command, an error): sunken, line border, wraps, at most 6 lines. */
export function ActivityPopoverCode({ tone = 'neutral', className, ...rest }: ComponentProps<'pre'> & { tone?: 'neutral' | 'err' }) {
  return (
    <pre
      className={cn(
        'line-clamp-6 rounded-control border border-line bg-ground px-2.5 py-2 font-mono text-small break-words whitespace-pre-wrap',
        tone === 'err' ? 'text-err' : 'text-fg',
        className,
      )}
      {...rest}
    />
  );
}

export interface ActivityPopoverSectionProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: string;
  count?: number;
}

/** A titled list under the details ("Workers · 4"). */
export function ActivityPopoverSection({ title, count, className, children, ...rest }: ActivityPopoverSectionProps) {
  return (
    <section aria-label={title} className={cn('flex flex-col gap-0.5 border-t border-line-soft px-3.5 pt-2 pb-2.5', className)} {...rest}>
      <h4 className="mb-1 text-micro font-medium text-fg-3">{count !== undefined ? `${title} · ${count}` : title}</h4>
      {children}
    </section>
  );
}

const rowGlyphTone = {
  run: 'text-run',
  ok: 'text-ok',
  warn: 'text-warn',
  err: 'text-err',
  muted: 'text-fg-3',
} as const;

export interface ActivityListRowProps extends Omit<ComponentProps<'div'>, 'title'> {
  icon: IconConcept;
  tone?: keyof typeof rowGlyphTone;
  spin?: boolean;
  /** Mono name (worker task, stage). */
  name: ReactNode;
  /** After the name, fg-3 (a model, a current step). */
  detail?: ReactNode;
  /** Right end, mono micro ("done 1:40", "queued", "failed 0:31"). */
  end?: ReactNode;
  /** Colour the end text in the tone (an ask, a failure). */
  endTone?: boolean;
}

/** One worker or stage row (22h): glyph · name · detail · end. */
export function ActivityListRow({
  icon,
  tone = 'muted',
  spin = false,
  name,
  detail,
  end,
  endTone = false,
  className,
  ...rest
}: ActivityListRowProps) {
  return (
    <div className={cn('flex min-h-5.5 min-w-0 items-center gap-2 text-small text-fg-2', className)} {...rest}>
      <Icon concept={icon} size={12} className={cn('shrink-0', rowGlyphTone[tone], spin && 'animate-spin reduced:animate-none')} />
      <span className="shrink-0 truncate font-mono text-fg">{name}</span>
      {detail != null ? <span className="min-w-0 truncate text-fg-3">{detail}</span> : null}
      {end != null ? (
        <span className={cn('ml-auto shrink-0 font-mono text-micro', endTone ? rowGlyphTone[tone] : 'text-fg-3')}>{end}</span>
      ) : null}
    </div>
  );
}
