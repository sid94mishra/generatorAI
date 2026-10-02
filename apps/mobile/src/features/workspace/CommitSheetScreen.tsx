// Commit & pull request (MPaneCommit / MPaneCommitDone; `/workspaces/[workspaceId]/commit?alias=&chat=`) → MB-23 over
// the chat, closed with Back.
import React from 'react';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';

import { CommitSheet } from '../../blocks/CommitSheet';
import { chatHref, settingsHref } from '../../blocks/shell/hrefs';

export default function CommitSheetScreen(): React.ReactElement {
  const { workspaceId, alias, chat } = useLocalSearchParams<{ workspaceId: string; alias?: string; chat?: string }>();
  const navigation = useNavigation();
  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace((chat ? chatHref(chat) : '/') as never);
  };
  return (
    <CommitSheet
      workspaceId={workspaceId ?? ''}
      alias={alias ?? null}
      chatId={chat ?? null}
      onClose={close}
      onOpenSourceControl={() => router.push(settingsHref('source-control') as never)}
      navigation={navigation as never}
    />
  );
}
