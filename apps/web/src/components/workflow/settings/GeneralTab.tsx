// ────────────────────────────────────────────────────────────────
// GeneralTab — Workflow name, description, session mode
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { WorkflowSessionMode } from '@generatorai/shared';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { cn } from '@/lib/utils.js';
import { Input, Textarea } from '@/components/ui/index.js';

const SESSION_MODE_INFO: Record<WorkflowSessionMode, { label: string; description: string }> = {
  auto: {
    label: 'Automatic (Recommended)',
    description:
      // Resolved once for the whole run at start, not per chain: if the DAG
      // has ANY parallelism the run uses per-stage sessions throughout.
      'Picks the mode for you when the run starts: per-stage sessions if the graph has any parallel branches, otherwise a single shared session.',
  },
  single: {
    label: 'Single Session',
    description:
      'All stages share one agent session and execute sequentially. Best for workflows where stages build on shared context.',
  },
  'per-stage': {
    label: 'Per-Stage Sessions',
    description:
      'Every stage gets its own isolated agent session. Best for fully independent stages that can run in parallel.',
  },
};

export function GeneralTab() {
  const name = useWorkflowBuilderStore((s) => s.name);
  const description = useWorkflowBuilderStore((s) => s.description);
  const sessionMode = useWorkflowBuilderStore((s) => s.sessionMode);
  const setName = useWorkflowBuilderStore((s) => s.setName);
  const setDescription = useWorkflowBuilderStore((s) => s.setDescription);
  const setSessionMode = useWorkflowBuilderStore((s) => s.setSessionMode);

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
          onChange={(e) => setName(e.target.value)}
          placeholder="My Workflow"
        />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="workflow-description" className="mb-1.5 block text-sm font-medium text-foreground">
          Description
        </label>
        <Textarea
          id="workflow-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="resize-none"
          placeholder="Describe what this workflow does..."
        />
      </div>

      {/* Session Mode */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          Session Mode
        </label>
        <div className="space-y-2">
          {(['auto', 'single', 'per-stage'] as WorkflowSessionMode[]).map((mode) => {
            const info = SESSION_MODE_INFO[mode];
            return (
              <label
                key={mode}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all',
                  sessionMode === mode
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50',
                )}
              >
                <input
                  type="radio"
                  name="sessionMode"
                  value={mode}
                  checked={sessionMode === mode}
                  onChange={() => setSessionMode(mode)}
                  className="mt-0.5 h-4 w-4 text-primary"
                />
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {info.label}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {info.description}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
