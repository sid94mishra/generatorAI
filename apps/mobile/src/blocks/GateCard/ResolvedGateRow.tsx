// MB-15 ResolvedGateRow: a settled gate collapses to one line (min-h 40, `rounded-card`, 1px `border-line-soft`):
// "✓ Allowed once `git push …`", "✕ Denied", "Answered", "Approved: <plan>", or the expired words.
import React from 'react';
import { View } from 'react-native';
import type { StreamBlock } from '@generatorai/client-core';

import { Icon } from '../../ui/primitives/Icon';
import { Text } from '../../ui/primitives/Text';
import { resolvedWords } from './model/gateModel';

type GateBlock = Extract<StreamBlock, { type: 'permission' | 'question' | 'plan' }>;

export function ResolvedGateRow({ block }: { block: GateBlock }): React.ReactElement | null {
  const outcome = resolvedWords(block);
  if (!outcome) return null;
  const denied = block.type === 'permission' && block.status === 'denied';
  return (
    <View testID="gate-resolved" accessibilityRole="text" accessibilityLabel={[outcome.words, outcome.detail].filter(Boolean).join(', ')} className="min-h-item flex-row items-center gap-2 rounded-card border border-line-soft px-3 py-2">
      <Icon concept={denied ? 'status-failed' : outcome.tone === 'ok' ? 'status-succeeded' : 'clock'} size={16} tone={outcome.tone === 'ok' ? 'ok' : 'fg-3'} />
      <Text role="footnote" tone="fg-2">
        {outcome.words}
      </Text>
      {outcome.detail ? (
        <Text role="monoSm" tone="fg-3" numberOfLines={1} className="flex-1">
          {outcome.detail}
        </Text>
      ) : null}
    </View>
  );
}
