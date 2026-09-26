// ────────────────────────────────────────────────────────────────
// Builder fields shared by the stage panels of every kind (agent,
// check, loop): the stage key, the enclosing loop, JSON objects edited
// as text, named rows, argument lists and budgets.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import type { Budget, StageSpec } from '@generatorai/workflow-spec';
import { useShallow } from 'zustand/react/shallow';
import { useWorkflowBuilderStore, type BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { Input, Select, Textarea, toast } from '@/components/ui/index.js';
import { NumberStepper } from '../NumberStepper.js';
import { FieldIssues } from '../engineGate.js';
import { descendantIds, isContainerStage } from './containerLayout.js';

/**
 * The stage key: the stable identity edges, context sources and
 * `stages.<key>` expressions refer to. Edited as a draft and renamed on
 * blur, so a half-typed key never renames anything.
 */
export function StageKeyField({ stage, issues }: { stage: StageSpec; issues: readonly BuilderIssue[] }) {
  const renameStageKey = useWorkflowBuilderStore((s) => s.renameStageKey);
  const [draft, setDraft] = useState(stage.key);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(stage.key);
    setError(null);
  }, [stage.key]);

  const commit = () => {
    const next = draft.trim();
    if (next === stage.key) return;
    const failure = renameStageKey(stage.key, next);
    setError(failure);
    if (failure) setDraft(stage.key);
  };

  return (
    <div>
      <label htmlFor="stage-key" className="mb-1.5 block text-xs font-medium text-foreground">Key</label>
      <Input
        id="stage-key"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className="font-mono text-xs"
        placeholder="stage_key"
        spellCheck={false}
      />
      <p className="mt-1 text-[10px] text-muted-foreground">
        Edges, context sources and <code>stages.{stage.key}</code> expressions refer to the stage by key.
      </p>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
      <FieldIssues issues={issues} />
    </div>
  );
}

/**
 * The loop a stage belongs to (P05: `parentKey`). Moving a stage keeps its
 * canvas position; its edges to stages of the scope it leaves are removed,
 * since an edge never crosses a scope.
 */
export function ParentField({ stage, issues }: { stage: StageSpec; issues: readonly BuilderIssue[] }) {
  const reparentStage = useWorkflowBuilderStore((s) => s.reparentStage);
  const containers = useWorkflowBuilderStore(
    useShallow((s) => {
      const excluded = new Set([stage.key, ...descendantIds(stage.key, s.nodes)]);
      return s.nodes
        .filter((n) => isContainerStage(n.data.stage) && !excluded.has(n.id))
        .map((n) => `${n.id}\u0000${n.data.stage.name}`);
    }),
  );
  if (containers.length === 0 && !stage.parentKey) return null;
  const options = [
    { value: '', label: 'Top level' },
    ...containers.map((entry) => {
      const [key, name] = entry.split('\u0000') as [string, string];
      return { value: key, label: `Loop: ${name}`, description: key };
    }),
  ];
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground">In loop</label>
      <Select
        aria-label="Enclosing loop"
        value={stage.parentKey ?? ''}
        onChange={(v) => {
          const dropped = reparentStage(stage.key, v || undefined);
          if (dropped > 0) toast.message(`${dropped} edge${dropped === 1 ? '' : 's'} crossing the loop boundary removed`);
        }}
        options={options}
      />
      <p className="mt-1 text-[10px] text-muted-foreground">
        Body stages connect only to each other; outer stages connect to the loop itself.
      </p>
      <FieldIssues issues={issues} />
    </div>
  );
}

/**
 * A JSON object edited as text: the draft is parsed on blur. Blank clears
 * the value; text that is not a JSON object is reported and not applied.
 */
