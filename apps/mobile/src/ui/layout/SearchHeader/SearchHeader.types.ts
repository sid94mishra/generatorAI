// ML-28 SearchHeader contract (03 ML-28; MD-46, MD-81).
export interface SearchHeaderProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  /** Close the palette (iOS glass ✕ "Close search"; Android ← back). */
  onClose: () => void;
  /** Return / Enter: open the selected result. */
  onSubmit?: () => void;
  /** "9 results" under the iOS field; announced on change. */
  resultCount?: number;
  loading?: boolean;
  testID?: string;
}
