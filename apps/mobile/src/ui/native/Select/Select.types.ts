// MP-24 Select contract (03 MP-24).
export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps {
  /** Visible label (row start / field label) and the accessible name. */
  label: string;
  value: string | null;
  /** ≤ 30 static options in a menu; longer lists set `searchable` (a sheet with search + radio list). */
  options: ReadonlyArray<SelectOption>;
  onValueChange: (v: string) => void;
  placeholder?: string;
  searchable?: boolean;
  /** 'row' (inside a ListSection group, default) or 'field' (standalone; Android outlined). */
  presentation?: 'row' | 'field';
  disabled?: boolean;
  testID?: string;
}
