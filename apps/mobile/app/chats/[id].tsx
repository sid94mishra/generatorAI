// ────────────────────────────────────────────────────────────────
// Chat screen — the core loop.
//
// Layout (plan §6.4):
//   header          title (tap → rename), transport badge, menu
//   pane strip      Chat · Changes 3 · Terminal · Browser · Computer · ⋯
//   ┌ Chat page ────────────────────────────────────────────────┐
//   │ transcript      history + live rows, ONE row model, tail-aligned
//   │ changes tray    "3 files changed +40 −12 · Review ›"
//   │ decision cards  permission / question / plan, PINNED
//   │ composer        always reachable above the keyboard
//   └───────────────────────────────────────────────────────────┘
//   panes            Changes / Terminal / Browser / Computer, swipeable
//   More sheet       Files · Plan · Tasks · Widgets · Inspector
//
// The transcript is a LegendList with `alignItemsAtEnd` + `maintainScrollAtEnd`,
// NOT an inverted FlatList: inversion breaks keyboard avoidance and layout
// animations, and is the usual reason mobile chat UIs feel wrong.
//
// Decision cards being pinned rather than inline is the one place mobile
// deliberately diverges from web. On a desktop the transcript and the card
// are both visible; on a phone a long tool run pushes an inline card off
// screen, and a decision the user cannot see is a turn that silently stalls.
//
// Rendering budget (plan §7.2): the screen subscribes to the stream through
// `selectChatView` + `useShallow`, which changes only on STRUCTURAL events —
// so a token landing re-renders the one live row (which subscribes to its
// own block) and nothing else. Rows are derived on the blocks signature and
// memoised on block identity; history turns are derived once per message.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Share, Text, View } from 'react-native';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import * as Clipboard from 'expo-clipboard';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  Copy,
  GitFork,
  Pencil,
  Share2,
  Square,
  Volume2,
} from 'lucide-react-native';
import {
  ApiError,
  isArchived,
  queryKeys,
  type AgentMode,
  type ChatMessage,
  type ChatSummary,
  type RewindScope,
  type StreamBlock,
  type StreamUsage,
} from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import {
  useCopyTranscriptMarkdown,
  useForkChat,
  useRewindChat,
} from '../../src/api/useChatBranching';
import { useModels } from '../../src/api/useModels';
import { useChatStream, type SseStatus } from '../../src/stream/useChatStream';
import { restoredPromptFrom, type ChatRewoundEffect } from '../../src/stream/rewindEffects';
import { useTwoPhaseStop } from '../../src/stream/useTwoPhaseStop';
import { protectStream, useStreamStore } from '../../src/stream/streamStore';
import { useStreamHealth } from '../../src/stream/streamHealth';
import { useAuth } from '../../src/auth/AuthProvider';
import { checkFeature } from '../../src/auth/featureGate';
import { useTextToSpeech } from '../../src/voice/useTextToSpeech';
import { Composer, type ComposerPane } from '../../src/components/chat/Composer';
import {
  useComposerController,
  type ComposerController,
} from '../../src/components/chat/composer/useComposerController';
import { readAllAttachmentBytes } from '../../src/components/chat/composer/attachmentPickers';
import type { ComposerSendPayload, WorkspacePrepState } from '../../src/components/chat/composer/types';
import type { BoundAgentProps } from '../../src/components/chat/composer/ComposerBanners';
import { bytesToBase64 } from '../../src/lib/base64';
import { PermissionCard } from '../../src/components/chat/PermissionCard';
import { PlanCard } from '../../src/components/chat/PlanCard';
import { QuestionCard } from '../../src/components/chat/QuestionCard';
import { RenameSheet } from '../../src/components/chat/RenameSheet';
import { RewindSheet } from '../../src/components/chat/RewindSheet';
import {
  describeFork,
  describeRewind,
  forkedFromLabel,
  shouldRestorePrompt,
} from '../../src/components/chat/rewindOptions';
import { toPlanDecision } from '../../src/components/chat/gateActions';
import { pendingGateFrom } from '../../src/components/chat/gateFromInteraction';
import { ChatHeaderMenuButton, ChatHeaderTitle } from '../../src/components/chat/ChatHeader';
import { describeSessionTransport } from '../../src/components/chat/sessionTransport';
import { TimelineRowView } from '../../src/components/chat/timeline/TimelineRow';
import { UserMessageRow } from '../../src/components/chat/timeline/UserMessageRow';
import { TimelineActionsContext, type TimelineActions } from '../../src/components/chat/timeline/TimelineActions';
import { deriveTimeline, type ScreenshotRef, type TimelineRow } from '../../src/components/chat/timeline/deriveTimeline';
import { chatMessageToBlocks, messageWasStopped } from '../../src/components/chat/timeline/chatMessageToBlocks';
import {
  liveScmTurnIds,
  mergeScmRows,
  replayedScmBlock,
  replayedScmRowId,
} from '../../src/components/chat/timeline/mergeScmRows';
import { useScmResults } from '../../src/components/scm/useScmResults';
import { activityLabelFor, selectChatView } from '../../src/components/chat/timeline/selectChatView';
import { SessionPanes } from '../../src/components/chat/panes/SessionPanes';
import { routeSection, type PaneId } from '../../src/components/chat/panes/paneModel';
import { MoreSheet, type MoreSection } from '../../src/components/chat/panes/MoreSheet';
import { ChangesTray } from '../../src/components/chat/panes/ChangesTray';
import { useChangesSummary } from '../../src/components/chat/panes/useChangesSummary';
import { AgentConsole } from '../../src/terminal';
import { ImageLightbox, type LightboxImage } from '../../src/components/markdown/MarkdownImage';
import { Button, IconButton } from '../../src/components/ui/Button';
import { ActionSheet } from '../../src/components/ui/ActionSheet';
import { Sheet } from '../../src/components/ui/Sheet';
import { KeyboardSticky } from '../../src/components/ui/KeyboardSticky';
import { useKeyboardShown } from '../../src/components/ui/keyboard';
import { useToast } from '../../src/components/ui/Toast';
import { EmptyState, ErrorState, LoadingState, Spinner } from '../../src/components/ui/States';
import { Touchable } from '../../src/components/ui/Touchable';
import { haptics } from '../../src/components/ui/haptics';
import { useTheme } from '../../src/theme/ThemeProvider';

