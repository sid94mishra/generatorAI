// New chat (MNewChat, MNewChatMore; `/chats/new?project=&agent=`, a route sheet at the large detent, MD-21): MB-06
// over the route. A created chat replaces the sheet with its screen; if the first message could not be sent the
// chat still exists and says so.
import React from 'react';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';

import { NewChatSheet } from '../../blocks/NewChatSheet';
import { CHATS_HREF, chatHref } from '../../blocks/shell/hrefs';
import { toast } from '../../ui/primitives/Toast';

type Href = Parameters<typeof router.replace>[0];

export default function NewChatScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ project?: string; agent?: string }>();
  const navigation = useNavigation();
  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(CHATS_HREF as Href);
  };
  return (
    <NewChatSheet
      seed={{ ...(params.project ? { projectId: params.project } : {}), ...(params.agent ? { agentRef: params.agent } : {}) }}
      navigation={navigation as never}
      onClose={close}
      onCreated={(id, sent) => {
        router.replace(chatHref(id) as Href);
        if (!sent) toast({ kind: 'error', message: "The chat was created, but its first message didn't send. Send it again from the chat." });
      }}
    />
  );
}
