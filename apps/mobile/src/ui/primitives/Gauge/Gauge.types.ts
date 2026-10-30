// MP-41 Gauge contract (03 MP-41).
export interface GaugeProps {
  /** 0..1. */
  value: number;
  /** 32 (row, default) or 20 (chip). */
  size?: 20 | 32;
  label: string;
  testID?: string;
}
