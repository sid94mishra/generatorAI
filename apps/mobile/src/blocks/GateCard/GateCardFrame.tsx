// MB-15 GateCardFrame (MD-50): every gate draws in one shell — 1px `border-line`, `rounded-card-lg` (20 / 16),
// `bg-raised`; the header on `bg-warn-bg` with the `hand` glyph (the one status tint MD-25 allows), the title and
// an end meta (category "Network", a pager "1 / 3"); then the body. Expired gates draw a neutral header. The card is
// one group named "Needs you: <title>" (MB-15 a11y); `gate-card` stays its testID (the Maestro flows select it).
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../ui/lib/cn';
import { Icon } from '../../ui/primitives/Icon';
import { Text } from '../../ui/primitives/Text';

export interface GateCardFrameProps {
  title: string;
  meta?: string | null;
  /** A neutral Badge after the meta ("Risky"). */
  badge?: React.ReactElement | null;
  expired?: boolean;
  children: React.ReactNode;
  testID?: string;
}

export function GateCardFrame({ title, meta, badge, expired = false, children, testID = 'gate-card' }: GateCardFrameProps): React.ReactElement {
  return (
    <View testID={testID} accessibilityRole="summary" accessibilityLabel={expired ? title : `Needs you: ${title}`} className="overflow-hidden rounded-card-lg border border-line bg-raised">
      <View className={cn('min-h-item flex-row items-center gap-2 px-3.5 py-2', expired ? 'bg-sunken' : 'bg-warn-bg')}>
        <Icon concept={expired ? 'clock' : 'hand'} size={16} tone={expired ? 'fg-3' : 'warn'} />
        <Text role="subhead" weight={600} numberOfLines={2} className="flex-1">
          {title}
        </Text>
        {badge ?? null}
        {meta ? (
          <Text role="caption" tone="fg-3" chrome>
            {meta}
          </Text>
        ) : null}
      </View>
      <View className="gap-3 px-3.5 py-3">{children}</View>
    </View>
  );
}
