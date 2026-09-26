// ────────────────────────────────────────────────────────────────
// P-27 NavItem (03 §2 P-27; Rosetta `.nav`, `.nav.on`, 44h `.nav` with `.dot`).
//
// 30h (h-nav), pad 0 8, control radius, gap 10, ui 500 fg-2, 16 icon; hover
// `bg-hover text-fg`; active (`aria-current="page"`) `bg-selected text-fg`;
// trailing `count` (a Count). With `subtitle` it is the two-line 44h row of
// the sidebar's Needs you list: leading 8px StatusDot, title fg truncated,
// subtitle small fg-3. `dense` is the 28h settings-nav row. The rail's
// icon-only form is an IconButton size lg, not this component.
// Router links come in through `render`: `<NavItem render={<RouterLink to="/chats" />} …>`.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import type { IconConcept } from '@generatorai/design-tokens';
import type { StatusState } from '@generatorai/shared';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';
import { StatusDot } from '../StatusDot/StatusDot.js';

export const navItemVariants = cva(
  [
    'flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-control px-2 text-ui font-medium text-fg-2 no-underline select-none',
    'transition-control hover:bg-hover hover:text-fg',
    'data-active:bg-selected data-active:text-fg data-active:hover:bg-selected',
    focusRing,
  ],
  {
    variants: {
      layout: {
        default: 'h-nav',
        dense: 'h-step',
        twoLine: 'h-row items-start pt-1.5',
      },
    },
    defaultVariants: { layout: 'default' },
  },
);

export interface NavItemProps extends Omit<useRender.ComponentProps<'a'>, 'children'> {
  icon?: IconConcept;
  label: ReactNode;
  /** Second line: turns the row into the 44h two-line form. */
  subtitle?: ReactNode;
  /** Leading status dot (two-line rows in Needs you / Running). */
  dot?: StatusState;
  /** Trailing count, usually a <Count>. */
  count?: ReactNode;
  /** Current page: `aria-current="page"` + the selected look. */
  active?: boolean;
  /** 28h settings-nav row. */
  dense?: boolean;
}

/** One navigation row (sidebar, settings nav, link cards). */
export function NavItem({
  icon,
  label,
  subtitle,
  dot,
  count,
  active = false,
  dense = false,
  render,
  ref,
  className,
  ...rest
}: NavItemProps) {
  const twoLine = subtitle != null;
  const ownProps = {
    className: cn(navItemVariants({ layout: twoLine ? 'twoLine' : dense ? 'dense' : 'default' }), className),
    ...(active ? { 'aria-current': 'page' as const, 'data-active': '' } : {}),
    children: (
      <>
        {dot ? <StatusDot state={dot} className={twoLine ? 'mx-1 mt-1.25' : undefined} /> : null}
        {icon ? <Icon concept={icon} size={16} /> : null}
        {twoLine ? (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-ui/tight text-fg">{label}</span>
            <span className="truncate text-small/tight font-normal text-fg-3">{subtitle}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate">{label}</span>
        )}
        {count != null ? <span className="ml-auto flex shrink-0 items-center">{count}</span> : null}
      </>
    ),
  };
  return useRender({ defaultTagName: 'a', render, ref, props: mergeProps<'a'>(rest, ownProps) });
}
