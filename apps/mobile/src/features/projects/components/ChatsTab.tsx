// Project › Chats (G-14): the project's chats as MB-48 ChatRows (live state from the attention feed), newest activity
// first, and "New chat" in this project.
import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { ChatRow, useChatRowActions } from '../../../blocks/ChatRow';
import { NEW_CHAT_HREF, chatHref } from '../../../blocks/shell/hrefs';
import { ListSection } from '../../../ui/layout/ListSection';
import { Button } from '../../../ui/primitives/Button';
import { EmptyState } from '../../../ui/primitives/EmptyState';
import { ErrorState } from '../../../ui/primitives/ErrorState';
import { Skeleton } from '../../../ui/primitives/Skeleton';
import { useProjectChats } from '../queries';

type Href = Parameters<typeof router.push>[0];

export function ChatsTab({ projectId }: { projectId: string }): React.ReactElement {
  const chats = useProjectChats(projectId, true);
  const run = useChatRowActions({ onOpen: (row) => router.push(chatHref(row.id) as Href) });
  const newChat = (): void => router.push(`${NEW_CHAT_HREF}?project=${encodeURIComponent(projectId)}` as Href);
  if (chats.isLoading) return <Skeleton preset="list" count={4} />;
  if (chats.isError) return <ErrorState title="Couldn't load chats" error={chats.error} onRetry={() => void chats.refetch()} />;
  return (
    <View className="gap-3">
      <View className="flex-row justify-end px-4">
        <Button label="New chat" icon="edit" size="sm" onPress={newChat} testID="project-new-chat" />
      </View>
      {chats.rows.length === 0 ? (
        <EmptyState copyKey="chats" />
      ) : (
        <ListSection>
          {chats.rows.map((row, i) => (
            <ChatRow key={row.id} row={row} onAction={run} swipe={false} position={chats.rows.length === 1 ? 'only' : i === 0 ? 'first' : i === chats.rows.length - 1 ? 'last' : 'middle'} />
          ))}
        </ListSection>
      )}
    </View>
  );
}
