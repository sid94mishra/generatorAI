// ────────────────────────────────────────────────────────────────
// GeneralTab — Workflow name, description and the workflow session
// (`graph.workflow.session`: the model, reasoning effort, agent and agent
// mode every stage inherits unless its own session overrides them).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { AGENT_MODES, REASONING_EFFORTS, type SessionSpec } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { Input, Select, Textarea } from '@/components/ui/index.js';
import { ModelPicker } from '@/components/shared/ModelPicker.js';
import { AgentPicker } from '@/components/agents/AgentPicker.js';
import { FieldIssues } from '../engineGate.js';

export function GeneralTab() {
  const name = useWorkflowBuilderStore((s) => s.workflow.name);
  const description = useWorkflowBuilderStore((s) => s.workflow.description ?? '');
  const session = useWorkflowBuilderStore((s) => s.workflow.session);
  const projectId = useWorkflowBuilderStore((s) => s.workflow.projectId ?? undefined);
  const issues = useWorkflowBuilderStore((s) => s.issues);
  const updateWorkflow = useWorkflowBuilderStore((s) => s.updateWorkflow);

  const setSession = (updates: Partial<SessionSpec>) => {
    const next: Record<string, unknown> = { ...session, ...updates };
    for (const [k, v] of Object.entries(updates)) if (v === undefined) delete next[k];
    updateWorkflow({ session: next as SessionSpec });
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
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Model</label>
          <ModelPicker
            value={session.model ?? ''}
            onChange={(v) => setSession({ model: v || undefined })}
            allowEmpty
            emptyLabel="Provider default"
            emptyDescription="Use the provider or agent default"
            placeholder="Select a model…"
            ariaLabel="Workflow model"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Reasoning Effort</label>
            <Select
              aria-label="Workflow reasoning effort"
              value={session.reasoningEffort ?? ''}
              onChange={(v) => setSession({ reasoningEffort: (v || undefined) as SessionSpec['reasoningEffort'] })}
              options={[
                { value: '', label: 'Default' },
                ...REASONING_EFFORTS.map((e) => ({ value: e, label: e[0]!.toUpperCase() + e.slice(1) })),
              ]}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Agent Mode</label>
            <Select
              aria-label="Workflow agent mode"
              value={session.defaultAgentMode ?? ''}
              onChange={(v) => setSession({ defaultAgentMode: (v || undefined) as SessionSpec['defaultAgentMode'] })}
              options={[
                { value: '', label: 'Default' },
                ...AGENT_MODES.map((m) => ({ value: m, label: m === 'plan' ? 'Plan' : 'Auto' })),
              ]}
            />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Agent</label>
          <AgentPicker
            value={session.agentRef}
            {...(projectId ? { projectId } : {})}
            onChange={(ref) => setSession({ agentRef: ref })}
          />
        </div>
        <FieldIssues issues={issues.filter((i) => i.path.startsWith('/workflow/session'))} />
      </div>
    </div>
  );
}
