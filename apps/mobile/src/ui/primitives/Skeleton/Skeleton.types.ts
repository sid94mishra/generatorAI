// MP-31 Skeleton contract (03 MP-31): bg-selected, no shimmer.
export interface SkeletonProps {
  /** Default 'bar'. */
  shape?: 'circle' | 'bar' | 'block';
  /** Bar / block width: a percentage or a number. */
  width?: `${number}%` | number;
  /** Bar / block height. Default 10 (bar), 64 (block). */
  height?: number;
  /** A composed placeholder; overrides shape. */
  preset?: 'row' | 'row-2' | 'list' | 'card' | 'transcript';
  /** Rows in the `list` preset. Default 3. */
  count?: number;
  testID?: string;
}
