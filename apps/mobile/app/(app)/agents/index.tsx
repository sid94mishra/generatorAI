// Agents — the legacy catalogue scene (split out of the old Projects · Agents scene when Projects moved to the kit in
// M7-02); M7-03 replaces it with features/agents.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { Bot } from 'lucide-react-native';
import type { AgentSummary } from '@generatorai/client-core';

import { useAgents } from '../../../src/features/agents/queries';
import { AgentCard, agentScopeLabel } from '../../../src/components/work/cards';
import { AgentDetailSheet } from '../../../src/components/work/AgentDetailSheet';
import { ListSectionHeader } from '../../../src/components/ui/ListItem';
import { SearchField } from '../../../src/components/ui/Form';
import { EmptyState, ErrorState } from '../../../src/components/ui/States';
import { SkeletonList } from '../../../src/components/ui/Skeleton';
import { Screen } from '../../../src/components/ui/Screen';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { openSearch } from '../../../src/blocks/shell/navigation';

type Row = { kind: 'header'; key: string; label: string } | { kind: 'agent'; item: AgentSummary };
const SCOPE_ORDER: AgentSummary['scope'][] = ['project', 'global', 'system'];

export default function AgentsScreen(): React.ReactElement {
  const { legacyColors: colors } = useTheme();
  const [query, setQuery] = useState('');
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const agents = useAgents();
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const found = (agents.data ?? []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q));
    const out: Row[] = [];
    for (const scope of SCOPE_ORDER) {
      const inScope = found.filter((a) => a.scope === scope);
      if (inScope.length === 0) continue;
      out.push({ kind: 'header', key: `scope:${scope}`, label: agentScopeLabel(scope) });
      for (const item of inScope) out.push({ kind: 'agent', item });
    }
    return out;
  }, [query, agents.data]);
  const empty = agents.isLoading ? (
    <SkeletonList rows={4} variant="flat" />
  ) : agents.isError ? (
    <ErrorState message="Could not load agents." onRetry={() => void agents.refetch()} />
  ) : (
    <EmptyState title="No agents yet" message="Agents you define on desktop or web show up here." icon={<Bot size={22} color={colors['muted-foreground']} />} />
  );
  return (
    <View className="flex-1 bg-background">
      <Screen title="Agents" actions={[{ id: 'search', icon: 'search', label: 'Search', onPress: () => openSearch(), testID: 'header-search' }]} scroll={false}>
        <LegendList
          data={rows}
          keyExtractor={(row: Row) => (row.kind === 'header' ? row.key : row.item.id)}
          estimatedItemSize={64}
          ListHeaderComponent={
            <View className="px-4 pb-1">
              <SearchField value={query} onChangeText={setQuery} placeholder="Search agents" />
            </View>
          }
          ListEmptyComponent={empty}
          renderItem={({ item: row }: { item: Row }) => (row.kind === 'header' ? <ListSectionHeader label={row.label} /> : <AgentCard agent={row.item} showScope={false} onPress={() => setAgent(row.item)} />)}
        />
      </Screen>
      <AgentDetailSheet agent={agent} onClose={() => setAgent(null)} />
    </View>
  );
}
