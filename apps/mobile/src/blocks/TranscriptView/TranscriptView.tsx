// MB-07 TranscriptView (Main, MChatRunning, MChatToolsExpanded, MChatNoAgent): the chat transcript on Legend List
// with the chat contract kept from the legacy screen — `alignItemsAtEnd`, `initialScrollAtEnd`, follow the end while
// rows arrive or the live turn grows (and while the first layout settles), anchor on prepended pages ("Load earlier
// messages"), never inverted. Items: user bubbles, one item per persisted agent message (header on the first of its
// turn, the footer on the last), the live turn (it subscribes to its own blocks, so a token re-renders only it),
// the activity line. ML-26 "↓ Latest" while scrolled up. No pull to refresh on the transcript (MD-93).
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import type { LegendListRef } from '@legendapp/list/react-native';
import { useShallow } from 'zustand/react/shallow';
import { TRANSCRIPT_COPY } from '@generatorai/shared/ui-contract';
import type { ChatMessage } from '@generatorai/client-core';

import { useStreamStore } from '../../services/stream/streamStore';
import { ScrollToLatest } from '../../ui/layout/ScrollToLatest';
import { LegendList } from '../../ui/lib/styled';
import { useReduceMotion } from '../../ui/platform/motion';
import { Button } from '../../ui/primitives/Button';
import { Spinner } from '../../ui/primitives/Spinner';
import { Text } from '../../ui/primitives/Text';
import { activityLabelFor, selectChatView } from './model/selectChatView';
import { buildTranscriptItems, liveScmTurnIds, type TranscriptItem } from './model/transcriptItems';
import { AgentTurnHeader } from './parts/AgentTurnHeader';
import { TurnBody, TurnFooter, answerText } from './parts/TurnBody';
import { UserMessage } from './parts/UserMessage';
import { TranscriptActionsContext, type TranscriptActions } from './transcriptContext';
import { useChatWorkflowRuns, useScmResults } from './TranscriptView.queries';
import { WorkflowRunCardsContext } from './parts/WorkflowCards';

export interface TranscriptViewProps {
  chatId: string;
  /** The stream store key (the chat's session id once known). */
  streamKey: string;
  messages: readonly ChatMessage[] | undefined;
  /** More history exists above the loaded page. */
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  actions: TranscriptActions;
  /** A gate is pending: keep the reader at the end as the card arrives. */
  blocked?: boolean;
  /** Drawn while there is nothing to show (the empty chat). */
  empty?: React.ReactElement;
  testID?: string;
}

const LiveTurn = memo(function LiveTurn({ streamKey }: { streamKey: string }): React.ReactElement | null {
  const blocks = useStreamStore((s) => s.streams[streamKey]?.blocks);
  const live = useStreamStore((s) => {
    const status = s.streams[streamKey]?.status;
    return status === 'streaming' || status === 'thinking' || status === 'pending';
  });
  if (!blocks || blocks.length === 0) return null;
  return (
    <View className="gap-2.5">
      <AgentTurnHeader time={null} text={answerText(blocks)} />
      <TurnBody blocks={blocks} active={live} />
    </View>
  );
});

function ActivityRow({ label }: { label: string }): React.ReactElement {
  return (
    <View accessibilityLiveRegion="polite" accessibilityLabel={label} className="flex-row items-center gap-2.5 py-0.5">
      <Spinner size={14} />
      <Text role="footnote" tone="fg-2">
        {label}
      </Text>
    </View>
  );
}

const Item = memo(function Item({ item, streamKey }: { item: TranscriptItem; streamKey: string }): React.ReactElement | null {
  switch (item.kind) {
    case 'user':
      return <UserMessage text={item.text} attachments={item.attachments} time={item.time} {...(item.turnId ? { turnId: item.turnId } : {})} pending={item.pending ?? false} />;
    case 'agent':
      return (
        <View className="gap-2.5">
          {item.header ? <AgentTurnHeader time={item.time} text={answerText(item.blocks)} {...(item.turnId ? { turnId: item.turnId } : {})} /> : null}
          <TurnBody blocks={item.blocks} active={false} />
          {item.footer ? <TurnFooter blocks={item.blocks} {...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {})} stopped={item.stopped} /> : null}
        </View>
      );
    case 'system':
      return (
        <Text role="footnote" tone="fg-3" selectable>
          {item.text}
        </Text>
      );
    case 'live':
      return <LiveTurn streamKey={streamKey} />;
    case 'activity':
      return <ActivityRow label={item.label} />;
    default:
      return null;
  }
});

