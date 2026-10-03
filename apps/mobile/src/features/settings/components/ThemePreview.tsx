// MSetAppearance theme card and accent swatch: each paints inside a preview ThemeProvider (persist={false} →
// Uniwind ScopedTheme + ScopedVariables, MD-123), so the miniature uses the same vocabulary classes as the app and
// shows the theme in the CURRENT mode with the live accent (MDF-117) — no literal colours.
import React from 'react';
import { View } from 'react-native';
import type { Appearance, ThemeDef } from '@generatorai/design-tokens';

import { ThemeProvider } from '../../../theme/ThemeProvider';
import { cn } from '../../../ui/lib/cn';
import { Icon } from '../../../ui/primitives/Icon';
import { Pressable } from '../../../ui/primitives/Pressable';
import { Text } from '../../../ui/primitives/Text';

/** The app chrome in miniature: a sidebar, two text lines, the status dots and an accent button. */
function Miniature(): React.ReactElement {
  return (
    <View className="h-16 flex-row overflow-hidden rounded-control-sm bg-surface">
      <View className="w-6 gap-1 bg-sunken p-1.5">
        <View className="h-0.5 rounded-full bg-fg-3" />
        <View className="h-0.5 rounded-full bg-fg-3" />
        <View className="h-0.5 rounded-full bg-fg-3" />
      </View>
      <View className="flex-1 justify-between p-1.5">
        <View className="gap-1">
          <View className="h-0.5 w-3/4 rounded-full bg-fg" />
          <View className="h-0.5 w-full rounded-full bg-fg-3" />
          <View className="h-0.5 w-1/2 rounded-full bg-fg-3" />
        </View>
        <View className="flex-row items-center gap-0.5">
          <View className="size-1 rounded-full bg-ok" />
          <View className="size-1 rounded-full bg-warn" />
          <View className="size-1 rounded-full bg-err" />
          <View className="flex-1" />
          <View className="h-1.5 w-4 rounded-full bg-accent" />
        </View>
      </View>
    </View>
  );
}

export interface ThemeCardProps {
  theme: ThemeDef;
  appearance: Appearance;
  /** The live accent ('system' previews with the theme's default). */
  accent: string;
  selected: boolean;
  onPress: () => void;
}

export function ThemeCard({ theme, appearance, accent, selected, onPress }: ThemeCardProps): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      frame="none"
      haptic="selection"
      accessibilityRole="radio"
      accessibilityLabel={`${theme.label} theme`}
      accessibilityState={{ checked: selected }}
      className={cn('flex-1 gap-1.5 rounded-card border bg-raised p-1.5', selected ? 'border-2 border-fg' : 'border-line')}
      testID={`theme-option-${theme.id}`}
    >
      <ThemeProvider persist={false} initialTheme={theme.id} initialMode={appearance} initialAccent={accent === 'system' ? theme.defaultAccent : accent}>
        <Miniature />
      </ThemeProvider>
      <View className="flex-row items-center gap-1 px-0.5">
        <Text role="footnote" weight={500} numberOfLines={1} className="flex-1">
          {theme.label}
        </Text>
        {selected ? <Icon concept="check" size={14} tone="fg" /> : null}
      </View>
    </Pressable>
  );
}

export interface AccentSwatchProps {
  themeId: string;
  appearance: Appearance;
  accent: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

/** One accent dot (MD-28: 44 / 48 target); the selected one carries a ring. */
export function AccentSwatch({ themeId, appearance, accent, label, selected, onPress, testID }: AccentSwatchProps): React.ReactElement {
  return (
    <Pressable onPress={onPress} haptic="selection" accessibilityRole="radio" accessibilityLabel={`${label} accent`} accessibilityState={{ checked: selected }} borderless testID={testID ?? `accent-option-${accent}`}>
      <View className={cn('size-10 items-center justify-center rounded-full border-2', selected ? 'border-fg' : 'border-line-soft')}>
        <ThemeProvider persist={false} initialTheme={themeId} initialMode={appearance} initialAccent={accent}>
          <View className="size-7 items-center justify-center rounded-full bg-accent">{selected ? <Icon concept="check" size={14} tone="on-accent" /> : null}</View>
        </ThemeProvider>
      </View>
    </Pressable>
  );
}
