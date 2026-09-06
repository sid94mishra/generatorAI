// ────────────────────────────────────────────────────────────────
// AgentEditorPage — author or edit a first-class agent.
//
// The form mirrors the persisted shape 1:1 and previews the RESOLVED
// projection alongside it, because the union algebra (agent ∪ binding
// additions, minus removals, with tri-state tool folding) is not legible
// from the raw inputs. `system`-scope agents are read-only: they are synced
// from `.agent.md` files on disk and would be overwritten on next boot.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  FileText,
  Network,
  Save,
  Server,
  Sparkles,
  Wrench,
  Users,
  Lock,
  Download,
  AlertCircle,
  ScanEye,
} from 'lucide-react';

import {
  useAgent,
  useCreateAgent,
  useUpdateAgent,
  useExportAgent,
  useResolveAgentPreview,
  useSelectableAgents,
} from '@/hooks/agentQueries.js';
import { useModels } from '@/hooks/queries.js';
import { useProjects } from '@/hooks/projectQueries.js';
import {
  Button,
  Input,
  Textarea,
  Select,
  Badge,
  Card,
  ToggleSwitch,
  PageHeader,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Spinner,
  toast,
} from '@/components/ui/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { Switch } from '@/components/ui/primitives/switch.js';
import { CapabilityToggleList } from '@/components/agents/CapabilityToggleList.js';
import { ToolPolicyEditor } from '@/components/agents/ToolPolicyEditor.js';
import { EffectiveCapabilitiesPanel } from '@/components/agents/EffectiveCapabilitiesPanel.js';
import { useAgentCatalog } from '@/components/agents/useAgentCatalog.js';
import { warningText, SCOPE_LABELS } from '@/lib/agentCopy.js';
import {
  slugifyAgentName,
  AGENT_SLUG_PATTERN,
  AGENT_INSTRUCTIONS_MAX_BYTES,
  AGENT_INSTRUCTIONS_WARN_BYTES,
} from '@generatorai/shared';
import type {
  Agent,
  AgentRole,
  AgentScope,
  AgentToolPolicy,
  AgentRuntimePolicy,
  AgentOrchestrationPolicy,
  ResolvedAgentProjection,
} from '@generatorai/shared';
import { cn } from '@/lib/utils.js';

interface FormState {
  scope: AgentScope;
  projectId: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  role: AgentRole;
  projection: 'append' | 'replace';
  tags: string[];
  enabled: boolean;
  skillIds: string[];
  mcpServerIds: string[];
  tools: Partial<AgentToolPolicy>;
  runtime: AgentRuntimePolicy;
  orchestration: AgentOrchestrationPolicy;
}

const EMPTY_FORM: FormState = {
  scope: 'global',
  projectId: '',
  slug: '',
  name: '',
  description: '',
  instructions: '',
  role: 'agent',
  projection: 'append',
  tags: [],
  enabled: true,
  skillIds: [],
  mcpServerIds: [],
  tools: {},
  runtime: {},
  orchestration: { teamAgentRefs: [] },
};

