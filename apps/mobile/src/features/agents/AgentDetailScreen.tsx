// Agent (MAgentDetail, MAgentDetailOrch; `/agents/[id]`, MD-83): breadcrumb "Agents"; glyph, name, role / scope /
// version / tags; the description; Start chat (→ New chat with the agent), Edit, Export, Delete; Effective capabilities
// (MB-46 from resolve-preview); for an orchestrator its team (member, role, model), max concurrent workers, default
// worker model and the locked Orchestration row; "Used by" — workflows and chats, chats with their live state from the
// attention feed. Built-ins are read-only: Duplicate is the primary.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { chatLiveSets } from '@generatorai/client-core';

import { CapabilitySummary, useResolvePreview } from '../../blocks/CapabilitySummary';
import { AGENTS_HREF, NEW_CHAT_HREF, agentHref, chatHref, workflowHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { useAttention } from '../../services/stream/AttentionProvider';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { Header } from '../../ui/native/router/Header';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Icon } from '../../ui/primitives/Icon';
import { IconButton } from '../../ui/primitives/IconButton';
import { StatusBadge } from '../../ui/primitives/StatusBadge';
import { Text } from '../../ui/primitives/Text';
import { ROLE_LABEL, SCOPE_ICON, SCOPE_LABEL, agentMenu, usedWorkflows, type AgentMenuId } from './model/agentsModel';
import { useAgent, useAgentUsage, useAgents } from './queries';
import { useAgentActions } from './useAgentActions';

type Href = Parameters<typeof router.push>[0];
const USED_BY_LIMIT = 6;

