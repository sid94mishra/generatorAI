// ────────────────────────────────────────────────────────────────
// Bind a first-class agent to a session (workflow or stage). The session
// stores the portable `scope:slug` ref (`agentRef`) and an additive
// override delta (`agentOverrides`); `AgentResolver` performs the union
// server-side at execution time. The effective capabilities (resolved by
// the server, redacted) show under it while an agent or a delta is set.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import type { Agent, AgentOverrides, ResolvedAgentProjection } from '@generatorai/shared';
import type { SessionSpec } from '@generatorai/workflow-spec';
import { useResolveAgentPreview } from '@/hooks/agentQueries.js';
import { AgentPicker } from '@/blocks/agent-picker/AgentPicker.js';
import { EffectiveCapabilities } from '@/blocks/capabilities/EffectiveCapabilities.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { InspectorNote } from '../../../fields/InspectorLayout.js';
import { AgentOverridesEditor } from './AgentOverridesEditor.js';
import { useBoundAgent } from './sessionModel.js';

export interface AgentBindingSectionProps {
  /** The (partial) session being edited. */
  session: SessionSpec | undefined;
  /** Patch semantics: a key set to undefined is removed. */
  onChange: (updates: Partial<SessionSpec>) => void;
  projectId?: string | undefined;
  /** The binding site the preview resolves for. */
  scope: 'chat' | 'stage';
  /** The picked agent itself (a host may react to its role). */
  onAgentChange?: (agent: Agent | undefined) => void;
  testIdPrefix?: string;
}

/** Agent picker, "Customize capabilities" (the override delta) and the effective capabilities. */
export function AgentBindingSection({ session, onChange, projectId, scope, onAgentChange, testIdPrefix = 'stage' }: AgentBindingSectionProps) {
  const resolvePreview = useResolveAgentPreview();
  const overrides = (session?.agentOverrides ?? {}) as AgentOverrides;
  const agentRef = session?.agentRef;
  const selectedAgent = useBoundAgent(agentRef, projectId);
  const [showCapabilities, setShowCapabilities] = useState(false);
  const [projection, setProjection] = useState<ResolvedAgentProjection | undefined>(undefined);

  const setOverrides = (next: AgentOverrides) =>
    onChange({ agentOverrides: Object.keys(next).length > 0 ? (next as SessionSpec['agentOverrides']) : undefined });

  const overridesKey = JSON.stringify(overrides);
  const resolveMutate = resolvePreview.mutateAsync;
  useEffect(() => {
    if (!agentRef && overridesKey === '{}') {
      setProjection(undefined);
      return;
    }
    const timer = setTimeout(() => {
      void resolveMutate({
        scope,
        ...(agentRef ? { agentRef } : {}),
        ...(projectId ? { projectId } : {}),
        overrides: JSON.parse(overridesKey) as AgentOverrides,
      })
        .then(setProjection)
        .catch(() => setProjection(undefined));
    }, 300);
    return () => clearTimeout(timer);
  }, [agentRef, overridesKey, projectId, resolveMutate, scope]);

  return (
    <div className="flex flex-col gap-2" data-testid={`${testIdPrefix}-agent-binding`}>
      <AgentPicker
        value={agentRef}
        {...(projectId ? { projectId } : {})}
        data-testid={`${testIdPrefix}-agent-picker`}
        onChange={(ref, agent) => {
          onChange({ agentRef: ref });
          onAgentChange?.(agent);
        }}
      />
      <div className="flex items-center gap-2">
        <InspectorNote className="min-w-0 flex-1">Skills and MCP servers chosen here are added to the agent&apos;s own.</InspectorNote>
        <Button
          variant="ghost"
          size="sm"
          trailingIcon={showCapabilities ? 'chevron-up' : 'chevron-right'}
          aria-expanded={showCapabilities}
          onClick={() => setShowCapabilities((v) => !v)}
          data-testid={`${testIdPrefix}-customize-capabilities`}
        >
          {showCapabilities ? 'Hide capabilities' : 'Customize capabilities'}
        </Button>
      </div>
      {showCapabilities ? (
        <AgentOverridesEditor
          agent={selectedAgent}
          value={overrides}
          onChange={setOverrides}
          projectId={projectId}
          effectiveGroups={projection?.toolPolicy.groups}
        />
      ) : null}
      {agentRef || overridesKey !== '{}' ? (
        <EffectiveCapabilities
          className="w-full"
          projection={projection}
          isLoading={resolvePreview.isPending && !projection}
          baseCounts={selectedAgent ? { skills: selectedAgent.skillIds.length, mcpServers: selectedAgent.mcpServerIds.length } : undefined}
        />
      ) : null}
    </div>
  );
}
