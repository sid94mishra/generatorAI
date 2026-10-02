// MP-40 PairingCodeInput (03 MP-40; MD-34, MD-35): 12 characters in 3 groups of 4, separated by a 12-wide "–".
// Cell width = (available − 2 × 12 − 9 × 6) / 12 clamped 22–32; height 52 (iOS) / 56 (Android). iOS raised cells,
// Android outlined. One transparent TextInput owns the keyboard (one-time-code autofill, paste fills all cells,
// backspace moves back); input is normalised before it reaches `value`. A filled code never auto-submits.
import React, { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';

import { cn } from '../../lib/cn';
import { Icon } from '../Icon';
import { Text } from '../Text';
import type { PairingCodeInputProps } from './PairingCodeInput.types';
import { PAIRING_CODE_LENGTH, normalizePairingCode, pairingCells, pairingCellWidth, spokenPairingCode } from './pairingCodeModel';

export type { PairingCodeInputProps } from './PairingCodeInput.types';

export function PairingCodeInput({ value, onChangeText, error, disabled = false, readOnly = false, onComplete, autoFocus, testID }: PairingCodeInputProps): React.ReactElement {
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState(false);
  const completed = useRef(value.length === PAIRING_CODE_LENGTH);
  const cellWidth = width > 0 ? pairingCellWidth(width) : 26;
  const code = normalizePairingCode(value);

  useEffect(() => {
    const full = code.length === PAIRING_CODE_LENGTH;
    if (full && !completed.current) onComplete?.(code);
    completed.current = full;
  }, [code, onComplete]);

  const spoken = spokenPairingCode(code);
  const label = `Pairing code, ${PAIRING_CODE_LENGTH} characters`;
  const cells = pairingCells(code).map((group, g) => (
    <React.Fragment key={g}>
      {g > 0 ? (
        <View className="w-3 items-center">
          <Text role="body" tone="fg-3">
            –
          </Text>
        </View>
      ) : null}
      <View className="flex-row gap-1.5">
        {group.map((char, i) => {
          const index = g * 4 + i;
          const current = focused && !readOnly && index === Math.min(code.length, PAIRING_CODE_LENGTH - 1);
          return (
            <View
              key={i}
              style={{ width: cellWidth }}
              className={cn(
                'items-center justify-center rounded-control ios:min-h-13 android:min-h-14',
                error ? 'border-2 border-err' : current ? 'border-2 border-accent' : 'ios:bg-raised android:border android:border-line-strong',
                disabled && 'opacity-40',
              )}
            >
              <Text role="title" weight={500} className="font-mono" tabular chrome>
                {char}
              </Text>
            </View>
          );
        })}
      </View>
    </React.Fragment>
  ));

  return (
    <View testID={testID} className="gap-2">
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        className="relative flex-row items-center justify-center"
        accessible={readOnly}
        accessibilityLabel={readOnly ? label : undefined}
        accessibilityValue={readOnly ? { text: spoken } : undefined}
      >
        <View className="flex-row items-center" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {cells}
        </View>
        {readOnly ? null : (
          <TextInput
            value={code}
            onChangeText={(raw) => onChangeText(normalizePairingCode(raw))}
            editable={!disabled}
            autoFocus={autoFocus}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            keyboardType="default"
            maxLength={PAIRING_CODE_LENGTH + 2}
            caretHidden
            contextMenuHidden={false}
            accessibilityLabel={label}
            accessibilityValue={{ text: spoken }}
            accessibilityHint={error ? `Error: ${error}` : undefined}
            className="absolute inset-0 opacity-0"
          />
        )}
      </View>
      {error ? (
        <View className="flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
          <Icon concept="status-failed" size={14} tone="err" />
          <Text role="footnote" tone="err" className="shrink">
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
