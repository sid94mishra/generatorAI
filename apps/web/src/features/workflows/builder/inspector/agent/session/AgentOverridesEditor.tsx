// ────────────────────────────────────────────────────────────────
// The binding-site delta over a bound agent ("Customize capabilities").
// A binding site never REPLACES the agent's capabilities: additions UNION
// with them and removals are recorded separately, so "the agent has 5
// skills, the stage adds 2" yields 7 — which is why additions and removals
// are two lists rather than one resolved selection. Capability groups are
// tri-state (force on / force off / inherit).
// ────────────────────────────────────────────────────────────────

import type { Agent, AgentOverrides, AgentToolPolicy } from '@generatorai/shared';
import type { CatalogEntry } from '@/hooks/agentQueries.js';
import { useAgentCatalog } from '@/hooks/agentQueries.js';
import { TOOL_GROUP_LABELS } from '@/lib/agentCopy.js';
import { ToolPolicyTriState } from '@/blocks/capabilities/CapabilityToggleList.js';
import { Collapsible } from '@/ui/primitives/Collapsible/Collapsible.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { CatalogChecklist } from './CatalogChecklist.js';

export interface AgentOverridesEditorProps {
  /** The bound agent, when one is selected: the inherited baseline. */
  agent?: Agent | undefined;
  value: AgentOverrides;
  onChange: (next: AgentOverrides) => void;
  projectId?: string | undefined;
  effectiveGroups?: AgentToolPolicy | undefined;
  disabled?: boolean;
}

interface DeltaListProps {
  noun: string;
  icon: 'skills' | 'mcp';
  entries: CatalogEntry[];
  added: string[];
  removed: string[];
  inherited: string[];
  onChange: (added: string[], removed: string[]) => void;
  loading: boolean;
  emptyText: string;
  disabled: boolean;
  testId: string;
}

/** Additions and removals over the agent's own entries: unchecking an agent entry records a removal. */
function DeltaList({ noun, icon, entries, added, removed, inherited, onChange, loading, emptyText, disabled, testId }: DeltaListProps) {
  const addedSet = new Set(added);
  const removedSet = new Set(removed);
  const inheritedSet = new Set(inherited);
  const toggle = (id: string, on: boolean) => {
    if (inheritedSet.has(id)) {
      onChange(added, on ? removed.filter((r) => r !== id) : [...removed, id]);
      return;
    }
    onChange(on ? [...added, id] : added.filter((a) => a !== id), removed);
  };
  return (
    <CatalogChecklist
      noun={noun}
      icon={icon}
      entries={entries}
      isOn={(id) => (addedSet.has(id) || inheritedSet.has(id)) && !removedSet.has(id)}
      fromAgent={inheritedSet}
      onToggle={toggle}
      loading={loading}
      emptyText={emptyText}
      disabled={disabled}
      rowTestId={(id) => `capability-${id}`}
      data-testid={testId}
    />
  );
}

const orUndefined = <T,>(list: T[]): T[] | undefined => (list.length > 0 ? list : undefined);

/** Skills · MCP servers · Capabilities · Extra instructions over the bound agent. */
export function AgentOverridesEditor({ agent, value, onChange, projectId, effectiveGroups, disabled = false }: AgentOverridesEditorProps) {
  const { skills, mcpServers, isLoading } = useAgentCatalog(projectId);
  const patch = (delta: Partial<AgentOverrides>) => {
    const next: Record<string, unknown> = { ...value, ...delta };
    for (const [k, v] of Object.entries(delta)) if (v === undefined) delete next[k];
    onChange(next as AgentOverrides);
  };

  return (
    <div className="flex flex-col gap-2 rounded-card border border-line-soft p-2.5" data-testid="agent-overrides-editor">
      <Collapsible trigger="Skills" icon="skills" defaultOpen>
        <DeltaList
          noun="skills"
          icon="skills"
          entries={skills}
          added={value.addSkillIds ?? []}
          removed={value.removeSkillIds ?? []}
          inherited={agent?.skillIds ?? []}
          onChange={(added, removed) => patch({ addSkillIds: orUndefined(added), removeSkillIds: orUndefined(removed) })}
          loading={isLoading}
          emptyText="No skills in the catalog. Add SKILL.md files under templates/system/artifacts/skills or a project's skills folder."
          disabled={disabled}
          testId="override-skills"
        />
      </Collapsible>
      <Collapsible trigger="MCP servers" icon="mcp">
        <DeltaList
          noun="MCP servers"
          icon="mcp"
          entries={mcpServers}
          added={value.addMcpServerIds ?? []}
          removed={value.removeMcpServerIds ?? []}
          inherited={agent?.mcpServerIds ?? []}
          onChange={(added, removed) => patch({ addMcpServerIds: orUndefined(added), removeMcpServerIds: orUndefined(removed) })}
          loading={isLoading}
          emptyText="No MCP servers registered. Add entries to templates/system/mcp-servers.json or the project's MCP registry."
          disabled={disabled}
          testId="override-mcp"
        />
      </Collapsible>
      <Collapsible trigger="Capabilities" icon="tool">
        <ToolPolicyTriState
          value={value.tools ?? {}}
          onChange={(tools) => patch({ tools: Object.keys(tools).length > 0 ? tools : undefined })}
          effective={effectiveGroups}
          labels={TOOL_GROUP_LABELS}
          disabled={disabled}
          data-testid="tool-policy-editor"
        />
      </Collapsible>
      <Collapsible trigger="Extra instructions" icon="file-text">
        <Textarea
          value={value.appendInstructions ?? ''}
          onChange={(e) => patch({ appendInstructions: e.target.value.trim() ? e.target.value : undefined })}
          rows={4}
          disabled={disabled}
          aria-label="Extra instructions"
          placeholder="Appended after the agent's own instructions for this binding only."
          data-testid="override-append-instructions"
        />
      </Collapsible>
    </div>
  );
}
