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
// `?new=1` opens the creation sheet on arrival, which is what lets the
// Activity FAB deep-link straight into it instead of duplicating the flow.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Archive,
  ArchiveRestore,
  BellRing,
  MessagesSquare,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react-native';
import { epochOr, isArchived, queryKeys, type ChatSummary } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { useActivity } from '../../src/api/useActivity';
import { useModels } from '../../src/api/useModels';
import { NewChatSheet, type NewChatValues } from '../../src/components/chat/NewChatSheet';
import { RenameSheet } from '../../src/components/chat/RenameSheet';
import { relativeTime } from '../../src/components/runs/formatTime';
import { Card, StatusDot } from '../../src/components/ui/primitives';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Touchable } from '../../src/components/ui/Touchable';
import { Fab } from '../../src/components/ui/Button';
import { SearchField } from '../../src/components/ui/Form';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { SettingsButton } from '../../src/components/ui/SettingsButton';
import { SwipeableRow, closeSwipedRow } from '../../src/components/ui/SwipeableRow';
import { ActionSheet, ConfirmSheet } from '../../src/components/ui/ActionSheet';
import { useToast } from '../../src/components/ui/Toast';
import { useScrollToTop, scrollerToTop } from '../../src/navigation/scrollToTop';
import { useTheme } from '../../src/theme/ThemeProvider';

type Scope = 'active' | 'archived';

