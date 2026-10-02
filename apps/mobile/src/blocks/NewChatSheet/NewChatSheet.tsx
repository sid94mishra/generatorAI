// MB-06 New chat (MNewChat, MNewChatMore; `/chats/new`, a route sheet at the large detent, MD-21): Task ("Sent as the
// first message"), Name / Description ("Named from the task"), "Who works on this" (Just a model / An agent / An
// orchestrator, fixed once the chat starts), the agent or the model row, Effort, Where (project + its codebases:
// worktree / in place, new / existing branch, the working directory), Capabilities (the per-chat overrides), More
// (tags, browser). Pickers are pages inside this one sheet with a back control (MD-62) and return through the
// draft store; the footer pins the summary and the one `lg` primary "Create chat" (MD-85, MD-22).
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { findPickerModel, type AgentSummary } from '@generatorai/client-core';
import type { AgentToolPolicy } from '@generatorai/shared';

import { AgentPicker, agentFacts } from '../AgentPicker';
import { CapabilityChecklist, CapabilityEditor, InstructionsEditor } from '../CapabilityEditor';
import { ModelPicker } from '../ModelPicker';
import { ProjectPicker, codebaseCount } from '../ProjectPicker';
import { useModelPickerCatalog } from '../TurnSheet';
import { useAuth } from '../../services/auth/AuthProvider';
import type { RemovalSource } from '../../ui/layout/DirtyGuard/DirtyGuard.types';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { RouteSheet } from '../../ui/native/Sheet';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Chip } from '../../ui/primitives/Chip';
import { Input } from '../../ui/primitives/Input';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { addTag, overrideIncludes, toggleOverrideId } from './model/newChatModel';
import { CAPABILITIES, agentTool, capabilitiesSummary, createBlocker, createBody, setToolOverride, sourcesFootnote, whoSummary, type NewChatDraft } from './model/newChatSheetModel';
import { defaultNewBranch, draftFromCodebase, type DraftSource } from './model/sourceModel';
import { useAgentDetail, useCreateChatWithTask, useMcpCatalog, useProjectCodebases, useProjectsList, useSelectableAgents, useSkillCatalog } from './NewChatSheet.queries';
import { useNewChatDraft } from './newChatDraftStore';

type Page = 'main' | 'agent' | 'caps' | 'skills' | 'mcp' | 'instructions' | 'model' | 'project';

