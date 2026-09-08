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
import { Archive, ArrowDown, Pencil, Share2, Square, Volume2 } from 'lucide-react-native';
import {
  ApiError,
  isArchived,
  queryKeys,
  type AgentMode,
  type ChatMessage,
  type ChatSummary,
  type StreamBlock,
  type StreamUsage,
} from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { useModels } from '../../src/api/useModels';
import { useChatStream, type SseStatus } from '../../src/stream/useChatStream';
import { useTwoPhaseStop } from '../../src/stream/useTwoPhaseStop';
import { protectStream, useStreamStore } from '../../src/stream/streamStore';
import { useStreamHealth } from '../../src/stream/streamHealth';
import { useAuth } from '../../src/auth/AuthProvider';
import { checkFeature } from '../../src/auth/featureGate';
import { useTextToSpeech } from '../../src/voice/useTextToSpeech';
import { Composer, type ComposerPane } from '../../src/components/chat/Composer';
import { useComposerController } from '../../src/components/chat/composer/useComposerController';
import { readAllAttachmentBytes } from '../../src/components/chat/composer/attachmentPickers';
import type { ComposerSendPayload, WorkspacePrepState } from '../../src/components/chat/composer/types';
import type { BoundAgentProps } from '../../src/components/chat/composer/ComposerBanners';
import { bytesToBase64 } from '../../src/lib/base64';
import { PermissionCard } from '../../src/components/chat/PermissionCard';
import { PlanCard } from '../../src/components/chat/PlanCard';
import { QuestionCard } from '../../src/components/chat/QuestionCard';
import { RenameSheet } from '../../src/components/chat/RenameSheet';
import { toPlanDecision } from '../../src/components/chat/gateActions';
import { pendingGateFrom } from '../../src/components/chat/gateFromInteraction';
import { ChatHeaderMenuButton, ChatHeaderTitle } from '../../src/components/chat/ChatHeader';
import { describeSessionTransport } from '../../src/components/chat/sessionTransport';
import { TimelineRowView } from '../../src/components/chat/timeline/TimelineRow';
import { UserMessageRow } from '../../src/components/chat/timeline/UserMessageRow';
import { TimelineActionsContext, type TimelineActions } from '../../src/components/chat/timeline/TimelineActions';
import { deriveTimeline, type ScreenshotRef, type TimelineRow } from '../../src/components/chat/timeline/deriveTimeline';
import { chatMessageToBlocks, messageWasStopped } from '../../src/components/chat/timeline/chatMessageToBlocks';
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
  | { kind: 'row'; id: string; row: TimelineRow }
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

  // Keyed by the chat's session id once known (the store key the screen reads).
  useChatStream({ chatId: chatId!, sessionId: chat.data?.sessionId, onStatusChange: setConnection });

  const messages = useQuery({
    queryKey: [...queryKeys.chatMessages(chatId!), limit],
    queryFn: () => api.chats.messages(chatId!, { limit }),
  });

  const plans = useQuery({
    queryKey: queryKeys.chatPlans(chatId!),
    queryFn: () => api.chats.plans(chatId!),
  });

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

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerTitle: () => (
        <ChatHeaderTitle title={title} transport={transport} onPress={() => setRenameOpen(true)} />
      ),
      headerRight: () => <ChatHeaderMenuButton onPress={() => setMenuOpen(true)} />,
    });
    // `transport` is rebuilt every render; its label/tone are what matter.
  }, [navigation, title, transport.label, transport.tone]);

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

  const archive = useMutation({
    mutationFn: () => api.chats.archive(chatId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId!) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats() });
      toast({ message: 'Chat archived.', tone: 'success' });
    },
    onError: () => {
      haptics.error();
      toast({ message: 'Could not archive this chat.', tone: 'error' });
    },
  });

  const cancel = useMutation({
    mutationFn: (options: { force: boolean; budgetSeconds: number }) =>
      api.chats.cancel(chatId!, options),
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
        out.push({ kind: 'user', id: message.id, message });
        continue;
      }
      for (const row of rowsOf(message)) out.push({ kind: 'row', id: row.id, row });
    }

    if (view.pendingUserMessage) {
      const id = `pending-${view.turnId}`;
      out.push({
        kind: 'user',
        id,
        message: { id, chatId: chatId!, role: 'user', content: view.pendingUserMessage, timestamp: Date.now() },
      });
    }

    const live = useStreamStore.getState().streams[streamKey];
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
      streamKey,
      previousUsage: usageRef.current.previous,
      openInChanges: workspaceId ? openInChanges : undefined,
      openConsole: (callId) => setConsoleCallId(callId),
      openImage: workspaceId ? (image) => void openImage(image) : undefined,
      readAloud: voice.available ? readAloud : undefined,
      toast: (message) => toast({ message, tone: 'info' }),
    }),
    // `usageRef.current.previous` only moves when `view.usage` does.
    [workspaceId, streamKey, view.usage, openInChanges, openImage, readAloud, voice.available, toast],
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
      if (item.kind === 'row') return <TimelineRowView row={item.row} />;
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
              label: archived ? 'Archived' : 'Archive',
              icon: <Archive size={18} color={colors.danger} />,
              destructive: true,
              disabled: archived || archive.isPending,
              detail: archived ? 'Unarchive from the chat list.' : undefined,
              onPress: () => archive.mutate(),
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
