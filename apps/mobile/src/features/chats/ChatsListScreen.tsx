// Chats (MChats; 04 §2.2; M6-01): the server-paged chat list. Header "Chats" (top role) with "Select"
// (`chats-select`) and a "Sort and more" menu (MD-53); in content a SearchInput (server search) and the All / Active /
// Archived segments with their counts (MDF-36); a "Pinned" section when a chat is pinned (MG-02), then the rest.
// Rows are MB-48 ChatRows (swipe MD-52, long-press menu MDF-57). Multi-select starts only from "Select" (MD-60) and
// swaps the NewAction for the BulkActionBar. Keyset paging, pull to refresh (MD-93).
import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { router } from 'expo-router';

import {
  CHAT_SORTS,
  ChatRow,
  afterBulk,
  chatListEntries,
  chatRowMenu,
  toggleAll,
  useChatBulkActions,
  useChatRowActions,
  type ChatListEntry,
  type ChatRowActionId,
  type ChatRowView,
  type ChatSort,
} from '../../blocks/ChatRow';
import { useSidebarToggle } from '../../blocks/shell/useSidebarToggle';
import { chatHref } from '../../blocks/shell/hrefs';
import { BulkActionBar } from '../../ui/layout/BulkActionBar';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { NewAction } from '../../ui/layout/NewAction';
import { Screen } from '../../ui/layout/Screen';
import { SectionHeader } from '../../ui/layout/SectionHeader';
import { closeOpenSwipeRow } from '../../ui/layout/SwipeRow';
import { Header } from '../../ui/native/router/Header';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { useSheet } from '../../ui/native/Sheet';
import { useInsets } from '../../ui/platform/insets';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Spinner } from '../../ui/primitives/Spinner';
import { useChatsList, type ChatScope } from './queries';

export interface ChatsListScreenProps {
  /** Opens New chat (the route decides how until `/chats/new` lands, M6-05). */
  onNewChat: () => void;
}

const LIST_BOTTOM_GAP = 96;

