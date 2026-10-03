// Workflow settings (`/workflows/[id]/edit/settings?tab=`; MWorkflowSettings; MDF-89; M8-07): pushed inside the
// builder modal. Without `tab`, the sections as a grouped list (General, Project, Variables, Hooks, Tags, Budget)
// that push their pages, like iOS Settings; with it, that section. "Saved with the workflow draft": every change
// joins the builder draft (typing in one field is one undo step); the builder's Save commits. Variables: the list,
// one editor at a time (name with the reserved-name error, type chips, label, description, required, a default
// editor per type, Delete). Complex parts (pre/post-processing steps, hook bodies, exit actions, outputs) say
// "Edit on desktop" (MD-04).
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { VARIABLE_TYPES, PERMISSION_MODES, type Budget, type Lifecycle, type PermissionMode, type VariableDefinition, type VariableType, type WorkflowGraph, type WorkflowSpec } from '@generatorai/workflow-spec';

import { useModelPickerCatalog } from '../../../blocks/TurnSheet';
import { WORKFLOWS_HREF, builderHref, workflowHref, workflowSettingsHref } from '../../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../../blocks/shell/useHeaderNav';
import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { Screen } from '../../../ui/layout/Screen';
import { confirm } from '../../../ui/native/AlertDialog';
import { Header } from '../../../ui/native/router/Header';
import { Button } from '../../../ui/primitives/Button';
import { Chip } from '../../../ui/primitives/Chip';
import { ChipGroup } from '../../../ui/primitives/ChipGroup';
import { Field } from '../../../ui/primitives/Field';
import { Input } from '../../../ui/primitives/Input';
import { Switch } from '../../../ui/native/Switch';
import { Text } from '../../../ui/primitives/Text';
import { Textarea } from '../../../ui/primitives/Textarea';
import { useBuilderStore } from '../builder/builderStore';
import { useBuilderDraft } from '../builder/useBuilderDraft';
import { useProjectCodebases, useProjectsList, useSelectableAgents } from '../queries';
import { DesktopOnlyRow, DurationInput, OptionalNumberInput } from '../stageEditor/fields';
import { phaseLabel } from '../stageEditor/HooksTab';
import { RESERVED_LINE, SECTION_LABEL, SETTINGS_SECTIONS, TYPE_LABEL, defaultPreview, defaultText, parseDefault, parseSettingsSection, retype, variableNameProblem, variableSummary, type SettingsSection } from './workflowSettingsModel';

type Href = Parameters<typeof router.push>[0];
type EditWorkflow = (patch: Partial<WorkflowSpec>, mergeKey?: string) => void;

const INHERIT = '';
const PERMISSION_LABEL: Record<PermissionMode, string> = { default: 'Ask', acceptEdits: 'Accept edits', plan: 'Plan', bypassPermissions: 'Bypass', dontAsk: "Don't ask" };

function sectionValue(section: SettingsSection, graph: WorkflowGraph): string | undefined {
  const wf = graph.workflow;
  switch (section) {
    case 'general':
      return wf.name;
    case 'project':
      return wf.projectId ? `${wf.lifecycle.codebaseAliases.length} codebase${wf.lifecycle.codebaseAliases.length === 1 ? '' : 's'}` : 'Global';
    case 'variables':
      return wf.variables.length ? String(wf.variables.length) : 'None';
    case 'hooks':
      return wf.hooks.length ? String(wf.hooks.length) : 'None';
    case 'tags':
      return wf.tags.length ? wf.tags.join(', ') : 'None';
    case 'budget':
      return wf.budget ? 'Set' : 'No limit';
  }
}

