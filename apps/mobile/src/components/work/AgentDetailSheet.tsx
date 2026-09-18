// ────────────────────────────────────────────────────────────────
// AgentDetailSheet — view of a reusable agent, starting a chat driven by
// it, and a lightweight edit (name, description, instructions, model).
//
// Editing is shown ONLY with `admin:settings` (the `/agents` write policy):
// authoring an agent grants capability. Built-in agents are never editable.
// Without the scope the sheet stays read-only and offers Request access when
// the server would accept that request (`canRequestFeature`), otherwise it
// says an admin grants it. Skills, MCP servers and tool policy remain a
// desktop/web edit. The summary from
// the list renders immediately; the full definition (runtime, instructions,
// delegation policy), usage and skill / MCP names load underneath it, and
// each of those fails inline without blocking the rest of the sheet.
//
// Pure logic lives in `agentModel.ts` (unit-tested).
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  queryKeys,
  type AgentSummary,
  type McpServerEntry,
  type ModelInfo,
  type SystemArtifact,
} from '@generatorai/client-core';
import type { Agent } from '@generatorai/shared';
import { Check, MessageSquarePlus, Pencil } from 'lucide-react-native';

import { Sheet, SheetSection } from '../ui/Sheet';
import { Badge } from '../ui/primitives';
import { Button } from '../ui/Button';
import { Field, SearchField } from '../ui/Form';
import { useToast } from '../ui/Toast';
import { useAdminApi } from '../../api/useAdminApi';
import type { useModels } from '../../api/useModels';
import { GRANT_FROM_TRUSTED_DEVICE, canRequestFeature } from '../../auth/featureGate';
import { useFeature } from '../runs/useFeature';
import { ListGroup, ListRow } from '../ui/ListRow';
import { Skeleton } from '../ui/Skeleton';
import { Touchable } from '../ui/Touchable';
import { useApi } from '../../api/useApi';
import { useAuth } from '../../auth/AuthProvider';
import { useTheme } from '../../theme/ThemeProvider';
import {
  agentDraftFrom,
  agentEditAvailability,
  agentUpdateBody,
  validateAgentDraft,
  type AgentDraft,
  agentBadges,
  delegateTargets,
  instructionPreview,
  resolveNames,
  runtimeRows,
  scopeLabel,
  startChatAvailability,
  startChatBody,
  summarizeUsage,
  type CatalogName,
} from './agentModel';

const NO_SCOPES: readonly string[] = [];

export function AgentDetailSheet({
  agent,
  onClose,
}: {
  agent: AgentSummary | null;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Sheet
      visible={agent !== null}
      onClose={onClose}
      title={agent?.name ?? 'Agent'}
      detents={[0.6, 0.95]}
    >
      {agent ? <AgentDetailBody key={agent.id} agent={agent} onClose={onClose} /> : null}
    </Sheet>
  );
}

