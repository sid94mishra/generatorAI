// ────────────────────────────────────────────────────────────────
// useComposerController — everything the composer owns, in one hook.
//
// The screen used to hold the draft, the caret, the dictation sequencer and
// a fake `attachments={[]}` (D2). All of that now lives here, and the screen
// keeps only what is genuinely its own: the chat query, the PATCH
// mutations for model / mode / effort, and the transport. It spreads
// `props` onto `<Composer>` and adds those turn props beside them.
//
//   draft         MMKV `composer.draft.<chatId>` — restored on mount, cleared
//                 on send success, restored on failure
//   attachments   pickers → policy → chips; bytes read only at send
//   slash / @     builtins + skills + prompts + agents + workspace files,
//                 loaded lazily the first time a trigger is typed
//   voice         live STT with "scratch that" retraction and push-to-talk
//   history       server messages merged with a local ring of 50
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SharedValue } from 'react-native-reanimated';
import type { AgentMode, ChatMessage } from '@generatorai/client-core';
import { COMPUTER_USE_SKILL_ID } from '@generatorai/shared';

import { useApi } from '../../../api/useApi';
import { useAuth } from '../../../auth/AuthProvider';
import { checkFeature } from '../../../auth/featureGate';
import { PREF_KEYS, prefs } from '../../../storage/prefs';
import { useToast } from '../../ui/Toast';
import { haptics } from '../../ui/haptics';
import { announce } from '../../ui/accessibility';
import { useVoiceInput } from '../../../voice/useVoiceInput';
import { commitDictation, type CommittedRange } from '../../../voice/dictationCommit';
import { readPushToTalk } from '../../../voice/pushToTalk';
import { applyMenuSelection, detectMenu } from '../composerMenu';
import { pickAttachments } from './attachmentPickers';
import { attachmentKindFor, validateAttachment } from './attachmentPolicy';
import { clearDraft, readDraft, readLocalHistory, recordSentPrompt, writeDraft } from './draftStore';
import {
  caretLine,
  historyForSheet,
  mergePromptHistory,
  stepHistory,
} from './promptHistory';
import { buildSlashItems, rankMentionItems, rankSlashItems } from './slashSource';
import { captureToAttachment, insertCaptureIntoDraft, type CaptureInput } from './captures';
import type { ComposerCaptureActions } from './captureContext';
import { useCaptures } from './useCaptures';
import type {
  AttachmentSource,
  ComposerAttachment,
  ComposerSendPayload,
  PromptHistoryEntry,
  SlashItem,
  VoiceUiState,
} from './types';
import type { ComposerControlledProps } from '../Composer';

export type ComposerPane = NonNullable<SlashItem['pane']>;

export interface UseComposerControllerOptions {
  chatId: string;
  scopes: readonly string[];
  workspaceId?: string | null;
  /** Scopes the `/` menu's project artifacts and the `@agent` list. */
  projectId?: string | null;
  onSend: (payload: ComposerSendPayload) => Promise<void> | void;
  disabled?: boolean;
  /** `/browser`, `/terminal` and the pane openers resolve through this. */
  onOpenPane?: (pane: ComposerPane) => void;
  /**
   * Persisted user messages, for ↑ / swipe-up history. Widget- and
   * system-originated rows are filtered here, as web does.
   */
  messages?: readonly ChatMessage[];
  /**
   * A terminal / browser capture landed in the composer. The chat screen
   * brings the Chat page forward so the chip (or the inserted text) is seen.
   */
  onCaptured?: () => void;
}

export interface ComposerController {
  /** Spread onto `<Composer {...props} />`, then add the turn props. */
  props: ComposerControlledProps;
  attachments: {
    items: ComposerAttachment[];
    add(kind: AttachmentSource): Promise<void>;
    remove(id: string): void;
    clear(): void;
    pending: boolean;
  };
  voice: {
    state: VoiceUiState;
    start(): void;
    pause(): void;
    resume(): void;
    cancel(): void;
    accept(): void;
    amplitude: SharedValue<number>;
    error: string | null;
  };
  slash: {
    open: boolean;
    query: string;
    items: SlashItem[];
    select(item: SlashItem): void;
  };
  history: { open(): void };
  /**
   * Terminal output / browser captures. The chat screen provides these to
   * the panes through `ComposerCaptureContext` ("Send to chat").
   */
  captures: ComposerCaptureActions;
  /** Programmatic send — what the gate banner's "Cancel and send" calls. */
  send(mode?: AgentMode): Promise<void>;
  /** The draft, for screens that need to seed or inspect it. */
  draft: string;
  setDraft(text: string): void;
}