/** A transcript row: a user bubble, a derived timeline row, or the working indicator. */
type Row =
  | { kind: 'user'; id: string; message: ChatMessage }
  // `turnId` is what "Fork from here" anchors to. Only history rows have
  // one: the live turn has no server turn id until it settles.
  | { kind: 'row'; id: string; row: TimelineRow; turnId?: string }
  | { kind: 'activity'; id: string; label: string };

/** How many messages are fetched at a time. */
const PAGE_SIZE = 120;

// History turns never change once fetched, so their rows are derived once
// per message object and reused across every live-turn update. WeakMaps so
// a refetched page frees the old entries.
const historyRows = new WeakMap<ChatMessage, TimelineRow[]>();
const historyBlocks = new WeakMap<ChatMessage, StreamBlock[]>();

function blocksOf(message: ChatMessage): StreamBlock[] {
  let blocks = historyBlocks.get(message);
  if (!blocks) {
    blocks = chatMessageToBlocks(message);
    historyBlocks.set(message, blocks);
  }
  return blocks;
}

function rowsOf(message: ChatMessage): TimelineRow[] {
  let rows = historyRows.get(message);
  if (!rows) {
    rows = deriveTimeline(blocksOf(message), {
      active: false,
      idPrefix: `${message.id}:`,
      stopped: messageWasStopped(message),
    });
    historyRows.set(message, rows);
  }
  return rows;
}

