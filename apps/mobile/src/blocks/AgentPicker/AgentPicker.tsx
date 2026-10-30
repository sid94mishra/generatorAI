// MB-04 AgentPicker (MAgentPicker): a page inside the New chat sheet (MD-62) — search, the scope filter with counts,
// Orchestrators / Workers, rows with the scope badge, description and "2 skills · 1 MCP", single choice (MD-49);
// "Customize capabilities" opens the next page. No "No agent" row and no "Manage" (MDF-53).
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { AgentSummary } from '@generatorai/client-core';

import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { cn } from '../../ui/lib/cn';
import { Badge } from '../../ui/primitives/Badge';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { Icon } from '../../ui/primitives/Icon';
import { Pressable } from '../../ui/primitives/Pressable';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { Text } from '../../ui/primitives/Text';
import { SCOPE_LABEL, agentFacts, agentSections, scopeCounts, type AgentScopeFilter } from './agentPickerModel';

export { agentFacts, agentSections, scopeCounts, type AgentScopeFilter } from './agentPickerModel';

export interface AgentPickerProps {
  agents: readonly AgentSummary[];
  value: string | null;
  onValueChange: (ref: string) => void;
  /** Only this role (the New chat "Who works on this" choice). */
  role?: 'agent' | 'orchestrator';
  onCustomize?: () => void;
}

function AgentRow({ agent, selected, onPress }: { agent: AgentSummary; selected: boolean; onPress: () => void }): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      frame="none"
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${agent.name}, ${SCOPE_LABEL[agent.scope === 'system' ? 'system' : agent.scope]}, ${agent.description}, ${agentFacts(agent)}`}
      testID={`agent-row-${agent.slug}`}
      className={cn('min-h-row-2 flex-row items-start gap-3 rounded-card px-3.5 py-2.5', selected && 'bg-selected')}
    >
      <View className="pt-0.5">
        <Icon concept="agents" size={20} tone="fg-2" />
      </View>
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text role="body" weight={600} numberOfLines={1} className="shrink">
            {agent.name}
          </Text>
          <Badge label={SCOPE_LABEL[agent.scope === 'system' ? 'system' : agent.scope]} tone="outline" size="sm" />
        </View>
        <Text role="footnote" tone="fg-2" numberOfLines={2}>
          {agent.description}
        </Text>
        <Text role="monoSm" tone="fg-3">
          {agentFacts(agent)}
        </Text>
      </View>
      {selected ? <Icon concept="check" size={18} tone="fg" /> : null}
    </Pressable>
  );
}

export function AgentPicker({ agents, value, onValueChange, role, onCustomize }: AgentPickerProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<AgentScopeFilter>('all');
  const pool = useMemo(() => agents.filter((a) => a.enabled && (!role || a.role === role)), [agents, role]);
  const counts = useMemo(() => scopeCounts(pool), [pool]);
  const sections = useMemo(() => agentSections(pool, { scope, query, ...(role ? { role } : {}) }), [pool, scope, query, role]);
  return (
    <View className="gap-3">
      <SearchInput value={query} onChangeText={setQuery} placeholder="Search agents" size="compact" testID="agent-search" />
      <SegmentedControl<AgentScopeFilter>
        accessibilityLabel="Agent scope"
        value={scope}
        onValueChange={setScope}
        segments={(['all', 'global', 'project', 'system'] as const).map((s) => ({ value: s, label: SCOPE_LABEL[s], count: counts[s] }))}
        fullWidth
        testID="agent-scope"
      />
      {sections.length === 0 ? (
        <EmptyState compact copyKey={query ? 'searchResults' : 'agents'} />
      ) : (
        sections.map((section) => (
          <View key={section.title} className="gap-1">
            <Text role="footnote" weight={600} tone="fg-3" className="px-1">
              {section.title}
            </Text>
            {section.agents.map((agent) => (
              <AgentRow key={agent.ref} agent={agent} selected={agent.ref === value} onPress={() => onValueChange(agent.ref)} />
            ))}
          </View>
        ))
      )}
      {onCustomize && value ? (
        <ListSection>
          <ListRow kind="navigation" icon="settings" title="Customize capabilities" onPress={onCustomize} testID="agent-customize" />
        </ListSection>
      ) : null}
    </View>
  );
}
