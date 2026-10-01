// ────────────────────────────────────────────────────────────────
// AgentEditorPage (P5-08; T-03 FormWithAside; 04-screen-map.md §2.2
// AgentEditor, §4.6 parity checklist #53) — author or edit a first-class
// agent.
//
// The form mirrors the persisted shape 1:1 and previews the RESOLVED
// projection alongside it (B-27 EffectiveCapabilities), because the union
// algebra (agent ∪ binding additions, minus removals, tri-state tool
// folding) is not legible from the raw inputs. `system`-scope agents are
// read-only: they are synced from `.agent.md` files on disk and would be
// overwritten on next boot.
//
// TanStack Form (D-38) owns field state and dirty-tracking; `agentFormSchema`
// (zod 4) owns validation — kept as a separate pure function rather than a
// form-level validator so the error copy stays exactly what the legacy page
// said (`agentFormSchema.test.ts` is the regression net for both).
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useForm, useStore } from '@tanstack/react-form';
import {
  REASONING_EFFORTS,
  slugifyAgentName,
  type AgentRuntimePolicy,
  type ResolvedAgentProjection,
} from '@generatorai/shared';
import {
  useAgent,
  useCreateAgent,
  useUpdateAgent,
  useExportAgent,
  useResolveAgentPreview,
  useSelectableAgents,
  useAgentCatalog,
} from '@/hooks/agentQueries.js';
import { useProjects } from '@/hooks/projectQueries.js';
import { PROVIDER_LABELS, SCOPE_LABELS, TOOL_GROUP_LABELS, warningText } from '@/lib/agentCopy.js';
import { CapabilityToggleList, ToolPolicyTriState } from '@/blocks/capabilities/CapabilityToggleList.js';
import { EffectiveCapabilities } from '@/blocks/capabilities/EffectiveCapabilities.js';
import { ModelPicker } from '@/blocks/model-picker/ModelPicker.js';
import { AgentGlyph } from '@/ui/primitives/AgentGlyph/AgentGlyph.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { Select, type SelectItem } from '@/ui/primitives/Select/Select.js';
import { SegmentedControl, type SegmentedItem } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { ActionBar } from '@/ui/patterns/ActionBar/ActionBar.js';
import { Breadcrumb } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { FormSection } from '@/ui/patterns/FormSection/FormSection.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { FormWithAside } from '@/ui/templates/FormWithAside/FormWithAside.js';
import { AgentUsedBy } from './AgentUsedBy.js';
import { cn } from '@/ui/lib/cn.js';
import {
  agentFormToParams,
  agentToForm,
  EMPTY_AGENT_FORM,
  effectiveSlug,
  instructionBytes,
  validateAgentForm,
  type AgentFormValues,
} from './agentFormSchema.js';
import { ROLE_LABEL } from './agentListCopy.js';

const AGENT_INSTRUCTIONS_WARN_BYTES = 8 * 1024;
const AGENT_INSTRUCTIONS_MAX_BYTES = 32 * 1024;

const ROLE_ITEMS: readonly SegmentedItem<'agent' | 'orchestrator'>[] = [
  { value: 'agent', label: ROLE_LABEL.agent },
  { value: 'orchestrator', label: ROLE_LABEL.orchestrator },
];

type EffortValue = '' | (typeof REASONING_EFFORTS)[number];
const EFFORT_ITEMS: readonly SegmentedItem<EffortValue>[] = [
  { value: '', label: 'Inherit' },
  ...REASONING_EFFORTS.map((value) => ({
    value,
    label: value === 'xhigh' ? 'Extra high' : value.charAt(0).toUpperCase() + value.slice(1),
  })),
];

type ContextTierValue = '' | 'default' | 'long_context';
const CONTEXT_TIER_ITEMS: readonly SegmentedItem<ContextTierValue>[] = [
  { value: '', label: 'Inherit' },
  { value: 'default', label: '200K' },
  { value: 'long_context', label: '1M' },
];

