// ────────────────────────────────────────────────────────────────
// Builder fields shared by the inspectors of every stage kind (agent,
// check, loop, map, sub-workflow, wait) and the workflow settings: the
// stage key, the enclosing container, JSON objects edited as text, named
// rows, expression tables, argument lists, budgets, the join policy and
// compensation actions. On the kit (C-18 inspector rows).
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Budget, CompensationAction, JoinPolicy, StageSpec } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore, type BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { descendantIds, isContainerStage } from '@/stores/workflowContainerLayout.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { ExpressionField } from './ExpressionField.js';
import { FieldIssues, issuesAt } from './FieldIssues.js';
import { InspectorNote, InspectorRow } from './InspectorLayout.js';

/** A number field value → number (Base UI reports null for an emptied field). */
export function num(value: number | null, fallback = 0): number {
  return value ?? fallback;
}

/**
 * The stage key: the stable identity edges, context sources and
 * `stages.<key>` expressions refer to. Edited as a draft and renamed on
 * blur, so a half-typed key never renames anything.
 */
export function StageKeyField({ stage, issues, stacked = false }: { stage: StageSpec; issues: readonly BuilderIssue[]; stacked?: boolean }) {
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
    <InspectorRow label="Key" stacked={stacked} error={error ?? undefined} hint={error ? undefined : <>Edges and <code className="font-mono">stages.{stage.key}</code> refer to it</>}>
      <Input
        mono
        size="sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        placeholder="stage_key"
        spellCheck={false}
        invalid={issues.some((i) => i.severity === 'error')}
      />
      <FieldIssues issues={issues} />
    </InspectorRow>
  );
}

/**
 * The container (loop or map) a stage belongs to (P05: `parentKey`).
 * Moving a stage keeps its canvas position; its edges to stages of the
 * scope it leaves are removed, since an edge never crosses a scope.
 */
