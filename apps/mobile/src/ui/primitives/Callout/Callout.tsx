// MP-45 Callout (+ Banner) (03 MP-45; MD-25): a state message — info (bg-selected, info glyph), warn (warn-bg, warning
// glyph in warn), err (err-bg, failed glyph in err), ok (ok-bg, succeeded glyph in ok). Card: rounded-card, padding
// 12 14, glyph 16 + 600 title + footnote body + an optional link action. Banner: one line, min 40. warn / err are
// alerts for assistive tech.
import React from 'react';
import { View } from 'react-native';
import type { MobileIconConcept } from '@generatorai/design-tokens';

import { cn } from '../../lib/cn';
import type { IconTone } from '../Icon/Icon.types';
import { Icon } from '../Icon';
import { Link } from '../Link';
import { Text } from '../Text';
import type { CalloutProps, CalloutTone } from './Callout.types';

export type { CalloutProps, CalloutTone } from './Callout.types';

export const CALLOUT_TONES: Record<CalloutTone, { surface: string; icon: MobileIconConcept; tone: IconTone }> = {
  info: { surface: 'bg-selected', icon: 'info', tone: 'fg-2' },
  warn: { surface: 'bg-warn-bg', icon: 'warning', tone: 'warn' },
  err: { surface: 'bg-err-bg', icon: 'status-failed', tone: 'err' },
  ok: { surface: 'bg-ok-bg', icon: 'status-succeeded', tone: 'ok' },
};

export function Callout({ tone, title, body, action, form = 'card', testID }: CalloutProps): React.ReactElement {
  const t = CALLOUT_TONES[tone];
  const alert = tone === 'warn' || tone === 'err';
  if (form === 'banner') {
    return (
      <View testID={testID} accessibilityRole={alert ? 'alert' : undefined} className={cn('min-h-10 flex-row items-center gap-2 pe-2 ps-4', t.surface)}>
        <Icon concept={t.icon} size={16} tone={t.tone} />
        <Text role="footnote" weight={600} numberOfLines={1} className="flex-1">
          {title}
        </Text>
        {action ? <Link label={action.label} onPress={action.onPress} standalone /> : null}
      </View>
    );
  }
  return (
    <View testID={testID} accessibilityRole={alert ? 'alert' : undefined} className={cn('flex-row gap-2.5 rounded-card px-3.5 py-3', t.surface)}>
      <View className="pt-0.5">
        <Icon concept={t.icon} size={16} tone={t.tone} />
      </View>
      <View className="flex-1 gap-1">
        <Text role="subhead" weight={600}>
          {title}
        </Text>
        {body ? (
          <Text role="footnote" tone="fg-2">
            {body}
          </Text>
        ) : null}
        {action ? (
          <View className="-ms-2 self-start">
            <Link label={action.label} onPress={action.onPress} standalone />
          </View>
        ) : null}
      </View>
    </View>
  );
}