export function AgentEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';

  const { data: existing, isLoading, error } = useAgent(isNew ? undefined : id);
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const exportAgent = useExportAgent();
  const preview = useResolveAgentPreview();
  const { data: projects } = useProjects();

  const [initialValues] = useState<AgentFormValues>(() => ({
    ...EMPTY_AGENT_FORM,
    projectId: searchParams.get('projectId') ?? '',
    scope: searchParams.get('projectId') ? 'project' : 'global',
  }));
  // Once the author edits the slug by hand, stop deriving it from the name —
  // otherwise renaming a saved agent would silently repoint every binding.
  const [slugTouched, setSlugTouched] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [projectionResult, setProjectionResult] = useState<ResolvedAgentProjection | undefined>();
  const [saveAttempted, setSaveAttempted] = useState(false);

  const form = useForm({
    // Reactive, not a one-off: TanStack Form reconciles `values` against
    // `defaultValues` on every render (FormApi#update) and only WRITES once
    // `isTouched` is false, so once `existing` resolves this applies exactly
    // once, without the risk of a later re-render (any render, since the
    // effect has no dependency array) reverting a value passed to a one-off
    // `form.reset()` back to a *stale* `defaultValues` closure.
    defaultValues: existing ? agentToForm(existing) : initialValues,
    onSubmit: async ({ value }) => {
      const errors = validateAgentForm(value);
      if (errors.length > 0) {
        setSaveAttempted(true);
        return;
      }
      const payload = agentFormToParams(value);
      try {
        if (isNew) {
          const created = await createAgent.mutateAsync({
            ...payload,
            scope: value.scope,
            ...(value.scope === 'project' ? { projectId: value.projectId } : {}),
          });
          for (const w of created.warnings ?? []) toast.info(warningText(w));
          navigate(`/agents/${created.id}`, { replace: true });
        } else {
          const updated = await updateAgent.mutateAsync({ id: id!, params: payload });
          for (const w of updated.warnings ?? []) toast.info(warningText(w));
          // The page stays mounted for an update (no navigation): reset the
          // pristine baseline to what was just saved, so "Unsaved changes"
          // clears instead of reading dirty against the pre-save version.
          form.reset(agentToForm(updated));
        }
      } catch (err) {
        toast.error('Save failed', { description: err instanceof Error ? err.message : String(err) });
      }
    },
  });

  useEffect(() => {
    // The slug input is `disabled={!isNew}` regardless, but this also stops
    // an edited name from re-deriving (and silently repointing) the slug of
    // an already-saved agent, should that guard ever be relaxed.
    if (existing) {
      setSlugTouched(true);
      setSaveAttempted(false);
    }
  }, [existing]);

  const values = useStore(form.store, (s) => s.values);
  const isDirty = useStore(form.store, (s) => s.isDirty);
  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);

  const readOnly = values.scope === 'system';
  const isOrchestrator = values.role === 'orchestrator';
  const slug = effectiveSlug(values);

  const { skills, mcpServers, isLoading: catalogLoading } = useAgentCatalog(
    values.scope === 'project' && values.projectId ? values.projectId : undefined,
  );
  const { data: selectableAgents } = useSelectableAgents(
    values.scope === 'project' && values.projectId ? values.projectId : undefined,
    isOrchestrator,
  );

  // ── Live preview (debounced) ────────────────────────────────
  // Previewed as a DRAFT so an unsaved agent still shows what the harness
  // would receive. The server redacts MCP credentials before responding.
  const previewMutate = preview.mutateAsync;
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewKey = JSON.stringify(values);

  useEffect(() => {
    if (!values.name) {
      setProjectionResult(undefined);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void previewMutate({
        scope: 'chat',
        harnessType: values.runtime.harnessType ?? 'copilot',
        ...(values.scope === 'project' && values.projectId ? { projectId: values.projectId } : {}),
        draft: {
          scope: values.scope,
          slug,
          name: values.name,
          description: values.description,
          instructions: values.instructions,
          role: values.role,
          projection: values.projection,
          skillIds: values.skillIds,
          mcpServerIds: values.mcpServerIds,
          tools: values.tools,
          runtime: values.runtime,
          ...(isOrchestrator ? { orchestration: values.orchestration } : {}),
        },
      })
        .then(setProjectionResult)
        .catch(() => setProjectionResult(undefined));
    }, 400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `previewKey` is the structural identity of the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, previewMutate]);

  const errors = validateAgentForm(values);
  const canSave = errors.length === 0 && !readOnly;
  const showErrors = errors.length > 0 && (saveAttempted || isDirty);

  const handleSave = () => {
    setSaveAttempted(true);
    void form.handleSubmit();
  };

  // Ctrl/Cmd+S is the documented shortcut for the primary action (ActionBar
  // hint); the kit Button `shortcut` prop is decorative only (D-46's command
  // host does not cover page-local forms), so this wires the real key.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 's' || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      handleSave();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, values]);

  const handleExport = async () => {
    if (!id || isNew) return;
    try {
      const markdown = await exportAgent.mutateAsync(id);
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}.agent.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Export failed', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  if (!isNew && isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!isNew && error) {
    return (
      <EmptyState
        tone="error"
        icon="warning"
        title="Couldn't load agent"
        description={error instanceof Error ? error.message : String(error)}
      />
    );
  }

  const providerItems: readonly SelectItem[] = [
    { value: '', label: 'Any provider' },
    ...Object.entries(PROVIDER_LABELS).map(([value, label]) => ({ value, label })),
  ];
  const teamCandidates = (selectableAgents ?? []).filter(
    (a) => a.role === 'agent' && a.enabled && a.ref !== `${values.scope}:${slug}`,
  );
  const bytes = instructionBytes(values.instructions);

  return (
    <FormWithAside
      header={
        <PageHeader
          breadcrumb={
            <Breadcrumb
              currentIsHeading={isNew}
              items={[
                { label: 'Agents', render: <Link to="/agents" /> },
                { label: isNew ? 'New agent' : values.name || 'Agent' },
              ]}
            />
          }
          meta={
            !isNew ? (
              <span className="flex items-center gap-1.5 font-mono text-micro">
                {readOnly ? <Badge>Built-in · read-only</Badge> : null}
                {existing ? <span>v{existing.version}</span> : null}
              </span>
            ) : undefined
          }
          actions={
            !isNew ? (
              <Button variant="secondary" icon="download" onClick={() => void handleExport()}>
                Export
              </Button>
            ) : undefined
          }
        />
      }
      form={
        <>
          {existing && !isNew ? (
            <PageTitle
              variant="detail"
              title={values.name || existing.name}
              meta={[
                `${existing.scope}:${existing.slug}`,
                `v${existing.version}`,
                `updated ${new Date(existing.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
              ]}
            />
          ) : null}
          {showErrors ? (
            <Callout tone="err" data-testid="agent-form-errors">
              <ul className="flex flex-col gap-0.5">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Callout>
          ) : null}

          <FormSection title="Identity" first columns={2}>
            <form.Field name="name">
              {(field) => (
                <Field label="Name">
                  <Input
                    id="agent-name"
                    value={field.state.value}
                    disabled={readOnly}
                    data-testid="agent-name-input"
                    onChange={(e) => {
                      const name = e.target.value;
                      field.handleChange(name);
                      if (!slugTouched) form.setFieldValue('slug', slugifyAgentName(name));
                    }}
                    placeholder="Code Reviewer"
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="slug">
              {(field) => (
                <Field
                  label="Slug"
                  hint={`Permanent id used to bind this agent — "${values.scope}:${slug}". Fixed once saved.`}
                >
                  <Input
                    id="agent-slug"
                    value={field.state.value}
                    disabled={readOnly || !isNew}
                    data-testid="agent-slug-input"
                    onChange={(e) => {
                      setSlugTouched(true);
                      field.handleChange(e.target.value);
                    }}
                    placeholder={slugifyAgentName(values.name || 'agent')}
                  />
                </Field>
              )}
            </form.Field>

            <div className="col-span-2">
              <form.Field name="description">
                {(field) => (
                  <Field label="Description" hint="Providers use this to decide when to delegate to the agent.">
                    <Textarea
                      id="agent-description"
                      value={field.state.value}
                      disabled={readOnly}
                      rows={2}
                      data-testid="agent-description-input"
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Reviews diffs for correctness, security and style."
                    />
                  </Field>
                )}
              </form.Field>
            </div>

            <form.Field name="scope">
              {(field) => (
                <Field label="Scope">
                  <Select
                    aria-label="Scope"
                    value={field.state.value}
                    disabled={readOnly || !isNew}
                    onValueChange={(v) => {
                      const scope = (v ?? 'global') as AgentFormValues['scope'];
                      field.handleChange(scope);
                      if (scope !== 'project') form.setFieldValue('projectId', '');
                    }}
                    items={[
                      { value: 'global', label: 'Global — available everywhere' },
                      { value: 'project', label: 'Project — scoped to one project' },
                      ...(values.scope === 'system' ? [{ value: 'system', label: 'Built-in (read-only)' }] : []),
                    ]}
                  />
                </Field>
              )}
            </form.Field>
            {values.scope === 'project' ? (
              <form.Field name="projectId">
                {(field) => (
                  <Field label="Project">
                    <Select
                      aria-label="Project"
                      value={field.state.value || null}
                      disabled={readOnly || !isNew}
                      onValueChange={(v) => field.handleChange(v ?? '')}
                      placeholder="Select a project…"
                      items={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </Field>
                )}
              </form.Field>
            ) : null}

            <div className="col-span-2">
              <Field label="Tags">
                <form.Field name="tags">
                  {(field) => (
                    <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-control border border-line-strong bg-sunken px-2 py-1.5">
                      {field.state.value.map((tag) => (
                        <Chip key={tag} size="sm" onRemove={readOnly ? undefined : () => field.handleChange(field.state.value.filter((t) => t !== tag))}>
                          {tag}
                        </Chip>
                      ))}
                      {!readOnly ? (
                        <Input
                          aria-label="Add tag"
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' || !tagInput.trim()) return;
                            e.preventDefault();
                            const tag = tagInput.trim();
                            if (!field.state.value.includes(tag)) field.handleChange([...field.state.value, tag]);
                            setTagInput('');
                          }}
                          placeholder="Add tag…"
                          className="h-auto min-w-24 flex-1 border-0 bg-transparent p-0"
                        />
                      ) : null}
                    </div>
                  )}
                </form.Field>
              </Field>
            </div>

            <div className="col-span-2">
              <form.Field name="enabled">
                {(field) => (
                  <div className="flex items-center justify-between rounded-control bg-sunken px-3 py-2">
                    <div>
                      <div className="text-ui text-fg">Enabled</div>
                      <div className="text-small text-fg-3">Disabled agents disappear from pickers; existing bindings keep their snapshot.</div>
                    </div>
                    <Switch checked={field.state.value} disabled={readOnly} onCheckedChange={field.handleChange} aria-label="Enabled" />
                  </div>
                )}
              </form.Field>
            </div>
          </FormSection>

          <FormSection title="Instructions" hint="Added to the system prompt on every turn.">
            <form.Field name="instructions">
              {(field) => (
                <>
                  <Textarea
                    aria-label="Instructions"
                    value={field.state.value}
                    disabled={readOnly}
                    rows={12}
                    data-testid="agent-instructions-input"
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="You are a meticulous reviewer. Prioritise correctness and security over style…"
                    textareaClassName="font-mono text-small"
                  />
                  <div
                    className={cn(
                      'mt-1.5 text-small',
                      bytes > AGENT_INSTRUCTIONS_MAX_BYTES ? 'text-err' : bytes > AGENT_INSTRUCTIONS_WARN_BYTES ? 'text-warn' : 'text-fg-3',
                    )}
                  >
                    {bytes.toLocaleString()} / {AGENT_INSTRUCTIONS_MAX_BYTES.toLocaleString()} bytes
                    {bytes > AGENT_INSTRUCTIONS_WARN_BYTES && bytes <= AGENT_INSTRUCTIONS_MAX_BYTES
                      ? ' — long instructions cost context on every turn'
                      : ''}
                  </div>
                </>
              )}
            </form.Field>

            <form.Field name="projection">
              {(field) => (
                <Field
                  label="How these instructions combine with the built-in prompt"
                  hint={
                    field.state.value === 'append'
                      ? 'Keeps the default assistant prompt and adds these instructions on top.'
                      : 'Drops the default assistant prompt; tool instructions are kept either way.'
                  }
                >
                  <Select
                    aria-label="How these instructions combine with the built-in prompt"
                    value={field.state.value}
                    disabled={readOnly}
                    onValueChange={(v) => field.handleChange((v ?? 'append') as AgentFormValues['projection'])}
                    items={[
                      { value: 'append', label: 'Add to the default prompt (recommended)' },
                      { value: 'replace', label: 'Replace the default prompt' },
                    ]}
                  />
                </Field>
              )}
            </form.Field>
            {values.projection === 'replace' ? (
              <Callout tone="warn">
                The default instructions are dropped, but the browser / widget / orchestrator tool instructions are
                still injected — without them the tools they describe become unusable.
              </Callout>
            ) : null}
          </FormSection>

          <FormSection title="Role">
            <form.Field name="role">
              {(field) => (
                <SegmentedControl
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  items={ROLE_ITEMS.map((item) => ({ ...item, disabled: readOnly }))}
                  label="Role"
                  data-testid="agent-role"
                />
              )}
            </form.Field>
          </FormSection>

          <FormSection title="Skills" hint="Staged into the workspace at run time.">
            {catalogLoading ? (
              <Spinner size={14} />
            ) : (
              <form.Field name="skillIds">
                {(field) => (
                  <CapabilityToggleList
                    label="Skills"
                    icon="skills"
                    entries={skills}
                    selectedIds={field.state.value}
                    onChange={field.handleChange}
                    disabled={readOnly}
                    emptyHint="No skills in the catalog yet."
                    data-testid="agent-skills"
                  />
                )}
              </form.Field>
            )}
          </FormSection>

          <FormSection title="MCP servers" hint="Only vetted registry entries.">
            {catalogLoading ? (
              <Spinner size={14} />
            ) : (
              <form.Field name="mcpServerIds">
                {(field) => (
                  <CapabilityToggleList
                    label="MCP servers"
                    icon="mcp"
                    entries={mcpServers}
                    selectedIds={field.state.value}
                    onChange={field.handleChange}
                    disabled={readOnly}
                    emptyHint="No MCP servers registered."
                    data-testid="agent-mcp-servers"
                  />
                )}
              </form.Field>
            )}
          </FormSection>

          <FormSection title="Capabilities">
            <form.Field name="tools">
              {(field) => (
                <ToolPolicyTriState
                  value={field.state.value}
                  onChange={field.handleChange}
                  {...(projectionResult ? { effective: projectionResult.toolPolicy.groups } : {})}
                  labels={TOOL_GROUP_LABELS}
                  disabled={readOnly}
                  data-testid="agent-capabilities"
                  {...(isOrchestrator
                    ? {
                        lockedGroups: {
                          orchestration: { value: true, reason: 'Always on for orchestrators — they cannot delegate without it.' },
                        },
                      }
                    : {})}
                />
              )}
            </form.Field>
          </FormSection>

          {isOrchestrator ? (
            <FormSection title="Team" hint="Agents this orchestrator may spawn. Leave empty to allow any enabled agent.">
              <form.Field name="orchestration">
                {(field) => (
                  <div className="flex flex-col gap-3">
                    <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                      {teamCandidates.length === 0 ? (
                        <p className="py-2 text-small text-fg-3">No other agents available yet.</p>
                      ) : (
                        teamCandidates.map((a) => {
                          const checked = field.state.value.teamAgentRefs.includes(a.ref);
                          return (
                            <div
                              key={a.ref}
                              data-testid={`team-member-${a.slug}`}
                              className={cn(
                                'flex items-center gap-2.5 rounded-control px-2.5 py-1.5 text-ui',
                                checked && 'bg-selected',
                              )}
                            >
                              <AgentGlyph size={14} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-fg">{a.name}</div>
                                <div className="truncate text-small text-fg-3">{a.description}</div>
                              </div>
                              <Badge>{SCOPE_LABELS[a.scope]}</Badge>
                              <Switch
                                checked={checked}
                                disabled={readOnly}
                                aria-label={a.name}
                                onCheckedChange={() =>
                                  field.handleChange({
                                    ...field.state.value,
                                    teamAgentRefs: checked
                                      ? field.state.value.teamAgentRefs.filter((r) => r !== a.ref)
                                      : [...field.state.value.teamAgentRefs, a.ref],
                                  })
                                }
                              />
                            </div>
                          );
                        })
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Max concurrent workers">
                        <NumberField
                          aria-label="Max concurrent workers"
                          min={1}
                          max={20}
                          disabled={readOnly}
                          value={field.state.value.maxWorkers ?? null}
                          onValueChange={(v) => field.handleChange({ ...field.state.value, maxWorkers: v ?? undefined })}
                        />
                      </Field>
                      <Field label="Default worker model">
                        <ModelPicker
                          variant="field"
                          ariaLabel="Default worker model"
                          placeholder="Server default"
                          disabled={readOnly}
                          value={field.state.value.defaultWorkerModel ?? ''}
                          onChange={(v) => field.handleChange({ ...field.state.value, defaultWorkerModel: v || undefined })}
                        />
                      </Field>
                    </div>
                  </div>
                )}
              </form.Field>
            </FormSection>
          ) : null}

          <FormSection title="Runtime" hint="Leave a field empty to inherit it from the chat, stage or server default.">
            <form.Field name="runtime">
              {(field) => {
                const runtime = field.state.value;
                const patchRuntime = (delta: Partial<AgentRuntimePolicy>) => field.handleChange({ ...runtime, ...delta });
                return (
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Provider">
                      <Select
                        aria-label="Provider"
                        value={runtime.harnessType ?? ''}
                        disabled={readOnly}
                        onValueChange={(v) => patchRuntime({ harnessType: (v || undefined) as AgentRuntimePolicy['harnessType'] })}
                        items={providerItems}
                      />
                    </Field>
                    <Field label="Model">
                      <ModelPicker
                        variant="field"
                        ariaLabel="Model"
                        placeholder="Inherit from the binding site"
                        disabled={readOnly}
                        value={runtime.model ?? ''}
                        onChange={(v) => patchRuntime({ model: v || undefined })}
                      />
                    </Field>
                    {/* A bare label, not <Field>: Base UI's Field context
                        wires its label to every descendant Base UI input,
                        which — for a RadioGroup — stomps each individual
                        Radio's own accessible name with the group's label
                        instead of "Low"/"Medium"/… (caught in the headed
                        look). SegmentedControl's own `label` already names
                        the group; this span only repeats it visually. */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-small font-medium text-fg-2">Reasoning effort</span>
                      <SegmentedControl<EffortValue>
                        value={(runtime.reasoningEffort ?? '') as EffortValue}
                        onValueChange={(v) => patchRuntime({ reasoningEffort: (v || undefined) as AgentRuntimePolicy['reasoningEffort'] })}
                        items={EFFORT_ITEMS.map((item) => ({ ...item, disabled: readOnly }))}
                        label="Reasoning effort"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-small font-medium text-fg-2">Context tier</span>
                      <SegmentedControl<ContextTierValue>
                        value={(runtime.contextTier ?? '') as ContextTierValue}
                        onValueChange={(v) => patchRuntime({ contextTier: (v || undefined) as AgentRuntimePolicy['contextTier'] })}
                        items={CONTEXT_TIER_ITEMS.map((item) => ({ ...item, disabled: readOnly }))}
                        label="Context tier"
                      />
                    </div>
                    {/* Permission mode is intentionally not editable here: the
                        chat or workflow the agent runs in owns approvals. */}
                    <Field label="Max turns" hint="Copilot ignores this; Claude enforces it.">
                      <NumberField
                        aria-label="Max turns"
                        min={1}
                        disabled={readOnly}
                        value={runtime.maxTurns ?? null}
                        onValueChange={(v) => patchRuntime({ maxTurns: v ?? undefined })}
                      />
                    </Field>
                  </div>
                );
              }}
            </form.Field>
          </FormSection>
        </>
      }
      aside={
        <div className="flex flex-col gap-4">
          <EffectiveCapabilities
            projection={projectionResult}
            isLoading={preview.isPending && !projectionResult}
            error={preview.error as Error | null}
            dirty={isDirty}
            baseCounts={{ skills: values.skillIds.length, mcpServers: values.mcpServerIds.length }}
            data-testid="effective-capabilities"
          />
          {existing && !isNew ? <AgentUsedBy agentId={existing.id} /> : null}
        </div>
      }
      actions={
        <ActionBar
          hint={isDirty ? 'Unsaved changes' : undefined}
          secondary={
            isDirty && !readOnly ? (
              <Button variant="ghost" onClick={() => form.reset()} data-testid="agent-discard-button">
                Discard
              </Button>
            ) : undefined
          }
          primary={
            <Button
              variant="primary"
              shortcut={['Ctrl', '↵']}
              disabled={!canSave || isSubmitting}
              loading={isSubmitting}
              onClick={handleSave}
              data-testid="agent-save-button"
            >
              {isNew ? 'Create agent' : 'Save'}
            </Button>
          }
        />
      }
    />
  );
}
