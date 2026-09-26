// ────────────────────────────────────────────────────────────────
// The "Wait" tab of a wait stage (P05 §4.3): a wait holds no agent, lease
// or admission slot. It parks until a person approves (optionally filling
// a form), an external event arrives (the deliver_event command, or the
// wait's own callback URL for CI), or a timer elapses. Its output is
// `{outcome, data, by, at}`, so a timeout can be routed with an edge
// `when: stages.<key>.output.outcome == 'timeout'`.
// ────────────────────────────────────────────────────────────────

import type { WaitSpec, WaitStage } from '@generatorai/workflow-spec';
import type { BuilderIssue, StageUpdate } from '@/stores/workflowBuilderStore.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { ExpressionField } from '../../fields/ExpressionField.js';
import { FieldIssues, issuesAt } from '../../fields/FieldIssues.js';
import { InspectorRow, InspectorSection } from '../../fields/InspectorLayout.js';
import { JsonObjectEditor, num } from '../../fields/stageFields.js';

interface WaitTabProps {
  stage: WaitStage;
  onUpdate: (updates: StageUpdate) => void;
  issues: readonly BuilderIssue[];
}

type WaitType = WaitSpec['type'];

const TYPE_HINTS: Record<WaitType, string> = {
  approval: 'A person approves or rejects, optionally filling a form.',
  event: 'The deliver_event command or the callback URL.',
  timer: 'A fixed delay.',
};

/** A fresh wait of `type`, keeping what carries over (the timeout policy). */
export function blankWait(type: WaitType, from: WaitSpec): WaitSpec {
  const timeout =
    from.type === 'timer'
      ? { onTimeout: 'fail' as const }
      : { ...(from.timeoutMs !== undefined ? { timeoutMs: from.timeoutMs } : {}), onTimeout: from.onTimeout };
  switch (type) {
    case 'approval':
      return { type, prompt: { label: 'Approve', text: 'Approve to continue.' }, ...timeout };
    case 'event':
      return { type, eventKey: "'ready'", ...timeout };
    case 'timer':
      return { type, durationMs: 60_000 };
  }
}

/** Every section of the Wait tab (after the stage basics). */
export function WaitSections({ stage, onUpdate, issues }: WaitTabProps) {
  const wait = stage.wait;
  const setWait = (next: WaitSpec) => onUpdate({ wait: next });

  return (
    <>
      <InspectorSection title="Wait for">
        <InspectorRow label="Type" hint={TYPE_HINTS[wait.type]}>
          <SegmentedControl<WaitType>
            label="Wait type"
            value={wait.type}
            onValueChange={(v) => v !== wait.type && setWait(blankWait(v, wait))}
            items={[
              { value: 'approval', label: 'Approval' },
              { value: 'event', label: 'Event' },
              { value: 'timer', label: 'Timer' },
            ]}
          />
        </InspectorRow>

        {wait.type === 'approval' ? (
          <>
            <InspectorRow label="Question" stacked>
              <Input
                size="sm"
                value={wait.prompt.label}
                onChange={(e) => setWait({ ...wait, prompt: { ...wait.prompt, label: e.target.value } })}
                aria-label="Question"
                placeholder="Short label, e.g. Deploy?"
              />
              <ExpressionField
                mode="template"
                value={wait.prompt.text}
                onChange={(text) => setWait({ ...wait, prompt: { ...wait.prompt, text } })}
                rows={3}
                ariaLabel="Approval prompt"
                placeholder="What the approver is asked; {{ }} completes"
                issues={issuesAt(issues, '/wait/prompt')}
              />
            </InspectorRow>
            <InspectorRow
              label="Form (JSON Schema)"
              stacked
              optional
              hint={
                <>
                  The approver fills it; the answer is <InlineCode dense>stages.{stage.key}.output.data</InlineCode>.
                </>
              }
            >
              <JsonObjectEditor
                value={wait.form}
                onChange={(form) => {
                  const next = { ...wait };
                  if (form) next.form = form;
                  else delete next.form;
                  setWait(next);
                }}
                placeholder={'{\n  "type": "object",\n  "required": ["environment"],\n  "properties": { "environment": { "enum": ["staging", "prod"] } }\n}'}
                ariaLabel="Approval form JSON Schema"
              />
              <FieldIssues issues={issuesAt(issues, '/wait/form')} />
            </InspectorRow>
          </>
        ) : null}

        {wait.type === 'event' ? (
          <>
            <InspectorRow label="Event key" stacked>
              <ExpressionField
                value={wait.eventKey}
                onChange={(eventKey) => setWait({ ...wait, eventKey })}
                placeholder="e.g. concat('ci:', stages.push.output.sha)"
                issues={issuesAt(issues, '/wait/eventKey')}
                ariaLabel="Event key expression"
              />
            </InspectorRow>
            <Callout tone="info">
              The oldest undelivered event with this key completes the wait (an early event is kept). Deliver it with the{' '}
              <InlineCode dense>deliver_event</InlineCode> run command, or post to the wait&apos;s callback URL (shown on the run page) —
              no user credential needed.
            </Callout>
          </>
        ) : null}

        {wait.type === 'timer' ? (
          <InspectorRow label="Duration">
            <NumberField
              size="sm"
              aria-label="Duration (minutes)"
              value={Math.round(wait.durationMs / 60_000)}
              onValueChange={(v) => setWait({ ...wait, durationMs: Math.min(43_200, Math.max(1, num(v, 1))) * 60_000 })}
              min={1}
              max={43_200}
              step={5}
              unit="min"
            />
            <FieldIssues issues={issuesAt(issues, '/wait/durationMs')} />
          </InspectorRow>
        ) : null}
      </InspectorSection>

      {wait.type !== 'timer' ? (
        <InspectorSection title="Timeout">
          <InspectorRow label="Give up after" hint="Empty: never. Without a timeout, a run started by an automation or a webhook expires after 72 hours.">
            <NumberField
              size="sm"
              aria-label="Give up after (minutes, 0 = never)"
              value={wait.timeoutMs ? Math.round(wait.timeoutMs / 60_000) : null}
              onValueChange={(v) => {
                const next = { ...wait };
                if (v && v > 0) next.timeoutMs = Math.min(43_200, v) * 60_000;
                else delete next.timeoutMs;
                setWait(next);
              }}
              min={0}
              max={43_200}
              step={5}
              unit="min"
            />
          </InspectorRow>
          <InspectorRow
            label="On timeout"
            hint={
              wait.onTimeout === 'fail'
                ? 'wait_timeout; a failure edge can route it.'
                : "Route with an edge when: stages.<key>.output.outcome == 'timeout'."
            }
          >
            <SegmentedControl<'fail' | 'complete'>
              label="On timeout"
              value={wait.onTimeout}
              onValueChange={(onTimeout) => setWait({ ...wait, onTimeout })}
              items={[
                { value: 'fail', label: 'Fail the stage' },
                { value: 'complete', label: 'Complete' },
              ]}
            />
          </InspectorRow>
          <FieldIssues issues={issuesAt(issues, '/wait/timeoutMs', '/wait/onTimeout')} />
        </InspectorSection>
      ) : null}
      <FieldIssues issues={issues.filter((i) => i.field === '/wait' || i.field === '/wait/type')} />
    </>
  );
}
