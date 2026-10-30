// MP-25 Slider contract (03 MP-25).
import type { MobileIconConcept } from '@generatorai/design-tokens';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  /** Stepped when set (a selection tick per step); continuous otherwise. */
  step?: number;
  onValueChange: (v: number) => void;
  onSlidingComplete?: (v: number) => void;
  /** Accessible name ("Terminal font size"). */
  label: string;
  /** Trailing mono value and the spoken value ("14 pt"). */
  valueText?: (v: number) => string;
  /** iOS "A / A" text-size glyphs. */
  minIcon?: MobileIconConcept;
  maxIcon?: MobileIconConcept;
  disabled?: boolean;
  testID?: string;
}