export function TranscriptView({ chatId, streamKey, messages, hasMore, loadingMore, onLoadMore, actions, blocked = false, empty, testID = 'transcript-list' }: TranscriptViewProps): React.ReactElement {
  const view = useStreamStore(useShallow((s) => selectChatView(s.streams[streamKey])));
  const scm = useScmResults(chatId);
  const runCards = useChatWorkflowRuns(chatId || null);
  const runCardMap = useMemo(() => new Map((runCards.data ?? []).map((c) => [c.runId, c])), [runCards.data]);
  const reduceMotion = useReduceMotion();
  const listRef = useRef<LegendListRef | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Until the reader first touches the list it keeps following the end as rows measure in: `initialScrollAtEnd`
  // lands on estimated sizes, and the real ones arrive after it.
  const [settling, setSettling] = useState(true);
  const activityLabel = activityLabelFor(view);

  const items = useMemo(
    () =>
      buildTranscriptItems(
        messages ?? [],
        {
          status: view.status,
          serverTurnId: view.serverTurnId,
          pendingUserMessage: view.pendingUserMessage,
          turnUserMessage: view.turnUserMessage,
          turnId: view.turnId,
          hasLive: view.blockCount > 0,
          activityLabel,
        },
        // The live blocks are read when the structure changes (`view.signature`), not per token.
        { results: scm.data, liveTurnIds: liveScmTurnIds(useStreamStore.getState().streams[streamKey]?.blocks) },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `view.signature` stands in for the live blocks array.
    [messages, scm.data, streamKey, view.status, view.serverTurnId, view.pendingUserMessage, view.turnUserMessage, view.turnId, view.blockCount, view.signature, activityLabel],
  );

  // A gate card grows the bottom of the screen; a reader at the end stays at the end.
  useEffect(() => {
    if (!blocked || !atBottom) return undefined;
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: !reduceMotion }), 120);
    return () => clearTimeout(t);
  }, [blocked, atBottom, reduceMotion]);

  const renderItem = useCallback(({ item }: { item: TranscriptItem }) => <Item item={item} streamKey={streamKey} />, [streamKey]);

  if (items.length === 0 && empty) return empty;

  return (
    <TranscriptActionsContext.Provider value={actions}>
      <WorkflowRunCardsContext.Provider value={runCardMap}>
      <View className="flex-1">
        <LegendList
          testID={testID}
          ref={listRef}
          data={items}
          keyExtractor={(item: TranscriptItem) => item.key}
          getItemType={(item: TranscriptItem) => item.kind}
          renderItem={renderItem}
          alignItemsAtEnd
          initialScrollAtEnd
          maintainScrollAtEnd={{ on: { dataChange: true, layout: true, footerLayout: true, itemLayout: view.isLive || settling } }}
          maintainVisibleContentPosition={{ data: true, size: false }}
          recycleItems={false}
          estimatedItemSize={120}
          onTouchStart={settling ? () => setSettling(false) : undefined}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            const next = contentSize.height - contentOffset.y - layoutMeasurement.height < 120;
            setAtBottom((prev) => (prev === next ? prev : next));
          }}
          scrollEventThrottle={32}
          ListHeaderComponent={
            hasMore ? (
              <View className="items-center pb-3">
                <Button label={TRANSCRIPT_COPY.loadEarlier} size="sm" loading={loadingMore} onPress={onLoadMore} testID="transcript-load-earlier" />
              </View>
            ) : null
          }
          className="flex-1"
          contentContainerClassName="gap-4 px-4 pb-3 pt-4"
        />
        <View pointerEvents="box-none" className="absolute inset-x-0 bottom-3 items-center">
          <ScrollToLatest
            visible={!atBottom}
            onPress={() => {
              listRef.current?.scrollToEnd({ animated: !reduceMotion });
              setAtBottom(true);
            }}
            testID="transcript-latest"
          />
        </View>
      </View>
      </WorkflowRunCardsContext.Provider>
    </TranscriptActionsContext.Provider>
  );
}
