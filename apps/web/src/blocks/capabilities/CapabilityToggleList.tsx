// ────────────────────────────────────────────────────────────────
// B-03 CapabilityToggleList (03-domain §2 B-03) — show and override skills,
// MCP servers and capability groups relative to what is inherited.
//
// Two of the three documented modes ship here (the `grid` mode — chat/stage
// binding-site overrides with an "inherited" pill and a reset icon — has no
// consumer yet; D-36 renders only what has a real caller):
//
//   `CapabilityToggleList` ("toggles"): a plain multi-select over catalog
//   entries (skills or MCP servers) — header "N/M enabled" + "Turn all on" +
//   an optional Filter, 30h rows (name + source Badge + Switch).
//
//   `ToolPolicyTriState` ("tristate"): AgentEditor's Capabilities section —
//   every group is `true` (force on) / `false` (force off) / `undefined`
//   (inherit); a SegmentedControl makes the third state a first-class option
//   instead of a Switch + a separate "reset to inherited" affordance.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { AGENT_TOOL_GROUPS, DEFAULT_AGENT_TOOL_POLICY, type AgentToolPolicy } from '@generatorai/shared';
import type { IconConcept } from '@generatorai/design-tokens';
import type { CatalogEntry } from '@/hooks/agentQueries.js';
import { cn } from '@/ui/lib/cn.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Icon } from '@/ui/icons/Icon.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';

// ── toggles ──────────────────────────────────────────────────────

export interface CapabilityToggleListProps {
  /** Header text ("Skills", "MCP servers") and the search field's accessible name. */
  label: string;
  icon: IconConcept;
  entries: CatalogEntry[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  emptyHint: string;
  disabled?: boolean;
  'data-testid'?: string;
}

/** A plain multi-select over vetted catalog entries (an agent's own skills / MCP servers). */
export function CapabilityToggleList({
  label,
  icon,
  entries,
  selectedIds,
  onChange,
  emptyHint,
  disabled = false,
  'data-testid': testId,
}: CapabilityToggleListProps) {
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.name.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q),
    );
  }, [entries, query]);

  const toggle = (id: string) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  if (entries.length === 0) {
    return <EmptyState icon={icon} title={emptyHint} />;
  }

  const allSelected = entries.length > 0 && entries.every((e) => selected.has(e.id));

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-small text-fg-3">
          {selected.size}/{entries.length} enabled
        </span>
        {!disabled ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(allSelected ? [] : entries.map((e) => e.id))}
            className="text-fg-3"
          >
            {allSelected ? 'Turn all off' : 'Turn all on'}
          </Button>
        ) : null}
      </div>

      {entries.length > 6 ? (
        <SearchInput value={query} onValueChange={setQuery} label={`Filter ${label.toLowerCase()}`} placeholder="Filter…" size="sm" />
      ) : null}

      <div className={cn('flex flex-col gap-1', visible.length > 8 && 'max-h-80 overflow-y-auto')}>
        {visible.length === 0 ? (
          <p className="px-2.5 py-3 text-center text-small text-fg-3">Nothing matches “{query}”.</p>
        ) : (
          visible.map((entry) => {
            const isOn = selected.has(entry.id);
            return (
              <div
                key={entry.id}
                data-testid={testId ? `${testId}-${entry.id}` : undefined}
                className={cn(
                  'flex min-h-8 items-center gap-2.5 rounded-control px-2.5 py-1.5 text-ui transition-control',
                  isOn ? 'bg-selected' : 'hover:bg-hover',
                )}
              >
                <Icon concept={icon} size={14} className="shrink-0 text-fg-3" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-fg">{entry.name}</div>
                  {entry.description ? <div className="truncate text-small text-fg-3">{entry.description}</div> : null}
                </div>
                <Badge tone="neutral" className="shrink-0">
                  {entry.source}
                </Badge>
                <Switch checked={isOn} disabled={disabled} onCheckedChange={() => toggle(entry.id)} aria-label={entry.name} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── tristate ─────────────────────────────────────────────────────

type TriState = 'inherit' | 'on' | 'off';

const TRISTATE_ITEMS = [
  { value: 'inherit' as const, label: 'Inherit' },
  { value: 'on' as const, label: 'On' },
  { value: 'off' as const, label: 'Off' },
];

export interface ToolPolicyTriStateProps {
  value: Partial<AgentToolPolicy>;
  onChange: (next: Partial<AgentToolPolicy>) => void;
  /** The resolved value after resolution — explains what "inherit" means here. */
  effective?: AgentToolPolicy;
  labels: Record<keyof AgentToolPolicy, string>;
  /** Groups the caller pins regardless of `value` (orchestration for orchestrators). */
  lockedGroups?: Partial<Record<keyof AgentToolPolicy, { value: boolean; reason: string }>>;
  disabled?: boolean;
  'data-testid'?: string;
}

/** Tri-state capability groups: force on / force off / inherit — the "tristate" B-03 mode. */
export function ToolPolicyTriState({
  value,
  onChange,
  effective,
  labels,
  lockedGroups,
  disabled = false,
  'data-testid': testId,
}: ToolPolicyTriStateProps) {
  const setGroup = (group: keyof AgentToolPolicy, next: TriState) => {
    const draft: Partial<AgentToolPolicy> = { ...value };
    if (next === 'inherit') delete draft[group];
    else draft[group] = next === 'on';
    onChange(draft);
  };

  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      {AGENT_TOOL_GROUPS.map((group) => {
        const locked = lockedGroups?.[group];
        const explicit = locked ? locked.value : value[group];
        const isInherited = explicit === undefined;
        // Falls back to the platform default so the row is truthful before
        // the first preview resolves, instead of reading every group as off.
        const resolved = explicit ?? effective?.[group] ?? DEFAULT_AGENT_TOOL_POLICY[group];
        const current: TriState = isInherited ? 'inherit' : explicit ? 'on' : 'off';
        const rowDisabled = disabled || !!locked;
        const items = TRISTATE_ITEMS.map((item) => ({ ...item, disabled: rowDisabled }));

        return (
          <div
            key={group}
            data-testid={testId ? `${testId}-${group}` : undefined}
            className="flex min-h-10 items-center gap-2.5 rounded-control px-2.5 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-ui text-fg">{labels[group]}</div>
              <div className="truncate font-mono text-micro text-fg-3">
                {locked ? locked.reason : isInherited ? `inherits ${resolved ? 'On' : 'Off'}` : 'set on this agent'}
              </div>
            </div>
            <SegmentedControl<TriState>
              value={current}
              onValueChange={(next) => setGroup(group, next)}
              items={items}
              label={labels[group]}
              data-testid={testId ? `${testId}-${group}-control` : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}
