// ────────────────────────────────────────────────────────────────
// C-21 CommandList — the command palette body (03 §3 C-21; P-19 Autocomplete
// underneath, `variant="palette"`, inline).
//
// Query row 48h (16 search glyph, `text-body` input, result count small fg-3
// on the right); listbox pad 4 0 8; group labels 28h small fg-3; options 36h,
// margin 0 6, control radius, gap 12, ui fg-2 (highlighted `bg-selected
// text-fg`), the matched text 600 fg; trailing context text, a badge and the
// shortcut chords (one Kbd per chord, "then" between the chords of a
// sequence). Footer 32h `bg-raised`, top rule: "↑↓ Navigate · ↵ Open · Tab
// Actions · Esc Close" (the caller passes the host's keys).
//
// Tab on a highlighted row that has `actions` swaps the list for that row's
// action list (Open, Open in new tab, Copy link …); Enter runs one, Escape,
// Shift+Tab or Backspace in an empty query go back to the results with the
// query restored. Rows are data; the kit never decides what an action does.
// ────────────────────────────────────────────────────────────────

import { Fragment, useRef, useState, type ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';
import {
  Autocomplete,
  HighlightMatch,
  matchesQuery,
  optionSecondaryText,
  type AutocompleteGroup,
  type AutocompleteItem,
} from '../../primitives/Autocomplete/Autocomplete.js';
import { Kbd } from '../../primitives/Kbd/Kbd.js';

/** One chord per entry; several entries = a sequence (`[['G'], ['H']]`). */
export type Chords = readonly (readonly string[])[];

export interface CommandAction extends AutocompleteItem {
  /** Chords shown on the action row (e.g. `↵` on the default action). */
  chords?: Chords;
}

export interface CommandItem extends AutocompleteItem {
  /** Trailing shortcut, one Kbd per chord. */
  chords?: Chords;
  /** Trailing badge after the context text (StatusBadge, timer). */
  badge?: ReactNode;
  /** Row actions, listed by Tab. */
  actions?: readonly CommandAction[];
  /**
   * A non-selectable note row (disabled) shown only while the query is empty,
   * e.g. "No recent chats". Not counted as a result.
   */
  note?: boolean;
}

export interface CommandGroup {
  label: string;
  items: readonly CommandItem[];
}

export interface CommandHint {
  keys: Chords;
  label: string;
  /** Push this hint (and the ones after it) to the right edge. */
  end?: boolean;
}

export interface CommandListProps {
  query: string;
  onQueryChange: (query: string) => void;
  groups: readonly CommandGroup[];
  /** Enter or click on a result row. */
  onSelect: (item: CommandItem) => void;
  /** Enter or click on one of a row's actions (after Tab). */
  onAction?: (item: CommandItem, action: CommandAction) => void;
  /** Footer hints in the results view. */
  footerHints?: readonly CommandHint[];
  /** Footer hints in a row's action list. */
  actionFooterHints?: readonly CommandHint[];
  /** Accessible name of the query input. */
  label?: string;
  placeholder?: string;
  /** Result count text; default "N results". */
  formatCount?: (count: number) => string;
  emptyText?: ReactNode;
  className?: string;
}

const DEFAULT_HINTS: readonly CommandHint[] = [
  { keys: [['↑'], ['↓']], label: 'Navigate' },
  { keys: [['↵']], label: 'Open' },
  { keys: [['Tab']], label: 'Actions' },
  { keys: [['Esc']], label: 'Close', end: true },
];

const DEFAULT_ACTION_HINTS: readonly CommandHint[] = [
  { keys: [['↑'], ['↓']], label: 'Navigate' },
  { keys: [['↵']], label: 'Run' },
  { keys: [['Esc']], label: 'Back', end: true },
];

const defaultCount = (n: number) => (n === 1 ? '1 result' : `${n} results`);
const actionCount = (n: number) => (n === 1 ? '1 action' : `${n} actions`);

/** Groups with only the rows that match `query` (notes only while it is empty); empty groups dropped. */
export function filterCommandGroups(groups: readonly CommandGroup[], query: string): CommandGroup[] {
  const blank = query.trim() === '';
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => (item.note ? blank : matchesQuery(item, query))) }))
    .filter((group) => group.items.length > 0);
}

/** Chords as Kbd boxes; a sequence reads "G then H". Decorative: the row keeps its own name. */
export function CommandChords({ chords, className }: { chords: Chords; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)} aria-hidden>
      {chords.map((keys, i) => (
        <Fragment key={i}>
          {i > 0 ? <span className={cn('text-micro', optionSecondaryText)}>then</span> : null}
          <Kbd keys={keys} />
        </Fragment>
      ))}
    </span>
  );
}

