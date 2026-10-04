// ────────────────────────────────────────────────────────────────
// Composer (03 §3.2 F-composer-01…24; board ComposerStates) — the chat's
// message box, and (variant `stage`) the compact box of a workflow stage.
//
// A thin host: the logic is the eight composer hooks (`./hooks/`, 03 §6.1)
// over the shared composer machine in client-core (M-12); the parts in
// `./parts/` are presentational. Local UI state here is only which per-turn
// menu is open (one at a time; outside click and a capture-phase Escape close
// it) and the box's focus.
//
// The composer never owns the turn: Stop / Stopping… / Force reset come from
// the page (`stopState`, `onStop`) and the send goes through `customSendFn`
// when the host supplies one. Typing is never blocked (D-29); the one
// blocking bar above the box says why Send is held back.
//
// Layout (Comfortable): column max 760 inside the transcript column; box =
// 1px line, radius dialog (12), `raised`, pad 12/10/8/14; toolbar row; team
// row (orchestrator agents); under the box the meta row (Sources · Skills·MCP)
// and the key-hint row. Menus open upward from their chip.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import {
  AGENT_MODES,
  AGENT_MODE_REGISTRY,
  DEFAULT_AGENT_MODE,
  type AgentMode,
  type Chat,
  type WorkspacePrepStatus,
} from '@generatorai/shared';
import { reasoningEffortLabel, type ComposerVariant } from '@generatorai/shared/ui-contract';
import {
  formatTokenLimit,
  slashCommandGroup,
  type SlashCommand,
  type SlashCommandGroup,
} from '@generatorai/client-core';
import { useProjectCodebases } from '@/hooks/projectQueries.js';
import { useBackgroundTasks } from '@/hooks/queries.js';
import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import { ModelPicker } from '@/blocks/model-picker/index.js';
import { cn } from '@/ui/lib/cn.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { KbdHintRow, type KbdHint } from '@/ui/patterns/KbdHintRow/KbdHintRow.js';
import type { CaptureSource } from './model/types.js';
import type { PromptHistoryEntry } from './model/promptHistory.js';
import { COMPOSER } from './hooks/affordances.js';
import { useComposerDraft } from './hooks/useComposerDraft.js';
import { useComposerHistory } from './hooks/useComposerHistory.js';
import { useComposerMenus } from './hooks/useComposerMenus.js';
import { useComposerModelControls } from './hooks/useComposerModelControls.js';
import { useComposerSend } from './hooks/useComposerSend.js';
import { useDictation } from './hooks/useDictation.js';
import { useComposerKeymap } from './hooks/useComposerKeymap.js';
import { useToolbarCollapse } from './hooks/useToolbarCollapse.js';
import { useComposerTools } from './toolToggles.js';
import { AttachingChip, ComposerChip } from './parts/AttachmentChips.js';
import { AgentChip, OrchestratingChip, SkillsMcpChip, TeamRow } from './parts/Binding.js';
import { BlockingBar } from './parts/BlockingBar.js';
import { ComposerMenu, type ComposerMenuItem } from './parts/ComposerMenu.js';
import { ComposerSkeleton } from './parts/ComposerSkeleton.js';
import { ContextGauge } from './parts/ContextGauge.js';
import { DictationControl } from './parts/DictationControl.js';
import { SendStopButton } from './parts/SendStopButton.js';
import { SourcesChipView, type SourceFallback } from './parts/SourcesChip.js';
import { ToolbarChip, ToolbarOption, ToolbarPopup, ToolbarPopupHeader } from './parts/ToolbarMenu.js';
import { ToolsPopover } from './parts/ToolsPopover.js';

interface LocalFolderInput {
  url: string;
  branch: string;
  alias: string;
}

