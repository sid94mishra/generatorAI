// ────────────────────────────────────────────────────────────────
// P-29 Popover — an anchored panel with interactive content (03 §2 P-29;
// Base UI Popover). Used by the composer's gauge / sources / skills
// popovers and the model and agent pickers (P4-08).
//
// Box: `bg-overlay`, 1px line, card radius, `shadow-pop`; padding is the
// caller's (pickers are edge-to-edge, small popovers pad 12). The positioner
// carries `data-gai-overlay="popover"` (D-19) and sits on the popover layer
// (D-41). Triggers take any element through `render`:
// `<PopoverTrigger render={<Chip interactive label="Sources" />} />`.
// Dismissal (outside press, Escape) and focus return are Base UI's.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { cn } from '../../lib/cn.js';
import { overlayProps } from '../../lib/overlay.js';
import { floatSurface } from '../../lib/popup.js';

/** Popover state container (open / onOpenChange, modal). All Base UI Popover.Root props. */
export const PopoverRoot = BasePopover.Root;
/** The element that opens the popover; pass the visible control through `render`. */
export const PopoverTrigger = BasePopover.Trigger;
/** A button inside the popup that closes it. */
export const PopoverClose = BasePopover.Close;
/** The popup's accessible title (styled by the caller). */
export const PopoverTitle = BasePopover.Title;

type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';

export interface PopoverPopupProps extends Omit<ComponentProps<typeof BasePopover.Popup>, 'className'> {
  side?: Side;
  align?: Align;
  sideOffset?: number;
  className?: string;
}

/** Portal + positioner + the styled popup box. */
export function PopoverPopup({ side = 'bottom', align = 'start', sideOffset = 6, className, children, ...rest }: PopoverPopupProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-popover outline-none"
        {...overlayProps('popover')}
      >
        <BasePopover.Popup className={cn(floatSurface, 'rounded-card text-ui outline-none', className)} {...rest}>
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}
