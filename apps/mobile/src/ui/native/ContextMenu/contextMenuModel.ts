// What ContextMenu adds to the wrapped row (03 MP-28; MD-28): every enabled leaf as an accessibility action, routed
// back to onSelect, and the "Long press for actions" hint.
import { menuActions } from '../Menu/menuModel';
import type { ContextMenuProps, ContextMenuTargetProps } from './ContextMenu.types';

export const CONTEXT_MENU_HINT = 'Long press for actions';

/** Merges with the row's own actions (e.g. SwipeRow's): menu items first, the row's extra ones after; a name the
 * menu does not own goes back to the row's handler. */
export function contextTargetProps({ items, onSelect, disabled }: Pick<ContextMenuProps, 'items' | 'onSelect' | 'disabled'>, existing: ContextMenuTargetProps = {}): ContextMenuTargetProps {
  if (disabled) return {};
  const own = menuActions(items);
  const names = new Set(own.map((a) => a.name));
  const extra = (existing.accessibilityActions ?? []).filter((a) => !names.has(a.name));
  return {
    accessibilityActions: [...own, ...extra],
    onAccessibilityAction: (name) => (names.has(name) ? onSelect(name) : existing.onAccessibilityAction?.(name)),
    accessibilityHint: existing.accessibilityHint ? `${existing.accessibilityHint}. ${CONTEXT_MENU_HINT}` : CONTEXT_MENU_HINT,
  };
}
