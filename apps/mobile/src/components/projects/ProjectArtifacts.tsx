// ────────────────────────────────────────────────────────────────
// Project › Artifacts — the skills, prompts, agents and MCP servers that
// belong to ONE project (built-in ones live in Settings › Capabilities).
//
//   Skills / Prompts / Agents   GET /projects/:id/configs → read the file
//                               (GET …/configs/:cid) or remove it (DELETE).
//                               The server has no per-item on/off for these:
//                               a project artifact is in effect while it
//                               exists, so the phone offers remove, not a
//                               switch that would pretend otherwise.
//   MCP servers                 GET /projects/:id/mcp-servers → on/off via
//                               the full-replacement PUT (`mcpToggleBody`
//                               echoes the redacted credentials) and remove.
//
// Uploading new artifacts is a desktop/web action — it takes a file or a
// skill folder. Writes are gated on `projectEdit`.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, FileText, Server, Sparkles, Trash2 } from 'lucide-react-native';
import type { McpServerEntry, ProjectConfig } from '@generatorai/shared';

import { Markdown } from '../markdown/Markdown';
import { ConfirmSheet } from '../ui/ActionSheet';
import { Button } from '../ui/Button';
import { ListGroup, ListRow } from '../ui/ListRow';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Sheet } from '../ui/Sheet';
import { SkeletonList } from '../ui/Skeleton';
import { ErrorState, LoadingState } from '../ui/States';
import { useToast } from '../ui/Toast';
import { Badge } from '../ui/primitives';
import { useFeature } from '../runs/useFeature';
import { useTheme } from '../../theme/ThemeProvider';
import { projectKeys } from './api';
import { messageOf } from './ProjectActions';
import { useProjectsApi } from './useProjectsApi';
import {
  artifactKindLabel,
  configsOfKind,
  mcpNeedsConfiguration,
  mcpSubtitle,
  mcpSwitchValue,
  mcpToggleBody,
  type ArtifactKind,
} from './projectEditModel';

const ICONS = { skill: Sparkles, prompt: FileText, agent: Boxes, mcp: Server } as const;