export default function AgentDetailScreen(): React.ReactElement {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const onBack = useHeaderBack();
  const breadcrumb = useBreadcrumb(useMemo(() => [{ label: 'Agents', href: AGENTS_HREF }], []));
  const scopes = useGrantedScopes();
  const canEdit = checkFeature('capabilityAdmin', scopes).available;
  const canChat = scopes.includes('write:chats');
  const agent = useAgent(id);
  const a = agent.data;
  const builtIn = a?.scope === 'system';
  const usage = useAgentUsage(id, Boolean(a));
  const preview = useResolvePreview(a ? { agentRef: a.ref, scope: a.scope === 'project' ? 'project' : 'global', ...(a.projectId ? { projectId: a.projectId } : {}), ...(a.runtime.harnessType ? { harnessType: a.runtime.harnessType } : {}) } : null);
  const all = useAgents();
  const attention = useAttention();
  const live = useMemo(() => chatLiveSets(attention.snapshot), [attention.snapshot]);
  const act = useAgentActions();
  const [showAll, setShowAll] = useState(false);

  const team = useMemo(() => {
    const refs = a?.orchestration?.teamAgentRefs ?? [];
    const byRef = new Map((all.data ?? []).map((x) => [x.ref, x]));
    return refs.map((ref) => ({ ref, agent: byRef.get(ref) ?? null }));
  }, [a, all.data]);
  const workflows = usage.data ? usedWorkflows(usage.data) : [];
  const chats = usage.data?.chats ?? [];
  const usedTotal = workflows.length + chats.length;
  const usedRows = [...workflows.map((w) => ({ kind: 'workflow' as const, ...w })), ...chats.map((c) => ({ kind: 'chat' as const, ...c }))];
  const visibleUsed = showAll ? usedRows : usedRows.slice(0, USED_BY_LIMIT);

  const menu = a ? (agentMenu(a, canEdit).filter((e) => !('id' in e) || e.id !== 'duplicate') as MenuEntry[]) : [];
  const startChat = (): void => router.push(`${NEW_CHAT_HREF}?agent=${encodeURIComponent(a!.ref)}${a!.projectId ? `&project=${encodeURIComponent(a!.projectId)}` : ''}` as Href);
  const header = (
    <Header
      role="detail"
      title={a?.name ?? 'Agent'}
      breadcrumb={breadcrumb}
      onBack={onBack}
      actions={[
        ...(a && canEdit ? [{ id: 'duplicate', icon: 'copy' as const, label: 'Duplicate', onPress: () => act('duplicate', a) }] : []),
        ...(a && menu.length ? [{ id: 'more', icon: 'more' as const, label: 'More', menu, onMenuSelect: (mid: string) => act(mid as AgentMenuId, a) }] : []),
      ]}
    />
  );
  const state = agent.isLoading ? { kind: 'loading' as const } : agent.isError || !a ? { kind: 'error' as const, error: agent.error, onRetry: () => void agent.refetch(), title: "Couldn't load this agent" } : { kind: 'ready' as const };

  return (
    <Screen header={header} state={state} onRefresh={async () => void (await Promise.all([agent.refetch(), usage.refetch(), preview.refetch()]))} testID="agent-detail">
      {a ? (
        <View className="gap-5 pb-8 pt-2">
          <View className="gap-3 px-4">
            <View className="flex-row items-center gap-3">
              <View className="size-12 items-center justify-center rounded-card bg-raised">
                <Icon concept="agents" size={24} tone="fg-2" />
              </View>
              <View className="flex-1 gap-1">
                <Text role="title" weight={600} numberOfLines={2}>
                  {a.name}
                </Text>
                <View className="flex-row flex-wrap items-center gap-1.5">
                  <Badge label={ROLE_LABEL[a.role]} icon={a.role === 'orchestrator' ? 'users' : 'agents'} size="sm" />
                  <Icon concept={SCOPE_ICON[a.scope]} size={12} tone="fg-3" />
                  <Text role="footnote" tone="fg-2">
                    {SCOPE_LABEL[a.scope]}
                  </Text>
                  <Text role="monoSm" tone="fg-3">{`v${a.version}`}</Text>
                  {!a.enabled ? <Badge label="Disabled" size="sm" /> : null}
                  {a.tags.map((t) => (
                    <Badge key={t} label={t} tone="outline" mono size="sm" />
                  ))}
                </View>
              </View>
            </View>
            <Text role="body" tone="fg-2">
              {a.description}
            </Text>
            <View className="flex-row items-center gap-2">
              {builtIn ? (
                canEdit ? <Button label="Duplicate" icon="copy" variant="primary" onPress={() => act('duplicate', a)} testID="agent-duplicate" /> : null
              ) : (
                <Button label="Start chat" icon="chats" variant="primary" disabled={!a.enabled || !canChat} {...(!a.enabled ? { disabledReason: 'This agent is turned off.' } : !canChat ? { disabledReason: 'This device is not allowed to start chats.' } : {})} onPress={startChat} testID="agent-start-chat" />
              )}
              {canEdit && !builtIn ? <Button label="Edit" icon="edit" onPress={() => act('edit', a)} testID="agent-edit" /> : null}
              <IconButton icon="download" variant="bordered" label="Export .agent.md" onPress={() => act('export', a)} />
              {canEdit && !builtIn ? <IconButton icon="trash" variant="bordered" label="Delete" onPress={() => act('delete', a)} testID="agent-delete" /> : null}
            </View>
          </View>

          {a.role === 'orchestrator' ? (
            <>
              <ListSection title="Team" count={team.length} footer={a.orchestration?.maxWorkers ? `Up to ${a.orchestration.maxWorkers} at once` : undefined}>
                {team.length === 0 ? <ListRow kind="info" icon="users" title="Any enabled agent" /> : null}
                {team.map((m) => (
                  <ListRow
                    key={m.ref}
                    kind="navigation"
                    icon="agents"
                    title={m.agent?.name ?? m.ref}
                    subtitle={m.agent ? [ROLE_LABEL[m.agent.role], m.agent.runtime?.model].filter(Boolean).join(' · ') : 'Not on this server'}
                    {...(m.agent && !m.agent.enabled ? { value: 'Disabled' } : {})}
                    onPress={() => m.agent && router.push(agentHref(m.agent.id) as Href)}
                  />
                ))}
                <ListRow kind="value" icon="activity" title="Max concurrent workers" value={a.orchestration?.maxWorkers ? String(a.orchestration.maxWorkers) : 'Server default'} />
                <ListRow kind="value" icon="model" title="Default worker model" value={a.orchestration?.defaultWorkerModel ?? 'Inherit'} />
              </ListSection>
              <ListSection title="Orchestration capability">
                <ListRow kind="info" icon="users" title="Orchestration" subtitle="Always on — it cannot delegate without it" value="On" badge={<Icon concept="lock" size={14} tone="fg-3" accessibilityLabel="Locked" />} />
              </ListSection>
            </>
          ) : null}

          <CapabilitySummary projection={preview.data} loading={preview.isLoading} error={preview.error} onRetry={() => void preview.refetch()} />

          {usage.data ? (
            <ListSection
              title="Used by"
              {...(usedTotal > USED_BY_LIMIT && !showAll ? { action: { label: `See all ${usedTotal}`, onPress: () => setShowAll(true) } } : {})}
              footer={usedTotal === 0 ? 'Not used by any workflow or chat yet.' : undefined}
            >
              {visibleUsed.map((u) =>
                u.kind === 'workflow' ? (
                  <ListRow key={`w:${u.id}`} kind="navigation" icon="workflows" title={u.name} {...(u.stage ? { value: u.stage } : {})} onPress={() => router.push(workflowHref(u.id) as Href)} />
                ) : (
                  <ListRow
                    key={`c:${u.id}`}
                    kind="navigation"
                    icon="chats"
                    title={u.name}
                    {...(live?.needsYou.has(u.id) ? { badge: <StatusBadge state="needs_you" size="sm" /> } : live?.running.has(u.id) ? { badge: <StatusBadge state="running" size="sm" /> } : {})}
                    onPress={() => router.push(chatHref(u.id) as Href)}
                  />
                ),
              )}
            </ListSection>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
