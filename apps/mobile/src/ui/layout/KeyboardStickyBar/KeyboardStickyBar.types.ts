// ML-29 KeyboardStickyBar contract (03 ML-29).
import type { ReactNode } from 'react';

export interface KeyboardStickyBarProps {
  children: ReactNode;
  /** Hide while a hardware keyboard is attached (iPad, Android tablets). */
  hideOnHardwareKeyboard?: boolean;
  testID?: string;
}
