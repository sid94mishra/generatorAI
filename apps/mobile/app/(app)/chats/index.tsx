// Chats (MChats) → features/chats/ChatsListScreen (M6-01). Until the New chat route sheet lands (`/chats/new`,
// M6-05) this route still hosts the legacy creation sheet, opened by the list's NewAction and by `?new=1`
// (Home, the drawer, the palette and the `/chats/new` link, MD-145).
import React, { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { chatHref } from '../../../src/blocks/shell/hrefs';
import { ChatsListScreen } from '../../../src/features/chats/ChatsListScreen';
import { useCreateChat } from '../../../src/features/chats/queries';
import { useSelectableAgents } from '../../../src/features/agents/queries';
import { useProjects } from '../../../src/features/projects/queries';
import { useModels } from '../../../src/services/api/useModels';
import { NewChatSheet } from '../../../src/components/chat/NewChatSheet';

export default function ChatsRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ new?: string }>();
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (params.new !== '1') return;
    setCreating(true);
    router.setParams({ new: undefined });
  }, [params.new]);
  const models = useModels();
  const projects = useProjects();
  const agents = useSelectableAgents();
  const create = useCreateChat({
    onSuccess: (chat) => {
      setCreating(false);
      router.push(chatHref(chat.id) as never);
    },
  });
  return (
    <>
      <ChatsListScreen onNewChat={() => setCreating(true)} />
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
    </>
  );
}
