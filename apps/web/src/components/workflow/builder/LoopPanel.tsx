// ────────────────────────────────────────────────────────────────
// LoopPanel — the inspector of a loop stage (P05 §2.1, WP-5A.5).
//
// Four quick exit rows (Until → complete, Fail when → fail, Pause when →
// pause, Stall → exhaust) edit the FIRST rule of each action in
// `loop.exits`; every other rule is listed under "More rules". Then the
// carried values, the cumulative budget, the wrap-up turn, what
// exhausting the loop does, and the extra output fields. Validator issues
// are shown next to the field their JSON pointer names
// (`/loop/exits/<j>/when`, …).
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Flag, Gauge, ListChecks, Package, Plus, Repeat, Trash2, Variable, Wand2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  LOOP_EXIT_ACTIONS,
  type ExitRule,
  type LoopExitAction,
  type LoopSpec,
  type LoopStage,
} from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore, type BuilderIssue, type StageUpdate } from '@/stores/workflowBuilderStore.js';
import { Button, Input, Select, Textarea, ToggleSwitch } from '@/components/ui/index.js';
import { CollapsibleSection } from '../CollapsibleSection.js';
import { NumberStepper } from '../NumberStepper.js';
import { ExpressionField, FieldIssues, issuesAt } from '../engineGate.js';
import { BudgetFields, JsonObjectEditor, NameField, renameKey, withoutKey } from './fields.js';

interface LoopPanelProps {
  stage: LoopStage;
  onUpdate: (updates: StageUpdate) => void;
  issues: readonly BuilderIssue[];
}

/** The four quick rows, in the order the plan lists them. */
const QUICK_ROWS: ReadonlyArray<{
  action: LoopExitAction;
  label: string;
  hint: string;
  reason: string;
  placeholder: string;
}> = [
  {
    action: 'complete',
    label: 'Until',
    hint: 'Ends the loop successfully',
    reason: 'done',
    placeholder: "e.g. stages.review.output.verdict == 'approve'",
  },
  {
    action: 'fail',
    label: 'Fail when',
    hint: 'Fails the loop',
    reason: 'failed',
    placeholder: "e.g. stages.assess.output.status == 'impossible'",
  },
  {
    action: 'pause',
    label: 'Pause when',
    hint: 'Parks the loop for an operator decision',
    reason: 'needs_input',
    placeholder: "e.g. stages.assess.output.status == 'blocked'",
  },
  {
    action: 'exhaust',
    label: 'Stall',
    hint: 'Treats the loop as exhausted: "When the loop runs out" applies',
    reason: 'stalled',
    placeholder: 'e.g. not loop.last.signals.workspaceChanged',
  },
];

const ACTION_OPTIONS = LOOP_EXIT_ACTIONS.map((a) => ({
  value: a,
  label: a === 'complete' ? 'Complete' : a === 'fail' ? 'Fail' : a === 'pause' ? 'Pause' : 'Exhaust',
  description:
    a === 'complete'
      ? 'End the loop successfully'
      : a === 'fail'
        ? 'Fail the loop'
        : a === 'pause'
          ? 'Park it for an operator decision'
          : 'Apply "When the loop runs out"',
}));