function Row({ item, query }: { item: CommandItem; query: string }) {
  return (
    <>
      <Icon concept={(item.icon ?? 'chevron-right') as IconConcept} size={16} className={cn('text-fg-3', !item.icon && 'invisible')} />
      <span className={cn('min-w-0 flex-1 truncate', item.note && 'text-fg-3')}>
        {item.note ? item.label : <HighlightMatch text={item.label} query={query} />}
      </span>
      {item.meta != null || item.badge != null || item.chords ? (
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {item.meta != null ? <span className={cn('truncate text-small', optionSecondaryText)}>{item.meta}</span> : null}
          {item.badge}
          {item.chords ? <CommandChords chords={item.chords} /> : null}
        </span>
      ) : null}
    </>
  );
}

function Footer({ hints }: { hints: readonly CommandHint[] }) {
  return (
    <div className="flex min-h-8 shrink-0 items-center gap-4 border-t border-line-soft bg-raised px-3.5 text-micro text-fg-3">
      {hints.map((hint) => (
        <span key={hint.label} className={cn('flex items-center gap-1', hint.end && 'ml-auto')}>
          <span className="flex items-center gap-0.5" aria-hidden>
            {hint.keys.map((keys, i) => (
              <Kbd key={i} keys={keys} />
            ))}
          </span>
          {hint.label}
        </span>
      ))}
    </div>
  );
}

/** Searchable, grouped command list with keyboard hints and per-row actions (Tab). */
export function CommandList({
  query,
  onQueryChange,
  groups,
  onSelect,
  onAction,
  footerHints = DEFAULT_HINTS,
  actionFooterHints = DEFAULT_ACTION_HINTS,
  label = 'Search or jump to',
  placeholder = 'Search or jump to…',
  formatCount = defaultCount,
  emptyText,
  className,
}: CommandListProps) {
  const highlighted = useRef<CommandItem | undefined>(undefined);
  // The row whose actions are listed (Tab), and the query to restore on the way back.
  const [actionsFor, setActionsFor] = useState<{ item: CommandItem; savedQuery: string } | null>(null);
  const [actionQuery, setActionQuery] = useState('');

  const back = () => {
    if (!actionsFor) return;
    onQueryChange(actionsFor.savedQuery);
    setActionsFor(null);
    setActionQuery('');
  };

  const openActions = (item: CommandItem | undefined) => {
    if (!item?.actions?.length || item.disabled) return;
    setActionsFor({ item, savedQuery: query });
    setActionQuery('');
  };

  let listGroups: AutocompleteGroup<CommandItem>[];
  let count: number;
  if (actionsFor) {
    const actions = actionsFor.item.actions ?? [];
    listGroups = filterCommandGroups([{ label: actionsFor.item.label, items: actions }], actionQuery);
    count = listGroups.reduce((n, g) => n + g.items.length, 0);
  } else {
    listGroups = filterCommandGroups(groups, query);
    count = listGroups.reduce((n, g) => n + g.items.filter((i) => !i.note).length, 0);
  }

  const currentQuery = actionsFor ? actionQuery : query;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)} data-view={actionsFor ? 'actions' : 'results'}>
      <Autocomplete<CommandItem>
        inline
        variant="palette"
        density="palette"
        label={label}
        placeholder={actionsFor ? `Actions for ${actionsFor.item.label}` : placeholder}
        value={currentQuery}
        onValueChange={actionsFor ? setActionQuery : onQueryChange}
        groups={listGroups}
        inputTrailing={actionsFor ? actionCount(count) : currentQuery.trim() ? formatCount(count) : null}
        emptyText={emptyText ?? (currentQuery.trim() ? `No results for “${currentQuery.trim()}”` : 'Nothing to show')}
        renderItem={(item, q) => <Row item={item} query={q} />}
        onItemHighlighted={(item) => {
          highlighted.current = item;
        }}
        onSelect={(item) => {
          if (actionsFor) onAction?.(actionsFor.item, item);
          else onSelect(item);
        }}
        onInputKeyDown={(event) => {
          if (event.key === 'Tab') {
            // Focus stays in the query; Tab means "actions", never "next field".
            event.preventDefault();
            event.preventBaseUIHandler();
            if (actionsFor) {
              if (event.shiftKey) back();
            } else if (!event.shiftKey) {
              openActions(highlighted.current);
            }
            return;
          }
          if (!actionsFor) return;
          if (event.key === 'Escape' || (event.key === 'Backspace' && actionQuery === '')) {
            // Back to the results; the palette itself stays open.
            event.preventDefault();
            event.stopPropagation();
            event.preventBaseUIHandler();
            back();
          }
        }}
      />
      <Footer hints={actionsFor ? actionFooterHints : footerHints} />
    </div>
  );
}
