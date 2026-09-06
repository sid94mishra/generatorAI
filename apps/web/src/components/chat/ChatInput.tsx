// ────────────────────────────────────────────────────────────────
// ChatInput — Modern Copilot-style input with unified toolbar,
// model selection, codebase picker, and file attachment support
// ────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSendPrompt, useModels, useHarnessConfig } from '@/hooks/queries.js';
import { useStreamStore } from '@/stores/streamStore.js';
import { useProjectCodebases } from '@/hooks/projectQueries.js';
import { useSlashCommands, useWorkspaceFileIndex } from '@/hooks/composerQueries.js';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { fuzzyMatch } from './composer/builtins.js';
import { CaretInsertionSequencer, stitchDictation, splitScratchCommand, continueCase } from '@generatorai/shared';
import { ComposerMenu, type ComposerMenuItem } from './composer/ComposerMenu.js';
import type {
  SlashCommand,
  MentionFile,
  ComposerAttachment,
  ComposerMenuState,
  CaptureSource,
} from './composer/types.js';
import type { ChatModel } from '@/platform/HttpPlatformClient.js';
import type { AgentMode } from '@generatorai/shared';
import { AGENT_MODES, AGENT_MODE_REGISTRY, DEFAULT_AGENT_MODE } from '@generatorai/shared';
import {
  Paperclip, X, Plus,
  FolderOpen, FolderGit2, GitBranch, ChevronDown, ChevronUp,
  Square, ArrowUp, Gauge, Search, Check, Info,
  Eye, Globe, Cpu, SlidersHorizontal, Lock,
  Sparkles, ScrollText, Wrench, FileText, TerminalSquare, AtSign,
  ClipboardList, Zap, Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { ModelPicker, ProviderIcon, formatTokens, DetailRow } from '@/components/shared/ModelPicker.js';
import { ContextUsageGauge } from '@/components/shared/ContextUsageGauge.js';
import { Button, Textarea, Spinner } from '@/components/ui/index.js';
import { resolveModelLimit } from '@generatorai/client-core';
import { VoiceRecorder } from './VoiceRecorder.js';
import { useSpeechToText } from '@/hooks/useSpeechToText.js';
import { composerAffordances } from '@/platform/surfaceCapabilities.js';
import { toast } from '@/components/Toast.js';

/**
 * W29 — what the composer offers on THIS surface, read from the capability
 * ledger. Module-level because the surface cannot change without a reload,
 * and a per-render read would be pure overhead on the composer's hot path.
 */
const COMPOSER = composerAffordances();

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
   * AGT-01 — name of the agent driving this chat, when one is bound. Shown as
   * a read-only chip: the binding is frozen for the life of the conversation
   * (rebinding mid-thread would invalidate the prompt-cache prefix), so it is
   * deliberately not editable from the composer.
   */
  agentName?: string | undefined;
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
  agentName,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [showCodebasePanel, setShowCodebasePanel] = useState(false);
  const [showReasoningDropdown, setShowReasoningDropdown] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  // PLN-01 — agent-mode picker.
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const activeAgentMode: AgentMode = agentMode ?? DEFAULT_AGENT_MODE;
  // ── Composer menu (`/` commands + `@` file mentions) ──
  const [activeCommand, setActiveCommand] = useState<SlashCommand | null>(null);
  const [menu, setMenu] = useState<ComposerMenuState | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [mentionLoading, setMentionLoading] = useState(false);
  // Responsive: when the toolbar is too narrow, reasoning + context collapse
  // into the "⋯" overflow menu; when there's room they show inline.
  const [collapseControls, setCollapseControls] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reasoningDropdownRef = useRef<HTMLDivElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const codebasePanelRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const sendMutation = useSendPrompt(sessionId);
  const startPending = useStreamStore((state) => state.startPending);
  const clearStream = useStreamStore((state) => state.clearStream);
  const usage = useStreamStore((state) => state.streams[sessionId]?.usage ?? null);
  const contextUsage = useStreamStore((state) => state.streams[sessionId]?.contextUsage ?? null);
  const { data: models, isPending: modelsPending } = useModels();
  const { data: harnessConfig } = useHarnessConfig();
  const activeProvider = harnessConfig?.harness?.type ?? 'copilot';
  const sendingRef = useRef(false);

  // ── Composer data (slash commands + `@` file index) ──
  const platform = usePlatform();
  const slashCommands = useSlashCommands(projectId);
  const { files: mentionFiles, isLoading: fileIndexLoading } = useWorkspaceFileIndex(workspaceId);

  const isLoading = sendMutation.isPending;
  // PLN-01 — the server rejects prompts with 409 while a human gate is open,
  // so surface that as a disabled composer instead of a failed request.
  const blockedByInteraction = !!pendingInteractionLabel;
  const canSend =
    (text.trim().length > 0 || activeCommand !== null) &&
    !disabled &&
    !isLoading &&
    !blockedByInteraction;

  const { data: projectCodebases, isLoading: codebasesLoading } = useProjectCodebases(projectId);

  const connectedRepoCount =
    (codebaseIds?.length ?? 0) + gitRepositories.filter((r) => r.url.trim()).length;

  const modelList = (models ?? []) as ChatModel[];
  // Resolve the selection against the LIVE catalog.
  //
  // A chat can carry a model id the account no longer has (a renamed or
  // de-entitled model, or the legacy `claude-sonnet-4` default). When that
  // happened `activeModel` came back undefined and every model-derived
  // control — reasoning effort, context tier, and the context gauge —
  // silently vanished from the composer. Falling back to the first available
  // model keeps the toolbar intact and keeps the label honest about what
  // will actually be used.
  const displayModel = useMemo(() => {
    if (selectedModel && modelList.some((m) => m.id === selectedModel)) return selectedModel;
    return modelList[0]?.id ?? selectedModel ?? '';
  }, [selectedModel, modelList]);
  const activeModel = useMemo(
    () => modelList.find((m) => m.id === displayModel),
    [modelList, displayModel],
  );

  // Persist the substitution so the label, the gauge and the model the server
  // actually runs stay in agreement. Only fires when we genuinely had to
  // substitute (no selection, or a selection the catalog no longer offers) —
  // not on every open — and self-terminates once the parent echoes it back.
  const onModelChangeRef = useRef(onModelChange);
  onModelChangeRef.current = onModelChange;
  useEffect(() => {
    if (modelList.length === 0) return;
    if (!displayModel || displayModel === selectedModel) return;
    onModelChangeRef.current?.(displayModel);
  }, [displayModel, selectedModel, modelList.length]);

  // Provider tabs and the searchable model list now live inside the shared
  // `ModelPicker`; the composer only needs the active model's metadata to
  // drive the per-turn reasoning-effort and context-tier controls below.

  // Reasoning-effort levels come from the selected model's provider metadata.
  const reasoningLevels = activeModel?.supportsReasoning
    ? (activeModel.reasoningEfforts?.length ? activeModel.reasoningEfforts : ['low', 'medium', 'high'])
    : [];
  const effectiveEffort = reasoningEffort ?? activeModel?.defaultReasoningEffort ?? reasoningLevels[Math.floor(reasoningLevels.length / 2)];

  // Context-window tiers — offered only when the model exposes both a standard
  // and a long-context tier. Values are the provider's PROMPT budgets, which is
  // the same quantity the gauge divides by; showing the advertised total here
  // is what made the composer say 264K while the gauge said 200K.
  const contextTiers = useMemo(() => {
    const standard = resolveModelLimit(activeModel, 'default');
    const long = resolveModelLimit(activeModel, 'long_context');
    if (!activeModel?.supportsLongContext || !standard || !long || standard >= long) {
      return [] as Array<{ tier: 'default' | 'long_context'; tokens: number }>;
    }
    return [
      { tier: 'default' as const, tokens: standard },
      { tier: 'long_context' as const, tokens: long },
    ];
  }, [activeModel]);
  const effectiveTier = (contextTier as 'default' | 'long_context' | undefined) ?? 'default';
  const activeTierTokens = contextTiers.find((t) => t.tier === effectiveTier)?.tokens
    ?? resolveModelLimit(activeModel, effectiveTier);
  const hasReasoning = !!activeModel?.supportsReasoning && reasoningLevels.length > 0;
  const hasContext = contextTiers.length > 1;

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [text]);

  // Responsive collapse — watch the toolbar width and fold the reasoning +
  // context controls into the "⋯" overflow menu when the row gets tight, so
  // the icons never spill out of the card. They pop back inline when there's
  // room again. Threshold is a heuristic that comfortably fits the model
  // pill + both controls + the gauge on the left cluster.
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCollapseControls(w < 420);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  // ── Composer menu: icon, filtering, detection, and selection ──
  const commandIcon = useCallback((c: SlashCommand): React.ReactNode => {
    if (c.kind === 'skill') return <Sparkles className="h-3.5 w-3.5" />;
    if (c.kind === 'prompt') return <ScrollText className="h-3.5 w-3.5" />;
    if (c.id === 'builtin:browser') return <Globe className="h-3.5 w-3.5" />;
    if (c.id === 'builtin:terminal') return <TerminalSquare className="h-3.5 w-3.5" />;
    return <Wrench className="h-3.5 w-3.5" />;
  }, []);

  const filteredCommands = useMemo(() => {
    if (!menu || menu.type !== 'slash') return [] as SlashCommand[];
    const q = menu.query;
    return slashCommands
      .filter((c) => fuzzyMatch(q, c.name) || (c.description ? fuzzyMatch(q, c.description) : false))
      .slice(0, 50);
  }, [menu, slashCommands]);

  const filteredMentions = useMemo(() => {
    if (!menu || menu.type !== 'mention') return [] as MentionFile[];
    const q = menu.query;
    return mentionFiles
      .filter((f) => fuzzyMatch(q, f.label) || fuzzyMatch(q, f.path))
      .slice(0, 50);
  }, [menu, mentionFiles]);

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

  // Detect whether the caret sits inside a `/command` or `@mention` token.
  const detectMenu = useCallback(
    (value: string, caret: number) => {
      // Slash: only when the value starts with '/', the caret is within the
      // first (command) token, and no command is already active.
      if (!activeCommand && value.startsWith('/')) {
        const firstSpace = value.search(/\s/);
        const tokenEnd = firstSpace === -1 ? value.length : firstSpace;
        if (caret <= tokenEnd) {
          setMenu({ type: 'slash', query: value.slice(1, caret), triggerIndex: 0 });
          setMenuIndex(0);
          return;
        }
      }
      // Mention: last '@' before the caret, preceded by start/whitespace, with
      // no whitespace between it and the caret. Requires a workspace to search.
      if (workspaceId) {
        const upto = value.slice(0, caret);
        const at = upto.lastIndexOf('@');
        if (at !== -1) {
          const before = at === 0 ? '' : value.charAt(at - 1);
          const token = value.slice(at + 1, caret);
          if ((at === 0 || /\s/.test(before)) && !/\s/.test(token)) {
            setMenu({ type: 'mention', query: token, triggerIndex: at });
            setMenuIndex(0);
            return;
          }
        }
      }
      setMenu(null);
    },
    [activeCommand, workspaceId],
  );

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setText(value);
      detectMenu(value, e.target.selectionStart ?? value.length);
    },
    [detectMenu],
  );

  const applySlashCommand = useCallback((cmd: SlashCommand) => {
    setActiveCommand(cmd);
    setText('');
    setMenu(null);
    setMenuIndex(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const applyMention = useCallback(
    async (file: MentionFile) => {
      const current = menu;
      if (!current || current.type !== 'mention' || !workspaceId) return;
      const el = textareaRef.current;
      // Read the live value from the DOM node so this callback doesn't need to
      // be re-created on every keystroke (keeps typing cheap).
      const value = el?.value ?? '';
      const caret = el?.selectionStart ?? value.length;
      const newText = value.slice(0, current.triggerIndex) + value.slice(caret);
      setText(newText);
      setMenu(null);
      requestAnimationFrame(() => {
        const e2 = textareaRef.current;
        if (e2) {
          e2.focus();
          e2.selectionStart = e2.selectionEnd = current.triggerIndex;
        }
      });
      setMentionLoading(true);
      try {
        const res = await platform.getWorkspaceFileContent(
          workspaceId,
          file.path,
          file.source,
          file.worktreeAlias,
        );
        const blob = new Blob([res.content ?? ''], { type: 'text/plain' });
        const f = new File([blob], file.label, { type: 'text/plain' });
        setAttachments((prev) => {
          if (prev.some((a) => a.source === 'mention' && a.label === file.path)) return prev;
          return [
            ...prev,
            {
              id: `mention:${file.source}:${file.worktreeAlias ?? ''}:${file.path}:${Date.now()}`,
              file: f,
              source: 'mention',
              label: file.path,
            },
          ];
        });
      } catch {
        toast({ variant: 'error', title: `Could not attach ${file.label}` });
      } finally {
        setMentionLoading(false);
      }
    },
    [menu, workspaceId, platform],
  );

  const applyMenuSelection = useCallback(
    (index: number) => {
      if (!menu) return;
      if (menu.type === 'slash') {
        const cmd = filteredCommands[index];
        if (cmd) applySlashCommand(cmd);
      } else {
        const file = filteredMentions[index];
        if (file) void applyMention(file);
      }
    },
    [menu, filteredCommands, filteredMentions, applySlashCommand, applyMention],
  );

  const handleSend = useCallback(async () => {
    if (!canSend || sendingRef.current) return;
    sendingRef.current = true;

    const cmd = activeCommand;
    const rawInput = text.trim();
    const currentAttachments = attachments;

    setText('');
    setAttachments([]);
    setActiveCommand(null);
    setMenu(null);

    let prompt = rawInput;
    try {
      if (cmd) {
        let template: string | undefined;
        if (cmd.loadTemplate) {
          try {
            template = await cmd.loadTemplate();
          } catch {
            template = undefined;
            toast({ variant: 'warning', title: `Could not load the "${cmd.name}" prompt template` });
          }
        }
        prompt = cmd.format(rawInput, template);
      }

      if (!prompt.trim() && currentAttachments.length === 0) {
        // Nothing to send after formatting — restore and bail.
        setText(rawInput);
        setActiveCommand(cmd);
        setAttachments(currentAttachments);
        sendingRef.current = false;
        return;
      }

      startPending(sessionId, prompt);
      const files = currentAttachments.map((a) => a.file);

      // Built-in commands (`/browser`, `/terminal`) surface their integrated
      // panel before the message is dispatched so the user can watch the agent
      // drive it live (e.g. start the browser in visible mode + focus its tab).
      if (cmd?.source === 'builtin' && onBuiltinCommand) {
        try {
          await onBuiltinCommand(cmd.id);
        } catch {
          /* non-fatal — the agent's lazy-start still runs */
        }
      }

      if (onBeforeSend) {
        await onBeforeSend();
      }
      if (customSendFn) {
        await customSendFn({ prompt, attachments: files, mode: activeAgentMode });
      } else {
        await sendMutation.mutateAsync({ prompt, attachments: files });
      }
    } catch {
      setText(rawInput);
      setActiveCommand(cmd);
      setAttachments(currentAttachments);
      clearStream(sessionId);
    } finally {
      sendingRef.current = false;
    }
  }, [
    canSend,
    text,
    attachments,
    activeCommand,
    sessionId,
    sendMutation,
    startPending,
    clearStream,
    onBeforeSend,
    customSendFn,
    onBuiltinCommand,
    activeAgentMode,
  ]);

  // ── Voice input (Phase 1 rewrite — VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C) ──
  //
  // Two changes from the original design, per Part C.2:
  //   1. Finalized text (segment/final) is inserted at the textarea's
  //      CURRENT CARET position, not appended to a separately-tracked base
  //      string. This is what lets a manual edit + resume "just work" —
  //      the browser's own caret is the source of truth for where new
  //      speech lands, exactly like native OS dictation.
  //   2. Live/interim text NEVER enters the real editable `text` state — it
  //      is rendered as a separate, visually distinct, non-editable preview
  //      (see the dimmed line above the textarea in the JSX below). Only a
  //      fully finalized segment ever gets inserted into the real value.
  //      This is what removes the "correction collides with in-flight
  //      dictation" problem entirely: there is never any uncommitted STT
  //      text sitting inside the editable buffer for an edit to collide
  //      with.
  //
  // `useSpeechToText` is owned HERE (not inside VoiceRecorder) because
  // pausing on manual composer interaction (Part C.3) requires the
  // composer's own key/paste/click handlers to call `pauseVoice()`.
  // Sequences insertions so two segments arriving back-to-back (before the
  // first's requestAnimationFrame caret-restore has run) compose in speech
  // order instead of racing on a not-yet-repainted textarea — see
  // CaretInsertionSequencer's doc comment for the exact failure mode this
  // fixes. `useRef` (not state) because it's mutated outside the render
  // cycle and never needs to trigger a re-render itself.
  const caretSequencerRef = useRef(new CaretInsertionSequencer());

  const insertAtCaret = useCallback((raw: string) => {
    const el = textareaRef.current;

    if (!el) {
      const insertText = raw.trim();
      if (insertText) setText((prev) => (prev ? `${prev.trimEnd()} ${insertText}` : insertText));
      return;
    }

    setText((prev) => {
      // A batch engine's segment starts with a capital whether or not it
      // continues the previous sentence; decide from what precedes it.
      const cased = continueCase(prev.slice(0, el.selectionStart), raw);
      const result = caretSequencerRef.current.insert(prev, el.selectionStart, el.selectionEnd, cased);
      return result ? result.text : prev;
    });

    requestAnimationFrame(() => {
      const el2 = textareaRef.current;
      const caret = caretSequencerRef.current.consumePending();
      if (el2 && caret != null) {
        el2.focus();
        el2.selectionStart = el2.selectionEnd = caret;
      }
    });
  }, []);

  // ── Live dictation region ────────────────────────────────────
  // Streaming partials are written STRAIGHT INTO the composer rather than
  // into a preview beside it, so words appear where they will actually end
  // up, as they are spoken. `dictationRef` remembers the span the
  // current utterance occupies so each revision replaces it instead of
  // appending — a streaming decoder rewrites itself constantly ("Hel" ->
  // "Hello" -> "Hello, how"), and appending each revision would produce
  // "HelHelloHello, how".
  //
  // The span is cleared whenever the user touches the composer, so a manual
  // edit is never overwritten by a partial that lands a moment later.
  // The live region is described by the composer text WITHOUT it — what sits
  // `before` and `after` the utterance. Storing those rather than a length is
  // what makes each revision a pure recomputation instead of a patch applied
  // to whatever the previous patch happened to leave behind, and it is what
  // lets the separator between `before` and the utterance be decided per
  // revision (see `stitchDictation`): "source" + "/server" needs no space,
  // "source" + "server" does.
  const dictationRef = useRef<{ before: string; after: string } | null>(null);
  /**
   * Where the last COMMITTED utterance sits in the composer text, so a
   * spoken "scratch that" can take it back out. Cleared by any manual edit,
   * because the offsets describe text the user has not touched since.
   */
  const lastCommittedRef = useRef<{ start: number; end: number } | null>(null);
  /**
   * The live region as it was when a manual edit detached it — see
   * `onSegment`. Lets the flushed, formatted segment replace the raw partial
   * that is still on screen, so the last half-second of what was said before
   * the keystroke is not lost.
   */
  const detachedRef = useRef<{ start: number; shown: string } | null>(null);
  /**
   * The committed composer text, readable synchronously.
   *
   * Partials arrive every ~190ms, faster than React re-renders settle, so a
   * handler that read `text` from its closure would repeatedly build on a
   * stale value.
   */
  const textRef = useRef('');
  textRef.current = text;

  /**
   * Whether the text of the CURRENT utterance is already visible in the
   * composer because partials put it there.
   *
   * This is what tells a committed segment whether it is new text or a
   * refinement of text the user is already looking at. Without it, typing
   * mid-dictation produced a duplicate: the partial text was on screen, the
   * edit detached the region, and the flushed segment — the same words, just
   * formatted — was then appended at the caret:
   *
   *   "…the API integration by NOTE so I wanted to talk about the project
   *    timeline. we need to finish the API integration by Friday…"
   */
  const utteranceShownRef = useRef(false);
  /** The exact partial text last written for the current utterance. */
  const shownTextRef = useRef('');

  const clearDictationRegion = useCallback(() => {
    dictationRef.current = null;
  }, []);

  /**
   * Compute the composer text with `incoming` written into `region`, joined
   * to its surroundings the way a dictation product would (spacing, sentence
   * case, symbols that attach). Pure: nothing here touches React state.
   */
  const composeRegion = useCallback((region: { before: string; after: string }, incoming: string) => {
    return stitchDictation(region.before, incoming, region.after);
  }, []);

  /**
   * Replace the live region with `incoming`; create it at the caret if absent.
   *
   * CRITICAL: everything is computed BEFORE `setText`, and the updater it
   * passes is a constant. React.StrictMode invokes state updaters twice in
   * development, so an updater that mutated the region ref or inserted a
   * separator inline ran both effects twice — which is exactly how the
   * composer ended up reading "…schedule a meeting. Hello, how are you today?
   * I would like to schedule a meeting.CCan you help me…".
   */
  const writeDictationRegion = useCallback((raw: string, commit: boolean) => {
    // "scratch that" on its own retracts the PREVIOUS utterance. It is acted
    // on the moment it is recognised (as Dragon and Windows do) rather than
    // at commit, so the retracted words disappear while the speaker is still
    // talking, and whatever follows the command takes their place.
    const { scratch, rest } = splitScratchCommand(raw);
    const incoming = scratch ? rest : raw;

    let region = dictationRef.current;
    if (!region) {
      const el = textareaRef.current;
      const prev = textRef.current;
      const last = lastCommittedRef.current;
      if (scratch && last && last.end <= prev.length) {
        // Open the region where the retracted utterance was, without it.
        region = { before: prev.slice(0, last.start).replace(/[ \t]+$/, ''), after: prev.slice(last.end) };
        lastCommittedRef.current = null;
      } else {
        const at = el ? Math.min(el.selectionStart, prev.length) : prev.length;
        region = { before: prev.slice(0, at), after: prev.slice(at) };
      }
      dictationRef.current = region;
    }

    const { text: next, start, end } = composeRegion(region, incoming);
    const caret = end;
    if (commit) {
      // Committed text becomes what the NEXT utterance is written into.
      dictationRef.current = null;
      lastCommittedRef.current = incoming ? { start, end } : null;
    }
    textRef.current = next;
    utteranceShownRef.current = !commit;
    shownTextRef.current = commit ? '' : incoming;
    detachedRef.current = null;
    setText(next);

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = Math.min(caret, el.value.length);
      el.selectionStart = el.selectionEnd = pos;
    });
  }, [composeRegion]);

  // ── Live reveal ──────────────────────────────────────────────
  // The streaming decoder hands over a revised partial every ~560ms (one
  // encoder chunk), typically two or three words at a time, so writing each
  // partial straight into the composer made the text lurch: nothing for half
  // a second, then a clump. This paces the reveal one word every REVEAL_MS
  // instead, so the words arrive at a typing-like cadence and the composer
  // reads as continuous rather than jittery. A retraction (the decoder
  // rewrote an earlier word) keeps the common prefix and re-reveals from
  // there; a backlog of more than a few words is flushed at once so the
  // display never falls behind the speaker. Commits bypass it entirely.
  const REVEAL_MS = 70;
  const REVEAL_CATCH_UP_WORDS = 6;
  const revealRef = useRef<{ target: string; shown: string; timer: ReturnType<typeof setInterval> | null }>({
    target: '', shown: '', timer: null,
  });

  const stopReveal = useCallback(() => {
    const r = revealRef.current;
    if (r.timer) clearInterval(r.timer);
    r.timer = null;
    r.target = '';
    r.shown = '';
  }, []);

  const revealStep = useCallback(() => {
    const r = revealRef.current;
    if (r.shown === r.target) {
      if (r.timer) clearInterval(r.timer);
      r.timer = null;
      return;
    }
    const rest = r.target.slice(r.shown.length);
    const backlog = rest.split(/\s+/).filter(Boolean).length;
    let end = r.target.indexOf(' ', r.shown.length + 1);
    if (end === -1 || backlog > REVEAL_CATCH_UP_WORDS) end = r.target.length;
    r.shown = r.target.slice(0, end);
    writeDictationRegion(r.shown, false);
  }, [writeDictationRegion]);

  const revealPartial = useCallback((t: string) => {
    const r = revealRef.current;
    let common = 0;
    const n = Math.min(r.shown.length, t.length);
    while (common < n && r.shown[common] === t[common]) common += 1;
    if (common < r.shown.length) r.shown = t.slice(0, common);
    r.target = t;
    if (!r.timer) {
      revealStep();
      if (r.shown !== r.target) r.timer = setInterval(revealStep, REVEAL_MS);
    }
  }, [revealStep]);

  useEffect(() => () => { const r = revealRef.current; if (r.timer) clearInterval(r.timer); }, []);

  const {
    isSupported: voiceSupported,
    status: voiceStatus,
    error: voiceError,
    amplitude: voiceAmplitude,
    start: startVoice,
    pause: pauseVoice,
    resume: resumeVoice,
    stop: stopVoice,
    cancel: cancelVoice,
  } = useSpeechToText({
    // Partials go into the composer itself. On an engine with a native
    // streaming decoder these arrive every ~190ms, sub-word; on a batch
    // engine the server sends none and only the segments below appear.
    onInterim: (t) => revealPartial(t),
    onSegment: (t) => {
      stopReveal();
      if (dictationRef.current) {
        // Normal case: refine the live region in place and commit it.
        writeDictationRegion(t, true);
      } else if (utteranceShownRef.current) {
        // The user edited the composer while this utterance was still open,
        // which detached the region. Its words are already on screen — and
        // already filler-stripped, because partials go through the
        // interim-safe formatter too — so re-inserting the whole segment
        // would duplicate them somewhere the user did not put them.
        //
        // The flushed segment usually carries a few more words than the last
        // partial (whatever was being spoken as the keystroke landed), so it
        // replaces the partial IN PLACE — but only if that partial is still
        // exactly where it was. If the user's edit moved or changed it, the
        // segment is dropped: losing the half-word you were mid-way through
        // is the cheaper, predictable failure. The caret is shifted by the
        // difference when it sits after the region, so the keystrokes the
        // user is typing right now are not displaced.
        const detached = detachedRef.current;
        const current = textRef.current;
        if (detached && current.slice(detached.start, detached.start + detached.shown.length) === detached.shown) {
          const region = { before: current.slice(0, detached.start), after: current.slice(detached.start + detached.shown.length) };
          const { text: next, end } = composeRegion(region, splitScratchCommand(t).rest);
          const el = textareaRef.current;
          const selStart = el?.selectionStart ?? next.length;
          const selEnd = el?.selectionEnd ?? next.length;
          const delta = next.length - current.length;
          textRef.current = next;
          lastCommittedRef.current = null;
          setText(next);
          requestAnimationFrame(() => {
            const el2 = textareaRef.current;
            if (!el2) return;
            const oldEnd = detached.start + detached.shown.length;
            const shift = (pos: number): number => (pos >= oldEnd ? pos + delta : Math.min(pos, end));
            el2.selectionStart = shift(selStart);
            el2.selectionEnd = shift(selEnd);
          });
        }
        detachedRef.current = null;
        utteranceShownRef.current = false;
        shownTextRef.current = '';
      } else {
        // Nothing was previewed (a batch engine emits no partials at all), so
        // this segment IS the text.
        insertAtCaret(t);
      }
    },
    onFinal: (t) => {
      stopReveal();
      clearDictationRegion();
      lastCommittedRef.current = null;
      detachedRef.current = null;
      utteranceShownRef.current = false;
      shownTextRef.current = '';
      if (t) insertAtCaret(t);
    },
    onError: (message) => toast({ variant: 'error', title: 'Voice input', description: message }),
  });

  const handleVoiceStart = useCallback(() => {
    stopReveal();
    clearDictationRegion();
    void startVoice();
  }, [startVoice, clearDictationRegion, stopReveal]);

  // Part C.3: EDITING the composer while dictation is live pauses it, so a
  // manual correction and an incoming segment can't fight over the caret.
  // Also drops any pending programmatic caret-restore (see insertAtCaret
  // above) — once the user has genuinely touched the textarea, a
  // `segment`/`final` frame that arrives moments later (network latency after
  // the `pause` frame was sent) must land at their new position, not silently
  // yank the caret back to wherever dictation had left off.
  //
  // "Editing" means typing or pasting — NOT clicking. Clicking is how you put
  // the caret somewhere, and it is the first half of almost every correction,
  // so pausing on it meant dictation stopped before the user had changed
  // anything and stayed stopped until they noticed the pill and clicked it.
  // Moving the caret still cancels the pending restore, which is the part
  // that actually matters for a click.
  const noteManualCaretMove = useCallback(() => {
    caretSequencerRef.current.clearPending();
    stopReveal();
    // The live region's offsets describe the text as it was; once the user has
    // moved or edited around it, the next partial must start a fresh span
    // rather than overwrite whatever now sits at those offsets. Remember
    // where the partial was, so the flushed segment can still refine it.
    const region = dictationRef.current;
    if (region && utteranceShownRef.current && shownTextRef.current) {
      const { start } = composeRegion(region, shownTextRef.current);
      detachedRef.current = { start, shown: shownTextRef.current };
    }
    clearDictationRegion();
    // "scratch that" must never remove text the user has since edited.
    lastCommittedRef.current = null;
  }, [clearDictationRegion, composeRegion, stopReveal]);

  const pauseVoiceIfListening = useCallback(() => {
    noteManualCaretMove();
    if (voiceStatus === 'listening') pauseVoice();
  }, [voiceStatus, pauseVoice, noteManualCaretMove]);

  const insertNewline = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      setText((prev) => prev + '\n');
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setText((prev) => prev.slice(0, start) + '\n' + prev.slice(end));
    // Restore caret after the inserted newline on the next frame.
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 1;
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Part C.3: any manual keystroke while dictation is listening pauses
      // it — this is the "the act of typing into the field IS the pause
      // trigger" behavior, not something the user has to remember to do.
      pauseVoiceIfListening();

      // Composer menu navigation takes priority while it is open.
      if (menu) {
        const count = menu.type === 'slash' ? filteredCommands.length : filteredMentions.length;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMenuIndex((i) => (count ? (i + 1) % count : 0));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMenuIndex((i) => (count ? (i - 1 + count) % count : 0));
          return;
        }
        if ((e.key === 'Enter' || e.key === 'Tab') && count > 0) {
          e.preventDefault();
          applyMenuSelection(menuIndex);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMenu(null);
          return;
        }
      }

      // Backspace with an empty textarea removes the active command pill.
      if (e.key === 'Backspace' && activeCommand && text.length === 0) {
        e.preventDefault();
        setActiveCommand(null);
        return;
      }

      if (e.key !== 'Enter') return;
      // W29 — a surface that does not declare composer key bindings leaves
      // Enter to the textarea's own newline behaviour, so the only way to
      // send is the button. Web and desktop both declare it.
      if (!COMPOSER.sendShortcut) return;
      // Ctrl/Cmd+Enter and Shift+Enter insert a newline; plain Enter sends.
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        e.preventDefault();
        insertNewline();
        return;
      }
      e.preventDefault();
      handleSend();
    },
    [menu, filteredCommands, filteredMentions, menuIndex, applyMenuSelection, activeCommand, text, handleSend, insertNewline, pauseVoiceIfListening],
  );

  const handleFileSelect = useCallback(() => {
    if (!COMPOSER.attachments) return;
    fileInputRef.current?.click();
  }, []);

  const handleFilesChanged = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      setAttachments((prev) => [
        ...prev,
        ...Array.from(files).map((file, i) => ({
          id: `file:${Date.now()}:${i}:${file.name}`,
          file,
          source: 'file' as CaptureSource,
        })),
      ]);
    }
    e.target.value = '';
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // W29 — dropping a file on a surface that declares no file attachment
    // must do nothing, not silently attach. `preventDefault` still runs so
    // the browser does not navigate away to the dropped file.
    if (!COMPOSER.attachments) return;
    const files = e.dataTransfer.files;
    if (files.length) {
      setAttachments((prev) => [
        ...prev,
        ...Array.from(files).map((file, i) => ({
          id: `file:${Date.now()}:${i}:${file.name}`,
          file,
          source: 'file' as CaptureSource,
        })),
      ]);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
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
              className="h-auto flex-shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
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
            {attachments.map((att) => {
              const isMention = att.source === 'mention';
              const label = att.label ?? att.file.name;
              return (
                <div
                  key={att.id}
                  className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)]/8 border border-[var(--color-primary)]/20 px-2.5 py-1 text-[11px] text-[var(--color-primary)] font-medium"
                  title={label}
                >
                  {isMention ? <AtSign className="h-3 w-3" /> : <Paperclip className="h-3 w-3" />}
                  <span className="max-w-[140px] truncate">{label}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeAttachment(att.id)}
                    className="h-auto w-auto rounded-full p-0.5 hover:bg-[var(--color-primary)]/15"
                    title="Remove"
                    aria-label={`Remove ${label}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                </div>
              );
            })}
            {mentionLoading && (
              <div className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted-foreground)]">
                <Spinner size="xs" /> Attaching…
              </div>
            )}
            {(pendingCaptures ?? []).map((cap) => {
              const Icon = cap.source === 'browser' ? Globe : cap.source === 'terminal' ? TerminalSquare : Paperclip;
              const label = cap.label ?? cap.file.name;
              return (
                <div
                  key={cap.id}
                  className="flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-foreground)] font-medium"
                  title={`${cap.source} capture — ${label}`}
                >
                  <Icon className="h-3 w-3" />
                  <span className="max-w-[140px] truncate">{label}</span>
                  {onRemovePendingCapture && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onRemovePendingCapture(cap.id)}
                      className="h-auto w-auto rounded-full p-0.5 hover:bg-[var(--color-background)]"
                      title="Remove"
                      aria-label={`Remove ${label}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </Button>
                  )}
                </div>
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
            onPaste={pauseVoiceIfListening}
            onClick={(e) => {
              noteManualCaretMove();
              detectMenu(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
            }}
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
                className="h-7 w-7 flex-shrink-0 rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
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
                        ? 'text-[var(--color-foreground)] bg-[var(--color-accent)]'
                        : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/60',
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
                            : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent)]',
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
                          ? 'text-[var(--color-foreground)] bg-[var(--color-accent)]'
                          : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/60',
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
                              effectiveEffort === level ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent)]',
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
                          ? 'text-[var(--color-foreground)] bg-[var(--color-accent)]'
                          : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/60',
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
                              effectiveTier === t.tier ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent)]',
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
                      ? 'text-[var(--color-foreground)] bg-[var(--color-accent)]'
                      : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/60',
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
                              effectiveEffort === level ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent)]',
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
                              effectiveTier === t.tier ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent)]',
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
              isSupported={voiceSupported}
              status={voiceStatus}
              error={voiceError}
              amplitude={voiceAmplitude}
              onStart={handleVoiceStart}
              onResume={resumeVoice}
              onStop={stopVoice}
              onCancel={cancelVoice}
            />

            {/* Stop — W30-b's two-phase control.
                Three states, and each one says something true: a plain Stop,
                a 400 ms disabled window so a double-tap cannot skip to the
                destructive path, and an explicit "Force reset" once the
                graceful path has demonstrably failed. The label widens into a
                pill only for the last one, so the composer's layout does not
                shift on every ordinary stop. */}
            {isStreaming && onStop ? (
              stopState?.forceAvailable ? (
                <Button
                  variant="ghost"
                  onClick={onStop}
                  className="h-8 gap-1.5 rounded-full bg-[var(--color-danger,var(--color-primary))] px-3 text-[11px] font-semibold text-[var(--color-primary-foreground,#fff)] hover:bg-[var(--color-danger,var(--color-primary))] hover:opacity-90 active:scale-[0.93]"
                  title="The turn did not stop gracefully — reset it"
                >
                  <Square className="h-3 w-3 fill-current" />
                  {stopState.label}
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
        <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
          <Button
            variant="ghost"
            onClick={() => setShowCodebasePanel((p) => !p)}
            disabled={disabled}
            aria-expanded={showCodebasePanel}
            className={cn(
              'h-auto gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium',
              showCodebasePanel || connectedRepoCount > 0
                ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10'
                : 'border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/60',
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

      <input
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