export interface ComposerProps {
  /** Session id used for stream-store keying. */
  sessionId: string;
  disabled: boolean;
  placeholder: string;
  /**
   * Pinned under a page's scrolling column, like the chat's composer: the same frame (padding,
   * centred reading width). The `chat` variant always is; a `stage` box is when a run page pins it.
   */
  docked?: boolean;
  /** `chat` (default): the full composer. `stage`: the compact box for a workflow stage message (no meta or hint row). */
  variant?: Extract<ComposerVariant, 'chat' | 'stage'>;
  onBeforeSend?: () => Promise<void>;
  /** The host's send (the chat page merges its captures); without it the composer posts to the session. */
  customSendFn?: (args: { prompt: string; attachments: File[]; mode?: AgentMode }) => Promise<void>;
  /** Start/clear the optimistic turn on `sessionId`'s stream (default true; a workflow stage passes false). */
  manageStream?: boolean;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  reasoningEffort?: string;
  onReasoningEffortChange?: (effort: string) => void;
  /** 'default' | 'long_context'. */
  contextTier?: string;
  onContextTierChange?: (tier: string) => void;
  /** Local folders the chat was created with (Sources fallback before mounts are known). */
  gitRepositories?: LocalFolderInput[];
  projectId?: string;
  codebaseIds?: string[];
  /** Enables `@` file mentions and the Sources popover's mounts. */
  workspaceId?: string;
  showModelSelector?: boolean;
  /** A turn is streaming (Send becomes Stop when there is an `onStop`). */
  isStreaming?: boolean;
  /** What the Stop control says and whether it takes a press — owned by the page (two-phase stop). */
  stopState?: { label: string; enabled: boolean; forceAvailable: boolean };
  onStop?: () => void;
  /** Captures (browser comments, terminal selections) owned by the page: filled chips, merged on send. */
  pendingCaptures?: Array<{ id: string; file: File; source: CaptureSource; label?: string }>;
  onRemovePendingCapture?: (id: string) => void;
  /** Awaited before a built-in `/browser` / `/terminal` is dispatched so the page can surface the panel. */
  onBuiltinCommand?: (commandId: string) => void | Promise<void>;
  agentMode?: AgentMode;
  onAgentModeChange?: (mode: AgentMode) => void;
  /** Hidden in background-worker chats. */
  showAgentModePicker?: boolean;
  /** Set while a gate is open; the server refuses prompts until it closes. */
  pendingInteractionLabel?: string | null;
  onCancelPendingInteraction?: () => void;
  workspacePrep?: { status: WorkspacePrepStatus; error?: string } | undefined;
  onRetryWorkspacePrep?: (() => void) | undefined;
  workspacePrepRetrying?: boolean;
  onEditSources?: (() => void) | undefined;
  /** Name of the (worker) agent driving this chat — a read-only chip. */
  agentName?: string | undefined;
  /** The chat (binding: orchestrate mode, orchestrator team, skills·MCP; tool toggles). */
  chat?: Chat | undefined;
  /** Open the Background tasks dock tab (Orchestrating chip, team row). */
  onOpenTasks?: (() => void) | undefined;
  /** Rendered in the composer column directly above the box (the changes tray). */
  aboveComposer?: ReactNode;
  /** Prompts already sent (oldest → newest) for ↑ / ↓ recall. */
  promptHistory?: PromptHistoryEntry[];
  /** A prompt handed back by a rewind; `at` is the delivery token. Never auto-sent. */
  restoredDraft?: { text: string; at: number } | undefined;
}

const AGENT_MODE_OPTIONS = AGENT_MODES.map((mode) => ({
  mode,
  label: AGENT_MODE_REGISTRY[mode].label,
  description: AGENT_MODE_REGISTRY[mode].description,
}));

const GROUP_LABEL: Record<SlashCommandGroup, string> = { tools: 'Tools', skills: 'Skills', prompts: 'Prompts' };

function commandIcon(c: SlashCommand): IconConcept {
  if (c.id === 'builtin:browser') return 'browser';
  if (c.id === 'builtin:terminal') return 'terminal';
  if (c.kind === 'skill') return 'skills';
  if (c.kind === 'prompt') return 'file-text';
  return 'tool';
}

