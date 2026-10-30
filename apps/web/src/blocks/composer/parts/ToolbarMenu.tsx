// ────────────────────────────────────────────────────────────────
// Toolbar chips and their upward menus (F-composer-07/08/09/10).
//
// The per-turn chips (Agent mode, Effort, Context window, More options) open
// a small list ABOVE the chip (ComposerStates "Per-turn controls"). Only one
// is open at a time and the composer host owns that state, plus the outside
// click / capture-phase Escape that closes it, so the lists are plain
// anchored panels here rather than kit Menus: the mode / effort / tier lists
// are listboxes of options (the chips' contract), the overflow is a group of
// buttons.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode, Ref } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '@/ui/lib/cn.js';
import { overlayProps } from '@/ui/lib/overlay.js';
import { floatSurface } from '@/ui/lib/popup.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { chipVariants } from '@/ui/primitives/Chip/Chip.js';

export interface ToolbarChipProps extends Omit<ComponentProps<typeof Button>, 'children' | 'variant' | 'size' | 'icon'> {
  icon?: IconConcept;
  /** The chip is showing a non-default choice (e.g. Plan mode): accent text. */
  accent?: boolean;
  /** Trailing chevron (a menu trigger). */
  chevron?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/** A borderless 24h toolbar chip (the composer's per-turn controls). */
export function ToolbarChip({ icon, accent = false, chevron = true, className, children, ...rest }: ToolbarChipProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        chipVariants({ variant: 'ghost', interactive: true }),
        'gap-1 px-1.5 text-small font-medium text-fg-2 aria-expanded:bg-selected aria-expanded:text-fg',
        accent && 'text-accent hover:not-disabled:text-accent',
        className,
      )}
      {...(icon ? { icon } : {})}
      {...(chevron ? { trailingIcon: 'chevron-down' as const } : {})}
      {...rest}
    >
      {children}
    </Button>
  );
}

export interface ToolbarPopupProps extends ComponentProps<'div'> {
  /** Panel width (Tailwind width class, e.g. `w-64`). */
  widthClass: string;
  align?: 'start' | 'end';
}

/** The panel a toolbar chip opens, directly above it. */
export function ToolbarPopup({ widthClass, align = 'start', className, children, ...rest }: ToolbarPopupProps) {
  return (
    <div
      {...overlayProps('menu')}
      className={cn(
        floatSurface,
        'absolute bottom-full z-dropdown mb-1.5 rounded-card p-1',
        align === 'start' ? 'left-0' : 'right-0',
        widthClass,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** 26h small fg-3 header row of a toolbar panel ("Agent mode", "Reasoning effort"). */
export function ToolbarPopupHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('flex h-step items-center px-2 text-small text-fg-3 select-none', className)}>{children}</p>;
}

export interface ToolbarOptionProps extends Omit<ComponentProps<typeof Button>, 'children' | 'variant' | 'size'> {
  selected: boolean;
  /** `option` inside a listbox (the chips); `button` inside the overflow group. */
  asOption?: boolean;
  /** Second line (mode descriptions). */
  description?: ReactNode;
  /** Right-aligned mono figure (a tier's token count). */
  trailing?: ReactNode;
  children: ReactNode;
}

/** One row of a toolbar panel: check column, label (+ description), trailing figure. */
export function ToolbarOption({
  selected,
  asOption = true,
  description,
  trailing,
  className,
  children,
  ...rest
}: ToolbarOptionProps) {
  return (
    <Button
      variant="ghost"
      className={cn(
        // The kit button wraps its content in one span; let it take the row.
        'h-auto min-h-item w-full justify-start rounded-control-sm px-2 py-1.5 text-left font-normal text-fg *:flex-1',
        selected && 'bg-selected',
        className,
      )}
      {...(asOption ? { role: 'option', 'aria-selected': selected } : {})}
      {...rest}
    >
      <span className="flex w-full items-start gap-2">
        <span className="flex min-h-4.5 w-3.5 shrink-0 items-center justify-center">
          {selected ? <Icon concept="check" size={14} /> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-ui">{children}</span>
          {/* On the selected row fg-3 misses AA against bg-selected, so secondary text steps up to fg-2. */}
          {description != null ? (
            <span className={cn('text-small whitespace-normal', selected ? 'text-fg-2' : 'text-fg-3')}>{description}</span>
          ) : null}
        </span>
        {trailing != null ? (
          <span className={cn('shrink-0 self-center font-mono text-micro', selected ? 'text-fg-2' : 'text-fg-3')}>{trailing}</span>
        ) : null}
      </span>
    </Button>
  );
}
