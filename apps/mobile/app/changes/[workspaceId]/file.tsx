// ────────────────────────────────────────────────────────────────
// /changes/[workspaceId]/file — one file's diff, full screen.
//
// A thin wrapper over the same pane the workbench uses (D20), with the
// detail controlled by the route params so Back returns to the list.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { ChangesSection } from '../../../src/components/chat/workbench/ChangesSection';

export default function FileDiffScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ workspaceId: string; path: string; alias?: string; chatId?: string }>();
  const workspaceId = String(params.workspaceId);
  const path = String(params.path);
  const alias = params.alias ? String(params.alias) : '.';

  return (
    <View className="flex-1 bg-background">
      <ChangesSection
        workspaceId={workspaceId}
        chatId={params.chatId ? String(params.chatId) : null}
        detail={{ path, alias }}
      />
    </View>
  );
}
