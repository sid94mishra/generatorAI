// The one prop mapping the Switch files use (03 §1.8). Only the "on" colour is ours (MD-48).
import type { SwitchProps } from './Switch.types';

export interface SwitchNativeProps {
  isOn: boolean;
  enabled: boolean;
  busy: boolean;
  /** iOS tint / RN onTintColor / Android checked track. */
  onColor: string;
  /** Android checked thumb. */
  onThumb: string;
}

export function toSwitchNativeProps({ value, disabled = false, pending = false }: SwitchProps, colors: { accent: string; onAccent: string }): SwitchNativeProps {
  return { isOn: value, enabled: !disabled && !pending, busy: pending, onColor: colors.accent, onThumb: colors.onAccent };
}
