// MP-11 ChipGroup (03 MP-11): a scrolling or wrapping chip row with single / multi selection and a "+N" overflow.
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Chip } from '../Chip';
import type { ChipGroupProps } from './ChipGroup.types';

export type { ChipGroupItem, ChipGroupProps } from './ChipGroup.types';

/** Next value after pressing `id` (exported for tests). */
export function nextSelection(selection: ChipGroupProps['selection'], value: string | string[] | undefined, id: string): string | string[] {
  if (selection === 'single') return id;
  const current = Array.isArray(value) ? value : value ? [value] : [];
  return current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
}

const isSelected = (value: string | string[] | undefined, id: string): boolean =>
  Array.isArray(value) ? value.includes(id) : value === id;

export function ChipGroup({ items, selection = 'none', value, onValueChange, onItemPress, layout = 'scroll', max, accessibilityLabel, testID }: ChipGroupProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const capped = layout === 'wrap' && max !== undefined && !expanded && items.length > max;
  const shown = capped ? items.slice(0, max) : items;
  const chips = shown.map(({ id, ...chip }) => (
    <Chip
      key={id}
      {...chip}
      variant={chip.variant ?? 'filter'}
      selected={selection !== 'none' && isSelected(value, id)}
      onPress={() => {
        if (selection !== 'none') onValueChange?.(nextSelection(selection, value, id));
        onItemPress?.(id);
      }}
    />
  ));
  if (capped) {
    chips.push(<Chip key="more" label={`+${items.length - (max ?? 0)}`} variant="add" onPress={() => setExpanded(true)} />);
  }
  const role = selection === 'single' ? 'radiogroup' : 'list';
  if (layout === 'wrap') {
    return (
      <View testID={testID} accessibilityRole={role} accessibilityLabel={accessibilityLabel} className="flex-row flex-wrap gap-2">
        {chips}
      </View>
    );
  }
  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      contentContainerClassName="gap-2 px-gutter"
    >
      {chips}
    </ScrollView>
  );
}
