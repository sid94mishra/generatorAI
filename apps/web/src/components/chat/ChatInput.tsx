// ────────────────────────────────────────────────────────────────
// ChatInput — Modern Copilot-style input with unified toolbar,
// model selection, codebase picker, and file attachment support
//
// The view. Its logic lives in the composer hooks
// (`./composer/hooks/`, 03-component-inventory-domain.md §6.1) and the
// shared composer machine in client-core (M-12); this file is JSX plus local
// UI state (focus, which per-turn menu is open).
// ────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useProjectCodebases } from '@/hooks/projectQueries.js';
import { ComposerMenu, type ComposerMenuItem } from './composer/ComposerMenu.js';
import type { SlashCommand, CaptureSource } from './composer/types.js';
import type { AgentMode, WorkspacePrepStatus } from '@generatorai/shared';
import { WorkspacePrepBar } from './sources/WorkspacePrepBar.js';
import { AGENT_MODES, AGENT_MODE_REGISTRY, DEFAULT_AGENT_MODE } from '@generatorai/shared';
import {
  Paperclip, X, Plus,
  FolderOpen, FolderGit2, GitBranch, ChevronDown, ChevronUp,
  Square, ArrowUp, Check, Image as ImageIcon,
  Globe, SlidersHorizontal,
  Sparkles, ScrollText, Wrench, FileText, TerminalSquare, AtSign,
  ClipboardList, Zap, Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { ModelPicker, formatTokens } from '@/components/shared/ModelPicker.js';
import { ContextUsageGauge } from '@/components/shared/ContextUsageGauge.js';
import { Button, Input, Textarea, Spinner } from '@/components/ui/index.js';
import { VoiceRecorder } from './VoiceRecorder.js';
import { ImageHoverPreview, useObjectUrl, isPreviewableImage } from '@/components/shared/ImageHoverPreview.js';
import type { PromptHistoryEntry } from './composer/promptHistory.js';
import { COMPOSER } from './composer/hooks/affordances.js';
import { useComposerDraft } from './composer/hooks/useComposerDraft.js';
import { useComposerHistory } from './composer/hooks/useComposerHistory.js';
import { useComposerMenus } from './composer/hooks/useComposerMenus.js';
import { useComposerModelControls } from './composer/hooks/useComposerModelControls.js';
import { useComposerSend } from './composer/hooks/useComposerSend.js';
import { useDictation } from './composer/hooks/useDictation.js';
import { useComposerKeymap } from './composer/hooks/useComposerKeymap.js';
import { useToolbarCollapse } from './composer/hooks/useToolbarCollapse.js';


interface GitRepoInput {
  url: string;
  branch: string;
  alias: string;
}

interface ChatInputProps {
  /** Session ID used for stream store keying */
  sessionId: string;
  disabled: boolean;
  placeholder: string;
  onBeforeSend?: () => Promise<void>;
  customSendFn?: (args: { prompt: string; attachments: File[]; mode?: AgentMode }) => Promise<void>;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  /** Currently selected reasoning-effort level (bound to model capability) */
  reasoningEffort?: string;
  /** Called when the user picks a reasoning-effort level */
  onReasoningEffortChange?: (effort: string) => void;
  /** Currently selected context-window tier ('default' | 'long_context') */
  contextTier?: string;
  /** Called when the user picks a context-window tier */
  onContextTierChange?: (tier: string) => void;
  /** Local folder paths (read-only display) */
  gitRepositories?: GitRepoInput[];
  projectId?: string;
  codebaseIds?: string[];
  /** Workspace id (enables `@` file-mention search when present). */
  workspaceId?: string;
  showModelSelector?: boolean;
  showGitConnector?: boolean;
  /** Callback to toggle sidebar file panel */
  onToggleFilesPanel?: () => void;
  /** Whether files panel is currently open */
  filesPanelOpen?: boolean;
  /** Whether the model is currently generating (for stop button) */
  isStreaming?: boolean;
  /**
   * W30-b — what the Stop control should say and whether it accepts a press.
   *
   * Supplied by the page (which owns the turn), not derived here: the second
   * press has to be judged against the BACKEND's view of whether the turn is
   * still running, and the composer has no access to that.
   */
  stopState?: { label: string; enabled: boolean; forceAvailable: boolean };
  /** Callback when user clicks stop */
  onStop?: () => void;
  /**
   * External captures (browser/terminal selections) owned by the parent. Shown
   * as removable preview chips and merged into the message on send.
   */
  pendingCaptures?: Array<{ id: string; file: File; source: CaptureSource; label?: string }>;
  /** Remove a pending capture by id (parent owns the state). */
  onRemovePendingCapture?: (id: string) => void;
  /**
   * Fired when a built-in slash command (`/browser`, `/terminal`) is sent, so
   * the parent can surface the matching integrated panel (e.g. start the
   * browser in visible mode and focus its tab). Awaited before the message is
   * dispatched so the panel is ready as the agent starts driving it.
   */
  onBuiltinCommand?: (commandId: string) => void | Promise<void>;
  /**
   * PLN-01 — agent mode for the next turn.
   * `Interactive` = the agent edits directly (historical behaviour).
   * `Plan` = the agent researches and proposes a plan for approval; writes are
   * never auto-approved while planning.
   */
  agentMode?: AgentMode;
  onAgentModeChange?: (mode: AgentMode) => void;
  /** Hide the mode picker (e.g. background worker chats). */
  showAgentModePicker?: boolean;
  /**
   * PLN-01 — set when a plan review or question is blocking this chat. The
   * composer is disabled and explains why, because the server rejects new
   * prompts with 409 while a gate is open.
   */
  pendingInteractionLabel?: string | null;
  onCancelPendingInteraction?: () => void;
  /**
   * Readiness of this chat's workspace mounts. While it is `pending` or
   * `preparing` the agent has nowhere to work, so Send is held back — typing
   * stays enabled, and nothing is queued: the user presses Send when the bar
   * clears. On `error` the bar offers the two ways out (retry preparation, or
   * change what the chat is pointed at).
   */
  workspacePrep?: { status: WorkspacePrepStatus; error?: string } | undefined;
  onRetryWorkspacePrep?: (() => void) | undefined;
  workspacePrepRetrying?: boolean;
  onEditSources?: (() => void) | undefined;
  /**
   * AGT-01 — name of the agent driving this chat, when one is bound. Shown as
   * a read-only chip: the binding is frozen for the life of the conversation
   * (rebinding mid-thread would invalidate the prompt-cache prefix), so it is
   * deliberately not editable from the composer.
   */
  agentName?: string | undefined;
  /**
   * Rendered inside the composer column directly above the input card — the
   * chat's changed-files tray lives here so it shares the card's width and
   * horizontal alignment exactly.
   */
  aboveComposer?: React.ReactNode;
  /**
   * Prompts already sent in this chat (oldest → newest), with their
   * attachments. ↑ on the first line of the box recalls them, ↓ walks forward
   * again. Prompts sent this session are remembered here too, so the list
   * only needs to reflect what the server has persisted.
   */
  promptHistory?: PromptHistoryEntry[];
  /**
   * A prompt handed back by a rewind, to be dropped into the box for editing.
   *
   * `at` is the delivery token: the same text rewound twice is still two
   * offers, and re-rendering with an unchanged token must not overwrite what
   * the user has since typed. Never auto-sent.
   */
  restoredDraft?: { text: string; at: number } | undefined;
}

/**
 * PLN-01 — modes offered by the composer, derived from the shared registry so
 * adding a mode needs no change here.
 */
const AGENT_MODE_OPTIONS: Array<{ mode: AgentMode; label: string; description: string }> =
  AGENT_MODES.map((mode) => {
    const d = AGENT_MODE_REGISTRY[mode];
    return { mode, label: d.label, description: d.description };
  });

export function ChatInput({
  sessionId,
  disabled,
  placeholder,
  onBeforeSend,
  customSendFn,
  selectedModel,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
  contextTier,
  onContextTierChange,
  gitRepositories = [],
  projectId,
  codebaseIds,
  workspaceId,
  showModelSelector = true,
  showGitConnector = true,
  onToggleFilesPanel,
  filesPanelOpen,
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
  aboveComposer,
  promptHistory,
  restoredDraft,
}: ChatInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [showCodebasePanel, setShowCodebasePanel] = useState(false);
  const [showReasoningDropdown, setShowReasoningDropdown] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  // PLN-01 — agent-mode picker.
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const activeAgentMode: AgentMode = agentMode ?? DEFAULT_AGENT_MODE;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reasoningDropdownRef = useRef<HTMLDivElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const codebasePanelRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // ── Composer logic (03 §6.1) ──
  const draft = useComposerDraft({ workspaceId });
  const {
    text,
    attachments,
    activeCommand,
    setActiveCommand,
    menu,
    setMenu,
    menuIndex,
    setMenuIndex,
    removeAttachment,
    handleFilesChanged,
    handleDrop,
    handleDragOver,
  } = draft;
  const history = useComposerHistory({ promptHistory, restoredDraft, draft, textareaRef });
  const menus = useComposerMenus({ projectId, workspaceId, draft, textareaRef });
  const { filteredCommands, filteredMentions, fileIndexLoading, mentionLoading, applyMenuSelection } = menus;
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
    usage,
    contextUsage,
  } = useComposerModelControls({ sessionId, selectedModel, onModelChange, reasoningEffort, contextTier });
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
  });
  const { isLoading, blockedByInteraction, canSend, primaryAction, handleSend } = send;
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

  const { data: projectCodebases, isLoading: codebasesLoading } = useProjectCodebases(projectId);

  const connectedRepoCount =
    (codebaseIds?.length ?? 0) + gitRepositories.filter((r) => r.url.trim()).length;

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [text]);

  // Close dropdowns on outside click or Escape. The model picker manages its
  // own dismissal (it lives in the shared `ModelPicker`).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (reasoningDropdownRef.current && !reasoningDropdownRef.current.contains(t)) {
        setShowReasoningDropdown(false);
      }
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(t)) {
        setShowToolsMenu(false);
      }
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(t)) {
        setShowModeDropdown(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setShowReasoningDropdown(false);
      setShowToolsMenu(false);
      setShowModeDropdown(false);
    };
    if (showReasoningDropdown || showToolsMenu || showModeDropdown) {
      document.addEventListener('mousedown', handler);
      document.addEventListener('keydown', onKeyDown, true);
      return () => {
        document.removeEventListener('mousedown', handler);
        document.removeEventListener('keydown', onKeyDown, true);
      };
    }
  }, [showReasoningDropdown, showToolsMenu, showModeDropdown]);

  // ── Composer menu rows (`/` commands + `@` file mentions) ──
  const commandIcon = useCallback((c: SlashCommand): React.ReactNode => {
    if (c.kind === 'skill') return <Sparkles className="h-3.5 w-3.5" />;
    if (c.kind === 'prompt') return <ScrollText className="h-3.5 w-3.5" />;
    if (c.id === 'builtin:browser') return <Globe className="h-3.5 w-3.5" />;
    if (c.id === 'builtin:terminal') return <TerminalSquare className="h-3.5 w-3.5" />;
    return <Wrench className="h-3.5 w-3.5" />;
  }, []);

  const menuItems = useMemo<ComposerMenuItem[]>(() => {
    if (!menu) return [];
    if (menu.type === 'slash') {
      return filteredCommands.map((c) => ({
        id: c.id,
        title: `/${c.name}`,
        subtitle: c.description,
        icon: commandIcon(c),
        badge: c.source === 'builtin' ? 'tool' : c.kind,
      }));
    }
    return filteredMentions.map((f) => ({
      id: `${f.source}:${f.worktreeAlias ?? ''}:${f.path}`,
      title: f.label,
      subtitle: f.path,
      icon: <FileText className="h-3.5 w-3.5" />,
      badge: f.source === 'worktree' ? f.worktreeAlias : undefined,
    }));
  }, [menu, filteredCommands, filteredMentions, commandIcon]);

  const handleFileSelect = useCallback(() => {
    if (!COMPOSER.attachments) return;
    fileInputRef.current?.click();
  }, []);

  // Hold the composer back until the model catalog resolves.
  //
  // Rendering it early meant the model button and every control derived from
  // the selected model (reasoning effort, context tier, the context gauge)
  // mounted with no data and then re-rendered — the user briefly saw an empty
  // dropdown and a 0% gauge for a model we hadn't loaded yet. A skeleton with
  // the same footprint keeps the layout stable and avoids that flash. It is
  // NOT gated on error: if the catalog fails we still render the composer so
  // the chat stays usable.
  if (modelsPending) {
    return <ChatInputSkeleton />;
  }

  return (
    <div
      className="bg-[var(--color-background)] px-2 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-3"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="mx-auto w-full max-w-3xl">
      {aboveComposer}
      {/* ── Workspace preparation ──
          Worktrees and branch checkouts finish after the chat exists, so this
          is a real (short) window in which Send cannot work. */}
      {workspacePrep && workspacePrep.status !== 'ready' && (
        <WorkspacePrepBar
          status={workspacePrep.status}
          error={workspacePrep.error}
          onRetry={onRetryWorkspacePrep}
          retrying={workspacePrepRetrying}
          onEditSources={onEditSources}
        />
      )}
      {/* ── PLN-01: blocked-by-gate banner ──
          The server answers 409 INTERACTION_PENDING while a plan review or
          question is open, so explain that here rather than letting a send
          fail. "Cancel and send" resolves the gate first. */}
      {blockedByInteraction && (
        <div
          role="status"
          aria-live="polite"
          className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 px-3 py-2"
        >
          <span className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-foreground)]">
            <ClipboardList className="h-3.5 w-3.5 flex-shrink-0 text-[var(--color-primary)]" />
            <span className="truncate">{pendingInteractionLabel}</span>
          </span>
          {onCancelPendingInteraction && (
            <Button
              type="button"
              variant="ghost"
              onClick={onCancelPendingInteraction}
              className="h-auto flex-shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent-tint)] hover:text-[var(--color-foreground)]"
            >
              Cancel and send
            </Button>
          )}
        </div>
      )}
      {/* ── Main Input Card ── */}
      <div
        className={cn(
          'relative rounded-[20px] border bg-[var(--color-card)] transition-all duration-200',
          isFocused
            ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/40 ring-offset-[var(--color-background)]'
            : 'border-[var(--color-border)]/60',
          disabled && 'opacity-60 cursor-not-allowed',
        )}
      >
        {/* ── Composer Menu (`/` commands + `@` file mentions) ── */}
        <ComposerMenu
          open={!!menu}
          items={menuItems}
          activeIndex={menuIndex}
          onSelect={applyMenuSelection}
          onHover={setMenuIndex}
          header={menu?.type === 'slash' ? 'Commands & skills' : 'Attach a file'}
          emptyLabel={menu?.type === 'mention' ? 'No matching files' : 'No matching commands'}
          loading={menu?.type === 'mention' && fileIndexLoading}
        />

        {/* ── Codebase Expansion Panel (above textarea) ── */}
        {showCodebasePanel && (
          <div ref={codebasePanelRef} className="border-b border-[var(--color-border)]/50 bg-[var(--color-subtle)]/50 p-3 space-y-3 rounded-t-2xl animate-in slide-in-from-top-2 duration-200">
            {/* Project codebases (read-only display) */}
            {projectId ? (
              <div>
                <p className="text-[11px] font-medium text-[var(--color-muted-foreground)] mb-2 flex items-center gap-1.5">
                  <FolderGit2 className="h-3.5 w-3.5" />
                  Project Codebases
                  <span className="ml-auto rounded-full bg-[var(--color-primary)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-primary)]">
                    {(codebaseIds ?? []).length}
                  </span>
                </p>
                {codebasesLoading ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted-foreground)]">
                    <Spinner size="xs" /> Loading...
                  </div>
                ) : !projectCodebases?.length ? (
                  <p className="text-[11px] text-[var(--color-muted-foreground)]">No codebases in project.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {projectCodebases.filter(cb => (codebaseIds ?? []).includes(cb.id)).map((cb) => (
                      <div
                        key={cb.id}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/30"
                      >
                        {cb.type === 'local-dir' ? <FolderOpen className="h-3 w-3" /> : <GitBranch className="h-3 w-3" />}
                        <span>{cb.alias}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <p className="text-[11px] font-medium text-[var(--color-muted-foreground)] mb-2 flex items-center gap-1.5">
                  <FolderGit2 className="h-3.5 w-3.5" />
                  No project linked
                </p>
                <p className="text-[11px] text-[var(--color-muted-foreground)] italic">
                  Codebases are configured during chat creation.
                </p>
              </div>
            )}

            {/* Local folder paths (read-only display) */}
            {gitRepositories.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-[var(--color-muted-foreground)] mb-2 flex items-center gap-1.5">
                  <FolderOpen className="h-3.5 w-3.5" />
                  Local Folders
                </p>
                <div className="space-y-1.5">
                  {gitRepositories.map((repo, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-[var(--color-muted-foreground)]" />
                      <span className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)]/50 px-2.5 py-1.5 text-[11px] font-mono text-[var(--color-foreground)] truncate">
                        {repo.url}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Attachment Chips ── */}
        {(attachments.length > 0 || (pendingCaptures?.length ?? 0) > 0 || mentionLoading) && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {attachments.map((att) => (
              <ComposerChip
                key={att.id}
                file={att.file}
                label={att.label ?? att.file.name}
                icon={att.source === 'mention' ? <AtSign className="h-3 w-3" /> : undefined}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
            {mentionLoading && (
              <div className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted-foreground)]">
                <Spinner size="xs" /> Attaching…
              </div>
            )}
            {(pendingCaptures ?? []).map((cap) => {
              const Icon = cap.source === 'browser' ? Globe : cap.source === 'terminal' ? TerminalSquare : Paperclip;
              return (
                <ComposerChip
                  key={cap.id}
                  file={cap.file}
                  label={cap.label ?? cap.file.name}
                  title={`${cap.source} capture — ${cap.label ?? cap.file.name}`}
                  icon={<Icon className="h-3 w-3" />}
                  muted
                  onRemove={onRemovePendingCapture ? () => onRemovePendingCapture(cap.id) : undefined}
                />
              );
            })}
          </div>
        )}

        {/* ── Textarea ── */}
        <div className="px-2.5 pt-3.5 pb-1.5 sm:px-4">
          {/* Active command pill — the selected `/command` runs as a mode; the
              textarea then holds its arguments. Backspace on empty removes it. */}
          {activeCommand && (
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary)]/12 border border-[var(--color-primary)]/30 px-2 py-1 text-[11px] font-medium text-[var(--color-primary)]">
              <span className="opacity-70">{commandIcon(activeCommand)}</span>
              <span>/{activeCommand.name}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => { setActiveCommand(null); requestAnimationFrame(() => textareaRef.current?.focus()); }}
                className="h-auto w-auto rounded-full p-0.5 hover:bg-[var(--color-primary)]/15"
                title="Remove command"
                aria-label={`Remove /${activeCommand.name} command`}
              >
                <X className="h-2.5 w-2.5" />
              </Button>
            </div>
          )}
          {/* No interim preview. Part C.2 rendered a dimmed running transcript
              above the composer; it was noise — the text it showed was about
              to be inserted a moment later anyway, so the same words appeared
              twice, and the block shifted the composer's layout while typing.
              The recording pill's waveform is the live feedback now. Dropping
              it also lets the client turn the server's interim passes OFF
              entirely (see `useSpeechToText`'s `interim: false`), which is
              what buys back the headroom for an accurate engine. */
          }
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onClick={handleClick}
            onFocus={() => setIsFocused(true)}
            onBlur={() => { setIsFocused(false); setTimeout(() => setMenu(null), 120); }}
            disabled={disabled}
            placeholder={activeCommand?.argHint ?? placeholder}
            aria-label="Message"
            rows={1}
            className={cn(
              'w-full resize-none border-0 bg-transparent px-0 py-0 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]/70 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-100',
              'leading-relaxed min-h-[64px] max-h-[200px] outline-none rounded-none',
              // Dictation grows the box a line at a time; ease it rather than snap.
              'transition-[height] duration-150 ease-out',
            )}
          />
        </div>

        {/* ── Bottom Toolbar (seamless, inside the card) ── */}
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-0.5">
          {/* Left: Actions (wrap + min-w-0 so icons never overflow the card) */}
          <div ref={toolbarRef} className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
            {/* Attach — W29: absent, not disabled, on a surface that declares
                no file attachment. A dead control is worse than no control. */}
            {COMPOSER.attachments && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleFileSelect}
                disabled={disabled}
                className="h-7 w-7 flex-shrink-0 rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent-tint)] hover:text-[var(--color-foreground)]"
                title="Attach file"
                aria-label="Attach file"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}

            {/* Model Selector — the shared canonical picker (same control the
                create-chat dialog, settings and stage overrides use). */}
            {showModelSelector && (
              <ModelPicker
                variant="inline"
                side="top"
                align="start"
                value={displayModel}
                onChange={(id) => onModelChange?.(id)}
                ariaLabel="Select model"
              />
            )}

            {/* Bound agent — read-only; the binding is frozen per conversation. */}
            {agentName && (
              <span
                data-testid="chat-agent-chip"
                title={`Driven by the “${agentName}” agent`}
                className="flex h-7 flex-shrink-0 items-center gap-1 rounded-full bg-[var(--color-primary)]/10 px-2 text-[11px] font-medium text-[var(--color-primary)]"
              >
                <Bot className="h-3 w-3" />
                <span className="max-w-[10rem] truncate">{agentName}</span>
              </span>
            )}

            {/* Agent mode — Interactive vs Plan.
                Sits directly after the model picker because it changes what
                the agent is allowed to DO, which is the most consequential
                per-turn choice after the model itself. */}
            {showAgentModePicker && (
              <div className="relative flex-shrink-0" ref={modeDropdownRef}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowModeDropdown((p) => !p);
                    setShowReasoningDropdown(false);
                    setShowToolsMenu(false);
                  }}
                  aria-haspopup="listbox"
                  aria-expanded={showModeDropdown}
                  aria-label={`Agent mode: ${AGENT_MODE_REGISTRY[activeAgentMode].label}`}
                  className={cn(
                    'h-auto gap-1 rounded-md px-2 py-1 text-xs font-medium',
                    activeAgentMode === 'plan'
                      ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                      : showModeDropdown
                        ? 'text-[var(--color-foreground)] bg-[var(--color-accent-tint)]'
                        : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent-tint)]/60',
                  )}
                  title={AGENT_MODE_REGISTRY[activeAgentMode].description}
                >
                  {activeAgentMode === 'plan' ? (
                    <ClipboardList className="h-3.5 w-3.5" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  <span>{AGENT_MODE_REGISTRY[activeAgentMode].label}</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
                {showModeDropdown && (
                  <div
                    role="listbox"
                    aria-label="Agent mode"
                    className="absolute bottom-full left-0 mb-1.5 z-[100] w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl p-1.5 animate-in fade-in-0 zoom-in-95 duration-150"
                  >
                    <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                      Agent mode
                    </p>
                    {AGENT_MODE_OPTIONS.map((option) => (
                      <Button
                        key={option.mode}
                        type="button"
                        variant="ghost"
                        role="option"
                        aria-selected={activeAgentMode === option.mode}
                        onClick={() => {
                          onAgentModeChange?.(option.mode);
                          setShowModeDropdown(false);
                        }}
                        className={cn(
                          'h-auto w-full items-start justify-start gap-2 rounded-md px-2 py-1.5 text-left font-normal',
                          activeAgentMode === option.mode
                            ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                            : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent-tint)]',
                        )}
                      >
                        {activeAgentMode === option.mode ? (
                          <Check className="mt-0.5 h-3 w-3 flex-shrink-0" />
                        ) : (
                          <span className="mt-0.5 w-3 flex-shrink-0" />
                        )}
                        <span className="min-w-0">
                          <span className="block text-xs font-medium">{option.label}</span>
                          <span className="block text-[10px] leading-snug text-[var(--color-muted-foreground)]">
                            {option.description}
                          </span>
                        </span>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Per-turn controls — only meaningful once a model is chosen.
                When the toolbar has room they show inline; when it's tight
                they fold into the "⋯" overflow menu. */}
            {showModelSelector && activeModel && !collapseControls && (
              <>
                {/* Reasoning-effort inline pill */}
                {hasReasoning && (
                  <div className="relative" ref={reasoningDropdownRef}>
                    <Button
                      variant="ghost"
                      onClick={() => { setShowReasoningDropdown((p) => !p); setShowToolsMenu(false); }}
                      aria-haspopup="listbox"
                      aria-expanded={showReasoningDropdown}
                      className={cn(
                        'h-auto gap-1 rounded-md px-2 py-1 text-xs font-medium capitalize',
                        showReasoningDropdown
                          ? 'text-[var(--color-foreground)] bg-[var(--color-accent-tint)]'
                          : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent-tint)]/60',
                      )}
                      title="Reasoning effort"
                    >
                      <span>{effectiveEffort ?? 'Reasoning'}</span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </Button>
                    {showReasoningDropdown && (
                      <div className="absolute bottom-full left-0 mb-1.5 z-[100] w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl p-1.5 animate-in fade-in-0 zoom-in-95 duration-150">
                        <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Reasoning effort</p>
                        {reasoningLevels.map((level) => (
                          <Button
                            key={level}
                            variant="ghost"
                            role="option"
                            aria-selected={effectiveEffort === level}
                            onClick={() => { onReasoningEffortChange?.(level); setShowReasoningDropdown(false); }}
                            className={cn(
                              'h-auto w-full items-center justify-start gap-2 rounded-md px-2 py-1.5 text-left text-xs font-normal capitalize',
                              effectiveEffort === level ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent-tint)]',
                            )}
                          >
                            {effectiveEffort === level ? <Check className="h-3 w-3" /> : <span className="w-3" />}
                            {level}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Context-window inline pill */}
                {hasContext && (
                  <div className="relative" ref={toolsMenuRef}>
                    <Button
                      variant="ghost"
                      onClick={() => { setShowToolsMenu((p) => !p); setShowReasoningDropdown(false); }}
                      aria-haspopup="listbox"
                      aria-expanded={showToolsMenu}
                      className={cn(
                        'h-auto gap-1 rounded-md px-2 py-1 text-xs font-medium',
                        showToolsMenu
                          ? 'text-[var(--color-foreground)] bg-[var(--color-accent-tint)]'
                          : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent-tint)]/60',
                      )}
                      title="Context window"
                    >
                      <span>{activeTierTokens ? formatTokens(activeTierTokens) : 'Context'}</span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </Button>
                    {showToolsMenu && (
                      <div className="absolute bottom-full left-0 mb-1.5 z-[100] w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl p-1.5 animate-in fade-in-0 zoom-in-95 duration-150">
                        <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Context window</p>
                        {contextTiers.map((t) => (
                          <Button
                            key={t.tier}
                            variant="ghost"
                            role="option"
                            aria-selected={effectiveTier === t.tier}
                            onClick={() => { onContextTierChange?.(t.tier); setShowToolsMenu(false); }}
                            className={cn(
                              'h-auto w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs font-normal',
                              effectiveTier === t.tier ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent-tint)]',
                            )}
                          >
                            <span className="flex items-center gap-2">
                              {effectiveTier === t.tier ? <Check className="h-3 w-3" /> : <span className="w-3" />}
                              {t.tier === 'long_context' ? 'Long context' : 'Standard'}
                            </span>
                            <span className="font-mono text-[10px] text-[var(--color-muted-foreground)]">{formatTokens(t.tokens)}</span>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Overflow "⋯" — appears only when the toolbar is too narrow to show
                the reasoning + context controls inline. Holds both. */}
            {showModelSelector && activeModel && collapseControls && (hasReasoning || hasContext) && (
              <div className="relative" ref={toolsMenuRef}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => { setShowToolsMenu((p) => !p); setShowReasoningDropdown(false); }}
                  aria-haspopup="menu"
                  aria-expanded={showToolsMenu}
                  className={cn(
                    'h-7 w-7 flex-shrink-0 rounded-md',
                    showToolsMenu
                      ? 'text-[var(--color-foreground)] bg-[var(--color-accent-tint)]'
                      : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent-tint)]/60',
                  )}
                  title="More options"
                  aria-label="More options"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </Button>
                {showToolsMenu && (
                  <div className="absolute bottom-full left-0 mb-1.5 z-[100] w-52 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl p-1.5 animate-in fade-in-0 zoom-in-95 duration-150">
                    {hasReasoning && (
                      <>
                        <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Reasoning effort</p>
                        {reasoningLevels.map((level) => (
                          <Button
                            key={level}
                            variant="ghost"
                            onClick={() => { onReasoningEffortChange?.(level); }}
                            className={cn(
                              'h-auto w-full items-center justify-start gap-2 rounded-md px-2 py-1.5 text-left text-xs font-normal capitalize',
                              effectiveEffort === level ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent-tint)]',
                            )}
                          >
                            {effectiveEffort === level ? <Check className="h-3 w-3" /> : <span className="w-3" />}
                            {level}
                          </Button>
                        ))}
                      </>
                    )}
                    {hasContext && (
                      <>
                        <p className={cn('px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]', hasReasoning && 'mt-1 border-t border-[var(--color-border)]/60 pt-2')}>Context window</p>
                        {contextTiers.map((t) => (
                          <Button
                            key={t.tier}
                            variant="ghost"
                            onClick={() => { onContextTierChange?.(t.tier); }}
                            className={cn(
                              'h-auto w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs font-normal',
                              effectiveTier === t.tier ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent-tint)]',
                            )}
                          >
                            <span className="flex items-center gap-2">
                              {effectiveTier === t.tier ? <Check className="h-3 w-3" /> : <span className="w-3" />}
                              {t.tier === 'long_context' ? 'Long context' : 'Standard'}
                            </span>
                            <span className="font-mono text-[10px] text-[var(--color-muted-foreground)]">{formatTokens(t.tokens)}</span>
                          </Button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Context gauge — circular indicator + token details popover */}
            {showModelSelector && activeModel && (
              <ContextUsageGauge
                className="flex-shrink-0"
                snapshot={contextUsage}
                usage={usage}
                model={activeModel}
                tier={effectiveTier}
                placement="top"
              />
            )}
          </div>

          {/* Right: Voice input + Send/Stop */}
          <div className="flex flex-shrink-0 items-center gap-1">
            {/* Voice input — local Whisper/Parakeet transcription; segments
                insert at the caret as they finalize (see the voice section
                above for the full Phase 1 design). */}
            <VoiceRecorder
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

            {/* Stop — W30-b's two-phase control.
                Three states, and each one says something true: a plain Stop,
                a 400 ms disabled window so a double-tap cannot skip to the
                destructive path, and an explicit "Force reset" once the
                graceful path has demonstrably failed. The label widens into a
                pill only for the last one, so the composer's layout does not
                shift on every ordinary stop. The face comes from the shared
                composer machine (client-core, M-12). */}
            {primaryAction !== 'send' ? (
              primaryAction === 'force_reset' ? (
                <Button
                  variant="ghost"
                  onClick={onStop}
                  className="h-8 gap-1.5 rounded-full bg-[var(--color-danger,var(--color-primary))] px-3 text-[11px] font-semibold text-[var(--color-primary-foreground,#fff)] hover:bg-[var(--color-danger,var(--color-primary))] hover:opacity-90 active:scale-[0.93]"
                  title="The turn did not stop gracefully — reset it"
                >
                  <Square className="h-3 w-3 fill-current" />
                  {stopState?.label}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onStop}
                  disabled={stopState ? !stopState.enabled : false}
                  className="h-8 w-8 rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground,#fff)] hover:bg-[var(--color-primary)] hover:opacity-90 active:scale-[0.93] disabled:active:scale-100"
                  title={stopState?.label ?? 'Stop generation'}
                  aria-label={stopState?.label ?? 'Stop generation'}
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </Button>
              )
            ) : (
              /* Send button — circular */
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSend}
                disabled={!canSend}
                className={cn(
                  'h-8 w-8 rounded-full',
                  canSend
                    ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground,#fff)] hover:bg-[var(--color-primary)] hover:opacity-90 active:scale-[0.93]'
                    : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]/50',
                )}
                title="Send (Enter)"
                aria-label="Send message"
              >
                {isLoading ? (
                  <Spinner size="md" className="text-current" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Separate row below the input: project / codebase context ── */}
      {(projectId || showGitConnector) && (
        // No horizontal padding: this row's first control lines up with the
        // composer card directly above it. `px-1` left it 4px to the right,
        // which reads as a ragged edge under the card.
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setShowCodebasePanel((p) => !p)}
            disabled={disabled}
            aria-expanded={showCodebasePanel}
            className={cn(
              'h-auto gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium',
              showCodebasePanel || connectedRepoCount > 0
                ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10'
                : 'border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent-tint)]/60',
            )}
          >
            <FolderGit2 className="h-3.5 w-3.5" />
            {connectedRepoCount > 0 ? (
              <span>{connectedRepoCount} Codebase{connectedRepoCount > 1 ? 's' : ''}</span>
            ) : (
              <span>Codebase</span>
            )}
            {showCodebasePanel ? <ChevronUp className="h-3 w-3 opacity-60" /> : <ChevronDown className="h-3 w-3 opacity-60" />}
          </Button>
        </div>
      )}

      <Input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFilesChanged}
      />
      </div>
    </div>
  );
}

/**
 * One attachment chip above the textarea. Images get a thumbnail glyph and a
 * hover preview of the actual picture (object URL, revoked on unmount).
 */
/** `report.final.md` → `{ stem: 'report.final', ext: '.md' }`; no dot, no ext. */
function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  // A leading dot is a dotfile, and an "extension" longer than 8 is a sentence.
  if (dot <= 0 || name.length - dot > 9 || /[\s/]/.test(name.slice(dot))) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

function ComposerChip({
  file, label, title, icon, muted, onRemove,
}: {
  file: File;
  label: string;
  title?: string;
  icon?: React.ReactNode;
  muted?: boolean;
  onRemove?: (() => void) | undefined;
}) {
  const previewUrl = useObjectUrl(file);
  const image = isPreviewableImage(file.type, file.name);
  const chip = (
    <div
      data-testid="composer-attachment"
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium',
        muted
          ? 'border-[var(--color-border)] bg-[var(--color-accent-tint)] text-[var(--color-foreground)]'
          : 'border-[var(--color-primary)]/20 bg-[var(--color-primary)]/8 text-[var(--color-primary)]',
      )}
      title={title ?? label}
    >
      {icon ?? (image ? <ImageIcon className="h-3 w-3" /> : <Paperclip className="h-3 w-3" />)}
      {/* The END of a file name is the part that tells two attachments apart:
          a browser comment arrives as `element-buy-<stamp>.md` plus
          `element-buy-<stamp>.png`, and end-truncation rendered both as
          "element-buy-1789…". The stem gives way; the extension never does. */}
      <span className="flex min-w-0 max-w-[160px]">
        <span className="truncate">{splitExtension(label).stem}</span>
        <span className="shrink-0">{splitExtension(label).ext}</span>
      </span>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          className={cn('h-auto w-auto rounded-full p-0.5', muted ? 'hover:bg-[var(--color-background)]' : 'hover:bg-[var(--color-primary)]/15')}
          title="Remove"
          aria-label={`Remove ${label}`}
        >
          <X className="h-2.5 w-2.5" />
        </Button>
      )}
    </div>
  );
  return previewUrl ? (
    <ImageHoverPreview src={previewUrl} alt={label}>
      {chip}
    </ImageHoverPreview>
  ) : chip;
}

/**
 * Placeholder composer shown while the model catalog loads.
 *
 * Mirrors the real composer's outer padding, rounded shell and toolbar height
 * so the swap is a fade, not a jump. Non-interactive by construction — there
 * is nothing meaningful to type into until we know which models exist.
 */
function ChatInputSkeleton() {
  return (
    <div className="bg-[var(--color-background)] px-4 pt-3 pb-3" aria-hidden="true" data-testid="chat-input-skeleton">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2.5">
          <div className="h-6 w-2/5 animate-pulse rounded bg-[var(--color-muted)]/50" />
          <div className="mt-3 flex items-center gap-2">
            <div className="h-6 w-28 animate-pulse rounded-md bg-[var(--color-muted)]/50" />
            <div className="h-6 w-20 animate-pulse rounded-md bg-[var(--color-muted)]/40" />
            <div className="ml-auto h-7 w-7 animate-pulse rounded-full bg-[var(--color-muted)]/50" />
          </div>
        </div>
        <p className="sr-only" aria-live="polite">Loading available models…</p>
      </div>
    </div>
  );
}
