// ────────────────────────────────────────────────────────────────
// Builder fields shared by the stage panels of every kind (agent,
// check, loop, map, sub-workflow, wait): the stage key, the enclosing
// container, JSON objects edited as text, named rows, expression tables,
// argument lists, budgets, the join policy and compensation actions.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Budget, CompensationAction, JoinPolicy, StageSpec } from '@generatorai/workflow-spec';
import { useShallow } from 'zustand/react/shallow';
import { useWorkflowBuilderStore, type BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { Button, Input, Select, Textarea, ToggleSwitch, toast } from '@/components/ui/index.js';
import { NumberStepper } from '../NumberStepper.js';
import { ExpressionField, FieldIssues, issuesAt } from '../engineGate.js';
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
  const options = [
    { value: '', label: 'Top level' },
    ...containers.map((entry) => {
      const [key, name, kind] = entry.split('\u0000') as [string, string, string];
      return { value: key, label: `${kind === 'map' ? 'Map' : 'Loop'}: ${name}`, description: key };
    }),
  ];
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground">In container</label>
      <Select
        aria-label="Enclosing container"
        value={stage.parentKey ?? ''}
        onChange={(v) => {
          const dropped = reparentStage(stage.key, v || undefined);
          if (dropped > 0) toast.message(`${dropped} edge${dropped === 1 ? '' : 's'} crossing the container boundary removed`);
        }}
        options={options}
      />
      <p className="mt-1 text-[10px] text-muted-foreground">
        Body stages connect only to each other; outer stages connect to the loop or map itself.
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
 * sub-workflow's inputs). An emptied expression removes the row's entry;
 * `suggested` names are offered as one-click rows.
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
    <div className="space-y-3">
      {names.map((name) => (
        <div key={name} className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-start gap-2">
            <div className="flex-1">
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
            <Button
              type="button"
              onClick={() => {
                pending.drop(name);
                onChange(withoutKey(record, name));
              }}
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${noun} ${name}`}
              className="mt-1 h-auto w-auto p-1 text-muted-foreground hover:bg-transparent hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ExpressionField
            value={record?.[name] ?? ''}
            onChange={(v) => onChange(v.trim() ? { ...(record ?? {}), [name]: v } : withoutKey(record, name))}
            placeholder={placeholder}
            issues={issuesAt(issues, `${pointer}/${name}`)}
            ariaLabel={`${noun} ${name} expression`}
          />
        </div>
      ))}
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          <span>Add:</span>
          {missing.map((n) => (
            <Button
              key={n}
              type="button"
              onClick={() => pending.add(n)}
              variant="ghost"
              size="sm"
              className="h-auto rounded bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-foreground hover:bg-accent"
            >
              {n}
            </Button>
          ))}
        </div>
      )}
      <Button
        type="button"
        onClick={() => pending.add(fresh())}
        variant="ghost"
        size="sm"
        className="h-auto gap-1 bg-transparent p-0 text-xs text-primary hover:bg-transparent hover:underline"
      >
        <Plus className="h-3 w-3" /> {addLabel}
      </Button>
      <FieldIssues issues={issues.filter((i) => i.field === pointer)} />
    </div>
  );
}

/**
 * How incoming edges combine (every kind): all, any (optionally cancelling
 * the predecessors that only lead here) or n of m.
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
    <div className="space-y-2">
      <label className="block text-xs font-medium text-foreground">Join</label>
      <Select
        aria-label="Join mode"
        value={join.mode}
        onChange={(v) =>
          onChange(
            v === 'all'
              ? { mode: 'all' }
              : v === 'any'
                ? { mode: 'any', cancelRemaining }
                : { mode: 'n_of_m', n: join.mode === 'n_of_m' ? join.n : 1, cancelRemaining },
          )
        }
        options={[
          { value: 'all', label: 'All predecessors', description: 'A dead predecessor skips the stage' },
          { value: 'any', label: 'Any predecessor', description: 'The first satisfied predecessor makes it ready' },
          { value: 'n_of_m', label: 'N of M predecessors', description: 'Ready once n predecessors are satisfied' },
        ]}
      />
      {join.mode === 'n_of_m' && (
        <NumberStepper label="Predecessors needed (n)" value={join.n} onChange={(n) => onChange({ ...join, n })} min={1} max={100} />
      )}
      {join.mode !== 'all' && (
        <ToggleSwitch
          checked={join.cancelRemaining}
          onChange={(checked) => onChange({ ...join, cancelRemaining: checked })}
          label="Cancel the remaining predecessors"
          description="Once the join fires, predecessors that only lead here are cancelled (a race)."
        />
      )}
      <FieldIssues issues={issuesAt(issues, '/join')} />
    </div>
  );
}

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
    <div className="space-y-3">
      <p className="text-[10px] text-muted-foreground">
        Run when the run fails or is cancelled, for this stage once it completed; the last completed stage is undone first.
      </p>
      {hasScript && (
        <p className="text-[10px] text-info">A script or function action runs a program: saving it needs the admin:settings scope.</p>
      )}
      {list.map((action, i) => {
        const cfg = action.config;
        const at = `/compensate/${i}`;
        return (
          <div key={i} className="space-y-2 rounded-lg border border-border p-2.5">
            <div className="flex items-center gap-2">
              <Input
                value={action.name}
                onChange={(e) => update(i, { name: e.target.value })}
                aria-label={`Compensation ${i + 1} name`}
                className="h-8 flex-1 text-xs"
              />
              <Button
                type="button"
                onClick={() => set(list.filter((_, j) => j !== i))}
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove compensation ${i + 1}`}
                className="h-auto w-auto p-1 text-muted-foreground hover:bg-transparent hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Select
              aria-label={`Compensation ${i + 1} type`}
              value={cfg.type}
              onChange={(v) => update(i, { config: blankCompensation(v as CompensationType, i + 1).config })}
              options={[
                { value: 'restore_checkpoint', label: 'Restore checkpoint', description: 'Roll the workspace back to before the stage' },
                { value: 'script', label: 'Script', description: 'Run a command' },
                { value: 'http', label: 'HTTP call', description: 'Call an endpoint' },
                { value: 'function', label: 'Function', description: 'A registered handler' },
              ]}
            />
            {cfg.type === 'script' && (
              <>
                <Input
                  value={cfg.command}
                  onChange={(e) => update(i, { config: { ...cfg, command: e.target.value } })}
                  aria-label={`Compensation ${i + 1} command`}
                  className="h-8 font-mono text-xs"
                  placeholder="Command (a literal)"
                  spellCheck={false}
                />
                <ArgsEditor
                  args={cfg.args ?? []}
                  onChange={(args) => update(i, { config: { ...cfg, ...(args.length ? { args } : { args: undefined }) } })}
                  ariaLabel={`Compensation ${i + 1} arguments`}
                />
              </>
            )}
            {cfg.type === 'http' && (
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-1.5">
                <Select
                  aria-label={`Compensation ${i + 1} method`}
                  value={cfg.method}
                  onChange={(v) => update(i, { config: { ...cfg, method: v as typeof cfg.method } })}
                  options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))}
                />
                <Input
                  value={cfg.url}
                  onChange={(e) => update(i, { config: { ...cfg, url: e.target.value } })}
                  aria-label={`Compensation ${i + 1} URL`}
                  className="h-8 font-mono text-xs"
                  placeholder="https://…"
                  spellCheck={false}
                />
              </div>
            )}
            {cfg.type === 'function' && (
              <Input
                value={cfg.handlerName ?? ''}
                onChange={(e) => update(i, { config: { ...cfg, handlerName: e.target.value || undefined } })}
                aria-label={`Compensation ${i + 1} handler`}
                className="h-8 font-mono text-xs"
                placeholder="Registered handler name"
                spellCheck={false}
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <NumberStepper
                label="Timeout (s)"
                value={Math.round(action.timeoutMs / 1000)}
                onChange={(v) => update(i, { timeoutMs: Math.max(1, v) * 1000 })}
                min={1}
                max={600}
                unit="sec"
              />
              <NumberStepper label="Retries" value={action.retries} onChange={(retries) => update(i, { retries })} min={0} max={5} />
            </div>
            <FieldIssues issues={issuesAt(issues, at)} />
          </div>
        );
      })}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={() => set([...list, blankCompensation('restore_checkpoint', list.length + 1)])}
          variant="ghost"
          size="sm"
          className="h-auto gap-1 bg-transparent p-0 text-xs text-primary hover:bg-transparent hover:underline"
        >
          <Plus className="h-3 w-3" /> Restore checkpoint
        </Button>
        <Button
          type="button"
          onClick={() => set([...list, blankCompensation('http', list.length + 1)])}
          variant="ghost"
          size="sm"
          className="h-auto gap-1 bg-transparent p-0 text-xs text-primary hover:bg-transparent hover:underline"
        >
          <Plus className="h-3 w-3" /> Action
        </Button>
      </div>
      <FieldIssues issues={issues.filter((i) => i.field === '/compensate')} />
    </div>
  );
}