const REASON_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export function LoopPanel({ stage, onUpdate, issues }: LoopPanelProps) {
  const loop = stage.loop;
  /** Merge `updates` into `loop`; an `undefined` value removes the field. */
  const setLoop = (updates: Partial<LoopSpec>) => {
    const next: Record<string, unknown> = { ...loop, ...updates };
    for (const [k, v] of Object.entries(updates)) if (v === undefined) delete next[k];
    onUpdate({ loop: next as LoopSpec });
  };
  const setExits = (exits: ExitRule[]) => setLoop({ exits });

  // Issues on the loop as a whole (empty body, no exit rule) rather than one field.
  const general = issues.filter((i) => i.field === '' || i.field === '/loop' || i.field === '/loop/exits');

  return (
    <div>
      <CollapsibleSection title="Iterations" icon={<Repeat className="h-3.5 w-3.5" />} defaultOpen>
        <NumberStepper
          label="Max iterations"
          value={loop.maxIterations}
          onChange={(v) => setLoop({ maxIterations: v })}
          min={1}
          max={50}
        />
        <FieldIssues issues={issuesAt(issues, '/loop/maxIterations')} />
        <p className="text-[10px] text-muted-foreground">
          The body (the stages inside the loop on the canvas) runs up to this many times; an operator may grant more.
        </p>
        <FieldIssues issues={general} />
      </CollapsibleSection>

      <CollapsibleSection title="Exit rules" icon={<Flag className="h-3.5 w-3.5" />} defaultOpen badge={loop.exits.length ? String(loop.exits.length) : undefined}>
        <ExitRules exits={loop.exits} onChange={setExits} issues={issues} />
      </CollapsibleSection>

      <CollapsibleSection title="Carried values" icon={<Variable className="h-3.5 w-3.5" />} defaultOpen={!!loop.carry || !!loop.carryInit}>
        <CarryTable loop={loop} setLoop={setLoop} issues={issues} />
      </CollapsibleSection>

      <CollapsibleSection title="Budget" icon={<Gauge className="h-3.5 w-3.5" />} defaultOpen={!!stage.budget}>
        <p className="text-[10px] text-muted-foreground">
          Cumulative over every iteration. Exhausting it runs the wrap-up (if any), then "When the loop runs out".
        </p>
        <BudgetFields budget={stage.budget} onChange={(budget) => onUpdate({ budget })} issues={issuesAt(issues, '/budget')} />
      </CollapsibleSection>

      <CollapsibleSection title="Wrap-up" icon={<Wand2 className="h-3.5 w-3.5" />} defaultOpen={!!loop.wrapUp}>
        <WrapUpEditor stage={stage} setLoop={setLoop} issues={issues} />
      </CollapsibleSection>

      <CollapsibleSection title="When the loop runs out" icon={<ListChecks className="h-3.5 w-3.5" />} defaultOpen={false}>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">On limit</label>
          <Select
            aria-label="On limit"
            value={loop.onLimit.mode}
            onChange={(v) =>
              setLoop({
                onLimit:
                  v === 'accept_best'
                    ? { mode: 'accept_best', score: loop.onLimit.mode === 'accept_best' ? loop.onLimit.score : '' }
                    : ({ mode: v } as LoopSpec['onLimit']),
              })
            }
            options={[
              { value: 'pause', label: 'Pause for a decision', description: 'Park the loop for an operator (default)' },
              { value: 'fail', label: 'Fail', description: 'Fail the loop' },
              { value: 'accept_last', label: 'Accept the last iteration', description: 'Complete with the last iteration' },
              { value: 'accept_best', label: 'Accept the best iteration', description: 'Complete with the best-scoring iteration; its checkpoint is restored' },
            ]}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Applies at max iterations, when the budget runs out, and when a Stall rule fires.
          </p>
          <FieldIssues issues={issuesAt(issues, '/loop/onLimit/mode')} />
        </div>
        {loop.onLimit.mode === 'accept_best' && (
          <div>
            <label htmlFor="loop-score" className="mb-1.5 block text-xs font-medium text-foreground">Score</label>
            <ExpressionField
              id="loop-score"
              place={{ kind: 'loop', context: 'E' }}
              value={loop.onLimit.score}
              onChange={(score) => setLoop({ onLimit: { mode: 'accept_best', score } })}
              placeholder="e.g. stages.judge.output.score"
              issues={issuesAt(issues, '/loop/onLimit/score')}
              ariaLabel="Score expression"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">A number per iteration; ties go to the latest.</p>
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">When an iteration fails</label>
          <Select
            aria-label="On body failure"
            value={loop.onBodyFailure}
            onChange={(v) => setLoop({ onBodyFailure: v as LoopSpec['onBodyFailure'] })}
            options={[
              { value: 'fail', label: 'Fail the loop' },
              { value: 'next_iteration', label: 'Run the next iteration', description: 'The failures are in loop.last.failures' },
            ]}
          />
          <FieldIssues issues={issuesAt(issues, '/loop/onBodyFailure')} />
        </div>
        <ToggleSwitch
          checked={loop.checkpointEachIteration ?? loop.onLimit.mode === 'accept_best'}
          onChange={(checked) => setLoop({ checkpointEachIteration: checked })}
          label="Checkpoint each iteration"
          description="Snapshot the workspace after every iteration, so an operator can accept or re-run from any of them. On by default with accept best."
        />
        <FieldIssues issues={issuesAt(issues, '/loop/checkpointEachIteration')} />
      </CollapsibleSection>

      <CollapsibleSection title="Output" icon={<Package className="h-3.5 w-3.5" />} defaultOpen={!!loop.output.select}>
        <SelectTable loop={loop} setLoop={setLoop} issues={issues} />
      </CollapsibleSection>
    </div>
  );
}

// ── Exit rules ──

function ExitRules({ exits, onChange, issues }: { exits: ExitRule[]; onChange: (exits: ExitRule[]) => void; issues: readonly BuilderIssue[] }) {
  // A quick row edits the first rule of its action; the rest are "more rules".
  const quickIndex = new Map<LoopExitAction, number>();
  exits.forEach((r, i) => {
    if (!quickIndex.has(r.action)) quickIndex.set(r.action, i);
  });
  const quickSet = new Set(quickIndex.values());
  const extra = exits.map((rule, index) => ({ rule, index })).filter(({ index }) => !quickSet.has(index));

  const replace = (index: number, rule: ExitRule) => onChange(exits.map((r, i) => (i === index ? rule : r)));
  const remove = (index: number) => onChange(exits.filter((_, i) => i !== index));
  const addRule = () => {
    // A new rule joins "more rules" when its action already has a quick row.
    const action = LOOP_EXIT_ACTIONS.find((a) => quickIndex.has(a)) ?? 'complete';
    let n = exits.length + 1;
    while (exits.some((r) => r.reason === `rule_${n}`)) n++;
    onChange([...exits, { when: '', action, consecutive: 1, reason: `rule_${n}` }]);
  };

  return (
    <div className="space-y-3">
      {QUICK_ROWS.map((row) => (
        <QuickExitRow
          key={row.action}
          row={row}
          index={quickIndex.get(row.action)}
          rule={quickIndex.has(row.action) ? exits[quickIndex.get(row.action)!] : undefined}
          onAdd={(rule) => onChange([...exits, rule])}
          onReplace={replace}
          onRemove={remove}
          issues={issues}
        />
      ))}

      {extra.length > 0 && <p className="pt-1 text-xs font-medium text-foreground">More rules</p>}
      {extra.map(({ rule, index }) => (
        <div key={index} className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-center gap-2">
            <Select
              aria-label={`Rule ${index + 1} action`}
              value={rule.action}
              onChange={(v) => replace(index, { ...rule, action: v as LoopExitAction })}
              options={ACTION_OPTIONS}
              className="flex-1"
            />
            <Button
              type="button"
              onClick={() => remove(index)}
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove rule ${index + 1}`}
              className="h-auto w-auto p-1 text-muted-foreground hover:bg-transparent hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ExpressionField
            place={{ kind: 'loop', context: 'E' }}
            expect="boolean"
            value={rule.when}
            onChange={(when) => replace(index, { ...rule, when })}
            placeholder="A boolean evaluated after each iteration"
            issues={issuesAt(issues, `/loop/exits/${index}/when`)}
            ariaLabel={`Rule ${index + 1} condition`}
          />
          <StreakAndReason rule={rule} onChange={(r) => replace(index, r)} issues={issuesAt(issues, `/loop/exits/${index}/consecutive`, `/loop/exits/${index}/reason`)} label={`Rule ${index + 1}`} />
          <FieldIssues issues={issues.filter((i) => i.field === `/loop/exits/${index}`)} />
        </div>
      ))}

      <Button
        type="button"
        onClick={addRule}
        variant="ghost"
        size="sm"
        className="h-auto gap-1 bg-transparent p-0 text-xs text-primary hover:bg-transparent hover:underline"
      >
        <Plus className="h-3 w-3" /> Add rule
      </Button>
      <p className="text-[10px] text-muted-foreground">
        Evaluated after every iteration. When several fire at once: fail, then complete, then pause, then exhaust. A streak
        counts iterations in a row where the rule holds.
      </p>
    </div>
  );
}

function QuickExitRow({
  row,
  index,
  rule,
  onAdd,
  onReplace,
  onRemove,
  issues,
}: {
  row: (typeof QUICK_ROWS)[number];
  index: number | undefined;
  rule: ExitRule | undefined;
  onAdd: (rule: ExitRule) => void;
  onReplace: (index: number, rule: ExitRule) => void;
  onRemove: (index: number) => void;
  issues: readonly BuilderIssue[];
}) {
  // Until the row has a condition it writes nothing: an empty rule would be
  // invalid. Its streak and reason are kept here meanwhile.
  const [draft, setDraft] = useState<ExitRule>({ when: '', action: row.action, consecutive: 1, reason: row.reason });
  const current = rule ?? draft;
  const at = (suffix: string) => (index === undefined ? [] : issuesAt(issues, `/loop/exits/${index}${suffix}`));

  const update = (next: ExitRule) => {
    if (index !== undefined && rule) {
      if (!next.when.trim()) {
        // Clearing the condition removes the rule; keep the rest for retyping.
        setDraft({ ...next, when: '' });
        onRemove(index);
      } else {
        onReplace(index, next);
      }
      return;
    }
    if (next.when.trim()) onAdd(next);
    else setDraft(next);
  };

  return (
    <div className="space-y-2 rounded-lg border border-border p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{row.label}</span>
        <span className="text-[10px] text-muted-foreground">{row.hint}</span>
      </div>
      <ExpressionField
        place={{ kind: 'loop', context: 'E' }}
        expect="boolean"
        value={current.when}
        onChange={(when) => update({ ...current, when })}
        placeholder={row.placeholder}
        issues={at('/when')}
        ariaLabel={`${row.label} condition`}
      />
      {(rule || current.when) && (
        <StreakAndReason rule={current} onChange={update} issues={[...at('/consecutive'), ...at('/reason')]} label={row.label} />
      )}
      <FieldIssues issues={index === undefined ? [] : issues.filter((i) => i.field === `/loop/exits/${index}`)} />
    </div>
  );
}

function StreakAndReason({
  rule,
  onChange,
  issues,
  label,
}: {
  rule: ExitRule;
  onChange: (rule: ExitRule) => void;
  issues: readonly BuilderIssue[];
  label: string;
}) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <NumberStepper
          label="In a row"
          value={rule.consecutive}
          onChange={(consecutive) => onChange({ ...rule, consecutive })}
          min={1}
          max={10}
        />
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Reason</label>
          <Input
            value={rule.reason}
            onChange={(e) => onChange({ ...rule, reason: e.target.value })}
            aria-label={`${label} reason`}
            className="h-8 font-mono text-xs"
            placeholder="lower_snake_case"
            spellCheck={false}
          />
        </div>
      </div>
      {!REASON_PATTERN.test(rule.reason) && (
        <p className="mt-1 text-[11px] text-danger">Lower snake case, starting with a letter, at most 40 characters</p>
      )}
      <FieldIssues issues={issues} />
    </div>
  );
}

// ── Carried values ──

/** Rows added in the panel that have no expression yet (so no record holds their name). */
function usePendingNames() {
  const [pending, setPending] = useState<string[]>([]);
  return {
    pending,
    add: (name: string) => setPending((p) => [...p, name]),
    drop: (name: string) => setPending((p) => p.filter((n) => n !== name)),
    rename: (name: string, next: string) => setPending((p) => p.map((n) => (n === name ? next : n))),
  };
}

function freshName(prefix: string, taken: readonly string[]): string {
  let n = taken.length + 1;
  while (taken.includes(`${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

function CarryTable({ loop, setLoop, issues }: { loop: LoopSpec; setLoop: (u: Partial<LoopSpec>) => void; issues: readonly BuilderIssue[] }) {
  const pending = usePendingNames();
  const names = [
    ...new Set([
      ...Object.keys(loop.carry ?? {}),
      ...Object.keys(loop.carryInit ?? {}),
      ...Object.keys(loop.carrySchema ?? {}),
      ...pending.pending,
    ]),
  ];
  const [schemaOpen, setSchemaOpen] = useState<Record<string, boolean>>({});

  const setExpr = (field: 'carry' | 'carryInit', name: string, value: string) => {
    const record = loop[field];
    const next = value.trim() ? { ...(record ?? {}), [name]: value } : withoutKey(record, name);
    setLoop(field === 'carry' ? { carry: next } : { carryInit: next });
  };
  const rename = (name: string, next: string) => {
    pending.rename(name, next);
    setLoop({
      carry: renameKey(loop.carry, name, next),
      carryInit: renameKey(loop.carryInit, name, next),
      carrySchema: renameKey(loop.carrySchema, name, next),
    });
  };
  const remove = (name: string) => {
    pending.drop(name);
    setLoop({
      carry: withoutKey(loop.carry, name),
      carryInit: withoutKey(loop.carryInit, name),
      carrySchema: withoutKey(loop.carrySchema, name),
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted-foreground">
        Values carried from one iteration to the next, read as <code>loop.carry.&lt;name&gt;</code>. Every expression is
        evaluated after each iteration, all at once; the initial value once when the loop starts.
      </p>
      {names.map((name) => (
        <div key={name} className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <NameField name={name} taken={names.filter((n) => n !== name)} onRename={(next) => rename(name, next)} ariaLabel={`Carried value ${name} name`} />
            </div>
            <Button
              type="button"
              onClick={() => remove(name)}
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove carried value ${name}`}
              className="mt-1 h-auto w-auto p-1 text-muted-foreground hover:bg-transparent hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">After each iteration</label>
            <ExpressionField
              place={{ kind: 'loop', context: 'C' }}
              value={loop.carry?.[name] ?? ''}
              onChange={(v) => setExpr('carry', name, v)}
              placeholder="e.g. stages.review.output.comments"
              issues={issuesAt(issues, `/loop/carry/${name}`)}
              ariaLabel={`Carried value ${name} expression`}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">Initial value (optional; null otherwise)</label>
            <ExpressionField
              place={{ kind: 'loop', context: 'init' }}
              value={loop.carryInit?.[name] ?? ''}
              onChange={(v) => setExpr('carryInit', name, v)}
              placeholder="e.g. []"
              issues={issuesAt(issues, `/loop/carryInit/${name}`)}
              ariaLabel={`Carried value ${name} initial value`}
            />
          </div>
          {schemaOpen[name] || loop.carrySchema?.[name] ? (
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">JSON Schema (optional)</label>
              <JsonObjectEditor
                value={loop.carrySchema?.[name]}
                onChange={(schema) =>
                  setLoop({ carrySchema: schema ? { ...(loop.carrySchema ?? {}), [name]: schema } : withoutKey(loop.carrySchema, name) })
                }
                ariaLabel={`Carried value ${name} JSON Schema`}
                placeholder={'{ "type": "array", "items": { "type": "string" } }'}
                rows={3}
              />
              <FieldIssues issues={issuesAt(issues, `/loop/carrySchema/${name}`)} />
            </div>
          ) : (
            <Button
              type="button"
              onClick={() => setSchemaOpen((s) => ({ ...s, [name]: true }))}
              variant="ghost"
              size="sm"
              className="h-auto bg-transparent p-0 text-[11px] text-primary hover:bg-transparent hover:underline"
            >
              + Declare a type
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        onClick={() => pending.add(freshName('value', names))}
        variant="ghost"
        size="sm"
        className="h-auto gap-1 bg-transparent p-0 text-xs text-primary hover:bg-transparent hover:underline"
      >
        <Plus className="h-3 w-3" /> Add carried value
      </Button>
      <FieldIssues issues={issues.filter((i) => ['/loop/carry', '/loop/carryInit', '/loop/carrySchema'].includes(i.field ?? ''))} />
    </div>
  );
}

// ── Output select ──

function SelectTable({ loop, setLoop, issues }: { loop: LoopSpec; setLoop: (u: Partial<LoopSpec>) => void; issues: readonly BuilderIssue[] }) {
  const pending = usePendingNames();
  const select = loop.output.select;
  const names = [...new Set([...Object.keys(select ?? {}), ...pending.pending])];
  const setSelect = (next: Record<string, string> | undefined) => {
    const output: LoopSpec['output'] = { ...loop.output };
    if (next) output.select = next;
    else delete output.select;
    setLoop({ output });
  };

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted-foreground">
        Extra fields of <code>stages.&lt;loop&gt;.output</code>, evaluated when the loop ends (for the chosen iteration).
        The output always has iterations, exitReason, last, carry and history.
      </p>
      {names.map((name) => (
        <div key={name} className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <NameField
                name={name}
                taken={names.filter((n) => n !== name)}
                onRename={(next) => {
                  pending.rename(name, next);
                  setSelect(renameKey(select, name, next));
                }}
                ariaLabel={`Output field ${name} name`}
              />
            </div>
            <Button
              type="button"
              onClick={() => {
                pending.drop(name);
                setSelect(withoutKey(select, name));
              }}
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove output field ${name}`}
              className="mt-1 h-auto w-auto p-1 text-muted-foreground hover:bg-transparent hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ExpressionField
            place={{ kind: 'loop', context: 'E' }}
            value={select?.[name] ?? ''}
            onChange={(v) => setSelect(v.trim() ? { ...(select ?? {}), [name]: v } : withoutKey(select, name))}
            placeholder="e.g. loop.last.stages.review.output.summary"
            issues={issuesAt(issues, `/loop/output/select/${name}`)}
            ariaLabel={`Output field ${name} expression`}
          />
        </div>
      ))}
      <Button
        type="button"
        onClick={() => pending.add(freshName('field', names))}
        variant="ghost"
        size="sm"
        className="h-auto gap-1 bg-transparent p-0 text-xs text-primary hover:bg-transparent hover:underline"
      >
        <Plus className="h-3 w-3" /> Add output field
      </Button>
      <FieldIssues issues={issues.filter((i) => i.field === '/loop/output' || i.field === '/loop/output/select')} />
    </div>
  );
}

// ── Wrap-up ──

const WRAP_UP_TEXT =
  'Budget reached. Summarise verified progress, remaining work, blockers and the next step. Do not start new work.';

function WrapUpEditor({ stage, setLoop, issues }: { stage: LoopStage; setLoop: (u: Partial<LoopSpec>) => void; issues: readonly BuilderIssue[] }) {
  const wrapUp = stage.loop.wrapUp;
  // Body agent stages: the wrap-up continues one of their conversations.
  const bodyAgents = useWorkflowBuilderStore(
    useShallow((s) =>
      s.nodes
        .filter((n) => n.data.stage.parentKey === stage.key && n.data.stage.kind === 'agent')
        .map((n) => {
          const st = n.data.stage;
          return `${st.key}\u0000${st.name}\u0000${st.kind === 'agent' ? st.sessionReuse : ''}`;
        }),
    ),
  ).map((entry) => {
    const [key, name, reuse] = entry.split('\u0000') as [string, string, string];
    return { key, name, continues: reuse === 'continue' };
  });
  const eligible = bodyAgents.filter((a) => a.continues);
  const setWrapUp = (updates: Partial<NonNullable<LoopSpec['wrapUp']>>) => setLoop({ wrapUp: { ...wrapUp!, ...updates } });

  return (
    <div className="space-y-3">
      <ToggleSwitch
        checked={!!wrapUp}
        disabled={!wrapUp && bodyAgents.length === 0}
        onChange={(checked) =>
          setLoop({
            wrapUp: checked
              ? {
                  stage: (eligible[0] ?? bodyAgents[0])?.key ?? '',
                  prompt: { label: 'wrap_up', text: WRAP_UP_TEXT },
                  maxTurns: 1,
                  maxCostShare: 0.1,
                }
              : undefined,
          })
        }
        label="Wrap up when the budget runs out"
        description="One last turn in a body agent's continuing conversation, on its own allowance, before the limit applies."
      />
      {!wrapUp && bodyAgents.length === 0 && (
        <p className="text-[10px] text-muted-foreground">Needs an agent stage in the loop body.</p>
      )}
      {wrapUp && (
        <>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Stage</label>
            <Select
              aria-label="Wrap-up stage"
              value={wrapUp.stage}
              onChange={(v) => setWrapUp({ stage: v })}
              options={bodyAgents.map((a) => ({
                value: a.key,
                label: a.name,
                description: a.continues ? a.key : `${a.key}: set its session reuse to continue first`,
                disabled: !a.continues && a.key !== wrapUp.stage,
              }))}
            />
            {eligible.length === 0 && (
              <p className="mt-1 text-[10px] text-warning">
                No body agent continues its conversation: set one's session reuse to continue.
              </p>
            )}
            <FieldIssues issues={issuesAt(issues, '/loop/wrapUp/stage')} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Prompt</label>
            <Input
              value={wrapUp.prompt.label}
              onChange={(e) => setWrapUp({ prompt: { ...wrapUp.prompt, label: e.target.value } })}
              aria-label="Wrap-up prompt label"
              className="mb-1.5 h-8 text-xs"
              placeholder="Label"
            />
            <Textarea
              value={wrapUp.prompt.text}
              onChange={(e) => setWrapUp({ prompt: { ...wrapUp.prompt, text: e.target.value } })}
              rows={3}
              aria-label="Wrap-up prompt"
              className="resize-y text-xs"
              placeholder="What the agent should write in its last turn"
            />
            <FieldIssues issues={issuesAt(issues, '/loop/wrapUp/prompt')} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberStepper label="Max turns" value={wrapUp.maxTurns} onChange={(maxTurns) => setWrapUp({ maxTurns })} min={1} max={5} />
            <NumberStepper
              label="Cost share"
              value={wrapUp.maxCostShare}
              onChange={(maxCostShare) => setWrapUp({ maxCostShare })}
              min={0}
              max={0.5}
              step={0.05}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">Cost share: the part of the budget's max cost the wrap-up may spend on top.</p>
          <FieldIssues issues={issuesAt(issues, '/loop/wrapUp/maxTurns', '/loop/wrapUp/maxCostShare')} />
        </>
      )}
    </div>
  );
}
