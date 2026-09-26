// ────────────────────────────────────────────────────────────────
// P-36 ScrollArea (03 §2 P-36; Base UI ScrollArea). Not drawn on the boards.
//
// A scroll container with an 8px overlay scrollbar: thumb `bg-line-strong`,
// full radius, visible while hovering or scrolling. `viewportRef` exposes
// the scrolling element for virtualisation (TanStack Virtual in DataTable).
// The viewport is focusable when it scrolls, so keyboard users can scroll it.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode, Ref } from 'react';
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';

// 8px bars: 2px padding around a 4px thumb.
const scrollbarClass = cn(
  'pointer-events-none flex touch-none p-0.5 opacity-0 transition-control select-none',
  'data-hovering:pointer-events-auto data-hovering:opacity-100 data-scrolling:pointer-events-auto data-scrolling:opacity-100',
);

export interface ScrollAreaProps extends Omit<ComponentProps<typeof BaseScrollArea.Root>, 'className' | 'children'> {
  /** Ref to the scrolling viewport (virtualisers measure this element). */
  viewportRef?: Ref<HTMLDivElement>;
  /** Which scrollbars to draw. Default `vertical`. */
  orientation?: 'vertical' | 'horizontal' | 'both';
  /** Accessible name when the region is a landmark-worthy list ("Chats"). */
  label?: string;
  className?: string;
  viewportClassName?: string;
  children?: ReactNode;
}

/** A scroll region with a thin, auto-hiding scrollbar. */
export function ScrollArea({
  viewportRef,
  orientation = 'vertical',
  label,
  className,
  viewportClassName,
  children,
  ...rest
}: ScrollAreaProps) {
  const vertical = orientation !== 'horizontal';
  const horizontal = orientation !== 'vertical';
  return (
    // Base UI marks root and viewport `role="presentation"`; a plain generic is
    // the same to assistive tech and may sit inside a `role="table"`, where a
    // presentation child fails aria-required-children (DataTable body).
    <BaseScrollArea.Root role={undefined} className={cn('relative flex min-h-0 min-w-0 flex-col overflow-hidden', className)} {...rest}>
      <BaseScrollArea.Viewport
        ref={viewportRef}
        {...(label ? { role: 'region', 'aria-label': label } : { role: undefined })}
        className={cn('min-h-0 flex-1 overscroll-contain rounded-card', focusRing, viewportClassName)}
      >
        {children}
      </BaseScrollArea.Viewport>
      {vertical ? (
        <BaseScrollArea.Scrollbar orientation="vertical" className={cn(scrollbarClass, 'w-2')}>
          <BaseScrollArea.Thumb className="w-full rounded-full bg-line-strong" />
        </BaseScrollArea.Scrollbar>
      ) : null}
      {horizontal ? (
        <BaseScrollArea.Scrollbar orientation="horizontal" className={cn(scrollbarClass, 'flex-col')}>
          <BaseScrollArea.Thumb className="min-h-1 rounded-full bg-line-strong" />
        </BaseScrollArea.Scrollbar>
      ) : null}
      {vertical && horizontal ? <BaseScrollArea.Corner /> : null}
    </BaseScrollArea.Root>
  );
}
