// ────────────────────────────────────────────────────────────────
// The "Loop" tab of a loop stage (P05 §2.1; WorkflowLoopBuilder board):
// max iterations, the exit rules (WF-18 ExitRuleTable: four quick rows
// plus more rules), the carried values (WF-18 CarryTable), the cumulative
// budget, what running out does (on limit, on body failure, checkpoints),
// the extra output fields and the wrap-up turn. Validator issues show next
// to the field their JSON pointer names (`/loop/exits/<j>/when`, …).
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { LoopSpec, LoopStage } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore, type BuilderIssue, type StageUpdate } from '@/stores/workflowBuilderStore.js';
import { ExitRuleTable } from '@/blocks/workflow/ExitRuleTable/ExitRuleTable.js';
import { CarryTable } from '@/blocks/workflow/CarryTable/CarryTable.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { ExpressionField } from '../../fields/ExpressionField.js';
import { FieldIssues, issuesAt } from '../../fields/FieldIssues.js';
import { InspectorNote, InspectorRow, InspectorSection } from '../../fields/InspectorLayout.js';
import { BudgetFields, JsonObjectEditor, NameField, num, renameKey, withoutKey } from '../../fields/stageFields.js';

interface LoopTabProps {
  stage: LoopStage;
  onUpdate: (updates: StageUpdate) => void;
  issues: readonly BuilderIssue[];
}

type OnLimitMode = LoopSpec['onLimit']['mode'];

const ON_LIMIT_HINTS: Record<OnLimitMode, string> = {
  pause: 'Park the loop for an operator decision (default).',
  fail: 'Fail the loop.',
  accept_last: 'Complete with the last iteration.',
  accept_best: 'Complete with the best-scoring iteration; its checkpoint is restored.',
};

/** Issues at exactly `pointers` (`exact`) or at or below them. */
function issuesFor(issues: readonly BuilderIssue[], pointers: readonly string[], exact: boolean): BuilderIssue[] {
  return exact ? issues.filter((i) => pointers.includes(i.field ?? '')) : issuesAt(issues, ...pointers);
}

