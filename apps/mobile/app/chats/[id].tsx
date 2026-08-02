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

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PanelRightOpen } from 'lucide-react-native';
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
import { useStreamStore } from '../../src/stream/streamStore';
import { useAuth } from '../../src/auth/AuthProvider';
import { checkFeature } from '../../src/auth/featureGate';
import { BlockView, ToolRow } from '../../src/components/chat/BlockView';
import { Composer } from '../../src/components/chat/Composer';
import { PlanCard } from '../../src/components/chat/PlanCard';
import { QuestionCard } from '../../src/components/chat/QuestionCard';
import { UsageFooter } from '../../src/components/chat/UsageFooter';
import { Workbench, type WorkbenchSection } from '../../src/components/chat/Workbench';
import { Markdown } from '../../src/components/markdown/Markdown';
import { IconButton } from '../../src/components/ui/Button';
import { EmptyState, LoadingState } from '../../src/components/ui/States';
import { haptics } from '../../src/components/ui/haptics';
import { useTheme } from '../../src/theme/ThemeProvider';

/** A transcript row: a persisted message, a live block, or the usage chip. */
type Row =
  | { kind: 'message'; id: string; message: ChatMessage }
  | { kind: 'block'; id: string; block: StreamBlock }
  | { kind: 'usage'; id: string };

export default function ChatScreen(): React.ReactElement {
  const { id: chatId } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { state } = useAuth();
  const insets = useSafeAreaInsets();
  const listRef = useRef<LegendListRef | null>(null);

  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<AgentMode>('auto');
  const [effort, setEffort] = useState<string | null>(null);
  const [contextTier, setContextTier] = useState<'default' | 'long_context'>('default');
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [workbench, setWorkbench] = useState<WorkbenchSection | null>(null);

  useChatStream({ chatId: chatId! });

  const models = useModels();
  const scopes = state.status === 'authenticated' ? state.scopes : [];
  const voice = checkFeature('voice', scopes);
  const upload = checkFeature('fileUpload', scopes);

  const chat = useQuery({
    queryKey: queryKeys.chat(chatId!),
    queryFn: () => api.chats.get(chatId!),
  });

  const messages = useQuery({
    queryKey: queryKeys.chatMessages(chatId!),
    queryFn: () => api.chats.messages(chatId!, { limit: 200 }),
  });

  const plans = useQuery({
    queryKey: queryKeys.chatPlans(chatId!),
    queryFn: () => api.chats.plans(chatId!),
  });

  const workspaceId = chat.data?.workspaceId ?? null;

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
  const isStreaming =
    stream?.status === 'streaming' || stream?.status === 'thinking' || stream?.status === 'pending';

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
  });

  /**
   * Patch the chat.
   *
   * There is no per-turn model override on the server, so the composer edits
   * the chat itself — same for permission mode. Invalidating the chat query
   * keeps the chips in step with what the next turn will actually use.
   */
  const patchChat = useMutation({
    mutationFn: (patch: Parameters<typeof api.chats.update>[1]) => api.chats.update(chatId!, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId!) });
    },
  });

  const cancel = useMutation({ mutationFn: () => api.chats.cancel(chatId!) });

  const decidePlan = useMutation({
    mutationFn: ({
      planId,
      action,
      interactionId,
    }: {
      planId: string;
      action: string;
      interactionId?: string;
    }) =>
      api.chats.decidePlan(chatId!, planId, {
        action,
        ...(interactionId ? { interactionId } : {}),
      }),
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

    if (stream?.usage) out.push({ kind: 'usage', id: `u-${stream.turnId}` });

    return out;
  }, [messages.data, stream, chatId]);

  const onSend = useCallback(() => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    setDraft('');
    haptics.commit();
    send.mutate(text);
  }, [draft, send]);

  const blockingPlan = plans.data?.find((p) => p.status === 'awaiting_review');
  const blockingQuestion = stream?.blocks.find(
    (b): b is Extract<StreamBlock, { type: 'question' }> =>
      b.type === 'question' && b.status === 'pending',
  );
  const blocked = Boolean(blockingPlan || blockingQuestion);

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'message') return <MessageRow message={item.message} />;
      if (item.kind === 'block') return <BlockView block={item.block} />;
      return stream?.usage ? <UsageFooter usage={stream.usage} /> : null;
    },
    [stream?.usage],
  );

  if (messages.isLoading) return <LoadingState label="Loading conversation…" />;

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 44}
    >
      {rows.length === 0 ? (
        <View className="flex-1 justify-center">
          <EmptyState
            title="Start the conversation"
            message="Ask a question, or type / to open changes, files or the terminal."
          />
        </View>
      ) : (
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
          // Without an explicit flex the list sizes to its CONTENT, which
          // leaves the composer floating in the middle of the screen on any
          // conversation shorter than the viewport.
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 12 }}
        />
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
            await decidePlan.mutateAsync({
              planId: blockingPlan.planId,
              action,
              ...(blockingPlan.interactionId ? { interactionId: blockingPlan.interactionId } : {}),
            });
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
        onSend={onSend}
        onStop={() => cancel.mutate()}
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
        onEffortChange={setEffort}
        contextTier={contextTier}
        onContextTierChange={setContextTier}
        permissionMode={chat.data?.permissionMode ?? 'default'}
        onPermissionModeChange={(next) => patchChat.mutate({ permissionMode: next })}
        contextTokens={stream?.contextUsage?.currentTokens ?? null}
        codebaseCount={0}
        mentionPaths={mentionPaths}
        onOpenSection={(section) => setWorkbench(section as WorkbenchSection)}
        voiceAvailable={voice.available}
        attachAvailable={upload.available}
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
    </KeyboardAvoidingView>
  );
}

const MessageRow = React.memo(function MessageRow({
  message,
}: {
  message: ChatMessage;
}): React.ReactElement | null {
  if (message.role === 'user') {
    // Right-aligned bubble, capped so a long paste does not span the screen
    // and become unreadable.
    return (
      <View className="items-end">
        <View className="max-w-[85%] rounded-3xl bg-accent px-3.5 py-2.5">
          <Text className="text-md leading-relaxed text-foreground">{message.content}</Text>
        </View>
      </View>
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
        {message.content ? <Markdown content={message.content} /> : null}
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
