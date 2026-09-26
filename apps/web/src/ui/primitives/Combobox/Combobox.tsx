// ────────────────────────────────────────────────────────────────
// P-18 Combobox — searchable single / multi select (03 §2 P-18; Base UI
// Combobox). The shell of the project, codebase, timezone, model (P4) and
// agent (P5) pickers. Replaces `components/ui/SearchableSelect.tsx` (deleted
// with the legacy layer, 03 §8).
//
// Two anatomies:
// - `variant="trigger"` (default): a 32h field-look button showing the
//   selection (or chips when `multiple`); the popup holds a 32h search row,
//   the grouped list and, with `detail`, a detail pane beside the list.
// - `variant="field"`: the search input IS the field (Base UI's input-outside
//   pattern); with `multiple` the chips wrap inside it and each has a remove
//   button (Base UI Chips / Chip / ChipRemove).
// Options 30h (`min-h-item`), highlighted `bg-selected text-fg`, the query
// match in 600 fg, a trailing check on selected rows; group labels 28h
// (`h-step`) small fg-3. The popup is a D-19 overlay
// (`data-gai-overlay="combobox"` on the Positioner, dropdown layer).
//
// Values are the items' string `value`s: `string | null` single, `string[]`
// multiple. `detail(item)` renders the highlighted item (falls back to the
// single selection). Width: the popup is at least the trigger's width; with
// `detail` it defaults to 620 (model picker; the agent picker passes 760).
// Those two widths are board geometry without a SHELL token, so they arrive as
// a number and are applied as computed inline geometry.
// ────────────────────────────────────────────────────────────────

