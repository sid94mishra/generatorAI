// ────────────────────────────────────────────────────────────────
// A checkbox list over catalog entries (skills or MCP servers) — the
// WorkflowStageTools board rows: checkbox · glyph · mono name · muted
// description · "From agent" lock badge or the source. A locked row is an
// entry the bound agent grants: a binding site only adds to an agent's
// capabilities, so it shows checked and cannot be unchecked here (removal
// is an explicit override under "Customize capabilities").
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import type { CatalogEntry } from '@/hooks/agentQueries.js';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { InspectorNote } from '../../../fields/InspectorLayout.js';

export interface CatalogChecklistProps {
  /** Plural noun for the search field and the empty text ("skills", "MCP servers"). */
  noun: string;
  icon: IconConcept;
  entries: readonly CatalogEntry[];
  isOn: (id: string) => boolean;
  /** Entries granted by the bound agent: checked, locked, "From agent". */
  inherited?: ReadonlySet<string>;
  /** Entries the agent grants that stay toggleable (a badge only). */
  fromAgent?: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
  loading?: boolean;
  emptyText: string;
  disabled?: boolean;
  /** Row test id (`capability-<id>` in the overrides editor). */
  rowTestId?: (id: string) => string;
  'data-testid'?: string;
}

/** Search (over 6 entries) + the checkbox rows. */
export function CatalogChecklist({
  noun,
  icon,
  entries,
  isOn,
  inherited,
  fromAgent,
  onToggle,
  loading = false,
  emptyText,
  disabled = false,
  rowTestId,
  'data-testid': testId,
}: CatalogChecklistProps) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q));
  }, [entries, query]);

  if (loading) return <SkeletonRows rows={3} />;
  if (entries.length === 0) return <InspectorNote>{emptyText}</InspectorNote>;

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      {entries.length > 6 ? (
        <SearchInput value={query} onValueChange={setQuery} label={`Search ${noun}`} placeholder={`Search ${noun}`} size="sm" shortcut={null} />
      ) : null}
      <ul className={cn('flex flex-col', visible.length > 10 && 'max-h-80 overflow-y-auto')}>
        {visible.length === 0 ? (
          <li className="px-2 py-3 text-center text-small text-fg-3">Nothing matches “{query}”.</li>
        ) : (
          visible.map((entry) => {
            const locked = inherited?.has(entry.id) ?? false;
            const on = locked || isOn(entry.id);
            const agentBadge = locked || (fromAgent?.has(entry.id) ?? false);
            return (
              <li
                key={entry.id}
                data-testid={rowTestId?.(entry.id)}
                className={cn('flex min-h-7 items-center gap-2 rounded-control px-1.5 py-1', !disabled && !locked && 'hover:bg-hover')}
              >
                <Checkbox
                  checked={on}
                  disabled={disabled || locked}
                  onCheckedChange={(next) => onToggle(entry.id, next)}
                  aria-label={entry.name}
                />
                <Icon concept={icon} size={14} className="shrink-0 text-fg-3" />
                <span className="max-w-40 shrink-0 truncate font-mono text-ui text-fg">{entry.name}</span>
                <span className="min-w-0 flex-1 truncate text-small text-fg-3">{entry.description}</span>
                {agentBadge ? (
                  <Badge icon={locked ? 'lock' : 'agents'} className="shrink-0">
                    From agent
                  </Badge>
                ) : (
                  <span className="shrink-0 text-small text-fg-3 capitalize">{entry.source}</span>
                )}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
