// MP-22 Switch contract (03 MP-22; MD-48).
export interface SwitchProps {
  value: boolean;
  onValueChange: (v: boolean) => void;
  /** Accessible name (the row renders the visible label). */
  label: string;
  disabled?: boolean;
  /** Optimistic write in flight: disabled + busy; the caller reverts on error (and shows a Toast). */
  pending?: boolean;
  testID?: string;
}
