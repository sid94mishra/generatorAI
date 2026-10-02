// MP-21 RadioGroup (+ Radio) contract (03 MP-21; MD-49).
import type { ReactNode } from 'react';

export interface RadioGroupProps {
  value: string | null;
  onValueChange: (v: string) => void;
  /** "Model", "Who works on this". */
  accessibilityLabel: string;
  children: ReactNode;
  testID?: string;
}

/** The indicator only, for custom rows (gate question options, model rows). */
export interface RadioProps {
  value: string;
  selected: boolean;
  disabled?: boolean;
}

/** A plain selectable row inside a RadioGroup (ListRow kind="radio" is the settings form of the same thing). */
export interface RadioOptionProps {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  testID?: string;
}
