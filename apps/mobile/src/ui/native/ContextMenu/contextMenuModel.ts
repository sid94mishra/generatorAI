// What ContextMenu adds to the wrapped row (03 MP-28; MD-28): every enabled leaf as an accessibility action, routed
// back to onSelect, and the "Long press for actions" hint.
import { menuActions } from '../Menu/menuModel';
import type { ContextMenuProps, ContextMenuTargetProps } from './ContextMenu.types';

export const CONTEXT_MENU_HINT = 'Long press for actions';

export function contextTargetProps({ items, onSelect, disabled }: Pick<ContextMenuProps, 'items' | 'onSelect' | 'disabled'>, existingHint?: string): ContextMenuTargetProps {
  if (disabled) return {};
  return {
    accessibilityActions: menuActions(items),
    onAccessibilityAction: onSelect,
    accessibilityHint: existingHint ? `${existingHint}. ${CONTEXT_MENU_HINT}` : CONTEXT_MENU_HINT,
  };
}
