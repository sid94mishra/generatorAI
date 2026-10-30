// ML-26 ScrollToLatest contract (03 ML-26).
export interface ScrollToLatestProps {
  visible: boolean;
  onPress: () => void;
  /** "3 new". */
  newCount?: number;
  testID?: string;
}
