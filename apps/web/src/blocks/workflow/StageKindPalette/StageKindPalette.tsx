// ────────────────────────────────────────────────────────────────
// WF-16 StageKindPalette — the body of the builder's 390px "Add stage"
// popover (03-domain §WF-16; boards WorkflowLoopBuilder, WorkflowAgentDraft).
//
// A search field ("Search stage kinds") over the stage kinds — glyph, name,
// one-line hint, an "Admin" chip on kinds that need admin:settings — and,
// when the caller passes them, a "Templates" group (the spec's presets). ↑↓
// move, Enter picks (the Autocomplete primitive, inline). A footnote points
// at "Wrap in loop" for stages that already exist.
// Plain data in, one `onPick` out: the block never adds anything itself.
// ────────────────────────────────────────────────────────────────

import { useState, type ReactNode, type Ref } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import {
  Autocomplete,
  HighlightMatch,
  optionSecondaryText,
  type AutocompleteGroup,
  type AutocompleteItem,
} from '@/ui/primitives/Autocomplete/Autocomplete.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Kbd } from '@/ui/primitives/Kbd/Kbd.js';

export interface StageKindOption<K extends string = string> {
  kind: K;
  icon: IconConcept;
  /** "Agent", "Command" … */
  name: string;
  /** One line on what the kind does. */
  hint: string;
  /** Saving it needs admin:settings: shows the "Admin" chip. */
  admin?: boolean;
}

export interface StageTemplateOption {
  id: string;
  title: string;
  description: string;
}

export type StageKindPick<K extends string = string> = { type: 'kind'; kind: K } | { type: 'template'; id: string };

interface PaletteItem extends AutocompleteItem {
  row: 'kind' | 'template' | 'note';
  hint: string;
  admin?: boolean;
  pick?: StageKindPick;
}

export interface StageKindPaletteProps<K extends string = string> {
  kinds: readonly StageKindOption<K>[];
  /** Stage templates. `null` while they load; omit for no Templates group. */
  templates?: readonly StageTemplateOption[] | null;
  onPick: (pick: StageKindPick<K>) => void;
  /** Controlled query (default: internal). */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Replaces the default "Wrap in loop" footnote; `null` hides it. */
  footnote?: ReactNode;
  /** The search field (a popover focuses it on open). */
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}

const DEFAULT_FOOTNOTE = (
  <>
    To loop stages you already have, select them and choose <span className="font-medium text-fg-2">Wrap in loop</span>.
  </>
);

function kindItem<K extends string>(option: StageKindOption<K>): PaletteItem {
  return {
    value: `kind:${option.kind}`,
    label: option.name,
    icon: option.icon,
    keywords: [option.kind, option.hint],
    row: 'kind',
    hint: option.hint,
    ...(option.admin ? { admin: true } : {}),
    pick: { type: 'kind', kind: option.kind },
  };
}

function templateItem(template: StageTemplateOption): PaletteItem {
  return {
    value: `template:${template.id}`,
    label: template.title,
    icon: 'layout',
    keywords: [template.description, 'template'],
    row: 'template',
    hint: template.description,
    pick: { type: 'template', id: template.id },
  };
}

const LOADING_ITEM: PaletteItem = {
  value: 'template:loading',
  label: 'Loading templates…',
  row: 'note',
  hint: '',
  disabled: true,
  preMatched: true,
};

function Row({ item, query }: { item: PaletteItem; query: string }) {
  if (item.row === 'note') return <span className="text-small text-fg-3">{item.label}</span>;
  return (
    <>
      {item.icon ? <Icon concept={item.icon} size={14} className="text-fg-3" /> : null}
      <span className={cn('shrink-0 truncate font-medium text-fg', item.row === 'kind' ? 'w-22' : 'max-w-45')}>
        <HighlightMatch text={item.label} query={query} />
      </span>
      <span className={cn('min-w-0 flex-1 truncate text-small', optionSecondaryText)}>{item.hint}</span>
      {item.admin ? (
        <Chip size="sm" icon="lock">
          Admin
        </Chip>
      ) : null}
      <Kbd keys="↵" aria-hidden className="hidden group-data-highlighted/option:inline-flex" />
    </>
  );
}

/** Searchable list of stage kinds (and templates) for the builder's Add stage popover. */
export function StageKindPalette<K extends string = string>({
  kinds,
  templates,
  onPick,
  query: controlledQuery,
  onQueryChange,
  footnote = DEFAULT_FOOTNOTE,
  inputRef,
  className,
}: StageKindPaletteProps<K>) {
  const [ownQuery, setOwnQuery] = useState('');
  const query = controlledQuery ?? ownQuery;
  const setQuery = (next: string) => {
    if (controlledQuery === undefined) setOwnQuery(next);
    onQueryChange?.(next);
  };

  const groups: AutocompleteGroup<PaletteItem>[] = [{ label: 'Stage kinds', items: kinds.map(kindItem) }];
  if (templates !== undefined) {
    groups.push({ label: 'Templates', items: templates === null ? [LOADING_ITEM] : templates.map(templateItem) });
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <Autocomplete<PaletteItem>
        inline
        label="Search stage kinds"
        placeholder="Search stage kinds"
        value={query}
        onValueChange={setQuery}
        groups={groups}
        emptyText="No stage kind or template matches."
        renderItem={(item, q) => <Row item={item} query={q} />}
        onSelect={(item) => {
          if (item.pick) onPick(item.pick as StageKindPick<K>);
        }}
        listClassName="max-h-90 overflow-y-auto"
        {...(inputRef ? { inputRef } : {})}
      />
      {footnote !== null ? (
        <div className="flex gap-2 border-t border-line-soft px-2 pt-2 pb-1 text-small text-fg-3">
          <Icon concept="info" size={14} className="mt-0.5" />
          <span>{footnote}</span>
        </div>
      ) : null}
    </div>
  );
}
