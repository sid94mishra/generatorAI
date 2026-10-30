// ────────────────────────────────────────────────────────────────
// P-17 Select (03 §2 P-17; Base UI Select; Rosetta `button.inp` with a
// value/meta/chevron → a Menu-styled popup).
//
// Trigger: P-13 Input chrome (`h-control-lg`, `line-strong` border,
// `bg-sunken`) — optional leading icon, the selected label, optional trailing
// mono meta (`font-mono text-micro text-fg-3`), chevron `ml-auto text-fg-3`.
// Popup: P-30 Menu box (`bg-overlay`, line border, card radius, `shadow-pop`,
// pad 4) of 30h (`min-h-item`) options with a trailing check on the selected
// row. Not searchable — that is P-18 Combobox. The popup is a D-19 overlay
// (`data-gai-overlay="select"`).
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { fieldFocus, fieldInvalid } from '../../lib/focus.js';
import { overlayProps } from '../../lib/overlay.js';
import { anchorWidth, floatSurface, popupMotion, listPopup } from '../../lib/popup.js';
import { Icon } from '../../icons/Icon.js';

export interface SelectItem {
  value: string;
  label: ReactNode;
  /** Trailing mono context text (a provider, a unit). */
  meta?: ReactNode;
  icon?: IconConcept;
  /** A custom leading glyph in place of `icon` (a provider logo, D-132). Decorative: `label` names the item. */
  leading?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  items: readonly SelectItem[];
  size?: 'sm' | 'md';
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Accessible name when there is no visible `<Field label>` wrapping this select. */
  'aria-label'?: string;
  className?: string;
  id?: string;
}

/** A single-choice dropdown; use Combobox instead when the list needs search. */
export function Select({
  value,
  onValueChange,
  items,
  size = 'md',
  placeholder = 'Select…',
  invalid = false,
  disabled,
  className,
  ...rest
}: SelectProps) {
  const byValue = new Map(items.map((item) => [item.value, item]));

  return (
    <BaseSelect.Root<string, false>
      items={items as { value: string; label: ReactNode }[]}
      value={value}
      onValueChange={(next) => onValueChange(next)}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        {...rest}
        disabled={disabled}
        className={cn(
          'inline-flex min-w-0 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-sunken px-2.5 text-left text-ui text-fg transition-control',
          size === 'sm' ? 'h-control' : 'h-control-lg',
          invalid ? fieldInvalid : fieldFocus,
          'data-disabled:cursor-not-allowed data-disabled:text-fg-3',
          className,
        )}
      >
        <BaseSelect.Value className="min-w-0 flex-1 truncate">
          {(itemValue: string | null) => {
            const item = itemValue != null ? byValue.get(itemValue) : undefined;
            if (!item) return <span className="text-fg-3">{placeholder}</span>;
            return (
              <span className="flex min-w-0 items-center gap-2">
                {item.leading ?? (item.icon ? <Icon concept={item.icon} size={16} className="shrink-0 text-fg-3" /> : null)}
                <span className="min-w-0 truncate">{item.label}</span>
                {item.meta != null ? <span className="shrink-0 truncate font-mono text-micro text-fg-3">{item.meta}</span> : null}
              </span>
            );
          }}
        </BaseSelect.Value>
        <Icon concept="chevron-down" size={14} className="ml-auto shrink-0 text-fg-3" />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} align="start" className="z-dropdown outline-none" {...overlayProps('select')}>
          <BaseSelect.Popup className={cn(floatSurface, popupMotion, listPopup, anchorWidth)}>
            <BaseSelect.List>
              {items.map((item) => (
                <BaseSelect.Item
                  key={item.value}
                  value={item.value}
                  disabled={item.disabled}
                  className={cn(
                    'flex min-h-item cursor-default items-center gap-2 rounded-control-sm px-2 text-ui text-fg outline-none select-none',
                    'data-highlighted:bg-selected data-disabled:cursor-not-allowed data-disabled:text-fg-3',
                  )}
                >
                  {item.leading ?? (item.icon ? <Icon concept={item.icon} size={16} className="shrink-0 text-fg-3" /> : null)}
                  <BaseSelect.ItemText className="min-w-0 flex-1 truncate">{item.label}</BaseSelect.ItemText>
                  {item.meta != null ? <span className="shrink-0 truncate font-mono text-micro text-fg-3">{item.meta}</span> : null}
                  <BaseSelect.ItemIndicator className="flex shrink-0 text-fg">
                    <Icon concept="check" size={14} />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
