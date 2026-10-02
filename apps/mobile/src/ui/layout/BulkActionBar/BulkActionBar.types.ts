// ML-25 BulkActionBar contract (03 ML-25; MD-60; D-52 bulk endpoints are the caller's).
import type { MobileIconConcept } from '@generatorai/design-tokens';

export interface BulkAction {
  id: string;
  label: string;
  icon: MobileIconConcept;
  /** err glyph; the caller confirms through AlertDialog. */
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** e.g. `chats-bulk-delete`. */
  testID?: string;
}

export interface BulkActionBarProps {
  count: number;
  actions: ReadonlyArray<BulkAction>;
  /** The header shows "Select all" / "Cancel" (iOS) or the contextual app bar (Android); also accessibility actions here. */
  onSelectAll: () => void;
  onCancel: () => void;
  testID?: string;
}
