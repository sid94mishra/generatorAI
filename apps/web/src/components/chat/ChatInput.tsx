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
  Paperclip, X, Loader2, Plus,
  FolderOpen, FolderGit2, GitBranch, ChevronDown, ChevronUp,
  Square, ArrowUp, Gauge, Search, Check, Info,
  Eye, Globe, Cpu, SlidersHorizontal, Lock,
  Sparkles, ScrollText, Wrench, FileText, TerminalSquare, AtSign,
  ClipboardList, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { ModelPicker, ProviderIcon, formatTokens, DetailRow } from '@/components/shared/ModelPicker.js';
import { ContextUsageGauge } from '@/components/shared/ContextUsageGauge.js';
import { resolveModelLimit } from '@generatorai/client-core';
import { VoiceRecorder } from './VoiceRecorder.js';
import { toast } from '@/components/Toast.js';

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
  pendingCaptures,
  onRemovePendingCapture,
  onBuiltinCommand,
  agentMode,
  onAgentModeChange,
  showAgentModePicker = true,
  pendingInteractionLabel,
  onCancelPendingInteraction,
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

  // ── Voice input ────────────────────────────────────────────────
  // Dictation appends after whatever is already typed. We snapshot the
  // existing text when recording starts, then set text = base + transcript
  // on every interim/final update so the box fills in real time. We never
  // auto-send — the user reviews and presses Enter.
  const textRef = useRef(text);
  textRef.current = text;
  const voiceBaseRef = useRef('');

  const handleVoiceStart = useCallback(() => {
    voiceBaseRef.current = textRef.current.trimEnd();
  }, []);

  const applyVoiceTranscript = useCallback((transcript: string, final: boolean) => {
    const base = voiceBaseRef.current;
    const joined = base ? `${base} ${transcript}` : transcript;
    setText(joined);
    if (final) {
      voiceBaseRef.current = joined.trimEnd();
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.selectionStart = el.selectionEnd = el.value.length;
        }
      });
    }
  }, []);

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
      // Ctrl/Cmd+Enter and Shift+Enter insert a newline; plain Enter sends.
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        e.preventDefault();
        insertNewline();
        return;
      }
      e.preventDefault();
      handleSend();
    },
    [menu, filteredCommands, filteredMentions, menuIndex, applyMenuSelection, activeCommand, text, handleSend, insertNewline],
  );

  const handleFileSelect = useCallback(() => {
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
      className="bg-[var(--color-background)] px-4 pt-3 pb-3"
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
            <button
              type="button"
              onClick={onCancelPendingInteraction}
              className="flex-shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
            >
              Cancel and send
            </button>
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
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading...
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
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="rounded-full p-0.5 hover:bg-[var(--color-primary)]/15 transition-colors"
                    title="Remove"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            })}
            {mentionLoading && (
              <div className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted-foreground)]">
                <Loader2 className="h-3 w-3 animate-spin" /> Attaching…
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
                    <button
                      onClick={() => onRemovePendingCapture(cap.id)}
                      className="rounded-full p-0.5 hover:bg-[var(--color-background)] transition-colors"
                      title="Remove"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Textarea ── */}
        <div className="px-4 pt-3.5 pb-1.5">
          {/* Active command pill — the selected `/command` runs as a mode; the
              textarea then holds its arguments. Backspace on empty removes it. */}
          {activeCommand && (
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary)]/12 border border-[var(--color-primary)]/30 px-2 py-1 text-[11px] font-medium text-[var(--color-primary)]">
              <span className="opacity-70">{commandIcon(activeCommand)}</span>
              <span>/{activeCommand.name}</span>
              <button
                onClick={() => { setActiveCommand(null); requestAnimationFrame(() => textareaRef.current?.focus()); }}
                className="rounded-full p-0.5 hover:bg-[var(--color-primary)]/15 transition-colors"
                title="Remove command"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onClick={(e) => detectMenu(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => { setIsFocused(false); setTimeout(() => setMenu(null), 120); }}
            disabled={disabled}
            placeholder={activeCommand?.argHint ?? placeholder}
            rows={1}
            className={cn(
              'w-full resize-none bg-transparent text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]/70 focus:outline-none disabled:cursor-not-allowed',
              'leading-relaxed min-h-[64px] max-h-[200px] outline-none',
            )}
          />
        </div>

        {/* ── Bottom Toolbar (seamless, inside the card) ── */}
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-0.5">
          {/* Left: Actions (wrap + min-w-0 so icons never overflow the card) */}
          <div ref={toolbarRef} className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
            {/* Attach */}
            <button
              onClick={handleFileSelect}
              disabled={disabled}
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50 transition-colors"
              title="Attach file"
            >
              <Plus className="h-4 w-4" />
            </button>

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

            {/* Agent mode — Interactive vs Plan.
                Sits directly after the model picker because it changes what
                the agent is allowed to DO, which is the most consequential
                per-turn choice after the model itself. */}
            {showAgentModePicker && (
              <div className="relative flex-shrink-0" ref={modeDropdownRef}>
                <button
                  type="button"
                  onClick={() => {
                    setShowModeDropdown((p) => !p);
                    setShowReasoningDropdown(false);
                    setShowToolsMenu(false);
                   
                  }}
                  aria-haspopup="listbox"
                  aria-expanded={showModeDropdown}
                  aria-label={`Agent mode: ${AGENT_MODE_REGISTRY[activeAgentMode].label}`}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
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
                </button>
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
                      <button
                        key={option.mode}
                        type="button"
                        role="option"
                        aria-selected={activeAgentMode === option.mode}
                        onClick={() => {
                          onAgentModeChange?.(option.mode);
                          setShowModeDropdown(false);
                        }}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
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
                      </button>
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
                    <button
                      onClick={() => { setShowReasoningDropdown((p) => !p); setShowToolsMenu(false); }}
                      className={cn(
                        'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors',
                        showReasoningDropdown
                          ? 'text-[var(--color-foreground)] bg-[var(--color-accent)]'
                          : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/60',
                      )}
                      title="Reasoning effort"
                    >
                      <span>{effectiveEffort ?? 'Reasoning'}</span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </button>
                    {showReasoningDropdown && (
                      <div className="absolute bottom-full left-0 mb-1.5 z-[100] w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl p-1.5 animate-in fade-in-0 zoom-in-95 duration-150">
                        <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Reasoning effort</p>
                        {reasoningLevels.map((level) => (
                          <button
                            key={level}
                            onClick={() => { onReasoningEffortChange?.(level); setShowReasoningDropdown(false); }}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs capitalize transition-colors',
                              effectiveEffort === level ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent)]',
                            )}
                          >
                            {effectiveEffort === level ? <Check className="h-3 w-3" /> : <span className="w-3" />}
                            {level}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Context-window inline pill */}
                {hasContext && (
                  <div className="relative" ref={toolsMenuRef}>
                    <button
                      onClick={() => { setShowToolsMenu((p) => !p); setShowReasoningDropdown(false); }}
                      className={cn(
                        'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                        showToolsMenu
                          ? 'text-[var(--color-foreground)] bg-[var(--color-accent)]'
                          : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/60',
                      )}
                      title="Context window"
                    >
                      <span>{activeTierTokens ? formatTokens(activeTierTokens) : 'Context'}</span>
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </button>
                    {showToolsMenu && (
                      <div className="absolute bottom-full left-0 mb-1.5 z-[100] w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl p-1.5 animate-in fade-in-0 zoom-in-95 duration-150">
                        <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Context window</p>
                        {contextTiers.map((t) => (
                          <button
                            key={t.tier}
                            onClick={() => { onContextTierChange?.(t.tier); setShowToolsMenu(false); }}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                              effectiveTier === t.tier ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent)]',
                            )}
                          >
                            <span className="flex items-center gap-2">
                              {effectiveTier === t.tier ? <Check className="h-3 w-3" /> : <span className="w-3" />}
                              {t.tier === 'long_context' ? 'Long context' : 'Standard'}
                            </span>
                            <span className="font-mono text-[10px] text-[var(--color-muted-foreground)]">{formatTokens(t.tokens)}</span>
                          </button>
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
                <button
                  onClick={() => { setShowToolsMenu((p) => !p); setShowReasoningDropdown(false); }}
                  className={cn(
                    'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors',
                    showToolsMenu
                      ? 'text-[var(--color-foreground)] bg-[var(--color-accent)]'
                      : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/60',
                  )}
                  title="More options"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </button>
                {showToolsMenu && (
                  <div className="absolute bottom-full left-0 mb-1.5 z-[100] w-52 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl p-1.5 animate-in fade-in-0 zoom-in-95 duration-150">
                    {hasReasoning && (
                      <>
                        <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">Reasoning effort</p>
                        {reasoningLevels.map((level) => (
                          <button
                            key={level}
                            onClick={() => { onReasoningEffortChange?.(level); }}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs capitalize transition-colors',
                              effectiveEffort === level ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent)]',
                            )}
                          >
                            {effectiveEffort === level ? <Check className="h-3 w-3" /> : <span className="w-3" />}
                            {level}
                          </button>
                        ))}
                      </>
                    )}
                    {hasContext && (
                      <>
                        <p className={cn('px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]', hasReasoning && 'mt-1 border-t border-[var(--color-border)]/60 pt-2')}>Context window</p>
                        {contextTiers.map((t) => (
                          <button
                            key={t.tier}
                            onClick={() => { onContextTierChange?.(t.tier); }}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                              effectiveTier === t.tier ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-foreground)] hover:bg-[var(--color-accent)]',
                            )}
                          >
                            <span className="flex items-center gap-2">
                              {effectiveTier === t.tier ? <Check className="h-3 w-3" /> : <span className="w-3" />}
                              {t.tier === 'long_context' ? 'Long context' : 'Standard'}
                            </span>
                            <span className="font-mono text-[10px] text-[var(--color-muted-foreground)]">{formatTokens(t.tokens)}</span>
                          </button>
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
            {/* Voice input — local Whisper transcription; fills the box live. */}
            <VoiceRecorder
              disabled={disabled || isLoading || isStreaming}
              onStart={handleVoiceStart}
              onInterim={(t) => applyVoiceTranscript(t, false)}
              onFinal={(t) => applyVoiceTranscript(t, true)}
              onError={(message) => toast({ variant: 'error', title: 'Voice input', description: message })}
            />

            {/* Stop button — enabled whenever a turn is streaming; theme-aware. */}
            {isStreaming && onStop ? (
              <button
                onClick={onStop}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground,#fff)] hover:opacity-90 active:scale-[0.93] transition-all"
                title="Stop generation"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              /* Send button — circular */
              <button
                onClick={handleSend}
                disabled={!canSend}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150',
                  canSend
                    ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground,#fff)] hover:opacity-90 active:scale-[0.93]'
                    : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]/50',
                )}
                title="Send (Enter)"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Separate row below the input: project / codebase context ── */}
      {(projectId || showGitConnector) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
          <button
            onClick={() => setShowCodebasePanel((p) => !p)}
            disabled={disabled}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
              showCodebasePanel || connectedRepoCount > 0
                ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
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
          </button>
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
