// MP-19 Field contract (03 MP-19).
import type { ReactElement, ReactNode } from 'react';

export interface FieldProps {
  /** Shown above the control when the control does not draw its own label. */
  label?: string;
  /** footnote fg-3 under the control. */
  help?: string;
  /** footnote err with a circle-x glyph; replaces the help line. */
  error?: string;
  /** " · required" after the label (never a bare asterisk). */
  required?: boolean;
  /** "Changed ↶" chips (MAgentPickerCaps) at the label's end. */
  provenance?: ReactNode;
  children: ReactElement;
  testID?: string;
}

/** What a control inside a Field reads (help / error become its accessibilityHint). */
export interface FieldContextValue {
  hint?: string;
  invalid: boolean;
  required: boolean;
}
