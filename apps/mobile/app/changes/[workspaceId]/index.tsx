// ────────────────────────────────────────────────────────────────
// /changes/[workspaceId] — the Changes surface, as a route.
//
// A thin wrapper (D20): the pane component owns the list, the diff, the
// review and checkpoint sheets and the commit bar. `chatId` is optional
// here — arriving from a run or a deep link there may be no chat to send a
// review to, and the pane says so instead of offering a dead button.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { ChangesSection } from '../../../src/components/chat/workbench/ChangesSection';

export default function ChangesScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ workspaceId: string; chatId?: string; path?: string }>();
  const workspaceId = String(params.workspaceId);
  const chatId = params.chatId ? String(params.chatId) : null;

  return (
    <View className="flex-1 bg-background">
      <ChangesSection
        workspaceId={workspaceId}
        chatId={chatId}
        focusPath={params.path ? String(params.path) : null}
        onOpenFile={(path, alias) =>
          router.push({
            pathname: '/changes/[workspaceId]/file',
            params: { workspaceId, path, alias: alias ?? '.', ...(chatId ? { chatId } : {}) },
          })
        }
      />
    </View>
  );
}
