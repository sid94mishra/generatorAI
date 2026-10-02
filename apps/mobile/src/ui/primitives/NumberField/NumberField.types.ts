// MP-43 NumberField contract (03 MP-43).
export interface NumberFieldProps {
  value: number;
  onValueChange: (v: number) => void;
  min?: number;
  max?: number;
  /** Default 1. */
  step?: number;
  /** Accessible name ("Max turns"); the row renders the visible label. */
  label: string;
  /** Display text ("4 GB", "3 runs"). Default: the number. */
  format?: (v: number) => string;
  disabled?: boolean;
  testID?: string;
}
