// ────────────────────────────────────────────────────────────────
// C-08 ActivityRow (03 §3 C-08): Home "Needs you"/"Running"/"Recently
// finished" rows, DesktopWindows.
//
// 44h (`twoLine`: 56h, `h-footer`), pad 0 10 0 14, gap 3 (12 desktop), border-b
// `line-soft`: the state glyph (D-18 shared map, 16px) · `title` (500, grows
// or a fixed column) · `context` (`font-mono text-micro text-fg-3`) · `detail`
// (`text-small text-fg-2`, grows; may hold InlineCode/DiffStat) · `time`
// (`font-mono text-micro text-fg-3`, right) · one ib-sm `actions` node.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { STATUS_STATE_DEFS, type StatusState } from '@generatorai/shared';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';
import { STATUS_TONE_TEXT } from '../../primitives/StatusBadge/StatusBadge.js';

export interface ActivityRowProps extends Omit<ComponentProps<'div'>, 'title'> {
  status: StatusState;
  title: ReactNode;
  context?: ReactNode;
  detail?: ReactNode;
  time?: ReactNode;
  actions?: ReactNode;
  /** 56h with room for two lines of `detail` under the title. */
  twoLine?: boolean;
}

/** One activity list row: status glyph, title, live detail, timer, actions. */
export function ActivityRow({ status, title, context, detail, time, actions, twoLine = false, className, ...rest }: ActivityRowProps) {
  const def = STATUS_STATE_DEFS[status];
  return (
    <div
      className={cn(
        'group/row flex min-w-0 items-center gap-3 border-b border-line-soft py-1 pr-2.5 pl-3.5 text-fg last:border-b-0',
        twoLine ? 'min-h-footer' : 'min-h-row',
        className,
      )}
      {...rest}
    >
      <Icon
        concept={def.glyph as IconConcept}
        size={16}
        className={cn('shrink-0', STATUS_TONE_TEXT[def.tone], def.spin && 'animate-spin reduced:animate-none')}
      />
      <div className={cn('flex min-w-0 flex-col', twoLine ? 'flex-1 gap-0.5' : 'w-46 shrink-0')}>
        <div className="min-w-0 truncate text-ui font-medium">{title}</div>
        {twoLine && detail != null ? <div className="min-w-0 truncate text-small text-fg-2">{detail}</div> : null}
      </div>
      {context != null ? <div className="w-29 shrink-0 truncate font-mono text-micro text-fg-3">{context}</div> : null}
      {!twoLine && detail != null ? <div className="min-w-0 flex-1 truncate text-small text-fg-2">{detail}</div> : null}
      {time != null ? <div className="w-10 shrink-0 text-right font-mono text-micro text-fg-3">{time}</div> : null}
      {actions != null ? (
        <div className="shrink-0 opacity-0 transition-control group-hover/row:opacity-100 group-focus-within/row:opacity-100">{actions}</div>
      ) : null}
    </div>
  );
}