function General({ graph, edit }: { graph: WorkflowGraph; edit: EditWorkflow }): React.ReactElement {
  const wf = graph.workflow;
  const agents = useSelectableAgents(wf.projectId ?? null);
  const catalog = useModelPickerCatalog();
  const models = catalog.catalog?.models ?? [];
  const setSession = (patch: Partial<WorkflowSpec['session']>): void => {
    const next = { ...wf.session, ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
    edit({ session: next });
  };
  return (
    <View className="gap-6">
      <ListSection>
        <Input label="Name" value={wf.name} onChangeText={(name) => edit({ name }, 'name')} maxLength={200} testID="workflow-settings-name" />
        <Textarea label="Description" value={wf.description ?? ''} onChangeText={(d) => edit({ description: d || undefined }, 'description')} presentation="row" minRows={2} />
      </ListSection>
      <ListSection title="Default session" footer="Stages inherit it unless they set their own.">
        <ListRow kind="picker" title="Agent" icon="agents" picker={{ value: wf.session.agentRef ?? INHERIT, options: [{ value: INHERIT, label: 'None' }, ...(agents.data ?? []).map((a) => ({ value: (a as { ref?: string }).ref ?? a.id, label: a.name }))], onValueChange: (agentRef) => setSession({ agentRef: agentRef || undefined }), searchable: (agents.data?.length ?? 0) > 12 }} />
        <ListRow kind="picker" title="Model" icon="model" picker={{ value: wf.session.model ?? INHERIT, options: [{ value: INHERIT, label: 'Server default' }, ...models.map((m) => ({ value: m.id, label: m.name, description: m.provider }))], onValueChange: (model) => setSession({ model: model || undefined }), searchable: models.length > 12 }} />
        <ListRow kind="picker" title="Permission" icon="shield" picker={{ value: wf.session.permissionMode ?? INHERIT, options: [{ value: INHERIT, label: 'Server default' }, ...PERMISSION_MODES.map((m) => ({ value: m, label: PERMISSION_LABEL[m] }))], onValueChange: (m) => setSession({ permissionMode: (m || undefined) as PermissionMode | undefined }) }} />
      </ListSection>
      <ListSection>
        <ListRow kind="stepper" title="Stages at once" stepper={{ value: wf.maxParallel ?? 0, onValueChange: (n) => edit({ maxParallel: n > 0 ? n : undefined }), min: 0, max: 32, format: (v) => (v ? String(v) : 'Default (4)') }} />
      </ListSection>
    </View>
  );
}

function Project({ graph, edit }: { graph: WorkflowGraph; edit: EditWorkflow }): React.ReactElement {
  const wf = graph.workflow;
  const projects = useProjectsList();
  const codebases = useProjectCodebases(wf.projectId ?? null);
  const lc = wf.lifecycle;
  const setLifecycle = (patch: Partial<Lifecycle>): void => edit({ lifecycle: { ...lc, ...patch } });
  const post = lc.postProcessing;
  const setPost = (patch: Partial<Lifecycle['postProcessing']>): void => setLifecycle({ postProcessing: { ...post, ...patch } });
  const aliases = (codebases.data ?? []).map((c) => c.alias);
  return (
    <View className="gap-6">
      <ListSection footer="Changing the project clears the codebases.">
        <ListRow kind="picker" title="Project" icon="projects" picker={{ value: wf.projectId ?? INHERIT, options: [{ value: INHERIT, label: 'Global' }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))], onValueChange: (p) => edit({ projectId: p || null, lifecycle: { ...lc, codebaseAliases: [] } }) }} />
      </ListSection>
      {wf.projectId ? (
        <ListSection title="Codebases" footer="Mounted for every run; at most five.">
          {aliases.length === 0 ? <ListRow kind="info" title={codebases.isLoading ? 'Loading…' : 'This project has no codebases'} /> : null}
          {aliases.map((a) => {
            const on = lc.codebaseAliases.includes(a);
            return <ListRow key={a} kind="check" title={a} mono selected={on} disabled={!on && lc.codebaseAliases.length >= 5} onValueChange={(v) => setLifecycle({ codebaseAliases: v ? [...lc.codebaseAliases, a] : lc.codebaseAliases.filter((x) => x !== a) })} testID={`workflow-settings-codebase-${a}`} />;
          })}
        </ListSection>
      ) : null}
      <ListSection>
        <ListRow kind="toggle" title="Worktree per run" subtitle="Isolated worktrees rather than in place" switchValue={lc.useWorktree} onValueChange={(useWorktree) => setLifecycle({ useWorktree })} />
        <ListRow kind="toggle" title="Requires a codebase" switchValue={lc.requiresCodebase} onValueChange={(requiresCodebase) => setLifecycle({ requiresCodebase })} />
        <ListRow kind="segmented" title="Sandbox" segmented={{ value: lc.sandbox, onValueChange: (s) => setLifecycle({ sandbox: s as Lifecycle['sandbox'] }), segments: [{ value: 'required', label: 'Required' }, { value: 'optional', label: 'Optional' }] }} />
      </ListSection>
      <ListSection title="After the stages">
        <ListRow kind="toggle" title="Commit" switchValue={post.autoCommit} onValueChange={(autoCommit) => setPost({ autoCommit })} />
        <ListRow kind="toggle" title="Push" switchValue={post.autoPush} onValueChange={(autoPush) => setPost({ autoPush })} />
        <ListRow kind="toggle" title="Open a pull request" switchValue={post.autoCreatePR} onValueChange={(autoCreatePR) => setPost({ autoCreatePR })} />
        <DesktopOnlyRow title="Steps" subtitle={`${lc.preprocessingSteps.length} before · ${post.steps.length} after`} />
      </ListSection>
    </View>
  );
}

