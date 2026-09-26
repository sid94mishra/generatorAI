// ────────────────────────────────────────────────────────────────
// Policy tab (WorkflowBuilder board): approval after the stage, the join
// and guard, plan-then-execute, timeouts, the budget, retries and what
// happens when they are exhausted, and compensation (saga undo steps).
// ────────────────────────────────────────────────────────────────

import { ApprovalSpecSchema, DynamicExpansionSchema, RetryPolicySchema } from '@generatorai/workflow-spec';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { ExpressionField } from '../../../fields/ExpressionField.js';
import { FieldIssues, issuesAt } from '../../../fields/FieldIssues.js';
import { InspectorNote, InspectorSection } from '../../../fields/InspectorLayout.js';
import { ArgsEditor, BudgetFields, CompensationEditor, JoinFields, num } from '../../../fields/stageFields.js';
import type { AgentStageSpec } from '../../types.js';
import { Row } from '../Row.js';
import type { AgentTabProps } from './tabProps.js';

type Timeouts = NonNullable<AgentStageSpec['timeouts']>;
type Retry = NonNullable<AgentStageSpec['retry']>;

const TIMEOUTS: { field: keyof Timeouts; label: string; max: number }[] = [
  { field: 'attemptMs', label: 'Attempt', max: 86_400 },
  { field: 'idleMs', label: 'Idle', max: 86_400 },
  { field: 'totalMs', label: 'Total', max: 604_800 },
  { field: 'queueMs', label: 'Queue', max: 86_400 },
];

function ApprovalSection({ stage, onUpdate, issues }: AgentTabProps) {
  const approval = stage.approval;
  return (
    <InspectorSection
      title="Approval"
      hint="after the stage finishes"
      action={
        <Switch
          aria-label="Approval required"
          checked={!!approval}
          onCheckedChange={(checked) => onUpdate({ approval: checked ? ApprovalSpecSchema.parse({}) : undefined })}
        />
      }
      data-testid="stage-approval"
    >
      {approval ? (
        <>
          <Row label="Prompt for the reviewer" stacked>
            <ExpressionField
              mode="template"
              value={approval.prompt ?? ''}
              onChange={(prompt) => onUpdate({ approval: { ...approval, prompt: prompt || undefined } })}
              rows={2}
              ariaLabel="Reviewer prompt"
              placeholder="What should the reviewer check? {{ }} completes"
              issues={issuesAt(issues, '/approval/prompt')}
            />
          </Row>
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox
              label="Allow change requests"
              checked={approval.allowChanges}
              onCheckedChange={(allowChanges) => onUpdate({ approval: { ...approval, allowChanges } })}
            />
            {approval.allowChanges ? (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-small text-fg-2">Max rounds</span>
                <NumberField
                  size="sm"
                  className="w-20"
                  aria-label="Change-request rounds"
                  value={approval.maxRounds}
                  onValueChange={(v) => onUpdate({ approval: { ...approval, maxRounds: Math.max(1, Math.min(10, Math.round(num(v, 1)))) } })}
                  min={1}
                  max={10}
                />
              </div>
            ) : null}
          </div>
          <InspectorNote>The run pauses after this stage until a person approves{approval.allowChanges ? ' or requests changes (another turn)' : ''}.</InspectorNote>
        </>
      ) : (
        <InspectorNote>Pause after this stage completes and wait for a human to approve or request changes before the next stage runs.</InspectorNote>
      )}
      <FieldIssues issues={issuesAt(issues, '/approval').filter((i) => !(i.field ?? '').startsWith('/approval/prompt'))} />
    </InspectorSection>
  );
}

