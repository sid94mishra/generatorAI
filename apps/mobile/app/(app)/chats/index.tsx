// ────────────────────────────────────────────────────────────────
// Chats — the catalogue.
//
// Search, a live-status rail, archive filtering, and creation with the full
// option set. The list is virtualised because a working install accumulates
// hundreds of chats and a plain map() renders every row on mount.
//
// Row actions follow the platform rather than the web: swipe reveals archive
// and delete, long-press opens the full menu. The previous inline archive
// button was a 44pt target competing for room inside a 56pt row, and there
// was no way at all to rename, delete, or bring a chat back from the archive.
//
// `?new=1` opens the creation sheet on arrival, which is what lets Home's
// compose button deep-link straight into it instead of duplicating the flow.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useChats, useCreateChat, useSetChatStatus, useRenameChat, useRemoveChat, useRemoveChats } from '../../../src/features/chats/queries';
import { useProjects } from '../../../src/features/projects/queries';
import { useSelectableAgents } from '../../../src/features/agents/queries';
import {
  Archive,
  ArchiveRestore,
  Circle,
  CircleCheck,
  ListChecks,
  MessagesSquare,
  Pencil,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react-native';
import { epochOr, isArchived, type ChatListRow } from '@generatorai/client-core';

import { useModels } from '../../../src/services/api/useModels';
import { NewChatSheet } from '../../../src/components/chat/NewChatSheet';
import { RenameSheet } from '../../../src/components/chat/RenameSheet';
import { relativeTime } from '../../../src/components/runs/formatTime';
import { displayChatName, parseChatName } from '../../../src/components/common/chatName';
import { ENTITY_ICON } from '../../../src/components/common/entityIcons';
import { sectionRows, type SectionRow } from '../../../src/components/common/groupByDay';
import { ListItem, ListSectionHeader } from '../../../src/components/ui/ListItem';
import { usePullToRefresh } from '../../../src/components/ui/usePullToRefresh';
import { SegmentedControl } from '../../../src/components/ui/SegmentedControl';
import { Button, IconButton } from '../../../src/components/ui/Button';
import { haptics } from '../../../src/components/ui/haptics';
import { SearchField } from '../../../src/components/ui/Form';
import { EmptyState, ErrorState } from '../../../src/components/ui/States';
import { SkeletonList } from '../../../src/components/ui/Skeleton';
import { Screen } from '../../../src/components/ui/Screen';
import { TabHeaderActions } from '../../../src/navigation/TabHeaderActions';
import { MenuButton } from '../../../src/navigation/shell/MenuButton';
import { SwipeableRow, closeSwipedRow } from '../../../src/components/ui/SwipeableRow';
import { ActionSheet, ConfirmSheet } from '../../../src/components/ui/ActionSheet';
import { useToast } from '../../../src/components/ui/Toast';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Desktop's three filters, in its order. `all` is its default too.
type Scope = 'all' | 'active' | 'archived';

export default function ChatsScreen(): React.ReactElement {
  const { legacyColors: colors } = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{ new?: string }>();
  const listRef = useRef<never>(null);
  const listBottom = useSafeAreaInsets().bottom + 24;


  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  // Bulk selection — desktop's "Select" mode. Entered from the header or by
  // choosing Select from a row's menu; rows then toggle instead of opening.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);
  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const [creating, setCreating] = useState(false);
  const [menuFor, setMenuFor] = useState<ChatListRow | null>(null);
  const [renaming, setRenaming] = useState<ChatListRow | null>(null);
  const [deleting, setDeleting] = useState<ChatListRow | null>(null);

  useEffect(() => {
    if (params.new !== '1') return;
    setCreating(true);
    // Clearing the param matters: without it, returning to this tab with the
    // URL unchanged re-opens the sheet every time.
    router.setParams({ new: undefined });
  }, [params.new]);

  const deferredQuery = useDeferredValue(query);
  const chats = useChats(scope, deferredQuery);

  const models = useModels();
  const projects = useProjects();
  // Picker list only — authoring an agent grants capability and stays on web.
  const agents = useSelectableAgents();

  const create = useCreateChat({
    onSuccess: (chat) => {
      setCreating(false);
      router.push(`/chats/${chat.id}`);
    },
  });

  const setStatus = useSetChatStatus({
    onError: () => toast({ message: 'Could not update that chat.', tone: 'error' }),
  });

  const rename = useRenameChat({
    onSuccess: () => {
      setRenaming(null);
      toast({ message: 'Renamed.', tone: 'success' });
    },
    onError: () => toast({ message: 'Could not rename that chat.', tone: 'error' }),
  });

  const remove = useRemoveChat({
    onSuccess: () => {
      setDeleting(null);
      toast({ message: 'Chat deleted.', tone: 'success' });
    },
    onError: () => toast({ message: 'Could not delete that chat.', tone: 'error' }),
  });

  // Same outcome rules as desktop's list (P2-R36): after a partial failure
  // only the chats that failed stay selected, so a retry does not resend ids
  // that are already gone; when the request fails outright nothing was
  // deleted, so the selection stays as it was.
  const removeMany = useRemoveChats({
    onSuccess: ({ failedIds, total }) => {
      const failed = failedIds.length;
      if (failed > 0) setSelected(new Set(failedIds));
      else exitSelection();
      toast(
        failed > 0
          ? { message: `${total - failed} deleted, ${failed} could not be deleted.`, tone: 'error' }
          : { message: `${total} ${total === 1 ? 'chat' : 'chats'} deleted.`, tone: 'success' },
      );
    },
    onError: () => {
      toast({ message: 'Could not delete those chats.', tone: 'error' });
    },
  });

  const archiveChat = useCallback(
    (chat: ChatListRow) => {
      setStatus.mutate({ id: chat.id, status: 'archived' });
      // Undo is what makes a swipe safe: the gesture is easy to trigger by
      // accident, so the recovery has to be one tap and immediate.
      toast({
        message: `Archived “${displayChatName(chat.name)}”`,
        tone: 'success',
        action: {
          label: 'Undo',
          onPress: () => setStatus.mutate({ id: chat.id, status: 'active' }),
        },
      });
    },
    [setStatus, toast],
  );

  const unarchiveChat = useCallback(
    (chat: ChatListRow) => {
      setStatus.mutate({ id: chat.id, status: 'active' });
      toast({ message: `Restored “${displayChatName(chat.name)}”`, tone: 'success' });
    },
    [setStatus, toast],
  );

  const visible = useMemo(() => chats.data?.items ?? [], [chats.data]);
  const selectableIds = useMemo(() => visible.map((c) => c.id), [visible]);

  // Today / Yesterday / This week / Older. Search results stay one flat list:
  // a match's date is not what the user is scanning for.
  const rows = useMemo<SectionRow<ChatListRow>[]>(
    () =>
      query.trim()
        ? visible.map((chat) => ({ type: 'item' as const, key: chat.id, item: chat }))
        : sectionRows(visible, { keyOf: (chat) => chat.id, timeOf: (chat) => epochOr(chat.updatedAt) }),
    [visible, query],
  );

  // Server-computed across every matching chat, not just the page loaded —
  // filtering the loaded `.items` would undercount once an install has more
  // chats than the page's `limit`.
  // Undefined until the first page lands: no count is shown rather than an
  // invented "0" (D-36).
  const counts = chats.data?.counts;

  const pull = usePullToRefresh(() => chats.refetch(), chats.isFetching);

  const header = (
    // Same order on every tab: scope first, then search within it.
    <View className="gap-3 px-4 pb-1">
      <SegmentedControl
        segments={[
          { value: 'all', label: 'All', count: counts?.all },
          { value: 'active', label: 'Active', count: counts?.active },
          { value: 'archived', label: 'Archived', count: counts?.archived },
        ]}
        value={scope}
        onChange={(next) => {
          closeSwipedRow();
          setScope(next);
        }}
        accessibilityLabel="Active or archived chats"
      />
      <SearchField value={query} onChangeText={setQuery} placeholder="Search chats" />
    </View>
  );

  const empty = chats.isLoading ? (
    <SkeletonList rows={6} variant="flat" />
  ) : chats.isError ? (
    <ErrorState message="Could not load chats." onRetry={() => void chats.refetch()} />
  ) : (
    <EmptyState
      title={query ? 'No matches' : scope === 'archived' ? 'No archived chats' : 'No chats yet'}
      message={
        query
          ? 'Nothing matches that search.'
          : scope === 'archived'
            ? 'Chats you archive are kept here.'
            : 'Start one and it appears here.'
      }
      icon={<MessagesSquare size={22} color={colors['muted-foreground']} />}
      {...(scope !== 'archived' && !query
        ? { action: { label: 'New chat', onPress: () => setCreating(true) } }
        : {})}
    />
  );

  return (
    <View className="flex-1 bg-background">
      <Screen
        title={selecting ? `${selected.size} selected` : 'Chats'}
        variant="compact"
        leading={
          selecting ? (
            <IconButton
              accessibilityLabel="Cancel selection"
              icon={<X size={22} color={colors.foreground} />}
              onPress={exitSelection}
            />
          ) : (
            <MenuButton />
          )
        }
        trailing={
          selecting ? (
            <View className="flex-row items-center">
              <Button
                label={selected.size === selectableIds.length && selected.size > 0 ? 'Deselect all' : 'Select all'}
                variant="ghost"
                size="sm"
                onPress={() =>
                  setSelected(selected.size === selectableIds.length ? new Set() : new Set(selectableIds))
                }
              />
              <IconButton
                testID="chats-bulk-delete"
                accessibilityLabel={`Delete ${selected.size} selected ${selected.size === 1 ? 'chat' : 'chats'}`}
                disabled={selected.size === 0 || removeMany.isPending}
                icon={<Trash2 size={20} color={selected.size === 0 ? colors['muted-foreground'] : colors.danger} />}
                onPress={() => {
                  haptics.warn();
                  setConfirmBulk(true);
                }}
              />
            </View>
          ) : (
            <TabHeaderActions>
              <IconButton
                testID="chats-new"
                accessibilityLabel="New chat"
                icon={<SquarePen size={20} color={colors.foreground} />}
                onPress={() => setCreating(true)}
              />
              {(chats.data?.items.length ?? 0) > 0 ? (
                <IconButton
                  testID="chats-select"
                  accessibilityLabel="Select chats"
                  accessibilityHint="Select several chats to delete them together"
                  icon={<ListChecks size={20} color={colors.foreground} />}
                  onPress={() => setSelecting(true)}
                />
              ) : null}
            </TabHeaderActions>
          )
        }
        scroll={false}
      >
        <LegendList
          ref={listRef as never}
          data={rows}
          keyExtractor={(row: SectionRow<ChatListRow>) => row.key}
          getItemType={(row: SectionRow<ChatListRow>) => row.type}
          estimatedItemSize={64}
          recycleItems
          // Rows read selection state that is not part of `data`; without this
          // the list keeps the rows it already built, so entering Select mode
          // left every row still opening its chat.
          extraData={`${selecting}|${[...selected].join()}`}
          // The gutter is on the rows, not here: LegendList positions every
          // container absolutely, so contentContainerStyle padding never
          // reaches the rows.
          contentContainerStyle={{ paddingBottom: listBottom }}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          onEndReached={() => { if (chats.hasNextPage && !chats.isFetchingNextPage) void chats.fetchNextPage(); }}
          onEndReachedThreshold={0.4}
          renderItem={({ item: row }: { item: SectionRow<ChatListRow> }) =>
            row.type === 'header' ? (
              <ListSectionHeader label={row.label} />
            ) : (
              <ChatRow
                chat={row.item}
                live={chats.rowState(row.item) === 'running'}
                waiting={chats.rowState(row.item) === 'needs_you'}
                archived={isArchived(row.item)}
                selecting={selecting}
                selected={selected.has(row.item.id)}
                onToggleSelect={() => toggleSelected(row.item.id)}
                onArchive={() => archiveChat(row.item)}
                onUnarchive={() => unarchiveChat(row.item)}
                onDelete={() => setDeleting(row.item)}
                onMenu={() => setMenuFor(row.item)}
              />
            )
          }
        />
      </Screen>


      <ConfirmSheet
        visible={confirmBulk}
        onClose={() => setConfirmBulk(false)}
        title={`Delete ${selected.size} ${selected.size === 1 ? 'chat' : 'chats'}?`}
        message="The conversations and their workspaces are removed for good. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmBulk(false);
          removeMany.mutate([...selected]);
        }}
      />

      <NewChatSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreate={(values) => create.mutate(values)}
        creating={create.isPending}
        error={create.isError ? 'Could not create the chat. Check the name and try again.' : null}
        models={models.data}
        projects={projects.data}
        agents={agents.data}
      />

      <ActionSheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor ? displayChatName(menuFor.name) : undefined}
        message={menuFor ? `Updated ${relativeTime(menuFor.updatedAt)}` : undefined}
        actions={
          menuFor
            ? [
                {
                  label: 'Rename',
                  icon: <Pencil size={18} color={colors.foreground} />,
                  onPress: () => setRenaming(menuFor),
                },
                isArchived(menuFor)
                  ? {
                      label: 'Move to active',
                      icon: <ArchiveRestore size={18} color={colors.foreground} />,
                      onPress: () => unarchiveChat(menuFor),
                    }
                  : {
                      label: 'Archive',
                      icon: <Archive size={18} color={colors.foreground} />,
                      onPress: () => archiveChat(menuFor),
                    },
                {
                  label: 'Delete',
                  icon: <Trash2 size={18} color={colors.danger} />,
                  destructive: true,
                  onPress: () => setDeleting(menuFor),
                },
              ]
            : []
        }
      />

      <RenameSheet
        visible={renaming !== null}
        title="Rename chat"
        initialValue={renaming?.name ?? ''}
        busy={rename.isPending}
        onClose={() => setRenaming(null)}
        onSubmit={(name) => {
          if (renaming) rename.mutate({ id: renaming.id, name });
        }}
      />

      <ConfirmSheet
        visible={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting ? displayChatName(deleting.name) : ''}”?`}
        message="The transcript and everything the agent produced in it are removed. This cannot be undone."
        confirmLabel="Delete chat"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </View>
  );
}

/**
 * One catalogue row.
 *
 * Three facts, in the order they are wanted: what state the chat is in, what
 * it is called, and what was last said in it. State lives in the avatar (tint
 * + corner dot) and is spelled out at the start of the subtitle. The glyph is
 * always the chat icon, as everywhere else a chat is listed.
 * Orchestrator workers drop the server's "⚙" marker for a Sub-agent badge.
 */
function ChatRow({
  chat,
  live,
  waiting,
  archived,
  selecting,
  selected,
  onToggleSelect,
  onArchive,
  onUnarchive,
  onDelete,
  onMenu,
}: {
  chat: ChatListRow;
  live: boolean;
  waiting: boolean;
  archived: boolean;
  selecting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  onMenu: () => void;
}): React.ReactElement {
  const { legacyColors: colors } = useTheme();

  const actions = useMemo(
    () =>
      archived
        ? [
            {
              label: 'Restore',
              tone: 'primary' as const,
              icon: <ArchiveRestore size={18} color={colors['primary-foreground']} />,
              onPress: onUnarchive,
            },
            {
              label: 'Delete',
              tone: 'danger' as const,
              icon: <Trash2 size={18} color={colors['destructive-foreground']} />,
              onPress: onDelete,
            },
          ]
        : [
            {
              label: 'Archive',
              tone: 'primary' as const,
              icon: <Archive size={18} color={colors['primary-foreground']} />,
              onPress: onArchive,
            },
            {
              label: 'Delete',
              tone: 'danger' as const,
              icon: <Trash2 size={18} color={colors['destructive-foreground']} />,
              onPress: onDelete,
            },
          ],
    [archived, colors, onArchive, onUnarchive, onDelete],
  );

  const name = parseChatName(chat.name);
  const state = waiting ? 'waiting' : live ? 'running' : 'idle';
  const stateLabel = waiting ? 'Waiting on you' : live ? 'Running' : null;
  const tone = state === 'waiting' ? 'warning' : state === 'running' ? 'info' : 'neutral';

  // "You: …" for your own last line reads as a conversation; an unlabelled
  // excerpt of your own prompt reads as the agent repeating you back.
  const preview = chat.summary.preview
    ? chat.summary.preview.role === 'user'
      ? `You: ${chat.summary.preview.text}`
      : chat.summary.preview.text
    : null;
  // `default` is not a model anyone chose; it says nothing.
  const model = chat.model && chat.model !== 'default' ? chat.model : null;
  const subtitle = stateLabel ? [stateLabel, preview].filter(Boolean).join(' · ') : (preview ?? model);

  return (
    <SwipeableRow actions={selecting ? [] : actions}>
      <ListItem
        title={name.title}
        {...(selecting
          ? {
              accessory: selected ? (
                <CircleCheck size={22} color={colors.primary} />
              ) : (
                <Circle size={22} color={colors['muted-foreground']} />
              ),
            }
          : {})}
        titleBadge={name.subAgent ? { label: 'Sub-agent' } : null}
        subtitle={subtitle}
        subtitleTone={state === 'waiting' ? 'warning' : 'muted'}
        meta={relativeTime(chat.updatedAt)}
        avatar={{
          // Always the chat glyph, as on Home, in the drawer and in search:
          // the tint and the corner dot carry the state.
          icon: (
            <ENTITY_ICON.chat
              size={17}
              color={colors[state === 'running' ? 'info' : state === 'waiting' ? 'warning' : 'muted-foreground']}
            />
          ),
          tone,
          indicator: state === 'waiting' ? 'warning' : state === 'running' ? 'info' : null,
        }}
        accessibilityLabel={`${name.title}.${name.subAgent ? ' Sub-agent.' : ''} ${stateLabel ?? relativeTime(chat.updatedAt)}.${preview ? ` ${preview}` : ''}`}
        accessibilityHint={selecting ? (selected ? 'Selected. Double tap to deselect' : 'Double tap to select') : 'Double tap and hold for more actions'}
        onPress={selecting ? onToggleSelect : () => router.push(`/chats/${chat.id}`)}
        onLongPress={selecting ? onToggleSelect : onMenu}
      />
    </SwipeableRow>
  );
}
