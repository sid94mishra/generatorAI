// ────────────────────────────────────────────────────────────────
// Session tab (WorkflowStageModel board): the agent binding (optional),
// the model and runtime over the workflow session (model, reasoning effort,
// context window, provider, max turns, agent mode, permission, capability
// warnings), the conversation group, the stage it reviews (D-156) and where
// it edits (D-155).
// ────────────────────────────────────────────────────────────────

import type { AgentStage, SessionSpec } from '@generatorai/workflow-spec';
import { useMemo } from 'react';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { FieldIssues, issuesAt } from '../../../fields/FieldIssues.js';
import { InspectorSection } from '../../../fields/InspectorLayout.js';
import { patchStageSession } from '../../../model/sessionPatch.js';
import { isToolField } from '../agentTabs.js';
import { Row } from '../Row.js';
import { SessionSpecEditor, type SessionSpecSection } from '../session/index.js';
import type { AgentTabProps } from './tabProps.js';

/** The stage's session editor over the workflow session, for `sections`. */
export function useStageSessionEditor({ stage, onUpdate }: Pick<AgentTabProps, 'stage' | 'onUpdate'>) {
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId ?? undefined);
  const workflowSession = useWorkflowBuilderStore((s) => s.workflow.session);
  return (sections: readonly SessionSpecSection[], headings = false) => (
    <SessionSpecEditor
      headings={headings}
      value={stage.session}
      onChange={(updates: Partial<SessionSpec>) => onUpdate(patchStageSession(stage, updates))}
      scope="stage"
      projectId={projectId}
      inherited={workflowSession}
      sections={sections}
    />
  );
}

const NOT_A_REVIEW = 'none';
const WORKSPACES: ReadonlyArray<{ value: NonNullable<AgentStage['workspace']>; label: string; hint: string }> = [
  { value: 'auto', label: 'Own copy when in parallel', hint: 'While another stage may run at the same time, this one edits its own git worktree, merged back when it completes.' },
  { value: 'shared', label: "The run's folder", hint: "Always edits the run's folder, even beside a parallel stage." },
  { value: 'isolated', label: 'Always its own copy', hint: 'Always edits its own git worktree, merged back when it completes.' },
];

export function SessionTab(props: AgentTabProps) {
  const { stage, onUpdate, issues } = props;
  const editor = useStageSessionEditor(props);
  const nodes = useWorkflowBuilderStore((s) => s.nodes);
  const reviewable = useMemo(
    () => nodes.map((n) => n.data.stage).filter((s) => s.kind === 'agent' && s.key !== stage.key),
    [nodes, stage.key],
  );
  const sessionIssues = issuesAt(issues, '/session').filter((i) => !isToolField(i.field));
  const groupIssues = issuesAt(issues, '/sessionGroup');
  const workspace = WORKSPACES.find((w) => w.value === (stage.workspace ?? 'auto'))!;
  return (
    <>
      {editor(['agent', 'runtime', 'mode', 'warnings'], true)}
      <FieldIssues issues={sessionIssues} />
      <InspectorSection title="Session">
        <Row label="Session group" hint="Stages with the same group share one conversation, one at a time.">
          <Input
            mono
            size="sm"
            aria-label="Session group"
            value={stage.sessionGroup ?? ''}
            onChange={(e) => onUpdate({ sessionGroup: e.target.value.trim() ? e.target.value.trim() : undefined })}
            placeholder="optional, e.g. audit"
            spellCheck={false}
            invalid={groupIssues.some((i) => i.severity === 'error')}
          />
          <FieldIssues issues={groupIssues} />
        </Row>
        <Row label="Reviews" hint="Unless this stage names its agent, provider or model, it runs on another provider than the stage it reviews.">
          <Select
            aria-label="Reviews"
            size="sm"
            value={stage.reviewOf ?? NOT_A_REVIEW}
            onValueChange={(v) => onUpdate({ reviewOf: v && v !== NOT_A_REVIEW ? v : undefined })}
            items={[{ value: NOT_A_REVIEW, label: 'Nothing' }, ...reviewable.map((s) => ({ value: s.key, label: s.name }))]}
          />
          <FieldIssues issues={issuesAt(issues, '/reviewOf')} />
        </Row>
        <Row label="Edits in" hint={workspace.hint}>
          <Select
            aria-label="Edits in"
            size="sm"
            value={workspace.value}
            onValueChange={(v) => onUpdate({ workspace: v === 'auto' || !v ? undefined : (v as AgentStage['workspace']) })}
            items={WORKSPACES.map((w) => ({ value: w.value, label: w.label }))}
          />
        </Row>
      </InspectorSection>
    </>
  );
}
