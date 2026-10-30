// ML-24 FactStrip (03 ML-24): a raised strip (rounded-card, padding 12 0) of 2–4 columns divided by hairlines; each
// a value (StatusBadge or mono / body text) over a caption fg-3 label ("Failed · 1 Exit code · 48.2s Duration").
import React from 'react';
import { View } from 'react-native';

import { Separator } from '../../primitives/Separator';
import { Text } from '../../primitives/Text';
import type { FactStripProps } from './FactStrip.types';

export type { Fact, FactStripProps } from './FactStrip.types';

export function FactStrip({ facts, testID }: FactStripProps): React.ReactElement {
  return (
    <View testID={testID} className="flex-row rounded-card bg-raised py-3">
      {facts.map((f, i) => (
        <React.Fragment key={`${f.label}-${i}`}>
          {i > 0 ? <Separator orientation="vertical" /> : null}
          <View accessibilityRole={typeof f.value === 'string' ? 'text' : undefined} className="flex-1 items-center gap-1 px-2" accessible={typeof f.value === 'string'} accessibilityLabel={typeof f.value === 'string' ? `${f.label}, ${f.value}` : undefined}>
            {typeof f.value === 'string' ? (
              <Text role={f.mono ? 'monoLg' : 'body'} weight={500} numberOfLines={1} chrome>
                {f.value}
              </Text>
            ) : (
              f.value
            )}
            <Text role="caption" tone="fg-3" align="center" numberOfLines={1}>
              {f.label}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}