export function JsonObjectEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
  rows = 5,
  disabled,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (value: Record<string, unknown> | undefined) => void;
  placeholder?: string;
  ariaLabel: string;
  rows?: number;
  disabled?: boolean;
}) {
  const serialized = value === undefined ? '' : JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(serialized);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(serialized);
    setError(null);
  }, [serialized]);

  const commit = () => {
    if (!draft.trim()) {
      setError(null);
      if (value !== undefined) onChange(undefined);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(draft);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setError('Must be a JSON object');
        return;
      }
      setError(null);
      if (JSON.stringify(parsed) !== JSON.stringify(value)) onChange(parsed as Record<string, unknown>);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  return (
    <div>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        rows={rows}
        aria-label={ariaLabel}
        className="resize-y font-mono text-xs"
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
      />
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  );
}

/**
 * Arguments edited one per line and parsed on blur, so typing a newline
 * never swallows the next argument before it exists.
 */
export function ArgsEditor({
  args,
  onChange,
  ariaLabel = 'Script arguments',
  placeholder = 'Arguments, one per line\nvalidate.js',
  disabled,
}: {
  args: string[];
  onChange: (args: string[]) => void;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(args.join('\n'));
  useEffect(() => setDraft(args.join('\n')), [args]);
  return (
    <Textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onChange(draft.split('\n').map((a) => a.trim()).filter(Boolean))}
      rows={3}
      className="resize-y font-mono text-xs"
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
    />
  );
}

/**
 * The name of a row in a name → value table (carried values, output
 * fields, environment variables). Renamed on blur; a taken name is
 * refused and the draft reverts.
 */
export function NameField({
  name,
  taken,
  onRename,
  ariaLabel,
  placeholder = 'name',
  disabled,
}: {
  name: string;
  taken: readonly string[];
  onRename: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(name);
    setError(null);
  }, [name]);
  const commit = () => {
    const next = draft.trim();
    if (next === name) return;
    if (!next || taken.includes(next)) {
      setError(next ? `'${next}' is already used` : 'A name is required');
      setDraft(name);
      return;
    }
    setError(null);
    onRename(next);
  };
  return (
    <div className="min-w-0">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="h-8 font-mono text-xs"
        spellCheck={false}
        disabled={disabled}
      />
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  );
}

/** `record` with `key` renamed to `next`, keeping the entry order. */
export function renameKey<V>(record: Record<string, V> | undefined, key: string, next: string): Record<string, V> | undefined {
  if (!record || !(key in record)) return record;
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k === key ? next : k, v]));
}

/** `record` without `key`; `undefined` once it is empty (so the field is removed). */
export function withoutKey<V>(record: Record<string, V> | undefined, key: string): Record<string, V> | undefined {
  if (!record || !(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/**
 * A spending budget (turns, cost, tokens, wall clock); 0 means no limit on
 * that dimension and an all-zero budget removes the field.
 */
export function BudgetFields({
  budget,
  onChange,
  issues,
}: {
  budget: Budget | undefined;
  onChange: (budget: Budget | undefined) => void;
  issues: readonly BuilderIssue[];
}) {
  const set = (field: keyof Budget, value: number | undefined) => {
    const next: Budget = { ...(budget ?? {}) };
    if (value && value > 0) next[field] = value;
    else delete next[field];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  return (
    <div className="space-y-3">
      <NumberStepper label="Max turns (0 = none)" value={budget?.maxTurns ?? 0} onChange={(v) => set('maxTurns', v)} min={0} max={100_000} step={10} />
      <NumberStepper
        label="Max cost (USD, 0 = none)"
        value={budget?.maxCostUsd ?? 0}
        onChange={(v) => set('maxCostUsd', v)}
        min={0}
        max={100_000}
        step={0.5}
        unit="$"
      />
      <NumberStepper
        label="Max tokens (0 = none)"
        value={budget?.maxTokens ?? 0}
        onChange={(v) => set('maxTokens', v)}
        min={0}
        max={10_000_000_000}
        step={100_000}
      />
      <NumberStepper
        label="Max wall clock (minutes, 0 = none)"
        value={budget?.maxWallClockMs ? Math.round(budget.maxWallClockMs / 60_000) : 0}
        onChange={(v) => set('maxWallClockMs', v > 0 ? v * 60_000 : undefined)}
        min={0}
        max={10_080}
        step={5}
        unit="min"
      />
      <FieldIssues issues={issues} />
    </div>
  );
}