/** Mirrors web's `browserArtifactUrl` — where a browser screenshot is served from. */
function browserArtifactPath(workspaceId: string, relativePath: string): string {
  const clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/browser/files/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

/** The transcript as plain text, for the share sheet. */
function transcriptText(messages: readonly ChatMessage[], title: string): string {
  const lines = [title, ''];
  for (const m of messages) {
    if (!m.content?.trim()) continue;
    lines.push(`${m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Agent' : m.role}: ${m.content.trim()}`, '');
  }
  return lines.join('\n');
}

export default function ChatScreen(): React.ReactElement {
  const { id: chatId } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const auth = useAuth();
  const { state } = auth;
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  const listRef = useRef<LegendListRef | null>(null);

  const [pane, setPane] = useState<PaneId>('chat');
  const [focusedFile, setFocusedFile] = useState<string | null>(null);
  const [more, setMore] = useState<MoreSection | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  // The user message a rewind is anchored on: its turn id, and its text so
  // the sheet can show what it is about to go back to.
  const [rewindTarget, setRewindTarget] = useState<{ turnId: string; prompt: string } | null>(null);
  const [consoleCallId, setConsoleCallId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [, setConnection] = useState<SseStatus>({ state: 'idle' });
  const [atBottom, setAtBottom] = useState(true);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const models = useModels();
  const scopes = state.status === 'authenticated' ? state.scopes : [];
  // Read-aloud on rows and the live turn. Dictation itself is owned by the
  // composer controller below — one `useVoiceInput` per screen, never two.
  const voice = checkFeature('voice', scopes);
  const tts = useTextToSpeech();

  const chat = useQuery({
    queryKey: queryKeys.chat(chatId!),
    queryFn: () => api.chats.get(chatId!),
  });

  /**
   * The composer controller, reachable from callbacks declared above it.
   *
   * A rewind restores its prompt into the DRAFT (Claude Code does the same:
   * the prompt comes back in the input box so it can be edited and resent —
   * never auto-sent). The controller is created further down, because it
   * needs the send handler, so the stream callback reaches it through this
   * ref rather than by reordering the whole screen around one arrow.
   */
  const composerRef = useRef<ComposerController | null>(null);

  /**
   * Rewinds initiated HERE, so the stream echo does not toast twice.
   *
   * Keyed `turnId:scope`. The local mutation has the file counts and says
   * them; the broadcast only knows that it happened, which is exactly what a
   * second device needs to hear and this one does not.
   */
  const selfRewound = useRef(new Set<string>());

  const onChatRewound = useCallback(
    (effect: ChatRewoundEffect) => {
      const prompt = restoredPromptFrom(effect);
      // Idempotent, and it must happen on BOTH paths: a rewind from another
      // device should hand this composer the prompt too.
      if (prompt) composerRef.current?.setDraft(prompt);

      const key = `${effect.turnId}:${effect.scope}`;
      if (selfRewound.current.delete(key)) return;
      toast({ message: 'This chat was rewound on another device.', tone: 'info' });
    },
    [toast],
  );

  // Keyed by the chat's session id once known (the store key the screen reads).
  useChatStream({
    chatId: chatId!,
    sessionId: chat.data?.sessionId,
    onStatusChange: setConnection,
    onChatRewound,
  });

  const messages = useQuery({
    queryKey: [...queryKeys.chatMessages(chatId!), limit],
    queryFn: () => api.chats.messages(chatId!, { limit }),
  });

  const plans = useQuery({
    queryKey: queryKeys.chatPlans(chatId!),
    queryFn: () => api.chats.plans(chatId!),
  });

  // The commit / PR / conflict cards for turns that settled before this
  // screen opened. They exist only as stream events, and the mux
  // subscription starts at the live cursor, so without this replay a
  // reopened chat showed its answers with no record of what was committed
  // for them.
  const scmResults = useScmResults(chatId);

  const workspaceId = chat.data?.workspaceId ?? null;
  const archived = chat.data ? isArchived(chat.data) : false;
  const changes = useChangesSummary(workspaceId);

  // D7 — the mode is the CHAT's `defaultAgentMode`, not screen state.
  const mode: AgentMode = chat.data?.defaultAgentMode ?? 'auto';

  const projectId = (chat.data as { projectId?: string | null } | undefined)?.projectId ?? null;
  const project = useQuery({
    queryKey: queryKeys.project(projectId ?? ''),
    queryFn: () => api.projects.get(projectId!),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
  // Mount aliases ("main", "docs") name what is checked out for this chat.
  const repoAliases = useMemo(
    () => (changes.data?.repos ?? []).map((repo) => repo.alias).filter((a) => a && a !== '.'),
    [changes.data?.repos],
  );

  const codebaseCount =
    (chat.data as { codebaseIds?: string[] } | undefined)?.codebaseIds?.length ??
    project.data?.codebases.length ??
    0;

  // The stream is keyed by session id; a chat that has never run has none.
  const streamKey = chat.data?.sessionId ?? chatId!;
  // Pinned while on screen so the LRU never evicts the transcript being read.
  useEffect(() => protectStream(streamKey), [streamKey]);

  /**
   * §7.2 — structural view of the stream. `useShallow` compares field by
   * field, and every field here is a primitive or an identity that only
   * changes on a structural event, so text streaming into the live block
   * does not re-render this screen at all.
   */
  const view = useStreamStore(useShallow((s) => selectChatView(s.streams[streamKey])));
  const applyEffects = useStreamStore((s) => s.applyEffects);
  const isStreaming = view.isLive;

  // The previous turn's usage, for the cache-miss rule on the usage chip.
  const usageRef = useRef<{ current: StreamUsage | null; previous: StreamUsage | null }>({ current: null, previous: null });
  if (view.usage && view.usage !== usageRef.current.current) {
    usageRef.current = { previous: usageRef.current.current, current: view.usage };
  }

  const [liveSpeaking, setLiveSpeaking] = useState(false);
  useEffect(() => {
    if (tts.status === 'idle' || tts.status === 'error') setLiveSpeaking(false);
  }, [tts.status]);

  const onSpeakLive = useCallback(() => {
    if (liveSpeaking) {
      tts.stop();
      setLiveSpeaking(false);
      return;
    }
    haptics.tap();
    setLiveSpeaking(true);
    void tts.speakStream(streamKey).then((err) => {
      if (err) {
        setLiveSpeaking(false);
        toast({ message: err, tone: 'error' });
      }
    });
  }, [liveSpeaking, tts, streamKey, toast]);

  // W30-b — two-phase Stop on the shared machine web uses; the BACKEND
  // decides whether a second press is offered (`isLive` is stream-derived).
  const stop = useTwoPhaseStop({
    isLive: isStreaming,
    onCancel: (options) => cancel.mutate(options),
  });

  const activityLabel = activityLabelFor(view);

  // ── Header ───────────────────────────────────────────────────
  const streamConnection = useStreamHealth((s) => s.connection);
  const transport = describeSessionTransport(auth.transport, streamConnection);
  const title = chat.data?.name ?? 'Chat';
  // What this chat will touch, under its name. The project it is bound to is
  // otherwise only discoverable by opening the New-chat sheet's Project page
  // on a chat that already exists — which is to say, not at all.
  const headerSubtitle = useMemo(() => {
    const parts: string[] = [];
    if (project.data?.name) parts.push(project.data.name);
    else if (repoAliases.length > 0) parts.push(repoAliases.join(', '));
    if (mode === 'plan') parts.push('Plan first');
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [project.data?.name, repoAliases, mode]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerTitle: () => (
        <ChatHeaderTitle
          title={title}
          subtitle={headerSubtitle}
          transport={transport}
          onPress={() => setRenameOpen(true)}
        />
      ),
      headerRight: () => <ChatHeaderMenuButton onPress={() => setMenuOpen(true)} />,
    });
    // `transport` is rebuilt every render; its label/tone are what matter.
  }, [navigation, title, headerSubtitle, transport.label, transport.tone]);

  // ── Mutations ────────────────────────────────────────────────
  /**
   * The send the composer controller drives. Multipart always: text plus
   * whatever chips are in the tray, their bytes read only now. Optimistic
   * exactly as web — the bubble and the working row appear on this frame —
   * and on failure the controller has already restored the draft and the
   * chips; the screen's job is to say why.
   */
  const sendPrompt = useCallback(
    async (payload: ComposerSendPayload) => {
      const text = payload.text.trim();
      applyEffects([{ op: 'startPending', key: streamKey, userMessage: text }]);
      try {
        const files = await readAllAttachmentBytes(payload.attachments);
        await api.chats.sendWithAttachments(chatId!, { message: text, mode: payload.mode ?? mode }, files);
        void queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(chatId!) });
      } catch (err) {
        const gated = err instanceof ApiError && err.status === 409;
        toast({
          message: gated
            ? 'The agent is still waiting on a decision. Answer it, then send again.'
            : 'Could not send that. Your text has been restored.',
          tone: 'error',
        });
        throw err;
      }
    },
    [api, chatId, mode, streamKey, applyEffects, queryClient, toast],
  );

  // Worktrees and branch checkouts finish after the chat exists; while they
  // do, the composer shows the prep bar and offers a retry on failure.
  const prepareWorkspace = useMutation({
    mutationFn: async () => {
      const res = await auth.fetch(`/api/chats/${encodeURIComponent(chatId!)}/workspace/prepare`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId!) });
    },
    onError: () => {
      haptics.error();
      toast({ message: 'Could not restart workspace preparation.', tone: 'error' });
    },
  });

  /**
   * Patch the chat — model, agent mode, permission mode, harness config,
   * name. D7/D24 — optimistic: the chat query is rewritten before the request
   * goes out, so every chip reflects the tap on this frame; a failure
   * restores the snapshot and says so.
   */
  type ChatPatch = Parameters<typeof api.chats.update>[1];
  const patchChat = useMutation({
    mutationFn: (patch: ChatPatch) => api.chats.update(chatId!, patch),
    onMutate: async (patch) => {
      const key = queryKeys.chat(chatId!);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChatSummary>(key);
      if (previous) {
        queryClient.setQueryData<ChatSummary>(key, { ...previous, ...patch } as ChatSummary);
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.chat(chatId!), context.previous);
      }
      haptics.error();
      toast({ message: 'That setting did not stick. Try again.', tone: 'error' });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId!) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats() });
    },
  });

  const harnessConfig = (chat.data as { harnessConfig?: Record<string, unknown> } | undefined)
    ?.harnessConfig;
  const effort = (harnessConfig?.['reasoningEffort'] as string | undefined) ?? null;
  const contextTier =
    (harnessConfig?.['contextTier'] as 'default' | 'long_context' | undefined) ?? 'default';

  const patchHarness = useCallback(
    (patch: Record<string, unknown>) => {
      patchChat.mutate({ harnessConfig: { ...(harnessConfig ?? {}), ...patch } } as ChatPatch);
    },
    [patchChat, harnessConfig],
  );

  // Archiving is reversible, so this menu item toggles rather than turning
  // into a permanently disabled "Archived" row — which is what the chat list
  // has always done ("Move to active") and what the detail screen did not.
  const archive = useMutation({
    mutationFn: (next: 'archived' | 'active') => api.chats.update(chatId!, { status: next }),
    onSuccess: (_result, next) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId!) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats() });
      toast({ message: next === 'archived' ? 'Chat archived.' : 'Chat restored.', tone: 'success' });
    },
    onError: () => {
      haptics.error();
      toast({ message: 'Could not change this chat.', tone: 'error' });
    },
  });

  const cancel = useMutation({
    mutationFn: (options: { force: boolean; budgetSeconds: number }) =>
      api.chats.cancel(chatId!, options),
  });

  // ── History: rewind, fork, copy transcript ───────────────────
  const rewind = useRewindChat(chatId!, workspaceId);
  const fork = useForkChat(chatId!, workspaceId);
  const copyTranscript = useCopyTranscriptMarkdown(chatId!);

  /**
   * Run the rewind the sheet asked for.
   *
   * The 409 the server answers while a turn is in flight is a real outcome,
   * not a bug: the sheet already disables its rows while `isStreaming`, but
   * a turn can start between the tap and the request, and another device can
   * start one at any moment.
   */
  const runRewind = useCallback(
    async (scope: RewindScope) => {
      const target = rewindTarget;
      if (!target) return;
      setRewindTarget(null);
      const key = `${target.turnId}:${scope}`;
      selfRewound.current.add(key);
      try {
        const result = await rewind.mutateAsync({ turnId: target.turnId, scope });
        // The dropped turn is still in this device's block model until the
        // broadcast lands; clearing now means the transcript does not render
        // the discarded turn over the restored history for a frame or two.
        if (scope !== 'code') useStreamStore.getState().clear(streamKey);
        if (shouldRestorePrompt(result.scope, result.prompt)) {
          composerRef.current?.setDraft(result.prompt);
        }
        haptics.select();
        toast({ message: describeRewind(result), tone: 'success' });
      } catch (error) {
        selfRewound.current.delete(key);
        haptics.error();
        const busy = error instanceof ApiError && error.status === 409;
        toast({
          message: busy
            ? 'The agent is still working on this chat. Stop the turn, then rewind.'
            : 'Could not rewind this chat. Nothing was changed.',
          tone: 'error',
        });
      }
    },
    [rewindTarget, rewind, streamKey, toast],
  );

  /**
   * Branch a new chat from the end of a turn and go to it.
   *
   * `turnId` omitted means "from the last turn", which is what the chat-level
   * menu asks for.
   */
  const runFork = useCallback(
    async (turnId?: string) => {
      try {
        const result = await fork.mutateAsync(turnId ? { turnId } : {});
        haptics.select();
        toast({ message: describeFork(result.chat.name, result.conversation), tone: 'success' });
        router.push({ pathname: '/chats/[id]', params: { id: result.chat.id } });
      } catch (error) {
        haptics.error();
        const busy = error instanceof ApiError && error.status === 409;
        toast({
          message: busy
            ? 'The agent is still working on this chat. Stop the turn, then fork.'
            : 'Could not fork this chat.',
          tone: 'error',
        });
      }
    },
    [fork, toast],
  );

  /**
   * The WHOLE chat on the clipboard as markdown.
   *
   * Deliberately not the paged `messages` query: that one is capped at
   * `limit`, so copying from it would silently truncate a long chat at
   * whatever the user happened to have scrolled into view.
   */
  const runCopyTranscript = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(await copyTranscript());
      toast({ message: 'Transcript copied', tone: 'success' });
    } catch {
      haptics.error();
      toast({ message: 'Could not copy the transcript.', tone: 'error' });
    }
  }, [copyTranscript, toast]);

  /**
   * The chat this one was branched from.
   *
   * Fetched lazily and only when there is a parent: it is a chip, not a
   * reason to spend a request on every chat open. The name falls back in
   * `forkedFromLabel` when the parent has been deleted or is still loading.
   */
  const forkedFromChatId =
    (chat.data as { forkedFromChatId?: string | null } | undefined)?.forkedFromChatId ?? null;
  const parentChat = useQuery({
    queryKey: queryKeys.chat(forkedFromChatId ?? ''),
    queryFn: () => api.chats.get(forkedFromChatId!),
    enabled: Boolean(forkedFromChatId),
    staleTime: 60_000,
  });

  const decidePlan = useMutation({
    mutationFn: ({ planId, action, feedback }: { planId: string; action: string; feedback?: string }) =>
      api.chats.decidePlan(chatId!, planId, toPlanDecision(action, feedback)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatPlans(chatId!) });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) return;
      haptics.error();
      toast({ message: 'Could not send that decision. Try again.', tone: 'error' });
    },
  });

  const answerQuestion = useMutation({
    mutationFn: ({
      interactionId,
      answers,
      freeformResponse,
    }: {
      interactionId: string;
      answers: Record<string, string[]>;
      freeformResponse?: string;
    }) =>
      api.chats.respond(chatId!, interactionId, {
        answers,
        ...(freeformResponse ? { freeformResponse } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatInteractions(chatId!) });
    },
  });

  const resolvePermission = useMutation({
    mutationFn: ({
      interactionId,
      behavior,
      message,
    }: {
      interactionId: string;
      behavior: 'allow' | 'deny';
      message?: string;
    }) =>
      api.chats.respondPermission(chatId!, interactionId, {
        behavior,
        ...(message ? { message } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatInteractions(chatId!) });
    },
    onError: (error) => {
      // 409: another device already answered — the stream settles the card.
      if (error instanceof ApiError && error.status === 409) return;
      haptics.error();
      toast({ message: 'Could not send that decision. Try again.', tone: 'error' });
    },
  });

  // ── Rows ─────────────────────────────────────────────────────
  /**
   * History + live rows, one model.
   *
   * De-duplication is by SERVER TURN ID: the live turn is fully represented
   * as blocks, so once its messages land in history they would render twice.
   *
   * The live blocks are read from the store INSIDE the memo, keyed on the
   * blocks signature rather than the array: a token appending to the live
   * block changes neither, so this does not re-run per chunk.
   */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    // History rows are collected apart from the live ones: the replayed
    // source-control cards are merged into THEM (by turn), and the live
    // turn carries its own `scm_result` block already.
    const historyOut: Row[] = [];
    const history = messages.data ?? [];
    const liveTurnId = view.serverTurnId;
    const turnUserMessage = view.turnUserMessage?.trim();

    for (const message of history) {
      if (liveTurnId && message.metadata?.turnId === liveTurnId) continue;
      if (
        !liveTurnId &&
        turnUserMessage &&
        message.role === 'user' &&
        message.content.trim() === turnUserMessage
      ) {
        continue;
      }
      if (message.role === 'user') {
        historyOut.push({ kind: 'user', id: message.id, message });
        continue;
      }
      const turnId = message.metadata?.turnId;
      for (const row of rowsOf(message)) {
        historyOut.push({ kind: 'row', id: row.id, row, ...(turnId ? { turnId } : {}) });
      }
    }

    const live = useStreamStore.getState().streams[streamKey];
    // A turn that settled while the screen was open is already a block in
    // the live stream; the replayed copy of it would be a duplicate card.
    for (const row of mergeScmRows(
      historyOut,
      (row) => (row.kind === 'row' ? row.turnId : undefined),
      scmResults.data,
      (turnId, result): Row => {
        const id = replayedScmRowId(turnId);
        return {
          kind: 'row',
          id,
          row: { kind: 'scm_result', id, block: replayedScmBlock(turnId, result, chatId!) },
          turnId,
        };
      },
      liveScmTurnIds(live?.blocks),
    )) {
      out.push(row);
    }

    if (view.pendingUserMessage) {
      const id = `pending-${view.turnId}`;
      out.push({
        kind: 'user',
        id,
        message: { id, chatId: chatId!, role: 'user', content: view.pendingUserMessage, timestamp: Date.now() },
      });
    }

    const liveRows = deriveTimeline(live?.blocks, {
      active: view.isLive,
      idPrefix: 'live:',
      hooks: view.hooks,
      usage: view.usage,
      stopped: view.cancelRequested && !view.isLive,
    });
    for (const row of liveRows) out.push({ kind: 'row', id: row.id, row });

    // A turn spends its first seconds with nothing to render; without a row
    // here the transcript looked frozen and people sent again.
    if (activityLabel) {
      out.push({ kind: 'activity', id: `a-${view.turnId}`, label: activityLabel });
    }
    return out;
    // `view.signature` is the dependency that stands in for the blocks array.
  }, [
    messages.data,
    scmResults.data,
    chatId,
    streamKey,
    activityLabel,
    view.signature,
    view.isLive,
    view.hooks,
    view.usage,
    view.cancelRequested,
    view.pendingUserMessage,
    view.turnId,
    view.serverTurnId,
    view.turnUserMessage,
  ]);

  // ── Row actions ──────────────────────────────────────────────
  const openImage = useCallback(
    async (image: ScreenshotRef) => {
      if (!workspaceId) return;
      try {
        const response = await auth.fetch(browserArtifactPath(workspaceId, image.relativePath));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const ext = image.label.split('.').pop()?.toLowerCase() ?? 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
        setLightbox({ src: `data:${mime};base64,${bytesToBase64(new Uint8Array(buffer))}`, alt: image.label });
      } catch {
        toast({ message: 'Could not load that screenshot.', tone: 'error' });
      }
    },
    [auth, workspaceId, toast],
  );

  const readAloud = useCallback(
    (text: string) => {
      void tts.speak(text).then((err) => {
        if (err) toast({ message: err, tone: 'error' });
      });
    },
    [tts, toast],
  );

  const openInChanges = useCallback((path: string) => {
    setFocusedFile(path);
    setPane('changes');
  }, []);

  const timelineActions = useMemo<TimelineActions>(
    () => ({
      workspaceId,
      chatId,
      streamKey,
      previousUsage: usageRef.current.previous,
      openInChanges: workspaceId ? openInChanges : undefined,
      openConsole: (callId) => setConsoleCallId(callId),
      openImage: workspaceId ? (image) => void openImage(image) : undefined,
      readAloud: voice.available ? readAloud : undefined,
      toast: (message) => toast({ message, tone: 'info' }),
      // A row only names the turn that was tapped; the screen owns the
      // sheet, the mutation and the composer.
      onRewind: (turnId, prompt) => setRewindTarget({ turnId, prompt }),
      onForkFrom: (turnId) => void runFork(turnId),
      onCopyTranscript: () => void runCopyTranscript(),
    }),
    // `usageRef.current.previous` only moves when `view.usage` does.
    [
      workspaceId,
      chatId,
      streamKey,
      view.usage,
      openInChanges,
      openImage,
      readAloud,
      voice.available,
      toast,
      runFork,
      runCopyTranscript,
    ],
  );

  // Every block in the chat — for the Agent Console, built only while open.
  const consoleBlocks = useMemo<StreamBlock[]>(() => {
    if (consoleCallId === null) return [];
    const out: StreamBlock[] = [];
    for (const message of messages.data ?? []) {
      if (message.role === 'assistant') out.push(...blocksOf(message));
    }
    out.push(...(useStreamStore.getState().streams[streamKey]?.blocks ?? []));
    return out;
  }, [consoleCallId, messages.data, streamKey, view.signature]);

  // ── Gates ────────────────────────────────────────────────────
  //
  // The stream is the primary source: a gate that opened while this screen
  // was mounted is in the store as a block. A gate that was ALREADY pending
  // on mount — cold load, the Home decision card, a push deep link — never
  // produced a live event here, so it is seeded from the server's
  // interaction list (invalidated by `useChatStream` on interaction events)
  // and rebuilt into the same block shape the cards expect.
  const interactions = useQuery({
    queryKey: queryKeys.chatInteractions(chatId!),
    queryFn: () => api.chats.interactions(chatId!),
  });
  const seededGate = useMemo(() => pendingGateFrom(interactions.data), [interactions.data]);

  const gateBlock = view.gateBlock;
  const blockingPermission =
    gateBlock?.type === 'permission'
      ? gateBlock
      : !gateBlock && seededGate?.kind === 'permission'
        ? seededGate.block
        : null;
  const blockingQuestion =
    gateBlock?.type === 'question'
      ? gateBlock
      : !gateBlock && seededGate?.kind === 'question'
        ? seededGate.block
        : null;
  // Plans come from their own query; until it has loaded, a pending
  // `plan_review` row stands in so the card is not missing for a beat.
  const blockingPlan =
    plans.data?.find((p) => p.status === 'awaiting_review') ??
    (plans.data === undefined && seededGate?.kind === 'plan' ? seededGate.plan : undefined);
  const blocked = Boolean(blockingPermission || blockingPlan || blockingQuestion);

  // ── Composer ─────────────────────────────────────────────────
  // `/browser`, `/terminal`, `/changes` switch the pane; `/files`, `/plan`,
  // `/tasks` open the More sheet. Same table the v1 slash menu used.
  const onOpenPane = useCallback((section: ComposerPane) => {
    const target = routeSection(section);
    if (!target) return;
    if ('pane' in target) setPane(target.pane);
    else setMore(target.more);
  }, []);

  const composer = useComposerController({
    chatId: chatId!,
    scopes,
    workspaceId,
    projectId,
    onSend: sendPrompt,
    // Only the archive disables the CONTROLLER: an open gate disables the
    // Send button (below) but must leave `composer.send()` callable, or
    // "Cancel and send" would have nothing to call once the gate is gone.
    disabled: archived,
    onOpenPane,
    messages: messages.data,
  });
  // Written during render on purpose: the stream's rewind callback is
  // declared above the controller and must see the CURRENT one, not the one
  // that existed when an effect last ran.
  composerRef.current = composer;

  /**
   * "Cancel and send" — resolve whatever is holding the turn, then send the
   * draft. A permission prompt is denied (the honest answer to "I want to say
   * something else instead"); a question or a plan review is dropped by
   * cancelling the turn, as web does. The send is then a normal send: if the
   * server still reports the gate open, the controller hands the draft back
   * and `sendPrompt` toasts the reason.
   */
  const [gateBusy, setGateBusy] = useState(false);
  const cancelGateAndSend = useCallback(async () => {
    if (gateBusy) return;
    setGateBusy(true);
    try {
      if (blockingPermission) {
        await resolvePermission.mutateAsync({
          interactionId: blockingPermission.interactionId,
          behavior: 'deny',
          message: 'Cancelled by the user to send a new message.',
        });
      } else {
        await cancel.mutateAsync({ force: false, budgetSeconds: 0 });
        void queryClient.invalidateQueries({ queryKey: queryKeys.chatPlans(chatId!) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.chatInteractions(chatId!) });
      }
      await composer.send();
    } catch {
      /* the mutation's own onError or sendPrompt has already toasted */
    } finally {
      setGateBusy(false);
    }
  }, [gateBusy, blockingPermission, resolvePermission, cancel, queryClient, chatId, composer]);

  const gate = useMemo(
    () =>
      blocked && !archived
        ? {
            label: blockingPermission
              ? 'Waiting for your permission decision'
              : blockingQuestion
                ? 'The agent asked a question'
                : 'A plan is waiting for your review',
            busy: gateBusy,
            onCancelAndSend: () => void cancelGateAndSend(),
          }
        : null,
    [blocked, archived, blockingPermission, blockingQuestion, gateBusy, cancelGateAndSend],
  );

  // The chat DTO's bound agent and mount readiness, when the server sends them.
  const chatExtras = chat.data as
    | {
        agentRef?: string;
        agentSnapshot?: { driving?: { ref: string; name: string; role?: 'agent' | 'orchestrator' } | null };
        workspacePrep?: WorkspacePrepState;
      }
    | undefined;
  const boundAgent = useMemo<BoundAgentProps | null>(() => {
    const driving = chatExtras?.agentSnapshot?.driving;
    if (driving) return { name: driving.name, ref: driving.ref, ...(driving.role ? { role: driving.role } : {}) };
    if (chatExtras?.agentRef) return { name: chatExtras.agentRef.split(':').pop() ?? chatExtras.agentRef, ref: chatExtras.agentRef };
    return null;
  }, [chatExtras?.agentSnapshot?.driving, chatExtras?.agentRef]);
  const workspacePrep = useMemo(
    () =>
      chatExtras?.workspacePrep && chatExtras.workspacePrep.status !== 'ready'
        ? {
            ...chatExtras.workspacePrep,
            onRetry: () => prepareWorkspace.mutate(),
            retrying: prepareWorkspace.isPending,
          }
        : null,
    [chatExtras?.workspacePrep, prepareWorkspace],
  );

  const openPlan = useCallback(
    (planId: string) => {
      router.push({ pathname: '/chats/[id]/plan/[planId]', params: { id: chatId!, planId } });
    },
    [chatId],
  );

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'user') return <UserMessageRow message={item.message} />;
      if (item.kind === 'row') return <TimelineRowView row={item.row} turnId={item.turnId} />;
      return (
        <ActivityRow
          label={item.label}
          speaking={liveSpeaking}
          {...(voice.available ? { onSpeakLive: onSpeakLive } : {})}
        />
      );
    },
    [liveSpeaking, onSpeakLive, voice.available],
  );

  const hasMore = (messages.data?.length ?? 0) >= limit;

  // ── The chat page ────────────────────────────────────────────
  const renderChat = useCallback(
    (): React.ReactNode => (
      <KeyboardSticky mode="padding" className="flex-1">
        {forkedFromChatId ? (
          <Touchable
            testID="fork-provenance"
            accessibilityLabel={`${forkedFromLabel(parentChat.data?.name)}. Open the original chat`}
            haptic="tap"
            scale="none"
            ripple={false}
            onPress={() => router.push({ pathname: '/chats/[id]', params: { id: forkedFromChatId } })}
            className="flex-row items-center gap-1.5 bg-subtle px-4 py-1.5"
          >
            <GitFork size={12} color={colors['muted-foreground']} />
            <Text numberOfLines={1} className="flex-1 text-xs text-muted-foreground">
              {forkedFromLabel(parentChat.data?.name)}
            </Text>
          </Touchable>
        ) : null}

        {archived ? (
          <View accessibilityLiveRegion="polite" className="flex-row items-center gap-2 bg-subtle px-4 py-2">
            <Archive size={14} color={colors['muted-foreground']} />
            <Text className="flex-1 text-xs font-medium text-muted-foreground">
              This chat is archived. Unarchive it from the chat list to continue.
            </Text>
          </View>
        ) : null}

        {rows.length === 0 ? (
          <View className="flex-1 justify-center">
            <EmptyState
              title="Start the conversation"
              message="Ask a question, or type / to open changes, files or the terminal."
            />
          </View>
        ) : (
          <View className="flex-1">
            <LegendList
              ref={listRef}
              data={rows}
              keyExtractor={(row) => row.id}
              renderItem={renderRow}
              // Chat semantics without inverting the list.
              alignItemsAtEnd
              maintainScrollAtEnd
              maintainVisibleContentPosition
              recycleItems={false}
              {...(Platform.OS === 'web'
                ? {}
                : {
                    keyboardDismissMode: 'interactive' as const,
                    keyboardShouldPersistTaps: 'handled' as const,
                  })}
              onScroll={(event) => {
                const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                const distance = contentSize.height - contentOffset.y - layoutMeasurement.height;
                setAtBottom(distance < 120);
              }}
              scrollEventThrottle={32}
              ListHeaderComponent={
                hasMore ? (
                  <View className="items-center pb-3">
                    <Button
                      label={messages.isFetching ? 'Loading…' : 'Load earlier messages'}
                      variant="secondary"
                      size="sm"
                      loading={messages.isFetching}
                      onPress={() => setLimit((n) => n + PAGE_SIZE)}
                    />
                  </View>
                ) : null
              }
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, gap: 12 }}
            />

            {!atBottom ? (
              <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} className="absolute bottom-3 self-center">
                <Touchable
                  accessibilityLabel="Jump to latest"
                  haptic="tap"
                  onPress={() => {
                    listRef.current?.scrollToEnd({ animated: true });
                    setAtBottom(true);
                  }}
                  className="flex-row items-center gap-1.5 rounded-full border border-border bg-overlay px-3 py-2"
                >
                  <ArrowDown size={14} color={colors.foreground} />
                  <Text className="text-xs font-medium text-foreground">Latest</Text>
                </Touchable>
              </Animated.View>
            ) : null}
          </View>
        )}

        <View style={{ paddingBottom: keyboardShown ? 0 : insets.bottom }}>
          <ChangesTray
            summary={changes.data}
            onReview={() => setPane('changes')}
            onOpenFile={openInChanges}
          />

          {blockingPermission ? (
            <PermissionCard
              block={blockingPermission}
              onDecide={async (behavior, message) => {
                await resolvePermission.mutateAsync({
                  interactionId: blockingPermission.interactionId,
                  behavior,
                  ...(message ? { message } : {}),
                });
              }}
            />
          ) : blockingQuestion ? (
            <QuestionCard
              block={blockingQuestion}
              onSubmit={async (answers, freeform) => {
                await answerQuestion.mutateAsync({
                  interactionId: blockingQuestion.interactionId,
                  answers,
                  ...(freeform ? { freeformResponse: freeform } : {}),
                });
              }}
            />
          ) : blockingPlan ? (
            <PlanCard
              plan={blockingPlan}
              busy={decidePlan.isPending}
              onOpenPlan={() => openPlan(blockingPlan.planId)}
              onDecide={async (action, feedback) => {
                await decidePlan.mutateAsync({
                  planId: blockingPlan.planId,
                  action,
                  ...(feedback ? { feedback } : {}),
                });
              }}
            />
          ) : null}

          <Composer
            {...composer.props}
            onStop={stop.press}
            stopState={stop}
            isStreaming={isStreaming}
            // The server rejects a prompt with 409 while a gate is open, and
            // an archived chat does not accept turns at all. With `gate` set
            // the field stays editable so "Cancel and send" has a draft.
            disabled={blocked || archived}
            disabledReason={archived ? 'This chat is archived.' : blocked ? 'Answer above to continue.' : undefined}
            gate={gate}
            boundAgent={boundAgent}
            workspacePrep={workspacePrep}
            models={models.data}
            modelsLoading={models.isLoading}
            onRefreshModels={() => void models.refetch()}
            selectedModelId={chat.data?.model ?? null}
            onSelectModel={(id) => patchChat.mutate({ model: id })}
            mode={mode}
            onModeChange={(next) => patchChat.mutate({ defaultAgentMode: next })}
            effort={effort}
            onEffortChange={(next) => patchHarness({ reasoningEffort: next })}
            contextTier={contextTier}
            onContextTierChange={(next) => patchHarness({ contextTier: next })}
            permissionMode={chat.data?.permissionMode ?? 'default'}
            onPermissionModeChange={(next) => patchChat.mutate({ permissionMode: next })}
            contextTokens={view.contextTokens}
            codebaseCount={codebaseCount}
          />
        </View>
      </KeyboardSticky>
    ),
    // Everything the page reads. Re-created on every screen render anyway
    // (the pager calls it per render); the memo only keeps the reference
    // stable across renders that change none of these. `composer.props` is
    // a fresh object per controller render, which is the intent: the field
    // must re-render on every keystroke.
    [
      archived, rows, renderRow, hasMore, messages.isFetching, atBottom, keyboardShown, insets.bottom,
      forkedFromChatId, parentChat.data?.name,
      changes.data, openInChanges, blockingPermission, blockingQuestion, blockingPlan, decidePlan.isPending,
      openPlan, composer.props, gate, boundAgent, workspacePrep, stop,
      isStreaming, blocked, models.data, models.isLoading, chat.data, mode, effort, contextTier,
      view.contextTokens, codebaseCount, colors,
    ],
  );

  if (messages.isLoading) return <LoadingState label="Loading conversation…" />;

  if (messages.isError) {
    return (
      <ErrorState
        title="Could not load this chat"
        message="The transcript did not come back. Your messages are safe on the server."
        onRetry={() => void messages.refetch()}
      />
    );
  }

  return (
    <TimelineActionsContext.Provider value={timelineActions}>
      <View className="flex-1">
        <SessionPanes
          workspaceId={workspaceId}
          scopes={scopes}
          changesCount={changes.data?.stats.files ?? 0}
          pane={pane}
          onPaneChange={setPane}
          focusedFile={focusedFile}
          onOpenMore={() => setMore('files')}
          renderChat={renderChat}
        />

        <MoreSheet
          visible={more !== null}
          onClose={() => setMore(null)}
          section={more ?? 'files'}
          onSectionChange={setMore}
          chatId={chatId!}
          workspaceId={workspaceId}
          chat={chat.data}
          usage={view.usage}
          contextTokens={view.contextTokens}
          transportLabel={`${transport.label} · ${transport.detail}`}
          streamKey={streamKey}
        />

        <Sheet
          visible={consoleCallId !== null}
          onClose={() => setConsoleCallId(null)}
          title="Agent console"
          detents={[0.6, 0.92]}
          initialDetent={1}
          scrollable={false}
        >
          <View className="flex-1">
            {consoleCallId !== null ? (
              <AgentConsole
                blocks={consoleBlocks}
                selectedId={consoleCallId}
                {...(workspaceId ? { workspaceId } : {})}
              />
            ) : null}
          </View>
        </Sheet>

        <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />

        <RewindSheet
          visible={rewindTarget !== null}
          onClose={() => setRewindTarget(null)}
          onChoose={(scope) => void runRewind(scope)}
          busy={rewind.isPending}
          preview={rewindTarget?.prompt ?? null}
          availability={{
            streaming: isStreaming,
            archived,
            missingTurn: rewindTarget === null,
          }}
        />

        <RenameSheet
          visible={renameOpen}
          title="Rename chat"
          initialValue={chat.data?.name ?? ''}
          busy={patchChat.isPending}
          onClose={() => setRenameOpen(false)}
          onSubmit={(name) => {
            setRenameOpen(false);
            patchChat.mutate({ name } as ChatPatch);
          }}
        />

        <ActionSheet
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          title={title}
          actions={[
            {
              label: 'Rename',
              icon: <Pencil size={18} color={colors.foreground} />,
              onPress: () => setRenameOpen(true),
            },
            {
              label: 'Share transcript',
              icon: <Share2 size={18} color={colors.foreground} />,
              disabled: (messages.data?.length ?? 0) === 0,
              onPress: () => {
                const message = transcriptText(messages.data ?? [], title);
                // react-native-web's `Share` rejects on every browser without
                // the Web Share API; say so rather than surface a rejection.
                if (Platform.OS === 'web' && typeof navigator?.share !== 'function') {
                  toast({ message: 'Sharing is not available in the browser preview.', tone: 'info' });
                  return;
                }
                void Share.share({ message }).catch(() => {
                  toast({ message: 'Could not open the share sheet.', tone: 'error' });
                });
              },
            },
            {
              label: 'Copy transcript',
              detail: 'The whole chat, as markdown.',
              testID: 'copy-transcript',
              icon: <Copy size={18} color={colors.foreground} />,
              disabled: (messages.data?.length ?? 0) === 0,
              onPress: () => void runCopyTranscript(),
            },
            {
              label: 'Fork chat',
              // No turn id: the server forks from the LAST turn, which is
              // what "fork this chat" means from a chat-level menu.
              detail: 'A new chat that shares these files and this history.',
              testID: 'fork-chat',
              icon: <GitFork size={18} color={colors.foreground} />,
              disabled: fork.isPending || archived || (messages.data?.length ?? 0) === 0,
              onPress: () => void runFork(),
            },
            {
              // Not destructive: red is for Delete. Archiving is a filing
              // action and it is undone from this very menu.
              label: archived ? 'Move to active' : 'Archive',
              icon: archived ? (
                <ArchiveRestore size={18} color={colors.foreground} />
              ) : (
                <Archive size={18} color={colors.foreground} />
              ),
              disabled: archive.isPending,
              onPress: () => archive.mutate(archived ? 'active' : 'archived'),
            },
          ]}
        />
      </View>
    </TimelineActionsContext.Provider>
  );
}

/**
 * The live-turn row: "the agent is doing something" between the prompt and
 * the first token, plus the per-turn "speak this reply as it is written"
 * control — the one row that exists exactly for the duration of a turn.
 */
function ActivityRow({
  label,
  speaking,
  onSpeakLive,
}: {
  label: string;
  speaking: boolean;
  onSpeakLive?: (() => void) | undefined;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(120)}
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
      className="flex-row items-center gap-2.5 py-0.5"
    >
      <Spinner />
      <Text className="text-sm text-muted-foreground">{label}</Text>
      {onSpeakLive ? (
        <IconButton
          accessibilityLabel={speaking ? 'Stop speaking' : 'Speak this reply aloud as it is written'}
          variant="ghost"
          selected={speaking}
          icon={
            speaking ? (
              <Square size={14} color={colors.destructive} />
            ) : (
              <Volume2 size={16} color={colors['muted-foreground']} />
            )
          }
          onPress={onSpeakLive}
        />
      ) : null}
    </Animated.View>
  );
}
