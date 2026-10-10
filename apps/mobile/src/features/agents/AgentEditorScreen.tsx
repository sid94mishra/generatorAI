// Agent editor (MAgentEdit1–3; `/agents/[id]/edit` and `/agents/create?from=&scope=&projectId=`, a full-screen modal,
// MD-21): one long form — Identity (name + slug, description, scope (create only), tags, enabled), Instructions (mono,
// size meter: warn > 8 KB, error > 32 KB; add to / replace the built-in prompt), Role, Runtime (provider, model →
// the model picker in a sheet, effort, context tier, max turns; "Inherit" everywhere), Team (orchestrators: members via
// the agent picker, max concurrent workers, default worker model), Skills and MCP chips, Capabilities as explicit
// tri-states (Inherit / On / Off, MDF-103) and "Effective capabilities" (MB-46 on the unsaved draft). The header
// carries the change count while dirty (MD-25) and the text confirm Save / Create (MD-85).
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { ApiError, findPickerModel } from '@generatorai/client-core';
import { AGENT_INSTRUCTIONS_MAX_BYTES } from '@generatorai/shared';

import { AgentPicker } from '../../blocks/AgentPicker';
import { CapabilitySummary, CapabilitySummaryRow, harnessLabel, useResolvePreview } from '../../blocks/CapabilitySummary';
import { ModelPicker } from '../../blocks/ModelPicker';
import { AGENTS_HREF, agentHref } from '../../blocks/shell/hrefs';
import { useModelPickerCatalog } from '../../blocks/TurnSheet';
import { FullScreenEditor } from '../../ui/layout/FullScreenEditor';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { errorText } from '../../ui/lib/format';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { useSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { Chip } from '../../ui/primitives/Chip';
import { ChipGroup } from '../../ui/primitives/ChipGroup';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Field } from '../../ui/primitives/Field';
import { Input } from '../../ui/primitives/Input';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { toast } from '../../ui/primitives/Toast';
import {
  BLANK_DRAFT,
  CAPABILITIES,
  EFFORT_LABEL,
  ROLE_LABEL,
  changeCount,
  createBody,
  draftFrom,
  duplicateDraft,
  instructionsBytes,
  instructionsLevel,
  triOf,
  updateBody,
  validateDraft,
  withName,
  withTri,
  type AgentDraft,
  type TriState,
} from './model/agentsModel';
import { useAgent, useAgentCatalogs, useAgentWrites, useAgents, useProjectsForAgents } from './queries';

