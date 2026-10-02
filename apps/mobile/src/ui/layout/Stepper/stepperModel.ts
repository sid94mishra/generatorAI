// Pure Stepper logic (03 ML-21; MD-66).
export type StepState = 'done' | 'current' | 'pending';

export function stepState(index: number, current: number, done: ReadonlyArray<number>): StepState {
  if (index === current) return 'current';
  return done.includes(index) ? 'done' : 'pending';
}

/** "Step 2 of 6, Trigger". */
export function stepperLabel(current: number, total: number, label: string): string {
  return `Step ${current + 1} of ${total}, ${label}`;
}
