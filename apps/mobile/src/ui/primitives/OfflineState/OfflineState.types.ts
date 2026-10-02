// MP-34 OfflineState contract (03 MP-34; MD-89; MDF-136 R-OFFLINE).
export interface OfflineStateProps {
  /** banner: a strip under the header · screen: full EmptyState-geometry state. */
  form: 'banner' | 'screen';
  state: 'offline' | 'reconnecting' | 'unreachable';
  serverName?: string;
  /** Shown mono on the screen form. */
  address?: string;
  onRetry?: () => void;
  /** Screen form: opens the server switcher (MB-20). */
  onSwitchServer?: () => void;
  testID?: string;
}
