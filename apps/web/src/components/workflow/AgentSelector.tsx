// ────────────────────────────────────────────────────────────────
// AgentSelector — Select one custom agent per stage
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Bot, Info } from 'lucide-react';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { useAvailableArtifacts } from '@/hooks/projectQueries.js';
import { StyledSelect } from './StyledSelect.js';
import type { StageDefinition, HarnessConfig } from '@generatorai/shared';

interface AgentSelectorProps {
  stage: StageDefinition;
  onUpdate: (updates: Partial<StageDefinition>) => void;
}

export function AgentSelector({ stage, onUpdate }: AgentSelectorProps) {
  const projectId = useWorkflowBuilderStore((s) => s.projectId);
  const { data: agentArtifacts, isLoading } = useAvailableArtifacts(projectId ?? undefined, 'agent');

  const currentOverrides = stage.harnessConfigOverrides as Partial<HarnessConfig> | undefined;
  const selectedAgent = stage.agentName ?? currentOverrides?.customAgents?.[0]?.name ?? '';

  const handleAgentChange = (agentName: string) => {
    if (!agentName) {
      // Clear agent — remove agentName and customAgents
      const updates: Partial<StageDefinition> = { agentName: undefined };
      if (currentOverrides) {
        const { customAgents: _, ...rest } = currentOverrides;
        updates.harnessConfigOverrides = Object.keys(rest).length > 0 ? rest as Partial<HarnessConfig> : undefined;
      }
      onUpdate(updates);
    } else {
      const agent = agentArtifacts?.find((a) => a.name === agentName);
      onUpdate({
        agentName: agentName,
        harnessConfigOverrides: {
          ...currentOverrides,
          customAgents: [
            {
              name: agentName,
              description: agent?.description ?? '',
              instructions: '',
            },
          ],
        } as Partial<HarnessConfig>,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        Loading agents...
      </div>
    );
  }

  const agentOptions = [
    { value: '', label: 'No agent', description: 'Use default Copilot agent' },
    ...(agentArtifacts?.map((a) => ({
      value: a.name,
      label: a.name,
      description: a.description ?? `${a.source} agent`,
    })) ?? []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 rounded-md bg-info-muted px-2.5 py-1.5 text-[10px] text-info">
        <Info className="h-3 w-3 shrink-0" />
        <span>Only one custom agent can be used per stage. The agent handles all prompts in this stage.</span>
      </div>

      {agentOptions.length <= 1 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-center">
          <Bot className="mx-auto h-6 w-6 text-muted-foreground mb-1.5" />
          <p className="text-xs text-muted-foreground">
            No custom agents available.
            {!projectId && ' Link a project to access its agents.'}
          </p>
        </div>
      ) : (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">
            Custom Agent
          </label>
          <StyledSelect
            value={selectedAgent}
            onChange={handleAgentChange}
            options={agentOptions}
            placeholder="Select an agent..."
          />
        </div>
      )}
    </div>
  );
}