type Href = Parameters<typeof router.replace>[0];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-baseline gap-x-2 px-4">
        <Text role="subhead" weight={600} accessibilityRole="header">
          {title}
        </Text>
        {hint ? (
          <Text role="footnote" tone="fg-3">
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export default function AgentEditorScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string; from?: string; scope?: string; projectId?: string }>();
  const navigation = useNavigation();
  const sheet = useSheet();
  const editing = Boolean(params.id);
  const sourceId = editing ? params.id! : params.from?.startsWith('agent:') ? params.from.slice('agent:'.length) : '';
  const source = useAgent(sourceId);
  const all = useAgents();
  const projects = useProjectsForAgents(!editing);
  const writes = useAgentWrites();
  const { catalog } = useModelPickerCatalog();

  const seeded = useMemo<AgentDraft | null>(() => {
    if (sourceId && !source.data) return null;
    if (editing) return draftFrom(source.data!);
    const scope = params.scope === 'project' ? 'project' : 'global';
    const projectId = scope === 'project' ? (params.projectId ?? null) : null;
    return source.data ? duplicateDraft(source.data, scope, projectId) : { ...BLANK_DRAFT, scope, projectId };
  }, [sourceId, source.data, editing, params.scope, params.projectId]);
  const [edited, setDraft] = useState<AgentDraft | null>(null);
  // The form starts from the seed; the first edit takes it over.
  const draft = edited ?? seeded;
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const catalogs = useAgentCatalogs(draft?.projectId ?? null, Boolean(draft));
  const preview = useResolvePreview(
    draft
      ? {
          draft: createBody(draft) as unknown as Record<string, unknown>,
          scope: draft.scope,
          ...(draft.projectId ? { projectId: draft.projectId } : {}),
          ...(draft.harnessType ? { harnessType: draft.harnessType } : {}),
        }
      : null,
  );

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace((editing ? agentHref(params.id!) : AGENTS_HREF) as Href);
  };
  if (!draft) {
    return (
      <FullScreenEditor title={editing ? 'Edit agent' : 'New agent'} primary={{ label: editing ? 'Save' : 'Create', onPress: () => undefined, disabled: true }} onCancel={close} dirty={false} navigation={navigation as never}>
        {source.isError ? <ErrorState title="Couldn't load the agent" error={source.error} onRetry={() => void source.refetch()} /> : <Skeleton preset="list" count={8} />}
      </FullScreenEditor>
    );
  }

  const set = (patch: Partial<AgentDraft>): void => setDraft({ ...draft, ...patch });
  const taken = new Set((all.data ?? []).filter((a) => a.scope === draft.scope && a.id !== params.id).map((a) => a.slug));
  const errors = validateDraft(draft, taken);
  const count = seeded ? changeCount(seeded, draft) : 0;
  const dirty = editing ? count > 0 : true;
  const model = catalog && draft.model ? findPickerModel(catalog, draft.model, draft.harnessType ?? undefined) : null;
  const efforts = model?.reasoningEfforts ?? Object.keys(EFFORT_LABEL).slice(0, 4);
  const level = instructionsLevel(draft.instructions);

  const save = (): void => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    setSaving(true);
    (editing ? writes.update(params.id!, updateBody(draft)) : writes.create(createBody(draft)))
      .then((agent) => {
        haptic('success');
        // Clean before leaving: `saving` turns false again in `finally`, and a dirty editor would ask to discard.
        setDraft(null);
        if (editing) close();
        else router.replace(agentHref(agent.id) as Href);
      })
      .catch((e: unknown) => toast({ kind: 'error', message: e instanceof ApiError && e.status === 409 ? 'Another agent in this scope uses this slug.' : errorText(e) }))
      .finally(() => setSaving(false));
  };

  const pickModel = (forWorkers: boolean): void => {
    if (!catalog) return;
    sheet.present(
      <ModelPicker
        catalog={catalog}
        value={forWorkers ? (draft.defaultWorkerModel ? { provider: draft.harnessType ?? '', model: draft.defaultWorkerModel } : null) : draft.model ? { provider: draft.harnessType ?? '', model: draft.model } : null}
        providerFilter={draft.harnessType}
        onValueChange={(v) => {
          if (forWorkers) set({ defaultWorkerModel: v.model });
          else set({ model: v.model, harnessType: v.provider, reasoningEffort: null });
          sheet.dismiss();
        }}
      />,
      { title: forWorkers ? 'Default worker model' : 'Model', detents: ['large'], scrollable: true, headerAction: { label: 'Inherit', onPress: () => { set(forWorkers ? { defaultWorkerModel: null } : { model: null }); sheet.dismiss(); } } },
    );
  };
  const addMember = (): void => {
    const pool = (all.data ?? []).filter((a) => a.enabled && a.role === 'agent' && !draft.team.includes(a.ref)) as never[];
    sheet.present(
      <AgentPicker
        agents={pool}
        value={null}
        role="agent"
        onValueChange={(ref) => {
          set({ team: [...draft.team, ref] });
          sheet.dismiss();
        }}
      />,
      { title: 'Add a team member', detents: ['large'], scrollable: true },
    );
  };
  const showEffective = (): void =>
    sheet.present(<CapabilitySummary projection={preview.data} loading={preview.isLoading} error={preview.error} unsaved={dirty} />, { title: 'Effective capabilities', detents: ['large'], scrollable: true });

  const byRef = new Map((all.data ?? []).map((a) => [a.ref, a]));
  const addTag = (): void => {
    const t = tagInput.trim();
    if (t && !draft.tags.includes(t)) set({ tags: [...draft.tags, t] });
    setTagInput('');
  };

  return (
    <FullScreenEditor
      title={editing ? 'Edit agent' : 'New agent'}
      primary={{ label: editing ? 'Save' : 'Create', onPress: save, loading: saving, disabled: saving || (editing && count === 0) }}
      onCancel={close}
      dirty={dirty && !saving}
      dirtyCount={editing ? count : undefined}
      navigation={navigation as never}
      testID="agent-editor"
    >
      <Section title="Identity">
        <ListSection>
          <Field {...(touched && errors.name ? { error: errors.name } : {})}>
            <Input label="Name" value={draft.name} onChangeText={(name) => setDraft(withName(draft, name))} testID="agent-editor-name" />
          </Field>
          <Field {...(touched && errors.slug ? { error: errors.slug } : {})}>
            <Input label="Slug" value={draft.slug} onChangeText={(slug) => set({ slug: slug.toLowerCase(), slugTouched: true })} kind="mono" testID="agent-editor-slug" />
          </Field>
          <Field {...(touched && errors.description ? { error: errors.description } : {})}>
            <Textarea label="Description" value={draft.description} onChangeText={(description) => set({ description })} presentation="row" minRows={2} testID="agent-editor-description" />
          </Field>
          {editing ? (
            <ListRow kind="value" title="Scope" value={draft.scope === 'project' ? 'Project' : 'Global'} />
          ) : (
            <ListRow
              kind="picker"
              title="Scope"
              picker={{
                value: draft.scope,
                options: [
                  { value: 'global', label: 'Global' },
                  { value: 'project', label: 'Project' },
                ],
                onValueChange: (v) => set({ scope: v as 'global' | 'project', projectId: v === 'project' ? draft.projectId : null }),
              }}
            />
          )}
          {draft.scope === 'project' && !editing ? (
            <ListRow
              kind="picker"
              title="Project"
              picker={{ value: draft.projectId, placeholder: 'Choose', options: (projects.data ?? []).map((p) => ({ value: p.id, label: p.name })), onValueChange: (v) => set({ projectId: v }) }}
            />
          ) : null}
          <ListRow kind="toggle" title="Enabled" subtitle="Off hides it from pickers" switchValue={draft.enabled} onValueChange={(enabled) => set({ enabled })} testID="agent-editor-enabled" />
        </ListSection>
        <View className="gap-2 px-4">
          <View className="flex-row flex-wrap gap-2">
            {draft.tags.map((t) => (
              <Chip key={t} variant="input" label={t} onRemove={() => set({ tags: draft.tags.filter((x) => x !== t) })} />
            ))}
          </View>
          <Input label="Add tag" value={tagInput} onChangeText={setTagInput} placeholder="debugging" presentation="standalone" returnKeyType="done" onSubmitEditing={addTag} testID="agent-editor-tag" />
        </View>
      </Section>

      <Section title="Instructions" hint="added to every turn">
        <View className="gap-3 px-4">
          <Field {...(touched && errors.instructions ? { error: errors.instructions } : level === 'warn' ? { help: 'Long instructions cost context on every turn (warns above 8 KB).' } : {})}>
            <Textarea
              label="Instructions"
              value={draft.instructions}
              onChangeText={(instructions) => set({ instructions })}
              mono
              minRows={6}
              maxRows={16}
              meter={{ used: instructionsBytes(draft.instructions), max: AGENT_INSTRUCTIONS_MAX_BYTES, unit: 'bytes' }}
              {...(level === 'error' ? { error: 'Over the 32 KB limit' } : {})}
              testID="agent-editor-instructions"
            />
          </Field>
          <ListSection>
            <ListRow
              kind="segmented"
              title="Built-in prompt"
              subtitle="Add is recommended"
              segmented={{
                value: draft.projection,
                onValueChange: (v) => set({ projection: v as 'append' | 'replace' }),
                segments: [
                  { value: 'append', label: 'Add to default' },
                  { value: 'replace', label: 'Replace default' },
                ],
              }}
            />
          </ListSection>
        </View>
      </Section>

      <Section title="Role">
        <View className="gap-2 px-4">
          <SegmentedControl<'agent' | 'orchestrator'>
            accessibilityLabel="Role"
            value={draft.role}
            onValueChange={(role) => set({ role, tools: role === 'orchestrator' ? { ...draft.tools, orchestration: true } : draft.tools })}
            segments={[
              { value: 'agent', label: 'Worker', icon: 'agents' },
              { value: 'orchestrator', label: 'Orchestrator', icon: 'users' },
            ]}
            fullWidth
            testID="agent-editor-role"
          />
          <Text role="footnote" tone="fg-3">
            Orchestrators plan and delegate to a team of workers.
          </Text>
        </View>
      </Section>

      <Section title="Runtime" hint="Inherit takes the value from the chat, stage or server default.">
        <ListSection>
          <ListRow
            kind="picker"
            title="Provider"
            picker={{
              value: draft.harnessType ?? 'inherit',
              options: [{ value: 'inherit', label: 'Inherit' }, ...(catalog?.providers ?? []).map((p) => ({ value: p.type, label: p.label, ...(p.availability !== 'ready' ? { description: 'Not signed in' } : {}) }))],
              onValueChange: (v) => set({ harnessType: v === 'inherit' ? null : v, model: null, reasoningEffort: null }),
            }}
            testID="agent-editor-provider"
          />
          <ListRow kind="navigation" title="Model" value={model?.name ?? draft.model ?? 'Inherit'} {...(draft.model ? { subtitle: draft.model } : {})} disabled={!catalog} onPress={() => pickModel(false)} testID="agent-editor-model" />
          {efforts.length <= 4 ? (
            <ListRow
              kind="segmented"
              title="Reasoning effort"
              segmented={{
                value: draft.reasoningEffort ?? 'inherit',
                onValueChange: (v) => set({ reasoningEffort: v === 'inherit' ? null : v }),
                segments: [{ value: 'inherit', label: 'Inherit' }, ...efforts.map((e) => ({ value: e, label: EFFORT_LABEL[e] ?? e }))],
              }}
            />
          ) : (
            <ListRow
              kind="picker"
              title="Reasoning effort"
              picker={{ value: draft.reasoningEffort ?? 'inherit', options: [{ value: 'inherit', label: 'Inherit' }, ...efforts.map((e) => ({ value: e, label: EFFORT_LABEL[e] ?? e }))], onValueChange: (v) => set({ reasoningEffort: v === 'inherit' ? null : v }) }}
            />
          )}
          <ListRow
            kind="segmented"
            title="Context tier"
            segmented={{
              value: draft.contextTier ?? 'inherit',
              onValueChange: (v) => set({ contextTier: v === 'inherit' ? null : (v as 'default' | 'long_context') }),
              segments: [
                { value: 'inherit', label: 'Inherit' },
                { value: 'default', label: 'Default' },
                ...(model && !model.longContextTokens ? [] : [{ value: 'long_context', label: 'Long context' }]),
              ],
            }}
          />
          <ListRow
            kind="stepper"
            title="Max turns"
            subtitle="0 inherits"
            stepper={{ value: draft.maxTurns ?? 0, onValueChange: (v) => set({ maxTurns: v > 0 ? v : null }), min: 0, max: 1000, step: 5, format: (v) => (v > 0 ? String(v) : 'Inherit') }}
          />
        </ListSection>
      </Section>

      <Section title="Team" hint="orchestrators only">
        {draft.role !== 'orchestrator' ? (
          <ListSection>
            <ListRow kind="info" icon="users" title={`${draft.name || 'This agent'} is a Worker.`} subtitle="Set Role to Orchestrator to choose its team." />
          </ListSection>
        ) : (
          <ListSection>
            {draft.team.length === 0 ? <ListRow kind="info" icon="users" title="Team members" value="Any enabled agent" /> : null}
            {draft.team.map((ref) => {
              const member = byRef.get(ref);
              return (
                <ListRow
                  key={ref}
                  kind="info"
                  icon="agents"
                  title={member?.name ?? ref}
                  subtitle={member ? [ROLE_LABEL[member.role], member.runtime?.model].filter(Boolean).join(' · ') : 'Not on this server'}
                  badge={<Button label="Remove" size="sm" variant="ghost" onPress={() => set({ team: draft.team.filter((r) => r !== ref) })} accessibilityLabel={`Remove ${member?.name ?? ref}`} />}
                />
              );
            })}
            <ListRow kind="link" icon="plus" title="Add team member" onPress={addMember} testID="agent-editor-add-member" />
            <ListRow kind="stepper" title="Max concurrent workers" stepper={{ value: draft.maxWorkers ?? 0, onValueChange: (v) => set({ maxWorkers: v > 0 ? v : null }), min: 0, max: 32, format: (v) => (v > 0 ? String(v) : 'Server default') }} />
            <ListRow kind="navigation" title="Default worker model" value={draft.defaultWorkerModel ?? 'Inherit'} disabled={!catalog} onPress={() => pickModel(true)} />
          </ListSection>
        )}
      </Section>

      <Section title="Skills" hint={`${draft.skillIds.length} of ${catalogs.skills.length} · staged into the workspace at run time`}>
        <ChipGroup
          accessibilityLabel="Skills"
          selection="multi"
          layout="wrap"
          value={draft.skillIds}
          onValueChange={(v) => set({ skillIds: v as string[] })}
          items={catalogs.skills.map((s) => ({ id: s.id, label: s.name }))}
          testID="agent-editor-skills"
        />
      </Section>

      <Section title="MCP servers" hint={`${draft.mcpServerIds.length} of ${catalogs.mcp.length} · vetted registry entries only`}>
        <ChipGroup
          accessibilityLabel="MCP servers"
          selection="multi"
          layout="wrap"
          value={draft.mcpServerIds}
          onValueChange={(v) => set({ mcpServerIds: v as string[] })}
          items={catalogs.mcp.map((m) => ({ id: m.id, label: m.needsKey ? `${m.name} · needs key` : m.name }))}
          testID="agent-editor-mcp"
        />
      </Section>

      <Section title="Capabilities" hint="On or Off beats the chat or stage">
        <ListSection>
          {CAPABILITIES.map((c) => {
            const value = triOf(draft.tools, c.key);
            const was = seeded ? triOf(seeded.tools, c.key) : value;
            const locked = c.key === 'orchestration' && draft.role === 'orchestrator';
            return (
              <ListRow
                key={c.key}
                kind="segmented"
                title={c.label}
                {...(locked ? { subtitle: 'Always on for an orchestrator' } : {})}
                {...(editing && value !== was ? { provenance: <Chip variant="filter" label="Changed" icon="undo" onPress={() => set({ tools: withTri(draft.tools, c.key, was) })} /> } : {})}
                disabled={locked}
                segmented={{
                  value: locked ? 'on' : value,
                  onValueChange: (v) => set({ tools: withTri(draft.tools, c.key, v as TriState) }),
                  segments: [
                    { value: 'inherit', label: 'Inherit' },
                    { value: 'on', label: 'On' },
                    { value: 'off', label: 'Off' },
                  ],
                }}
                testID={`agent-editor-cap-${c.key}`}
              />
            );
          })}
        </ListSection>
      </Section>

      <CapabilitySummaryRow projection={preview.data} onPress={showEffective} />
      {draft.harnessType ? (
        <Text role="footnote" tone="fg-3" className="px-4">
          {`Runs on ${harnessLabel(draft.harnessType)}.`}
        </Text>
      ) : null}
    </FullScreenEditor>
  );
}
