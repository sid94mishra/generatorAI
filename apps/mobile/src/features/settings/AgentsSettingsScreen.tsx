// Settings › Agents (MSetAgents, MDF-106; `/settings/agents`): what agents are, a search, "n of m enabled", one row
// per agent (name, scope and role badges, "Disabled", the description) opening its detail in the Agents module,
// "Manage agents ↗" (→ `/agents`, where the menus, sort and filters live) and NewAction "New agent" (→ the same
// New agent sheet) when the device may author agents (`admin:settings`).
import React, { useDeferredValue, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { AgentSummary } from '@generatorai/client-core';

import { AGENTS_HREF, agentHref } from '../../blocks/shell/hrefs';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { EntityRow } from '../../ui/layout/EntityRow';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { NewAction } from '../../ui/layout/NewAction';
import { Badge } from '../../ui/primitives/Badge';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { SettingsPage } from './components/SettingsPage';
import { useAgentSummaries } from './queries';

type Href = Parameters<typeof router.push>[0];

const SCOPE = { system: 'Built-in', global: 'Global', project: 'Project' } as const;

function positionOf(i: number, n: number): 'first' | 'middle' | 'last' | 'only' {
  if (n === 1) return 'only';
  return i === 0 ? 'first' : i === n - 1 ? 'last' : 'middle';
}

function AgentSettingsRow({ agent, position }: { agent: AgentSummary; position: 'first' | 'middle' | 'last' | 'only' }): React.ReactElement {
  return (
    <EntityRow
      title={agent.name}
      leading={{ icon: 'agents' }}
      {...(agent.description ? { description: agent.description } : {})}
      meta={[
        <Badge key="s" label={SCOPE[agent.scope]} size="sm" />,
        ...(agent.role === 'orchestrator' ? [<Badge key="r" label="Orchestrator" icon="users" size="sm" />] : []),
        ...(agent.enabled ? [] : [<Badge key="d" label="Disabled" size="sm" />]),
      ]}
      metaLabel={[SCOPE[agent.scope], agent.role === 'orchestrator' ? 'orchestrator' : '', agent.enabled ? '' : 'disabled'].filter(Boolean).join(', ')}
      archived={!agent.enabled}
      onPress={() => router.push(agentHref(agent.id) as Href)}
      position={position}
      testID={`settings-agent-${agent.slug}`}
    />
  );
}

export default function AgentsSettingsScreen(): React.ReactElement {
  const agents = useAgentSummaries();
  const canEdit = checkFeature('capabilityAdmin', useGrantedScopes()).available;
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search).trim().toLowerCase();
  const list = useMemo(() => (agents.data ?? []).filter((a) => !query || `${a.name} ${a.description} ${a.slug}`.toLowerCase().includes(query)), [agents.data, query]);
  const all = agents.data ?? [];

  return (
    <SettingsPage
      title="Agents"
      intro="Reusable agents bundle instructions with a fixed set of skills, MCP servers and capabilities. Bind one to a chat, a workflow stage or an orchestrator's team."
      onRefresh={async () => void (await agents.refetch())}
      bottomAccessory={canEdit ? <NewAction label="New agent" icon="plus" onPress={() => router.push('/agents/new' as Href)} testID="settings-agents-new" /> : undefined}
      state={agents.isError && !agents.data ? { kind: 'error', error: agents.error, onRetry: () => void agents.refetch(), title: "Couldn't load agents" } : { kind: 'ready' }}
      testID="settings-agents-screen"
    >
      <View className="px-4">
        <SearchInput value={search} onChangeText={setSearch} placeholder="Search agents" testID="settings-agents-search" />
      </View>
      {agents.isLoading ? (
        <Skeleton preset="list" count={4} />
      ) : list.length === 0 ? (
        query ? <EmptyState compact icon="search" title="No matching agents" /> : <EmptyState compact copyKey="agents" />
      ) : (
        <ListSection title={`${all.filter((a) => a.enabled).length} of ${all.length} enabled`}>
          {list.map((a, i) => (
            <AgentSettingsRow key={a.id} agent={a} position={positionOf(i, list.length)} />
          ))}
        </ListSection>
      )}
      <ListSection>
        <ListRow kind="navigation" icon="external-link" title="Manage agents" subtitle="Edit instructions, capabilities and teams in Agents" onPress={() => router.push(AGENTS_HREF as Href)} testID="settings-agents-manage" />
      </ListSection>
    </SettingsPage>
  );
}
