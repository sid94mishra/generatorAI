// ────────────────────────────────────────────────────────────────
// F-create-02 NewChatDialog — the 640 quick-start dialog (NewChat board;
// R-1: a dialog for quick start, "More options" for everything else at
// `/chats/new`). Mounted ONCE by app/ShellRoute inside the shell's
// overlays; opened from anywhere via `useNewChatStore` (04 §0).
//
// Replaces `components/chat/CreateChatDialog.tsx`. Unlike the legacy
// dialog (gated on Name), this one is gated on the Task — the chat's name
// defaults to the task when left blank (ChatCreateModel board).
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Agent, HarnessCatalogModel } from '@generatorai/shared';
import { EMPTY_CREATE_CHAT_DRAFT, reasoningEffortLabel, type CreateChatDraft } from '@generatorai/shared/ui-contract';
import { AgentPicker } from '@/blocks/agent-picker/index.js';
import { ModelPicker } from '@/blocks/model-picker/index.js';
import { SourcePicker, type DraftSource } from '@/blocks/sources/index.js';
import { useCreateChat, useSendChatPromptTo } from '@/hooks/queries.js';
import { useModels } from '@/hooks/harnessQueries.js';
import { getDefaultChatModel } from '@/lib/appPreferences.js';
import { useNewChatStore } from '@/stores/newChatStore.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Collapsible } from '@/ui/primitives/Collapsible/Collapsible.js';
import { Dialog, DialogBody, DialogClose, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { KbdHintRow } from '@/ui/patterns/KbdHintRow/KbdHintRow.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { BrowserVisibilityField, DEFAULT_BROWSER_SETTINGS } from './BrowserVisibilityField.js';
import { agentRuntimeSelection, defaultReasoningEffortFor, reasoningLevelsFor } from './modelControls.js';
import { buildCreateChatParams, chatCreateBlockingReason, chatCreateDisplayName } from './mapDraftToParams.js';
import { modChord } from '@/lib/shortcuts.js';


/** The dialog and its wiring — no props, it reads/writes `useNewChatStore`. */
export function NewChatDialog() {
  const isOpen = useNewChatStore((s) => s.isOpen);
  const initialDraft = useNewChatStore((s) => s.initialDraft);
  const close = useNewChatStore((s) => s.close);
  const navigate = useNavigate();
  const createChat = useCreateChat();
  const sendFirstPrompt = useSendChatPromptTo();
  const { data: models } = useModels();

  const [task, setTask] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [projectId, setProjectId] = useState('');
  const [sourceDrafts, setSourceDrafts] = useState<DraftSource[]>([]);
  const [primaryAlias, setPrimaryAlias] = useState<string | undefined>(undefined);
  const [agentRef, setAgentRef] = useState<string | undefined>(undefined);
  const [selectedAgent, setSelectedAgent] = useState<Agent | undefined>(undefined);
  const [model, setModel] = useState(() => getDefaultChatModel());
  const [reasoningEffort, setReasoningEffort] = useState<string | undefined>(undefined);
  const [orchestratorMode, setOrchestratorMode] = useState(false);
  const [planFirst, setPlanFirst] = useState(false);
  const [browser, setBrowser] = useState(DEFAULT_BROWSER_SETTINGS);
  const [submitting, setSubmitting] = useState(false);

  const activeModel = useMemo<HarnessCatalogModel | undefined>(
    () => (models ?? []).find((m) => m.id === model),
    [models, model],
  );
  const reasoningLevels = reasoningLevelsFor(activeModel);
  const effectiveEffort = reasoningEffort ?? defaultReasoningEffortFor(activeModel);

  function reset() {
    setTask('');
    setName('');
    setDescription('');
    setTags([]);
    setTagInput('');
    setProjectId('');
    setSourceDrafts([]);
    setPrimaryAlias(undefined);
    setAgentRef(undefined);
    setSelectedAgent(undefined);
    setModel(getDefaultChatModel());
    setReasoningEffort(undefined);
    setOrchestratorMode(false);
    setPlanFirst(false);
    setBrowser(DEFAULT_BROWSER_SETTINGS);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      close();
      reset();
    }
  }

  function currentDraft(): CreateChatDraft {
    return {
      ...EMPTY_CREATE_CHAT_DRAFT,
      prompt: task,
      name,
      description,
      tags,
      who: agentRef ? (selectedAgent?.role === 'orchestrator' ? 'orchestrator' : 'agent') : 'model',
      agentRef,
      orchestratorMode: selectedAgent?.role === 'orchestrator' ? true : orchestratorMode,
      planFirst,
      model,
      reasoningEffort: effectiveEffort,
      projectId: projectId || undefined,
      primaryAlias,
      sources: [],
      browser,
    };
  }

  const blockingReason = chatCreateBlockingReason({ draft: currentDraft(), sourceDrafts }, 'start');

  async function handleSubmit() {
    if (blockingReason || submitting) return;
    setSubmitting(true);
    try {
      const params = buildCreateChatParams({ draft: currentDraft(), sourceDrafts });
      const chat = await createChat.mutateAsync(params);
      // Fire-and-forget: the server returns before persisting the user
      // message (useSendChatPromptTo's own doc comment); SSE handles the rest.
      sendFirstPrompt.mutate({ chatId: chat.id, prompt: task, ...(planFirst ? { mode: 'plan' as const } : {}) });
      close();
      reset();
      navigate(`/chats/${chat.id}`);
    } catch (err) {
      toast.error("Couldn't start the chat", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  // The footer advertises Ctrl/⌘ ↵ (modChord): wire the real key while the dialog is open.
  const submitRef = useRef(handleSubmit);
  submitRef.current = handleSubmit;
  useEffect(() => {
    if (!isOpen) return;
    // Capture phase: ⌘/Ctrl ↵ submits from any field — a focused switch or radio
    // (Orchestrate mode) used to take the Enter, flip itself and swallow the chord.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      void submitRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen]);

  function openFullPage() {
    const draft: Partial<CreateChatDraft> = currentDraft();
    close();
    // The picked sources travel too: "More options" continues this form, it does not restart it.
    navigate('/chats/new', { state: { draft, sourceDrafts } });
    reset();
  }

  // Home's quick composer (a sibling feature) hands a prefilled draft to
  // `useNewChatStore.getState().open(draft)` — pick it up on open (04 §0:
  // cross-feature via the store, never an import).
  useEffect(() => {
    if (!isOpen || !initialDraft) return;
    if (initialDraft.prompt !== undefined) setTask(initialDraft.prompt);
    if (initialDraft.name !== undefined) setName(initialDraft.name);
    if (initialDraft.projectId !== undefined) setProjectId(initialDraft.projectId);
    if (initialDraft.model) setModel(initialDraft.model);
    // The resolved Agent (name, role, skills…) is not in the handoff, only its
    // ref — the picker looks it up itself; `selectedAgent`-derived state
    // (who/orchestratorMode/capability summary) catches up once it resolves.
    if (initialDraft.agentRef) setAgentRef(initialDraft.agentRef);
    if (initialDraft.planFirst) setPlanFirst(true);
    // Only on open: this seeds the form once, it must not fight the user's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const capabilitySummary = selectedAgent
    ? `${selectedAgent.skillIds.length} skill${selectedAgent.skillIds.length === 1 ? '' : 's'} · ${selectedAgent.mcpServerIds.length} MCP server${selectedAgent.mcpServerIds.length === 1 ? '' : 's'} · from ${selectedAgent.name}`
    : '0 skills · 0 MCP servers · platform default';

  const optionsSummary = [
    description.trim() ? 'Description' : null,
    tags.length > 0 ? `${tags.length} tag${tags.length === 1 ? '' : 's'}` : 'tags',
    `orchestrate mode ${orchestratorMode ? 'on' : 'off'}`,
    planFirst ? 'plan first' : null,
    `browser ${browser.visibility}`,
  ]
    .filter(Boolean)
    .join(' · ');

  function addTag() {
    const next = tagInput.trim();
    if (!next || tags.includes(next) || tags.length >= 20) {
      setTagInput('');
      return;
    }
    setTags([...tags, next]);
    setTagInput('');
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange} size="md" title="New chat">
      <DialogBody>
        {/* ── Task ── */}
        <div className="flex flex-col gap-2.5">
          <Textarea
            aria-label="Task"
            placeholder="Describe the task — what should the agent do, and how will you know it is done?"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            autosize={{ minRows: 4, maxRows: 8 }}
          />
          <Field label="Name" orientation="horizontal" labelWidth={64}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={chatCreateDisplayName({ name: '', prompt: task }) || 'Named from the task if left empty'}
            />
          </Field>
        </div>

        {/* ── Where ── */}
        <section className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2">
            <h3 className="text-ui font-semibold text-fg">Where</h3>
            <span className="text-small text-fg-3">What the agent works on. The first source is its working directory.</span>
          </div>
          <SourcePicker
            chatName={chatCreateDisplayName({ name, prompt: task }) || 'chat'}
            compact
            projectId={projectId}
            onProjectIdChange={setProjectId}
            drafts={sourceDrafts}
            onChange={setSourceDrafts}
            primaryAlias={primaryAlias}
            onPrimaryChange={setPrimaryAlias}
            maxSources={8}
          />
        </section>

        {/* ── Who ── */}
        <section className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2">
            <h3 className="text-ui font-semibold text-fg">Who</h3>
            <span className="text-small text-fg-3">The agent brings its own instructions, skills and MCP servers.</span>
          </div>
          {/* Column labels (board NewChat); each control keeps its own accessible name. Effort gets its own row:
              a model with five or six levels truncated every label in a third of the dialog. */}
          <div className="grid grid-cols-2 items-end gap-x-3 gap-y-1.5">
            <span className="text-small text-fg-2">Agent</span>
            <span className="text-small text-fg-2">Model</span>
            <AgentPicker
              value={agentRef}
              onChange={(ref, agent) => {
                setAgentRef(ref);
                setSelectedAgent(agent);
                if (agent?.role === 'orchestrator') setOrchestratorMode(true);
                const runtime = agentRuntimeSelection(agent);
                if (runtime.model) setModel(runtime.model);
                if (runtime.reasoningEffort) setReasoningEffort(runtime.reasoningEffort);
              }}
              projectId={projectId || undefined}
              placeholder="No agent"
              showSummary={false}
            />
            <ModelPicker value={model} onChange={setModel} variant="field" ariaLabel="Model" />
          </div>
          {reasoningLevels.length > 0 ? (
            <div className="flex items-center gap-3">
              <span className="text-small text-fg-2">Effort</span>
              <SegmentedControl
                label="Reasoning effort"
                value={effectiveEffort ?? reasoningLevels[0] ?? 'medium'}
                onValueChange={setReasoningEffort}
                items={reasoningLevels.map((level) => ({ value: level, label: reasoningEffortLabel(level) }))}
              />
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-small text-fg-3">
            <Icon concept="skills" size={14} />
            {capabilitySummary}
          </div>
        </section>

        {/* ── Options ── */}
        <div className="flex items-center gap-2">
          <Collapsible
            trigger={
              <span className="flex items-center gap-1.5">
                Options
                <span className="truncate text-small text-fg-3">{optionsSummary}</span>
              </span>
            }
            variant="attached"
            className="flex-1"
          >
            <div className="flex flex-col gap-3">
              <Field label="Description" optional>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown in the chat list" />
              </Field>
              <Field label="Tags" optional hint="↵ to add · up to 20">
                <div className="flex flex-wrap items-center gap-1.5">
                  {tags.map((tag) => (
                    <Chip key={tag} onRemove={() => setTags(tags.filter((t) => t !== tag))}>
                      {tag}
                    </Chip>
                  ))}
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="Add tag"
                    className="max-w-32"
                  />
                </div>
              </Field>
              <Switch
                checked={orchestratorMode}
                disabled={selectedAgent?.role === 'orchestrator'}
                onCheckedChange={setOrchestratorMode}
                label="Orchestrate mode"
              />
              <Switch checked={planFirst} onCheckedChange={setPlanFirst} label="Plan first — review a plan before anything changes" />
              <BrowserVisibilityField value={browser} onChange={setBrowser} compact />
              <Button variant="ghost" size="sm" onClick={openFullPage} className="self-start">
                More options — open the full page
              </Button>
            </div>
          </Collapsible>
        </div>
      </DialogBody>
      <DialogFooter hint={<KbdHintRow hints={[{ keys: 'Esc', label: 'to close' }]} />}>
        <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
        <Button
          variant="primary"
          shortcut={modChord('Enter')}
          disabled={!!blockingReason || submitting}
          loading={submitting}
          onClick={() => void handleSubmit()}
          title={blockingReason ?? undefined}
        >
          Start chat
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