import { useId, useMemo, useRef, useState, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { fieldFocus, focusRing, hitSlop, HIT_ATTRS } from '../../lib/focus.js';
import { overlayProps } from '../../lib/overlay.js';
import { anchorWidth, floatSurface, listPopup } from '../../lib/popup.js';
import { Icon } from '../../icons/Icon.js';
import { HighlightMatch, matchesQuery, optionSecondaryText } from '../Autocomplete/Autocomplete.js';
import { chipVariants } from '../Chip/Chip.js';

export interface ComboboxItem {
  value: string;
  label: string;
  icon?: IconConcept;
  /** Trailing context text (`text-fg-3`), e.g. a provider or a path. */
  meta?: ReactNode;
  /** Extra words that match the query but are not shown. */
  keywords?: readonly string[];
  disabled?: boolean;
}

export interface ComboboxGroup<T extends ComboboxItem = ComboboxItem> {
  label: string;
  items: readonly T[];
}

type RootAttributes = Omit<
  HTMLAttributes<HTMLElement>,
  'children' | 'defaultValue' | 'onChange' | 'onSelect' | 'placeholder' | 'title' | 'color'
>;

interface ComboboxCommonProps<T extends ComboboxItem> extends RootAttributes {
  /** Flat items … */
  items?: readonly T[];
  /** … or grouped items (28h group labels). */
  groups?: readonly ComboboxGroup<T>[];
  /** Replaces the default row body (icon · highlighted label · meta). The selected check stays. */
  renderItem?: (item: T, query: string) => ReactNode;
  /** Detail pane beside the list for the highlighted item (model / agent pickers). */
  detail?: (item: T) => ReactNode;
  /** Popup width in px. Default: the trigger's width, or 620 with `detail`. */
  width?: number;
  /** Accessible name of the control (and of the popup). */
  label: string;
  /** Trigger text when nothing is selected; the field's placeholder in `variant="field"`. */
  placeholder?: string;
  /** Placeholder of the popup's search row (`variant="trigger"`). Default "Search". */
  searchPlaceholder?: string;
  /** Text when nothing matches. */
  emptyText?: ReactNode;
  /** Controlled popup state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** `trigger` (default): a button that opens a searchable popup. `field`: the search input is the field. */
  variant?: 'trigger' | 'field';
  /** Leading glyph of the trigger / field. */
  icon?: IconConcept;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** Extra classes for the popup (a fixed picker height such as `h-96`). */
  popupClassName?: string;
}

export interface ComboboxSingleProps<T extends ComboboxItem = ComboboxItem> extends ComboboxCommonProps<T> {
  multiple?: false;
  value: string | null;
  onValueChange: (value: string | null) => void;
}

export interface ComboboxMultipleProps<T extends ComboboxItem = ComboboxItem> extends ComboboxCommonProps<T> {
  multiple: true;
  value: readonly string[];
  onValueChange: (value: string[]) => void;
}

export type ComboboxProps<T extends ComboboxItem = ComboboxItem> = ComboboxSingleProps<T> | ComboboxMultipleProps<T>;

/** Popup width with a detail pane when the caller gives none (ComposerModelPicker 620×384). */
const DETAIL_POPUP_WIDTH = 620;
/** Chips shown in a `trigger` before the rest collapse into "+N". */
const TRIGGER_CHIPS = 2;

const triggerClasses = cn(
  'inline-flex h-control-lg min-w-0 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-sunken px-2.5 text-left text-ui text-fg',
  'transition-control data-popup-open:border-focus disabled:cursor-not-allowed disabled:text-fg-3',
  focusRing,
);

const fieldClasses = cn(
  'flex min-h-control-lg min-w-0 items-center gap-2 rounded-control border border-line-strong bg-sunken px-2.5 text-fg transition-control',
  fieldFocus,
);

/** A searchable select: one value or several (chips), grouped options, optional detail pane. */
export function Combobox<T extends ComboboxItem = ComboboxItem>(props: ComboboxProps<T>) {
  const {
    items,
    groups,
    renderItem,
    detail,
    width,
    label,
    placeholder,
    searchPlaceholder = 'Search',
    emptyText = 'No results',
    open,
    onOpenChange,
    variant = 'trigger',
    icon,
    disabled,
    inputRef,
    popupClassName,
    className,
    multiple,
    value,
    onValueChange,
    ...rest
  } = props;

  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState<T | undefined>(undefined);
  const chipsRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const valueId = useId();

  const byValue = useMemo(() => {
    const flat = groups ? groups.flatMap((group) => group.items) : (items ?? []);
    return new Map(flat.map((item) => [item.value, item]));
  }, [groups, items]);

  // Base UI selects the item objects themselves; the kit's API is their string values.
  const selected = useMemo<T | T[] | null>(() => {
    if (Array.isArray(value)) return value.flatMap((v: string) => byValue.get(v) ?? []);
    return typeof value === 'string' ? (byValue.get(value) ?? null) : null;
  }, [value, byValue]);

  // `multiple` discriminates the union, so each branch calls the matching callback shape.
  const handleValueChange = (next: T | T[] | null) => {
    if (multiple) (onValueChange as ComboboxMultipleProps<T>['onValueChange'])(Array.isArray(next) ? next.map((item) => item.value) : []);
    else (onValueChange as ComboboxSingleProps<T>['onValueChange'])(next && !Array.isArray(next) ? next.value : null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setHighlighted(undefined);
    onOpenChange?.(next);
  };

  const field = variant === 'field';
  const hasDetail = detail !== undefined;
  const popupWidth = width ?? (hasDetail ? DETAIL_POPUP_WIDTH : undefined);
  const detailItem = highlighted ?? (selected && !Array.isArray(selected) ? selected : undefined);

  const row = (item: T) => (
    <BaseCombobox.Item
      key={item.value}
      value={item}
      disabled={item.disabled}
      className={cn(
        'group/option flex min-h-item cursor-default items-center gap-2 rounded-control-sm px-2 text-ui text-fg-2 outline-none select-none',
        'data-highlighted:bg-selected data-highlighted:text-fg data-selected:text-fg data-disabled:text-fg-3',
      )}
    >
      {renderItem ? (
        <span className="flex min-w-0 flex-1 items-center gap-2">{renderItem(item, query)}</span>
      ) : (
        <>
          {item.icon ? <Icon concept={item.icon} size={16} className="text-fg-3" /> : null}
          <span className="min-w-0 flex-1 truncate">
            <HighlightMatch text={item.label} query={query} />
          </span>
          {item.meta != null ? <span className={cn('shrink-0 truncate text-small', optionSecondaryText)}>{item.meta}</span> : null}
        </>
      )}
      <BaseCombobox.ItemIndicator className="flex shrink-0 text-fg">
        <Icon concept="check" size={14} />
      </BaseCombobox.ItemIndicator>
    </BaseCombobox.Item>
  );

  const list = (
    <>
      <BaseCombobox.Empty className="px-3 py-2 text-small text-fg-3 empty:hidden">{emptyText}</BaseCombobox.Empty>
      <BaseCombobox.List className="min-h-0 flex-1 overflow-y-auto p-1 outline-none empty:hidden">
        {groups
          ? (group: ComboboxGroup<T>) => (
              <BaseCombobox.Group key={group.label} items={group.items as T[]} className="pb-1 last:pb-0">
                <BaseCombobox.GroupLabel className="flex h-step items-center px-2 text-small text-fg-3 select-none">
                  {group.label}
                </BaseCombobox.GroupLabel>
                <BaseCombobox.Collection>{(item: T) => row(item)}</BaseCombobox.Collection>
              </BaseCombobox.Group>
            )
          : (item: T) => row(item)}
      </BaseCombobox.List>
    </>
  );

  const searchRow = (
    <div className="flex h-control-lg shrink-0 items-center gap-2 border-b border-line-soft px-2.5 text-fg">
      <Icon concept="search" size={14} className="text-fg-3" />
      <BaseCombobox.Input
        ref={inputRef}
        aria-label={`Search ${label}`}
        placeholder={searchPlaceholder}
        className="h-full min-w-0 flex-1 bg-transparent text-ui outline-none placeholder:text-fg-3"
      />
    </div>
  );

  const popup = (
    <BaseCombobox.Portal>
      <BaseCombobox.Positioner
        sideOffset={4}
        align="start"
        className="z-dropdown outline-none"
        {...(field && multiple ? { anchor: chipsRef } : {})}
        {...overlayProps('combobox')}
      >
        <BaseCombobox.Popup
          // The input-inside-popup form is a dialog (Base UI); name it.
          {...(field ? {} : { 'aria-label': label })}
          className={cn(floatSurface, listPopup, anchorWidth, 'flex flex-col overflow-hidden p-0', popupClassName)}
          style={popupWidth !== undefined ? { width: popupWidth } : undefined}
        >
          <div className="flex min-h-0 flex-1">
            <div className={cn('flex min-h-0 flex-col', hasDetail ? 'w-2/5 shrink-0' : 'min-w-0 flex-1')}>
              {field ? null : searchRow}
              {list}
            </div>
            {hasDetail ? (
              <div className="min-w-0 flex-1 overflow-y-auto border-l border-line-soft p-3" data-testid="combobox-detail">
                {detailItem ? detail(detailItem) : null}
              </div>
            ) : null}
          </div>
        </BaseCombobox.Popup>
      </BaseCombobox.Positioner>
    </BaseCombobox.Portal>
  );

  const leading = icon ? <Icon concept={icon} size={16} className="shrink-0 text-fg-3" /> : null;

  let control: ReactNode;
  if (!field) {
    control = (
      <BaseCombobox.Trigger
        {...rest}
        aria-labelledby={`${labelId} ${valueId}`}
        className={cn(triggerClasses, className)}
      >
        <span id={labelId} className="sr-only">
          {label}
        </span>
        {leading}
        <span id={valueId} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          <BaseCombobox.Value>
            {(current: T | T[] | null) => <TriggerValue current={current} placeholder={placeholder} />}
          </BaseCombobox.Value>
        </span>
        <Icon concept="chevron-down" size={14} className="shrink-0 text-fg-3" />
      </BaseCombobox.Trigger>
    );
  } else if (multiple) {
    control = (
      <BaseCombobox.Chips {...rest} ref={chipsRef} className={cn(fieldClasses, 'flex-wrap gap-1 py-0.5', className)}>
        {leading}
        <BaseCombobox.Value>
          {(current: T[]) => (
            <>
              {current.map((item) => (
                <BaseCombobox.Chip
                  key={item.value}
                  aria-label={item.label}
                  className={cn(chipVariants({ size: 'sm', removable: true }), focusRing)}
                >
                  <span className="min-w-0 truncate">{item.label}</span>
                  <BaseCombobox.ChipRemove
                    aria-label={`Remove ${item.label}`}
                    className={cn(
                      'inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-badge text-fg-3',
                      'transition-control hover:bg-hover hover:text-fg',
                      hitSlop,
                    )}
                    {...HIT_ATTRS}
                  >
                    <Icon concept="x" size={12} />
                  </BaseCombobox.ChipRemove>
                </BaseCombobox.Chip>
              ))}
              <BaseCombobox.Input
                ref={inputRef}
                aria-label={label}
                placeholder={current.length > 0 ? '' : placeholder}
                // min-h-6: the input keeps a 24px target at compact density (WCAG 2.5.8).
                className="h-control-sm min-h-6 min-w-16 flex-1 bg-transparent text-ui outline-none placeholder:text-fg-3"
              />
            </>
          )}
        </BaseCombobox.Value>
      </BaseCombobox.Chips>
    );
  } else {
    control = (
      <BaseCombobox.InputGroup {...rest} className={cn(fieldClasses, 'h-control-lg', className)}>
        {leading ?? <Icon concept="search" size={16} className="shrink-0 text-fg-3" />}
        <BaseCombobox.Input
          ref={inputRef}
          aria-label={label}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent text-ui outline-none placeholder:text-fg-3"
        />
        <BaseCombobox.Trigger
          aria-label={`Show ${label} options`}
          className={cn(
            'inline-flex size-control-sm shrink-0 cursor-pointer items-center justify-center rounded-control-sm text-fg-3',
            'transition-control hover:bg-hover hover:text-fg',
            hitSlop,
            focusRing,
          )}
          {...HIT_ATTRS}
        >
          <Icon concept="chevron-down" size={14} />
        </BaseCombobox.Trigger>
      </BaseCombobox.InputGroup>
    );
  }

  return (
    <BaseCombobox.Root<T, boolean>
      items={(groups ?? items ?? []) as T[]}
      multiple={Boolean(multiple)}
      value={selected}
      onValueChange={(next) => handleValueChange(next)}
      itemToStringLabel={(item: T) => item.label}
      itemToStringValue={(item: T) => item.value}
      isItemEqualToValue={(a: T, b: T) => a.value === b.value}
      filter={(item: T, q: string) => matchesQuery(item, q)}
      onInputValueChange={(next) => setQuery(next)}
      onItemHighlighted={(item) => {
        // Keep the last highlighted item while the pointer crosses a gap, so the detail pane does not flicker.
        if (item) setHighlighted(item);
      }}
      {...(open !== undefined ? { open } : {})}
      onOpenChange={(next) => handleOpenChange(next)}
      autoHighlight
      disabled={disabled}
    >
      {control}
      {popup}
    </BaseCombobox.Root>
  );
}

/** The trigger's selection: the label, "+N"-capped chips (multiple) or the placeholder. */
function TriggerValue<T extends ComboboxItem>({ current, placeholder }: { current: T | T[] | null; placeholder: string | undefined }) {
  if (Array.isArray(current)) {
    if (current.length === 0) return <span className="truncate text-fg-3">{placeholder}</span>;
    const shown = current.slice(0, TRIGGER_CHIPS);
    const hidden = current.length - shown.length;
    return (
      <>
        {shown.map((item) => (
          <span key={item.value} className={cn(chipVariants({ size: 'sm' }), 'min-w-0')}>
            <span className="min-w-0 truncate">{item.label}</span>
          </span>
        ))}
        {hidden > 0 ? <span className={cn(chipVariants({ size: 'sm' }), 'text-fg-3')}>+{hidden}</span> : null}
      </>
    );
  }
  if (!current) return <span className="truncate text-fg-3">{placeholder}</span>;
  return <span className="truncate">{current.label}</span>;
}