export interface NewChatSheetProps {
  /** Entry params (`?project=&agent=`). */
  seed?: { projectId?: string; agentRef?: string };
  onCreated: (chatId: string, firstMessageSent: boolean) => void;
  onClose: () => void;
  navigation?: RemovalSource;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <View className="gap-2">
      <View className="flex-row items-baseline gap-2">
        <Text role="footnote" weight={600} tone="fg-2">
          {title}
        </Text>
        {hint ? (
          <Text role="caption" tone="fg-3">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function SourceCard({ source, chatName, primary, multiple, onChange, onRemove, onPrimary }: { source: DraftSource; chatName: string; primary: boolean; multiple: boolean; onChange: (next: DraftSource) => void; onRemove: () => void; onPrimary: () => void }): React.ReactElement {
  return (
    <View className="gap-2 rounded-card border border-line-soft p-3" testID={`source-${source.alias}`}>
      <View className="flex-row items-center gap-2">
        <Text role="subhead" weight={600} className="flex-1" numberOfLines={1}>
          {source.name}
        </Text>
        {source.defaultBranch ? <Chip variant="filter" label={source.defaultBranch} /> : null}
        {multiple ? <Chip variant="filter" label="Working dir" selected={primary} onPress={onPrimary} /> : null}
        <Button label="Remove" variant="ghost" size="sm" onPress={onRemove} accessibilityLabel={`Remove ${source.name}`} />
      </View>
      <SegmentedControl accessibilityLabel={`${source.name} checkout`} value={source.mode} onValueChange={(mode) => onChange({ ...source, mode })} segments={[{ value: 'worktree', label: 'Worktree' }, { value: 'in-place', label: 'In place' }]} fullWidth size="sm" />
      <SegmentedControl
        accessibilityLabel={`${source.name} branch`}
        value={source.branchMode === 'current' ? 'new' : source.branchMode}
        onValueChange={(branchMode) => onChange({ ...source, branchMode })}
        segments={[{ value: 'new', label: 'New branch' }, { value: 'existing', label: 'Existing branch' }]}
        fullWidth
        size="sm"
      />
      <Input
        label={source.branchMode === 'existing' ? 'Branch' : 'New branch'}
        kind="mono"
        presentation="standalone"
        value={source.branchMode === 'existing' ? source.branch : source.newBranch}
        placeholder={source.branchMode === 'existing' ? (source.defaultBranch ?? 'main') : defaultNewBranch(chatName)}
        onChangeText={(text) => onChange(source.branchMode === 'existing' ? { ...source, branch: text } : { ...source, branchMode: 'new', newBranch: text })}
      />
    </View>
  );
}

export function NewChatSheet({ seed, onCreated, onClose, navigation }: NewChatSheetProps): React.ReactElement {
  const { serverId } = useAuth();
  const { draft, open, update, clear } = useNewChatDraft();
  useEffect(() => {
    open(serverId, { ...(seed?.projectId ? { projectId: seed.projectId } : {}), ...(seed?.agentRef ? { agentRef: seed.agentRef, who: 'agent' as const } : {}) });
  }, [open, serverId, seed?.projectId, seed?.agentRef]);
  const [page, setPage] = useState<Page>('main');
  const [tag, setTag] = useState('');

  const agents = useSelectableAgents(draft.projectId);
  const agent: AgentSummary | null = useMemo(() => agents.data?.find((a) => a.ref === draft.agentRef) ?? null, [agents.data, draft.agentRef]);
  const agentDetail = useAgentDetail(draft.who !== 'model' ? (agent?.id ?? null) : null);
  const { catalog } = useModelPickerCatalog();
  const model = catalog ? findPickerModel(catalog, draft.model || agentDetail.data?.runtime.model) : undefined;
  const projects = useProjectsList();
  const project = projects.data?.find((p) => p.id === draft.projectId) ?? null;
  const codebases = useProjectCodebases(draft.projectId);
  const skills = useSkillCatalog(page === 'skills' || page === 'caps');
  const mcp = useMcpCatalog(page === 'mcp' || page === 'caps');
  const create = useCreateChatWithTask();

  const chatName = draft.name.trim() || draft.prompt.trim().split('\n')[0] || 'chat';
  const blocker = createBlocker(draft);
  const set = (patch: Partial<NewChatDraft>): void => update(patch);

  const toolRows = CAPABILITIES.map(({ key, label }) => {
    const base = agentTool(agentDetail.data?.tools, key);
    const value = draft.overrides.tools?.[key] ?? base;
    return { key, label, value, changed: value !== base, base };
  });
  const skillIds = agentDetail.data?.skillIds ?? agent?.skillIds ?? [];
  const mcpIds = agentDetail.data?.mcpServerIds ?? agent?.mcpServerIds ?? [];
  const skillOn = (skills.data ?? []).filter((s) => overrideIncludes(draft.overrides, 'skill', s.id, skillIds.includes(s.id)));
  const mcpOn = (mcp.data ?? []).filter((m) => overrideIncludes(draft.overrides, 'mcp', m.id ?? m.name, mcpIds.includes(m.id ?? m.name)));
  const effectiveSkills = skills.data ? skillOn.length : skillIds.length + (draft.overrides.addSkillIds?.length ?? 0) - (draft.overrides.removeSkillIds?.length ?? 0);
  const effectiveMcp = mcp.data ? mcpOn.length : mcpIds.length + (draft.overrides.addMcpServerIds?.length ?? 0) - (draft.overrides.removeMcpServerIds?.length ?? 0);

  const submit = (): void => {
    if (blocker) return;
    create.mutate(
      { body: createBody(draft), task: draft.prompt },
      {
        onSuccess: ({ chat, sent }) => {
          haptic('success');
          clear();
          onCreated(chat.id, sent);
        },
        onError: () => haptic('error'),
      },
    );
  };

  const addCodebase = (cb: { id: string; alias: string; defaultBranch?: string }): void =>
    set({ sources: [...draft.sources, draftFromCodebase(cb, draft.sources.map((s) => s.alias))] });

  // ── Pages (MD-62) ───────────────────────────────────────────────
  if (page === 'agent') {
    return (
      <RouteSheet
        title={draft.who === 'orchestrator' ? 'Orchestrator' : 'Agent'}
        subtitle="Fixed for the life of the chat"
        back={{ label: 'New chat', onPress: () => setPage('main') }}
        onDismiss={onClose}
        scrollable
        navigation={navigation}
        footer={<Button label={agent ? `Use ${agent.name}` : 'Choose an agent'} variant="primary" size="lg" fullWidth disabled={!agent} onPress={() => setPage('main')} testID="agent-use" />}
      >
        <View className="px-4">
          <AgentPicker agents={agents.data ?? []} value={draft.agentRef ?? null} onValueChange={(ref) => set({ agentRef: ref, overrides: {} })} role={draft.who === 'orchestrator' ? 'orchestrator' : 'agent'} onCustomize={() => setPage('caps')} />
        </View>
      </RouteSheet>
    );
  }
  if (page === 'caps' && agent) {
    return (
      <RouteSheet
        title="Customize capabilities"
        subtitle={`For ${agent.name} in this chat`}
        back={{ label: 'Agents', onPress: () => setPage('agent') }}
        headerAction={{ label: 'Reset', onPress: () => set({ overrides: {} }) }}
        onDismiss={onClose}
        scrollable
        navigation={navigation}
      >
        <View className="gap-3 px-4">
          <CapabilityEditor
            agentName={agent.name}
            rows={toolRows}
            onToggle={(key: keyof AgentToolPolicy, value) => set({ overrides: setToolOverride(draft.overrides, key, value, agentTool(agentDetail.data?.tools, key)) })}
            onReset={(key) => set({ overrides: setToolOverride(draft.overrides, key, agentTool(agentDetail.data?.tools, key), agentTool(agentDetail.data?.tools, key)) })}
            skills={{ on: effectiveSkills, total: skills.data?.length ?? null, summary: skillOn.slice(0, 3).map((s) => s.name).join(', ') || 'None' }}
            mcp={{ on: effectiveMcp, total: mcp.data?.length ?? null, summary: mcpOn.slice(0, 3).map((m) => m.name).join(', ') || 'None' }}
            instructions={draft.overrides.appendInstructions ?? ''}
            onOpen={(p) => setPage(p)}
          />
          <View className="flex-row items-center gap-3">
            <Text role="footnote" tone="fg-3" className="flex-1">
              {capabilitiesSummary(effectiveSkills, effectiveMcp, toolRows.filter((r) => r.value).length)}
            </Text>
            <Button label="Done" variant="secondary" onPress={() => setPage('agent')} testID="caps-done" />
          </View>
        </View>
      </RouteSheet>
    );
  }
  if ((page === 'skills' || page === 'mcp' || page === 'instructions') && agent) {
    const title = page === 'skills' ? 'Skills' : page === 'mcp' ? 'MCP servers' : 'Extra instructions';
    return (
      <RouteSheet title={title} subtitle={`For ${agent.name} in this chat`} back={{ label: 'Customize capabilities', onPress: () => setPage('caps') }} onDismiss={onClose} scrollable navigation={navigation}>
        <View className="px-4">
          {page === 'instructions' ? (
            <InstructionsEditor agentName={agent.name} value={draft.overrides.appendInstructions ?? ''} onChange={(v) => {
                const { appendInstructions: _drop, ...rest } = draft.overrides;
                set({ overrides: v ? { ...rest, appendInstructions: v } : rest });
              }} />
          ) : page === 'skills' ? (
            <CapabilityChecklist
              items={(skills.data ?? []).map((s) => ({ id: s.id, label: s.name, ...(s.description ? { description: s.description } : {}), on: overrideIncludes(draft.overrides, 'skill', s.id, skillIds.includes(s.id)), fromAgent: skillIds.includes(s.id) }))}
              onToggle={(id, on) => set({ overrides: toggleOverrideId(draft.overrides, 'skill', id, skillIds.includes(id), on) })}
            />
          ) : (
            <CapabilityChecklist
              items={(mcp.data ?? []).map((m) => {
                const id = m.id ?? m.name;
                return { id, label: m.name, ...(m.description ? { description: m.description } : {}), on: overrideIncludes(draft.overrides, 'mcp', id, mcpIds.includes(id)), fromAgent: mcpIds.includes(id) };
              })}
              onToggle={(id, on) => set({ overrides: toggleOverrideId(draft.overrides, 'mcp', id, mcpIds.includes(id), on) })}
            />
          )}
        </View>
      </RouteSheet>
    );
  }
  if (page === 'model' && catalog) {
    return (
      <RouteSheet title="Model" back={{ label: 'New chat', onPress: () => setPage('main') }} onDismiss={onClose} scrollable navigation={navigation}>
        <View className="px-4">
          <ModelPicker
            catalog={catalog}
            value={model ? { provider: model.provider, model: model.id } : null}
            onValueChange={(v) => {
              set({ model: v.model, effort: undefined });
              setPage('main');
            }}
          />
        </View>
      </RouteSheet>
    );
  }
  if (page === 'project') {
    return (
      <RouteSheet title="Project" back={{ label: 'New chat', onPress: () => setPage('main') }} onDismiss={onClose} scrollable navigation={navigation}>
        <View className="px-4">
          <ProjectPicker
            projects={projects.data ?? []}
            value={draft.projectId ?? null}
            onValueChange={(id) => {
              set({ projectId: id ?? undefined, sources: [], primaryAlias: undefined });
              setPage('main');
            }}
          />
        </View>
      </RouteSheet>
    );
  }

  // ── Main page ───────────────────────────────────────────────────
  const agentName = draft.who !== 'model' ? (agent?.name ?? null) : null;
  const modelLabel = model?.name ?? (draft.model || null);
  const footnote = sourcesFootnote(draft.sources);
  const unusedCodebases = (codebases.data ?? []).filter((cb) => !draft.sources.some((s) => s.codebaseId === cb.id));
  return (
    <RouteSheet
      title="New chat"
      onDismiss={onClose}
      scrollable
      navigation={navigation}
      testID="new-chat-sheet"
      footer={
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text role="footnote" weight={600} numberOfLines={1}>
              {whoSummary(agentName, modelLabel)}
            </Text>
            {footnote ? (
              <Text role="caption" tone="fg-3" numberOfLines={1}>
                {footnote}
              </Text>
            ) : null}
          </View>
          <Button label="Create chat" variant="primary" size="lg" loading={create.isPending} disabled={Boolean(blocker)} {...(blocker ? { disabledReason: blocker } : {})} onPress={submit} testID="new-chat-create" />
        </View>
      }
    >
      <View className="gap-5 px-4">
        {create.isError ? <Callout tone="err" title="Couldn't create the chat" body="Check the sources and try again." action={{ label: 'Try again', onPress: submit }} /> : null}
        <Section title="Task" hint="Sent as the first message">
          <Textarea label="Task" value={draft.prompt} onChangeText={(prompt) => set({ prompt })} placeholder="What should the agent do?" minRows={3} testID="new-chat-task" />
        </Section>
        <ListSection>
          <Input label="Name" value={draft.name} onChangeText={(name) => set({ name })} placeholder="Named from the task" testID="new-chat-name" />
          <Input label="Description" value={draft.description} onChangeText={(description) => set({ description })} placeholder="Shown in the list (optional)" />
        </ListSection>
        <Section title="Who works on this" hint="Fixed once the chat starts">
          <SegmentedControl
            accessibilityLabel="Who works on this"
            value={draft.who}
            onValueChange={(who) => set({ who, ...(who === 'model' ? {} : agent && agent.role !== (who === 'orchestrator' ? 'orchestrator' : 'agent') ? { agentRef: undefined, overrides: {} } : {}) })}
            segments={[
              { value: 'model', label: 'Just a model' },
              { value: 'agent', label: 'An agent' },
              { value: 'orchestrator', label: 'An orchestrator' },
            ]}
            fullWidth
            testID="new-chat-who"
          />
          {draft.who !== 'model' ? (
            <ListSection>
              <ListRow kind="navigation" icon="agents" title={agent?.name ?? (draft.who === 'orchestrator' ? 'Choose an orchestrator' : 'Choose an agent')} {...(agent ? { subtitle: agentFacts(agent) } : {})} onPress={() => setPage('agent')} testID="new-chat-agent" />
            </ListSection>
          ) : null}
        </Section>
        <Section title="Model" hint={draft.model ? undefined : draft.who === 'model' ? 'The server default' : 'From the agent'}>
          <ListSection>
            <ListRow kind="navigation" icon="model" title={modelLabel ?? 'Default model'} onPress={() => setPage('model')} testID="new-chat-model" />
          </ListSection>
          {model && model.reasoningEfforts.length ? (
            <SegmentedControl accessibilityLabel="Effort" value={draft.effort ?? model.defaultReasoningEffort ?? model.reasoningEfforts[0]!} onValueChange={(effort) => set({ effort })} segments={model.reasoningEfforts.map((e) => ({ value: e, label: e.charAt(0).toUpperCase() + e.slice(1) }))} fullWidth />
          ) : null}
        </Section>
        <Section title="Where" hint="Starts in the working directory">
          <ListSection>
            <ListRow kind="navigation" icon="folder-open" title={project?.name ?? 'No project'} mono={Boolean(project)} {...(project && codebaseCount(project) ? { value: codebaseCount(project)! } : {})} onPress={() => setPage('project')} testID="new-chat-project" />
          </ListSection>
          {draft.sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              chatName={chatName}
              multiple={draft.sources.length > 1}
              primary={(draft.primaryAlias ?? draft.sources[0]?.alias) === source.alias}
              onChange={(next) => set({ sources: draft.sources.map((s) => (s.id === source.id ? next : s)) })}
              onRemove={() => set({ sources: draft.sources.filter((s) => s.id !== source.id) })}
              onPrimary={() => set({ primaryAlias: source.alias })}
            />
          ))}
          {unusedCodebases.length ? (
            <View className="flex-row flex-wrap gap-2">
              {unusedCodebases.map((cb) => (
                <Chip key={cb.id} variant="add" label={cb.alias} onPress={() => addCodebase({ id: cb.id, alias: cb.alias, ...(cb.defaultBranch ? { defaultBranch: cb.defaultBranch } : {}) })} testID={`new-chat-add-${cb.alias}`} />
              ))}
            </View>
          ) : null}
        </Section>
        {draft.who !== 'model' && agent ? (
          <Section title="Capabilities" hint={`Added to ${agent.name}’s own`}>
            <ListSection>
              <ListRow kind="navigation" icon="shield" title={capabilitiesSummary(effectiveSkills, effectiveMcp, toolRows.filter((r) => r.value).length)} onPress={() => setPage('caps')} testID="new-chat-caps" />
            </ListSection>
          </Section>
        ) : null}
        <Section title="More" hint="(optional)">
          <View className="flex-row flex-wrap items-center gap-2">
            {draft.tags.map((t) => (
              <Chip key={t} variant="input" label={t} onRemove={() => set({ tags: draft.tags.filter((x) => x !== t) })} />
            ))}
          </View>
          <Input
            label="Tag"
            value={tag}
            onChangeText={setTag}
            placeholder="Add a tag"
            presentation="standalone"
            returnKeyType="done"
            onSubmitEditing={() => {
              set({ tags: addTag(draft.tags, tag) });
              setTag('');
            }}
          />
          <SegmentedControl
            accessibilityLabel="Browser"
            value={draft.browser}
            onValueChange={(browser) => set({ browser })}
            segments={[
              { value: 'headless', label: 'Headless' },
              { value: 'visible', label: 'Visible' },
              { value: 'off', label: 'Off' },
            ]}
            fullWidth
            testID="new-chat-browser"
          />
        </Section>
      </View>
    </RouteSheet>
  );
}