const CAPTURE_ICON: Record<CaptureSource, IconConcept> = {
  browser: 'browser',
  terminal: 'terminal',
  file: 'attach',
  mention: 'mention',
};

type PerTurnMenu = 'mode' | 'effort' | 'tier' | 'more' | null;

const NO_FOLDERS: LocalFolderInput[] = [];

function copyPath(path: string): void {
  void navigator.clipboard?.writeText(path);
}

export function Composer({
  sessionId,
  disabled,
  placeholder,
  variant = 'chat',
  onBeforeSend,
  customSendFn,
  manageStream = true,
  selectedModel,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
  contextTier,
  onContextTierChange,
  gitRepositories = NO_FOLDERS,
  projectId,
  codebaseIds,
  workspaceId,
  showModelSelector = true,
  isStreaming = false,
  onStop,
  stopState,
  pendingCaptures,
  onRemovePendingCapture,
  onBuiltinCommand,
  agentMode,
  onAgentModeChange,
  showAgentModePicker = true,
  pendingInteractionLabel,
  onCancelPendingInteraction,
  workspacePrep,
  onRetryWorkspacePrep,
  workspacePrepRetrying = false,
  onEditSources,
  agentName,
  chat,
  onOpenTasks,
  aboveComposer,
  docked,
  promptHistory,
  restoredDraft,
}: ComposerProps) {
  const compact = variant === 'stage';
  const [openMenu, setOpenMenu] = useState<PerTurnMenu>(null);
  const activeAgentMode: AgentMode = agentMode ?? DEFAULT_AGENT_MODE;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const menusRef = useRef<HTMLDivElement>(null);

  // ── Composer logic (03 §6.1) ──
  const draft = useComposerDraft({ workspaceId });
  const { text, attachments, activeCommand, setActiveCommand, menu, setMenu, menuIndex, setMenuIndex } = draft;
  const history = useComposerHistory({ promptHistory, restoredDraft, draft, textareaRef });
  const menus = useComposerMenus({ projectId, workspaceId, draft, textareaRef });
  const { filteredCommands, filteredMentions, fileIndexLoading, mentionLoading, applyMenuSelection } = menus;
  const models = useComposerModelControls({ sessionId, selectedModel, onModelChange, reasoningEffort, contextTier });
  const {
    modelsPending,
    displayModel,
    activeModel,
    reasoningLevels,
    effectiveEffort,
    contextTiers,
    effectiveTier,
    activeTierTokens,
    hasReasoning,
    hasContext,
  } = models;
  const send = useComposerSend({
    sessionId,
    draft,
    history,
    disabled,
    pendingCaptures,
    pendingInteractionLabel,
    workspacePrep,
    agentMode: activeAgentMode,
    onBeforeSend,
    customSendFn,
    onBuiltinCommand,
    turnLive: isStreaming && !!onStop,
    stopState,
    manageStream,
  });
  const dictation = useDictation({ textareaRef, text, setText: draft.setText });
  const { handleKeyDown, handleTextChange, handlePaste, handleClick } = useComposerKeymap({
    textareaRef,
    draft,
    menus,
    history,
    send,
    dictation,
  });
  const collapseControls = useToolbarCollapse(toolbarRef);

  // ── Binding (who the next turn goes to) ──
  const snapshot = chat?.agentSnapshot;
  const isOrchestratorAgent = snapshot?.driving?.role === 'orchestrator';
  const orchestrating = !!chat?.orchestratorMode || isOrchestratorAgent;
  const { data: tasksData } = useBackgroundTasks(chat?.id, orchestrating && !compact);
  const runningTasks = (tasksData?.tasks ?? []).filter((t) => t.status === 'running' || t.status === 'spawned').length;
  const team = useMemo(
    () => (snapshot?.team ?? []).map((m) => ({ ref: m.ref, name: m.name, model: m.model })),
    [snapshot?.team],
  );
  const skillNames = snapshot?.skills?.names ?? [];
  const mcpNames = useMemo(() => Object.keys(snapshot?.mcpServers ?? {}), [snapshot?.mcpServers]);

  // ── Sources (mounts, or what the chat was created with) ──
  const { data: workspaceInfo } = useWorkspaceInfo(workspaceId, !compact);
  const { data: projectCodebases, isLoading: codebasesLoading } = useProjectCodebases(projectId);
  const sourceFallback = useMemo<SourceFallback>(() => {
    const folders = gitRepositories.map((r) => r.url).filter((u) => u.trim());
    return {
      projectLinked: !!projectId,
      codebases: (projectCodebases ?? [])
        .filter((cb) => (codebaseIds ?? []).includes(cb.id))
        .map((cb) => ({ id: cb.id, alias: cb.alias, kind: cb.type === 'local-dir' ? ('folder' as const) : ('git' as const) })),
      codebasesLoading,
      folders,
      count: (codebaseIds?.length ?? 0) + folders.length,
    };
  }, [gitRepositories, projectId, projectCodebases, codebaseIds, codebasesLoading]);

  // ── Tool toggles (registry; hidden while nothing is registered) ──
  const { tools, setTool } = useComposerTools(chat);

  // Auto-grow the box with its content, up to 200px (then it scrolls).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // One per-turn menu at a time; outside press or Escape (capture phase, so
  // nothing behind the composer also reacts) closes it.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (menusRef.current && !menusRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [openMenu]);

  const toggleMenu = useCallback((which: Exclude<PerTurnMenu, null>) => {
    setOpenMenu((current) => (current === which ? null : which));
  }, []);

  // ── `/` and `@` menu rows ──
  const menuItems = useMemo<ComposerMenuItem[]>(() => {
    if (!menu) return [];
    if (menu.type === 'slash') {
      let lastGroup: SlashCommandGroup | null = null;
      const multiGroup = new Set(filteredCommands.map((c) => slashCommandGroup(c))).size > 1;
      return filteredCommands.map((c) => {
        const group = slashCommandGroup(c);
        const startsGroup = multiGroup && group !== lastGroup;
        lastGroup = group;
        return {
          id: c.id,
          title: `/${c.name}`,
          subtitle: c.description,
          icon: commandIcon(c),
          badge: c.source === 'builtin' ? 'tool' : c.kind,
          group: startsGroup ? GROUP_LABEL[group] : undefined,
          monoTitle: true,
        };
      });
    }
    return filteredMentions.map((f) => ({
      id: `${f.source}:${f.worktreeAlias ?? ''}:${f.path}`,
      title: f.label,
      subtitle: f.path,
      icon: 'file' as const,
      badge: f.source === 'worktree' ? f.worktreeAlias : undefined,
    }));
  }, [menu, filteredCommands, filteredMentions]);
  const highlightedCommand = menu?.type === 'slash' ? filteredCommands[menuIndex] : undefined;

  const hints = useMemo<KbdHint[]>(() => {
    const out: KbdHint[] = [];
    if (COMPOSER.sendShortcut) out.push({ keys: '↵', label: 'Send' }, { keys: ['Shift', '↵'], label: 'New line' });
    out.push({ keys: '/', label: 'Skills' });
    if (workspaceId) out.push({ keys: '@', label: 'Files' });
    out.push({ keys: '↑', label: 'History' });
    return out;
  }, [workspaceId]);

  // Subtrees that do not change while typing are built once per input change,
  // not on every keystroke (the textarea re-renders the host per character).
  const modelPicker = useMemo(
    () =>
      showModelSelector ? (
        <ModelPicker
          variant="chip"
          side="top"
          align="start"
          value={displayModel}
          onChange={(id) => onModelChange?.(id)}
          ariaLabel="Select model"
        />
      ) : null,
    [showModelSelector, displayModel, onModelChange],
  );
  const gauge = useMemo(
    () =>
      showModelSelector && activeModel ? (
        <ContextGauge
          snapshot={models.contextUsage}
          usage={models.usage}
          model={activeModel}
          tier={effectiveTier}
          showLabel={!collapseControls}
        />
      ) : null,
    [showModelSelector, activeModel, models.contextUsage, models.usage, effectiveTier, collapseControls],
  );
  const sourcesChip = useMemo(
    () =>
      compact ? null : (
        <SourcesChipView
          mounts={workspaceInfo?.mounts}
          fallback={sourceFallback}
          onEditSources={onEditSources}
          onCopyPath={copyPath}
          disabled={disabled}
        />
      ),
    [compact, workspaceInfo?.mounts, sourceFallback, onEditSources, disabled],
  );

  // Hold the composer back until the model catalog resolves: model-derived
  // controls mounted early flashed an empty picker and a 0% gauge. Not gated
  // on error — a failed catalog still leaves a usable composer.
  if (modelsPending) return <ComposerSkeleton compact={compact} />;

  const { blocking, canSend, primaryAction, isLoading, handleSend } = send;
  const showPerTurn = showModelSelector && !!activeModel;
  const tierLabel = activeTierTokens ? formatTokenLimit(activeTierTokens) : 'Context';

  const effortList = (asOption: boolean, close: boolean) =>
    reasoningLevels.map((level) => (
      <ToolbarOption
        key={level}
        asOption={asOption}
        selected={effectiveEffort === level}
        onClick={() => {
          onReasoningEffortChange?.(level);
          if (close) setOpenMenu(null);
        }}
      >
        {reasoningEffortLabel(level)}
      </ToolbarOption>
    ));
  const tierList = (asOption: boolean, close: boolean) =>
    contextTiers.map((t) => (
      <ToolbarOption
        key={t.tier}
        asOption={asOption}
        selected={effectiveTier === t.tier}
        trailing={formatTokenLimit(t.tokens)}
        onClick={() => {
          onContextTierChange?.(t.tier);
          if (close) setOpenMenu(null);
        }}
      >
        {t.tier === 'long_context' ? 'Long context' : 'Standard'}
      </ToolbarOption>
    ));

  return (
    <div
      className={cn('bg-surface', (!compact || docked) && 'px-2 pt-3 pb-3 sm:px-4')}
      onDrop={draft.handleDrop}
      onDragOver={draft.handleDragOver}
      data-testid="composer"
    >
      <div className={cn('mx-auto w-full', (!compact || docked) && 'max-w-190')}>
        {aboveComposer}
        <BlockingBar
          blocking={blocking}
          prepError={workspacePrep?.error}
          onRetryPrep={onRetryWorkspacePrep}
          retryingPrep={workspacePrepRetrying}
          onEditSources={onEditSources}
          waitingLabel={pendingInteractionLabel}
          onCancelWaiting={onCancelPendingInteraction}
        />

        {/* ── The box ── */}
        <div
          className={cn(
            'relative rounded-dialog border border-line bg-raised transition-control focus-within:border-line-strong',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <ComposerMenu
            open={!!menu}
            kind={menu?.type ?? 'slash'}
            items={menuItems}
            activeIndex={menuIndex}
            onSelect={applyMenuSelection}
            onHover={setMenuIndex}
            loading={menu?.type === 'mention' && fileIndexLoading}
            footerNote={highlightedCommand?.argHint ? `Then: ${highlightedCommand.argHint}` : undefined}
          />

          {/* Attachments */}
          {attachments.length > 0 || (pendingCaptures?.length ?? 0) > 0 || mentionLoading ? (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
              {attachments.map((att) => (
                <ComposerChip
                  key={att.id}
                  file={att.file}
                  label={att.label ?? att.file.name}
                  kind={att.source === 'mention' ? 'mention' : 'file'}
                  onRemove={() => draft.removeAttachment(att.id)}
                />
              ))}
              {mentionLoading ? <AttachingChip /> : null}
              {(pendingCaptures ?? []).map((cap) => (
                <ComposerChip
                  key={cap.id}
                  file={cap.file}
                  label={cap.label ?? cap.file.name}
                  title={`${cap.source} capture — ${cap.label ?? cap.file.name}`}
                  kind="capture"
                  icon={CAPTURE_ICON[cap.source]}
                  onRemove={onRemovePendingCapture ? () => onRemovePendingCapture(cap.id) : undefined}
                />
              ))}
            </div>
          ) : null}

          {/* Text (+ the active /command pill) */}
          <div className={cn('pr-2.5 pl-3.5', compact ? 'pt-2' : 'pt-3')}>
            {activeCommand ? (
              <span className="mb-1.5 inline-flex h-control-sm items-center gap-1 rounded-control-sm bg-selected pr-0.5 pl-1.5 font-mono text-small text-fg">
                <span>/{activeCommand.name}</span>
                <IconButton
                  icon="x"
                  size="sm"
                  tooltip={false}
                  label={`Remove /${activeCommand.name} command`}
                  className="size-4"
                  onClick={() => {
                    setActiveCommand(null);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                />
              </span>
            ) : null}
            <Textarea
              ref={textareaRef}
              variant="inline"
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onClick={handleClick}
              onBlur={() => {
                setTimeout(() => setMenu(null), 120);
              }}
              disabled={disabled}
              placeholder={activeCommand?.argHint ?? placeholder}
              aria-label="Message"
              rows={1}
              textareaClassName={cn('max-h-50 overflow-y-auto', compact ? 'min-h-10' : 'min-h-14')}
            />
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2 px-2 pt-0.5 pb-2">
            <div ref={toolbarRef} className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {/* W29: absent, not disabled, where the surface declares no attachments. */}
              {COMPOSER.attachments ? (
                <IconButton
                  icon="plus"
                  label="Attach file"
                  tooltip={false}
                  title="Attach file"
                  disabled={disabled}
                  onClick={() => fileInputRef.current?.click()}
                />
              ) : null}
              <ToolsPopover
                disabled={disabled}
                items={tools.map((t) => ({
                  id: t.entry.id,
                  label: t.entry.label,
                  hint: t.entry.hint,
                  icon: t.entry.icon as IconConcept,
                  on: t.on,
                  pending: t.pending,
                }))}
                onToggle={(id, on) => void setTool(id, on)}
              />

              {agentName ? <AgentChip name={agentName} /> : null}
              {!compact && chat?.orchestratorMode && !snapshot?.driving ? (
                <OrchestratingChip running={runningTasks} onOpenTasks={onOpenTasks} />
              ) : null}

              {modelPicker}

              <div ref={menusRef} className="contents">
                {showAgentModePicker ? (
                  <span className="relative inline-flex shrink-0">
                    <ToolbarChip
                      icon={activeAgentMode === 'plan' ? 'plan' : 'zap'}
                      accent={activeAgentMode === 'plan'}
                      aria-haspopup="listbox"
                      aria-expanded={openMenu === 'mode'}
                      aria-label={`Agent mode: ${AGENT_MODE_REGISTRY[activeAgentMode].label}`}
                      title={AGENT_MODE_REGISTRY[activeAgentMode].description}
                      onClick={() => toggleMenu('mode')}
                    >
                      {AGENT_MODE_REGISTRY[activeAgentMode].label}
                    </ToolbarChip>
                    {openMenu === 'mode' ? (
                      <ToolbarPopup widthClass="w-64" role="listbox" aria-label="Agent mode">
                        <ToolbarPopupHeader>Agent mode</ToolbarPopupHeader>
                        {AGENT_MODE_OPTIONS.map((o) => (
                          <ToolbarOption
                            key={o.mode}
                            selected={activeAgentMode === o.mode}
                            description={o.description}
                            onClick={() => {
                              onAgentModeChange?.(o.mode);
                              setOpenMenu(null);
                            }}
                          >
                            {o.label}
                          </ToolbarOption>
                        ))}
                      </ToolbarPopup>
                    ) : null}
                  </span>
                ) : null}

                {showPerTurn && !collapseControls && hasReasoning ? (
                  <span className="relative inline-flex shrink-0">
                    <ToolbarChip
                      aria-haspopup="listbox"
                      aria-expanded={openMenu === 'effort'}
                      title="Reasoning effort"
                      onClick={() => toggleMenu('effort')}
                    >
                      Effort: {effectiveEffort ? reasoningEffortLabel(effectiveEffort) : 'Default'}
                    </ToolbarChip>
                    {openMenu === 'effort' ? (
                      <ToolbarPopup widthClass="w-44" role="listbox" aria-label="Reasoning effort">
                        <ToolbarPopupHeader>Reasoning effort</ToolbarPopupHeader>
                        {effortList(true, true)}
                      </ToolbarPopup>
                    ) : null}
                  </span>
                ) : null}

                {showPerTurn && !collapseControls && hasContext ? (
                  <span className="relative inline-flex shrink-0">
                    <ToolbarChip
                      aria-haspopup="listbox"
                      aria-expanded={openMenu === 'tier'}
                      title="Context window"
                      className="font-mono"
                      onClick={() => toggleMenu('tier')}
                    >
                      {tierLabel}
                    </ToolbarChip>
                    {openMenu === 'tier' ? (
                      <ToolbarPopup widthClass="w-48" role="listbox" aria-label="Context window">
                        <ToolbarPopupHeader>Context window</ToolbarPopupHeader>
                        {tierList(true, true)}
                      </ToolbarPopup>
                    ) : null}
                  </span>
                ) : null}

                {showPerTurn && collapseControls && (hasReasoning || hasContext) ? (
                  <span className="relative inline-flex shrink-0">
                    <IconButton
                      icon="more"
                      label="More options"
                      tooltip={false}
                      title="More options"
                      aria-haspopup="menu"
                      aria-expanded={openMenu === 'more'}
                      pressed={openMenu === 'more' ? true : undefined}
                      onClick={() => toggleMenu('more')}
                    />
                    {openMenu === 'more' ? (
                      <ToolbarPopup widthClass="w-52" role="group" aria-label="More options">
                        {hasReasoning ? (
                          <>
                            <ToolbarPopupHeader>Reasoning effort</ToolbarPopupHeader>
                            {effortList(false, false)}
                          </>
                        ) : null}
                        {hasContext ? (
                          <>
                            <ToolbarPopupHeader className={cn(hasReasoning && 'mt-1 border-t border-line-soft')}>
                              Context window
                            </ToolbarPopupHeader>
                            {tierList(false, false)}
                          </>
                        ) : null}
                      </ToolbarPopup>
                    ) : null}
                  </span>
                ) : null}
              </div>

              {gauge}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <DictationControl
                disabled={disabled || isLoading || isStreaming}
                isSupported={dictation.voiceSupported}
                status={dictation.voiceStatus}
                error={dictation.voiceError}
                amplitude={dictation.voiceAmplitude}
                onStart={dictation.handleVoiceStart}
                onResume={dictation.resumeVoice}
                onStop={dictation.stopVoice}
                onCancel={dictation.handleVoiceCancel}
                deviceLabel={dictation.resolvedMicId ? dictation.micDeviceLabel : undefined}
              />
              <SendStopButton
                primaryAction={primaryAction}
                canSend={canSend}
                sending={isLoading}
                stopState={stopState}
                onSend={() => void handleSend()}
                onStop={onStop}
              />
            </div>
          </div>

          {!compact && isOrchestratorAgent ? <TeamRow team={team} running={runningTasks} onOpenTasks={onOpenTasks} /> : null}
        </div>

        {/* Meta row + key hints */}
        {!compact ? (
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
            {sourcesChip}
            {snapshot ? <SkillsMcpChip skills={skillNames} mcpServers={mcpNames} /> : null}
            <KbdHintRow hints={hints} className="ml-auto hidden md:flex" />
          </div>
        ) : null}

        <Input ref={fileInputRef} type="file" multiple className="hidden" onChange={draft.handleFilesChanged} aria-label="Attach files" />
      </div>
    </div>
  );
}
