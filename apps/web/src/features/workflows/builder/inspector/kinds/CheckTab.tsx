// ────────────────────────────────────────────────────────────────
// The "Check" tab of a check stage (P05 §1.2): one deterministic command,
// no LLM. The command comes from the server's allow-list, the arguments
// are literals and the output is the exit code plus the tails of
// stdout/stderr (optionally parsed JSON). Its timeouts and retry live on
// the Policy tab (CheckPolicySections).
// ────────────────────────────────────────────────────────────────

import { RetryPolicySchema, type CheckSpec, type CheckStage } from '@generatorai/workflow-spec';
import type { BuilderIssue, StageUpdate } from '@/stores/workflowBuilderStore.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { FieldIssues, issuesAt } from '../../fields/FieldIssues.js';
import { InspectorNote, InspectorRow, InspectorSection } from '../../fields/InspectorLayout.js';
import { num } from '../../fields/stageFields.js';
import { CheckCommandFields, CommandAdminNote, EnvTable, mergeCheckSpec } from './checkFields.js';

interface CheckTabProps {
  stage: CheckStage;
  onUpdate: (updates: StageUpdate) => void;
  issues: readonly BuilderIssue[];
}

/** Command, environment and result handling of a check stage. */
export function CheckSections({ stage, onUpdate, issues }: CheckTabProps) {
  const check = stage.check;
  const setCheck = (updates: Partial<CheckSpec>) => onUpdate({ check: mergeCheckSpec(check, updates) });
  const envCount = check.env ? Object.keys(check.env).length : 0;

  return (
    <>
      <CommandAdminNote />
      <InspectorSection title="Command">
        <CheckCommandFields spec={check} onChange={setCheck} issues={issues} pointer="/check" />
      </InspectorSection>
      <InspectorSection title="Environment" count={envCount || undefined}>
        <EnvTable env={check.env} onChange={(env) => setCheck({ env })} issues={issues} pointer="/check/env" />
      </InspectorSection>
      <InspectorSection title="Result">
        <div className="flex flex-col gap-1">
          <Switch checked={check.parseJson} onCheckedChange={(parseJson) => setCheck({ parseJson })} label="Parse stdout as JSON" />
          <InspectorNote>The parsed value is output.json (a parse error is output.jsonError).</InspectorNote>
        </div>
        <div className="flex flex-col gap-1">
          <Switch
            checked={check.failOnNonZero}
            onCheckedChange={(failOnNonZero) => setCheck({ failOnNonZero })}
            label="Fail the stage on a non-zero exit"
          />
          <InspectorNote>Off: the stage completes with passed: false, which exit rules and edges can read.</InspectorNote>
        </div>
        <InspectorRow label="Output kept" hint="The tail of each stream the output keeps.">
          <NumberField
            size="sm"
            aria-label="Output kept (KB of each stream's tail)"
            value={Math.round(check.tailBytes / 1024)}
            onValueChange={(kb) => setCheck({ tailBytes: Math.min(256, Math.max(1, num(kb, 1))) * 1024 })}
            min={1}
            max={256}
            step={4}
            unit="KB"
          />
        </InspectorRow>
        <FieldIssues issues={issuesAt(issues, '/check/parseJson', '/check/failOnNonZero', '/check/tailBytes')} />
      </InspectorSection>
    </>
  );
}

/** The Policy tab's check parts: the command timeout, the queue timeout and retry. */
export function CheckPolicySections({ stage, onUpdate, issues }: CheckTabProps) {
  const check = stage.check;
  const setCheck = (updates: Partial<CheckSpec>) => onUpdate({ check: mergeCheckSpec(check, updates) });
  return (
    <>
      <InspectorSection title="Timeouts">
        <div className="grid grid-cols-2 gap-2.5">
          <InspectorRow label="Command" stacked>
            <NumberField
              size="sm"
              aria-label="Command timeout (seconds)"
              value={Math.round(check.timeoutMs / 1000)}
              onValueChange={(v) => setCheck({ timeoutMs: Math.min(3600, Math.max(1, num(v, 1))) * 1000 })}
              min={1}
              max={3600}
              step={30}
              unit="sec"
            />
          </InspectorRow>
          <InspectorRow label="Queue" stacked optional>
            <NumberField
              size="sm"
              aria-label="Queue timeout (seconds, 0 = default)"
              value={stage.timeouts?.queueMs ? stage.timeouts.queueMs / 1000 : null}
              onValueChange={(v) => onUpdate({ timeouts: v && v > 0 ? { queueMs: v * 1000 } : undefined })}
              min={0}
              max={86_400}
              step={30}
              unit="sec"
            />
          </InspectorRow>
        </div>
        <InspectorNote>The command is killed after its timeout (timedOut: true, passed: false). Empty queue: the default.</InspectorNote>
        <FieldIssues issues={issuesAt(issues, '/check/timeoutMs')} />
        <FieldIssues issues={issuesAt(issues, '/timeouts')} />
      </InspectorSection>
      <InspectorSection
        title="Retry"
        action={
          <Switch
            aria-label="Retry on failure"
            checked={!!stage.retry}
            onCheckedChange={(checked) => onUpdate({ retry: checked ? RetryPolicySchema.parse({}) : undefined })}
          />
        }
      >
        <InspectorNote>Run the command again when an attempt fails (a failing exit only counts with Fail on non-zero).</InspectorNote>
        {stage.retry ? (
          <InspectorRow label="Max attempts" hint="Including the first.">
            <NumberField
              size="sm"
              aria-label="Max attempts (including the first)"
              value={stage.retry.maxAttempts}
              onValueChange={(v) => onUpdate({ retry: { ...stage.retry!, maxAttempts: Math.min(10, Math.max(1, num(v, 1))) } })}
              min={1}
              max={10}
            />
          </InspectorRow>
        ) : null}
        <FieldIssues issues={issuesAt(issues, '/retry')} />
      </InspectorSection>
    </>
  );
}
