// The button that opens the navigation drawer. It leads every top-level
// screen's header (and the chat's), where a Back chevron would otherwise sit.

import React from 'react';
import { View } from 'react-native';
import { Menu } from 'lucide-react-native';

import { IconButton } from '../../components/ui/Button';
import { useTheme } from '../../theme/ThemeProvider';
import { needsYouCount, useActivity } from '../../features/home/queries';
import { useShellStore } from './shellStore';

export function MenuButton({ attention: attentionProp }: { attention?: number }): React.ReactElement {
  const { legacyColors: colors } = useTheme();
  const open = useShellStore((s) => s.openDrawer);
  const { operations } = useActivity();
  const attention = attentionProp ?? needsYouCount(operations);
  return (
    <View>
      <IconButton
        testID="menu-button"
        accessibilityLabel={attention > 0 ? `Menu, ${attention} waiting for you` : 'Menu'}
        accessibilityHint="Opens navigation and recent chats"
        icon={<Menu size={22} color={colors.foreground} />}
        onPress={open}
      />
      {attention > 0 ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-warning"
        />
      ) : null}
    </View>
  );
}
