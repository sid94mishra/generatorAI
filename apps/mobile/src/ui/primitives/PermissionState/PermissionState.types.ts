// MP-35 PermissionState contract (03 MP-35; MDF-136 R-OSPERM / R-SCOPE).
export type PermissionKind = 'camera' | 'microphone' | 'notifications' | 'biometrics' | 'localNetwork' | 'scope' | 'app-lock';
export type PermissionStatus = 'undetermined' | 'denied' | 'restricted' | 'missing-scope' | 'locked';

export interface PermissionStateProps {
  kind: PermissionKind;
  status: PermissionStatus;
  /** kind 'scope': the scope label ("Manage devices"). */
  scope?: string;
  /** undetermined → "Allow"; missing-scope → "Request access"; locked → "Unlock". */
  onRequest?: () => void;
  /** denied → "Open Settings" (default: Linking.openSettings()). */
  onOpenSettings?: () => void;
  /** The lock overlay keeps `app-lock`. */
  testID?: string;
}