function ExpansionSection({ stage, onUpdate, issues }: AgentTabProps) {
  const expands = stage.expands;
  return (
    <InspectorSection
      title="Plan, then execute"
      action={
        <Switch
          aria-label="This stage plans stages"
          checked={!!expands}
          onCheckedChange={(checked) => onUpdate({ expands: checked ? DynamicExpansionSchema.parse({}) : undefined })}
        />
      }
      data-testid="stage-expansion"
    >
      <InspectorNote>Its output is a plan of agent stages, which the engine validates and runs after it; the stages after this one wait for them.</InspectorNote>
      {expands ? (
        <>
          <Row label="Max stages">
            <NumberField
              size="sm"
              className="w-24"
              aria-label="Planned stages at most"
              value={expands.maxStages}
              onValueChange={(v) => onUpdate({ expands: { ...expands, maxStages: Math.max(1, Math.min(20, Math.round(num(v, 1)))) } })}
              min={1}
              max={20}
            />
          </Row>
          <Row label="On failure" hint={expands.join === 'all' ? 'Every planned stage must complete.' : 'The expansion completes and lists the failed stages.'}>
            <Select
              size="sm"
              aria-label="Expansion join"
              value={expands.join}
              onValueChange={(v) => v && onUpdate({ expands: { ...expands, join: v as 'all' | 'tolerate' } })}
              items={[
                { value: 'all', label: 'Fail the expansion' },
                { value: 'tolerate', label: 'Continue' },
              ]}
            />
          </Row>
          <Row label="Agents" hint="Agents a planned stage may use, one scope:slug per line (empty: the default agent only).">
            <ArgsEditor
              args={expands.allowedAgentRefs}
              onChange={(allowedAgentRefs) => onUpdate({ expands: { ...expands, allowedAgentRefs } })}
              ariaLabel="Allowed agents"
              placeholder="global:bug-fixer"
            />
          </Row>
          <Row label="Models" hint="Models a planned stage may use, one id per line (empty: the default model only).">
            <ArgsEditor
              args={expands.allowedModels}
              onChange={(allowedModels) => onUpdate({ expands: { ...expands, allowedModels } })}
              ariaLabel="Allowed models"
              placeholder="claude-sonnet-5"
            />
          </Row>
        </>
      ) : null}
      <FieldIssues issues={issuesAt(issues, '/expands')} />
    </InspectorSection>
  );
}

function TimeoutsSection({ stage, onUpdate, issues }: AgentTabProps) {
  const set = (field: keyof Timeouts, seconds: number | null) => {
    const rest: Timeouts = { ...(stage.timeouts ?? {}) };
    if (seconds && seconds > 0) rest[field] = Math.round(seconds * 1000);
    else delete rest[field];
    onUpdate({ timeouts: Object.keys(rest).length > 0 ? rest : undefined });
  };
  return (
    <InspectorSection title="Timeouts" hint="seconds" data-testid="stage-timeouts">
      <div className="grid grid-cols-4 gap-2">
        {TIMEOUTS.map(({ field, label, max }) => (
          <div key={field} className="flex min-w-0 flex-col gap-1">
            <span className="text-small font-medium text-fg-2">{label}</span>
            <NumberField
              size="sm"
              aria-label={`${label} timeout (seconds)`}
              unit="s"
              steppers={false}
              value={stage.timeouts?.[field] ? stage.timeouts[field]! / 1000 : null}
              onValueChange={(v) => set(field, v)}
              min={0}
              max={max}
              step={30}
            />
          </div>
        ))}
      </div>
      <InspectorNote>Empty: no attempt or total limit; the engine default idle (10 min) and queue (30 min) timeouts.</InspectorNote>
      <FieldIssues issues={issuesAt(issues, '/timeouts')} />
    </InspectorSection>
  );
}