export default function ChatsScreen(): React.ReactElement {
  const api = useApi();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const toast = useToast();
  const params = useLocalSearchParams<{ new?: string }>();
  const listRef = useRef<never>(null);

  useScrollToTop('chats', scrollerToTop(listRef));

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('active');
  const [creating, setCreating] = useState(false);
  const [menuFor, setMenuFor] = useState<ChatSummary | null>(null);
  const [renaming, setRenaming] = useState<ChatSummary | null>(null);
  const [deleting, setDeleting] = useState<ChatSummary | null>(null);

  useEffect(() => {
    if (params.new !== '1') return;
    setCreating(true);
    // Clearing the param matters: without it, returning to this tab with the
    // URL unchanged re-opens the sheet every time.
    router.setParams({ new: undefined });
  }, [params.new]);

  const chats = useQuery({
    queryKey: queryKeys.chats(),
    queryFn: () => api.chats.list({ limit: 200 }),
  });

  const models = useModels();
  const projects = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => api.projects.list(),
  });
  // Picker list only — authoring an agent grants capability and stays on web.
  const agents = useQuery({
    queryKey: ['agents', 'selectable'] as const,
    queryFn: () => api.agents.selectable(),
  });

  // Reused purely for `runningChatIds` — the chat entity itself carries no
  // "is a turn in flight" flag, and a live dot is the single most useful
  // thing this list can show.
  const activity = useActivity();
  const running = useMemo(() => new Set(activity.health?.runningChatIds ?? []), [activity.health]);
  // Which chats are BLOCKED on a person. A catalogue that cannot say
  // "this one is waiting on you" makes you open each chat to find out, which
  // is the one question this app exists to answer quickly.
  const waiting = useMemo(
    () => new Set(activity.operations.filter((op) => op.kind === 'chat' && op.blocked).map((op) => op.id)),
    [activity.operations],
  );

  const invalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.chats() }),
    [queryClient],
  );

  const create = useMutation({
    mutationFn: (values: NewChatValues) => api.chats.create(values),
    onSuccess: (chat) => {
      setCreating(false);
      invalidate();
      router.push(`/chats/${chat.id}`);
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.chats.update(id, { status }),
    onSuccess: invalidate,
    onError: () => toast({ message: 'Could not update that chat.', tone: 'error' }),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.chats.update(id, { name }),
    onSuccess: () => {
      setRenaming(null);
      invalidate();
      toast({ message: 'Renamed.', tone: 'success' });
    },
    onError: () => toast({ message: 'Could not rename that chat.', tone: 'error' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.chats.remove(id),
    onSuccess: () => {
      setDeleting(null);
      invalidate();
      toast({ message: 'Chat deleted.', tone: 'success' });
    },
    onError: () => toast({ message: 'Could not delete that chat.', tone: 'error' }),
  });

  const archiveChat = useCallback(
    (chat: ChatSummary) => {
      setStatus.mutate({ id: chat.id, status: 'archived' });
      // Undo is what makes a swipe safe: the gesture is easy to trigger by
      // accident, so the recovery has to be one tap and immediate.
      toast({
        message: `Archived “${chat.name}”`,
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
    (chat: ChatSummary) => {
      setStatus.mutate({ id: chat.id, status: 'active' });
      toast({ message: `Restored “${chat.name}”`, tone: 'success' });
    },
    [setStatus, toast],
  );

  const visible = useMemo(() => {
    const list = chats.data ?? [];
    const q = query.trim().toLowerCase();
    return (
      list
        .filter((chat) => (scope === 'archived' ? isArchived(chat) : !isArchived(chat)))
        .filter((chat) => !q || chat.name.toLowerCase().includes(q))
        // `updatedAt` arrives as an ISO string; subtracting them directly is NaN
        // and leaves the list in whatever order the server returned.
        .sort((a, b) => epochOr(b.updatedAt) - epochOr(a.updatedAt))
    );
  }, [chats.data, query, scope]);

  const activeCount = (chats.data ?? []).filter((c) => !isArchived(c)).length;
  const archivedCount = (chats.data ?? []).filter(isArchived).length;

  return (
    <View className="flex-1 bg-background">
      <Screen title="Chats" trailing={<SettingsButton />} scroll={false}>
        <View className="gap-3 px-4 pb-3">
          <SearchField value={query} onChangeText={setQuery} placeholder="Search chats" />
          <SegmentedControl
            segments={[
              { value: 'active', label: 'Active', count: activeCount },
              { value: 'archived', label: 'Archived', count: archivedCount },
            ]}
            value={scope}
            onChange={(next) => {
              closeSwipedRow();
              setScope(next);
            }}
          />
        </View>

        {chats.isLoading ? (
          <View className="px-4">
            <SkeletonList rows={6} />
          </View>
        ) : chats.isError ? (
          <ErrorState message="Could not load chats." onRetry={() => void chats.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={scope === 'archived' ? 'No archived chats' : 'No chats yet'}
            message={
              query
                ? 'Nothing matches that search.'
                : scope === 'archived'
                  ? 'Chats you archive are kept here.'
                  : 'Start one and it appears here.'
            }
            icon={<MessagesSquare size={22} color={colors['muted-foreground']} />}
            {...(scope === 'active' && !query
              ? { action: { label: 'New chat', onPress: () => setCreating(true) } }
              : {})}
          />
        ) : (
          <LegendList
            ref={listRef as never}
            data={visible}
            keyExtractor={(chat: ChatSummary) => chat.id}
            estimatedItemSize={66}
            recycleItems
            // The gutter is on the row, not here: LegendList positions every
            // container absolutely, so contentContainerStyle padding never
            // reaches the rows.
            contentContainerStyle={{ paddingBottom: 140, gap: 10 }}
            refreshing={chats.isFetching}
            onRefresh={() => void chats.refetch()}
            renderItem={({ item }: { item: ChatSummary }) => (
              <View className="px-4">
                <ChatRow
                  chat={item}
                  live={running.has(item.id)}
                  waiting={waiting.has(item.id)}
                  archived={scope === 'archived'}
                  onArchive={() => archiveChat(item)}
                  onUnarchive={() => unarchiveChat(item)}
                  onDelete={() => setDeleting(item)}
                  onMenu={() => setMenuFor(item)}
                />
              </View>
            )}
          />
        )}
      </Screen>

      <Fab
        accessibilityLabel="New chat"
        icon={<Plus size={22} color={colors['primary-foreground']} />}
        onPress={() => setCreating(true)}
        offset={64}
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
        title={menuFor?.name}
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
        title={`Delete “${deleting?.name ?? ''}”?`}
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
 * it is called, and what was last said in it. The state is carried by a
 * leading marker AND by the row's left edge, so "waiting on you" is legible
 * in a glance down the list rather than after reading four labels.
 */
function ChatRow({
  chat,
  live,
  waiting,
  archived,
  onArchive,
  onUnarchive,
  onDelete,
  onMenu,
}: {
  chat: ChatSummary;
  live: boolean;
  waiting: boolean;
  archived: boolean;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  onMenu: () => void;
}): React.ReactElement {
  const { colors } = useTheme();

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

  const state = waiting ? 'waiting' : live ? 'running' : 'idle';
  const stateLabel = waiting ? 'Waiting on you' : live ? 'Running' : relativeTime(chat.updatedAt);
  const markerColor =
    state === 'waiting' ? colors.warning : state === 'running' ? colors.info : colors['muted-foreground'];

  // "You: …" for your own last line reads as a conversation; an unlabelled
  // excerpt of your own prompt reads as the agent repeating you back.
  const preview = chat.preview
    ? chat.previewRole === 'user'
      ? `You: ${chat.preview}`
      : chat.preview
    : null;

  return (
    <View className="overflow-hidden rounded-3xl">
      <SwipeableRow actions={actions}>
        <Touchable
          accessibilityLabel={`${chat.name}. ${stateLabel}.${preview ? ` ${preview}` : ''}`}
          accessibilityHint="Double tap and hold for more actions"
          haptic="tap"
          scale="large"
          onPress={() => router.push(`/chats/${chat.id}`)}
          onLongPress={onMenu}
        >
          <Card
            className="flex-row gap-3 p-3.5"
            // Inline rather than a utility: NativeWind has no reliable
            // directional border-colour class, and the whole point of the
            // marker is that it is unambiguous.
            style={state === 'waiting' ? { borderLeftWidth: 3, borderLeftColor: colors.warning } : undefined}
          >
            <View
              className={`h-9 w-9 items-center justify-center rounded-2xl ${
                state === 'waiting' ? 'bg-warning-muted' : 'bg-subtle'
              }`}
            >
              {state === 'waiting' ? (
                <BellRing size={16} color={colors.warning} />
              ) : state === 'running' ? (
                <Activity size={16} color={colors.info} />
              ) : (
                <MessagesSquare size={16} color={colors['muted-foreground']} />
              )}
            </View>

            <View className="flex-1 gap-0.5">
              <View className="flex-row items-baseline gap-2">
                <Text numberOfLines={1} className="flex-1 text-md font-medium text-foreground">
                  {chat.name}
                </Text>
                <Text className="text-xs text-muted-foreground">{relativeTime(chat.updatedAt)}</Text>
              </View>

              {preview ? (
                <Text numberOfLines={1} className="text-sm text-muted-foreground">
                  {preview}
                </Text>
              ) : null}

              {state !== 'idle' || chat.model ? (
                <View className="flex-row items-center gap-1.5 pt-0.5">
                  {state !== 'idle' ? (
                    <>
                      <StatusDot tone={state === 'waiting' ? 'warning' : 'info'} label={null} />
                      <Text numberOfLines={1} className="text-xs font-medium" style={{ color: markerColor }}>
                        {stateLabel}
                      </Text>
                    </>
                  ) : null}
                  {chat.model ? (
                    <Text numberOfLines={1} className="flex-1 text-xs text-muted-foreground">
                      {state !== 'idle' ? '· ' : ''}
                      {chat.model}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </Card>
        </Touchable>
      </SwipeableRow>
    </View>
  );
}
