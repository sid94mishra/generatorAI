// ML-28 SearchHeader (03 ML-28; MSearch; MD-46, MD-81): the search palette's header — the field is the header.
// iOS: no nav bar; the palette-size SearchInput (h44, rounded, bg-selected) beside a glass 44 "Close search" ✕, the
// result count under it. Android: the M3 full-screen search view header — ← back 48, the query at 18, clear ✕ 48,
// a 1 dp line under it. The window's top inset is paid here (the palette is a full-screen modal).
import React, { useEffect } from 'react';
import { AccessibilityInfo, TextInput, View } from 'react-native';

import { useThemeColors } from '../../lib/themeColors';
import { nativePlatform } from '../../platform/geometry';
import { useWindowInsets } from '../../platform/insets';
import { IconButton } from '../../primitives/IconButton';
import { SearchInput } from '../../primitives/SearchInput';
import { Spinner } from '../../primitives/Spinner';
import { Text } from '../../primitives/Text';
import type { SearchHeaderProps } from './SearchHeader.types';
import { resultCountLabel } from './searchHeaderModel';

export type { SearchHeaderProps } from './SearchHeader.types';

export function SearchHeader({ value, onChangeText, placeholder, onClose, onSubmit, resultCount, loading = false, testID }: SearchHeaderProps): React.ReactElement {
  const insets = useWindowInsets();
  const colors = useThemeColors();
  const count = resultCount !== undefined && value.trim() ? resultCountLabel(resultCount) : null;
  useEffect(() => {
    if (count) AccessibilityInfo.announceForAccessibility(count);
  }, [count]);

  if (nativePlatform === 'android') {
    return (
      <View testID={testID} className="border-b border-line-soft" style={{ paddingTop: insets.top }}>
        <View className="min-h-bar flex-row items-center gap-1 px-1">
          <IconButton icon="back" label="Close search" onPress={onClose} testID="search-close" />
          <TextInput
            testID="search-input"
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.fg3}
            selectionColor={colors.accent}
            cursorColor={colors.accent}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            accessibilityLabel={placeholder}
            className="min-h-item flex-1 py-0 font-sans text-detail-title text-fg"
          />
          {loading ? <Spinner size={16} tone="fg-3" label="Searching" /> : null}
          {value ? <IconButton icon="x" label="Clear search" onPress={() => onChangeText('')} /> : null}
        </View>
        {count ? (
          <Text role="footnote" tone="fg-3" className="px-4 pb-2">
            {count}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View testID={testID} className="gap-1 px-4 pb-2" style={{ paddingTop: insets.top + 8 }}>
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <SearchInput value={value} onChangeText={onChangeText} placeholder={placeholder} onSubmit={onSubmit} loading={loading} autoFocus testID="search-input" />
        </View>
        <IconButton icon="x" label="Close search" variant="glass" onPress={onClose} testID="search-close" />
      </View>
      {count ? (
        <Text role="footnote" tone="fg-3" className="px-1">
          {count}
        </Text>
      ) : null}
    </View>
  );
}
