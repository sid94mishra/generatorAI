// The composer's primary control (MB-01; MD-03, MD-56): Send ↑ / Stop ■ / "Stopping…" (inert) / "Force reset".
// iOS draws a 36 ink circle, Android a 48 × 48 radius-16 button; both sit in a 44 / 48 hit frame (MD-91). A disabled
// Send is `bg-selected` with an fg-3 glyph, and its hint is the blocking reason.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { Icon } from '../../primitives/Icon';
import { Pressable } from '../../primitives/Pressable';
import { Spinner } from '../../primitives/Spinner';
import { Text } from '../../primitives/Text';
import type { ComposerPrimaryButtonProps } from './ComposerSurface.types';

const LABEL = { send: 'Send', stop: 'Stop', stopping: 'Stopping', force: 'Force reset' } as const;
const TEST_ID = { send: 'composer-send', stop: 'composer-stop', stopping: 'composer-stop', force: 'composer-force-reset' } as const;

export function ComposerPrimaryButton({ kind, disabled = false, disabledReason, stopLabel, onPress, onLongPress, testID }: ComposerPrimaryButtonProps): React.ReactElement {
  const inert = kind === 'stopping' || disabled;
  const filled = !inert;
  const label = kind === 'stop' && stopLabel ? stopLabel : LABEL[kind];
  return (
    <Pressable
      testID={testID ?? TEST_ID[kind]}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={inert}
      disabledReason={disabled ? disabledReason : undefined}
      feedback="scale"
      haptic={kind === 'send' ? undefined : 'warning'}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inert, busy: kind === 'stopping' }}
    >
      <View
        className={cn(
          'items-center justify-center ios:size-icon-button-sm ios:rounded-full android:size-control-lg android:rounded-card-lg',
          kind === 'force' && 'android:px-3 ios:px-3 ios:w-auto android:w-auto',
          filled ? 'bg-fg' : 'bg-selected',
        )}
      >
        {kind === 'stopping' ? (
          <Spinner size={14} tone="fg-3" />
        ) : kind === 'force' ? (
          <Text role="footnote" weight={600} tone="surface" chrome>
            Force reset
          </Text>
        ) : (
          <Icon concept={kind === 'send' ? 'send' : 'stop'} size={18} tone={filled ? 'surface' : 'fg-3'} filled={kind === 'stop'} />
        )}
      </View>
    </Pressable>
  );
}
