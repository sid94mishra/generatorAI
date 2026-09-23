// The header button that opens the workbench index. Its badge is the one
// piece of tool state visible from the conversation: a count when files have
// changed, a dot when something is live, amber when a tool needs the person.

import React from 'react';
import { Text, View } from 'react-native';
import { PanelRight } from 'lucide-react-native';

import { IconButton } from '../ui/Button';
import { MAX_SCALE } from '../ui/accessibility';
import { useTheme } from '../../theme/ThemeProvider';
import type { workbenchBadge } from './workbenchModel';

export function WorkbenchButton({
  badge,
  onPress,
  selected = false,
}: {
  badge: ReturnType<typeof workbenchBadge>;
  onPress: () => void;
  selected?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const label =
    badge?.kind === 'count'
      ? `Workbench, ${badge.count} changed ${badge.count === 1 ? 'file' : 'files'}`
      : badge?.kind === 'attention'
        ? 'Workbench, something needs you'
        : badge?.kind === 'live'
          ? 'Workbench, a tool is running'
          : 'Workbench';
  return (
    <View>
      <IconButton
        testID="workbench-button"
        accessibilityLabel={label}
        accessibilityHint="Opens changes, files, terminal, browser and the other session tools"
        selected={selected}
        icon={<PanelRight size={21} color={colors.foreground} />}
        onPress={onPress}
      />
      {badge?.kind === 'count' ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute right-0 top-0.5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-primary px-1"
          style={{ height: 20 }}
        >
          <Text
            maxFontSizeMultiplier={MAX_SCALE.chrome}
            className="text-xs font-bold text-primary-foreground"
            style={{ lineHeight: 14 }}
          >
            {(badge.count ?? 0) > 99 ? '99+' : badge.count}
          </Text>
        </View>
      ) : badge ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background"
          style={{ backgroundColor: badge.kind === 'attention' ? colors.warning : colors.success }}
        />
      ) : null}
    </View>
  );
}
