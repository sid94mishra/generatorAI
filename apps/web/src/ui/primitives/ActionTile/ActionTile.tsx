// ────────────────────────────────────────────────────────────────
// P-55 ActionTile (D-134): one large button that starts an action — Home's
// quick-start tiles (C-40 QuickActions).
//
// P-48 Card chrome (`bg-raised`, 1px `line-soft`, card radius), pad 12 14,
// gap 12: a 32 icon well (`bg-selected`, control radius, `fg-2` → `fg` on
// hover) · title (`text-ui` 600) over an optional one-line description
// (`text-small text-fg-3`) · an optional trailing Kbd chord. Hover lifts the
// border to `line` and fills `hover`. A `<button>` by default; `render` swaps
// the element (a router Link) like every kit control.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';
import { Kbd } from '../Kbd/Kbd.js';

export interface ActionTileProps extends Omit<useRender.ComponentProps<'button'>, 'children' | 'title'> {
  icon: IconConcept;
  title: ReactNode;
  description?: ReactNode;
  /** One chord, already resolved for this host: `['⌘', 'N']`. */
  shortcut?: readonly string[] | undefined;
}

/** A card-sized button: icon, title, description and an optional shortcut. */
export function ActionTile({ icon, title, description, shortcut, render, ref, className, ...rest }: ActionTileProps) {
  const ownProps = {
    ...(render ? {} : { type: 'button' as const }),
    className: cn(
      'group flex min-w-0 cursor-pointer items-center gap-3 rounded-card border border-line-soft bg-raised px-3.5 py-3 text-left transition-control',
      'hover:border-line hover:bg-hover',
      focusRing,
      className,
    ),
    children: (
      <>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-selected text-fg-2 group-hover:text-fg">
          <Icon concept={icon} size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-semibold text-fg">{title}</span>
          {description != null ? <span className="truncate text-small text-fg-3">{description}</span> : null}
        </span>
        {shortcut ? <Kbd keys={shortcut} aria-hidden /> : null}
      </>
    ),
  };
  return useRender({ defaultTagName: 'button', render, ref, props: mergeProps<'button'>(rest, ownProps) });
}