/** Every section of the Loop tab (after the stage basics). */
export function LoopSections({ stage, onUpdate, issues }: LoopTabProps) {
  const loop = stage.loop;
  /** Merge `updates` into `loop`; an `undefined` value removes the field. */
  const setLoop = (updates: Partial<LoopSpec>) => {
    const next: Record<string, unknown> = { ...loop, ...updates };
    for (const [k, v] of Object.entries(updates)) if (v === undefined) delete next[k];
    onUpdate({ loop: next as LoopSpec });
  };
  const bodyKeys = useWorkflowBuilderStore(useShallow((s) => s.nodes.filter((n) => n.data.stage.parentKey === stage.key).map((n) => n.id)));
  // Issues on the loop as a whole (empty body, no exit rule) rather than one field.
  const general = issues.filter((i) => i.field === '' || i.field === '/loop' || i.field === '/loop/exits');
  const carryCount = new Set([...Object.keys(loop.carry ?? {}), ...Object.keys(loop.carryInit ?? {}), ...Object.keys(loop.carrySchema ?? {})]).size;

  return (
    <>
      <InspectorSection title="Iterations" hint={bodyKeys.length > 0 ? `body: ${bodyKeys.join(' · ')}` : 'empty body'}>
        <InspectorRow label="Max iterations" hint="1 to 50. The body (the stages inside the loop) runs up to this many times; an operator may grant more.">
          <NumberField
            size="sm"
            aria-label="Max iterations"
            className="w-28"
            value={loop.maxIterations}
            onValueChange={(v) => setLoop({ maxIterations: Math.min(50, Math.max(1, num(v, 1))) })}
            min={1}
            max={50}
          />
          <FieldIssues issues={issuesAt(issues, '/loop/maxIterations')} />
        </InspectorRow>
        <FieldIssues issues={general} />
      </InspectorSection>

      <InspectorSection title="Exit rules" count={loop.exits.length || undefined} action={<span className="text-small text-fg-3">checked after each iteration</span>}>
        <ExitRuleTable
          rules={loop.exits}
          onChange={(exits) => setLoop({ exits })}
          renderCondition={(slot) => (
            <ExpressionField
              place={{ kind: 'loop', context: 'E' }}
              expect="boolean"
              value={slot.value}
              onChange={slot.onChange}
              placeholder={slot.placeholder}
              issues={slot.index === undefined ? [] : issuesAt(issues, `/loop/exits/${slot.index}/when`)}
              ariaLabel={slot.ariaLabel}
            />
          )}
          renderIssues={(pointers, exact) => (
            <FieldIssues issues={issuesFor(issues, pointers.map((p) => `/loop/exits${p}`), exact)} />
          )}
        />
      </InspectorSection>

      <InspectorSection title="Carry" count={carryCount || undefined}>
        <InspectorNote>
          Values carried from one iteration to the next, read as <InlineCode dense>loop.carry.&lt;name&gt;</InlineCode>. Every
          expression is evaluated after each iteration, all at once; the initial value once when the loop starts (null otherwise).
        </InspectorNote>
        <CarryTable
          value={{ carry: loop.carry, carryInit: loop.carryInit, carrySchema: loop.carrySchema }}
          onChange={(next) => setLoop({ carry: next.carry, carryInit: next.carryInit, carrySchema: next.carrySchema })}
          renderName={(slot) => <NameField name={slot.name} taken={slot.taken} onRename={slot.onRename} ariaLabel={slot.ariaLabel} />}
          renderExpression={(slot) => (
            <ExpressionField
              place={{ kind: 'loop', context: slot.column === 'init' ? 'init' : 'C' }}
              value={slot.value}
              onChange={slot.onChange}
              placeholder={slot.placeholder}
              issues={issuesAt(issues, `/loop/${slot.column === 'init' ? 'carryInit' : 'carry'}/${slot.name}`)}
              ariaLabel={slot.ariaLabel}
              quiet
            />
          )}
          renderSchema={(slot) => (
            <JsonObjectEditor
              value={slot.value}
              onChange={slot.onChange}
              ariaLabel={slot.ariaLabel}
              placeholder={'JSON Schema (optional), e.g. { "type": "array", "items": { "type": "string" } }'}
              rows={3}
            />
          )}
          renderIssues={(pointers, exact) => (
            <FieldIssues
              issues={issuesFor(
                issues,
                // A row's expression issues show under their editors; its schema's here.
                pointers.filter((p) => exact || p.startsWith('/carrySchema/')).map((p) => `/loop${p}`),
                exact,
              )}
            />
          )}
        />
      </InspectorSection>

      <InspectorSection title="Budget" hint="all iterations">
        <InspectorNote>Cumulative over every iteration. Exhausting it runs the wrap-up (if any), then the on-limit policy.</InspectorNote>
        <BudgetFields budget={stage.budget} onChange={(budget) => onUpdate({ budget })} issues={issuesAt(issues, '/budget')} />
      </InspectorSection>

      <InspectorSection title="When the loop runs out">
        <InspectorRow label="On limit" hint={`Max iterations, the budget or a stall. ${ON_LIMIT_HINTS[loop.onLimit.mode]}`} stacked>
          <SegmentedControl<OnLimitMode>
            label="On limit"
            fullWidth
            value={loop.onLimit.mode}
            onValueChange={(v) =>
              setLoop({
                onLimit:
                  v === 'accept_best'
                    ? { mode: 'accept_best', score: loop.onLimit.mode === 'accept_best' ? loop.onLimit.score : '' }
                    : ({ mode: v } as LoopSpec['onLimit']),
              })
            }
            items={[
              { value: 'pause', label: 'Pause' },
              { value: 'fail', label: 'Fail' },
              { value: 'accept_last', label: 'Accept last' },
              { value: 'accept_best', label: 'Accept best' },
            ]}
          />
          <FieldIssues issues={issuesAt(issues, '/loop/onLimit/mode')} />
        </InspectorRow>
        {loop.onLimit.mode === 'accept_best' ? (
          <InspectorRow label="Score" hint="A number per iteration; ties go to the latest.">
            <ExpressionField
              place={{ kind: 'loop', context: 'E' }}
              value={loop.onLimit.score}
              onChange={(score) => setLoop({ onLimit: { mode: 'accept_best', score } })}
              placeholder="e.g. stages.judge.output.score"
              issues={issuesAt(issues, '/loop/onLimit/score')}
              ariaLabel="Score expression"
            />
          </InspectorRow>
        ) : null}
        <InspectorRow
          label="On body failure"
          hint={loop.onBodyFailure === 'next_iteration' ? 'The failures are in loop.last.failures.' : 'An iteration that fails fails the loop.'}
        >
          <SegmentedControl<LoopSpec['onBodyFailure']>
            label="On body failure"
            value={loop.onBodyFailure}
            onValueChange={(onBodyFailure) => setLoop({ onBodyFailure })}
            items={[
              { value: 'fail', label: 'Fail' },
              { value: 'next_iteration', label: 'Next iteration' },
            ]}
          />
          <FieldIssues issues={issuesAt(issues, '/loop/onBodyFailure')} />
        </InspectorRow>
        <div className="flex flex-col gap-1">
          <Switch
            checked={loop.checkpointEachIteration ?? loop.onLimit.mode === 'accept_best'}
            onCheckedChange={(checked) => setLoop({ checkpointEachIteration: checked })}
            label="Checkpoint each iteration"
          />
          <InspectorNote>
            Snapshot the workspace after every iteration, so an operator can accept or re-run from any of them. On by default with
            accept best.
          </InspectorNote>
          <FieldIssues issues={issuesAt(issues, '/loop/checkpointEachIteration')} />
        </div>
      </InspectorSection>

      <InspectorSection title="Output" count={Object.keys(loop.output.select ?? {}).length || undefined}>
        <OutputSelect loop={loop} setLoop={setLoop} issues={issues} />
      </InspectorSection>

      <InspectorSection title="Wrap-up">
        <WrapUpEditor stage={stage} setLoop={setLoop} issues={issues} />
      </InspectorSection>
    </>
  );
}

