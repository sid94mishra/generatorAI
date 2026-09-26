// ────────────────────────────────────────────────────────────────
// P-17 Select — a non-searchable single choice (03 §2 P-17; Base UI Select).
//
// Trigger styled as the field (`button.inp`): value · optional meta (mono
// micro fg-3) · chevron `ml-auto text-fg-3`; `sm` 28h (dense toolbars such as
// the Changes dock's "Compare against"), `md` 32h. The popup is the Menu box
// (overlay, card radius, pad 4) with 30h options and a leading check column
// on the selected one; it is at least as wide as the trigger. The trigger has
// `role="combobox"` and shows the selected label; the popup is a `listbox` of
// `option`s (Base UI). Pulled forward from P5 by P4-09 (the Changes panel's
// compare picker). Searchable lists use Combobox (P-18) instead.
//
// Base UI 1.8 ignores a click that carries no pointer data (detail 0, no
// pointerType: some assistive tech, scripted clicks) unless the option is
// already highlighted; here every such activation commits, like the Radix
// select this replaces.
// ────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { fieldFocus } from '../../lib/focus.js';
import { overlayProps } from '../../lib/overlay.js';
import { anchorWidth, floatSurface, listPopup } from '../../lib/popup.js';
import { Icon } from '../../icons/Icon.js';

export interface SelectItem<V extends string = string> {
  value: V;
  label: string;
  /** Trailing context in the option and the trigger (mono micro fg-3). */
  meta?: ReactNode;
  icon?: IconConcept;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> {
  value: V | null;
  onValueChange: (value: V) => void;
  items: readonly SelectItem<V>[];
  /** Accessible name of the trigger ("Compare against"). */
  label: string;
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  size?: 'sm' | 'md';
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** A single choice from a short, fixed list. */
export function Select<V extends string = string>({
  value,
  onValueChange,
  items,
  label,
  placeholder,
  size = 'md',
  invalid = false,
  disabled = false,
  className,
  'data-testid': testId,
}: SelectProps<V>) {
  const selected = items.find((item) => item.value === value) ?? null;
  const [open, setOpen] = useState(false);
  return (
    <BaseSelect.Root<V>
      open={open}
      onOpenChange={setOpen}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        aria-label={label}
        aria-invalid={invalid || undefined}
        data-testid={testId}
        className={cn(
          'flex min-w-0 cursor-pointer items-center gap-1.5 rounded-control border border-line-strong bg-sunken text-left text-fg transition-control select-none',
          'data-disabled:cursor-not-allowed data-disabled:text-fg-3 data-popup-open:border-focus',
          size === 'sm' ? 'h-control-sm px-2 text-small' : 'h-control px-2.5 text-ui',
          invalid ? 'border-err' : fieldFocus,
          className,
        )}
      >
        {selected?.icon ? <Icon concept={selected.icon} size={14} className="text-fg-2" /> : null}
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-fg-3')}>{selected?.label ?? placeholder ?? ''}</span>
        {selected?.meta != null ? <span className="shrink-0 font-mono text-micro text-fg-3">{selected.meta}</span> : null}
        <Icon concept="chevron-down" size={14} className="ml-auto text-fg-3" />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          alignItemWithTrigger={false}
          side="bottom"
          align="start"
          sideOffset={4}
          className="z-dropdown outline-none"
          {...overlayProps('select')}
        >
          <BaseSelect.Popup aria-label={label} className={cn(floatSurface, listPopup, anchorWidth)}>
            {items.map((item) => (
              <BaseSelect.Item
                key={item.value}
                value={item.value}
                disabled={item.disabled}
                onClick={(event) => {
                  if (item.disabled || event.nativeEvent.detail !== 0) return;
                  onValueChange(item.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex min-h-item w-full cursor-default items-center gap-2 rounded-control-sm px-2 text-ui text-fg outline-none select-none',
                  'data-highlighted:bg-selected data-disabled:cursor-not-allowed data-disabled:text-fg-3',
                )}
              >
                <span className="flex w-3.5 shrink-0 items-center justify-center">
                  <BaseSelect.ItemIndicator>
                    <Icon concept="check" size={14} />
                  </BaseSelect.ItemIndicator>
                </span>
                {item.icon ? <Icon concept={item.icon} size={16} className="text-fg-2" /> : null}
                <BaseSelect.ItemText className="min-w-0 flex-1 truncate">{item.label}</BaseSelect.ItemText>
                {item.meta != null ? <span className="shrink-0 font-mono text-micro text-fg-3">{item.meta}</span> : null}
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
