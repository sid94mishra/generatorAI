// ────────────────────────────────────────────────────────────────
// Chat screen — the core loop.
//
// Layout, bottom to top:
//   composer        always reachable above the keyboard
//   decision cards  plan / question, PINNED so they cannot scroll away
//   transcript      history + live blocks, tail-aligned
//   Workbench       a detented sheet over all of it — the mobile right pane
//
// The transcript is a LegendList with `alignItemsAtEnd` + `maintainScrollAtEnd`,
// NOT an inverted FlatList: inversion breaks keyboard avoidance and layout
// animations, and is the usual reason mobile chat UIs feel wrong.
//
// Decision cards being pinned rather than inline is the one place mobile
// deliberately diverges from web. On a desktop the transcript and the card
// are both visible; on a phone a long tool run pushes an inline card off
// screen, and a decision the user cannot see is a turn that silently stalls.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaretInsertionSequencer } from '@generatorai/shared';
import { KeyboardAvoidingView, Platform, Share, Text, View } from 'react-native';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { ArrowDown, Copy, PanelRightOpen, Share2, Square, Volume2 } from 'lucide-react-native';
import {
  messageToolCalls,
  queryKeys,
  type AgentMode,
  type ChatMessage,
  type StreamBlock,
} from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { useModels } from '../../src/api/useModels';
import { useChatStream } from '../../src/stream/useChatStream';
import { useTwoPhaseStop } from '../../src/stream/useTwoPhaseStop';
import { useStreamStore } from '../../src/stream/streamStore';
import { useAuth } from '../../src/auth/AuthProvider';
import { checkFeature } from '../../src/auth/featureGate';
import { useVoiceInput } from '../../src/voice/useVoiceInput';
import { useTextToSpeech } from '../../src/voice/useTextToSpeech';
import { BlockView, ToolRow } from '../../src/components/chat/BlockView';
import { Composer } from '../../src/components/chat/Composer';
import { PlanCard } from '../../src/components/chat/PlanCard';
import { toPlanDecision } from '../../src/components/chat/gateActions';
import { QuestionCard } from '../../src/components/chat/QuestionCard';
import { UsageFooter } from '../../src/components/chat/UsageFooter';
import { Workbench, type WorkbenchSection } from '../../src/components/chat/Workbench';
import { Markdown } from '../../src/components/markdown/Markdown';
import { Button, IconButton } from '../../src/components/ui/Button';
import { ActionSheet } from '../../src/components/ui/ActionSheet';
import { useToast } from '../../src/components/ui/Toast';
import { EmptyState, ErrorState, LoadingState, Spinner } from '../../src/components/ui/States';
import { Touchable } from '../../src/components/ui/Touchable';
import { announce } from '../../src/components/ui/accessibility';
import { haptics } from '../../src/components/ui/haptics';
import type { SseStatus } from '../../src/stream/useChatStream';
import { useTheme } from '../../src/theme/ThemeProvider';

/** A transcript row: a persisted message, a live block, the usage chip, or
 *  the "agent is working" indicator that fills the gap before the first token. */
type Row =
  | { kind: 'message'; id: string; message: ChatMessage }
  | { kind: 'block'; id: string; block: StreamBlock }
  | { kind: 'usage'; id: string }
  | { kind: 'activity'; id: string; label: string };

/** How many messages are fetched at a time. */
const PAGE_SIZE = 120;

