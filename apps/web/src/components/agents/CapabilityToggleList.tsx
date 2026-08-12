// ────────────────────────────────────────────────────────────────
// CapabilityToggleList — a checkbox list over catalog entries (skills or
// MCP servers) driven by an explicit id set.
//
// `inheritedIds` renders entries the AGENT already grants at a binding site:
// they are shown checked and locked, because a binding site can only ADD to
// an agent's capabilities (the union rule) or explicitly remove them via the
// separate remove control — silently unchecking would misrepresent the
// resolver's behaviour.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/index.js';
import { Switch } from '@/components/ui/primitives/switch.js';
import { cn } from '@/lib/utils.js';
import type { CatalogEntry } from './useAgentCatalog.js';

export interface CapabilityToggleListProps {
  entries: CatalogEntry[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** Ids granted by the bound agent — checked, and unchecking records a removal. */
  inheritedIds?: string[];
  /** Ids explicitly removed at this binding site. */
  removedIds?: string[];
  onRemovedChange?: (ids: string[]) => void;
  icon: React.ElementType;
  emptyHint: string;
  disabled?: boolean;
  searchable?: boolean;
  'data-testid'?: string;
}

export function CapabilityToggleList({
  entries,
  selectedIds,
  onChange,
  inheritedIds = [],
  removedIds = [],
  onRemovedChange,
  icon: Icon,
  emptyHint,
  disabled = false,
  searchable = true,
  'data-testid': testId,
}: CapabilityToggleListProps) {
  const [query, setQuery] = useState('');

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const inherited = useMemo(() => new Set(inheritedIds), [inheritedIds]);
  const removed = useMemo(() => new Set(removedIds), [removedIds]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.name.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q),
    );
  }, [entries, query]);

  const toggle = (id: string) => {
    if (disabled) return;
    if (inherited.has(id)) {
      // Inherited from the agent → the only meaningful action is remove/restore.
      if (!onRemovedChange) return;
      const next = new Set(removed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onRemovedChange([...next]);
      return;
    }
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <Icon className="mx-auto mb-1.5 h-6 w-6 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }

  const activeCount = entries.filter(
    (e) => (selected.has(e.id) || inherited.has(e.id)) && !removed.has(e.id),
  ).length;
  const selectableIds = entries.filter((e) => !inherited.has(e.id)).map((e) => e.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {activeCount}/{entries.length} enabled
        </span>
        {!disabled && selectableIds.length > 0 && (
          <button
            type="button"
            onClick={() => onChange(allSelected ? [] : selectableIds)}
            className="text-[10px] font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            {allSelected ? 'Turn all off' : 'Turn all on'}
          </button>
        )}
      </div>

      {searchable && entries.length > 6 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="max-h-56 space-y-1 overflow-y-auto pr-0.5">
        {visible.map((entry) => {
          const isInherited = inherited.has(entry.id);
          const isRemoved = removed.has(entry.id);
          const isOn = (selected.has(entry.id) || isInherited) && !isRemoved;
          const locked = disabled || (isInherited && !onRemovedChange);
          return (
            <div
              key={entry.id}
              data-testid={`capability-${entry.id}`}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs transition-all',
                isOn
                  ? 'border border-primary/20 bg-primary/5'
                  : 'border border-transparent opacity-70 hover:bg-subtle',
                locked && 'opacity-50',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{entry.name}</div>
                {entry.description && (
                  <div className="truncate text-[10px] text-muted-foreground">
                    {entry.description}
                  </div>
                )}
              </div>
              {isInherited && (
                <Badge tone="primary" size="sm" className="text-[9px]">
                  from agent
                </Badge>
              )}
              <Badge
                tone={entry.source === 'system' ? 'info' : 'success'}
                size="sm"
                className="text-[9px]"
              >
                {entry.source}
              </Badge>
              <Switch
                checked={isOn}
                disabled={locked}
                onCheckedChange={() => toggle(entry.id)}
                aria-label={entry.name}
              />
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="px-2.5 py-3 text-center text-[11px] text-muted-foreground">
            Nothing matches “{query}”.
          </p>
        )}
      </div>
    </div>
  );
}
