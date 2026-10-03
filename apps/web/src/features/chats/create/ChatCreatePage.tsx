// ────────────────────────────────────────────────────────────────
// ChatCreatePage — the full `/chats/new` form (P5-09; T-03 FormWithAside).
//
// One component for the ChatCreate (agent), ChatCreateOrchestrator and
// ChatCreateModel boards: which of the three it looks like is decided by the
// draft's `who` / `orchestratorMode`, not by the route.
//
// State is deliberately split in two:
//   - TanStack Form owns the scalar `CreateChatDraft` fields (task, name,
//     description, who, agent, model, effort, tags, browser…), with zod
//     schemas for the per-field caps the server enforces (ChatSchemas.ts:
//     name ≤ 200, description ≤ 2000, ≤ 20 tags of ≤ 50 chars);
//   - `SourcePicker` owns the rich "Where" list (`DraftSource[]`, live git
//     facts per row) as plain `useState`.
// Both meet only at submit, through `buildCreateChatParams`.
//
// The NewChatDialog's "Open full form" hands its draft over in router state
// (`{ draft: Partial<CreateChatDraft> }`); its scalar fields prefill this
// page.
//
// The Summary aside shows only values computed from the live draft, the
// resolved model, the bound agent and the source list (D-36).
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, Link as RouterLink } from 'react-router';
import { useForm, useStore } from '@tanstack/react-form';
import { z } from 'zod';
import { MODEL_TIER_LABELS, type Agent, type HarnessCatalogModel, type ModelTier } from '@generatorai/shared';
import { EMPTY_CREATE_CHAT_DRAFT, type ChatCreateWho, type CreateChatDraft } from '@generatorai/shared/ui-contract';
import { AgentPicker } from '@/blocks/agent-picker/index.js';
import { ModelPicker } from '@/blocks/model-picker/index.js';
import { SourcePicker, describeDraft, type DraftSource } from '@/blocks/sources/index.js';
import { useSelectableAgents } from '@/hooks/agentQueries.js';
import { useHarnessProviders, useModels } from '@/hooks/harnessQueries.js';
import { useProjects } from '@/hooks/projectQueries.js';
import { useCreateChat, useSendChatPromptTo } from '@/hooks/queries.js';
import { useMediaQuery } from '@/hooks/useMediaQuery.js';
import { getDefaultChatModel } from '@/lib/appPreferences.js';
import { Icon } from '@/ui/icons/Icon.js';
import { ActionBar } from '@/ui/patterns/ActionBar/ActionBar.js';
import { Breadcrumb } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { ChoiceCardGrid, type ChoiceCardOption } from '@/ui/patterns/ChoiceCardGrid/ChoiceCardGrid.js';
import { FormSection } from '@/ui/patterns/FormSection/FormSection.js';
import { KbdHintRow } from '@/ui/patterns/KbdHintRow/KbdHintRow.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { SummaryAside, type SummaryAsideSection } from '@/ui/patterns/SummaryAside/SummaryAside.js';
import { FormWithAside } from '@/ui/templates/FormWithAside/FormWithAside.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { cn } from '@/ui/lib/cn.js';
import { BrowserVisibilityField, DEFAULT_BROWSER_SETTINGS } from './BrowserVisibilityField.js';
import { buildCreateChatParams, chatCreateBlockingReason, chatCreateDisplayName } from './mapDraftToParams.js';
import { contextTiersFor, defaultReasoningEffortFor, reasoningLevelsFor, type ContextTier } from './modelControls.js';
import { modChord } from '@/lib/shortcuts.js';

// ── Constants ───────────────────────────────────────────────────

const TASK_REQUIRED = 'Describe the task to start the chat';
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

/** Per-field shape rules, mirroring the server's `ChatSchemas.ts` caps. */
const taskSchema = z.string().refine((s) => s.trim().length > 0, TASK_REQUIRED);
const nameSchema = z.string().max(200, 'Keep the name under 200 characters');
const descriptionSchema = z.string().max(2000, 'Keep the description under 2000 characters');

/**
 * The aside needs ~1150px of card (720 form + 48 gap + 320 aside + padding);
 * the card is the viewport minus the 232px sidebar and its gutters.
 */
