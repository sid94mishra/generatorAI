// ────────────────────────────────────────────────────────────────
// QuickActions — three big targets at the end of Home.
//
//   New chat      → the Chats tab with `?new=1`, which opens the SAME
//                   NewChatSheet the Chats FAB opens. No second creation
//                   flow to drift.
//   New workflow  → the Work tab on its Workflows segment with `?new=1`,
//                   which opens that segment's "New" sheet (an honest
//                   placeholder until authoring lands).
//   Pair a device → Settings › Security.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { MessageSquarePlus, Smartphone, Workflow } from 'lucide-react-native';

import { Card } from '../ui/primitives';
import { Touchable } from '../ui/Touchable';
import { MAX_SCALE } from '../ui/accessibility';
import { useTheme } from '../../theme/ThemeProvider';

export function QuickActions(): React.ReactElement {
  const { colors } = useTheme();
  const actions = [
    {
      key: 'chat',
      label: 'New chat',
      icon: <MessageSquarePlus size={18} color={colors.primary} />,
      onPress: () => router.push('/chats?new=1'),
    },
    {
      key: 'workflow',
      label: 'New workflow',
      icon: <Workflow size={18} color={colors.primary} />,
      onPress: () => router.push('/runs?segment=workflows&new=1' as never),
    },
    {
      key: 'pair',
      label: 'Pair a device',
      icon: <Smartphone size={18} color={colors.primary} />,
      onPress: () => router.push('/settings/security'),
    },
  ];

  return (
    <View className="flex-row gap-2.5">
      {actions.map((action) => (
        <Touchable
          key={action.key}
          accessibilityLabel={action.label}
          haptic="tap"
          scale="large"
          onPress={action.onPress}
          className="flex-1"
        >
          <Card className="min-h-20 items-center justify-center gap-1.5 p-3">
            <View className="h-9 w-9 items-center justify-center rounded-2xl bg-accent">{action.icon}</View>
            <Text
              numberOfLines={2}
              maxFontSizeMultiplier={MAX_SCALE.chrome}
              className="text-center text-xs font-medium text-foreground"
            >
              {action.label}
            </Text>
          </Card>
        </Touchable>
      ))}
    </View>
  );
}
