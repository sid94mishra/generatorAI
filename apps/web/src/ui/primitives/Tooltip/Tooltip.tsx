// ────────────────────────────────────────────────────────────────
// P-28 Tooltip (03 §2 P-28; Base UI Tooltip).
//
// `bg-overlay`, 1px line, `shadow-pop`, control radius, small text, pad 4 8;
// with a shortcut: 28h, gap 8 + Kbd. Opens after 400 ms, closes at once;
// never holds interactive content. The positioner carries
// `data-gai-overlay="tooltip"` (D-19) and sits on the tooltip layer (D-41).
// `children` must be ONE element that accepts props and a ref (a Button,
// IconButton, Chip or a plain element); it becomes the trigger.
// Mount one <TooltipProvider> at the app root so adjacent tooltips open
// instantly once one is showing.
// ────────────────────────────────────────────────────────────────

import type { ReactElement, ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { cn } from '../../lib/cn.js';
import { overlayProps } from '../../lib/overlay.js';
import { floatSurface } from '../../lib/popup.js';
import { Kbd } from '../Kbd/Kbd.js';

const OPEN_DELAY = 400;

export interface TooltipProviderProps {
  children?: ReactNode;
  /** Open delay in ms (default 400). */
  delay?: number;
}

/** Shares the open delay across tooltips; mount once at the app root. */
export function TooltipProvider({ children, delay = OPEN_DELAY }: TooltipProviderProps) {
  return (
    <BaseTooltip.Provider delay={delay} closeDelay={0}>
      {children}
    </BaseTooltip.Provider>
  );
}

export interface TooltipProps {
  /** The tip: short text. Never interactive content. */
  content: ReactNode;
  /** Shortcut chord shown after the text: `['Ctrl', 'K']`. */
  shortcut?: readonly string[];
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  /** Suppress the tooltip (the trigger still renders). */
  disabled?: boolean;
  /** Controlled open state (stories, tests). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The trigger element. */
  children: ReactElement;
  className?: string;
}

/** A short text tip on hover/focus of its single child. */
export function Tooltip({
  content,
  shortcut,
  side = 'top',
  align = 'center',
  disabled = false,
  open,
  onOpenChange,
  children,
  className,
}: TooltipProps) {
  return (
    <BaseTooltip.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange: (next: boolean) => onOpenChange(next) } : {})}
    >
      <BaseTooltip.Trigger render={children} delay={OPEN_DELAY} closeDelay={0} disabled={disabled} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} align={align} sideOffset={6} className="z-tooltip" {...overlayProps('tooltip')}>
          <BaseTooltip.Popup
            className={cn(
              floatSurface,
              'flex max-w-80 items-center gap-2 rounded-control px-2 py-1 text-small',
              shortcut && 'h-control py-0',
              className,
            )}
          >
            <span className="min-w-0">{content}</span>
            {shortcut ? <Kbd keys={shortcut} /> : null}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
