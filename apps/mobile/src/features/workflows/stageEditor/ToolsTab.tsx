// Tools tab (MStageTools): the skills and MCP servers the stage adds over its agent — the agent's own are on and
// locked ("From agent"; removing one is a desktop edit) — and the platform tools: Browser, Computer use (refused
// on Bypass runs), Widgets, Workflows (run other workflows; off by default).
import React, { useState } from 'react';
import { View } from 'react-native';
import type { AgentOverrides } from '@generatorai/workflow-spec';

import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { Badge } from '../../../ui/primitives/Badge';
import { Checkbox } from '../../../ui/primitives/Checkbox';
import { SearchInput } from '../../../ui/primitives/SearchInput';
import { Skeleton } from '../../../ui/primitives/Skeleton';
import { Text } from '../../../ui/primitives/Text';
import { useCapabilityCatalog, useSelectableAgents } from '../queries';
import type { TabProps } from './fields';
import { capabilityRows, platformTools, setPlatformTool, toggleAdded, type AgentCapabilities, type CapabilityRow, type PlatformTool } from './stageEditorModel';

const SHOWN = 6;

const PLATFORM: { id: PlatformTool; title: string; subtitle: string; icon: 'browser' | 'computer' | 'widgets' | 'workflows' }[] = [
  { id: 'browser', title: 'Browser', subtitle: 'Open and read web pages', icon: 'browser' },
  { id: 'computerUse', title: 'Computer use', subtitle: 'Drive a desktop session · blocked when the run uses Bypass', icon: 'computer' },
  { id: 'widgets', title: 'Widgets', subtitle: 'Show interactive results', icon: 'widgets' },
  { id: 'workflows', title: 'Workflows', subtitle: 'Run other workflows · off by default', icon: 'workflows' },
];

export function useAgentCapabilities(agentRef: string | undefined, projectId: string | null): AgentCapabilities | null {
  const agents = useSelectableAgents(projectId);
  const a = (agents.data ?? []).find((x) => (x as { ref?: string }).ref === agentRef) as unknown as { skillIds?: string[]; mcpServerIds?: string[]; tools?: Record<string, boolean> } | undefined;
  return a ? { skillIds: a.skillIds ?? [], mcpServerIds: a.mcpServerIds ?? [], tools: a.tools ?? {} } : null;
}

function CapabilityList({ title, rows, query, onToggle, testID }: { title: string; rows: CapabilityRow[]; query: string; onToggle: (id: string, on: boolean) => void; testID: string }): React.ReactElement {
  const [all, setAll] = useState(false);
  const filtered = rows.filter((r) => !query || r.name.toLowerCase().includes(query.toLowerCase()));
  const shown = all || query ? filtered : filtered.slice(0, SHOWN);
  const on = rows.filter((r) => r.on).length;
  return (
    <ListSection title={`${title} · ${on} of ${rows.length} on`} action={!all && !query && filtered.length > SHOWN ? { label: `Show all ${filtered.length}`, onPress: () => setAll(true) } : undefined} testID={testID}>
      {shown.length === 0 ? <ListRow kind="info" title={query ? 'No matches' : `No ${title.toLowerCase()} available`} /> : null}
      {shown.map((r) => (
        <View key={r.id} className="min-h-row flex-row items-center gap-3 px-4 py-2">
          <Checkbox checked={r.on} onValueChange={(v) => onToggle(r.id, v)} disabled={r.fromAgent} accessibilityLabel={r.name} testID={`${testID}-${r.id}`} />
          <Text role="mono" numberOfLines={1} className="shrink">
            {r.name}
          </Text>
          <View className="flex-1" />
          {r.fromAgent ? <Badge label="From agent" icon="lock" tone="outline" size="sm" /> : null}
        </View>
      ))}
    </ListSection>
  );
}

export function ToolsTab({ stage, set, graph }: TabProps): React.ReactElement {
  const catalog = useCapabilityCatalog();
  const agent = useAgentCapabilities(stage.session?.agentRef ?? graph.workflow.session.agentRef, graph.workflow.projectId ?? null);
  const [query, setQuery] = useState('');
  const o = stage.session?.agentOverrides;
  const setOverrides = (patch: Partial<AgentOverrides>): void => {
    const next = { ...(o ?? {}), ...patch };
    for (const k of Object.keys(next) as (keyof AgentOverrides)[]) if (next[k] === undefined) delete next[k];
    const session = { ...(stage.session ?? {}), agentOverrides: Object.keys(next).length ? next : undefined };
    if (!session.agentOverrides) delete session.agentOverrides;
    set({ ...stage, session });
  };
  const skills = capabilityRows(catalog.skills, agent?.skillIds ?? [], o?.addSkillIds, o?.removeSkillIds);
  const mcp = capabilityRows(catalog.mcp, agent?.mcpServerIds ?? [], o?.addMcpServerIds, o?.removeMcpServerIds);
  const tools = platformTools(stage, agent);
  return (
    <View className="gap-6">
      <SearchInput value={query} onChangeText={setQuery} placeholder="Search skills and MCP servers" size="compact" />
      {catalog.loading ? <Skeleton preset="list" count={4} /> : null}
      <CapabilityList title="Skills" rows={skills} query={query} onToggle={(id, on) => setOverrides({ addSkillIds: toggleAdded(o?.addSkillIds, id, on) })} testID="stage-skill" />
      <CapabilityList title="MCP servers" rows={mcp} query={query} onToggle={(id, on) => setOverrides({ addMcpServerIds: toggleAdded(o?.addMcpServerIds, id, on) })} testID="stage-mcp" />
      <ListSection title="Platform tools">
        {PLATFORM.map((t) => (
          <ListRow key={t.id} kind="toggle" title={t.title} subtitle={t.subtitle} icon={t.icon} switchValue={tools[t.id]} onValueChange={(v) => set(setPlatformTool(stage, t.id, v))} testID={`stage-tool-${t.id}`} />
        ))}
      </ListSection>
    </View>
  );
}