export function ChatsListScreen({ onNewChat }: ChatsListScreenProps): React.ReactElement {
  const sidebar = useSidebarToggle();
  const insets = useInsets();
  const sheet = useSheet();
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<ChatScope>('all');
  const [sort, setSort] = useState<ChatSort>('activity');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const query = useDeferredValue(search);
  const list = useChatsList(scope, query, sort);
  const bulk = useChatBulkActions();

  const open = useCallback((row: ChatRowView) => router.push(chatHref(row.id) as never), []);
  const more = useCallback(
    (row: ChatRowView, runAction: (id: ChatRowActionId, row: ChatRowView) => void) =>
      sheet.present(
        <ListSection>
          {chatRowMenu(row)
            .filter((e): e is Exclude<typeof e, { type: 'separator' }> => !('type' in e) && e.id !== 'open')
            .map((e) => (
              <ListRow
                key={e.id}
                kind={e.destructive ? 'destructive' : 'navigation'}
                icon={e.icon}
                title={e.label}
                onPress={() => {
                  sheet.dismiss();
                  runAction(e.id, row);
                }}
              />
            ))}
        </ListSection>,
        { title: row.title, detents: ['content'] },
      ),
    [sheet],
  );
  const run = useChatRowActions({ onOpen: open, onMore: more });
  const [refreshing, setRefreshing] = useState(false);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);
  const ids = useMemo(() => list.rows.map((r) => r.id), [list.rows]);
  const entries = useMemo(() => chatListEntries(list.rows, { flat: query.trim().length > 0 || scope === 'archived' }), [list.rows, query, scope]);

  const header = selecting ? (
    <Header
      role="top"
      title={`${selected.size} selected`}
      largeTitle={false}
      actions={[
        { id: 'select-all', icon: 'check', label: selected.size === ids.length && ids.length > 0 ? 'Deselect all' : 'Select all', onPress: () => setSelected(toggleAll(selected, ids)) },
        { id: 'cancel-selection', icon: 'x', label: 'Cancel', onPress: exitSelection },
      ]}
    />
  ) : (
    <Header
      role="top"
      title="Chats"
      onSidebarToggle={sidebar.onSidebarToggle}
      sidebarToggleState={sidebar.sidebarToggleState}
      actions={[
        ...(ids.length > 0 ? [{ id: 'select', icon: 'list' as const, label: 'Select', testID: 'chats-select', onPress: () => setSelecting(true) }] : []),
        {
          id: 'sort',
          icon: 'sort',
          label: 'Sort and more',
          testID: 'chats-sort',
          menu: CHAT_SORTS.map((s) => ({ id: s.id, label: s.label, checked: s.id === sort })),
          onMenuSelect: (id) => setSort(id as ChatSort),
        },
      ]}
    />
  );

  const listHeader = (
    <View className="gap-3 px-4 pb-2">
      <SearchInput value={search} onChangeText={setSearch} placeholder="Search chats" loading={list.isLoading && search.length > 0} testID="chats-search" />
      <SegmentedControl<ChatScope>
        accessibilityLabel="Filter chats"
        value={scope}
        onValueChange={(next) => {
          closeOpenSwipeRow();
          setScope(next);
        }}
        segments={[
          { value: 'all', label: 'All', count: list.counts?.all },
          { value: 'active', label: 'Active', count: list.counts?.active },
          { value: 'archived', label: 'Archived', count: list.counts?.archived },
        ]}
        fullWidth
        testID="chats-scope"
      />
    </View>
  );

  const empty = list.isLoading ? (
    <View className="px-4 pt-2" accessibilityLabel="Loading chats">
      <Skeleton preset="list" count={6} />
    </View>
  ) : list.isError ? (
    <ErrorState title="Couldn't load chats" error={list.error} onRetry={() => void list.refetch()} />
  ) : query.trim() ? (
    <EmptyState copyKey="searchResults" action={{ label: 'Clear search', onPress: () => setSearch('') }} />
  ) : scope === 'archived' ? (
    <EmptyState copyKey="archivedChats" />
  ) : (
    <EmptyState copyKey="chats" action={{ label: 'New chat', icon: 'plus', onPress: onNewChat }} />
  );

  const renderItem = ({ item }: { item: ChatListEntry }): React.ReactElement =>
    item.type === 'header' ? (
      <SectionHeader title={item.title} {...(item.count !== undefined ? { count: item.count } : {})} />
    ) : (
      <ChatRow
        row={item.row}
        onAction={run}
        {...(selecting
          ? {
              selection: {
                selected: selected.has(item.row.id),
                onToggle: () =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.row.id)) next.delete(item.row.id);
                    else next.add(item.row.id);
                    return next;
                  }),
              },
            }
          : {})}
      />
    );

  const bottom = selecting ? (
    <BulkActionBar
      count={selected.size}
      onSelectAll={() => setSelected(toggleAll(selected, ids))}
      onCancel={exitSelection}
      actions={[
        { id: 'archive', label: 'Archive selected', icon: 'archive', disabled: selected.size === 0, onPress: () => void bulk.archive([...selected]).then((failed) => (failed.length ? setSelected(afterBulk(failed)) : exitSelection())).catch(() => undefined) },
        {
          id: 'delete',
          label: 'Delete selected',
          icon: 'trash',
          destructive: true,
          disabled: selected.size === 0,
          testID: 'chats-bulk-delete',
          onPress: () =>
            void bulk
              .remove([...selected])
              .then((failed) => {
                if (failed === null) return;
                if (failed.length) setSelected(afterBulk(failed));
                else exitSelection();
              })
              .catch(() => undefined),
        },
      ]}
    />
  ) : (
    <NewAction label="New chat" icon="edit" onPress={onNewChat} testID="chats-new" />
  );

  return (
    <Screen header={header} scroll="list" bottomAccessory={bottom} testID="chats">
      <LegendList
        data={entries}
        keyExtractor={(entry: ChatListEntry) => entry.key}
        getItemType={(entry: ChatListEntry) => entry.type}
        renderItem={renderItem}
        estimatedItemSize={72}
        recycleItems
        extraData={selecting ? [...selected].join() : ''}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={closeOpenSwipeRow}
        contentContainerStyle={{ paddingBottom: insets.bottom + LIST_BOTTOM_GAP }}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={empty}
        ListFooterComponent={list.isFetchingNextPage ? <View className="items-center py-4"><Spinner /></View> : null}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void list.refetch().finally(() => setRefreshing(false));
        }}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        testID="chats-list"
      />
    </Screen>
  );
}