function toForm(agent: Agent): FormState {
  return {
    scope: agent.scope,
    projectId: agent.projectId,
    slug: agent.slug,
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions,
    role: agent.role,
    projection: agent.projection,
    tags: agent.tags,
    enabled: agent.enabled,
    skillIds: agent.skillIds,
    mcpServerIds: agent.mcpServerIds,
    tools: agent.tools ?? {},
    runtime: agent.runtime ?? {},
    orchestration: agent.orchestration ?? { teamAgentRefs: [] },
  };
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function Field({
  label,
  hint,
  required,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  /** id of the control this label names (for click-to-focus + screen readers) */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

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
  const { data: models } = useModels();
  const { data: projects } = useProjects();

  const [form, setForm] = useState<FormState>(() => ({
    ...EMPTY_FORM,
    projectId: searchParams.get('projectId') ?? '',
    scope: searchParams.get('projectId') ? 'project' : 'global',
  }));
  // Once the user edits the slug by hand we stop deriving it from the name,
  // otherwise renaming a saved agent would silently repoint every binding.
  const [slugTouched, setSlugTouched] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [projectionResult, setProjectionResult] = useState<ResolvedAgentProjection | undefined>();
  // A blank form is invalid by definition; showing that as an error before the
  // user has typed anything reads as a failure rather than as guidance.
  const [dirty, setDirty] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);

  useEffect(() => {
    if (existing) {
      setForm(toForm(existing));
      setSlugTouched(true);
      setDirty(false);
      setSaveAttempted(false);
    }
  }, [existing]);

  const readOnly = form.scope === 'system';
  const isOrchestrator = form.role === 'orchestrator';

  const { skills, mcpServers, isLoading: catalogLoading } = useAgentCatalog(
    form.scope === 'project' && form.projectId ? form.projectId : undefined,
  );
  const { data: selectableAgents } = useSelectableAgents(
    form.scope === 'project' && form.projectId ? form.projectId : undefined,
    isOrchestrator,
  );

  const patch = useCallback((delta: Partial<FormState>) => {
    setDirty(true);
    setForm((prev) => ({ ...prev, ...delta }));
  }, []);

  // ── Live preview (debounced) ─────────────────────────────────
  // Previewed as a DRAFT so an unsaved agent still shows what the harness
  // would receive. The server redacts MCP credentials before responding.
  const previewMutate = preview.mutateAsync;
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewKey = JSON.stringify({
    n: form.name,
    d: form.description,
    i: form.instructions.length,
    r: form.role,
    p: form.projection,
    s: form.skillIds,
    m: form.mcpServerIds,
    t: form.tools,
    rt: form.runtime,
    o: form.orchestration,
    pid: form.projectId,
    sc: form.scope,
  });

  useEffect(() => {
    if (!form.name) {
      setProjectionResult(undefined);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void previewMutate({
        scope: 'chat',
        harnessType: form.runtime.harnessType ?? 'copilot',
        ...(form.scope === 'project' && form.projectId ? { projectId: form.projectId } : {}),
        draft: {
          scope: form.scope,
          slug: form.slug || slugifyAgentName(form.name),
          name: form.name,
          description: form.description,
          instructions: form.instructions,
          role: form.role,
          projection: form.projection,
          skillIds: form.skillIds,
          mcpServerIds: form.mcpServerIds,
          tools: form.tools,
          runtime: form.runtime,
          ...(isOrchestrator ? { orchestration: form.orchestration } : {}),
        },
      })
        .then(setProjectionResult)
        .catch(() => setProjectionResult(undefined));
    }, 400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `previewKey` is the structural identity of the draft; listing every
    // field here instead would re-fire on unrelated state (tag input, etc).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, previewMutate]);

  // ── Validation ───────────────────────────────────────────────
  const effectiveSlug = form.slug || slugifyAgentName(form.name || 'agent');
  const instructionBytes = byteLength(form.instructions);

  const errors = useMemo(() => {
    const out: string[] = [];
    if (!form.name.trim()) out.push('Name is required.');
    if (form.description.trim().length < 10)
      out.push('Description must be at least 10 characters — both SDKs use it to route delegation.');
    if (!AGENT_SLUG_PATTERN.test(effectiveSlug))
      out.push('Slug must be 2–64 characters: lowercase letters, digits and hyphens.');
    // Required by the create contract (`AgentSchemas.ts`: instructions is
    // `z.string().min(1)`). Without this the form let Save through, the POST
    // came back 400, and the only feedback was a generic
    // "Request body validation failed" toast that never named the field.
    if (!form.instructions.trim())
      out.push('Instructions are required — they become the agent’s system prompt.');
    if (instructionBytes > AGENT_INSTRUCTIONS_MAX_BYTES)
      out.push(
        `Instructions are ${instructionBytes} bytes; the limit is ${AGENT_INSTRUCTIONS_MAX_BYTES}.`,
      );
    if (form.scope === 'project' && !form.projectId) out.push('Pick a project for a project-scoped agent.');
    if (isOrchestrator && form.orchestration.teamAgentRefs.includes(`${form.scope}:${effectiveSlug}`))
      out.push('An orchestrator cannot include itself in its own team.');
    return out;
  }, [form, effectiveSlug, instructionBytes, isOrchestrator]);

  const canSave = errors.length === 0 && !readOnly;
  const showErrors = errors.length > 0 && (saveAttempted || dirty);

  const handleSave = async () => {
    setSaveAttempted(true);
    if (!canSave) return;
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      instructions: form.instructions,
      slug: effectiveSlug,
      role: form.role,
      projection: form.projection,
      tags: form.tags,
      enabled: form.enabled,
      skillIds: form.skillIds,
      mcpServerIds: form.mcpServerIds,
      tools: form.tools,
      runtime: form.runtime,
      ...(isOrchestrator ? { orchestration: form.orchestration } : {}),
    };

    try {
      if (isNew) {
        const created = await createAgent.mutateAsync({
          ...payload,
          scope: form.scope,
          ...(form.scope === 'project' ? { projectId: form.projectId } : {}),
        });
        for (const w of created.warnings ?? []) toast.warning(warningText(w));
        toast.success(`Created "${created.name}"`);
        navigate(`/agents/${created.id}`, { replace: true });
      } else {
        const updated = await updateAgent.mutateAsync({ id: id!, params: payload });
        for (const w of updated.warnings ?? []) toast.warning(warningText(w));
        toast.success(`Saved "${updated.name}" (v${updated.version})`);
      }
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  };

  const handleExport = async () => {
    if (!id || isNew) return;
    try {
      const markdown = await exportAgent.mutateAsync(id);
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${effectiveSlug}.agent.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    }
  };

  if (!isNew && isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!isNew && error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-danger">
        <AlertCircle className="h-8 w-8" />
        <p>Failed to load agent: {(error as Error).message}</p>
      </div>
    );
  }

  const modelOptions = [
    { value: '', label: 'Inherit from the binding site' },
    ...(models ?? []).map((m) => ({ value: m.id, label: m.name, description: m.provider })),
  ];

  const teamCandidates = (selectableAgents ?? []).filter(
    (a) => a.role === 'agent' && a.enabled && a.ref !== `${form.scope}:${effectiveSlug}`,
  );

  return (
    <PageContainer>
      <PageHeader
        className="mb-6"
        leading={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/agents')}
            aria-label="Back to Agents"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        }
        title={
          <span className="flex items-center gap-2">
            {isOrchestrator ? <Network className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
            {isNew ? 'New agent' : form.name || 'Agent'}
            {readOnly && (
              <Badge tone="neutral" size="sm">
                <Lock className="h-2.5 w-2.5" />
                Built-in (read-only)
              </Badge>
            )}
            {existing && (
              <Badge tone="neutral" size="sm">
                v{existing.version}
              </Badge>
            )}
          </span>
        }
        subtitle={isNew ? 'Bundle instructions with skills, MCP servers and capabilities' : effectiveSlug}
        actions={
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  title="Effective capabilities"
                  aria-label="Effective capabilities"
                  data-testid="effective-capabilities-trigger"
                >
                  <ScanEye className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[360px] p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">
                  Effective capabilities
                </h3>
                <EffectiveCapabilitiesPanel
                  projection={projectionResult}
                  isLoading={preview.isPending && !projectionResult}
                  error={preview.error as Error | null}
                  baseCounts={{
                    skills: form.skillIds.length,
                    mcpServers: form.mcpServerIds.length,
                  }}
                />
              </PopoverContent>
            </Popover>
            {!isNew && (
              <Button
                variant="secondary"
                onClick={() => void handleExport()}
                leftIcon={<Download className="h-4 w-4" />}
              >
                Export
              </Button>
            )}
            <Button
              onClick={() => void handleSave()}
              disabled={readOnly || createAgent.isPending || updateAgent.isPending}
              leftIcon={<Save className="h-4 w-4" />}
              data-testid="agent-save-button"
            >
              {isNew ? 'Create agent' : 'Save'}
            </Button>
          </div>
        }
      />

      {showErrors && (
        <div
          className="mb-4 space-y-1 rounded-lg bg-danger-muted p-3 text-xs text-danger"
          data-testid="agent-form-errors"
        >
          {errors.map((e) => (
            <div key={e} className="flex items-start gap-1.5">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {e}
            </div>
          ))}
        </div>
      )}

      {/* `min-w-0`: a grid item defaults to `min-width:auto`, so one long
          unbreakable string (a team member's description) widens the whole
          column past the track and scrolls the page sideways. */}
      <div className="grid min-w-0 grid-cols-1 gap-4">
        <div className="min-w-0 space-y-4">
          <SectionCard icon={Bot} title="Identity">
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Name" required htmlFor="agent-name">
                  <Input
                    id="agent-name"
                    value={form.name}
                    disabled={readOnly}
                    data-testid="agent-name-input"
                    onChange={(e) => {
                      const name = e.target.value;
                      patch(slugTouched ? { name } : { name, slug: slugifyAgentName(name) });
                    }}
                    placeholder="Code Reviewer"
                  />
                </Field>
                <Field
                  label="Slug"
                  hint={`Permanent id used to bind this agent from chats, stages and scripts — "${form.scope}:${effectiveSlug}". Auto-derived from the name and fixed once saved.`}
                  htmlFor="agent-slug"
                >
                  <Input
                    id="agent-slug"
                    value={form.slug}
                    disabled={readOnly || !isNew}
                    data-testid="agent-slug-input"
                    onChange={(e) => {
                      setSlugTouched(true);
                      patch({ slug: e.target.value });
                    }}
                    placeholder={slugifyAgentName(form.name || 'agent')}
                  />
                </Field>
              </div>

              <Field
                label="Description"
                required
                hint="Both SDKs use this to decide when to delegate to the agent. Be specific about when it should be chosen."
                htmlFor="agent-description"
              >
                <Textarea
                  id="agent-description"
                  value={form.description}
                  disabled={readOnly}
                  rows={2}
                  data-testid="agent-description-input"
                  onChange={(e) => patch({ description: e.target.value })}
                  placeholder="Reviews diffs for correctness, security and style. Use after code changes are complete."
                />
              </Field>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Scope">
                  <Select
                    aria-label="Scope"
                    value={form.scope}
                    disabled={readOnly || !isNew}
                    onChange={(v) =>
                      patch({ scope: v as AgentScope, ...(v !== 'project' ? { projectId: '' } : {}) })
                    }
                    options={[
                      { value: 'global', label: 'Global — available everywhere' },
                      { value: 'project', label: 'Project — scoped to one project' },
                      ...(form.scope === 'system'
                        ? [{ value: 'system', label: 'Built-in (read-only)' }]
                        : []),
                    ]}
                  />
                </Field>
                {form.scope === 'project' && (
                  <Field label="Project" required>
                    <Select
                      aria-label="Project"
                      value={form.projectId}
                      disabled={readOnly || !isNew}
                      onChange={(v) => patch({ projectId: v })}
                      placeholder="Select a project…"
                      options={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </Field>
                )}
              </div>

              <Field label="Tags">
                <div className="flex flex-wrap items-center gap-1.5">
                  {form.tags.map((tag) => (
                    <Badge key={tag} tone="neutral" size="sm">
                      {tag}
                      {!readOnly && (
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={`Remove tag ${tag}`}
                          onClick={() => patch({ tags: form.tags.filter((t) => t !== tag) })}
                          className="ml-0.5 h-auto w-auto rounded-none p-0 text-[10px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                        >
                          ×
                        </Button>
                      )}
                    </Badge>
                  ))}
                  {!readOnly && (
                    <Input
                      aria-label="Add tag"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && tagInput.trim()) {
                          e.preventDefault();
                          const tag = tagInput.trim();
                          if (!form.tags.includes(tag)) patch({ tags: [...form.tags, tag] });
                          setTagInput('');
                        }
                      }}
                      placeholder="Add tag…"
                      className="h-auto w-24 rounded-none border-0 bg-transparent p-0 text-xs text-foreground placeholder:text-muted-foreground focus:border-0 focus:outline-none focus:ring-0"
                    />
                  )}
                </div>
              </Field>

              <div className="rounded-md bg-subtle px-3 py-2">
                <ToggleSwitch
                  checked={form.enabled}
                  disabled={readOnly}
                  onChange={(v) => patch({ enabled: v })}
                  label="Enabled"
                  description="Disabled agents disappear from pickers; existing bindings keep their snapshot."
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard
            icon={Sparkles}
            title="Instructions*"
            subtitle="Who this agent is and how it should work. Added to the system prompt on every turn."
          >
            <div className="space-y-3">
              <Textarea
                aria-label="Instructions"
                value={form.instructions}
                disabled={readOnly}
                rows={12}
                data-testid="agent-instructions-input"
                onChange={(e) => patch({ instructions: e.target.value })}
                placeholder="You are a meticulous reviewer. Prioritise correctness and security over style…"
                className="font-mono text-xs"
              />
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'text-[11px]',
                    instructionBytes > AGENT_INSTRUCTIONS_MAX_BYTES
                      ? 'text-danger'
                      : instructionBytes > AGENT_INSTRUCTIONS_WARN_BYTES
                        ? 'text-warning'
                        : 'text-muted-foreground',
                  )}
                >
                  {instructionBytes.toLocaleString()} / {AGENT_INSTRUCTIONS_MAX_BYTES.toLocaleString()} bytes
                  {instructionBytes > AGENT_INSTRUCTIONS_WARN_BYTES &&
                    instructionBytes <= AGENT_INSTRUCTIONS_MAX_BYTES &&
                    ' — long instructions cost context on every turn'}
                </span>
              </div>

              <Field
                label="How these instructions combine with the built-in prompt"
                hint={
                  form.projection === 'append'
                    ? 'Keep GeneratorAI\u2019s default assistant prompt and add these instructions on top. Use this unless the default behaviour actively conflicts with the agent.'
                    : 'Drop the default assistant prompt so only these instructions describe who the agent is. Tool instructions are kept either way.'
                }
              >
                <Select
                  aria-label="How these instructions combine with the built-in prompt"
                  value={form.projection}
                  disabled={readOnly}
                  onChange={(v) => patch({ projection: v as 'append' | 'replace' })}
                  options={[
                    {
                      value: 'append',
                      label: 'Add to the default prompt (recommended)',
                      description: 'Default behaviour is kept; these instructions refine it.',
                    },
                    {
                      value: 'replace',
                      label: 'Replace the default prompt',
                      description: 'Only these instructions define the agent. Tool instructions still apply.',
                    },
                  ]}
                />
              </Field>
              {form.projection === 'replace' && (
                <p className="rounded-md bg-warning-muted px-2.5 py-2 text-[11px] text-warning">
                  The default instructions are dropped, but the browser / widget / orchestrator tool
                  instructions are still injected — without them the tools they describe become
                  unusable.
                </p>
              )}
            </div>
          </SectionCard>

          <SectionCard icon={Network} title="Role">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['agent', 'Agent', 'Does the work itself.', Bot],
                  [
                    'orchestrator',
                    'Orchestrator',
                    'Plans and delegates to worker agents. Orchestration tools are always on.',
                    Network,
                  ],
                ] as const
              ).map(([value, label, hint, Icon]) => (
                <button
                  key={value}
                  type="button"
                  disabled={readOnly}
                  data-testid={`agent-role-${value}`}
                  onClick={() => patch({ role: value })}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    form.role === value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-subtle',
                    readOnly && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard icon={FileText} title="Skills" subtitle="Staged into the workspace at run time.">
            {catalogLoading ? (
              <p className="py-2 text-xs text-muted-foreground">Loading catalog…</p>
            ) : (
              <CapabilityToggleList
                entries={skills}
                selectedIds={form.skillIds}
                onChange={(ids) => patch({ skillIds: ids })}
                icon={FileText}
                disabled={readOnly}
                emptyHint="No skills in the catalog yet."
                data-testid="agent-skills"
              />
            )}
          </SectionCard>

          <SectionCard
            icon={Server}
            title="MCP servers"
            subtitle="Only vetted registry entries — inline definitions are not accepted."
          >
            {catalogLoading ? (
              <p className="py-2 text-xs text-muted-foreground">Loading catalog…</p>
            ) : (
              <CapabilityToggleList
                entries={mcpServers}
                selectedIds={form.mcpServerIds}
                onChange={(ids) => patch({ mcpServerIds: ids })}
                icon={Server}
                disabled={readOnly}
                emptyHint="No MCP servers registered."
                data-testid="agent-mcp-servers"
              />
            )}
          </SectionCard>

          <SectionCard icon={Lock} title="Capabilities">
            <ToolPolicyEditor
              value={form.tools}
              onChange={(tools) => patch({ tools })}
              {...(projectionResult
                ? { effective: projectionResult.toolPolicy.groups as AgentToolPolicy }
                : {})}
              disabled={readOnly}
              {...(isOrchestrator
                ? {
                    lockedGroups: {
                      orchestration: {
                        value: true,
                        reason: 'Always on for orchestrators — they cannot delegate without it.',
                      },
                    },
                  }
                : {})}
            />
          </SectionCard>

          {isOrchestrator && (
            <SectionCard
              icon={Users}
              title="Team"
              subtitle="Agents this orchestrator may spawn. Leave empty to allow any enabled agent."
            >
              <div className="space-y-3">
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {teamCandidates.length === 0 ? (
                    <p className="py-2 text-xs text-muted-foreground">
                      No other agents available yet.
                    </p>
                  ) : (
                    teamCandidates.map((a) => {
                      const checked = form.orchestration.teamAgentRefs.includes(a.ref);
                      return (
                        <div
                          key={a.ref}
                          data-testid={`team-member-${a.slug}`}
                          className={cn(
                            'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs transition-colors',
                            checked
                              ? 'border border-primary/20 bg-primary/5'
                              : 'border border-transparent opacity-70 hover:bg-subtle',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-foreground">{a.name}</div>
                            <div className="truncate text-[10px] text-muted-foreground">
                              {a.description}
                            </div>
                          </div>
                          <Badge tone="neutral" size="sm" className="shrink-0 text-[9px]">
                            {SCOPE_LABELS[a.scope]}
                          </Badge>
                          <Switch
                            checked={checked}
                            disabled={readOnly}
                            aria-label={a.name}
                            onCheckedChange={() =>
                              patch({
                                orchestration: {
                                  ...form.orchestration,
                                  teamAgentRefs: checked
                                    ? form.orchestration.teamAgentRefs.filter((r) => r !== a.ref)
                                    : [...form.orchestration.teamAgentRefs, a.ref],
                                },
                              })
                            }
                          />
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Max concurrent workers" htmlFor="agent-max-workers">
                    <Input
                      id="agent-max-workers"
                      type="number"
                      min={1}
                      max={20}
                      disabled={readOnly}
                      value={form.orchestration.maxWorkers ?? ''}
                      onChange={(e) =>
                        patch({
                          orchestration: {
                            ...form.orchestration,
                            maxWorkers: e.target.value ? Number(e.target.value) : undefined,
                          },
                        })
                      }
                      placeholder="Server default"
                    />
                  </Field>
                  <Field label="Default worker model">
                    <Select
                      aria-label="Default worker model"
                      value={form.orchestration.defaultWorkerModel ?? ''}
                      disabled={readOnly}
                      onChange={(v) =>
                        patch({
                          orchestration: {
                            ...form.orchestration,
                            defaultWorkerModel: v || undefined,
                          },
                        })
                      }
                      options={modelOptions}
                    />
                  </Field>
                </div>
              </div>
            </SectionCard>
          )}

          <SectionCard
            icon={Wrench}
            title="Runtime"
            subtitle="Leave a field empty to inherit it from the chat, stage or server default."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Provider">
                <Select
                  aria-label="Provider"
                  value={form.runtime.harnessType ?? ''}
                  disabled={readOnly}
                  onChange={(v) =>
                    patch({
                      runtime: {
                        ...form.runtime,
                        harnessType: (v || undefined) as 'copilot' | 'claude-agent' | undefined,
                      },
                    })
                  }
                  options={[
                    { value: '', label: 'Any provider' },
                    { value: 'copilot', label: 'GitHub Copilot' },
                    { value: 'claude-agent', label: 'Claude Agent' },
                  ]}
                />
              </Field>
              <Field label="Model">
                <Select
                  aria-label="Model"
                  value={form.runtime.model ?? ''}
                  disabled={readOnly}
                  onChange={(v) => patch({ runtime: { ...form.runtime, model: v || undefined } })}
                  options={modelOptions}
                />
              </Field>
              <Field label="Reasoning effort">
                <Select
                  aria-label="Reasoning effort"
                  value={form.runtime.reasoningEffort ?? ''}
                  disabled={readOnly}
                  onChange={(v) =>
                    patch({
                      runtime: { ...form.runtime, reasoningEffort: (v || undefined) as never },
                    })
                  }
                  options={[
                    { value: '', label: 'Inherit' },
                    { value: 'low', label: 'Low' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'high', label: 'High' },
                    { value: 'xhigh', label: 'Extra high' },
                  ]}
                />
              </Field>
              <Field label="Context tier">
                <Select
                  aria-label="Context tier"
                  value={form.runtime.contextTier ?? ''}
                  disabled={readOnly}
                  onChange={(v) =>
                    patch({ runtime: { ...form.runtime, contextTier: (v || undefined) as never } })
                  }
                  options={[
                    { value: '', label: 'Inherit' },
                    { value: 'default', label: 'Default' },
                    { value: 'long_context', label: 'Long context' },
                  ]}
                />
              </Field>
              {/* Permission mode is intentionally not editable here: the chat or
                  workflow the agent runs in owns approvals, and a second control
                  only creates a conflict the user cannot see. */}
              <Field label="Max turns" hint="Copilot ignores this; Claude enforces it." htmlFor="agent-max-turns">
                <Input
                  id="agent-max-turns"
                  type="number"
                  min={1}
                  disabled={readOnly}
                  value={form.runtime.maxTurns ?? ''}
                  onChange={(e) =>
                    patch({
                      runtime: {
                        ...form.runtime,
                        maxTurns: e.target.value ? Number(e.target.value) : undefined,
                      },
                    })
                  }
                  placeholder="Unlimited"
                />
              </Field>
            </div>
          </SectionCard>
        </div>
      </div>
    </PageContainer>
  );
}
