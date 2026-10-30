// The composer's text field (MB-01): `transcript` 16 / 1.45, grows from 1 to 8 lines then scrolls, the placeholder
// in fg-3, never blocked from typing (D-29). The caret is lifted to the caller (dictation inserts at it); a one-shot
// `selection` applies a programmatic caret move and is then released (a permanently controlled selection fights
// typing on Android). Hardware ↑ / ↓ reach `onKeyPress` for prompt history.
import React from 'react';
import { TextInput, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native';

import { useThemeColors } from '../../lib/themeColors';
import { useFontScale } from '../../platform/fontScale';

export interface ComposerFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** "Message Bug Fixer". */
  accessibilityLabel: string;
  editable?: boolean;
  /** One-shot caret to apply (then the caller clears it). */
  selection?: number | null;
  onCaretChange?: (caret: number) => void;
  onKeyPress?: (key: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onTouchStart?: () => void;
  testID?: string;
}

const LINE = 23;
const MAX_LINES = 8;

export function ComposerField({ value, onChangeText, placeholder, accessibilityLabel, editable = true, selection, onCaretChange, onKeyPress, onFocus, onBlur, onTouchStart, testID = 'composer-input' }: ComposerFieldProps): React.ReactElement {
  const colors = useThemeColors();
  const scale = Math.min(useFontScale(), 2);
  const maxHeight = Math.round(LINE * MAX_LINES * scale + 8);
  return (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.fg3}
      accessibilityLabel={accessibilityLabel}
      editable={editable}
      multiline
      scrollEnabled
      textAlignVertical="top"
      {...(selection != null ? { selection: { start: selection, end: selection } } : {})}
      onSelectionChange={(e) => onCaretChange?.(e.nativeEvent.selection.end)}
      onKeyPress={(e: NativeSyntheticEvent<TextInputKeyPressEventData>) => onKeyPress?.(e.nativeEvent.key)}
      onFocus={onFocus}
      onBlur={onBlur}
      onTouchStart={onTouchStart}
      style={{ maxHeight }}
      className="min-h-6 py-1 text-transcript text-fg"
    />
  );
}
