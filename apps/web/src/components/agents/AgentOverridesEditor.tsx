// ────────────────────────────────────────────────────────────────
// AgentOverridesEditor — the binding-site delta.
//
// A binding site (chat / stage / worker) never REPLACES the agent's
// capabilities: additions UNION with them and removals are recorded
// separately so that "the agent has 5 skills, the stage adds 2" yields 7.
// That is why additions and removals are two distinct lists rather than one
// resolved selection — collapsing them would make it impossible to tell an
// intentional removal from an item the agent simply never had.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { FileText, Server } from 'lucide-react';
import type { Agent, AgentOverrides, AgentToolPolicy } from '@generatorai/shared';
import { CollapsibleSection, Textarea } from '@/components/ui/index.js';
import { CapabilityToggleList } from './CapabilityToggleList.js';
import { ToolPolicyEditor } from './ToolPolicyEditor.js';
import { useAgentCatalog } from './useAgentCatalog.js';

export interface AgentOverridesEditorProps {
  /** The bound agent, when one is selected — supplies the inherited baseline. */
  agent?: Agent | undefined;
  value: AgentOverrides;
  onChange: (next: AgentOverrides) => void;
  projectId?: string;
  effectiveGroups?: AgentToolPolicy;
  disabled?: boolean;
}

export function AgentOverridesEditor({
  agent,
  value,
  onChange,
  projectId,
  effectiveGroups,
  disabled = false,
}: AgentOverridesEditorProps) {
  const { skills, mcpServers, isLoading } = useAgentCatalog(projectId);

  const patch = (delta: Partial<AgentOverrides>) => onChange({ ...value, ...delta });

  const inheritedSkills = agent?.skillIds ?? [];
  const inheritedMcp = agent?.mcpServerIds ?? [];

  return (
    <div className="space-y-3" data-testid="agent-overrides-editor">
      <CollapsibleSection title="Skills" icon={<FileText className="h-3.5 w-3.5" />}>
        {isLoading ? (
          <p className="py-2 text-xs text-muted-foreground">Loading catalog…</p>
        ) : (
          <CapabilityToggleList
            entries={skills}
            selectedIds={value.addSkillIds ?? []}
            onChange={(ids) => patch({ addSkillIds: ids.length ? ids : undefined })}
            inheritedIds={inheritedSkills}
            removedIds={value.removeSkillIds ?? []}
            onRemovedChange={(ids) => patch({ removeSkillIds: ids.length ? ids : undefined })}
            icon={FileText}
            emptyHint="No skills in the catalog. Add SKILL.md files under templates/system/artifacts/skills or a project's skills folder."
            disabled={disabled}
            data-testid="override-skills"
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="MCP servers" icon={<Server className="h-3.5 w-3.5" />}>
        {isLoading ? (
          <p className="py-2 text-xs text-muted-foreground">Loading catalog…</p>
        ) : (
          <CapabilityToggleList
            entries={mcpServers}
            selectedIds={value.addMcpServerIds ?? []}
            onChange={(ids) => patch({ addMcpServerIds: ids.length ? ids : undefined })}
            inheritedIds={inheritedMcp}
            removedIds={value.removeMcpServerIds ?? []}
            onRemovedChange={(ids) => patch({ removeMcpServerIds: ids.length ? ids : undefined })}
            icon={Server}
            emptyHint="No MCP servers registered. Add entries to templates/system/mcp-servers.json or the project's MCP registry."
            disabled={disabled}
            data-testid="override-mcp"
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Capabilities">
        <ToolPolicyEditor
          value={value.tools ?? {}}
          onChange={(tools) => patch({ tools: Object.keys(tools).length ? tools : undefined })}
          {...(effectiveGroups ? { effective: effectiveGroups } : {})}
          disabled={disabled}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Extra instructions">
        <Textarea
          value={value.appendInstructions ?? ''}
          onChange={(e) =>
            patch({ appendInstructions: e.target.value.trim() ? e.target.value : undefined })
          }
          rows={4}
          disabled={disabled}
          placeholder="Appended after the agent's own instructions for this binding only."
          data-testid="override-append-instructions"
        />
      </CollapsibleSection>
    </div>
  );
}
