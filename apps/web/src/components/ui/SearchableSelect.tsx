// ────────────────────────────────────────────────────────────────
// SearchableSelect — the canonical searchable dropdown picker.
// Absorbs the bespoke picker family (AgentSelector, SkillSelector,
// McpServerSelector, ProjectPicker, CodebasePicker, ArtifactPicker,
// BrowserVisibilityPicker) into one primitive.
// Built on Popover + cmdk (keyboard nav, typeahead, ARIA listbox).
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from './primitives/popover.js';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './primitives/command.js';
import { Spinner } from './Spinner.js';
import { cn } from '@/lib/utils.js';

export interface SearchableSelectItem<T> {
  item: T;
  selected: boolean;
}

export interface SearchableSelectProps<T> {
  items: T[];
  /** Currently selected key(s). Single-select: string | null. Multi: string[]. */
  value: string | string[] | null;
  /** Called with the item's key. Multi-select keeps the popover open. */
  onSelect: (key: string, item: T) => void;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  /** Extra text to match against while searching (e.g. description) */
  getSearchText?: (item: T) => string;
  /** Custom row rendering; receives selected state */
  renderItem?: (item: T, selected: boolean) => React.ReactNode;
  /** Custom trigger label when a value is selected (single-select) */
  renderValue?: (item: T) => React.ReactNode;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Show a loading spinner in the list (async item sources) */
  loading?: boolean;
  multiple?: boolean;
  /** Show a clear (×) affordance when a value is selected (single-select) */
  clearable?: boolean;
  onClear?: () => void;
  className?: string;
  /** Width class for the popover; defaults to trigger width */
  contentClassName?: string;
  'data-testid'?: string;
  /** Accessible name for the trigger (required when there is no visible <label>). */
  'aria-label'?: string;
  /** id of a visible label element naming this control. */
  'aria-labelledby'?: string;
  /** Optional id for the trigger, for `<label htmlFor>` association. */
  id?: string;
}

export function SearchableSelect<T>({
  items,
  value,
  onSelect,
  getKey,
  getLabel,
  getSearchText,
  renderItem,
  renderValue,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results found.',
  disabled = false,
  loading = false,
  multiple = false,
  clearable = false,
  onClear,
  className,
  contentClassName,
  'data-testid': dataTestId,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  id,
}: SearchableSelectProps<T>) {
  const [open, setOpen] = useState(false);

  const selectedKeys = new Set(
    value == null ? [] : Array.isArray(value) ? value : [value],
  );
  const selectedItems = items.filter((i) => selectedKeys.has(getKey(i)));
  const single = !multiple ? selectedItems[0] : undefined;

  const triggerLabel =
    multiple && selectedItems.length > 0
      ? `${selectedItems.length} selected`
      : single
        ? renderValue
          ? renderValue(single)
          : getLabel(single)
        : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          disabled={disabled}
          data-testid={dataTestId}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm',
            'transition-colors hover:border-[color-mix(in_srgb,var(--primary)_50%,var(--border))]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-60',
            triggerLabel ? 'text-foreground' : 'text-muted-foreground',
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">{triggerLabel ?? placeholder}</span>
          <span className="flex shrink-0 items-center gap-1">
            {clearable && (single || selectedItems.length > 0) && (
              <span
                role="button"
                aria-label="Clear selection"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  onClear?.();
                }}
                className="rounded p-0.5 text-muted-foreground hover:bg-subtle hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('w-[var(--radix-popover-trigger-width)] p-0', contentClassName)}
      >
        <Command
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Spinner size="sm" /> Loading…
              </div>
            ) : (
              <>
                <CommandEmpty>{emptyText}</CommandEmpty>
                <CommandGroup>
                  {items.map((item) => {
                    const key = getKey(item);
                    const selected = selectedKeys.has(key);
                    const searchValue = getSearchText
                      ? `${getLabel(item)} ${getSearchText(item)}`
                      : getLabel(item);
                    return (
                      <CommandItem
                        key={key}
                        value={searchValue}
                        onSelect={() => {
                          onSelect(key, item);
                          if (!multiple) setOpen(false);
                        }}
                      >
                        {renderItem ? (
                          renderItem(item, selected)
                        ) : (
                          <span className="min-w-0 flex-1 truncate">{getLabel(item)}</span>
                        )}
                        <Check
                          className={cn(
                            'ml-auto h-3.5 w-3.5 shrink-0 text-primary',
                            selected ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
