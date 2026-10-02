// Pure Input logic (03 MP-16): the TextInput props each kind implies, and the frame state.
import type { TextInputProps } from 'react-native';
import type { InputKind } from './Input.types';

export interface KindProps {
  keyboardType: TextInputProps['keyboardType'];
  autoCapitalize: TextInputProps['autoCapitalize'];
  autoCorrect: boolean;
  secure: boolean;
  mono: boolean;
  textContentType?: TextInputProps['textContentType'];
  autoComplete?: TextInputProps['autoComplete'];
}

export function kindProps(kind: InputKind): KindProps {
  switch (kind) {
    case 'secret':
      return { keyboardType: 'default', autoCapitalize: 'none', autoCorrect: false, secure: true, mono: false, textContentType: 'password', autoComplete: 'password' };
    case 'mono':
      return { keyboardType: 'default', autoCapitalize: 'none', autoCorrect: false, secure: false, mono: true };
    case 'url':
      return { keyboardType: 'url', autoCapitalize: 'none', autoCorrect: false, secure: false, mono: true, textContentType: 'URL', autoComplete: 'url' };
    case 'email':
      return { keyboardType: 'email-address', autoCapitalize: 'none', autoCorrect: false, secure: false, mono: false, textContentType: 'emailAddress', autoComplete: 'email' };
    case 'number':
      return { keyboardType: 'number-pad', autoCapitalize: 'none', autoCorrect: false, secure: false, mono: true };
    case 'text':
      return { keyboardType: 'default', autoCapitalize: 'sentences', autoCorrect: true, secure: false, mono: false };
  }
}

export type FrameState = 'idle' | 'focused' | 'error' | 'disabled';

export function frameState({ focused, error, disabled }: { focused: boolean; error?: string; disabled?: boolean }): FrameState {
  if (disabled) return 'disabled';
  if (error) return 'error';
  return focused ? 'focused' : 'idle';
}

/** The Android floating label sits on the outline when focused or filled. */
export function labelFloats(focused: boolean, value: string): boolean {
  return focused || value.length > 0;
}

/** Accessibility value: never speak a secret. */
export function spokenValue(kind: InputKind, value: string, revealed: boolean): string | undefined {
  if (!value) return undefined;
  if (kind === 'secret' && !revealed) return `${value.length} characters, hidden`;
  return value;
}

/**
 * Where an Android floating label sits for its measured height: centred on the outline, and the field's top padding
 * grows by whatever of the label reaches into it beyond 8 dp, so a label at a large text size never covers the value
 * (device review). At the default size the padding is 0.
 */
export function floatingLabelGeometry(labelHeight: number): { top: number; padTop: number } {
  const half = Math.round(Math.max(0, labelHeight) / 2);
  return { top: -half, padTop: Math.max(0, half - 8) };
}
