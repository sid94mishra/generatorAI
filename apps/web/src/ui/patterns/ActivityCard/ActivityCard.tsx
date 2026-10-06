// ────────────────────────────────────────────────────────────────
// ActivityCard (D-92; boards EnhActivityCards, EnhActivityColumn) — one row
// per chat, orchestrator, workflow run or automation run in the Activity
// column.
//
//   ① kind tile 26×26 (`rounded-seg`, `bg-selected`, fg-3 glyph; a run-blue
//     dot when it finished unread) — the kind is an icon, never a colour
//   ③ title (ui 500, one line) · ⑧ time (mono micro, right)
//   ④ status line (small): glyph + text in the tone — amber for an ask, red
//     for an error; a running/done line keeps fg-2 text with a tinted glyph
//   ⑦ stage bar (workflow runs): 3px segments done / current / ask / pending
//   ⑤ meta line (micro fg-3) · ⑥ an end slot (the project)
// Tile tone: `ask` = `bg-warn-bg`, `fail` = `bg-err-bg`; `selected` (the open
// page) = `bg-selected`, or a warn ring on an ask; hover = `bg-hover` + a
// line ring. On a tint the secondary text is fg-2 (fg-3 fails 4.5:1 there).
// The board's dimmed "server offline" state is not built: there is one
// server's feed (D-92). Keyboard focus shows on the card (the link inside
// carries it).
//
// The whole card is one link (the `link` render prop, e.g. a router Link):
// a stretched `::after` makes every pixel clickable while the accessible
// name stays the title. Interactive extras (`trailing`, the workers list in
// `children`) sit above the stretch.
// ────────────────────────────────────────────────────────────────

import { useId, type ComponentProps, type ReactNode, type Ref } from 'react';
import { cva } from 'class-variance-authority';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';

export type ActivityCardTone = 'default' | 'ask' | 'fail';
export type ActivityLineTone = 'warn' | 'run' | 'err' | 'ok' | 'muted';
export type ActivityStageState = 'done' | 'current' | 'ask' | 'failed' | 'pending';

const cardVariants = cva(
  [
    'group/card relative flex min-w-0 gap-2.5 rounded-card px-2 py-1.75 text-fg transition-control',
    'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus',
  ],
  {
    variants: {
      tone: {
        default: 'hover:bg-hover hover:ring-1 hover:ring-line hover:ring-inset',
        ask: 'bg-warn-bg',
        fail: 'bg-err-bg',
      },
      selected: { true: '', false: '' },
    },
    compoundVariants: [
      { tone: 'default', selected: true, className: 'bg-selected hover:bg-selected' },
      { tone: 'ask', selected: true, className: 'ring-1 ring-warn ring-inset' },
      { tone: 'fail', selected: true, className: 'ring-1 ring-err ring-inset' },
    ],
    defaultVariants: { tone: 'default', selected: false },
  },
);

const LINE_TEXT: Record<ActivityLineTone, string> = {
  warn: 'text-warn',
  err: 'text-err',
  run: 'text-fg-2',
  ok: 'text-fg-2',
  muted: 'text-fg-2',
};

const LINE_GLYPH: Record<ActivityLineTone, string> = {
  warn: 'text-warn',
  err: 'text-err',
  run: 'text-run',
  ok: 'text-ok',
  muted: 'text-fg-3',
};

const STAGE_FILL: Record<ActivityStageState, string> = {
  done: 'bg-fg-3',
  current: 'bg-run',
  ask: 'bg-warn',
  failed: 'bg-err',
  pending: 'bg-line',
};

export interface ActivityCardLine {
  tone: ActivityLineTone;
  icon: IconConcept;
  text: ReactNode;
  /** Command, path or error text: the mono face. */
  mono?: boolean;
  /** Spin the glyph (a running step); off under reduced motion. */
  spin?: boolean;
}

export interface ActivityCardProps extends Omit<ComponentProps<'div'>, 'title' | 'children'> {
  /** ① The kind glyph and its name (read before the title by assistive tech). */
  kindIcon: IconConcept;
  kindLabel: string;
  /** ③ */
  title: string;
  /** ⑧ */
  time?: string;
  /** ④ */
  line: ActivityCardLine;
  /** After the status line's text: a DiffStat, "+1 more". */
  lineExtra?: ReactNode;
  /** ⑦ Workflow runs only. */
  stages?: readonly ActivityStageState[];
  /** ⑤ Joined with " · ". */
  meta?: readonly string[];
  /** ⑥ Right end of the meta line. */
  metaEnd?: ReactNode;
  tone?: ActivityCardTone;
  /** The page that is open. */
  selected?: boolean;
  /** Finished and not opened yet: the run-blue dot on the tile. */
  unread?: boolean;
  /** The element the card navigates with (a router Link); default `<a>`. */
  link?: useRender.RenderProp;
  /** Props for the link: `href`/`to`, `tabIndex`, key handlers, `aria-*`. */
  linkProps?: Record<string, unknown> & { ref?: Ref<HTMLElement> };
  /** A control at the title row's end, above the stretched link (expand workers). */
  trailing?: ReactNode;
  /** Below the meta line, above the stretched link (the inline workers list). */
  children?: ReactNode;
}

