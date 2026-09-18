// ────────────────────────────────────────────────────────────────
// Settings › Capabilities.
//
// Skills, prompts, agents and MCP servers — what the agent can reach for.
//
// Reading what each one does is open to every device. Turning an MCP server
// on or off changes the behaviour of every client against this machine, so
// the switches appear only when the device holds `admin:settings`
// (`capabilityAdmin`); otherwise the list is read-only and says how to get
// access. Bundled servers flip through `PUT /system/mcp-servers/system/:id`,
// custom ones through the full-replacement `PUT …/custom/:id`
// (`globalMcpToggle`). Built-in skills have no server-side switch — web's
// skill toggle is a per-browser picker preference — so they stay read-only.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Server, Sparkles } from 'lucide-react-native';
import type { SystemArtifact } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { GRANT_FROM_TRUSTED_DEVICE, canRequestFeature } from '../../src/auth/featureGate';
import { messageOf } from '../../src/components/projects/ProjectActions';
import {
  globalMcpToggle,
  mcpNeedsConfiguration,
  mcpSubtitle,
  mcpSwitchValue,
  type McpEntryLike,
} from '../../src/components/projects/projectEditModel';
import { useProjectsApi } from '../../src/components/projects/useProjectsApi';
import { useFeature } from '../../src/components/runs/useFeature';
import { Button } from '../../src/components/ui/Button';
import { useToast } from '../../src/components/ui/Toast';
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
  const projectsApi = useProjectsApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const admin = useFeature('capabilityAdmin');
  const requestable = canRequestFeature('capabilityAdmin', admin.scopes);

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

  const toggleMcp = useMutation({
    mutationFn: async (vars: { server: McpEntryLike; enabled: boolean }) => {
      const call = globalMcpToggle(vars.server, vars.enabled);
      if (!call) throw new Error('This server cannot be switched from here.');
      await projectsApi.putJson(call.path, call.body);
    },
    onMutate: async ({ server, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['system', 'mcp-servers'] });
      const before = queryClient.getQueryData<McpEntryLike[]>(['system', 'mcp-servers']);
      queryClient.setQueryData<McpEntryLike[]>(['system', 'mcp-servers'], (list) =>
        list?.map((s) => (s.id === server.id ? { ...s, userEnabled: enabled } : s)),
      );
      return { before };
    },
    onError: (err, _vars, context) => {
      if (context?.before) queryClient.setQueryData(['system', 'mcp-servers'], context.before);
      toast({ message: messageOf(err, 'Could not change the server.'), variant: 'danger' });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['system', 'mcp-servers'] }),
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
            {((mcp.data ?? []) as McpEntryLike[]).map((server, i) => {
              const on = mcpSwitchValue(server);
              const switchable = admin.available && globalMcpToggle(server, !on) !== null;
              const setup = mcpNeedsConfiguration(server);
              return (
                <ListRow
                  key={server.id ?? `${server.name}-${i}`}
                  title={server.name}
                  subtitle={mcpSubtitle(server)}
                  icon={<Server size={18} color={colors['muted-foreground']} />}
                  chevron={false}
                  {...(switchable
                    ? {
                        toggle: {
                          value: on,
                          onValueChange: (enabled: boolean) => toggleMcp.mutate({ server, enabled }),
                        },
                      }
                    : {})}
                  {...(setup
                    ? { trailing: <Badge label="Needs setup" tone="warning" /> }
                    : !switchable && !on
                      ? { trailing: <Badge label="Off" /> }
                      : {})}
                  {...(setup && switchable ? { accessibilityHint: 'Finish its setup on the desktop or web app' } : {})}
                />
              );
            })}
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
      {admin.available ? (
        <Text className="text-sm leading-relaxed text-muted-foreground">
          Switching an MCP server changes how the agent behaves for every client connected to this
          machine. Adding servers, filling in their credentials and installing skills is done on the
          desktop or web app.
        </Text>
      ) : (
        <View className="gap-2">
          <Text className="text-sm leading-relaxed text-muted-foreground">
            {admin.reason} {requestable ? '' : GRANT_FROM_TRUSTED_DEVICE}
          </Text>
          {requestable ? (
            <View className="self-start">
              <Button label="Request access" variant="secondary" size="sm" haptic="tap" onPress={admin.requestAccess} />
            </View>
          ) : null}
        </View>
      )}

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
