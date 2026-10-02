// ML-29 KeyboardStickyBar (03 ML-29): content that rides on the keyboard (composer, terminal key row, wizard bars,
// inline editors) through react-native-keyboard-controller's KeyboardStickyView: lifted by the bottom safe area while
// the keyboard is closed, flush on the keyboard while it is open. Optionally hidden with a hardware keyboard.
import React from 'react';

import { KeyboardStickyView } from '../../lib/styled';
import { useInsets } from '../../platform/insets';
import { useHardwareKeyboard } from '../../platform/keyboard';
import type { KeyboardStickyBarProps } from './KeyboardStickyBar.types';

export type { KeyboardStickyBarProps } from './KeyboardStickyBar.types';

/** keyboard-controller offsets: translateY −bottom inset when closed, 0 when open (exported for tests). */
export function stickyOffsets(bottomInset: number): { closed: number; opened: number } {
  return { closed: -bottomInset, opened: 0 };
}

export function KeyboardStickyBar({ children, hideOnHardwareKeyboard = false, testID }: KeyboardStickyBarProps): React.ReactElement | null {
  const insets = useInsets();
  const hardware = useHardwareKeyboard();
  if (hideOnHardwareKeyboard && hardware) return null;
  return (
    <KeyboardStickyView testID={testID} offset={stickyOffsets(insets.bottom)}>
      {children}
    </KeyboardStickyView>
  );
}
