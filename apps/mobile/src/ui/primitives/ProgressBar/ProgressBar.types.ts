// MP-14 ProgressBar contract (03 MP-14).
export interface ProgressBarProps {
  /** 0..1; undefined = indeterminate. */
  value?: number;
  /** 'neutral' meter (fg-2) or 'run' progress. Default 'run'. */
  tone?: 'neutral' | 'run';
  /** Optional label row above (footnote + mono value). */
  label?: string;
  valueText?: string;
  /** Accessible name when there is no visible label. */
  accessibilityLabel?: string;
  testID?: string;
}
