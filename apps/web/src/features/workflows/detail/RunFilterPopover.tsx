// ────────────────────────────────────────────────────────────────
// The run list's filter popover and active-filter chips (P07 WP-7.6, ported
// onto the kit): statuses, who started the run, a created date range and
// variable values (`name=value`).
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { WORKFLOW_RUN_STATES } from '@generatorai/workflow-spec';
import { RUN_TRIGGERS } from '@/blocks/workflow/index.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Field, Fieldset } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';
import { EMPTY_RUN_FILTERS, activeFilterCount, parseVariableFilter, toggle, type RunFilters } from './runFilters.js';

const triggerLabel = (kind: string) => RUN_TRIGGERS.find((t) => t.kind === kind)?.filterLabel ?? kind;

export function RunFilterPopover({ value, onChange }: { value: RunFilters; onChange: (next: RunFilters) => void }) {
  const [variableDraft, setVariableDraft] = useState('');
  const [variableError, setVariableError] = useState<string | null>(null);
  const count = activeFilterCount(value);
  const set = (patch: Partial<RunFilters>) => onChange({ ...value, ...patch });

  const addVariable = () => {
    const entry = parseVariableFilter(variableDraft);
    if (!entry) {
      setVariableError('Write name=value');
      return;
    }
    set({ variables: [...value.variables.filter((v) => v.name !== entry.name), entry] });
    setVariableDraft('');
    setVariableError(null);
  };

  return (
    <PopoverRoot>
      <PopoverTrigger
        render={
          <Button size="sm" variant="ghost" icon="sort" pressed={count > 0} aria-label="Filter runs">
            {count > 0 ? `Filters ${count}` : 'Filter'}
          </Button>
        }
      />
      <PopoverPopup align="end" className="flex w-80 flex-col gap-3 p-3">
        <PopoverTitle className="text-ui font-medium text-fg">Filter runs</PopoverTitle>
        <Fieldset legend="Status">
          <div className="grid grid-cols-2 gap-1">
            {WORKFLOW_RUN_STATES.map((s) => (
              <Checkbox key={s} size="sm" label={s} checked={value.statuses.includes(s)} onCheckedChange={() => set({ statuses: toggle(value.statuses, s) })} />
            ))}
          </div>
        </Fieldset>
        <Fieldset legend="Started by">
          <div className="flex flex-col gap-1">
            {RUN_TRIGGERS.map((t) => (
              <Checkbox
                key={t.kind}
                size="sm"
                label={t.filterLabel}
                checked={value.triggers.includes(t.kind)}
                onCheckedChange={() => set({ triggers: toggle(value.triggers, t.kind) })}
              />
            ))}
          </div>
        </Fieldset>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Created from">
            <Input size="sm" type="date" value={value.from} onChange={(e) => set({ from: e.target.value })} />
          </Field>
          <Field label="Created to">
            <Input size="sm" type="date" value={value.to} onChange={(e) => set({ to: e.target.value })} />
          </Field>
        </div>
        <Field label="Variable" error={variableError ?? undefined}>
          <div className="flex items-center gap-1.5">
            <Input
              size="sm"
              mono
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
              className="flex-1"
            />
            <Button size="sm" onClick={addVariable} disabled={!variableDraft.trim()}>
              Add
            </Button>
          </div>
        </Field>
        {count > 0 ? (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => onChange({ ...EMPTY_RUN_FILTERS, q: value.q })}>
            Clear filters
          </Button>
        ) : null}
      </PopoverPopup>
    </PopoverRoot>
  );
}

/** The active filters as removable chips. */
export function RunFilterChips({ value, onChange }: { value: RunFilters; onChange: (next: RunFilters) => void }) {
  if (activeFilterCount(value) === 0) return null;
  const set = (patch: Partial<RunFilters>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Active run filters">
      {value.statuses.map((s) => (
        <Chip key={`s:${s}`} size="sm" onRemove={() => set({ statuses: value.statuses.filter((v) => v !== s) })}>
          {s}
        </Chip>
      ))}
      {value.triggers.map((t) => (
        <Chip key={`t:${t}`} size="sm" onRemove={() => set({ triggers: value.triggers.filter((v) => v !== t) })}>
          {triggerLabel(t)}
        </Chip>
      ))}
      {value.from ? (
        <Chip size="sm" onRemove={() => set({ from: '' })}>
          from {value.from}
        </Chip>
      ) : null}
      {value.to ? (
        <Chip size="sm" onRemove={() => set({ to: '' })}>
          to {value.to}
        </Chip>
      ) : null}
      {value.variables.map((v) => (
        <Chip key={`v:${v.name}`} size="sm" mono onRemove={() => set({ variables: value.variables.filter((x) => x.name !== v.name) })}>
          {v.name}={v.value}
        </Chip>
      ))}
    </div>
  );
}