/** One Activity column row: kind tile, title + time, status line, stage bar, meta. */
export function ActivityCard({
  kindIcon,
  kindLabel,
  title,
  time,
  line,
  lineExtra,
  stages,
  meta,
  metaEnd,
  tone = 'default',
  selected = false,
  unread = false,
  link,
  linkProps,
  trailing,
  children,
  className,
  ...rest
}: ActivityCardProps) {
  const id = useId();
  // fg-3 is too faint on the tints (WCAG 4.5:1): secondary text steps up to fg-2 on amber, and to fg
  // on red (fg-2 on err-bg is 4.49:1 in Solarized light).
  const quiet = tone === 'default' ? 'text-fg-3' : tone === 'ask' ? 'text-fg-2' : 'text-fg';
  const hasMeta = (meta && meta.length > 0) || metaEnd != null;
  const linkElement = useRender({
    defaultTagName: 'a',
    render: link,
    props: mergeProps<'a'>(linkProps as ComponentProps<'a'>, {
      className:
        'min-w-0 truncate text-ui font-medium text-fg outline-none after:absolute after:inset-0 after:rounded-card focus-visible:outline-none',
      children: (
        <>
          <span className="sr-only">{`${kindLabel}: `}</span>
          {title}
        </>
      ),
      // The status line and meta are read after the name: "Chat: Fix flaky test — Allow git push? · Bug Fixer".
      'aria-describedby': [`${id}-line`, hasMeta ? `${id}-meta` : null, time ? `${id}-time` : null].filter(Boolean).join(' '),
      ...(selected ? { 'aria-current': 'page' as const } : {}),
    }),
  });
  return (
    <div
      data-tone={tone}
      {...(selected ? { 'data-selected': '' } : {})}
      className={cn(cardVariants({ tone, selected }), className)}
      {...rest}
    >
      <span className="relative mt-px flex size-6.5 shrink-0 items-center justify-center rounded-seg bg-selected text-fg-3" aria-hidden>
        <Icon concept={kindIcon} size={14} />
        {unread ? <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-run ring-2 ring-ground" /> : null}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-h-4.5 min-w-0 items-center gap-1.5">
          {linkElement}
          {unread ? <span className="sr-only">, not opened yet</span> : null}
          {time ? (
            <span id={`${id}-time`} className={cn('ml-auto shrink-0 font-mono text-micro tabular-nums', quiet)}>
              {time}
            </span>
          ) : null}
          {trailing != null ? <span className="relative z-10 -my-1 flex shrink-0">{trailing}</span> : null}
        </div>
        <div id={`${id}-line`} className={cn('flex min-h-4 min-w-0 items-center gap-1.25 text-small', LINE_TEXT[line.tone])}>
          <Icon
            concept={line.icon}
            size={12}
            className={cn('shrink-0', LINE_GLYPH[line.tone], line.spin && 'animate-spin reduced:animate-none')}
          />
          <span className={cn('min-w-0 truncate', line.mono && 'font-mono')}>{line.text}</span>
          {lineExtra != null ? <span className={cn('flex shrink-0 items-center gap-1', quiet)}>{lineExtra}</span> : null}
        </div>
        {stages && stages.length > 0 ? <ActivityStageBar stages={stages} /> : null}
        {hasMeta ? (
          <div id={`${id}-meta`} className={cn('flex min-h-4 min-w-0 items-center gap-1.5 text-micro', quiet)}>
            <span className="min-w-0 truncate">{meta?.join(' · ')}</span>
            {metaEnd != null ? <span className="ml-auto flex shrink-0 items-center gap-1 truncate">{metaEnd}</span> : null}
          </div>
        ) : null}
        {/* -mt-0.5 cancels the column's gap: a closed disclosure (a Reveal) adds no height. */}
        {children != null ? <div className="relative z-10 -mt-0.5">{children}</div> : null}
      </div>
    </div>
  );
}

export interface ActivityStageBarProps extends Omit<ComponentProps<'div'>, 'children'> {
  stages: readonly ActivityStageState[];
}

/** ⑦ The 3px stage segments; the label says it in words for assistive tech. */
export function ActivityStageBar({ stages, className, ...rest }: ActivityStageBarProps) {
  const done = stages.filter((s) => s === 'done').length;
  return (
    <div
      role="img"
      aria-label={`${done} of ${stages.length} stages done`}
      className={cn('my-0.5 flex h-meter gap-0.5', className)}
      {...rest}
    >
      {stages.map((stage, index) => (
        <span key={index} data-stage={stage} className={cn('flex-1 rounded-full', STAGE_FILL[stage])} />
      ))}
    </div>
  );
}
