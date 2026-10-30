// MP-17 SearchInput contract (03 MP-17; MD-46).
export interface SearchInputProps {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  /** 'bar' (top level, default) or 'compact' (inside sheets and the drawer). */
  size?: 'bar' | 'compact';
  /** Button mode (the drawer search): looks like the field, opens the palette on press. */
  asButton?: boolean;
  onPress?: () => void;
  onSubmit?: () => void;
  /** Trailing dictation control while empty. */
  mic?: boolean;
  onMicPress?: () => void;
  autoFocus?: boolean;
  /** Results are loading: a spinner replaces the clear control. */
  loading?: boolean;
  testID?: string;
}
