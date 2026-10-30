// MB-27 KeyRow (MD-38; MPaneTerminal): the bar of keys a phone keyboard lacks, one spec on both OSes — h48 on
// `bg-sunken`, keys `bg-selected` radius 8, mono; latched ctrl / alt draw `bg-fg text-surface` and are spoken
// "Control, latched". Scrolls sideways when the window is narrow. Hidden while a hardware keyboard is attached.
import React from 'react';
import { ScrollView } from 'react-native';

import { cn } from '../../ui/lib/cn';
import { Pressable } from '../../ui/primitives/Pressable';
import { Text } from '../../ui/primitives/Text';
import { KEY_ROW, type KeyDef } from './model/keyRow';

export interface KeyRowProps {
  ctrl: boolean;
  alt: boolean;
  onKey: (key: KeyDef) => void;
}

export function KeyRow({ ctrl, alt, onKey }: KeyRowProps): React.ReactElement {
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      accessibilityRole="toolbar"
      accessibilityLabel="Terminal keys"
      className="grow-0 bg-sunken"
      contentContainerClassName="min-h-tab items-center gap-1.5 px-2"
      testID="terminal-keys"
    >
      {KEY_ROW.map((key) => {
        const latched = (key.action === 'ctrl' && ctrl) || (key.action === 'alt' && alt);
        return (
          <Pressable
            key={key.id}
            testID={`terminal-key-${key.id}`}
            onPress={() => onKey(key)}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel={latched ? `${key.a11y}, latched` : key.a11y}
            accessibilityState={key.action === 'ctrl' || key.action === 'alt' ? { selected: latched } : undefined}
            className={cn('min-h-control min-w-11 items-center justify-center rounded-seg px-2', latched ? 'bg-fg' : 'bg-selected')}
          >
            <Text role="mono" tone={latched ? 'surface' : 'fg'} chrome>
              {key.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
