// ML-16 ReorderList contract (03 ML-16).
import type { ReactElement } from 'react';

export interface ReorderListProps<T> {
  data: ReadonlyArray<T>;
  keyExtractor: (item: T) => string;
  /** The row; place `handle` where the drag handle goes (end of the row). `handle` is null when not editing. */
  renderItem: (item: T, handle: ReactElement | null) => ReactElement;
  /** e.g. the workflow builder: only stages in a linear chain move (MD-04). */
  canMove?: (from: number, to: number) => boolean;
  /** Fires on drop (and on the Move up / Move down actions). */
  onMove: (key: string, toIndex: number) => void;
  editing: boolean;
  /** Accessible name of each row's handle: "Reorder <label>". */
  itemLabel?: (item: T) => string;
  testID?: string;
}
