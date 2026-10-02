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
  /** The off track the JS path draws on Android: RN's Android switch draws no track when only the "on" colour is
   * given, so the off state takes the M3 outline colour (device review). iOS keeps the system's. */
  offTrack: string;
}

export function toSwitchNativeProps({ value, disabled = false, pending = false }: SwitchProps, colors: { accent: string; onAccent: string; lineStrong: string }): SwitchNativeProps {
  return { isOn: value, enabled: !disabled && !pending, busy: pending, onColor: colors.accent, onThumb: colors.onAccent, offTrack: colors.lineStrong };
}
