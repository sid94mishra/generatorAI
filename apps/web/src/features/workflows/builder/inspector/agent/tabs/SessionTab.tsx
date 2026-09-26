// ────────────────────────────────────────────────────────────────
// Session tab (WorkflowStageModel board): the agent binding (optional),
// the model and runtime over the workflow session (model, reasoning effort,
// context window, provider, max turns, agent mode, permission, capability
// warnings) and the conversation group.
// ────────────────────────────────────────────────────────────────

import type { SessionSpec } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { Input } from '@/ui/primitives/Input/Input.js';
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

export function SessionTab(props: AgentTabProps) {
  const { stage, onUpdate, issues } = props;
  const editor = useStageSessionEditor(props);
  const sessionIssues = issuesAt(issues, '/session').filter((i) => !isToolField(i.field));
  const groupIssues = issuesAt(issues, '/sessionGroup');
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
      </InspectorSection>
    </>
  );
}
