// ────────────────────────────────────────────────────────────────
// The session's tools (WorkflowStageTools board): Skills and MCP servers
// (search, checkboxes, "From agent" badges, Select all) and the platform
// toggles (browser; for a workflow or stage also computer use and widgets).
//
//   Skills       explicit additions (`agentOverrides.addSkillIds`); the bound
//                agent's own skills show checked and locked.
//   MCP servers  every listed server is on unless turned off
//                (`mcp.excludedIds`, keyed by id: two registries may each
//                define a server called "github").
// ────────────────────────────────────────────────────────────────

import type { IconConcept } from '@generatorai/design-tokens';
import type { SessionSpec } from '@generatorai/workflow-spec';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { InspectorSection } from '../../../fields/InspectorLayout.js';
import { CatalogChecklist } from './CatalogChecklist.js';
import {
  addedSkillIds,
  excludedMcpIds,
  mcpPatch,
  platformToggles,
  skillsPatch,
  type SessionCatalog,
  type SessionScope,
} from './sessionModel.js';

interface ToolSectionProps {
  session: SessionSpec | undefined;
  onChange: (updates: Partial<SessionSpec>) => void;
  catalog: SessionCatalog;
  /** Skill / MCP server ids of the bound agent. */
  agentSkillIds?: readonly string[];
  agentMcpIds?: readonly string[];
}

function toggleAll(allOn: boolean, onAll: () => void, onNone: () => void) {
  return (
    <Button variant="ghost" size="sm" onClick={allOn ? onNone : onAll}>
      {allOn ? 'Deselect all' : 'Select all'}
    </Button>
  );
}

/** Skills added to the session. */
export function SkillsSection({ session, onChange, catalog, agentSkillIds = [] }: ToolSectionProps) {
  const added = new Set(addedSkillIds(session));
  const removed = new Set(session?.agentOverrides?.removeSkillIds ?? []);
  const inherited = new Set(agentSkillIds.filter((id) => !removed.has(id)));
  const entries = catalog.skills;
  const selectable = entries.filter((s) => !inherited.has(s.id));
  const onCount = entries.filter((s) => added.has(s.id) || inherited.has(s.id)).length;
  const allOn = selectable.length > 0 && selectable.every((s) => added.has(s.id));
  const update = (next: Set<string>) => onChange(skillsPatch(session, next, entries));

  return (
    <InspectorSection
      title="Skills"
      count={entries.length > 0 ? `${onCount} of ${entries.length} on` : undefined}
      action={selectable.length > 0 ? toggleAll(allOn, () => update(new Set(selectable.map((s) => s.id))), () => update(new Set())) : undefined}
      data-testid="session-skills"
    >
      <CatalogChecklist
        noun="skills"
        icon="skills"
        entries={entries}
        isOn={(id) => added.has(id)}
        inherited={inherited}
        onToggle={(id, on) => {
          const next = new Set(added);
          if (on) next.add(id);
          else next.delete(id);
          update(next);
        }}
        loading={catalog.isLoading}
        emptyText="No skills available."
      />
    </InspectorSection>
  );
}

/** MCP servers the session may use (all on unless turned off). */
export function McpSection({ session, onChange, catalog, agentMcpIds = [] }: ToolSectionProps) {
  const excluded = new Set(excludedMcpIds(session));
  const entries = catalog.mcpServers;
  const onCount = entries.filter((m) => !excluded.has(m.id)).length;
  return (
    <InspectorSection
      title="MCP servers"
      count={entries.length > 0 ? `${onCount} of ${entries.length} on` : undefined}
      action={
        entries.length > 0
          ? toggleAll(excluded.size === 0, () => onChange(mcpPatch(session, [])), () => onChange(mcpPatch(session, entries.map((m) => m.id))))
          : undefined
      }
      data-testid="session-mcp"
    >
      <CatalogChecklist
        noun="MCP servers"
        icon="mcp"
        entries={entries}
        isOn={(id) => !excluded.has(id)}
        fromAgent={new Set(agentMcpIds)}
        onToggle={(id, on) => {
          const next = new Set(excluded);
          if (on) next.delete(id);
          else next.add(id);
          onChange(mcpPatch(session, [...next]));
        }}
        loading={catalog.isLoading}
        emptyText="No MCP servers configured."
      />
    </InspectorSection>
  );
}

function PlatformRow({
  icon,
  title,
  description,
  warning,
  checked,
  onCheckedChange,
}: {
  icon: IconConcept;
  title: string;
  description: string;
  warning?: string;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon concept={icon} size={16} className="mt-0.5 shrink-0 text-fg-3" />
      <div className="min-w-0 flex-1">
        <p className="text-ui text-fg">{title}</p>
        <p className="text-small text-fg-3">{description}</p>
        {warning ? (
          <p className="flex items-center gap-1 text-small text-warn">
            <Icon concept="warning" size={12} />
            {warning}
          </p>
        ) : null}
      </div>
      <Switch aria-label={title} checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5" />
    </div>
  );
}

/** Browser, computer use and widgets (the last two not for a chat). */
export function PlatformToolsSection({
  session,
  effective,
  onChange,
  scope,
}: {
  session: SessionSpec | undefined;
  effective: SessionSpec;
  onChange: (updates: Partial<SessionSpec>) => void;
  scope: SessionScope;
}) {
  const on = platformToggles(effective, scope);
  const setBrowserEnabled = (enabled: boolean | undefined) => {
    const next = { ...(session?.browser ?? {}) };
    if (enabled === undefined) delete next.enabled;
    else next.enabled = enabled;
    onChange({ browser: Object.keys(next).length > 0 ? next : undefined });
  };
  return (
    <InspectorSection title="Platform tools" data-testid="session-platform">
      <PlatformRow
        icon="browser"
        title="Integrated browser"
        description="Browser tools for this session"
        checked={on.browser}
        onCheckedChange={(v) => setBrowserEnabled(v ? undefined : false)}
      />
      {scope !== 'chat' ? (
        <>
          <PlatformRow
            icon="computer"
            title="Computer use"
            description="Desktop control; opt-in"
            warning="Blocked when the run uses Bypass"
            checked={on.computerUse}
            onCheckedChange={(v) => onChange({ computerUse: v ? true : undefined })}
          />
          <PlatformRow
            icon="widgets"
            title="Widgets"
            description="Interactive widgets in the transcript"
            checked={on.widgets}
            onCheckedChange={(v) => onChange({ widgets: v ? undefined : false })}
          />
        </>
      ) : null}
    </InspectorSection>
  );
}
