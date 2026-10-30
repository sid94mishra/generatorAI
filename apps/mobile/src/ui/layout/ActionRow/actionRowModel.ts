// Pure ActionRow layout (MD-50): iOS equal-width side by side; Android end-aligned with quiet actions at the start;
// stacked full-width, primary first, when the row is narrower than 360 or the text is large.
import type { ActionRole, RowAction } from './ActionRow.types';

export type ActionLayout = 'equal' | 'end' | 'stacked';

export function actionLayout(platform: 'ios' | 'android', width: number, fontScale: number): ActionLayout {
  if ((width > 0 && width < 360) || fontScale >= 1.3) return 'stacked';
  return platform === 'ios' ? 'equal' : 'end';
}

const RANK: Record<ActionRole, number> = { primary: 0, danger: 1, secondary: 2, quiet: 3 };

/** Stacked rows put the primary (or the destructive confirm) first. */
export function stackedOrder(actions: ReadonlyArray<RowAction>): RowAction[] {
  return [...actions].sort((a, b) => RANK[a.role] - RANK[b.role]);
}

export const buttonVariant = (role: ActionRole): 'primary' | 'secondary' | 'destructive' | 'ghost' =>
  role === 'primary' ? 'primary' : role === 'danger' ? 'destructive' : role === 'quiet' ? 'ghost' : 'secondary';