export default function ChatScreen(): React.ReactElement {
  const { id: chatId } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { state } = useAuth();
  const toast = useToast();
  // The offset the keyboard has to clear is the distance from the top of the
  // window to the top of this screen — i.e. the header. It is MEASURED, not
  // assumed: a hardcoded 44 is wrong on Android (56dp), wrong in landscape
  // (32pt), and wrong at every reading size above the default, each of which
  // leaves the composer either floating above the keyboard or partly under it.
  const [headerHeight, setHeaderHeight] = useState(0);
  const rootRef = useRef<View | null>(null);
  const onRootLayout = useCallback(() => {
    rootRef.current?.measureInWindow((_x, y) => {
      if (Number.isFinite(y)) setHeaderHeight(y);
    });
  }, []);
  const listRef = useRef<LegendListRef | null>(null);

  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<AgentMode>('auto');
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [workbench, setWorkbench] = useState<WorkbenchSection | null>(null);
  const [connection, setConnection] = useState<SseStatus>({ state: 'idle' });
  const [atBottom, setAtBottom] = useState(true);
  const [messageMenu, setMessageMenu] = useState<ChatMessage | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  useChatStream({ chatId: chatId!, onStatusChange: setConnection });

  const models = useModels();
  const scopes = state.status === 'authenticated' ? state.scopes : [];
  const voice = checkFeature('voice', scopes);
  const upload = checkFeature('fileUpload', scopes);
  // ── Voice input (live dictation — VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md
  // Part C, now at parity with the web composer) ──
  //
  //   1. Finalized segments are inserted AT THE CARET, not appended, so
  //      resuming after a correction continues from wherever the user is.
  //   2. Interim text never enters `draft` — it is rendered as a separate
  //      dimmed line, which is what removes the edit-vs-speech collision
  //      class entirely (Part C.2).
  //   3. Any manual interaction with the field auto-pauses dictation
  //      (Part C.3).
  const [voiceInterim, setVoiceInterim] = useState('');
  const [caret, setCaret] = useState(0);
  const [pendingSelection, setPendingSelection] = useState<number | null>(null);
  // Two segments arriving back-to-back must compose in speech order even
  // though the caret we read is one render behind — see the shared
  // sequencer's doc comment for the exact reversal it prevents.
  const caretSequencerRef = useRef(new CaretInsertionSequencer());

  const insertAtCaret = useCallback((raw: string) => {
    setDraft((prev) => {
      const result = caretSequencerRef.current.insert(prev, caret, caret, raw);
      if (!result) return prev;
      setPendingSelection(result.caret);
      setCaret(result.caret);
      return result.text;
    });
  }, [caret]);

  const voiceInput = useVoiceInput({
    onInterim: setVoiceInterim,
    onSegment: (text) => {
      setVoiceInterim('');
      insertAtCaret(text);
    },
    onFinal: (text) => {
      setVoiceInterim('');
      if (text) insertAtCaret(text);
    },
  });
  const tts = useTextToSpeech();

  /**
   * Part C.3 — the act of touching the composer IS the pause signal. Also
   * drops any pending programmatic caret position, so a segment that lands
   * moments later (network latency after the pause frame) inserts where the
   * user now is rather than yanking them back.
   */
  const pauseVoiceIfListening = useCallback(() => {
    caretSequencerRef.current.clearPending();
    if (voiceInput.status === 'listening') voiceInput.pause();
  }, [voiceInput]);

  const chat = useQuery({
    queryKey: queryKeys.chat(chatId!),
    queryFn: () => api.chats.get(chatId!),
  });

  const messages = useQuery({
    queryKey: [...queryKeys.chatMessages(chatId!), limit],
    queryFn: () => api.chats.messages(chatId!, { limit }),
  });

  const plans = useQuery({
    queryKey: queryKeys.chatPlans(chatId!),
    queryFn: () => api.chats.plans(chatId!),
  });

  const workspaceId = chat.data?.workspaceId ?? null;

  // The composer's codebase chip was hardcoded to zero, so a project-backed
  // chat always claimed "No codebase linked".
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

  // Only loaded once the user actually reaches for an @-mention — a cold tree
  // read walks the whole repo and is not worth doing on chat open.
  const [mentionsWanted, setMentionsWanted] = useState(false);
  const tree = useQuery({
    queryKey: queryKeys.workspaceTree(workspaceId ?? ''),
    queryFn: () => api.workspaces.tree(workspaceId!),
    enabled: mentionsWanted && Boolean(workspaceId),
    staleTime: 60_000,
  });
  const mentionPaths = useMemo(
    () => tree.data?.repos.flatMap((repo) => repo.paths) ?? [],
    [tree.data],
  );

  // The stream is keyed by session id; a chat that has never run has none.
  const streamKey = chat.data?.sessionId ?? chatId!;
  const stream = useStreamStore((s) => s.streams[streamKey]);

  /**
   * Phase 4 — speak the live turn as it is generated. Subscribes to this
   * chat SESSION's token stream (`streamKey` is the chat's sessionId, which
   * is the EventBus channel), not its chat id.
   */
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

  const applyEffects = useStreamStore((s) => s.applyEffects);
  const isStreaming =
    stream?.status === 'streaming' || stream?.status === 'thinking' || stream?.status === 'pending';

  /**
   * What the agent is doing right now, or null when the transcript already
   * shows it. Mirrors the phases web names in its stream panel.
   */
  /**
   * W30-b — two-phase Stop, on the same shared machine web uses.
   *
   * `isLive` is `isStreaming`, which is derived entirely from the event
   * stream — so the BACKEND decides whether a second press is offered, not a
   * local "already pressed" flag. A turn the server settled stands the control
   * down even if the cancel request itself never came back.
   */
  const stop = useTwoPhaseStop({
    isLive: isStreaming,
    onCancel: () => cancel.mutate(),
  });

  const activityLabel = useMemo<string | null>(() => {
    if (!isStreaming) return null;
    const last = stream?.blocks[stream.blocks.length - 1];
    if (stream?.status === 'pending') return 'Working…';
    // A live thinking block or a running tool already renders its own
    // spinner; a second one below it would just be noise.
    if (last?.type === 'thinking' && !last.isComplete) return null;
    if (last?.type === 'tool_call' && last.status === 'running') return null;
    if (stream?.status === 'thinking') return 'Thinking…';
    // W30-d — mobile declares `highLatencyBlockDelivery`, so prose is held
    // back to the last markdown block boundary rather than edited into the
    // message per chunk. `typing` is exactly the interval during which text
    // exists but is deliberately not on screen, and it is the reason this
    // surface needs an indicator where web does not: without one, a paragraph
    // being written looks like nothing happening.
    if (stream?.typing) return 'Writing…';
    return last?.type === 'text' ? null : 'Responding…';
  }, [isStreaming, stream?.status, stream?.blocks, stream?.typing]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: chat.data?.name ?? 'Chat',
      headerRight: () => (
        <IconButton
          accessibilityLabel="Open workbench"
          icon={<PanelRightOpen size={20} color={colors.foreground} />}
          onPress={() => setWorkbench('changes')}
        />
      ),
    });
  }, [navigation, chat.data?.name, colors.foreground]);

  const send = useMutation({
    mutationFn: (text: string) => api.chats.send(chatId!, { message: text, mode }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatMessages(chatId!) });
    },
    onError: (_error, text) => {
      // The draft was cleared optimistically so the composer empties the
      // instant the user commits. A failure has to hand the text back, or a
      // long prompt is simply gone.
      setDraft((current) => (current.length > 0 ? current : text));
      haptics.error();
      toast({ message: 'Could not send that. Your text has been restored.', tone: 'error' });
    },
  });

  /**
   * Patch the chat.
   *
   * There is no per-turn model override on the server, so the composer edits
   * the chat itself — same for permission mode, reasoning effort and the
   * context tier, which live under `harnessConfig`. Invalidating the chat
   * query keeps the chips in step with what the next turn will actually use.
   */
  const patchChat = useMutation({
    mutationFn: (patch: Parameters<typeof api.chats.update>[1]) => api.chats.update(chatId!, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId!) });
    },
    onError: () => toast({ message: 'That setting did not stick. Try again.', tone: 'error' }),
  });

  // `harnessConfig` is the server's home for both of these. They used to be
  // local state that was never sent anywhere, so changing the reasoning
  // effort updated a chip and nothing else.
  const harnessConfig = (chat.data as { harnessConfig?: Record<string, unknown> } | undefined)
    ?.harnessConfig;
  const effort = (harnessConfig?.['reasoningEffort'] as string | undefined) ?? null;
  const contextTier =
    (harnessConfig?.['contextTier'] as 'default' | 'long_context' | undefined) ?? 'default';

  const patchHarness = useCallback(
    (patch: Record<string, unknown>) => {
      patchChat.mutate({ harnessConfig: { ...(harnessConfig ?? {}), ...patch } } as Parameters<
        typeof api.chats.update
      >[1]);
    },
    [patchChat, harnessConfig],
  );

  const cancel = useMutation({ mutationFn: () => api.chats.cancel(chatId!) });

  const decidePlan = useMutation({
    mutationFn: ({ planId, action }: { planId: string; action: string }) =>
      api.chats.decidePlan(chatId!, planId, toPlanDecision(action)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatPlans(chatId!) });
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

  /**
   * Merge history with live blocks.
   *
   * De-duplication is by SERVER TURN ID, not by content. The live turn is
   * already fully represented as blocks, so once its messages land in history
   * they would render a second time. Matching `metadata.turnId` is O(1) and
   * collision-free; the previous content comparison only caught the user
   * message and let the assistant's text duplicate.
   */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const history = messages.data ?? [];
    const liveTurnId = stream?.serverTurnId ?? null;
    const turnUserMessage = stream?.turnUserMessage?.trim();

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
      out.push({ kind: 'message', id: message.id, message });
    }

    if (stream?.pendingUserMessage) {
      out.push({
        kind: 'message',
        id: `pending-${stream.turnId}`,
        message: {
          id: `pending-${stream.turnId}`,
          chatId: chatId!,
          role: 'user',
          content: stream.pendingUserMessage,
          timestamp: Date.now(),
        },
      });
    }

    for (const block of stream?.blocks ?? []) {
      out.push({ kind: 'block', id: `b-${block.blockId}`, block });
    }

    // A turn spends its first seconds with nothing to render: the prompt is
    // sent, no token has arrived, and every block list is empty. Without a
    // row here the transcript looked frozen and people sent again.
    if (activityLabel) {
      out.push({ kind: 'activity', id: `a-${stream?.turnId ?? 0}`, label: activityLabel });
    }

    if (stream?.usage) out.push({ kind: 'usage', id: `u-${stream.turnId}` });

    return out;
  }, [messages.data, stream, chatId, activityLabel]);

  const onSend = useCallback(() => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    setDraft('');
    haptics.commit();
    // Optimistic, exactly as web's composer does it: the bubble and the
    // working row appear on this frame instead of after the server's first
    // `harness.user_message` lands a second or more later.
    applyEffects([{ op: 'startPending', key: streamKey, userMessage: text }]);
    send.mutate(text);
  }, [draft, send, applyEffects, streamKey]);

  /**
   * Dictation.
   *
   * Appended to the draft rather than replacing it, and never auto-sent —
   * matching the web, and because a mis-heard prompt that sends itself is a
   * turn the user has to cancel.
   */
  const onVoice = useCallback(async () => {
    if (!voiceInput.supported) {
      toast({ message: 'Dictation needs a device microphone.', tone: 'info' });
      return;
    }
    // Part C.4's state machine: paused is a real state, and the SAME control
    // resumes it — deliberately explicit rather than auto-resuming on
    // detected speech.
    if (voiceInput.status === 'paused') {
      haptics.tap();
      voiceInput.resume();
      announce('Listening');
      return;
    }
    if (voiceInput.status === 'listening' || voiceInput.status === 'connecting') {
      haptics.success();
      voiceInput.stop();
      announce('Transcribing');
      return;
    }
    haptics.tap();
    setVoiceInterim('');
    await voiceInput.start();
  }, [voiceInput, toast]);

  useEffect(() => {
    if (voiceInput.status === 'error' && voiceInput.error) {
      toast({ message: voiceInput.error, tone: 'error' });
    }
  }, [voiceInput.status, voiceInput.error, toast]);

  /** Copy / share, reached by long-pressing a message. */
  const onCopyMessage = useCallback(
    async (message: ChatMessage) => {
      await Clipboard.setStringAsync(message.content);
      toast({ message: 'Copied.', tone: 'success' });
    },
    [toast],
  );

  /**
   * Read aloud (Phase 3), reached the same way. One `useTextToSpeech()` is
   * shared by the whole screen (line above), so `tts.status` alone can't
   * tell WHICH message is playing — without `speakingMessageId`, long-
   * pressing message B while A was still speaking showed B's own sheet as
   * "Stop reading" (global status was 'speaking') and tapping it called
   * `tts.stop()` and returned, silently stopping A without ever starting B
   * (final end-to-end review finding). Tracking the id lets each message's
   * sheet ask "is THIS the one currently speaking" instead.
   */
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  useEffect(() => {
    // Playback ended (naturally or via error) on its own — `speak()`'s
    // promise only resolves once playback STARTS, not once it finishes, so
    // this is the only place that observes the natural end.
    if (tts.status === 'idle' || tts.status === 'error') {
      setSpeakingMessageId(null);
    }
  }, [tts.status]);

  const onReadAloud = useCallback(
    async (message: ChatMessage) => {
      const isThisMessagePlaying =
        speakingMessageId === message.id && (tts.status === 'speaking' || tts.status === 'synthesizing');
      if (isThisMessagePlaying) {
        tts.stop();
        setSpeakingMessageId(null);
        return;
      }
      // Barges over whatever ELSE the shared hook might be doing — same as
      // tapping "Read aloud" on a second web AssistantMessage.
      setSpeakingMessageId(message.id);
      const errorMessage = await tts.speak(message.content);
      if (errorMessage) {
        setSpeakingMessageId(null);
        toast({ message: errorMessage, tone: 'error' });
      }
    },
    [tts, toast, speakingMessageId],
  );

  const blockingPlan = plans.data?.find((p) => p.status === 'awaiting_review');
  const blockingQuestion = stream?.blocks.find(
    (b): b is Extract<StreamBlock, { type: 'question' }> =>
      b.type === 'question' && b.status === 'pending',
  );
  const blocked = Boolean(blockingPlan || blockingQuestion);

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'message')
        return <MessageRow message={item.message} onLongPress={setMessageMenu} />;
      if (item.kind === 'block') return <BlockView block={item.block} />;
      if (item.kind === 'activity') {
        return (
          <ActivityRow
            label={item.label}
            speaking={liveSpeaking}
            {...(voice.available ? { onSpeakLive: onSpeakLive } : {})}
          />
        );
      }
      return stream?.usage ? <UsageFooter usage={stream.usage} /> : null;
    },
    [stream?.usage, liveSpeaking, onSpeakLive, voice.available],
  );

  if (messages.isLoading) return <LoadingState label="Loading conversation…" />;

  // A failed transcript load used to render the "Start the conversation"
  // empty state — an error wearing the costume of a brand new chat.
  if (messages.isError) {
    return (
      <ErrorState
        title="Could not load this chat"
        message="The transcript did not come back. Your messages are safe on the server."
        onRetry={() => void messages.refetch()}
      />
    );
  }

  const hasMore = (messages.data?.length ?? 0) >= limit;
  const disconnected = connection.state === 'reconnecting' || connection.state === 'closed';

  return (
    <View ref={rootRef} onLayout={onRootLayout} collapsable={false} className="flex-1">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={headerHeight}
      >
      {disconnected ? (
        <View
          accessibilityLiveRegion="polite"
          className="flex-row items-center justify-center gap-2 bg-warning-muted px-4 py-2"
        >
          <Text className="text-xs font-medium text-warning">
            {connection.state === 'reconnecting'
              ? 'Reconnecting to the live stream…'
              : 'Live updates are paused.'}
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
            // Dragging the transcript dismisses the keyboard, tracking the
            // finger — the gesture every messaging app on both platforms has.
            // LegendList does not consume these on web and leaks them onto the
            // underlying div, so they are scoped to the platforms that use them.
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
            // Without an explicit flex the list sizes to its CONTENT, which
            // leaves the composer floating in the middle of the screen on any
            // conversation shorter than the viewport.
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 12 }}
          />

          {/* Scrolling back through a long turn used to strand the user: the
              list keeps streaming at the bottom with no way back to it. */}
          {!atBottom ? (
            <View className="absolute bottom-3 self-center">
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
            </View>
          ) : null}
        </View>
      )}

      {blockingQuestion ? (
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
          onOpenPlan={() => setWorkbench('plan')}
          onDecide={async (action) => {
            await decidePlan.mutateAsync({ planId: blockingPlan.planId, action });
          }}
        />
      ) : null}

      <Composer
        draft={draft}
        onDraftChange={(text) => {
          setDraft(text);
          // Warm the tree the moment an '@' appears rather than on chat open.
          if (!mentionsWanted && text.includes('@')) setMentionsWanted(true);
        }}
        voiceInterim={voiceInterim}
        onComposerInteraction={pauseVoiceIfListening}
        caret={caret}
        onCaretChange={setCaret}
        pendingSelection={pendingSelection}
        onPendingSelectionApplied={() => setPendingSelection(null)}
        onSend={onSend}
        onStop={stop.press}
        stopState={stop}
        isStreaming={isStreaming}
        // The server rejects a new prompt with 409 while a gate is open, so
        // the composer is disabled rather than letting the user type into a
        // request that cannot succeed.
        disabled={blocked}
        disabledReason={blocked ? 'Answer above to continue.' : undefined}
        models={models.data}
        modelsLoading={models.isLoading}
        onRefreshModels={() => void models.refetch()}
        selectedModelId={modelOverride ?? chat.data?.model ?? null}
        onSelectModel={(id) => {
          setModelOverride(id);
          patchChat.mutate({ model: id });
        }}
        mode={mode}
        onModeChange={setMode}
        effort={effort}
        onEffortChange={(next) => patchHarness({ reasoningEffort: next })}
        contextTier={contextTier}
        onContextTierChange={(next) => patchHarness({ contextTier: next })}
        permissionMode={chat.data?.permissionMode ?? 'default'}
        onPermissionModeChange={(next) => patchChat.mutate({ permissionMode: next })}
        contextTokens={stream?.contextUsage?.currentTokens ?? null}
        codebaseCount={codebaseCount}
        mentionPaths={mentionPaths}
        onOpenSection={(section) => setWorkbench(section as WorkbenchSection)}
        voiceAvailable={voice.available}
        voiceActive={voiceInput.status === 'listening' || voiceInput.status === 'paused'}
        voiceBusy={voiceInput.status === 'transcribing' || voiceInput.status === 'connecting'}
        onVoice={() => void onVoice()}
        attachAvailable={upload.available}
        attachDisabledReason={upload.available ? undefined : (upload.reason ?? undefined)}
        attachments={[]}
        onRemoveAttachment={() => {}}
      />

      <Workbench
        visible={workbench !== null}
        onClose={() => setWorkbench(null)}
        section={workbench ?? 'changes'}
        onSectionChange={setWorkbench}
        chatId={chatId!}
        workspaceId={workspaceId}
      />

      <ActionSheet
        visible={messageMenu !== null}
        onClose={() => setMessageMenu(null)}
        title={messageMenu?.role === 'user' ? 'Your message' : 'Agent message'}
        actions={
          messageMenu
            ? [
                {
                  label: 'Copy text',
                  icon: <Copy size={18} color={colors.foreground} />,
                  onPress: () => void onCopyMessage(messageMenu),
                },
                {
                  label: 'Share',
                  icon: <Share2 size={18} color={colors.foreground} />,
                  onPress: () => void Share.share({ message: messageMenu.content }),
                },
                ...(voice.available && messageMenu.content.trim()
                  ? [
                      {
                        label:
                          speakingMessageId === messageMenu.id &&
                          (tts.status === 'speaking' || tts.status === 'synthesizing')
                            ? 'Stop reading'
                            : 'Read aloud',
                        icon: <Volume2 size={18} color={colors.foreground} />,
                        onPress: () => void onReadAloud(messageMenu),
                      },
                    ]
                  : []),
              ]
            : []
        }
      />
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * "The agent is doing something" — the row that stops a turn from looking
 * dead between the prompt and the first token.
 */
