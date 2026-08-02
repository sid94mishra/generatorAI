// ────────────────────────────────────────────────────────────────
// Settings › Capabilities.
//
// Skills, prompts, agents and MCP servers — what the agent can reach for.
// Read-only: enabling or disabling one changes the behaviour of every client
// against this machine, which is not a decision to make from a lock screen.
// Reading what a skill actually does, though, is exactly the sort of thing
// you want to check while away.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Server, Sparkles } from 'lucide-react-native';
import type { SystemArtifact } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { Markdown } from '../../src/components/markdown/Markdown';
import { Badge, SectionHeader } from '../../src/components/ui/primitives';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Sheet } from '../../src/components/ui/Sheet';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { useTheme } from '../../src/theme/ThemeProvider';

type Tab = 'skill' | 'agent' | 'prompt' | 'mcp';

const ICON = {
  skill: Sparkles,
  agent: Boxes,
  prompt: Sparkles,
  mcp: Server,
} as const;

export default function CapabilitiesScreen(): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const [tab, setTab] = useState<Tab>('skill');
  const [preview, setPreview] = useState<SystemArtifact | null>(null);

  const artifacts = useQuery({
    queryKey: ['system', 'artifacts'],
    queryFn: () => api.system.artifacts(),
    staleTime: 5 * 60_000,
  });

  const mcp = useQuery({
    queryKey: ['system', 'mcp-servers'],
    queryFn: () => api.system.mcpServers(),
    staleTime: 5 * 60_000,
  });

  const content = useQuery({
    queryKey: ['system', 'artifacts', preview?.id ?? ''],
    queryFn: () => api.system.artifactContent(preview!.id),
    enabled: Boolean(preview?.id),
  });

  const byType = (type: Tab): SystemArtifact[] =>
    (artifacts.data ?? []).filter((a) => a.type === type);

  const Icon = ICON[tab];

  return (
    <Screen
      title="Capabilities"
      back
      onRefresh={() => {
        void artifacts.refetch();
        void mcp.refetch();
      }}
      refreshing={artifacts.isFetching || mcp.isFetching}
    >
      <SegmentedControl
        segments={[
          { value: 'skill', label: 'Skills', count: byType('skill').length },
          { value: 'agent', label: 'Agents', count: byType('agent').length },
          { value: 'prompt', label: 'Prompts', count: byType('prompt').length },
          { value: 'mcp', label: 'MCP', count: mcp.data?.length ?? 0 },
        ]}
        value={tab}
        onChange={setTab}
      />

      {artifacts.isLoading || mcp.isLoading ? (
        <SkeletonList rows={5} />
      ) : artifacts.isError ? (
        <ErrorState message="Could not load capabilities." onRetry={() => void artifacts.refetch()} />
      ) : tab === 'mcp' ? (
        (mcp.data ?? []).length === 0 ? (
          <EmptyState
            title="No MCP servers"
            message="Model Context Protocol servers extend the agent with external tools. Add them on the desktop app."
            icon={<Server size={22} color={colors['muted-foreground']} />}
          />
        ) : (
          <ListGroup>
            {(mcp.data ?? []).map((server, i) => (
              <ListRow
                key={server.id ?? `${server.name}-${i}`}
                title={server.name}
                subtitle={server.description ?? server.command ?? server.url ?? null}
                icon={<Server size={18} color={colors['muted-foreground']} />}
                chevron={false}
              />
            ))}
          </ListGroup>
        )
      ) : byType(tab).length === 0 ? (
        <EmptyState title={`No ${tab}s installed`} />
      ) : (
        <ListGroup>
          {byType(tab).map((artifact) => (
            <ListRow
              key={artifact.id}
              title={artifact.name}
              subtitle={artifact.description ?? null}
              icon={<Icon size={18} color={colors.primary} />}
              onPress={() => setPreview(artifact)}
            />
          ))}
        </ListGroup>
      )}

      <SectionHeader title="Changing these" />
      <Text className="px-1 text-xs leading-relaxed text-muted-foreground">
        Enabling or disabling a capability changes how the agent behaves for every client connected
        to this machine, so it is done on the desktop or web app. This device can read what each one
        does.
      </Text>

      <Sheet
        visible={preview !== null}
        onClose={() => setPreview(null)}
        title={preview?.name ?? ''}
        detents={[0.6, 0.92]}
      >
        <View className="gap-3 px-4 py-3">
          <View className="flex-row items-center gap-2">
            <Badge label={preview?.type ?? ''} tone="primary" />
            {(preview?.tags ?? []).map((tag) => (
              <Badge key={tag} label={tag} tone="neutral" />
            ))}
          </View>
          {content.isLoading ? (
            <LoadingState />
          ) : content.isError ? (
            <ErrorState message="Could not read this file." onRetry={() => void content.refetch()} />
          ) : (
            <Markdown content={content.data?.content ?? preview?.description ?? ''} />
          )}
        </View>
      </Sheet>
    </Screen>
  );
}
