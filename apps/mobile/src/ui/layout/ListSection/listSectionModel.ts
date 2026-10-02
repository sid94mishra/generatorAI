// Pure ListSection logic (03 ML-12): row positions for group corners, and the per-row surface in a virtualised list
// (rows draw the iOS group themselves from `position`, without a wrapping view).
import type { RowPosition } from './ListSection.types';

export function rowPosition(index: number, count: number): RowPosition {
  if (count <= 1) return 'only';
  if (index === 0) return 'first';
  return index === count - 1 ? 'last' : 'middle';
}

/** iOS inset-group corners for a positioned row (Android rows are flat: no classes). */
export const IOS_GROUP_CORNERS: Record<RowPosition, string> = {
  first: 'ios:mx-4 ios:bg-raised ios:rounded-t-group',
  middle: 'ios:mx-4 ios:bg-raised',
  last: 'ios:mx-4 ios:bg-raised ios:rounded-b-group',
  only: 'ios:mx-4 ios:bg-raised ios:rounded-group',
};

/** Android M3 segmented-list item corners in a carded section (large outer, small inner radii). */
export const ANDROID_CARDED_CORNERS: Record<RowPosition, string> = {
  first: 'rounded-t-seg rounded-b-field',
  middle: 'rounded-field',
  last: 'rounded-b-seg rounded-t-field',
  only: 'rounded-seg',
};
