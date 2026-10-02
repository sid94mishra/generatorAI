// MP-13 ProgressIndicator contract (03 MP-13): page / section loading only.
export interface ProgressIndicatorProps {
  /** md (iOS regular / Android 48, default) or lg (iOS large / Android 64). */
  size?: 'md' | 'lg';
  /** Required: "Connecting", "Committing". */
  label: string;
  /** Android: the M3 contained indicator (over content). */
  contained?: boolean;
  testID?: string;
}
