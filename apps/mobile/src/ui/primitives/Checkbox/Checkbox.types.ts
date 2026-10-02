// MP-20 Checkbox contract (03 MP-20; MD-49).
export interface CheckboxProps {
  checked: boolean | 'indeterminate';
  onValueChange: (v: boolean) => void;
  /** Visible label after the box; the whole label + box is then one target. Without it the box is the target. */
  label?: string;
  /** Accessible name when there is no visible label (row checkboxes). */
  accessibilityLabel?: string;
  disabled?: boolean;
  testID?: string;
}
