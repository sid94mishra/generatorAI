// ────────────────────────────────────────────────────────────────
// WaitPanel — the inspector of a wait stage (P05 §4.3, WP-5B.3).
//
// A wait holds no agent, lease or admission slot: it parks until a person
// approves (optionally filling a form), an external event arrives (the
// deliver_event command, or the wait's own callback URL for CI), or a
// timer elapses. Its output is `{outcome, data, by, at}`, so a timeout
// can be routed with an edge `when: stages.<key>.output.outcome == 'timeout'`.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Clock, Hourglass, Info } from 'lucide-react';
import type { WaitSpec, WaitStage } from '@generatorai/workflow-spec';
import type { BuilderIssue, StageUpdate } from '@/stores/workflowBuilderStore.js';
import { Input, Select, Textarea } from '@/components/ui/index.js';
import { CollapsibleSection } from '../CollapsibleSection.js';
import { NumberStepper } from '../NumberStepper.js';
import { ExpressionField, FieldIssues, issuesAt } from '../engineGate.js';
import { JsonObjectEditor } from './fields.js';

interface WaitPanelProps {
  stage: WaitStage;
  onUpdate: (updates: StageUpdate) => void;
  issues: readonly BuilderIssue[];
}

type WaitType = WaitSpec['type'];

/** A fresh wait of `type`, keeping what carries over (the timeout policy). */
function blankWait(type: WaitType, from: WaitSpec): WaitSpec {
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

export function WaitPanel({ stage, onUpdate, issues }: WaitPanelProps) {
  const wait = stage.wait;
  const setWait = (next: WaitSpec) => onUpdate({ wait: next });

  return (
    <div>
      <CollapsibleSection title="Wait for" icon={<Hourglass className="h-3.5 w-3.5" />} defaultOpen>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Type</label>
          <Select
            aria-label="Wait type"
            value={wait.type}
            onChange={(v) => setWait(blankWait(v as WaitType, wait))}
            options={[
              { value: 'approval', label: 'An approval', description: 'A person approves or rejects, optionally filling a form' },
              { value: 'event', label: 'An external event', description: 'The deliver_event command or the callback URL' },
              { value: 'timer', label: 'A timer', description: 'A fixed delay' },
            ]}
          />
        </div>

        {wait.type === 'approval' && (
          <>
            <div>
              <label htmlFor="wait-prompt-label" className="mb-1.5 block text-xs font-medium text-foreground">Question</label>
              <Input
                id="wait-prompt-label"
                value={wait.prompt.label}
                onChange={(e) => setWait({ ...wait, prompt: { ...wait.prompt, label: e.target.value } })}
                placeholder="Short label, e.g. Deploy?"
              />
              <Textarea
                value={wait.prompt.text}
                onChange={(e) => setWait({ ...wait, prompt: { ...wait.prompt, text: e.target.value } })}
                rows={3}
                aria-label="Approval prompt"
                className="mt-1.5 resize-y font-mono text-xs"
                placeholder="What the approver is asked; {{templates}} allowed"
              />
              <FieldIssues issues={issuesAt(issues, '/wait/prompt')} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground">Form (JSON Schema)</label>
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
              <p className="mt-1 text-[10px] text-muted-foreground">
                Optional. The approver fills it; the answer is <code>stages.{stage.key}.output.data</code>.
              </p>
              <FieldIssues issues={issuesAt(issues, '/wait/form')} />
            </div>
          </>
        )}

        {wait.type === 'event' && (
          <div>
            <label htmlFor="wait-event-key" className="mb-1.5 block text-xs font-medium text-foreground">Event key</label>
            <ExpressionField
              id="wait-event-key"
              value={wait.eventKey}
              onChange={(eventKey) => setWait({ ...wait, eventKey })}
              placeholder="e.g. concat('ci:', stages.push.output.sha)"
              issues={issuesAt(issues, '/wait/eventKey')}
              ariaLabel="Event key expression"
            />
            <div className="mt-1.5 flex items-start gap-1.5 rounded-md bg-info-muted px-2 py-1.5 text-[11px] text-info">
              <Info className="mt-px h-3 w-3 shrink-0" />
              <span>
                The oldest undelivered event with this key completes the wait (an early event is kept). Deliver it with the{' '}
                <code>deliver_event</code> run command, or post to the wait&apos;s callback URL (shown on the run page) — no
                user credential needed.
              </span>
            </div>
          </div>
        )}

        {wait.type === 'timer' && (
          <div>
            <NumberStepper
              label="Duration (minutes)"
              value={Math.round(wait.durationMs / 60_000)}
              onChange={(v) => setWait({ ...wait, durationMs: Math.max(1, v) * 60_000 })}
              min={1}
              max={43_200}
              step={5}
              unit="min"
            />
            <FieldIssues issues={issuesAt(issues, '/wait/durationMs')} />
          </div>
        )}
      </CollapsibleSection>

      {wait.type !== 'timer' && (
        <CollapsibleSection title="Timeout" icon={<Clock className="h-3.5 w-3.5" />} defaultOpen={wait.timeoutMs !== undefined}>
          <NumberStepper
            label="Give up after (minutes, 0 = never)"
            value={wait.timeoutMs ? Math.round(wait.timeoutMs / 60_000) : 0}
            onChange={(v) => {
              const next = { ...wait };
              if (v > 0) next.timeoutMs = v * 60_000;
              else delete next.timeoutMs;
              setWait(next);
            }}
            min={0}
            max={43_200}
            step={5}
            unit="min"
          />
          <p className="text-[10px] text-muted-foreground">
            Without a timeout, a run started by an automation or a webhook expires after 72 hours.
          </p>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">On timeout</label>
            <Select
              aria-label="On timeout"
              value={wait.onTimeout}
              onChange={(v) => setWait({ ...wait, onTimeout: v as 'fail' | 'complete' })}
              options={[
                { value: 'fail', label: 'Fail the stage', description: 'wait_timeout; a failure edge can route it' },
                {
                  value: 'complete',
                  label: 'Complete with outcome timeout',
                  description: "Route with an edge when: stages.<key>.output.outcome == 'timeout'",
                },
              ]}
            />
          </div>
          <FieldIssues issues={issuesAt(issues, '/wait/timeoutMs', '/wait/onTimeout')} />
        </CollapsibleSection>
      )}
      <FieldIssues issues={issues.filter((i) => i.field === '/wait' || i.field === '/wait/type')} />
    </div>
  );
}
