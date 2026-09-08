// ────────────────────────────────────────────────────────────────
// Hunk header — `@@ -a,b +c,d @@ section`.
//
// Sticky at the top of the list while its lines scroll under it, and a tap
// folds the hunk: on a phone a 600-line hunk of generated code is something
// to skip, not something to scroll through.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { headerHeightFor } from './diffModel';
import type { HunkRowModel } from './diffModel';

export const HunkHeader = React.memo(function HunkHeader({
  row,
  fontSize,
  onToggle,
}: {
  row: HunkRowModel;
  fontSize: number;
  onToggle?: (hunkIndex: number) => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const height = headerHeightFor(fontSize);
  const Icon = row.collapsed ? ChevronRight : ChevronDown;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.collapsed ? `Expand hunk ${row.label}` : `Collapse hunk ${row.label}`}
      accessibilityState={{ expanded: !row.collapsed }}
      onPress={onToggle ? () => onToggle(row.hunkIndex) : undefined}
      disabled={!onToggle}
      style={{ height, backgroundColor: colors.subtle }}
      className="flex-row items-center gap-1.5 border-y border-border-muted px-2"
    >
      {onToggle ? <Icon size={12} color={colors['muted-foreground']} /> : null}
      <Text
        numberOfLines={1}
        className="flex-1 font-mono text-info"
        style={{ fontSize: fontSize - 1, lineHeight: height - 10 }}
      >
        {row.label}
      </Text>
      {row.collapsed ? (
        <View className="rounded-full bg-emphasis px-1.5">
          <Text className="text-muted-foreground" style={{ fontSize: fontSize - 2 }}>
            {row.hiddenCount} hidden
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});