function VariableEditor({ initial, taken, onDone, onCancel, onDelete }: { initial: VariableDefinition | null; taken: string[]; onDone: (v: VariableDefinition) => void; onCancel: () => void; onDelete?: () => void }): React.ReactElement {
  const [v, setV] = useState<VariableDefinition>(initial ?? { name: '', type: 'string', label: '', required: false });
  const [text, setText] = useState(initial ? defaultText(initial) : '');
  const [optionsText, setOptionsText] = useState((initial?.options ?? []).join(', '));
  const nameProblem = variableNameProblem(v.name, taken);
  const options = optionsText.split(',').map((o) => o.trim()).filter(Boolean);
  const parsed = v.type === 'boolean' ? {} : parseDefault(v.type, text, options);
  const done = (): void => {
    if (nameProblem || parsed.error) return;
    const next: VariableDefinition = { ...v, label: v.label.trim() || v.name, ...(v.type === 'choice' ? { options } : {}) };
    if (v.type !== 'boolean') {
      if (parsed.value === undefined) delete next.defaultValue;
      else next.defaultValue = parsed.value;
    }
    if (!next.description) delete next.description;
    onDone(next);
  };
  return (
    <View className="gap-3 px-4 py-3" testID="variable-editor">
      <View className="flex-row items-center gap-2">
        <Text role="body" weight={600} className="flex-1">
          {initial ? initial.name : 'New variable'}
        </Text>
        <Button label="Cancel" variant="ghost" size="sm" onPress={onCancel} />
        <Button label={initial ? 'Done' : 'Add'} size="sm" onPress={done} disabled={Boolean(nameProblem || parsed.error)} testID="variable-editor-done" />
      </View>
      <Field {...(nameProblem && v.name ? { error: nameProblem } : {})} {...(initial && v.name !== initial.name ? { help: 'References to the old name are not renamed.' } : {})}>
        <Input label="Name" value={v.name} onChangeText={(name) => setV({ ...v, name: name.replace(/\s/g, '_') })} kind="mono" presentation="standalone" autoComplete="off" maxLength={64} {...(nameProblem && v.name ? { error: nameProblem } : {})} testID="variable-name" />
      </Field>
      <Text role="footnote" tone="fg-3">
        Type
      </Text>
      <ChipGroup
        accessibilityLabel="Type"
        selection="single"
        layout="wrap"
        items={VARIABLE_TYPES.map((t) => ({ id: t, label: TYPE_LABEL[t] }))}
        value={v.type}
        onValueChange={(t) => {
          const next = retype({ ...v, ...(parsed.value !== undefined ? { defaultValue: parsed.value } : {}) }, t as VariableType);
          setV(next);
          setText(defaultText(next));
        }}
        testID="variable-type"
      />
      <Input label="Label" value={v.label} onChangeText={(label) => setV({ ...v, label })} presentation="standalone" placeholder={v.name || 'Shown in the run form'} maxLength={200} />
      <Input label="Description (optional)" value={v.description ?? ''} onChangeText={(description) => setV({ ...v, description })} presentation="standalone" maxLength={2000} />
      {v.type === 'choice' ? <Input label="Options (comma separated)" value={optionsText} onChangeText={setOptionsText} presentation="standalone" /> : null}
      {v.type === 'boolean' ? (
        <View className="flex-row items-center gap-3">
          <Text role="body" className="flex-1">
            Default
          </Text>
          <Switch value={v.defaultValue === true} onValueChange={(on) => setV({ ...v, defaultValue: on })} label="Default" />
        </View>
      ) : (
        <Field {...(parsed.error ? { error: parsed.error } : { help: v.type === 'list' ? 'One item per line' : 'Empty: no default' })}>
          {v.type === 'text' || v.type === 'list' || v.type === 'json' ? (
            <Textarea label="Default" value={text} onChangeText={setText} mono={v.type === 'json'} minRows={2} {...(parsed.error ? { error: parsed.error } : {})} />
          ) : (
            <Input label="Default" value={text} onChangeText={setText} kind={v.type === 'number' ? 'number' : 'text'} presentation="standalone" {...(parsed.error ? { error: parsed.error } : {})} testID="variable-default" />
          )}
        </Field>
      )}
      <View className="flex-row items-center gap-3">
        <Text role="body" className="flex-1">
          Required
        </Text>
        <Switch value={v.required} onValueChange={(required) => setV({ ...v, required })} label="Required" />
      </View>
      {onDelete ? <Button label="Delete variable" variant="destructive" icon="trash" onPress={onDelete} testID="variable-delete" /> : null}
    </View>
  );
}

