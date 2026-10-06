// ────────────────────────────────────────────────────────────────
// P-19 Autocomplete — free text with suggestions (03 §2 P-19; Base UI
// Autocomplete). Underneath the command palette (C-21, P3-05) and, in P4,
// the composer's `/` and `@` menus.
//
// Options 30h (`density="menu"`) or 36h (`density="palette"`), highlighted
// `bg-selected text-fg`, the part of the label that matches the query in 600
// fg. Grouped lists get 28h small fg-3 group labels. Popup form: an overlay
// listbox anchored to the input (`data-gai-overlay="combobox"`, dropdown
// layer). `inline`: the list renders in place and stays open (the palette
// dialog owns the overlay attribute then).
// `variant="palette"` (with `inline`) is the command palette body (C-21): a
// borderless 48h query row (`text-body`, bottom line-soft rule, optional
// trailing slot for the result count) over a list that scrolls in place.
// Items are data: `{ value, label, … }`; `renderItem` replaces the row body.
// ────────────────────────────────────────────────────────────────

import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { Autocomplete as BaseAutocomplete } from '@base-ui/react/autocomplete';
import type { BaseUIEvent } from '@base-ui/react/types';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { fieldFocus } from '../../lib/focus.js';
import { overlayProps } from '../../lib/overlay.js';
import { anchorWidth, floatSurface, popupMotion, listPopup } from '../../lib/popup.js';
import { Icon } from '../../icons/Icon.js';
import { Kbd } from '../Kbd/Kbd.js';

export interface AutocompleteItem {
  value: string;
  label: string;
  icon?: IconConcept;
  /** Trailing context text (`text-fg-3`), e.g. the entity kind or a path. */
  meta?: ReactNode;
  /** Trailing shortcut chord. */
  shortcut?: readonly string[];
  /** Extra words that match the query but are not shown. */
  keywords?: readonly string[];
  /**
   * The caller already matched this item against the query (a server search
   * that also looks at descriptions and tags): the local filter keeps it.
   */
  preMatched?: boolean;
  disabled?: boolean;
}

export interface AutocompleteGroup<T extends AutocompleteItem = AutocompleteItem> {
  label: string;
  items: readonly T[];
}

export interface AutocompleteProps<T extends AutocompleteItem = AutocompleteItem> {
  /** Flat items … */
  items?: readonly T[];
  /** … or grouped items (group labels shown). */
  groups?: readonly AutocompleteGroup<T>[];
  /** The query text (controlled). */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Called when an option is chosen (click or Enter). */
  onSelect?: (item: T) => void;
  /** Replaces the default row body (icon · highlighted label · meta · shortcut). */
  renderItem?: (item: T, query: string) => ReactNode;
  /** Accessible name of the input. */
  label: string;
  placeholder?: string;
  /** Text when nothing matches. */
  emptyText?: ReactNode;
  /** List in place and always open (palette). Default: popup. */
  inline?: boolean;
  /** Controlled popup state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Row height: 30 (menus) or 36 (palette). */
  density?: 'menu' | 'palette';
  /** Leading glyph in the input. Default `search`. */
  icon?: IconConcept | null;
  /** `field` (default): a bordered input. `palette`: the palette's borderless query row + scrolling list. */
  variant?: 'field' | 'palette';
  /** Trailing content of the input row (the palette's result count). */
  inputTrailing?: ReactNode;
  /** Called when the highlighted item changes (keyboard, pointer or filtering). */
  onItemHighlighted?: (item: T | undefined) => void;
  /**
   * Runs before the built-in key handling of the input. Call
   * `event.preventBaseUIHandler()` to take a key over (the palette's Tab).
   */
  onInputKeyDown?: (event: BaseUIEvent<KeyboardEvent<HTMLInputElement>>) => void;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  listClassName?: string;
}

/**
 * Secondary text inside an option (meta, "then" between chords): fg-3, raised
 * to fg-2 while the row is highlighted — fg-3 on `selected` is below 4.5:1.
 */
export const optionSecondaryText = 'text-fg-3 group-data-highlighted/option:text-fg-2';

/** Case-insensitive match on label and keywords (Base UI filter signature). */
export function matchesQuery(item: AutocompleteItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q || item.preMatched) return true;
  return item.label.toLowerCase().includes(q) || (item.keywords ?? []).some((k) => k.toLowerCase().includes(q));
}

/** Splits `label` around the first match of `query` so the match renders 600 fg. */
export function HighlightMatch({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-fg">{text.slice(at, at + q.length)}</span>
      {text.slice(at + q.length)}
    </>
  );
}