const ASIDE_COLLAPSE_QUERY = '(max-width: 1399.98px)';

const WHO_OPTIONS: readonly ChoiceCardOption[] = [
  {
    value: 'model',
    icon: 'model',
    title: 'Just a model',
    description: 'The model plus the skills, MCP servers and tools you choose here.',
  },
  {
    value: 'agent',
    icon: 'agents',
    title: 'An agent',
    description: 'Reusable instructions with their own skills, MCP servers and capabilities.',
  },
  {
    value: 'orchestrator',
    icon: 'users',
    title: 'An orchestrator',
    description: 'Splits the task, runs background agents, then consolidates.',
  },
];

// ── Pure helpers ────────────────────────────────────────────────

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s;
}

/** 200000 → "200K", 1000000 → "1M". */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${String(Number((tokens / 1_000_000).toFixed(1)))}M`;
  return `${String(Math.round(tokens / 1000))}K`;
}

function tierLabel(category: string | undefined): string | undefined {
  if (!category) return undefined;
  return (MODEL_TIER_LABELS as Record<string, string | undefined>)[category as ModelTier] ?? titleCase(category);
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** First message of a field's validation errors (a zod issue or a plain string). */
function firstError(errors: readonly unknown[]): string | undefined {
  for (const e of errors) {
    if (typeof e === 'string' && e) return e;
    if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') return e.message;
  }
  return undefined;
}

function capabilitySummary(agent: Agent | undefined): string {
  const skills = agent?.skillIds.length ?? 0;
  const mcp = agent?.mcpServerIds.length ?? 0;
  return `${plural(skills, 'skill', 'skills')} · ${plural(mcp, 'MCP server', 'MCP servers')}`;
}

/** The draft the page starts from: defaults, then whatever the dialog handed over. */
function initialDraft(handoff: Partial<CreateChatDraft> | undefined): CreateChatDraft {
  return {
    ...EMPTY_CREATE_CHAT_DRAFT,
    ...handoff,
    tags: handoff?.tags ?? [],
    model: handoff?.model || getDefaultChatModel(),
    browser: handoff?.browser ?? DEFAULT_BROWSER_SETTINGS,
    // The handoff carries no sources (the dialog's rich rows are not
    // serialisable); the "Where" list starts empty.
    sources: [],
  };
}

/**
 * A popup is (still) open: this Escape is closing it, not the page. Checked
 * before React re-renders, so the popup's own handler has not removed it yet
 * — an in-page combobox input reports `aria-expanded`, portaled popups carry
 * `data-gai-overlay` (toasts and tooltips never swallow Escape).
 */
function popupOpen(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest('[aria-expanded="true"]')) return true;
  return (
    document.querySelector(
      '[data-gai-overlay]:not([data-gai-overlay="toast"]):not([data-gai-overlay="tooltip"]), [role="dialog"], [role="alertdialog"]',
    ) !== null
  );
}

// ── Page ────────────────────────────────────────────────────────

/** `/chats/new`: the full chat-creation form beside a live Summary. */
export function ChatCreatePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const sendFirstPrompt = useSendChatPromptTo();
  const createChat = useCreateChat();
  const asideCollapsed = useMediaQuery(ASIDE_COLLAPSE_QUERY);
  const rootRef = useRef<HTMLDivElement>(null);

  const handoff = location.state as { draft?: Partial<CreateChatDraft>; sourceDrafts?: DraftSource[] } | null;
  const [defaults] = useState(() => initialDraft(handoff?.draft));
  // The New chat dialog's "More options" hands over the sources it had picked.
  const [sourceDrafts, setSourceDrafts] = useState<DraftSource[]>(() => handoff?.sourceDrafts ?? []);
  const [tagInput, setTagInput] = useState('');

  const form = useForm({
    defaultValues: defaults,
    onSubmit: async ({ value }) => {
      const draft = effectiveDraftOf(value);
      if (chatCreateBlockingReason({ draft, sourceDrafts }, 'create')) return;
      try {
        const chat = await createChat.mutateAsync(buildCreateChatParams({ draft, sourceDrafts }));
        // Fire-and-forget: the server answers before it persists the user
        // message (useSendChatPromptTo's own note); SSE carries the rest.
        sendFirstPrompt.mutate({ chatId: chat.id, prompt: draft.prompt });
        navigate(`/chats/${chat.id}`);
      } catch (err) {
        toast.error("Couldn't create the chat", { description: err instanceof Error ? err.message : String(err) });
      }
    },
  });

  const values = useStore(form.store, (s) => s.values);
  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);
  const submissionAttempts = useStore(form.store, (s) => s.submissionAttempts);

  // ── Live data the draft refers to ─────────────────────────────
  const { data: models } = useModels();
  const { data: providers } = useHarnessProviders();
  const { data: agents } = useSelectableAgents(values.projectId);
  const { data: projects } = useProjects();

  const activeModel: HarnessCatalogModel | undefined = useMemo(
    () => models?.find((m) => m.id === values.model),
    [models, values.model],
  );
  const boundAgent: Agent | undefined = useMemo(
    () => (values.who !== 'model' && values.agentRef ? agents?.find((a) => a.ref === values.agentRef) : undefined),
    [agents, values.who, values.agentRef],
  );
  const providerLabel = providers?.providers.find((p) => p.type === activeModel?.provider)?.label;
  const projectName = values.projectId ? projects?.find((p) => p.id === values.projectId)?.name : undefined;

  const effortLevels = reasoningLevelsFor(activeModel);
  const contextTiers = contextTiersFor(activeModel);
  const orchestratorForced = values.who === 'orchestrator' || boundAgent?.role === 'orchestrator';

  // The draft as it will be submitted: forced orchestrate mode, and an effort
  // / tier the selected model actually offers.
  function effectiveDraftOf(v: CreateChatDraft): CreateChatDraft {
    const effort = v.reasoningEffort && effortLevels.includes(v.reasoningEffort) ? v.reasoningEffort : defaultReasoningEffortFor(activeModel);
    const tier = contextTiers.some((t) => t.tier === v.contextTier) ? v.contextTier : undefined;
    return {
      ...v,
      orchestratorMode: orchestratorForced || v.orchestratorMode,
      reasoningEffort: effort,
      contextTier: tier,
    };
  }
  const draft = effectiveDraftOf(values);
  const displayName = chatCreateDisplayName(draft);
  const blockingReason = chatCreateBlockingReason({ draft, sourceDrafts }, 'create');

  // ── Field actions ─────────────────────────────────────────────
  function setWho(next: ChatCreateWho) {
    form.setFieldValue('who', next);
    // An agent picked for one role is never valid for another.
    form.setFieldValue('agentRef', undefined);
    form.setFieldValue('orchestratorMode', next === 'orchestrator');
  }

  function setAgent(ref: string | undefined, agent: Agent | undefined) {
    form.setFieldValue('agentRef', ref);
    if (agent?.role === 'orchestrator') form.setFieldValue('orchestratorMode', true);
  }

  function addTag() {
    const tag = tagInput.trim().slice(0, MAX_TAG_LENGTH);
    setTagInput('');
    if (!tag || values.tags.includes(tag) || values.tags.length >= MAX_TAGS) return;
    form.setFieldValue('tags', [...values.tags, tag]);
  }

  function onTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    addTag();
  }

  function cancel() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/chats');
  }

  // ── Page shortcuts: Ctrl/⌘ ↵ creates, Esc cancels ─────────────
  // Native listener + DOM containment: popovers (Select, Combobox, the model
  // and agent pickers) are portaled, so keys pressed inside them never reach
  // here and their own Escape/Enter keep working.
  const shortcuts = useRef({ submit: () => {}, cancel: () => {} });
  shortcuts.current = {
    submit: () => void form.handleSubmit(),
    cancel,
  };
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      const root = rootRef.current;
      const target = e.target as Node | null;
      if (!root || e.defaultPrevented || !(target === document.body || (target && root.contains(target)))) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        shortcuts.current.submit();
      } else if (e.key === 'Escape' && !popupOpen(e.target)) {
        shortcuts.current.cancel();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // ── Derived display ───────────────────────────────────────────
  const capabilities = capabilitySummary(boundAgent);
  const worktreeCount = sourceDrafts.filter((d) => d.mode === 'worktree').length;
  const newBranchCount = sourceDrafts.filter((d) => d.branchMode === 'new').length;
  const selectedTokens =
    contextTiers.find((t) => t.tier === draft.contextTier)?.tokens ?? activeModel?.promptTokenLimit;

  // ── Sections ──────────────────────────────────────────────────
  const taskSection = (
    <FormSection title="Task" hint="Sent as the first message when the chat opens." first>
      <form.Field name="prompt" validators={{ onChange: taskSchema, onBlur: taskSchema }}>
        {(field) => {
          const error =
            field.state.meta.isBlurred || submissionAttempts > 0 ? firstError(field.state.meta.errors) : undefined;
          return (
            <div className="flex flex-col gap-1.5">
              <Textarea
                aria-label="What should the agent do?"
                placeholder="What should the agent do?"
                variant="prose"
                autosize={{ minRows: 3, maxRows: 12 }}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                invalid={error != null}
                aria-invalid={error != null}
                data-testid="chat-create-task"
              />
              {error != null ? (
                <span role="alert" className="flex items-center gap-1 text-small text-err">
                  <Icon concept="status-failed" size={12} />
                  {error}
                </span>
              ) : null}
            </div>
          );
        }}
      </form.Field>
      <div className="grid grid-cols-2 gap-4">
        <form.Field name="name" validators={{ onChange: nameSchema }}>
          {(field) => (
            <Field label="Name" error={firstError(field.state.meta.errors)}>
              <Input
                placeholder="Named from the task if left empty"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                data-testid="chat-create-name"
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="description" validators={{ onChange: descriptionSchema }}>
          {(field) => (
            <Field label="Description" optional error={firstError(field.state.meta.errors)}>
              <Input
                placeholder="Shown in the chat list"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                data-testid="chat-create-description"
              />
            </Field>
          )}
        </form.Field>
      </div>
    </FormSection>
  );

  // Whoever orchestrates — a model in orchestrate mode or an orchestrator agent — runs on this model.
  const showPowerfulNudge =
    draft.orchestratorMode &&
    activeModel?.category != null &&
    activeModel.category !== 'powerful';

  const whoSection = (
    <FormSection title="Who works on this" hint="Fixed for the life of the chat once it starts.">
      <ChoiceCardGrid
        label="Who works on this"
        columns={3}
        value={values.who}
        onValueChange={(v) => setWho(v as ChatCreateWho)}
        options={WHO_OPTIONS}
      />
      {values.who === 'model' ? (
        <div className="flex items-center gap-2 text-small text-fg-3">
          <Icon concept="info" size={14} />
          No agent — platform default instructions. Skills, MCP servers and tool groups come from Capabilities below.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-small font-medium text-fg-2">
            {values.who === 'orchestrator' ? 'Orchestrator' : 'Agent'}
          </span>
          <AgentPicker
            value={values.agentRef}
            onChange={setAgent}
            projectId={values.projectId}
            role={values.who === 'orchestrator' ? 'orchestrator' : 'agent'}
            data-testid="chat-create-agent"
          />
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-ui text-fg">
            Orchestrate mode
            {orchestratorForced ? <Badge>Set by Orchestrator</Badge> : null}
          </span>
          <span className="text-small text-fg-3">
            Splits the task across background agents on models it picks, then consolidates. Forced on for orchestrators.
          </span>
        </div>
        <Switch
          aria-label="Orchestrate mode"
          checked={draft.orchestratorMode}
          disabled={orchestratorForced}
          onCheckedChange={(next) => form.setFieldValue('orchestratorMode', next)}
          data-testid="chat-create-orchestrate"
        />
      </div>
      {showPowerfulNudge ? (
        <Callout tone="warn" title="Pick a powerful model">
          {activeModel.name} is {tierLabel(activeModel.category)?.toLowerCase()}. Orchestrating works best on a powerful
          model.
        </Callout>
      ) : null}
    </FormSection>
  );

  const modelSection = (
    <FormSection
      title="Model"
      hint="Your default from Settings. Effort applies from the first turn; change it any time in the composer."
      columns={2}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-small font-medium text-fg-2">Model</span>
        <ModelPicker
          variant="field"
          value={values.model}
          onChange={(id) => form.setFieldValue('model', id)}
          ariaLabel="Model"
        />
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {effortLevels.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-small font-medium text-fg-2">Effort</span>
            <SegmentedControl
              label="Reasoning effort"
              value={draft.reasoningEffort ?? ''}
              onValueChange={(v) => form.setFieldValue('reasoningEffort', v)}
              items={effortLevels.map((level) => ({ value: level, label: titleCase(level) }))}
            />
          </div>
        ) : null}
        {contextTiers.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-small font-medium text-fg-2">Context</span>
            <SegmentedControl<ContextTier>
              label="Context window"
              value={(draft.contextTier as ContextTier | undefined) ?? 'default'}
              onValueChange={(v) => form.setFieldValue('contextTier', v)}
              items={contextTiers.map((t) => ({ value: t.tier, label: formatTokens(t.tokens) }))}
            />
          </div>
        ) : null}
      </div>
    </FormSection>
  );

  const whereSection = (
    <FormSection title="Where" hint="What the agent works on. It starts in the working directory.">
      <SourcePicker
        chatName={displayName || 'chat'}
        compact={false}
        drafts={sourceDrafts}
        onChange={setSourceDrafts}
        projectId={values.projectId ?? ''}
        onProjectIdChange={(id) => form.setFieldValue('projectId', id || undefined)}
        primaryAlias={values.primaryAlias}
        onPrimaryChange={(alias) => form.setFieldValue('primaryAlias', alias)}
        error={null}
        disabled={isSubmitting}
      />
    </FormSection>
  );

  const capabilitiesSection = (
    <FormSection
      title="Capabilities"
      hint={
        boundAgent
          ? `Added to ${boundAgent.name}'s own, never a replacement. Removals always win.`
          : 'Inherited unless pinned here.'
      }
    >
      <div className="flex items-center gap-2 text-ui text-fg-2">
        <Icon concept="skills" size={14} className="text-fg-3" />
        {capabilities}
      </div>
    </FormSection>
  );

  const moreSection = (
    <FormSection title="More" hint="Optional." columns={2}>
      <Field label="Tags" hint={`↵ to add · up to ${String(MAX_TAGS)}`}>
        <div className="flex flex-col gap-2">
          {values.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {values.tags.map((tag) => (
                <Chip
                  key={tag}
                  icon="tag"
                  onRemove={() =>
                    form.setFieldValue(
                      'tags',
                      values.tags.filter((t) => t !== tag),
                    )
                  }
                  removeLabel={`Remove tag ${tag}`}
                >
                  {tag}
                </Chip>
              ))}
            </div>
          ) : null}
          <Input
            placeholder="Add tag"
            value={tagInput}
            maxLength={MAX_TAG_LENGTH}
            disabled={values.tags.length >= MAX_TAGS}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={onTagKeyDown}
            data-testid="chat-create-tag-input"
          />
        </div>
      </Field>
      <BrowserVisibilityField
        value={values.browser ?? DEFAULT_BROWSER_SETTINGS}
        onChange={(next) => form.setFieldValue('browser', next)}
      />
    </FormSection>
  );

  // ── Summary aside ─────────────────────────────────────────────
  const chatHint = [
    values.name.trim() ? null : displayName ? 'Named from the task' : null,
    values.tags.length > 0 ? plural(values.tags.length, 'tag', 'tags') : null,
  ].filter(Boolean);

  let whoWorks: ReactNode;
  if (boundAgent) {
    whoWorks = (
      <span className="flex flex-wrap items-center gap-1.5">
        {boundAgent.name}
        <Badge>{boundAgent.role === 'orchestrator' ? 'Orchestrator' : 'Agent'}</Badge>
        <span className="text-small text-fg-3">v{boundAgent.version}</span>
      </span>
    );
  } else {
    whoWorks = (
      <span className="flex flex-wrap items-center gap-1.5">
        {values.who === 'model' ? (activeModel?.name ?? 'The default model') : 'No agent'}
        {draft.orchestratorMode ? <Badge>Orchestrate mode</Badge> : null}
        <span className="text-small text-fg-3">platform default instructions</span>
      </span>
    );
  }

  const modelMeta = [
    tierLabel(activeModel?.category),
    draft.reasoningEffort ? `effort ${titleCase(draft.reasoningEffort)}` : null,
    providerLabel,
  ].filter(Boolean);

  const setupLines: string[] = [];
  const createParts = [
    worktreeCount > 0 ? plural(worktreeCount, 'worktree', 'worktrees') : null,
    newBranchCount > 0 ? plural(newBranchCount, 'branch', 'branches') : null,
  ].filter(Boolean);
  if (createParts.length > 0) {
    setupLines.push(`${createParts.join(' and ')} will be created`);
  }
  if (draft.orchestratorMode) setupLines.push('Background agents are created as the work splits');
  setupLines.push('Opens the chat and sends your task');

  const asideSections: SummaryAsideSection[] = [
    {
      label: 'Chat',
      content: (
        <div className="flex flex-col gap-0.5">
          <span className={cn('truncate', !displayName && 'text-fg-3')}>{displayName || 'Untitled'}</span>
          {chatHint.length > 0 ? <span className="text-small text-fg-3">{chatHint.join(' · ')}</span> : null}
        </div>
      ),
    },
    { label: 'Who works', content: whoWorks },
    {
      label: 'Model',
      content: (
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2">
            {activeModel?.name ?? (values.model || 'Server default')}
            {selectedTokens ? <span className="font-mono text-small text-fg-3">{formatTokens(selectedTokens)}</span> : null}
          </span>
          {modelMeta.length > 0 ? <span className="text-small text-fg-3">{modelMeta.join(' · ')}</span> : null}
        </div>
      ),
    },
    {
      label: 'Where',
      content: (
        <div className="flex flex-col gap-0.5">
          {projectName ? <span>{projectName}</span> : null}
          {sourceDrafts.length === 0 ? (
            <span className="text-small text-fg-3">Empty managed workspace</span>
          ) : (
            sourceDrafts.map((d) => (
              <span key={d.key} className="font-mono text-small text-fg-2 break-all">
                {describeDraft(d, displayName || 'chat')}
              </span>
            ))
          )}
        </div>
      ),
    },
    { label: 'Capabilities', content: capabilities },
    {
      label: 'Setup when you create',
      content: (
        <ul className="flex flex-col gap-1 text-small text-fg-2">
          {setupLines.map((line) => (
            <li key={line} className="flex items-start gap-1.5">
              <Icon concept="check" size={12} className="mt-0.5 text-fg-3" />
              {line}
            </li>
          ))}
        </ul>
      ),
    },
  ];

  // ── Layout ────────────────────────────────────────────────────
  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col" data-testid="chat-create-page">
      <FormWithAside
        asideCollapsed={asideCollapsed}
        header={
          <PageHeader
            breadcrumb={
              <Breadcrumb currentIsHeading items={[{ label: 'Chats', render: <RouterLink to="/chats" /> }, { label: 'New chat' }]} />
            }
            meta={<span className="font-mono text-small text-fg-3">/chats/new</span>}
          />
        }
        form={
          <>
            {taskSection}
            {whoSection}
            {modelSection}
            {whereSection}
            {capabilitiesSection}
            {moreSection}
          </>
        }
        aside={<SummaryAside sections={asideSections} />}
        actions={
          <ActionBar
            hint={
              <KbdHintRow
                hints={[{ keys: 'Esc', label: 'Cancel' }]}
                end={blockingReason ? <span className="truncate" data-testid="chat-create-blocking">{blockingReason}</span> : null}
              />
            }
            secondary={
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            }
            primary={
              <Button
                variant="primary"
                shortcut={modChord('Enter')}
                disabled={blockingReason != null}
                loading={isSubmitting}
                onClick={() => void form.handleSubmit()}
                data-testid="chat-create-submit"
              >
                Create chat
              </Button>
            }
          />
        }
      />
    </div>
  );
}