function AgentDetailBody({ agent, onClose }: { agent: AgentSummary; onClose: () => void }): React.ReactElement {
  const api = useApi();
  const { fetch: authFetch, state } = useAuth();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const scopes = state.status === 'authenticated' ? state.scopes : NO_SCOPES;
  const [editing, setEditing] = useState(false);
  const edit = agentEditAvailability(agent, scopes);
  const capabilityAdmin = useFeature('capabilityAdmin');

  const getJson = async <T,>(path: string): Promise<T> => {
    const res = await authFetch(path);
    if (!res.ok) throw new ApiError(res.status, path, `${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  };

  const detailQueryOptions = {
    queryKey: queryKeys.agent(agent.id),
    queryFn: () => getJson<Agent>(`/api/agents/${encodeURIComponent(agent.id)}`),
    staleTime: 30_000,
  };
  const detail = useQuery(detailQueryOptions);

  const usage = useQuery({
    queryKey: queryKeys.agentUsage(agent.id),
    queryFn: () => getJson<unknown>(`/api/agents/${encodeURIComponent(agent.id)}/usage`),
    staleTime: 30_000,
  });

  const projectId = detail.data?.scope === 'project' ? detail.data.projectId || null : null;
  const hasSkills = agent.skillIds.length > 0;
  const hasMcp = agent.mcpServerIds.length > 0;

  // Name catalogues. System ones share cache keys with the new-chat sheet and
  // Settings → Capabilities; project ones are only needed for project agents.
  const systemSkills = useQuery({
    queryKey: ['system', 'artifacts', 'skill'],
    queryFn: () => api.system.artifacts('skill'),
    enabled: hasSkills,
    staleTime: 60_000,
  });
  const systemMcp = useQuery({
    queryKey: ['system', 'mcp-servers'],
    queryFn: () => api.system.mcpServers(),
    enabled: hasMcp,
    staleTime: 60_000,
  });
  const projectSkills = useQuery({
    queryKey: ['projects', projectId ?? '', 'available-artifacts', 'skill'],
    queryFn: () =>
      getJson<SystemArtifact[]>(`/api/projects/${encodeURIComponent(projectId!)}/available-artifacts?type=skill`),
    enabled: hasSkills && projectId !== null,
    staleTime: 60_000,
  });
  const projectMcp = useQuery({
    queryKey: ['projects', projectId ?? '', 'mcp-servers'],
    queryFn: () => getJson<McpServerEntry[]>(`/api/projects/${encodeURIComponent(projectId!)}/mcp-servers`),
    enabled: hasMcp && projectId !== null,
    staleTime: 60_000,
  });

  const teamRefs = detail.data?.orchestration?.teamAgentRefs ?? [];
  const allAgents = useQuery({
    // Same key as the Agents list, so this is normally a cache hit.
    queryKey: ['agents', 'all'] as const,
    queryFn: () => api.agents.list(),
    enabled: agent.role === 'orchestrator' && teamRefs.length > 0,
    staleTime: 60_000,
  });

  const skills = useMemo(
    () =>
      resolveNames(
        agent.skillIds,
        projectSkills.data as CatalogName[] | undefined,
        systemSkills.data as CatalogName[] | undefined,
      ),
    [agent.skillIds, projectSkills.data, systemSkills.data],
  );
  const mcpServers = useMemo(
    () =>
      resolveNames(
        agent.mcpServerIds,
        projectMcp.data as CatalogName[] | undefined,
        systemMcp.data as CatalogName[] | undefined,
      ),
    [agent.mcpServerIds, projectMcp.data, systemMcp.data],
  );

  // Model display names come from the catalogue ONLY if it is already cached:
  // a cold catalogue costs a provider probe, which a detail sheet must not start.
  const cachedModels = queryClient.getQueryData<ModelInfo[]>(queryKeys.models());
  const rows = useMemo(
    () =>
      detail.data
        ? runtimeRows(detail.data.runtime, (id) => cachedModels?.find((m) => m.id === id)?.name)
        : [],
    [detail.data, cachedModels],
  );

  const badges = agentBadges(agent);
  const availability = startChatAvailability(agent, scopes);

  const startChat = useMutation({
    mutationFn: async () => {
      // A project agent must be created inside its project; the summary does
      // not carry the project id, so make sure the full definition is loaded.
      const full = agent.scope === 'project' ? await queryClient.fetchQuery(detailQueryOptions) : detail.data;
      return api.chats.create(
        startChatBody({ name: agent.name, ref: agent.ref, scope: agent.scope, projectId: full?.projectId ?? null }),
      );
    },
    onSuccess: (chat) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats() });
      onClose();
      router.push(`/chats/${chat.id}`);
    },
    onError: (err) => {
      Alert.alert(
        'Could not start the chat',
        err instanceof ApiError && err.isForbidden
          ? 'This device is not allowed to start chats.'
          : 'Check the connection to your computer and try again.',
      );
    },
  });

  if (editing && detail.data) {
    return (
      <AgentEditForm
        agent={detail.data}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.agent(agent.id) });
          void queryClient.invalidateQueries({ queryKey: ['agents'] });
          setEditing(false);
        }}
      />
    );
  }

  return (
    <View className="gap-2 pb-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <View className="gap-2 px-4 pt-2">
        <Text className="text-sm text-muted-foreground">{scopeLabel(agent.scope)}</Text>
        {agent.description ? (
          <Text numberOfLines={3} className="text-md leading-relaxed text-foreground">
            {agent.description}
          </Text>
        ) : null}
        {badges.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {badges.map((b) => (
              <Badge key={b.label} label={b.label} tone={b.tone} />
            ))}
          </View>
        ) : null}
      </View>

      <View className="gap-1.5 px-4 pb-2 pt-3">
        <Button
          label="Start chat with this agent"
          icon={
            startChat.isPending ? undefined : (
              <MessageSquarePlus size={18} color={availability.allowed ? colors['primary-foreground'] : colors.foreground} />
            )
          }
          full
          loading={startChat.isPending}
          disabled={!availability.allowed}
          onPress={() => startChat.mutate()}
        />
        {availability.reason ? (
          <Text className="text-sm text-muted-foreground">{availability.reason}</Text>
        ) : null}
      </View>

      {/* ── Runtime ────────────────────────────────────────── */}
      <SheetSection title="Runtime" />
      <View className="px-4">
        {detail.isPending ? (
          <DetailSkeleton rows={2} />
        ) : detail.isError ? (
          <InlineError message="Could not load the full definition." onRetry={() => void detail.refetch()} />
        ) : (
          <ListGroup>
            {rows.map((row) => (
              <ListRow key={row.key} title={row.title} trailing={<TrailingValue value={row.value} />} />
            ))}
          </ListGroup>
        )}
      </View>

      {/* ── Instructions ───────────────────────────────────── */}
      {detail.data ? <Instructions text={detail.data.instructions} /> : null}

      {/* ── Delegation (orchestrators) ─────────────────────── */}
      {agent.role === 'orchestrator' && detail.data ? (
        <Delegates
          targets={delegateTargets(detail.data.orchestration, allAgents.data ?? [])}
        />
      ) : null}

      {/* ── Capabilities ───────────────────────────────────── */}
      <SheetSection title={`Skills (${agent.skillIds.length})`} />
      <View className="px-4">
        {skills.length === 0 ? (
          <Text className="text-sm text-muted-foreground">Uses no skills.</Text>
        ) : (
          <ListGroup>
            {skills.map((s) => (
              <ListRow key={s.id} title={s.name} />
            ))}
          </ListGroup>
        )}
      </View>

      <SheetSection title={`MCP servers (${agent.mcpServerIds.length})`} />
      <View className="px-4">
        {mcpServers.length === 0 ? (
          <Text className="text-sm text-muted-foreground">Uses no MCP servers.</Text>
        ) : (
          <ListGroup>
            {mcpServers.map((m) => (
              <ListRow key={m.id} title={m.name} />
            ))}
          </ListGroup>
        )}
      </View>

      {/* ── Used by ────────────────────────────────────────── */}
      <UsedBy
        query={usage}
        onOpen={(path) => {
          onClose();
          router.push(path);
        }}
      />

      <View className="gap-2 px-4 pt-4">
        {edit.editable ? (
          <Button
            label="Edit agent"
            variant="secondary"
            haptic="tap"
            icon={<Pencil size={16} color={colors.foreground} />}
            disabled={!detail.data}
            onPress={() => setEditing(true)}
          />
        ) : (
          <>
            <Text className="text-sm leading-relaxed text-muted-foreground">
              {edit.reason}
              {edit.requestable && !canRequestFeature('capabilityAdmin', scopes) ? ` ${GRANT_FROM_TRUSTED_DEVICE}` : ''}
            </Text>
            {edit.requestable && canRequestFeature('capabilityAdmin', scopes) ? (
              <View className="self-start">
                <Button
                  label="Request access"
                  variant="ghost"
                  size="sm"
                  haptic="tap"
                  onPress={() => {
                    onClose();
                    capabilityAdmin.requestAccess();
                  }}
                />
              </View>
            ) : null}
          </>
        )}
        <Text className="text-sm leading-relaxed text-muted-foreground">
          Skills, MCP servers and tool permissions are changed on the desktop or web app.
        </Text>
      </View>
    </View>
  );
}

function TrailingValue({ value }: { value: string }): React.ReactElement {
  return (
    <Text numberOfLines={1} className="max-w-[60%] text-right text-sm text-muted-foreground">
      {value}
    </Text>
  );
}

function DetailSkeleton({ rows }: { rows: number }): React.ReactElement {
  return (
    <View className="gap-3 py-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={i % 2 === 0 ? '70%' : '45%'} height={14} />
      ))}
    </View>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }): React.ReactElement {
  return (
    <View className="flex-row items-center justify-between gap-3 py-1">
      <Text className="flex-1 text-sm text-muted-foreground">{message}</Text>
      <Button label="Retry" variant="ghost" size="sm" haptic="tap" onPress={onRetry} />
    </View>
  );
}

function Instructions({ text }: { text: string }): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const preview = useMemo(() => instructionPreview(text), [text]);
  if (!preview.text) return null;
  return (
    <>
      <SheetSection title="Instructions" />
      <View className="gap-1 px-4">
        <View className="rounded-2xl border border-border-muted bg-subtle px-3 py-2.5">
          <Text selectable className="font-mono text-sm leading-relaxed text-foreground">
            {expanded ? text.trim() : preview.text}
          </Text>
        </View>
        {preview.truncated ? (
          <Touchable
            onPress={() => setExpanded((v) => !v)}
            accessibilityLabel={expanded ? 'Show less instructions' : 'Show more instructions'}
            className="min-h-11 justify-center self-start"
          >
            <Text className="text-sm font-semibold text-foreground">{expanded ? 'Show less' : 'Show more'}</Text>
          </Touchable>
        ) : null}
      </View>
    </>
  );
}

function Delegates({ targets }: { targets: Array<{ ref: string; name: string }> | null }): React.ReactElement {
  return (
    <>
      <SheetSection title={targets ? `Can delegate to (${targets.length})` : 'Can delegate to'} />
      <View className="px-4">
        {targets === null ? (
          <Text className="text-sm text-muted-foreground">Any enabled agent.</Text>
        ) : (
          <ListGroup>
            {targets.map((t) => (
              <ListRow key={t.ref} title={t.name} />
            ))}
          </ListGroup>
        )}
      </View>
    </>
  );
}

function UsedBy({
  query,
  onOpen,
}: {
  query: { isPending: boolean; isError: boolean; data: unknown; refetch: () => unknown };
  onOpen: (path: `/chats/${string}` | `/workflows/${string}`) => void;
}): React.ReactElement {
  const summary = useMemo(() => summarizeUsage(query.data), [query.data]);
  return (
    <>
      <SheetSection title={query.data !== undefined && summary.total > 0 ? `Used by (${summary.total})` : 'Used by'} />
      <View className="gap-3 px-4">
        {query.isPending ? (
          <DetailSkeleton rows={2} />
        ) : query.isError ? (
          <InlineError message="Could not load where this agent is used." onRetry={() => void query.refetch()} />
        ) : summary.total === 0 ? (
          <Text className="text-sm text-muted-foreground">Not used by any chat or workflow yet.</Text>
        ) : (
          summary.groups.map((group) => (
            <View key={group.key} className="gap-1">
              <Text className="text-sm font-medium text-muted-foreground">
                {group.title} · {group.items.length}
              </Text>
              <ListGroup>
                {group.items.slice(0, 5).map((item) => (
                  <ListRow
                    key={item.id}
                    title={item.name}
                    {...(group.key === 'chats'
                      ? { onPress: () => onOpen(`/chats/${item.id}`) }
                      : group.key === 'workflows'
                        ? { onPress: () => onOpen(`/workflows/${item.id}`) }
                        : {})}
                  />
                ))}
              </ListGroup>
              {group.items.length > 5 ? (
                <Text className="text-sm text-muted-foreground">and {group.items.length - 5} more</Text>
              ) : null}
            </View>
          ))
        )}
      </View>
    </>
  );
}

// ── Edit ────────────────────────────────────────────────────────

function AgentEditForm({
  agent,
  onCancel,
  onSaved,
}: {
  agent: Agent;
  onCancel: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const admin = useAdminApi();
  const toast = useToast();
  const { colors } = useTheme();
  const [draft, setDraft] = useState<AgentDraft>(() => agentDraftFrom(agent));
  const [pickingModel, setPickingModel] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  // Loaded only once the picker opens: a cold catalogue costs a provider probe.
  const models = useModelsWhen(pickingModel);

  const errors = validateAgentDraft(draft);
  const body = agentUpdateBody(agent, draft);
  const invalid = Object.keys(errors).length > 0;

  const save = useMutation({
    mutationFn: () => admin.agents.update(agent.id, body ?? {}),
    onSuccess: () => {
      toast({ message: 'Agent saved.', variant: 'success' });
      onSaved();
    },
    onError: (err) =>
      toast({
        message:
          err instanceof ApiError && err.isForbidden
            ? 'This device is not allowed to edit agents.'
            : err instanceof Error && err.message
              ? err.message
              : 'Could not save the agent.',
        variant: 'danger',
      }),
  });

  const set = (patch: Partial<AgentDraft>): void => setDraft((d) => ({ ...d, ...patch }));
  const modelName = draft.model ? (models.data?.find((m) => m.id === draft.model)?.name ?? draft.model) : 'Inherits the default';
  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    return (models.data ?? []).filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  }, [models.data, modelQuery]);

  return (
    <View className="gap-4 px-4 pb-6 pt-2">
      <Field label="Name" value={draft.name} onChangeText={(name) => set({ name })} maxLength={120} error={errors.name ?? null} />
      <Field
        label="Description"
        value={draft.description}
        onChangeText={(description) => set({ description })}
        multiline
        hint="The model reads this to decide when to use the agent."
        error={draft.description ? (errors.description ?? null) : null}
        style={{ minHeight: 72, textAlignVertical: 'top' }}
      />
      <Field
        label="Instructions"
        value={draft.instructions}
        onChangeText={(instructions) => set({ instructions })}
        multiline
        autoCapitalize="none"
        error={errors.instructions ?? null}
        style={{ minHeight: 180, textAlignVertical: 'top', fontFamily: 'monospace' }}
      />

      <View className="gap-2">
        <Text className="text-sm font-medium text-foreground">Model</Text>
        <ListGroup>
          <ListRow
            title={modelName}
            subtitle={pickingModel ? null : 'Tap to change'}
            onPress={() => setPickingModel((v) => !v)}
            accessibilityLabel={`Model, ${modelName}`}
          />
        </ListGroup>
        {pickingModel ? (
          <View className="gap-2">
            <SearchField value={modelQuery} onChangeText={setModelQuery} placeholder="Search models" />
            {models.isLoading ? (
              <DetailSkeleton rows={3} />
            ) : models.isError ? (
              <InlineError message="Could not load models." onRetry={() => void models.refetch()} />
            ) : (
              <ListGroup>
                <ListRow
                  title="Inherit the default"
                  selected={!draft.model}
                  chevron={false}
                  {...(!draft.model ? { trailing: <Check size={18} color={colors.primary} /> } : {})}
                  onPress={() => {
                    set({ model: '' });
                    setPickingModel(false);
                  }}
                />
                {filteredModels.slice(0, 40).map((m) => (
                  <ListRow
                    key={m.id}
                    title={m.name}
                    subtitle={m.provider ?? null}
                    selected={draft.model === m.id}
                    chevron={false}
                    {...(draft.model === m.id ? { trailing: <Check size={18} color={colors.primary} /> } : {})}
                    onPress={() => {
                      set({ model: m.id });
                      setPickingModel(false);
                    }}
                  />
                ))}
              </ListGroup>
            )}
          </View>
        ) : null}
      </View>

      <View className="flex-row gap-2">
        <Button label="Cancel" variant="secondary" grow haptic="tap" onPress={onCancel} />
        <Button
          label="Save"
          grow
          loading={save.isPending}
          disabled={!body || invalid || save.isPending}
          onPress={() => save.mutate()}
        />
      </View>
    </View>
  );
}

/** `useModels`, but only subscribed (and therefore only fetched) when `enabled`. */
function useModelsWhen(enabled: boolean): ReturnType<typeof useModels> {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.models(),
    queryFn: () => api.models(),
    enabled,
    staleTime: 10 * 60_000,
  });
}