function RetrySection({ stage, onUpdate, issues }: AgentTabProps) {
  const retry = stage.retry;
  const set = (patch: Partial<Retry>) => retry && onUpdate({ retry: { ...retry, ...patch } });
  return (
    <InspectorSection
      title="Retry"
      action={
        <Switch
          aria-label="Retry on failure"
          checked={!!retry}
          onCheckedChange={(checked) => onUpdate({ retry: checked ? RetryPolicySchema.parse({}) : undefined })}
        />
      }
      data-testid="stage-retry"
    >
      {retry ? (
        <>
          <div className="grid grid-cols-4 gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-small font-medium text-fg-2">Max attempts</span>
              <NumberField
                size="sm"
                aria-label="Max attempts (including the first)"
                value={retry.maxAttempts}
                onValueChange={(v) => set({ maxAttempts: Math.max(1, Math.min(10, Math.round(num(v, 1)))) })}
                min={1}
                max={10}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-small font-medium text-fg-2">Initial delay</span>
              <NumberField
                size="sm"
                aria-label="Initial delay (ms)"
                unit="ms"
                steppers={false}
                value={retry.initialDelayMs}
                onValueChange={(v) => set({ initialDelayMs: Math.max(0, Math.round(num(v))) })}
                min={0}
                max={3_600_000}
                step={500}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-small font-medium text-fg-2">Multiplier</span>
              <NumberField
                size="sm"
                aria-label="Backoff multiplier"
                unit="×"
                steppers={false}
                value={retry.backoffMultiplier}
                onValueChange={(v) => set({ backoffMultiplier: Math.max(1, Math.min(10, num(v, 1))) })}
                min={1}
                max={10}
                step={0.5}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-small font-medium text-fg-2">Max delay</span>
              <NumberField
                size="sm"
                aria-label="Max delay (ms)"
                unit="ms"
                steppers={false}
                value={retry.maxDelayMs}
                onValueChange={(v) => set({ maxDelayMs: Math.max(0, Math.round(num(v))) })}
                min={0}
                max={3_600_000}
                step={1000}
              />
            </div>
          </div>
          <Row label="Jitter" hint={retry.jitter === 'full' ? 'Random 0..delay.' : retry.jitter === 'equal' ? 'Half the delay plus a random half.' : 'The exact delay.'}>
            <Select
              size="sm"
              aria-label="Retry jitter"
              value={retry.jitter}
              onValueChange={(v) => v && set({ jitter: v as Retry['jitter'] })}
              items={[
                { value: 'full', label: 'Full' },
                { value: 'equal', label: 'Equal' },
                { value: 'none', label: 'None' },
              ]}
            />
          </Row>
          <Row label="Mode" hint={retry.mode === 'resume' ? 'Continues the same conversation.' : 'Begins again from the first prompt.'}>
            <SegmentedControl
              label="Retry mode"
              value={retry.mode}
              onValueChange={(mode) => set({ mode })}
              items={[
                { value: 'resume', label: 'Resume' },
                { value: 'restart', label: 'Restart' },
              ]}
            />
          </Row>
        </>
      ) : (
        <InspectorNote>Automatically retry this stage if an attempt fails.</InspectorNote>
      )}
      <FieldIssues issues={issuesAt(issues, '/retry')} />
      <Row label="When exhausted">
        <Select
          size="sm"
          aria-label="When retries are exhausted"
          value={stage.onExhausted ?? ''}
          onValueChange={(v) => onUpdate({ onExhausted: (v || undefined) as AgentStageSpec['onExhausted'] })}
          items={[
            { value: '', label: 'Engine default (pause)' },
            { value: 'pause', label: 'Pause for a person' },
            { value: 'fail', label: 'Fail the stage' },
          ]}
        />
        <FieldIssues issues={issuesAt(issues, '/onExhausted')} />
      </Row>
    </InspectorSection>
  );
}

export function PolicyTab(props: AgentTabProps) {
  const { stage, onUpdate, issues } = props;
  return (
    <>
      <ApprovalSection {...props} />
      <InspectorSection title="Run condition">
        <JoinFields join={stage.join} onChange={(join) => onUpdate({ join })} issues={issues} />
        <Row label="Guard" hint="The stage is skipped when this is false. Leave empty to always run.">
          <ExpressionField
            expect="boolean"
            value={stage.guard ?? ''}
            onChange={(v) => onUpdate({ guard: v.trim() ? v : undefined })}
            placeholder="e.g. variables.env == 'prod' and stages.review.status == 'completed'"
            issues={issuesAt(issues, '/guard')}
            ariaLabel="Guard expression"
          />
        </Row>
      </InspectorSection>
      <ExpansionSection {...props} />
      <TimeoutsSection {...props} />
      <InspectorSection title="Budget" hint="per stage, all attempts">
        <BudgetFields budget={stage.budget} onChange={(budget) => onUpdate({ budget })} issues={issuesAt(issues, '/budget')} />
      </InspectorSection>
      <RetrySection {...props} />
      <InspectorSection title="Compensation" hint="undo if the run fails later" count={stage.compensate?.length || undefined}>
        <CompensationEditor actions={stage.compensate} onChange={(compensate) => onUpdate({ compensate })} issues={issues} />
      </InspectorSection>
    </>
  );
}
