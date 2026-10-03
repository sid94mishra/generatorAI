// New workflow (MWorkflowNew, MWorkflowNewBasics; `/workflows/new`, full-screen modal; M8-01): "New workflows start as
// a draft." Start point — Blank canvas · From a template · Import JSON (`?start=import` from the list's Import JSON);
// templates: search, category chips (MG-30), the list (kinds, stages) and a preview of the selected one (stages with
// their keys, the inputs); Import: the pasted document, validated by the spec on the phone (the server validates
// again); Basics — name, description, project, the project's codebases by alias (≤ 5), the default session (Model,
// Agent, Effort, Permission; stages inherit it). The header's text "Create" (MD-85) makes the draft and opens it.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { PERMISSION_MODES, REASONING_EFFORTS } from '@generatorai/workflow-spec';

import { WORKFLOWS_HREF, builderHref, workflowHref } from '../../blocks/shell/hrefs';
import { useModelPickerCatalog } from '../../blocks/TurnSheet';
import { FullScreenEditor } from '../../ui/layout/FullScreenEditor';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { errorText } from '../../ui/lib/format';
import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Card } from '../../ui/primitives/Card';
import { ChipGroup } from '../../ui/primitives/ChipGroup';
import { ChoiceCard } from '../../ui/primitives/ChoiceCard';
import { Field } from '../../ui/primitives/Field';
import { Icon } from '../../ui/primitives/Icon';
import { Input } from '../../ui/primitives/Input';
import { RadioGroup } from '../../ui/primitives/RadioGroup';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { toast } from '../../ui/primitives/Toast';
import {
  TEMPLATE_CATEGORY_LABEL,
  checkImport,
  createBlocker,
  draftGraph,
  filterTemplates,
  templateCategories,
  templateViews,
  type DraftBasics,
  type StartPoint,
} from './model/newWorkflowModel';
import { PERMISSION_WORD } from './model/workflowsModel';
import { useProjectCodebases, useProjectsList, useSelectableAgents, useTemplates, useWorkflowWrites, useWorkflows } from './queries';

type Href = Parameters<typeof router.replace>[0];
const MAX_CODEBASES = 5;
const DEFAULT = '';

