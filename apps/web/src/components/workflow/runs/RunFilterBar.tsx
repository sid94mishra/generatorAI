// ────────────────────────────────────────────────────────────────
// RunFilterBar — search and filters of a run list (P07 WP-7.6): the run
// name or id, statuses, trigger kinds, a creation date range and variable
// values (`name=value`). The filters become the server's run search
// (`GET /workflow-runs`), so a list shows exactly the runs that match.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Filter, X } from 'lucide-react';
import { WORKFLOW_RUN_STATES } from '@generatorai/workflow-spec';
import type { WorkflowRunListFilter } from '@generatorai/shared';
import { cn } from '@/lib/utils.js';
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
} from '@/components/ui/index.js';

/** What started a run (`WorkflowRun.trigger.kind`); a run without a trigger is `user`. */
export const RUN_TRIGGER_KINDS: ReadonlyArray<{ kind: string; label: string }> = [
  { kind: 'user', label: 'A person' },
  { kind: 'automation', label: 'An automation' },
  { kind: 'fork', label: 'A fork (re-run)' },
  { kind: 'stage', label: 'A parent workflow' },
  { kind: 'chat', label: 'A chat' },
  { kind: 'orchestrator', label: 'An orchestrator' },
  { kind: 'external_agent', label: 'An external agent' },
];

export interface RunFilters {
  q: string;
  statuses: string[];
  triggers: string[];
  /** `yyyy-mm-dd`, inclusive, in local time. */
  from: string;
  to: string;
  variables: Array<{ name: string; value: string }>;
}

export const EMPTY_RUN_FILTERS: RunFilters = { q: '', statuses: [], triggers: [], from: '', to: '', variables: [] };

/** How many filters (not the search text) are set. */
export function activeFilterCount(f: RunFilters): number {
  return f.statuses.length + f.triggers.length + (f.from ? 1 : 0) + (f.to ? 1 : 0) + f.variables.length;
}

/** The server search of a set of filters. */
export function toRunListFilter(f: RunFilters, base: WorkflowRunListFilter = {}): WorkflowRunListFilter {
  const day = (d: string, end: boolean) => {
    const [y, m, dd] = d.split('-').map(Number);
    return end ? new Date(y!, m! - 1, dd!, 23, 59, 59, 999) : new Date(y!, m! - 1, dd!);
  };
  return {
    ...base,
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
    ...(f.statuses.length ? { status: f.statuses } : {}),
    ...(f.triggers.length ? { trigger: f.triggers } : {}),
    ...(f.from ? { from: day(f.from, false).toISOString() } : {}),
    ...(f.to ? { to: day(f.to, true).toISOString() } : {}),
    ...(f.variables.length ? { variables: Object.fromEntries(f.variables.map((v) => [v.name, v.value])) } : {}),
  };
}

const VARIABLE_ENTRY = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

interface RunFilterBarProps {
  value: RunFilters;
  onChange: (next: RunFilters) => void;
  className?: string;
}

