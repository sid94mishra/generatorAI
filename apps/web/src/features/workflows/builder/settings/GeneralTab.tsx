// ────────────────────────────────────────────────────────────────
// General tab: the workflow's name and description, and the workflow
// session (`graph.workflow.session`) — the defaults every stage inherits
// unless its own session overrides them.
// ────────────────────────────────────────────────────────────────

import type { SessionSpec } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { FieldIssues } from '../fields/FieldIssues.js';
import { InspectorNote, InspectorRow, InspectorSection } from '../fields/InspectorLayout.js';
import { SessionSpecEditor } from '../inspector/agent/session/index.js';
import { applySessionPatch } from '../model/sessionPatch.js';

export function GeneralTab() {
  const name = useWorkflowBuilderStore((s) => s.workflow.name);
  const description = useWorkflowBuilderStore((s) => s.workflow.description ?? '');
  const session = useWorkflowBuilderStore((s) => s.workflow.session);
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId ?? undefined);
  const issues = useWorkflowBuilderStore((s) => s.issues);
  const updateWorkflow = useWorkflowBuilderStore((s) => s.updateWorkflow);

  const setSession = (updates: Partial<SessionSpec>) => updateWorkflow({ session: applySessionPatch(session, updates) });
  const nameIssues = issues.filter((i) => i.path === '/workflow/name');

  return (
    <>
      <InspectorSection title="Workflow">
        <InspectorRow label="Name">
          <Input
            id="workflow-name"
            size="sm"
            value={name}
            aria-label="Workflow name"
            aria-required="true"
            invalid={nameIssues.some((i) => i.severity === 'error') || !name.trim()}
            onChange={(e) => updateWorkflow({ name: e.target.value })}
            placeholder="My workflow"
          />
          <FieldIssues issues={nameIssues} />
        </InspectorRow>
        <InspectorRow label="Description" optional>
          <Textarea
            id="workflow-description"
            value={description}
            aria-label="Workflow description"
            autosize={{ minRows: 2, maxRows: 6 }}
            onChange={(e) => updateWorkflow({ description: e.target.value || undefined })}
            placeholder="Describe what this workflow does…"
          />
          <FieldIssues issues={issues.filter((i) => i.path === '/workflow/description')} />
        </InspectorRow>
      </InspectorSection>

      <InspectorSection title="Session">
        <InspectorNote>Defaults every stage inherits; a stage can override each one.</InspectorNote>
        <SessionSpecEditor value={session} onChange={setSession} scope="workflow" projectId={projectId} />
        <FieldIssues issues={issues.filter((i) => i.path.startsWith('/workflow/session'))} />
      </InspectorSection>
    </>
  );
}
