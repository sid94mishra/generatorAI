// MB-41 ContextUsage (MModelPicker): a row with the Gauge, "42% of context used", mono "84.2K / 200K tokens" and
// "Breakdown ›" (a sheet: system, tools, messages … and the API counters of the last turn).
import React from 'react';
import { View } from 'react-native';

import { KeyValueList } from '../../ui/layout/KeyValueList';
import { useSheet } from '../../ui/native/Sheet';
import { Gauge } from '../../ui/primitives/Gauge';
import { Icon } from '../../ui/primitives/Icon';
import { Pressable } from '../../ui/primitives/Pressable';
import { Text } from '../../ui/primitives/Text';
import type { ContextUsageView } from './contextUsageModel';

export { contextUsageView, type ContextUsageView } from './contextUsageModel';

export function ContextUsage({ view }: { view: ContextUsageView }): React.ReactElement {
  const sheet = useSheet();
  const open = (): void =>
    sheet.present(
      <View className="gap-4 px-4">
        {view.breakdown.length ? <KeyValueList items={view.breakdown.map((b) => ({ label: b.label, value: b.value, mono: true }))} /> : <Text role="footnote" tone="fg-3">No breakdown from this provider.</Text>}
        {view.api.length ? <KeyValueList items={view.api.map((a) => ({ label: a.label, value: a.value, mono: true }))} /> : null}
      </View>,
      { title: 'Context', subtitle: view.title, detents: ['medium'] },
    );
  return (
    <Pressable onPress={open} frame="none" accessibilityRole="button" accessibilityLabel={`${view.title}, ${view.tokens}`} accessibilityHint="Shows the breakdown" testID="context-usage-row" className="min-h-row flex-row items-center gap-3 rounded-card border border-line-soft px-3 py-2">
      <Gauge value={view.ratio} size={32} label={view.title} />
      <View className="flex-1">
        <Text role="subhead" weight={600}>
          {view.title}
        </Text>
        <Text role="monoSm" tone="fg-3">
          {view.tokens}
        </Text>
      </View>
      <Text role="subhead" weight={500}>
        Breakdown
      </Text>
      <Icon concept="chevron-right" size={14} tone="fg-3" />
    </Pressable>
  );
}
