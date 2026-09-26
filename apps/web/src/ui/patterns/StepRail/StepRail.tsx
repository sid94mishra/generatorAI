// ────────────────────────────────────────────────────────────────
// C-25 StepRail — a vertical timeline of steps (03 §3 C-25; Rosetta "28h rows
// + absolute 1px line at left 9"; board StepRow28).
//
// A 1px `bg-line` rule at x=9, inset 14 top and bottom (from the first glyph's
// centre to the last one's), behind the glyphs. Rows are 28h (`h-step`,
// density-aware), inline gap 10: 16 glyph (status or tool icon, from the
// caller) · verb (ui 500) · target (mono small fg-2, truncated) · result
// (small, `resultTone`, or any node such as a DiffStat) · duration (mono micro
// fg-3, pushed right) · a chevron on `expandable` rows. An expandable row is a
// Base UI Collapsible: the row is the trigger (aria-expanded), `detail`
// (typically a CodeBlock) opens below it indented 24.
//
// Expansion is controlled with `expandedIds` + `onExpandedChange`, or left to
// the rail (`defaultExpandedIds`).
// ────────────────────────────────────────────────────────────────

import { useState, type ComponentProps, type ReactNode } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';

export type StepResultTone = 'neutral' | 'muted' | 'run' | 'ok' | 'warn' | 'err';

const RESULT_TONE: Record<StepResultTone, string> = {
  neutral: 'text-fg-2',
  muted: 'text-fg-3',
  run: 'text-run',
  ok: 'text-ok',
  warn: 'text-warn',
  err: 'text-err',
};

export interface StepRailItem {
  id: string;
  /** 16px status or tool glyph (`<Icon concept="status-succeeded" />`, a Spinner …). */
  glyph: ReactNode;
  /** "Read", "Edit", "Ran" … */
  verb: ReactNode;
  /** File path, command, URL (mono, truncated). */
  target?: ReactNode;
  /** Outcome: text coloured by `resultTone`, or a node (DiffStat). */
  result?: ReactNode;
  resultTone?: StepResultTone;
  /** Duration text ("1.2s"). */
  time?: ReactNode;
  /** The row opens `detail` (needs `detail`). */
  expandable?: boolean;
  /** Expanded content, indented 24 (CodeBlock, output). */
  detail?: ReactNode;
  /** `data-testid` of the row. */
  testId?: string;
}

export interface StepRailProps extends Omit<ComponentProps<'div'>, 'children'> {
  items: readonly StepRailItem[];
  /** Controlled: ids of the open rows. */
  expandedIds?: readonly string[];
  /** Uncontrolled start state. */
  defaultExpandedIds?: readonly string[];
  onExpandedChange?: (id: string, expanded: boolean) => void;
  /** Accessible name of the list ("Steps"). */
  label?: string;
}

const rowBase = 'flex h-step w-full min-w-0 items-center gap-2.5 text-left text-ui text-fg';

function RowBody({ item, expandable }: { item: StepRailItem; expandable: boolean }) {
  const tone: StepResultTone = item.resultTone ?? 'neutral';
  return (
    <>
      {/* `relative` paints the glyph above the rail line. */}
      <span className="relative flex size-4 shrink-0 items-center justify-center">{item.glyph}</span>
      <span className="shrink-0 font-medium">{item.verb}</span>
      {item.target != null ? <span className="min-w-0 truncate font-mono text-small text-fg-2">{item.target}</span> : null}
      {item.result != null ? (
        <span className={cn('shrink-0 text-small', RESULT_TONE[tone])}>{item.result}</span>
      ) : null}
      {item.time != null || expandable ? (
        <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          {item.time != null ? <span className="font-mono text-micro text-fg-3">{item.time}</span> : null}
          {expandable ? (
            <Icon
              concept="chevron-right"
              size={14}
              className="text-fg-3 transition-transform group-data-panel-open:rotate-90"
            />
          ) : null}
        </span>
      ) : null}
    </>
  );
}

/** A vertical step timeline with optional expandable detail per row. */
export function StepRail({
  items,
  expandedIds,
  defaultExpandedIds,
  onExpandedChange,
  label,
  className,
  ...rest
}: StepRailProps) {
  const [ownExpanded, setOwnExpanded] = useState<readonly string[]>(defaultExpandedIds ?? []);
  const expanded = expandedIds ?? ownExpanded;

  const setExpanded = (id: string, open: boolean) => {
    if (expandedIds === undefined) {
      setOwnExpanded((prev) => (open ? [...prev.filter((x) => x !== id), id] : prev.filter((x) => x !== id)));
    }
    onExpandedChange?.(id, open);
  };

  return (
    <div className={cn('relative min-w-0', className)} {...rest}>
      {items.length > 1 ? (
        // x = 9 (under the 16px glyph column, which starts at 2), inset 14 = half a 28h row.
        <span aria-hidden className="pointer-events-none absolute top-3.5 bottom-3.5 left-2.25 w-px bg-line" />
      ) : null}
      <ol aria-label={label} className="flex min-w-0 flex-col">
        {items.map((item) => {
          const expandable = Boolean(item.expandable && item.detail != null);
          if (!expandable) {
            return (
              <li key={item.id} className={cn(rowBase, 'pl-0.5')} data-testid={item.testId}>
                <RowBody item={item} expandable={false} />
              </li>
            );
          }
          return (
            <Collapsible.Root
              key={item.id}
              open={expanded.includes(item.id)}
              onOpenChange={(open) => setExpanded(item.id, open)}
              render={<li />}
              className="flex min-w-0 flex-col"
              data-testid={item.testId}
            >
              <Collapsible.Trigger
                className={cn(
                  rowBase,
                  'group cursor-pointer rounded-control-sm pl-0.5 transition-control hover:bg-hover',
                  focusRing,
                )}
              >
                <RowBody item={item} expandable />
              </Collapsible.Trigger>
              <Collapsible.Panel className="min-w-0 pt-1 pb-2 pl-6">{item.detail}</Collapsible.Panel>
            </Collapsible.Root>
          );
        })}
      </ol>
    </div>
  );
}