export function ProjectArtifacts({ projectId }: { projectId: string }): React.ReactElement {
  const api = useProjectsApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colors } = useTheme();
  const feature = useFeature('projectEdit');
  const [kind, setKind] = useState<ArtifactKind>('skill');
  const [preview, setPreview] = useState<ProjectConfig | null>(null);
  const [removing, setRemoving] = useState<{ kind: 'config' | 'mcp'; id: string; name: string } | null>(null);

  const configs = useQuery({
    queryKey: projectKeys.configs(projectId),
    queryFn: () => api.configs(projectId),
  });
  const mcp = useQuery({
    queryKey: projectKeys.mcpServers(projectId),
    queryFn: () => api.mcpServers(projectId),
  });

  const segments = useMemo(
    () => [
      { value: 'skill' as const, label: 'Skills', count: configsOfKind(configs.data, 'skill').length },
      { value: 'prompt' as const, label: 'Prompts', count: configsOfKind(configs.data, 'prompt').length },
      { value: 'agent' as const, label: 'Agents', count: configsOfKind(configs.data, 'agent').length },
      { value: 'mcp' as const, label: 'MCP', count: mcp.data?.length ?? 0 },
    ],
    [configs.data, mcp.data],
  );

  const toggleMcp = useMutation({
    mutationFn: (vars: { server: McpServerEntry; enabled: boolean }) =>
      api.updateMcpServer(projectId, vars.server.id, mcpToggleBody(vars.server, vars.enabled)),
    onMutate: async ({ server, enabled }) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.mcpServers(projectId) });
      const before = queryClient.getQueryData<McpServerEntry[]>(projectKeys.mcpServers(projectId));
      queryClient.setQueryData<McpServerEntry[]>(projectKeys.mcpServers(projectId), (list) =>
        list?.map((s) => (s.id === server.id ? { ...s, userEnabled: enabled } : s)),
      );
      return { before };
    },
    onError: (err, _vars, context) => {
      if (context?.before) queryClient.setQueryData(projectKeys.mcpServers(projectId), context.before);
      toast({ message: messageOf(err, 'Could not change the server.'), variant: 'danger' });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: projectKeys.mcpServers(projectId) }),
  });

  const remove = useMutation({
    mutationFn: (target: { kind: 'config' | 'mcp'; id: string }) =>
      target.kind === 'mcp' ? api.removeMcpServer(projectId, target.id) : api.removeConfig(projectId, target.id),
    onSuccess: (_data, target) => {
      void queryClient.invalidateQueries({
        queryKey: target.kind === 'mcp' ? projectKeys.mcpServers(projectId) : projectKeys.configs(projectId),
      });
      toast({ message: 'Removed from the project.', variant: 'success' });
    },
    onError: (err) => toast({ message: messageOf(err, 'Could not remove it.'), variant: 'danger' }),
  });

  const active = kind === 'mcp' ? mcp : configs;
  const Icon = ICONS[kind];

  return (
    <View className="gap-3">
      <SegmentedControl segments={segments} value={kind} onChange={setKind} accessibilityLabel="Artifact type" />

      {active.isLoading ? (
        <SkeletonList rows={3} />
      ) : active.isError ? (
        <ErrorState message={`Could not load ${artifactKindLabel(kind)}s.`} onRetry={() => void active.refetch()} />
      ) : kind === 'mcp' ? (
        (mcp.data ?? []).length === 0 ? (
          <MutedLine text="No MCP servers in this project." />
        ) : (
          <ListGroup>
            {(mcp.data ?? []).map((server) => (
              <ListRow
                key={server.id}
                title={server.name}
                subtitle={mcpSubtitle(server)}
                icon={<Server size={18} color={colors['muted-foreground']} />}
                toggle={{
                  value: mcpSwitchValue(server),
                  onValueChange: (enabled) => toggleMcp.mutate({ server, enabled }),
                }}
                disabled={!feature.available}
                accessibilityHint={
                  feature.available ? 'Long-press to remove it from the project' : (feature.reason ?? undefined)
                }
                {...(feature.available
                  ? { onLongPress: () => setRemoving({ kind: 'mcp', id: server.id, name: server.name }) }
                  : {})}
                {...(mcpNeedsConfiguration(server) ? { trailing: <Badge label="Needs setup" tone="warning" /> } : {})}
              />
            ))}
          </ListGroup>
        )
      ) : configsOfKind(configs.data, kind).length === 0 ? (
        <MutedLine text={`No ${artifactKindLabel(kind)}s in this project.`} />
      ) : (
        <ListGroup>
          {configsOfKind(configs.data, kind).map((config) => (
            <ListRow
              key={config.id}
              title={config.name}
              subtitle={config.description || config.filePath}
              icon={<Icon size={18} color={colors['muted-foreground']} />}
              onPress={() => setPreview(config)}
            />
          ))}
        </ListGroup>
      )}

      {!feature.available && feature.grantable ? (
        <View className="flex-row items-center gap-3">
          <Text className="flex-1 text-sm text-muted-foreground">{feature.reason}</Text>
          <Button label="Request access" variant="ghost" size="sm" haptic="tap" onPress={feature.requestAccess} />
        </View>
      ) : null}

      <ListGroup>
        <ListRow
          title="Built-in capabilities"
          subtitle="Available to every project"
          icon={<Sparkles size={18} color={colors['muted-foreground']} />}
          onPress={() => router.push('/settings/capabilities')}
        />
      </ListGroup>
      <Text className="px-1 text-sm leading-relaxed text-muted-foreground">
        Add skills, prompts and agents to a project from the desktop or web app.
      </Text>

      <ConfigPreviewSheet
        projectId={projectId}
        config={preview}
        canRemove={feature.available}
        onClose={() => setPreview(null)}
        onRemove={(config) => {
          setPreview(null);
          setRemoving({ kind: 'config', id: config.id, name: config.name });
        }}
      />

      <ConfirmSheet
        visible={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name ?? 'this'}?`}
        message="It is deleted from the project on your computer. Chats and workflows that use it lose it on their next turn."
        confirmLabel="Remove"
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (target) remove.mutate(target);
        }}
      />
    </View>
  );
}

function ConfigPreviewSheet({
  projectId,
  config,
  canRemove,
  onClose,
  onRemove,
}: {
  projectId: string;
  config: ProjectConfig | null;
  canRemove: boolean;
  onClose: () => void;
  onRemove: (config: ProjectConfig) => void;
}): React.ReactElement {
  const api = useProjectsApi();
  const { colors } = useTheme();
  const content = useQuery({
    queryKey: projectKeys.configContent(projectId, config?.id ?? ''),
    queryFn: () => api.configContent(projectId, config!.id),
    enabled: Boolean(config),
  });

  return (
    <Sheet visible={config !== null} onClose={onClose} title={config?.name ?? ''} detents={[0.6, 0.95]}>
      <View className="gap-3 px-4 pb-6 pt-2">
        <View className="flex-row flex-wrap items-center gap-2">
          <Badge label={config ? artifactKindLabel(config.type as ArtifactKind) : ''} />
          <Text numberOfLines={1} className="flex-1 font-mono text-sm text-muted-foreground">
            {config?.filePath}
          </Text>
        </View>
        {content.isLoading ? (
          <LoadingState />
        ) : content.isError ? (
          <ErrorState message="Could not read this file." onRetry={() => void content.refetch()} />
        ) : (
          <Markdown content={content.data?.content || config?.description || ''} />
        )}
        {canRemove && config ? (
          <Button
            label="Remove from project"
            variant="secondary"
            icon={<Trash2 size={16} color={colors.danger} />}
            onPress={() => onRemove(config)}
          />
        ) : null}
      </View>
    </Sheet>
  );
}

function MutedLine({ text }: { text: string }): React.ReactElement {
  return <Text className="px-1 py-2 text-sm text-muted-foreground">{text}</Text>;
}
