// Pure ListRow logic (03 ML-13): the accessibility role and state per kind, the spoken name, and what a press does.
import type { AccessibilityRole } from 'react-native';
import type { ListRowProps } from './ListRow.types';

export function listRowRole(kind: ListRowProps['kind']): AccessibilityRole | undefined {
  switch (kind) {
    case 'toggle':
      return 'switch';
    case 'radio':
      return 'radio';
    case 'check':
      return 'checkbox';
    case 'link':
      return 'link';
    case 'navigation':
    case 'destructive':
    case 'requires-admin':
      return 'button';
    default:
      return undefined;
  }
}

/** "title, subtitle, value" (03 ML-13). */
export function listRowLabel({ title, subtitle, value, kind }: Pick<ListRowProps, 'title' | 'subtitle' | 'value' | 'kind'>): string {
  const extra = kind === 'requires-admin' ? 'Requires admin access' : value;
  return [title, subtitle, extra].filter(Boolean).join(', ');
}

/** The whole-row press: toggles mirror the switch, checks flip, the rest run onPress. */
export function listRowPress(props: Pick<ListRowProps, 'kind' | 'switchValue' | 'selected' | 'onValueChange' | 'onPress'>): (() => void) | undefined {
  const { kind, switchValue, selected, onValueChange, onPress } = props;
  if (kind === 'toggle') return onValueChange ? () => onValueChange(!switchValue) : undefined;
  if (kind === 'check') return onValueChange ? () => onValueChange(!selected) : onPress;
  if (kind === 'value' || kind === 'info' || kind === 'stepper' || kind === 'segmented' || kind === 'picker') return undefined;
  return onPress;
}

/**
 * Column widths for a row (03 ML-13): when a text detail trails the title (navigation / value / info), the title takes
 * the width it needs up to 60 % (wrapping beyond it) and the detail takes all the remaining width, ellipsizing only
 * when it truly runs out; otherwise the title fills the row.
 */
export function listRowColumns(kind: ListRowProps['kind'], value?: string): { title: string; trailing: string } {
  const detail = Boolean(value) && (kind === 'navigation' || kind === 'value' || kind === 'info');
  return detail ? { title: 'max-w-3/5 shrink-0', trailing: 'flex-1 justify-end' } : { title: 'flex-1', trailing: '' };
}
