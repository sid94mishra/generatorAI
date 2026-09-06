// ────────────────────────────────────────────────────────────────
// AgentBindingSection — bind a first-class Agent to a workflow stage.
//
// Replaces the old AgentSelector, which built a throwaway `customAgents`
// entry with an EMPTY instructions string: the harness then received an
// agent that had a name and a description but no instructions at all. Here the
// stage stores the portable `scope:slug` ref and an additive override delta;
// `AgentResolver` performs the union server-side at execution time.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/index.js';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { useResolveAgentPreview, useSelectableAgents } from '@/hooks/agentQueries.js';
import { AgentPicker } from '@/components/agents/AgentPicker.js';
import { AgentOverridesEditor } from '@/components/agents/AgentOverridesEditor.js';
import { EffectiveCapabilitiesPanel } from '@/components/agents/EffectiveCapabilitiesPanel.js';
import type {
  StageDefinition,
  HarnessConfig,
  AgentOverrides,
  ResolvedAgentProjection,
} from '@generatorai/shared';

interface AgentBindingSectionProps {
  stage: StageDefinition;
  onUpdate: (updates: Partial<StageDefinition>) => void;
}

export function AgentBindingSection({ stage, onUpdate }: AgentBindingSectionProps) {
  const projectId = useWorkflowBuilderStore((s) => s.projectId) ?? undefined;
  const { data: agents } = useSelectableAgents(projectId);
  const resolvePreview = useResolveAgentPreview();

  const overridesFromStage =
    (stage.harnessConfigOverrides as Partial<HarnessConfig> | undefined)?.agentOverrides ?? {};

  const [showCapabilities, setShowCapabilities] = useState(false);
  const [projection, setProjection] = useState<ResolvedAgentProjection | undefined>(undefined);

  const agentRef = stage.agentRef ?? undefined;
  const selectedAgent = (agents ?? []).find((a) => a.ref === agentRef);

  const setOverrides = (next: AgentOverrides) => {
    const rest = { ...(stage.harnessConfigOverrides as Partial<HarnessConfig> | undefined) };
    if (Object.keys(next).length === 0) delete rest.agentOverrides;
    else rest.agentOverrides = next;
    onUpdate({
      harnessConfigOverrides: (Object.keys(rest).length > 0 ? rest : undefined) as
        | Partial<HarnessConfig>
        | undefined,
    });
  };

  const overridesKey = JSON.stringify(overridesFromStage);
  const resolveMutate = resolvePreview.mutateAsync;
  useEffect(() => {
    if (!agentRef && overridesKey === '{}') {
      setProjection(undefined);
      return;
    }
    const timer = setTimeout(() => {
      void resolveMutate({
        scope: 'stage',
        ...(agentRef ? { agentRef } : {}),
        ...(projectId ? { projectId } : {}),
        overrides: JSON.parse(overridesKey) as AgentOverrides,
      })
        .then(setProjection)
        .catch(() => setProjection(undefined));
    }, 300);
    return () => clearTimeout(timer);
  }, [agentRef, overridesKey, projectId, resolveMutate]);

  return (
    <div className="space-y-3" data-testid="stage-agent-binding">
      <div>
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Bot className="h-3.5 w-3.5 text-primary" />
          Agent
        </label>
        <AgentPicker
          value={agentRef}
          {...(projectId ? { projectId } : {})}
          data-testid="stage-agent-picker"
          onChange={(ref) => onUpdate({ agentRef: ref ?? null } as Partial<StageDefinition>)}
        />
        <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
          Skills and MCP servers chosen below are ADDED to the agent&apos;s own — an agent with 5
          skills plus 2 selected here gives the stage 7.
        </p>
      </div>

      <Button
        type="button"
        onClick={() => setShowCapabilities((v) => !v)}
        data-testid="stage-customize-capabilities"
        variant="ghost"
        size="sm"
        className="h-auto bg-transparent p-0 text-xs font-medium text-primary hover:bg-transparent hover:underline"
      >
        {showCapabilities ? 'Hide capabilities' : 'Customize capabilities'}
      </Button>

      {showCapabilities && (
        <div className="rounded-lg border border-border">
          <AgentOverridesEditor
            {...(selectedAgent ? { agent: selectedAgent } : {})}
            value={overridesFromStage}
            onChange={setOverrides}
            {...(projectId ? { projectId } : {})}
            {...(projection ? { effectiveGroups: projection.toolPolicy.groups } : {})}
          />
        </div>
      )}

      {(agentRef || overridesKey !== '{}') && (
        <div className="rounded-lg bg-subtle p-3">
          <EffectiveCapabilitiesPanel
            projection={projection}
            isLoading={resolvePreview.isPending && !projection}
            {...(selectedAgent
              ? {
                  baseCounts: {
                    skills: selectedAgent.skillIds.length,
                    mcpServers: selectedAgent.mcpServerIds.length,
                  },
                }
              : {})}
          />
        </div>
      )}
    </div>
  );
}
