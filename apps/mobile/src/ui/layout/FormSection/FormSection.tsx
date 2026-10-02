// ML-22 FormSection (03 ML-22; MD-68): a titled block of fields. iOS (grouped): the title (15/600 fg) + hint over
// one inset group of row fields separated by hairlines; Android (stacked): the title (14/600 fg-2) + hint over
// outlined fields stacked with gap 16. Callers separate sections by 24.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { Separator } from '../../primitives/Separator';
import { Text } from '../../primitives/Text';
import type { FormSectionProps } from './FormSection.types';

export type { FormSectionProps } from './FormSection.types';

export function FormSection({ title, hint, children, variant, testID }: FormSectionProps): React.ReactElement {
  const android = nativePlatform === 'android';
  const mode = variant ?? (android ? 'stacked' : 'grouped');
  const fields = React.Children.toArray(children).filter(React.isValidElement);
  return (
    <View testID={testID} className="gap-2">
      <View className="gap-0.5 px-1">
        <Text role="subhead" weight={600} tone={android ? 'fg-2' : 'fg'} accessibilityRole="header">
          {title}
        </Text>
        {hint ? (
          <Text role="footnote" tone="fg-3">
            {hint}
          </Text>
        ) : null}
      </View>
      {mode === 'grouped' ? (
        <View className="overflow-hidden rounded-group bg-raised">
          {fields.map((f, i) => (
            <React.Fragment key={f.key ?? i}>
              {i > 0 ? <Separator inset={16} /> : null}
              {f}
            </React.Fragment>
          ))}
        </View>
      ) : (
        <View className={cn('gap-4 pt-1')}>{fields}</View>
      )}
    </View>
  );
}
