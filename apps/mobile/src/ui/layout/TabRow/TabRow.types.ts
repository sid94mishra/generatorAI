// TabRow contract (03 ML-08 "page tabs"; MProjectDetail, R-3): a screen's scrollable top tabs.

export interface TabRowItem {
  id: string;
  label: string;
  /** Mono count after the label ("Codebases 2"). */
  count?: number;
}

export interface TabRowProps {
  tabs: ReadonlyArray<TabRowItem>;
  active: string;
  onSelect: (id: string) => void;
  /** "Project sections". */
  accessibilityLabel: string;
  /** Tabs get `${testID}-${id}`. */
  testID?: string;
}