/** A text input that suggests items as you type; Enter or click chooses one. */
export function Autocomplete<T extends AutocompleteItem = AutocompleteItem>({
  items,
  groups,
  value,
  onValueChange,
  onSelect,
  renderItem,
  label,
  placeholder,
  emptyText = 'No results',
  inline = false,
  open,
  onOpenChange,
  density = 'menu',
  icon = 'search',
  variant = 'field',
  inputTrailing,
  onItemHighlighted,
  onInputKeyDown,
  inputRef,
  className,
  listClassName,
}: AutocompleteProps<T>) {
  const query = value ?? '';
  const palette = variant === 'palette';
  const row = (item: T) => (
    <BaseAutocomplete.Item
      key={item.value}
      value={item}
      disabled={item.disabled}
      onClick={() => onSelect?.(item)}
      className={cn(
        'group/option flex cursor-default items-center gap-2 rounded-control-sm px-2 text-ui text-fg-2 outline-none select-none',
        'data-highlighted:bg-selected data-highlighted:text-fg data-disabled:text-fg-3',
        density === 'palette' ? 'mx-1.5 min-h-9 gap-3 rounded-control px-3' : 'min-h-item',
      )}
    >
      {renderItem ? (
        renderItem(item, query)
      ) : (
        <>
          {item.icon ? <Icon concept={item.icon} size={16} className="text-fg-3" /> : null}
          <span className="min-w-0 flex-1 truncate">
            <HighlightMatch text={item.label} query={query} />
          </span>
          {item.meta != null ? <span className={cn('shrink-0 truncate text-small', optionSecondaryText)}>{item.meta}</span> : null}
          {item.shortcut ? <Kbd keys={item.shortcut} aria-hidden /> : null}
        </>
      )}
    </BaseAutocomplete.Item>
  );

  const list = (
    <>
      <BaseAutocomplete.Empty className={cn('text-small text-fg-3 empty:hidden', palette ? 'px-4 py-3' : 'px-3 py-2')}>
        {emptyText}
      </BaseAutocomplete.Empty>
      <BaseAutocomplete.List className={cn('outline-none', listClassName)}>
        {groups
          ? (group: AutocompleteGroup<T>) => (
              <BaseAutocomplete.Group key={group.label} items={group.items as T[]} className="pb-1 last:pb-0">
                <BaseAutocomplete.GroupLabel
                  className={cn('flex h-step items-center text-small text-fg-3 select-none', density === 'palette' ? 'px-3' : 'px-2')}
                >
                  {group.label}
                </BaseAutocomplete.GroupLabel>
                <BaseAutocomplete.Collection>{(item: T) => row(item)}</BaseAutocomplete.Collection>
              </BaseAutocomplete.Group>
            )
          : (item: T) => row(item)}
      </BaseAutocomplete.List>
    </>
  );

  return (
    <BaseAutocomplete.Root
      items={(groups ?? items ?? []) as T[]}
      itemToStringValue={(item: T) => item.label}
      filter={(item: T, q: string) => matchesQuery(item, q)}
      value={value}
      onValueChange={(next) => onValueChange?.(next)}
      // Inline lists are always open: Base UI's Enter-to-choose only runs while the list is open.
      {...(open !== undefined ? { open } : inline ? { open: true } : {})}
      {...(onOpenChange ? { onOpenChange: (next: boolean) => onOpenChange(next) } : {})}
      inline={inline}
      autoHighlight={inline ? 'always' : true}
      keepHighlight={inline}
      openOnInputClick={!inline}
      {...(onItemHighlighted ? { onItemHighlighted: (item: T | undefined) => onItemHighlighted(item) } : {})}
    >
      <BaseAutocomplete.InputGroup
        className={cn(
          palette
            ? 'flex h-dialog-bar shrink-0 items-center gap-2.5 border-b border-line-soft pr-3.5 pl-4 text-fg'
            : cn(
                'flex h-control-lg items-center gap-2 rounded-control border border-line-strong bg-sunken px-2.5 text-fg transition-control',
                fieldFocus,
              ),
          className,
        )}
      >
        {icon ? <Icon concept={icon} size={16} className="text-fg-3" /> : null}
        <BaseAutocomplete.Input
          ref={inputRef}
          aria-label={label}
          placeholder={placeholder}
          onKeyDown={onInputKeyDown}
          className={cn(
            'h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-3',
            palette ? 'text-body' : 'text-ui',
          )}
        />
        {inputTrailing != null ? <span className="shrink-0 text-small text-fg-3">{inputTrailing}</span> : null}
      </BaseAutocomplete.InputGroup>
      {inline ? (
        <div className={palette ? 'min-h-0 flex-1 overflow-y-auto pt-1 pb-2' : 'py-1'}>{list}</div>
      ) : (
        <BaseAutocomplete.Portal>
          <BaseAutocomplete.Positioner sideOffset={4} align="start" className="z-dropdown outline-none" {...overlayProps('combobox')}>
            <BaseAutocomplete.Popup className={cn(floatSurface, popupMotion, listPopup, anchorWidth)}>{list}</BaseAutocomplete.Popup>
          </BaseAutocomplete.Positioner>
        </BaseAutocomplete.Portal>
      )}
    </BaseAutocomplete.Root>
  );
}
