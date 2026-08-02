// ────────────────────────────────────────────────────────────────
// Chats — the catalogue.
//
// Search, a live-status rail, archive filtering, and creation with the full
// option set. The list is virtualised because a working install accumulates
// hundreds of chats and a plain map() renders every row on mount.
//
// `?new=1` opens the creation sheet on arrival, which is what lets the
// Activity FAB deep-link straight into it instead of duplicating the flow.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, MessagesSquare, Plus } from 'lucide-react-native';
import { epochOr, isArchived, queryKeys, type ChatSummary } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { useActivity } from '../../src/api/useActivity';
import { useModels } from '../../src/api/useModels';
import { NewChatSheet, type NewChatValues } from '../../src/components/chat/NewChatSheet';
import { relativeTime } from '../../src/components/runs/formatTime';
import { Card, StatusDot } from '../../src/components/ui/primitives';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Touchable } from '../../src/components/ui/Touchable';
import { Fab, IconButton } from '../../src/components/ui/Button';
import { Field } from '../../src/components/ui/Form';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { SettingsButton } from '../../src/components/ui/SettingsButton';
import { useTheme } from '../../src/theme/ThemeProvider';

type Scope = 'active' | 'archived';

export default function ChatsScreen(): React.ReactElement {
  const api = useApi();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ new?: string }>();

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('active');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (params.new === '1') setCreating(true);
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

  // Reused purely for `runningChatIds` — the chat entity itself carries no
  // "is a turn in flight" flag, and a live dot is the single most useful
  // thing this list can show.
  const activity = useActivity();
  const running = useMemo(
    () => new Set(activity.health?.runningChatIds ?? []),
    [activity.health],
  );

  const create = useMutation({
    mutationFn: (values: NewChatValues) => api.chats.create(values),
    onSuccess: (chat) => {
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats() });
      router.push(`/chats/${chat.id}`);
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.chats.archive(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.chats() }),
  });

  const visible = useMemo(() => {
    const list = chats.data ?? [];
    const q = query.trim().toLowerCase();
    return list
      .filter((chat) => (scope === 'archived' ? isArchived(chat) : !isArchived(chat)))
      .filter((chat) => !q || chat.name.toLowerCase().includes(q))
      // `updatedAt` arrives as an ISO string; subtracting them directly is NaN
      // and leaves the list in whatever order the server returned.
      .sort((a, b) => epochOr(b.updatedAt) - epochOr(a.updatedAt));
  }, [chats.data, query, scope]);

  const activeCount = (chats.data ?? []).filter((c) => !isArchived(c)).length;
  const archivedCount = (chats.data ?? []).filter(isArchived).length;

  return (
    <View className="flex-1 bg-background">
      <Screen title="Chats" trailing={<SettingsButton />} scroll={false}>
        <View className="gap-3 px-4 pb-3">
          <Field
            placeholder="Search chats"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search chats"
          />
          <SegmentedControl
            segments={[
              { value: 'active', label: 'Active', count: activeCount },
              { value: 'archived', label: 'Archived', count: archivedCount },
            ]}
            value={scope}
            onChange={setScope}
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
            data={visible}
            keyExtractor={(chat) => chat.id}
            estimatedItemSize={78}
            recycleItems
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, gap: 10 }}
            refreshing={chats.isFetching}
            onRefresh={() => void chats.refetch()}
            renderItem={({ item }) => (
              <ChatRow
                chat={item}
                live={running.has(item.id)}
                onArchive={
                  scope === 'active' ? () => archive.mutate(item.id) : undefined
                }
              />
            )}
          />
        )}
      </Screen>

      <Fab
        accessibilityLabel="New chat"
        icon={<Plus size={22} color={colors['primary-foreground']} />}
        onPress={() => setCreating(true)}
        bottom={24}
      />

      <NewChatSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreate={(values) => create.mutate(values)}
        creating={create.isPending}
        error={create.isError ? 'Could not create the chat. Check the name and try again.' : null}
        models={models.data}
        projects={projects.data}
      />
    </View>
  );
}

function ChatRow({
  chat,
  live,
  onArchive,
}: {
  chat: ChatSummary;
  live: boolean;
  onArchive?: (() => void) | undefined;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Touchable
      accessibilityLabel={chat.name}
      haptic="tap"
      scale="large"
      onPress={() => router.push(`/chats/${chat.id}`)}
    >
      <Card className="flex-row items-center gap-3 p-3.5">
        <View className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle">
          <MessagesSquare size={16} color={live ? colors.primary : colors['muted-foreground']} />
        </View>

        <View className="flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-md font-medium text-foreground">
            {chat.name}
          </Text>
          <View className="flex-row items-center gap-1.5">
            {live ? <StatusDot tone="info" /> : null}
            <Text numberOfLines={1} className="text-xs text-muted-foreground">
              {live ? 'Running · ' : ''}
              {relativeTime(chat.updatedAt)}
              {chat.model ? ` · ${chat.model}` : ''}
            </Text>
          </View>
        </View>

        {onArchive ? (
          <IconButton
            accessibilityLabel={`Archive ${chat.name}`}
            icon={<Archive size={16} color={colors['muted-foreground']} />}
            onPress={onArchive}
          />
        ) : null}
      </Card>
    </Touchable>
  );
}