function readDisabledSkills(): string[] {
  try {
    const raw = prefs.getString(PREF_KEYS.disabledSkills);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function serverHistoryFrom(messages: readonly ChatMessage[] | undefined): PromptHistoryEntry[] {
  const out: PromptHistoryEntry[] = [];
  for (const m of messages ?? []) {
    if (m.role !== 'user') continue;
    const origin = m.metadata?.['origin'];
    if (origin === 'widget' || origin === 'system') continue;
    if (!m.content?.trim()) continue;
    const ts = m.timestamp ?? m.createdAt;
    out.push({ id: m.id, text: m.content, ts: ts ? new Date(ts).getTime() : 0 });
  }
  return out;
}

export function useComposerController(opts: UseComposerControllerOptions): ComposerController {
  const { chatId, scopes, workspaceId, projectId, onSend, disabled = false, onOpenPane, onCaptured } = opts;
  const api = useApi();
  const { fetch: authedFetch } = useAuth();
  const toast = useToast();

  const upload = checkFeature('fileUpload', scopes);
  const voiceFeature = checkFeature('voice', scopes);
  const browserScope = checkFeature('browser', scopes).available;
  const terminalScope = checkFeature('terminal', scopes).available;

  // ── Draft ──────────────────────────────────────────────────────
  const [draft, setDraftState] = useState<string>(() => readDraft(chatId));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [caret, setCaretState] = useState(0);
  const caretRef = useRef(0);
  const [pendingSelection, setPendingSelection] = useState<number | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Switching chats swaps the draft; the old one is already persisted.
  useEffect(() => {
    const restored = readDraft(chatId);
    setDraftState(restored);
    draftRef.current = restored;
  }, [chatId]);

  const setDraft = useCallback(
    (text: string) => {
      draftRef.current = text;
      setDraftState(text);
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => writeDraft(chatId, text), 250);
    },
    [chatId],
  );
  useEffect(
    () => () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        writeDraft(chatId, draftRef.current);
      }
    },
    [chatId],
  );

  const setCaret = useCallback((next: number) => {
    caretRef.current = next;
    setCaretState(next);
  }, []);

  // ── Voice ──────────────────────────────────────────────────────
  const [interim, setInterim] = useState('');
  const lastCommittedRef = useRef<CommittedRange | null>(null);

  const commitSegment = useCallback(
    (raw: string) => {
      const result = commitDictation(
        { draft: draftRef.current, caret: caretRef.current, lastCommitted: lastCommittedRef.current },
        raw,
      );
      lastCommittedRef.current = result.lastCommitted;
      if (result.retracted) haptics.select();
      setDraft(result.draft);
      setCaret(result.caret);
      setPendingSelection(result.caret);
    },
    [setDraft, setCaret],
  );

  const voice = useVoiceInput({
    onInterim: setInterim,
    onSegment: (text) => {
      setInterim('');
      commitSegment(text);
    },
    onFinal: (text) => {
      setInterim('');
      if (text) commitSegment(text);
    },
  });

  const voiceState: VoiceUiState =
    voice.status === 'connecting' ? 'transcribing' : voice.status;

  const voiceStart = useCallback(() => {
    if (!voice.supported) {
      toast({ message: 'Dictation needs a device microphone.', variant: 'info' });
      return;
    }
    if (voice.status === 'paused') {
      haptics.tap();
      voice.resume();
      announce('Listening');
      return;
    }
    if (voice.status !== 'idle' && voice.status !== 'error') return;
    haptics.tap();
    void voice.start();
    announce('Listening');
  }, [voice, toast]);

  const voiceAccept = useCallback(() => {
    haptics.success();
    voice.stop();
    setInterim('');
    announce('Transcribing');
  }, [voice]);

  const voiceCancel = useCallback(() => {
    haptics.select();
    voice.cancel();
    setInterim('');
    announce('Dictation cancelled');
  }, [voice]);

  /** Part C.3 — touching the field IS the pause signal. */
  const onComposerInteraction = useCallback(() => {
    // The committed range describes text the user has not touched; once
    // they have, "scratch that" must not reach back into it.
    lastCommittedRef.current = null;
    if (voice.status === 'listening') voice.pause();
  }, [voice]);

  // ── Attachments ────────────────────────────────────────────────
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const [attachPending, setAttachPending] = useState(false);

  const addAttachment = useCallback(
    async (kind: AttachmentSource) => {
      if (!upload.available) {
        toast({ message: upload.reason ?? 'Uploading files is not permitted on this device.', variant: 'warning' });
        return;
      }
      setAttachPending(true);
      try {
        const outcome = await pickAttachments(kind);
        if (outcome.status === 'cancelled') return;
        if (outcome.status !== 'picked') {
          toast({ message: outcome.reason, variant: outcome.status === 'denied' ? 'warning' : 'info' });
          return;
        }
        const accepted: ComposerAttachment[] = [];
        let refusal: string | null = null;
        for (const item of outcome.items) {
          const verdict = validateAttachment(item, [...attachmentsRef.current, ...accepted]);
          if (verdict.ok) accepted.push(item);
          else refusal = refusal ?? verdict.reason;
        }
        if (accepted.length) {
          haptics.success();
          setAttachments((prev) => [...prev, ...accepted]);
        }
        if (refusal) toast({ message: refusal, variant: 'warning', duration: 5000 });
      } finally {
        setAttachPending(false);
      }
    },
    [upload.available, upload.reason, toast],
  );

  // ── Captures (terminal output, browser) ───────────────────────
  const attachCapture = useCallback(
    (input: CaptureInput): boolean => {
      const candidate = captureToAttachment(input);
      const verdict = validateAttachment(candidate, attachmentsRef.current);
      if (!verdict.ok) {
        toast({ message: verdict.reason, variant: 'warning', duration: 5000 });
        return false;
      }
      haptics.success();
      // The ref is advanced now so two captures in one tick both count.
      attachmentsRef.current = [...attachmentsRef.current, candidate];
      setAttachments((prev) => [...prev, candidate]);
      announce(`${input.label} attached`);
      return true;
    },
    [toast],
  );

  const insertCaptureText = useCallback(
    (label: string, text: string) => {
      const next = insertCaptureIntoDraft(draftRef.current, { label, text });
      haptics.success();
      setDraft(next.text);
      setCaret(next.caret);
      setPendingSelection(next.caret);
    },
    [setDraft, setCaret],
  );

  const captures = useCaptures({
    workspaceId,
    authedFetch,
    uploadAvailable: upload.available,
    uploadReason: upload.reason,
    attach: attachCapture,
    insertText: insertCaptureText,
    setBusy: setAttachPending,
    toast,
    onCaptured,
  });

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);
  const clearAttachments = useCallback(() => setAttachments([]), []);

  // ── Slash / mention sources ────────────────────────────────────
  const menu = useMemo(() => detectMenu(draft, caret), [draft, caret]);
  const [slashWanted, setSlashWanted] = useState(false);
  const [mentionsWanted, setMentionsWanted] = useState(false);
  useEffect(() => {
    if (menu?.kind === 'slash' && !slashWanted) setSlashWanted(true);
    if (menu?.kind === 'mention' && !mentionsWanted) setMentionsWanted(true);
  }, [menu, slashWanted, mentionsWanted]);

  const skills = useQuery({
    queryKey: ['system', 'artifacts', 'skill'],
    queryFn: () => api.system.artifacts('skill'),
    enabled: slashWanted,
    staleTime: 60_000,
  });
  const prompts = useQuery({
    queryKey: ['system', 'artifacts', 'prompt'],
    queryFn: () => api.system.artifacts('prompt'),
    enabled: slashWanted,
    staleTime: 60_000,
  });
  const computerUse = useQuery({
    queryKey: ['computer-use-settings'],
    queryFn: async () => {
      const res = await authedFetch('/api/system/computer-use');
      if (!res.ok) return { enabled: false, skillId: COMPUTER_USE_SKILL_ID };
      return (await res.json()) as { enabled: boolean; skillId?: string };
    },
    enabled: slashWanted,
    staleTime: 30_000,
  });
  const agents = useQuery({
    queryKey: ['agents', 'selectable', projectId ?? ''],
    queryFn: () => api.agents.selectable(projectId ?? undefined),
    enabled: mentionsWanted,
    staleTime: 60_000,
  });
  const tree = useQuery({
    queryKey: ['workspaces', workspaceId ?? '', 'tree'],
    queryFn: () => api.workspaces.tree(workspaceId!),
    enabled: mentionsWanted && Boolean(workspaceId),
    staleTime: 60_000,
  });

  const slashItems = useMemo(
    () =>
      buildSlashItems({
        skills: skills.data ?? [],
        prompts: prompts.data ?? [],
        disabledSkillIds: readDisabledSkills(),
        computerUse: {
          enabled: computerUse.data?.enabled === true,
          skillId: computerUse.data?.skillId ?? COMPUTER_USE_SKILL_ID,
        },
        loadPromptTemplate: async (p) => (await api.system.artifactContent(p.id)).content,
      }),
    [skills.data, prompts.data, computerUse.data, api],
  );

  const mentionFiles = useMemo(() => {
    const repos = tree.data?.repos ?? [];
    const out: Array<{ path: string; alias?: string }> = [];
    for (const repo of repos) {
      for (const p of repo.paths) out.push(repo.alias ? { path: p, alias: repo.alias } : { path: p });
    }
    return out;
  }, [tree.data]);

  const suggestions = useMemo<SlashItem[]>(() => {
    if (!menu) return [];
    if (menu.kind === 'slash') return rankSlashItems(slashItems, menu.query);
    return rankMentionItems(menu.query, mentionFiles, agents.data ?? []);
  }, [menu, slashItems, mentionFiles, agents.data]);

  const [activeCommand, setActiveCommand] = useState<SlashItem | null>(null);
  const [mentionLoading, setMentionLoading] = useState(false);

  const selectSuggestion = useCallback(
    (item: SlashItem) => {
      const current = detectMenu(draftRef.current, caretRef.current);
      if (!current) return;
      haptics.select();

      const stripped = applyMenuSelection(draftRef.current, current, '');
      if (item.kind === 'navigate') {
        setDraft(stripped.text.trimStart());
        setCaret(0);
        setPendingSelection(0);
        if (item.pane) onOpenPane?.(item.pane);
        return;
      }
      if (item.kind === 'command' || item.kind === 'skill' || item.kind === 'prompt') {
        setActiveCommand(item);
        setDraft(stripped.text.trimStart());
        setCaret(0);
        setPendingSelection(0);
        // Builtins surface their pane before the message is dispatched so
        // the user can watch the agent drive it (web parity).
        if (item.kind === 'command' && item.pane) onOpenPane?.(item.pane);
        return;
      }
      if (item.kind === 'agent') {
        const next = applyMenuSelection(draftRef.current, current, `@${item.name} `);
        setDraft(next.text);
        setCaret(next.caret);
        setPendingSelection(next.caret);
        return;
      }
      // File: remove the token and attach the file's CONTENT, as web does.
      setDraft(stripped.text);
      setCaret(stripped.caret);
      setPendingSelection(stripped.caret);
      if (!workspaceId || !item.path) return;
      const path = item.path;
      if (attachmentsRef.current.some((a) => a.text !== undefined && a.name === path)) return;
      setMentionLoading(true);
      void api.workspaces
        .treeFile(workspaceId, item.alias ? { path, alias: item.alias } : { path })
        .then((file) => {
          if (file.isBinary || file.isTooLarge || file.contents === null) {
            toast({
              message: file.isBinary
                ? `${path} is binary and cannot be attached as text.`
                : `${path} is too large to attach inline.`,
              variant: 'warning',
            });
            return;
          }
          const candidate: ComposerAttachment = {
            id: `mention:${item.alias ?? ''}:${path}:${Date.now()}`,
            kind: attachmentKindFor('text/plain'),
            name: path,
            uri: '',
            mimeType: 'text/plain',
            size: file.size,
            text: file.contents,
          };
          const verdict = validateAttachment(candidate, attachmentsRef.current);
          if (!verdict.ok) {
            toast({ message: verdict.reason, variant: 'warning' });
            return;
          }
          setAttachments((prev) => [...prev, candidate]);
        })
        .catch(() => toast({ message: `Could not attach ${path}`, variant: 'danger' }))
        .finally(() => setMentionLoading(false));
    },
    [api, workspaceId, onOpenPane, setDraft, setCaret, toast],
  );

  // ── History ────────────────────────────────────────────────────
  const [localHistory, setLocalHistory] = useState<PromptHistoryEntry[]>(() => readLocalHistory());
  const serverHistory = useMemo(() => serverHistoryFrom(opts.messages), [opts.messages]);
  const history = useMemo(
    () => mergePromptHistory(serverHistory, localHistory),
    [serverHistory, localHistory],
  );
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const parkedDraftRef = useRef<string | null>(null);

  const showHistoryEntry = useCallback(
    (idx: number | null) => {
      if (idx === null) {
        const parked = parkedDraftRef.current ?? '';
        parkedDraftRef.current = null;
        setHistoryIdx(null);
        setDraft(parked);
        setCaret(parked.length);
        setPendingSelection(parked.length);
        return;
      }
      const entry = history[idx];
      if (!entry) return;
      if (historyIdx === null) parkedDraftRef.current = draftRef.current;
      setHistoryIdx(idx);
      setDraft(entry.text);
      setCaret(entry.text.length);
      setPendingSelection(entry.text.length);
    },
    [history, historyIdx, setDraft, setCaret],
  );

  /** Hardware ↑ / ↓ — shell semantics, only on the first / last line. */
  const onHistoryStep = useCallback(
    (dir: -1 | 1): boolean => {
      const line = caretLine(draftRef.current, caretRef.current);
      if (dir === -1 && !line.first) return false;
      if (dir === 1 && !line.last) return false;
      const next = stepHistory(historyIdx, history.length, dir);
      if (next === undefined) return false;
      showHistoryEntry(next);
      return true;
    },
    [historyIdx, history.length, showHistoryEntry],
  );

  const pickHistory = useCallback(
    (entry: PromptHistoryEntry) => {
      haptics.select();
      setHistoryVisible(false);
      setHistoryIdx(null);
      parkedDraftRef.current = null;
      setDraft(entry.text);
      setCaret(entry.text.length);
      setPendingSelection(entry.text.length);
    },
    [setDraft, setCaret],
  );

  // ── Send ───────────────────────────────────────────────────────
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const send = useCallback(
    async (mode?: AgentMode) => {
      if (sendingRef.current || disabled) return;
      const cmd = activeCommand;
      const rawInput = draftRef.current.trim();
      const current = attachmentsRef.current;
      if (!rawInput && !cmd && current.length === 0) return;

      sendingRef.current = true;
      setSending(true);
      haptics.commit();

      let prompt = rawInput;
      try {
        if (cmd?.format) {
          let template: string | undefined;
          if (cmd.loadTemplate) {
            try {
              template = await cmd.loadTemplate();
            } catch {
              toast({ message: `Could not load the "${cmd.name}" prompt template`, variant: 'warning' });
            }
          }
          prompt = cmd.format(rawInput, template);
        }
        if (!prompt.trim() && current.length === 0) return;

        // Optimistic clear, exactly as web: the field empties on this frame.
        setDraft('');
        clearDraft(chatId);
        setActiveCommand(null);
        setHistoryIdx(null);
        parkedDraftRef.current = null;
        lastCommittedRef.current = null;
        setAttachments((prev) => prev.map((a) => ({ ...a, uploading: true, error: undefined })));
        setLocalHistory(
          recordSentPrompt({
            id: `local:${Date.now()}`,
            text: rawInput,
            ts: Date.now(),
            attachments: current.map((a) => ({ name: a.name, mimeType: a.mimeType })),
          }),
        );

        try {
          await onSend({
            text: prompt,
            attachments: current.map((a) => ({ ...a, uploading: true })),
            ...(mode ? { mode } : {}),
          });
          setAttachments([]);
        } catch (err) {
          // The draft comes back; the screen toasts the server's reason.
          const message = (err as Error)?.message || 'Upload failed';
          if (draftRef.current.length === 0) {
            setDraft(rawInput);
            setCaret(rawInput.length);
            setPendingSelection(rawInput.length);
          }
          setActiveCommand(cmd);
          setAttachments(current.map((a) => ({ ...a, uploading: false, error: message })));
          haptics.error();
          throw err;
        }
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [activeCommand, disabled, chatId, onSend, setDraft, setCaret, toast],
  );

  const onSendPress = useCallback(() => {
    void send().catch(() => {
      /* restored above; the screen reports the reason */
    });
  }, [send]);
  const onSendWithPlan = useCallback(() => {
    void send('plan').catch(() => {
      /* restored above */
    });
  }, [send]);

  const pushToTalk = useMemo(() => readPushToTalk(), []);

  // ── Props for <Composer> ───────────────────────────────────────
  const props: ComposerControlledProps = {
    draft,
    onDraftChange: (text) => {
      if (historyIdx !== null) setHistoryIdx(null);
      setDraft(text);
    },
    caret,
    onCaretChange: setCaret,
    pendingSelection,
    onPendingSelectionApplied: () => setPendingSelection(null),
    onComposerInteraction,
    onSend: onSendPress,
    onSendWithPlan,
    sending,
    disabled,

    suggestions,
    onSelectSuggestion: selectSuggestion,
    suggestionsLoading:
      (menu?.kind === 'slash' && (skills.isLoading || prompts.isLoading)) ||
      (menu?.kind === 'mention' && (tree.isLoading || agents.isLoading)) ||
      mentionLoading,
    activeCommand: activeCommand
      ? { label: activeCommand.label, argHint: activeCommand.argHint, onRemove: () => setActiveCommand(null) }
      : null,
    onOpenPane,
    onHistoryStep,

    voiceAvailable: voiceFeature.available && voice.supported,
    voiceState,
    voiceInterim: interim,
    voiceAmplitude: voice.amplitude,
    voiceWaveform: voice.waveform,
    voiceStartedAt: voice.startedAt,
    voiceError: voice.error,
    pushToTalk,
    onVoiceStart: voiceStart,
    onVoicePause: () => {
      haptics.tap();
      voice.pause();
      announce('Paused');
    },
    onVoiceResume: () => {
      haptics.tap();
      voice.resume();
      announce('Listening');
    },
    onVoiceCancel: voiceCancel,
    onVoiceAccept: voiceAccept,

    attachments,
    onRemoveAttachment: removeAttachment,
    attachAvailable: upload.available,
    attachDisabledReason: upload.available ? undefined : (upload.reason ?? undefined),
    attachGrantable: upload.grantable,
    onAttachFrom: (source) => void addAttachment(source),
    attachPending,
    captureScopes: { browser: browserScope && Boolean(workspaceId), terminal: terminalScope && Boolean(workspaceId) },
    captureActions: captures,
    captureWorkspaceId: workspaceId ?? null,

    historyEntries: historyForSheet(history),
    historyVisible,
    onOpenHistory: () => setHistoryVisible(true),
    onCloseHistory: () => setHistoryVisible(false),
    onPickHistory: pickHistory,
  };

  return {
    props,
    attachments: {
      items: attachments,
      add: addAttachment,
      remove: removeAttachment,
      clear: clearAttachments,
      pending: attachPending,
    },
    voice: {
      state: voiceState,
      start: voiceStart,
      pause: voice.pause,
      resume: voice.resume,
      cancel: voiceCancel,
      accept: voiceAccept,
      amplitude: voice.amplitude,
      error: voice.error,
    },
    slash: {
      open: menu !== null,
      query: menu?.query ?? '',
      items: suggestions,
      select: selectSuggestion,
    },
    history: { open: () => setHistoryVisible(true) },
    captures,
    send,
    draft,
    setDraft,
  };
}
