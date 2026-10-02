// ML-21 Stepper (wizard) contract (03 ML-21; MD-66).
export interface StepperStep {
  id: string;
  label: string;
}

export interface StepperProps {
  steps: ReadonlyArray<StepperStep>;
  /** Zero-based current step. */
  current: number;
  /** Zero-based finished steps. */
  done: ReadonlyArray<number>;
  /** wizard (numbered nodes) or inline ("1 Request › 2 Admin approves › 3 Edit"). Default wizard. */
  variant?: 'wizard' | 'inline';
  /** Finished steps become buttons at medium+ widths (phones: nodes are not buttons, MD-66). */
  onStepPress?: (index: number) => void;
  testID?: string;
}