// ── Output select ──

function OutputSelect({ loop, setLoop, issues }: { loop: LoopSpec; setLoop: (u: Partial<LoopSpec>) => void; issues: readonly BuilderIssue[] }) {
  // Rows added here that have no expression yet (so no record holds their name).
  const [pending, setPending] = useState<string[]>([]);
  const select = loop.output.select;
  const names = [...new Set([...Object.keys(select ?? {}), ...pending])];
  const setSelect = (next: Record<string, string> | undefined) => {
    const output: LoopSpec['output'] = { ...loop.output };
    if (next) output.select = next;
    else delete output.select;
    setLoop({ output });
  };

  return (
    <div className="flex flex-col gap-2">
      <InspectorNote>
        Extra fields of <InlineCode dense>stages.&lt;loop&gt;.output</InlineCode>, evaluated when the loop ends (for the chosen
        iteration). The output always has iterations, exitReason, last, carry and history.
      </InspectorNote>
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
                      setPending((p) => p.map((n) => (n === name ? next : n)));
                      setSelect(renameKey(select, name, next));
                    }}
                    ariaLabel={`Output field ${name} name`}
                  />
                </div>
                <IconButton
                  icon="trash"
                  size="sm"
                  label={`Remove output field ${name}`}
                  onClick={() => {
                    setPending((p) => p.filter((n) => n !== name));
                    setSelect(withoutKey(select, name));
                  }}
                />
              </div>
              <ExpressionField
                place={{ kind: 'loop', context: 'E' }}
                value={select?.[name] ?? ''}
                onChange={(v) => setSelect(v.trim() ? { ...(select ?? {}), [name]: v } : withoutKey(select, name))}
                placeholder="e.g. loop.last.stages.review.output.summary"
                issues={issuesAt(issues, `/loop/output/select/${name}`)}
                ariaLabel={`Output field ${name} expression`}
                quiet
              />
            </div>
          ))}
        </div>
      ) : null}
      <div>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          className="-ml-2"
          onClick={() => {
            let n = names.length + 1;
            while (names.includes(`field_${n}`)) n++;
            setPending((p) => [...p, `field_${n}`]);
          }}
        >
          Add output field
        </Button>
      </div>
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
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <Switch
          checked={!!wrapUp}
          disabled={!wrapUp && bodyAgents.length === 0}
          onCheckedChange={(checked) =>
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
        />
        <InspectorNote>
          {!wrapUp && bodyAgents.length === 0
            ? 'Needs an agent stage in the loop body.'
            : "One last turn in a body agent's continuing conversation, on its own allowance, before the limit applies."}
        </InspectorNote>
      </div>
      {wrapUp ? (
        <>
          <InspectorRow label="Stage">
            <Select
              aria-label="Wrap-up stage"
              size="sm"
              value={wrapUp.stage}
              onValueChange={(v) => v && setWrapUp({ stage: v })}
              items={bodyAgents.map((a) => ({
                value: a.key,
                label: a.name,
                meta: a.continues ? a.key : `${a.key} · not continuing`,
                disabled: !a.continues && a.key !== wrapUp.stage,
              }))}
            />
            {eligible.length === 0 ? (
              <InspectorNote tone="warn">No body agent continues its conversation: set one&apos;s session reuse to continue.</InspectorNote>
            ) : null}
            <FieldIssues issues={issuesAt(issues, '/loop/wrapUp/stage')} />
          </InspectorRow>
          <InspectorRow label="Prompt" stacked>
            <Input
              size="sm"
              value={wrapUp.prompt.label}
              onChange={(e) => setWrapUp({ prompt: { ...wrapUp.prompt, label: e.target.value } })}
              aria-label="Wrap-up prompt label"
              placeholder="Label"
            />
            <ExpressionField
              mode="template"
              value={wrapUp.prompt.text}
              onChange={(text) => setWrapUp({ prompt: { ...wrapUp.prompt, text } })}
              rows={3}
              ariaLabel="Wrap-up prompt"
              placeholder="What the agent should write in its last turn; {{ }} completes"
              issues={issuesAt(issues, '/loop/wrapUp/prompt')}
            />
          </InspectorRow>
          <div className="grid grid-cols-2 gap-2.5">
            <InspectorRow label="Max turns" stacked>
              <NumberField
                size="sm"
                aria-label="Wrap-up max turns"
                value={wrapUp.maxTurns}
                onValueChange={(v) => setWrapUp({ maxTurns: Math.min(5, Math.max(1, num(v, 1))) })}
                min={1}
                max={5}
              />
            </InspectorRow>
            <InspectorRow label="Cost share" stacked>
              <NumberField
                size="sm"
                aria-label="Wrap-up cost share"
                value={wrapUp.maxCostShare}
                onValueChange={(v) => setWrapUp({ maxCostShare: Math.min(0.5, Math.max(0, num(v))) })}
                min={0}
                max={0.5}
                step={0.05}
              />
            </InspectorRow>
          </div>
          <InspectorNote>Cost share: the part of the budget&apos;s max cost the wrap-up may spend on top.</InspectorNote>
          <FieldIssues issues={issuesAt(issues, '/loop/wrapUp/maxTurns', '/loop/wrapUp/maxCostShare')} />
        </>
      ) : null}
    </div>
  );
}