export function ParentField({ stage, issues }: { stage: StageSpec; issues: readonly BuilderIssue[] }) {
  const reparentStage = useWorkflowBuilderStore((s) => s.reparentStage);
  const containers = useWorkflowBuilderStore(
    useShallow((s) => {
      const excluded = new Set([stage.key, ...descendantIds(stage.key, s.nodes)]);
      return s.nodes
        .filter((n) => isContainerStage(n.data.stage) && !excluded.has(n.id))
        .map((n) => `${n.id}\u0000${n.data.stage.name}\u0000${n.data.stage.kind}`);
    }),
  );
  if (containers.length === 0 && !stage.parentKey) return null;
  const items = [
    { value: '', label: 'Top level' },
    ...containers.map((entry) => {
      const [key, name, kind] = entry.split('\u0000') as [string, string, string];
      return { value: key, label: `${kind === 'map' ? 'Map' : 'Loop'}: ${name}`, meta: key };
    }),
  ];
  return (
    <InspectorRow label="In container" hint="Body stages connect only to each other; outer stages connect to the loop or map itself.">
      <Select
        aria-label="Enclosing container"
        size="sm"
        value={stage.parentKey ?? ''}
        onValueChange={(v) => {
          const dropped = reparentStage(stage.key, v || undefined);
          if (dropped > 0) toast.info(`${dropped} edge${dropped === 1 ? '' : 's'} crossing the container boundary removed`);
        }}
        items={items}
      />
      <FieldIssues issues={issues} />
    </InspectorRow>
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
    <div className="flex flex-col gap-1">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        rows={rows}
        aria-label={ariaLabel}
        textareaClassName="font-mono"
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
        invalid={error !== null}
      />
      {error ? <p className="text-small text-err">{error}</p> : null}
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
      textareaClassName="font-mono"
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
    <div className="flex min-w-0 flex-col gap-1">
      <Input
        mono
        size="sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        aria-label={ariaLabel}
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
        invalid={error !== null}
      />
      {error ? <p className="text-small text-err">{error}</p> : null}
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
  const rest = { ...record };
  delete rest[key];
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/**
 * A spending budget (turns, cost, tokens, wall clock); empty or 0 means no
 * limit on that dimension and an all-empty budget removes the field.
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
  const set = (field: keyof Budget, value: number | null | undefined) => {
    const next: Budget = { ...(budget ?? {}) };
    if (value && value > 0) next[field] = value;
    else delete next[field];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <InspectorRow label="Max turns" stacked>
          <NumberField size="sm" aria-label="Max turns" value={budget?.maxTurns ?? null} onValueChange={(v) => set('maxTurns', v)} min={0} max={100_000} step={10} unit="turns" />
        </InspectorRow>
        <InspectorRow label="Max cost" stacked>
          <NumberField size="sm" aria-label="Max cost (USD)" value={budget?.maxCostUsd ?? null} onValueChange={(v) => set('maxCostUsd', v)} min={0} max={100_000} step={0.5} unit="$" />
        </InspectorRow>
        <InspectorRow label="Max tokens" stacked>
          <NumberField size="sm" aria-label="Max tokens" value={budget?.maxTokens ?? null} onValueChange={(v) => set('maxTokens', v)} min={0} max={10_000_000_000} step={100_000} />
        </InspectorRow>
        <InspectorRow label="Wall clock" stacked>
          <NumberField
            size="sm"
            aria-label="Max wall clock (minutes)"
            value={budget?.maxWallClockMs ? Math.round(budget.maxWallClockMs / 60_000) : null}
            onValueChange={(v) => set('maxWallClockMs', v && v > 0 ? v * 60_000 : undefined)}
            min={0}
            max={10_080}
            step={5}
            unit="min"
          />
        </InspectorRow>
      </div>
      <InspectorNote>Empty means no limit on that dimension.</InspectorNote>
      <FieldIssues issues={issues} />
    </div>
  );
}

/** Rows added in a table that have no value yet (so no record holds their name). */
function usePendingRows() {
  const [pending, setPending] = useState<string[]>([]);
  return {
    pending,
    add: (name: string) => setPending((p) => [...p, name]),
    drop: (name: string) => setPending((p) => p.filter((n) => n !== name)),
    rename: (name: string, next: string) => setPending((p) => p.map((n) => (n === name ? next : n))),
  };
}

/**
 * A name → expression table (a map's per-item output fields, a
 * sub-workflow's inputs, the workflow's outputs). An emptied expression
 * removes the row's entry; `suggested` names are offered as one-click rows.
 */
export function ExpressionTable({
  record,
  onChange,
  issues,
  pointer,
  noun,
  placeholder,
  suggested = [],
  addLabel,
}: {
  record: Record<string, string> | undefined;
  onChange: (record: Record<string, string> | undefined) => void;
  issues: readonly BuilderIssue[];
  /** JSON pointer of the record (`/map/output/select`). */
  pointer: string;
  noun: string;
  placeholder?: string;
  suggested?: readonly string[];
  addLabel: string;
}) {
  const pending = usePendingRows();
  const names = [...new Set([...Object.keys(record ?? {}), ...pending.pending])];
  const missing = suggested.filter((n) => !names.includes(n));
  const fresh = () => {
    let n = names.length + 1;
    while (names.includes(`${noun}_${n}`)) n++;
    return `${noun}_${n}`;
  };
  return (
    <div className="flex flex-col gap-2">
      {names.length > 0 ? (
        <div className="flex flex-col divide-y divide-line-soft rounded-card border border-line-soft">
          {names.map((name) => (
            <div key={name} className="flex flex-col gap-1.5 p-2">
              <div className="flex items-start gap-1.5">
                <div className="min-w-0 flex-1">
                  <NameField
                    name={name}
                    taken={names.filter((n) => n !== name)}
                    onRename={(next) => {
                      pending.rename(name, next);
                      onChange(renameKey(record, name, next));
                    }}
                    ariaLabel={`${noun} ${name} name`}
                  />
                </div>
                <IconButton
                  icon="trash"
                  size="sm"
                  label={`Remove ${noun} ${name}`}
                  onClick={() => {
                    pending.drop(name);
                    onChange(withoutKey(record, name));
                  }}
                />
              </div>
              <ExpressionField
                value={record?.[name] ?? ''}
                onChange={(v) => onChange(v.trim() ? { ...(record ?? {}), [name]: v } : withoutKey(record, name))}
                placeholder={placeholder}
                issues={issuesAt(issues, `${pointer}/${name}`)}
                ariaLabel={`${noun} ${name} expression`}
                quiet
              />
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" icon="plus" onClick={() => pending.add(fresh())}>
          {addLabel}
        </Button>
        {missing.map((n) => (
          <Chip key={n} mono size="sm" icon="plus" onClick={() => pending.add(n)}>
            {n}
          </Chip>
        ))}
      </div>
      <FieldIssues issues={issues.filter((i) => i.field === pointer)} />
    </div>
  );
}

/**
 * How incoming edges combine (every kind): all, any (optionally cancelling
 * the predecessors that only lead here) or n of m. The board's "Join
 * All · Any · N of M  ☐ Cancel the rest" row.
 */
export function JoinFields({
  join,
  onChange,
  issues,
}: {
  join: JoinPolicy;
  onChange: (join: JoinPolicy) => void;
  issues: readonly BuilderIssue[];
}) {
  const cancelRemaining = join.mode === 'all' ? false : join.cancelRemaining;
  return (
    <InspectorRow label="Join" hint={JOIN_HINTS[join.mode]}>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Join mode"
          value={join.mode}
          onValueChange={(v) =>
            onChange(
              v === 'all'
                ? { mode: 'all' }
                : v === 'any'
                  ? { mode: 'any', cancelRemaining }
                  : { mode: 'n_of_m', n: join.mode === 'n_of_m' ? join.n : 1, cancelRemaining },
            )
          }
          items={[
            { value: 'all', label: 'All' },
            { value: 'any', label: 'Any' },
            { value: 'n_of_m', label: 'N of M' },
          ]}
        />
        {join.mode === 'n_of_m' ? (
          <NumberField
            size="sm"
            aria-label="Predecessors needed (n)"
            className="w-20"
            value={join.n}
            onValueChange={(n) => onChange({ ...join, n: Math.max(1, num(n, 1)) })}
            min={1}
            max={100}
          />
        ) : null}
        <Checkbox
          size="sm"
          label="Cancel the rest"
          checked={cancelRemaining}
          disabled={join.mode === 'all'}
          onCheckedChange={(checked) => {
            if (join.mode !== 'all') onChange({ ...join, cancelRemaining: checked });
          }}
        />
      </div>
      <FieldIssues issues={issuesAt(issues, '/join')} />
    </InspectorRow>
  );
}

const JOIN_HINTS: Record<JoinPolicy['mode'], string> = {
  all: 'Every predecessor; a dead one skips the stage.',
  any: 'The first satisfied predecessor makes it ready.',
  n_of_m: 'Ready once n predecessors are satisfied.',
};

type CompensationType = 'restore_checkpoint' | 'script' | 'http' | 'function';

function blankCompensation(type: CompensationType, n: number): CompensationAction {
  const name = type === 'restore_checkpoint' ? 'Restore the workspace' : `Undo ${n}`;
  const config: CompensationAction['config'] =
    type === 'restore_checkpoint'
      ? { type: 'restore_checkpoint' }
      : type === 'script'
        ? { type: 'script', command: 'git' }
        : type === 'http'
          ? { type: 'http', url: 'https://example.com/undo', method: 'POST' }
          : { type: 'function', handlerName: 'undo' };
  return { name, config, timeoutMs: 30_000, retries: 3 };
}

const COMPENSATION_TYPES = [
  { value: 'restore_checkpoint', label: 'Restore checkpoint', meta: 'Roll the workspace back' },
  { value: 'script', label: 'Script', meta: 'Run a command' },
  { value: 'http', label: 'HTTP call', meta: 'Call an endpoint' },
  { value: 'function', label: 'Function', meta: 'A registered handler' },
] as const;

/**
 * Compensation actions (saga undo steps): run for a completed stage when
 * the run fails or is cancelled, last completed stage first. The built-in
 * restore_checkpoint rolls the workspace back to before the stage.
 */
export function CompensationEditor({
  actions,
  onChange,
  issues,
}: {
  actions: CompensationAction[] | undefined;
  onChange: (actions: CompensationAction[] | undefined) => void;
  issues: readonly BuilderIssue[];
}) {
  const list = actions ?? [];
  const set = (next: CompensationAction[]) => onChange(next.length > 0 ? next : undefined);
  const update = (i: number, patch: Partial<CompensationAction>) => set(list.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const hasScript = list.some((a) => a.config.type === 'script' || a.config.type === 'function');

  return (
    <div className="flex flex-col gap-2">
      {hasScript ? <InspectorNote tone="info">A script or function action runs a program: saving it needs the admin:settings scope.</InspectorNote> : null}
      {list.map((action, i) => {
        const cfg = action.config;
        const at = `/compensate/${i}`;
        return (
          <div key={i} className="flex flex-col gap-2 rounded-card border border-line-soft p-2.5">
            <div className="flex items-center gap-1.5">
              <Input size="sm" value={action.name} onChange={(e) => update(i, { name: e.target.value })} aria-label={`Compensation ${i + 1} name`} className="flex-1" />
              <Select
                aria-label={`Compensation ${i + 1} type`}
                size="sm"
                value={cfg.type}
                onValueChange={(v) => v && update(i, { config: blankCompensation(v as CompensationType, i + 1).config })}
                items={COMPENSATION_TYPES}
                className="w-40"
              />
              <IconButton icon="trash" size="sm" label={`Remove compensation ${i + 1}`} onClick={() => set(list.filter((_, j) => j !== i))} />
            </div>
            {cfg.type === 'script' ? (
              <>
                <Input
                  mono
                  size="sm"
                  value={cfg.command}
                  onChange={(e) => update(i, { config: { ...cfg, command: e.target.value } })}
                  aria-label={`Compensation ${i + 1} command`}
                  placeholder="Command (a literal)"
                  spellCheck={false}
                />
                <ArgsEditor
                  args={cfg.args ?? []}
                  onChange={(args) => update(i, { config: { ...cfg, ...(args.length ? { args } : { args: undefined }) } })}
                  ariaLabel={`Compensation ${i + 1} arguments`}
                />
              </>
            ) : null}
            {cfg.type === 'http' ? (
              <div className="flex items-center gap-1.5">
                <Select
                  aria-label={`Compensation ${i + 1} method`}
                  size="sm"
                  value={cfg.method}
                  onValueChange={(v) => v && update(i, { config: { ...cfg, method: v as typeof cfg.method } })}
                  items={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))}
                  className="w-24"
                />
                <Input
                  mono
                  size="sm"
                  value={cfg.url}
                  onChange={(e) => update(i, { config: { ...cfg, url: e.target.value } })}
                  aria-label={`Compensation ${i + 1} URL`}
                  placeholder="https://…"
                  spellCheck={false}
                  className="flex-1"
                />
              </div>
            ) : null}
            {cfg.type === 'function' ? (
              <Input
                mono
                size="sm"
                value={cfg.handlerName ?? ''}
                onChange={(e) => update(i, { config: { ...cfg, handlerName: e.target.value || undefined } })}
                aria-label={`Compensation ${i + 1} handler`}
                placeholder="Registered handler name"
                spellCheck={false}
              />
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                size="sm"
                aria-label={`Compensation ${i + 1} timeout (seconds)`}
                value={Math.round(action.timeoutMs / 1000)}
                onValueChange={(v) => update(i, { timeoutMs: Math.max(1, num(v, 1)) * 1000 })}
                min={1}
                max={600}
                unit="s"
              />
              <NumberField
                size="sm"
                aria-label={`Compensation ${i + 1} retries`}
                value={action.retries}
                onValueChange={(v) => update(i, { retries: num(v) })}
                min={0}
                max={5}
                unit="retries"
              />
            </div>
            <FieldIssues issues={issuesAt(issues, at)} />
          </div>
        );
      })}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="ghost" icon="plus" onClick={() => set([...list, blankCompensation('restore_checkpoint', list.length + 1)])}>
          Restore checkpoint
        </Button>
        <Button size="sm" variant="ghost" icon="plus" onClick={() => set([...list, blankCompensation('http', list.length + 1)])}>
          Action
        </Button>
      </div>
      <FieldIssues issues={issues.filter((i) => i.field === '/compensate')} />
    </div>
  );
}
