// ────────────────────────────────────────────────────────────────
// GeneralTab — Workflow name, description and the workflow session
// (`graph.workflow.session`: everything every stage inherits unless its own
// session overrides it), edited with the shared SessionSpecEditor.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { SessionSpec } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { Input, Textarea } from '@/components/ui/index.js';
import { SessionSpecEditor, applySessionPatch } from '@/components/session/SessionSpecEditor.js';
import { FieldIssues } from '../engineGate.js';

export function GeneralTab() {
  const name = useWorkflowBuilderStore((s) => s.workflow.name);
  const description = useWorkflowBuilderStore((s) => s.workflow.description ?? '');
  const session = useWorkflowBuilderStore((s) => s.workflow.session);
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId ?? undefined);
  const issues = useWorkflowBuilderStore((s) => s.issues);
  const updateWorkflow = useWorkflowBuilderStore((s) => s.updateWorkflow);

  const setSession = (updates: Partial<SessionSpec>) => {
    updateWorkflow({ session: applySessionPatch(session, updates) });
  };

  return (
    <div className="space-y-6">
      {/* Name */}
      <div>
        <label htmlFor="workflow-name" className="mb-1.5 block text-sm font-medium text-foreground">
          Workflow Name<span className="text-danger" aria-hidden="true">*</span>
        </label>
        <Input
          id="workflow-name"
          type="text"
          value={name}
          aria-required="true"
          onChange={(e) => updateWorkflow({ name: e.target.value })}
          placeholder="My Workflow"
        />
        <FieldIssues issues={issues.filter((i) => i.path === '/workflow/name')} />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="workflow-description" className="mb-1.5 block text-sm font-medium text-foreground">
          Description
        </label>
        <Textarea
          id="workflow-description"
          value={description}
          onChange={(e) => updateWorkflow({ description: e.target.value || undefined })}
          rows={3}
          className="resize-none"
          placeholder="Describe what this workflow does..."
        />
      </div>

      {/* Session — inherited by every stage */}
      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-medium text-foreground">Session</h4>
          <p className="text-xs text-muted-foreground">Defaults every stage inherits; a stage can override each one.</p>
        </div>
        <SessionSpecEditor value={session} onChange={setSession} scope="workflow" projectId={projectId} />
        <FieldIssues issues={issues.filter((i) => i.path.startsWith('/workflow/session'))} />
      </div>
    </div>
  );
}
