// ML-18 StatTile / StatStrip contract (03 ML-18; MD-50, MD-71; D-58).
export interface StatItem {
  id: string;
  /** null → "—" (unknown; never 0 for unknown). */
  value: string | number | null;
  label: string;
  /** A status tone for a count of that status (warn: Needs you, run: Running). Default fg. */
  tone?: 'fg' | 'warn' | 'run';
  onPress?: () => void;
}

export interface StatStripProps {
  /** tiles: Home count tiles · strip: one card with divided columns ("This week"). */
  variant: 'tiles' | 'strip';
  items: ReadonlyArray<StatItem>;
  testID?: string;
}