export function RunFilterBar({ value, onChange, className }: RunFilterBarProps) {
  const [variableDraft, setVariableDraft] = useState('');
  const [variableError, setVariableError] = useState<string | null>(null);
  const count = activeFilterCount(value);
  const set = (patch: Partial<RunFilters>) => onChange({ ...value, ...patch });

  const addVariable = () => {
    const m = VARIABLE_ENTRY.exec(variableDraft);
    if (!m) {
      setVariableError('Write name=value');
      return;
    }
    const name = m[1]!;
    set({ variables: [...value.variables.filter((v) => v.name !== name), { name, value: m[2]!.trim() }] });
    setVariableDraft('');
    setVariableError(null);
  };

  const triggerLabel = (kind: string) => RUN_TRIGGER_KINDS.find((t) => t.kind === kind)?.label ?? kind;

  return (
    <div className={cn('space-y-2', className)} data-testid="run-filter-bar">
      <div className="flex items-center gap-1.5">
        <SearchInput
          value={value.q}
          onChange={(q) => set({ q })}
          placeholder="Search runs by name or id"
          className="min-w-0 flex-1"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={count > 0 ? 'primary' : 'secondary'}
              size="sm"
              leftIcon={<Filter className="h-3.5 w-3.5" />}
              aria-label="Filter runs"
            >
              {count > 0 ? count : 'Filter'}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3 p-3">
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-foreground">Status</legend>
              <div className="grid grid-cols-2 gap-1">
                {WORKFLOW_RUN_STATES.map((s) => (
                  <label key={s} className="flex items-center gap-1.5 text-xs text-foreground">
                    <Checkbox
                      checked={value.statuses.includes(s)}
                      onCheckedChange={() => set({ statuses: toggle(value.statuses, s) })}
                      aria-label={`Status ${s}`}
                    />
                    {s}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-foreground">Started by</legend>
              <div className="space-y-1">
                {RUN_TRIGGER_KINDS.map((t) => (
                  <label key={t.kind} className="flex items-center gap-1.5 text-xs text-foreground">
                    <Checkbox
                      checked={value.triggers.includes(t.kind)}
                      onCheckedChange={() => set({ triggers: toggle(value.triggers, t.kind) })}
                      aria-label={`Trigger ${t.kind}`}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-foreground">Created</legend>
              <div className="grid grid-cols-2 gap-1.5">
                <Input type="date" value={value.from} onChange={(e) => set({ from: e.target.value })} aria-label="Created from" className="h-8 text-xs" />
                <Input type="date" value={value.to} onChange={(e) => set({ to: e.target.value })} aria-label="Created to" className="h-8 text-xs" />
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-foreground">Variable</legend>
              <div className="flex items-center gap-1.5">
                <Input
                  value={variableDraft}
                  onChange={(e) => {
                    setVariableDraft(e.target.value);
                    setVariableError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addVariable();
                    }
                  }}
                  placeholder="name=value"
                  aria-label="Variable filter"
                  className="h-8 font-mono text-xs"
                />
                <Button size="sm" variant="secondary" onClick={addVariable} disabled={!variableDraft.trim()}>
                  Add
                </Button>
              </div>
              {variableError && <p className="mt-1 text-[11px] text-danger">{variableError}</p>}
            </fieldset>
            {count > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onChange({ ...EMPTY_RUN_FILTERS, q: value.q })}>
                Clear filters
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {count > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {value.statuses.map((s) => (
            <FilterChip key={`s:${s}`} label={s} onRemove={() => set({ statuses: value.statuses.filter((v) => v !== s) })} />
          ))}
          {value.triggers.map((t) => (
            <FilterChip key={`t:${t}`} label={triggerLabel(t)} onRemove={() => set({ triggers: value.triggers.filter((v) => v !== t) })} />
          ))}
          {value.from && <FilterChip label={`from ${value.from}`} onRemove={() => set({ from: '' })} />}
          {value.to && <FilterChip label={`to ${value.to}`} onRemove={() => set({ to: '' })} />}
          {value.variables.map((v) => (
            <FilterChip
              key={`v:${v.name}`}
              label={`${v.name}=${v.value}`}
              mono
              onRemove={() => set({ variables: value.variables.filter((x) => x.name !== v.name) })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onRemove, mono }: { label: string; onRemove: () => void; mono?: boolean }) {
  return (
    <Badge tone="neutral" size="sm" className={cn('max-w-full gap-0.5 pr-0.5', mono && 'font-mono')}>
      <span className="truncate">{label}</span>
      <Button
        variant="unstyled"
        onClick={onRemove}
        aria-label={`Remove filter ${label}`}
        className="rounded-full p-0.5 hover:bg-subtle"
      >
        <X className="h-2.5 w-2.5" />
      </Button>
    </Badge>
  );
}
