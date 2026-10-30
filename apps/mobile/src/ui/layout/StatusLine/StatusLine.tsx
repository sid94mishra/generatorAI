// ML-04 StatusLine (03 ML-04; MD-25, MD-67): one StatusBadge md (+ mono meta) directly under the header — iOS
// centred, padding 2 16 8; Android start-aligned at 56 with the title. Never tints the bar. Polite live region, so
// a change to "Needs you" is announced.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { StatusBadge } from '../../primitives/StatusBadge';
import { Text } from '../../primitives/Text';
import type { StatusLineProps } from './StatusLine.types';

export type { StatusLineProps } from './StatusLine.types';

export function StatusLine({ status, meta, testID }: StatusLineProps): React.ReactElement {
  const android = nativePlatform === 'android';
  return (
    <View testID={testID} accessibilityLiveRegion="polite" className={cn('flex-row flex-wrap items-center gap-2', android ? 'pb-2 pe-4 ps-14' : 'justify-center px-4 pb-2 pt-0.5')}>
      <StatusBadge {...status} size="md" />
      {(meta ?? []).map((m, i) =>
        typeof m === 'string' ? (
          <Text key={i} role="monoSm" tone="fg-3" chrome>
            {`· ${m}`}
          </Text>
        ) : (
          <React.Fragment key={i}>{m}</React.Fragment>
        ),
      )}
    </View>
  );
}
