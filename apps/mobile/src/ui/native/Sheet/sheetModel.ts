// Pure Sheet logic (03 ML-10): detent heights, the drag outcome, route options and the action-placement rule.
import { sheetOptions, type ScreenPresentationOptions, type SheetKind } from '../../platform/presentation';
import type { SheetDetent, SheetProps } from './Sheet.types';

export const DEFAULT_DETENTS: ReadonlyArray<SheetDetent> = ['medium', 'large'];

/** Height of a detent in a window; `content` = the measured content, capped like `large`. */
export function detentHeight(detent: SheetDetent, windowHeight: number, contentHeight: number): number {
  const large = Math.round(windowHeight * 0.92);
  if (detent === 'large') return large;
  if (detent === 'medium') return Math.round(windowHeight * 0.5);
  return Math.min(large, Math.max(0, Math.round(contentHeight)));
}

export type DragOutcome = { kind: 'snap'; index: number } | { kind: 'dismiss' };

/** After a vertical drag (down positive) on a panel of `height` at `index`: step down, dismiss, or step up. */
export function dragOutcome({ translation, velocity, height, index, count }: { translation: number; velocity: number; height: number; index: number; count: number }): DragOutcome {
  const down = translation > height * 0.25 || velocity > 1000;
  const up = translation < -60 || velocity < -1000;
  if (down) return index > 0 ? { kind: 'snap', index: index - 1 } : { kind: 'dismiss' };
  if (up && index < count - 1) return { kind: 'snap', index: index + 1 };
  return { kind: 'snap', index };
}

/** Route-sheet screen options: the kind's detents, and no swipe dismissal while dirty (06 §3.7). */
export function routeSheetOptions(kind: SheetKind, dirty = false): ScreenPresentationOptions {
  return { ...sheetOptions(kind), gestureEnabled: !dirty };
}

/** MD-85: a sheet is a selection sheet (header text action) or an action sheet (footer primary), never both. */
export function actionPlacementProblem({ headerAction, footer }: Pick<SheetProps, 'headerAction' | 'footer'>): string | null {
  return headerAction && footer ? 'A sheet has either a header text action (selection) or a footer primary (action), not both (MD-85).' : null;
}