function Variables({ graph, edit }: { graph: WorkflowGraph; edit: EditWorkflow }): React.ReactElement {
  const vars = graph.workflow.variables;
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const names = vars.map((v) => v.name);
  const save = (v: VariableDefinition, at: number | null): void => {
    edit({ variables: at === null ? [...vars, v] : vars.map((x, i) => (i === at ? v : x)) });
    setOpen(null);
  };
  const remove = (i: number): void =>
    void confirm({ title: `Delete ${vars[i]!.name}?`, message: 'Prompts and expressions that read it will fail validation.', confirmLabel: 'Delete', icon: 'trash' }).then((ok) => {
      if (!ok) return;
      edit({ variables: vars.filter((_, j) => j !== i) });
      setOpen(null);
    });
  return (
    <View className="gap-2">
      <ListSection title="Variables" count={vars.length} action={open === null && vars.length < 50 ? { label: 'Add variable', onPress: () => setOpen('new') } : undefined} footer={RESERVED_LINE} testID="workflow-variables">
        {vars.length === 0 && open !== 'new' ? <ListRow kind="info" title="No variables" subtitle="A run asks for each one." /> : null}
        {vars.map((v, i) =>
          open === v.name ? (
            <VariableEditor key={v.name} initial={v} taken={names.filter((n) => n !== v.name)} onDone={(next) => save(next, i)} onCancel={() => setOpen(null)} onDelete={() => remove(i)} />
          ) : (
            <ListRow key={v.name} kind="navigation" title={v.name} mono subtitle={variableSummary(v)} value={defaultPreview(v) ?? undefined} onPress={() => setOpen(v.name)} testID={`workflow-variable-${v.name}`} />
          ),
        )}
        {open === 'new' ? <VariableEditor initial={null} taken={names} onDone={(v) => save(v, null)} onCancel={() => setOpen(null)} /> : null}
      </ListSection>
    </View>
  );
}

function Hooks({ graph, edit }: { graph: WorkflowGraph; edit: EditWorkflow }): React.ReactElement {
  const wf = graph.workflow;
  return (
    <View className="gap-6">
      <ListSection title="Workflow hooks" count={wf.hooks.length} footer="Hook bodies are edited on desktop.">
        {wf.hooks.length === 0 ? <ListRow kind="info" title="No workflow hooks" /> : null}
        {wf.hooks.map((h, i) => (
          <ListRow key={h.id} kind="toggle" title={h.name} subtitle={`${phaseLabel(h.phase)} · ${phaseLabel(h.type)}`} switchValue={h.enabled} onValueChange={(enabled) => edit({ hooks: wf.hooks.map((x, j) => (j === i ? { ...x, enabled } : x)) })} testID={`workflow-hook-${h.id}`} />
        ))}
      </ListSection>
      <ListSection title="When the run ends">
        <DesktopOnlyRow title="On exit" subtitle={`${wf.onExit?.length ?? 0} actions`} />
        <DesktopOnlyRow title="On failure" subtitle={`${wf.onFailure?.length ?? 0} actions`} />
      </ListSection>
    </View>
  );
}

function Tags({ graph, edit }: { graph: WorkflowGraph; edit: EditWorkflow }): React.ReactElement {
  const tags = graph.workflow.tags;
  const [text, setText] = useState('');
  const add = (): void => {
    const t = text.trim().slice(0, 50);
    if (!t || tags.includes(t) || tags.length >= 20) return;
    edit({ tags: [...tags, t] });
    setText('');
  };
  return (
    <ListSection title="Tags" count={tags.length}>
      <View className="flex-row flex-wrap gap-2 px-4 py-3">
        {tags.length === 0 ? (
          <Text role="footnote" tone="fg-3">
            No tags
          </Text>
        ) : null}
        {tags.map((t) => (
          <Chip key={t} variant="input" label={t} onRemove={() => edit({ tags: tags.filter((x) => x !== t) })} />
        ))}
      </View>
      <Input label="New tag" value={text} onChangeText={setText} onSubmitEditing={add} returnKeyType="done" trailing={<Button label="Add" size="sm" onPress={add} disabled={!text.trim()} />} testID="workflow-settings-tag" />
    </ListSection>
  );
}