/**
 * The live-turn row. Also carries the Phase 4 "speak this reply as it is
 * written" control — this is the only row on screen that exists exactly for
 * the duration of a turn, so it is where a per-turn speech toggle belongs.
 * Once the turn ends the row disappears and the finished message's own
 * "Read aloud" action (the long-press sheet) takes over.
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

const MessageRow = React.memo(function MessageRow({
  message,
  onLongPress,
}: {
  message: ChatMessage;
  onLongPress: (message: ChatMessage) => void;
}): React.ReactElement | null {
  // Long-press is the only route to copy or share on a phone, and the web
  // app has neither — this is one of the few places mobile does more.
  const hold = () => {
    if (!message.content) return;
    haptics.tap();
    onLongPress(message);
  };

  if (message.role === 'user') {
    // Right-aligned bubble, capped so a long paste does not span the screen
    // and become unreadable.
    return (
      <Touchable
        a11yRole="text"
        accessibilityLabel={`You said: ${message.content}`}
        accessibilityHint="Double tap and hold for actions"
        haptic="none"
        ripple={false}
        scale="none"
        onLongPress={hold}
        className="items-end"
      >
        <View className="max-w-[85%] rounded-3xl bg-accent px-3.5 py-2.5">
          <Text selectable className="text-md leading-relaxed text-foreground">
            {message.content}
          </Text>
        </View>
      </Touchable>
    );
  }

  if (message.role === 'assistant') {
    /*
     * Tool calls hang off the ASSISTANT message in `metadata.toolCalls` —
     * they are not separate `role: 'tool'` messages. Rendering only
     * `content` therefore showed an agent narrating work it appeared never
     * to have done: every completed turn lost its entire tool history the
     * moment the live blocks were replaced by the refetched transcript.
     *
     * They render BEFORE the text because that is the order they happened.
     */
    const calls = messageToolCalls(message);
    return (
      <View className="gap-2">
        {calls.map((call) => (
          <ToolRow
            key={call.id}
            tool={call.tool}
            args={call.args}
            result={call.result}
            running={call.status === 'running'}
          />
        ))}
        {message.content ? (
          <Touchable
            a11yRole="text"
            accessibilityLabel={message.content}
            accessibilityHint="Double tap and hold for actions"
            haptic="none"
            ripple={false}
            scale="none"
            onLongPress={hold}
          >
            <Markdown content={message.content} />
          </Touchable>
        ) : null}
      </View>
    );
  }

  // A bare `role: 'tool'` message is not what this server emits, but an older
  // one might; render it rather than dropping it silently.
  if (message.role === 'tool') {
    return message.content ? (
      <ToolRow tool="tool" args={message.content} running={false} />
    ) : null;
  }

  return <Text className="text-xs text-muted-foreground">{message.content}</Text>;
});
