// ────────────────────────────────────────────────────────────────
// C-07 EntityRow (03 §3 C-07): a list row outside a table (SettingsSecurity,
// Scripts, AutomationDetail, Home link cards).
//
// 16px leading icon · two-line text (`title` `text-ui` 500, `subtitle`
// `text-small text-fg-3` lh 1.35) · `meta` · trailing `actions`. `height`
// defaults to 44 (`h-row`); 36 for compact card lists, 56 for a two-line row
// with actions. `variant="nav"` (a master-detail list item): pad 8 10,
// `rounded-control`, `selected` → `bg-selected`, the subtitle indents 22px
// under the icon.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';

export interface EntityRowProps extends Omit<ComponentProps<'div'>, 'title'> {
  icon?: IconConcept;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  variant?: 'row' | 'nav';
  height?: 36 | 44 | 56;
}

// 36 reuses `h-tab` (the only named token at that height, D-15) for compact card lists.
const HEIGHT: Record<36 | 44 | 56, string> = { 36: 'min-h-tab', 44: 'min-h-row', 56: 'min-h-footer' };

/** A row of an entity list: icon, two-line text, meta, actions. */
export function EntityRow({
  icon,
  title,
  subtitle,
  meta,
  actions,
  selected = false,
  variant = 'row',
  height = 44,
  className,
  ...rest
}: EntityRowProps) {
  const nav = variant === 'nav';
  return (
    <div
      className={cn(
        'group/row flex min-w-0 items-center gap-2.5 text-fg',
        HEIGHT[height],
        nav ? cn('rounded-control px-2.5 py-2', selected && 'bg-selected') : 'border-b border-line-soft px-3.5 last:border-b-0',
        !nav && selected && 'bg-selected',
        className,
      )}
      {...rest}
    >
      {icon ? <Icon concept={icon} size={16} className="shrink-0 text-fg-3" /> : null}
      <div className={cn('flex min-w-0 flex-1 flex-col justify-center', subtitle != null && 'gap-0.5')}>
        <div className="min-w-0 truncate text-ui font-medium">{title}</div>
        {subtitle != null ? (
          <div className={cn('min-w-0 truncate text-small text-fg-3', nav && icon != null && 'pl-5.5')}>{subtitle}</div>
        ) : null}
      </div>
      {meta != null ? <div className="shrink-0 text-small text-fg-3">{meta}</div> : null}
      {actions != null ? (
        <div className="ml-auto flex shrink-0 items-center gap-1 opacity-0 transition-control group-hover/row:opacity-100 group-focus-within/row:opacity-100">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