function BudgetSection({ graph, edit }: { graph: WorkflowGraph; edit: EditWorkflow }): React.ReactElement {
  const b = graph.workflow.budget ?? {};
  const set = (patch: Partial<Budget>): void => {
    const next = { ...b, ...patch };
    for (const k of Object.keys(next) as (keyof Budget)[]) if (next[k] === undefined) delete next[k];
    edit({ budget: Object.keys(next).length ? next : undefined });
  };
  return (
    <ListSection title="Budget" footer="Across the whole run; exhausting one never counts as success.">
      <View className="gap-2 px-4 py-3">
        <View className="flex-row gap-2">
          <View className="flex-1">
            <OptionalNumberInput label="Max turns" value={b.maxTurns} onChange={(n) => set({ maxTurns: n ? Math.floor(n) : undefined })} />
          </View>
          <View className="flex-1">
            <OptionalNumberInput label="Max cost ($)" value={b.maxCostUsd} onChange={(maxCostUsd) => set({ maxCostUsd })} />
          </View>
        </View>
        <View className="flex-row gap-2">
          <View className="flex-1">
            <DurationInput label="Wall clock" value={b.maxWallClockMs} onChange={(maxWallClockMs) => set({ maxWallClockMs })} />
          </View>
          <View className="flex-1">
            <OptionalNumberInput label="Max tokens" value={b.maxTokens} onChange={(n) => set({ maxTokens: n ? Math.floor(n) : undefined })} />
          </View>
        </View>
      </View>
    </ListSection>
  );
}

export default function WorkflowSettingsScreen(): React.ReactElement {
  const { id = '', tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const onBack = useHeaderBack();
  const { draft, query } = useBuilderDraft(id);
  const section = parseSettingsSection(tab);
  const graph = draft?.graph;
  const name = graph?.workflow.name ?? 'Workflow';
  const crumbs = useMemo(
    () => [{ label: 'Workflows', href: WORKFLOWS_HREF }, { label: name, href: workflowHref(id) }, { label: 'Edit workflow', href: builderHref(id) }, ...(section ? [{ label: 'Settings', href: workflowSettingsHref(id) }] : [])],
    [name, id, section],
  );
  const breadcrumb = useBreadcrumb(crumbs);
  const edit: EditWorkflow = (patch, mergeKey) => useBuilderStore.getState().edit(id, (g) => ({ ...g, workflow: { ...g.workflow, ...patch } }), mergeKey);
  const state = query.isError ? { kind: 'error' as const, error: query.error, onRetry: () => void query.refetch(), title: "Couldn't load this workflow" } : !graph ? { kind: 'loading' as const } : { kind: 'ready' as const };

  let body: React.ReactNode = null;
  if (graph) {
    switch (section) {
      case null:
        body = (
          <ListSection>
            {SETTINGS_SECTIONS.map((s) => (
              <ListRow key={s} kind="navigation" title={SECTION_LABEL[s]} value={sectionValue(s, graph)} onPress={() => router.push(workflowSettingsHref(id, s) as Href)} testID={`workflow-settings-${s}`} />
            ))}
          </ListSection>
        );
        break;
      case 'general':
        body = <General graph={graph} edit={edit} />;
        break;
      case 'project':
        body = <Project graph={graph} edit={edit} />;
        break;
      case 'variables':
        body = <Variables graph={graph} edit={edit} />;
        break;
      case 'hooks':
        body = <Hooks graph={graph} edit={edit} />;
        break;
      case 'tags':
        body = <Tags graph={graph} edit={edit} />;
        break;
      case 'budget':
        body = <BudgetSection graph={graph} edit={edit} />;
    }
  }

  return (
    <Screen header={<Header role="detail" title={section ? SECTION_LABEL[section] : 'Workflow settings'} subtitle="Saved with the workflow draft" breadcrumb={breadcrumb} onBack={onBack} />} scroll="scroll" keyboard="form" background="grouped" state={state} testID="workflow-settings">
      <View className="gap-6 pb-8">{body}</View>
    </Screen>
  );
}
