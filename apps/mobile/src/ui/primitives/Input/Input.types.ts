// MP-16 Input contract (03 MP-16). One contract for Input.ios.tsx (row / standalone) and Input.android.tsx (M3 outlined).
import type { ReactNode } from 'react';
import type { TextInputProps } from 'react-native';
import type { MobileIconConcept } from '@generatorai/design-tokens';

export type InputKind = 'text' | 'secret' | 'mono' | 'url' | 'email' | 'number';

export interface InputProps {
  /** Visible (iOS row label / standalone label above, Android floating label) and the accessible name. */
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  /** iOS only: 'row' inside a ListSection group (default) or 'standalone'. Android is always outlined. */
  presentation?: 'row' | 'standalone';
  /** Default 'text'. */
  kind?: InputKind;
  leadingIcon?: MobileIconConcept;
  /** Unit, status ("● Reachable"), small button. */
  trailing?: ReactNode;
  /** Error styling; the message itself is rendered by Field (MP-19). */
  error?: string;
  disabled?: boolean;
  /** Selectable, no keyboard. */
  readOnly?: boolean;
  autoFocus?: boolean;
  returnKeyType?: 'done' | 'next' | 'go' | 'search' | 'send';
  onSubmitEditing?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  textContentType?: TextInputProps['textContentType'];
  autoComplete?: TextInputProps['autoComplete'];
  maxLength?: number;
  testID?: string;
}
