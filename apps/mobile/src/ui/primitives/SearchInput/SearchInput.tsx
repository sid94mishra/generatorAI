// MP-17 SearchInput (03 MP-17; MD-46). One field per platform, differences carried by platform classes (MD-115):
// iOS h-search 44 (top level and compact), rounded-full, bg-selected, glyph 18, body text, clear glyph 20 in a 44
// frame. Android top level = the M3 search bar (h56, bg-raised, glyph 22); compact h48, bg-selected. Button mode
// (drawer): iOS rounded-field sunken with a line-soft edge, Android radius 20.
import React from 'react';
import { TextInput, View } from 'react-native';

import { cn } from '../../lib/cn';
import { useThemeColors } from '../../lib/themeColors';
import { nativePlatform } from '../../platform/geometry';
import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import { Spinner } from '../Spinner';
import { Text } from '../Text';
import type { SearchInputProps } from './SearchInput.types';

export type { SearchInputProps } from './SearchInput.types';

/** The field surface for a size / mode (exported for tests). */
export function searchSurface(size: 'bar' | 'compact', asButton: boolean): string {
  if (asButton) return 'min-h-search-sm ios:rounded-field ios:border ios:border-line-soft ios:bg-sunken android:rounded-seg android:bg-selected';
  if (size === 'compact') return 'min-h-search-sm rounded-full bg-selected';
  return 'min-h-search rounded-full ios:bg-selected android:bg-raised';
}

/** Which trailing control shows (exported for tests). */
export function searchTrailing({ value, loading, mic }: Pick<SearchInputProps, 'value' | 'loading' | 'mic'>): 'spinner' | 'clear' | 'mic' | null {
  if (loading) return 'spinner';
  if (value.length > 0) return 'clear';
  return mic ? 'mic' : null;
}

export function SearchInput({
  value,
  onChangeText,
  placeholder,
  size = 'bar',
  asButton = false,
  onPress,
  onSubmit,
  mic = false,
  onMicPress,
  autoFocus,
  loading = false,
  testID,
}: SearchInputProps): React.ReactElement {
  const colors = useThemeColors();
  const glyph = nativePlatform === 'android' && size === 'bar' ? 22 : 18;
  const surface = cn('flex-row items-center gap-2 ps-3 pe-1 android:ps-4', searchSurface(size, asButton));

  if (asButton) {
    return (
      <Pressable testID={testID} onPress={onPress} frame="none" accessibilityRole="search" accessibilityLabel={placeholder} accessibilityHint="Opens search" className={surface}>
        <Icon concept="search" size={18} tone="fg-3" />
        <Text role="subhead" tone="fg-3" numberOfLines={1} className="flex-1">
          {placeholder}
        </Text>
      </Pressable>
    );
  }

  const trailing = searchTrailing({ value, loading, mic });
  return (
    <View className={surface} accessibilityRole="search">
      <Icon concept="search" size={glyph} tone="fg-3" />
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.fg3}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        accessibilityLabel={placeholder}
        className="min-h-search-sm flex-1 py-0 font-sans text-body text-fg"
      />
      {trailing === 'spinner' ? (
        <View className="size-hit items-center justify-center">
          <Spinner size={16} tone="fg-3" label="Searching" />
        </View>
      ) : null}
      {trailing === 'clear' ? (
        <Pressable onPress={() => onChangeText('')} accessibilityRole="button" accessibilityLabel="Clear search" feedback="none" borderless>
          <View className="size-5 items-center justify-center rounded-full ios:bg-fg-3">
            <Icon concept="x" size={nativePlatform === 'android' ? 22 : 12} tone={nativePlatform === 'android' ? 'fg-2' : 'surface'} />
          </View>
        </Pressable>
      ) : null}
      {trailing === 'mic' ? (
        <Pressable onPress={onMicPress} accessibilityRole="button" accessibilityLabel="Dictate" feedback="none" borderless>
          <Icon concept="mic" size={glyph} tone="fg-2" />
        </Pressable>
      ) : null}
    </View>
  );
}
