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