export default function NewWorkflowScreen(): React.ReactElement {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ start?: string }>();
  const [start, setStart] = useState<StartPoint>(params.start === 'import' ? 'import' : params.start === 'blank' ? 'blank' : 'template');
  const templates = useTemplates(start === 'template');
  const views = useMemo(() => templateViews(templates.data ?? []), [templates.data]);
  const categories = useMemo(() => templateCategories(views), [views]);
  const [category, setCategory] = useState<string | null>(null);
  const [templateQuery, setTemplateQuery] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const importCheck = useMemo(() => (importText.trim() ? checkImport(importText) : null), [importText]);
  const workflows = useWorkflows();
  const projects = useProjectsList();
  const catalog = useModelPickerCatalog();
  const [basics, setBasics] = useState<DraftBasics>({ name: '', description: '', projectId: '', codebaseAliases: [], session: {} });
  const [nameTouched, setNameTouched] = useState(false);
  const codebases = useProjectCodebases(basics.projectId || null);
  const agents = useSelectableAgents(basics.projectId || null);
  const writes = useWorkflowWrites();
  const [creating, setCreating] = useState(false);

  const selected = views.find((v) => v.id === templateId) ?? null;
  const shown = filterTemplates(views, category, templateQuery);
  const taken = useMemo(() => new Set((workflows.data ?? []).filter((w) => !w.archivedAt).map((w) => w.name.trim().toLowerCase())), [workflows.data]);
  const blocker = createBlocker(start, basics, { templateId, importCheck, takenNames: taken });
  const dirty = basics.name.trim().length > 0 || basics.description.trim().length > 0 || importText.trim().length > 0 || templateId !== null;
  const set = (patch: Partial<DraftBasics>): void => setBasics((b) => ({ ...b, ...patch }));
  const setSession = (patch: DraftBasics['session']): void => setBasics((b) => ({ ...b, session: { ...b.session, ...patch } }));

  const pickTemplate = (id: string): void => {
    setTemplateId(id);
    const v = views.find((x) => x.id === id);
    // The template's name and description fill the basics until the author types their own.
    if (v && !nameTouched) set({ name: v.name, description: v.description ?? '' });
  };
  const onImportText = (text: string): void => {
    setImportText(text);
    const summary = text.trim() ? checkImport(text).summary : null;
    if (summary && !nameTouched) set({ name: summary.name, description: summary.description });
  };

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(WORKFLOWS_HREF as Href);
  };
  const submit = (): void => {
    setNameTouched(true);
    if (blocker) return;
    const graph = draftGraph(start, basics, { ...(selected ? { template: selected.template } : {}), ...(importCheck ? { imported: importCheck.document } : {}) });
    setCreating(true);
    (start === 'import' ? writes.importDocument(graph) : writes.create(graph))
      .then((record) => {
        haptic('success');
        // The new workflow's page, with the builder over it (M8-05): closing the builder lands on the workflow.
        router.replace(workflowHref(record.id) as Href);
        router.push(builderHref(record.id) as Href);
      })
      .catch((e: unknown) => {
        setCreating(false);
        toast({ kind: 'error', message: errorText(e) });
      });
  };

  const modelOptions = [{ value: DEFAULT, label: 'Server default' }, ...(catalog.catalog?.models ?? []).map((m) => ({ value: m.id, label: m.name, description: m.provider }))];
  const agentOptions = [{ value: DEFAULT, label: 'None', description: 'optional' }, ...(agents.data ?? []).map((a) => ({ value: (a as { ref?: string }).ref ?? a.id, label: a.name }))];
  const source = start === 'template' && selected ? ` from ${selected.name}` : start === 'import' ? ' from JSON' : '';

  return (
    <FullScreenEditor
      title="New workflow"
      primary={{ label: 'Create', onPress: submit, loading: creating, disabled: creating || Boolean(blocker) }}
      onCancel={close}
      dirty={dirty && !creating}
      navigation={navigation as never}
      testID="workflow-new"
    >
      <View className="gap-3 px-4">
        <Text role="footnote" tone="fg-2">
          New workflows start as a draft.
        </Text>
        <RadioGroup value={start} onValueChange={(v) => setStart(v as StartPoint)} accessibilityLabel="Start from" testID="workflow-new-start">
          <View className="gap-2">
            <ChoiceCard value="blank" selected={start === 'blank'} title="Blank canvas" description="Add stages yourself." icon="plus" onPress={() => setStart('blank')} testID="workflow-new-blank" />
            <ChoiceCard value="template" selected={start === 'template'} title="From a template" description={templates.data ? `${views.length} templates, plain graphs you can edit.` : 'Plain graphs you can edit.'} icon="layout" onPress={() => setStart('template')} testID="workflow-new-template" />
            <ChoiceCard value="import" selected={start === 'import'} title="Import JSON" description="A WorkflowGraph document, validated first." icon="download" onPress={() => setStart('import')} testID="workflow-new-import" />
          </View>
        </RadioGroup>
      </View>

      {start === 'template' ? (
        <View className="gap-3">
          <View className="gap-3 px-4">
            <SearchInput value={templateQuery} onChangeText={setTemplateQuery} placeholder="Search templates" size="compact" testID="workflow-new-template-search" />
            {categories.length > 1 ? (
              <ChipGroup
                accessibilityLabel="Template category"
                selection="single"
                value={category ?? 'all'}
                onValueChange={(v) => setCategory(v === 'all' ? null : (v as string))}
                items={[{ id: 'all', label: 'All', count: views.length }, ...categories.map((c) => ({ id: c, label: TEMPLATE_CATEGORY_LABEL[c], count: views.filter((v) => v.category === c).length }))]}
                testID="workflow-new-categories"
              />
            ) : null}
          </View>
          {templates.isLoading ? (
            <View className="px-4">
              <Skeleton preset="list" count={4} />
            </View>
          ) : templates.isError ? (
            <View className="px-4">
              <Callout tone="err" title="Couldn't load the templates" body={errorText(templates.error)} action={{ label: 'Retry', onPress: () => void templates.refetch() }} />
            </View>
          ) : (
            <ListSection title="Templates" count={shown.length}>
              {shown.length === 0 ? <ListRow kind="info" icon="search" title="No templates match" /> : null}
              {shown.map((t) => (
                <ListRow
                  key={t.id}
                  kind="radio"
                  title={t.name}
                  subtitle={[...t.kinds, `${t.stageCount} stage${t.stageCount === 1 ? '' : 's'}`, t.description].filter(Boolean).join(' · ')}
                  selected={t.id === templateId}
                  onPress={() => pickTemplate(t.id)}
                  testID={`template-${t.id}`}
                />
              ))}
            </ListSection>
          )}
          {selected ? (
            <View className="px-4">
              <Card outlined testID="workflow-new-preview">
                <View className="gap-2">
                  {selected.stages.map((s) => (
                    <View key={s.key} className="gap-1">
                      <View className="flex-row flex-wrap items-center gap-1.5">
                        <Icon concept={s.kind === 'loop' ? 'repeat' : s.kind === 'map' ? 'layers' : s.kind === 'check' ? 'check' : 'agents'} size={14} tone="fg-3" />
                        <Text role="subhead" weight={600}>
                          {s.name}
                        </Text>
                        <Text role="monoSm" tone="fg-3">
                          {s.key}
                        </Text>
                      </View>
                      {s.body.length ? (
                        <Text role="footnote" tone="fg-2" className="ps-5">
                          {s.body.map((b) => b.name).join(' → ')}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                  {selected.variables.length ? (
                    <View className="flex-row flex-wrap items-center gap-1.5">
                      <Icon concept="variable" size={14} tone="fg-3" />
                      <Text role="footnote" tone="fg-3">
                        Inputs
                      </Text>
                      <Text role="monoSm" tone="fg-2">
                        {selected.variables.join(' · ')}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Card>
            </View>
          ) : null}
        </View>
      ) : null}

      {start === 'import' ? (
        <View className="gap-3 px-4">
          <Textarea label="Workflow JSON" value={importText} onChangeText={onImportText} mono minRows={6} maxRows={14} placeholder='{"formatVersion": 2, "workflow": {…}, "stages": [], "edges": []}' testID="workflow-new-json" />
          <Button label="Paste from clipboard" icon="copy" size="sm" onPress={() => void Clipboard.getStringAsync().then(onImportText)} testID="workflow-new-paste" />
          {importCheck && !importCheck.document ? <Callout tone="err" title="That isn't JSON" body={importCheck.errors[0]?.message ?? 'Paste a WorkflowGraph document.'} /> : null}
          {importCheck?.document && importCheck.errors.length ? (
            <Callout
              tone="err"
              title={`${importCheck.errors.length} problem${importCheck.errors.length === 1 ? '' : 's'} in the document`}
              body={importCheck.errors
                .slice(0, 5)
                .map((i) => `${i.path || '/'} — ${i.message}`)
                .join('\n')}
            />
          ) : null}
          {importCheck?.document && !importCheck.errors.length && importCheck.summary ? (
            <Callout tone="ok" title="Valid workflow document" body={`${importCheck.summary.stages} stage${importCheck.summary.stages === 1 ? '' : 's'}${importCheck.warnings.length ? ` · ${importCheck.warnings.length} warning${importCheck.warnings.length === 1 ? '' : 's'}` : ''}`} />
          ) : null}
        </View>
      ) : null}

      <ListSection title="Basics">
        <Field {...(nameTouched && blocker && /name/i.test(blocker) ? { error: blocker } : {})}>
          <Input
            label="Name"
            value={basics.name}
            onChangeText={(name) => {
              setNameTouched(true);
              set({ name });
            }}
            placeholder="Issue fix with review"
            maxLength={200}
            testID="workflow-new-name"
          />
        </Field>
        <Textarea label="Description (optional)" value={basics.description} onChangeText={(description) => set({ description })} presentation="row" minRows={2} testID="workflow-new-description" />
        <ListRow
          kind="picker"
          title="Project"
          icon="projects"
          picker={{ value: basics.projectId, options: [{ value: DEFAULT, label: 'No project' }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))], onValueChange: (projectId) => set({ projectId, codebaseAliases: [] }), testID: 'workflow-new-project' }}
        />
      </ListSection>

      {basics.projectId ? (
        <ListSection title="Codebases" {...(codebases.data?.length ? { count: codebases.data.length } : {})} footer={`By alias, up to ${MAX_CODEBASES}. Runs mount them as run.codebases.<alias>.`}>
          {codebases.isLoading ? <ListRow kind="info" title="Loading codebases…" /> : null}
          {!codebases.isLoading && !(codebases.data ?? []).length ? <ListRow kind="info" icon="branch" title="This project has no codebases" /> : null}
          {(codebases.data ?? []).map((c) => {
            const on = basics.codebaseAliases.includes(c.alias);
            const full = !on && basics.codebaseAliases.length >= MAX_CODEBASES;
            return (
              <ListRow
                key={c.id}
                kind="check"
                title={c.alias}
                mono
                subtitle={c.url ?? c.localPath ?? undefined}
                selected={on}
                disabled={full}
                {...(full ? { disabledReason: `Up to ${MAX_CODEBASES} codebases` } : {})}
                badge={c.status === 'ready' ? <Badge label="Ready" size="sm" /> : <Badge label={String(c.status)} tone="outline" size="sm" />}
                onValueChange={(v) => set({ codebaseAliases: v ? [...basics.codebaseAliases, c.alias] : basics.codebaseAliases.filter((a) => a !== c.alias) })}
                testID={`workflow-new-codebase-${c.alias}`}
              />
            );
          })}
        </ListSection>
      ) : null}

      <ListSection title="Default session" footer="Stages inherit it unless they set their own.">
        <ListRow kind="picker" title="Agent" icon="agents" picker={{ value: basics.session.agentRef ?? DEFAULT, options: agentOptions, onValueChange: (agentRef) => setSession({ agentRef: agentRef || undefined }), searchable: agentOptions.length > 12, testID: 'workflow-new-agent' }} />
        <ListRow kind="picker" title="Model" icon="model" picker={{ value: basics.session.model ?? DEFAULT, options: modelOptions, onValueChange: (model) => setSession({ model: model || undefined }), searchable: modelOptions.length > 12, testID: 'workflow-new-model' }} />
        <ListRow kind="picker" title="Effort" icon="think" picker={{ value: basics.session.reasoningEffort ?? DEFAULT, options: [{ value: DEFAULT, label: 'Default' }, ...REASONING_EFFORTS.map((e) => ({ value: e, label: e.charAt(0).toUpperCase() + e.slice(1) }))], onValueChange: (reasoningEffort) => setSession({ reasoningEffort: reasoningEffort || undefined }), testID: 'workflow-new-effort' }} />
        <ListRow
          kind="picker"
          title="Permission"
          icon="shield"
          picker={{ value: basics.session.permissionMode ?? DEFAULT, options: [{ value: DEFAULT, label: 'Default', description: "when a run doesn't pick one" }, ...PERMISSION_MODES.map((m) => ({ value: m, label: PERMISSION_WORD[m] ?? m }))], onValueChange: (permissionMode) => setSession({ permissionMode: permissionMode || undefined }), testID: 'workflow-new-permission' }}
        />
      </ListSection>

      <View className="flex-row items-center gap-2 px-4 pb-6">
        <Badge label="Draft" icon="edit" size="sm" />
        <Text role="footnote" tone="fg-2" numberOfLines={1} className="shrink">
          {`${basics.name.trim() || 'Untitled'}${source}`}
        </Text>
      </View>
      {blocker && dirty ? (
        <Text role="footnote" tone="fg-3" className="px-4 pb-6">
          {blocker}
        </Text>
      ) : null}
    </FullScreenEditor>
  );
}
