// ────────────────────────────────────────────────────────────────
// C-22 MenuButton / SplitButton (03 §3 C-22; Rosetta row "More" menus, two
// buttons joined `border-radius: 6px 0 0 6px`).
//
// A Button (trailing chevron) — or, with `icon` and no visible label, an
// IconButton "More" — that opens a Menu built from `items` data. `split`
// joins a primary action (`onPrimary`) with a chevron button that opens the
// menu (Pause · drain / interrupt). Items: `{ id, label, icon?, shortcut?,
// danger?, disabled?, onSelect }`, `{ type: 'separator' }` or
// `{ type: 'label', label }`.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Button, type ButtonSize, type ButtonVariant } from '../../primitives/Button/Button.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { Menu } from '../../primitives/Menu/Menu.js';

export type MenuButtonItem =
  | {
      type?: 'item';
      id: string;
      label: ReactNode;
      icon?: IconConcept;
      shortcut?: readonly string[];
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { type: 'separator'; id?: string }
  | { type: 'label'; id?: string; label: ReactNode };

export interface MenuButtonProps {
  /** Visible label, or (with `iconOnly`) the accessible name. */
  label: string;
  items: readonly MenuButtonItem[];
  /** Leading glyph; with `iconOnly` the trigger is an IconButton. */
  icon?: IconConcept;
  iconOnly?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Split button: the main part runs `onPrimary`, the chevron opens the menu. */
  split?: boolean;
  onPrimary?: () => void;
  /** Accessible name of the split chevron. Default "More options". */
  menuLabel?: string;
  align?: 'start' | 'end';
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

function renderItems(items: readonly MenuButtonItem[]) {
  const nodes: ReactNode[] = [];
  let group: ReactNode[] | null = null;
  let groupKey = '';
  const flush = () => {
    if (group) nodes.push(<Menu.Group key={`g-${groupKey}`}>{group}</Menu.Group>);
    group = null;
  };
  items.forEach((item, i) => {
    if (item.type === 'separator') {
      flush();
      nodes.push(<Menu.Separator key={item.id ?? `sep-${i}`} />);
    } else if (item.type === 'label') {
      flush();
      groupKey = item.id ?? String(i);
      group = [<Menu.GroupLabel key="label">{item.label}</Menu.GroupLabel>];
    } else {
      const row = (
        <Menu.Item
          key={item.id}
          icon={item.icon}
          shortcut={item.shortcut}
          danger={item.danger}
          disabled={item.disabled}
          onClick={item.onSelect}
        >
          {item.label}
        </Menu.Item>
      );
      if (group) group.push(row);
      else nodes.push(row);
    }
  });
  flush();
  return nodes;
}

/** A button that opens a menu of actions (optionally split with a primary action). */
export function MenuButton({
  label,
  items,
  icon,
  iconOnly = false,
  variant = 'secondary',
  size = 'md',
  split = false,
  onPrimary,
  menuLabel = 'More options',
  align = 'end',
  disabled,
  className,
  'data-testid': testId,
}: MenuButtonProps) {
  const popup = <Menu.Popup align={align}>{renderItems(items)}</Menu.Popup>;

  if (split) {
    return (
      <div className={cn('inline-flex', className)} data-testid={testId}>
        <Button variant={variant} size={size} icon={icon} disabled={disabled} onClick={onPrimary} className="rounded-r-none">
          {label}
        </Button>
        <Menu.Root>
          <Menu.Trigger
            disabled={disabled}
            render={
              <Button
                variant={variant}
                size={size}
                aria-label={menuLabel}
                trailingIcon="chevron-down"
                className="rounded-l-none border-l-0 px-1.5"
              />
            }
          />
          {popup}
        </Menu.Root>
      </div>
    );
  }

  const trigger = iconOnly ? (
    <IconButton icon={icon ?? 'more'} label={label} size={size} tooltip={false} className={className} data-testid={testId} />
  ) : (
    <Button variant={variant} size={size} icon={icon} trailingIcon="chevron-down" className={className} data-testid={testId}>
      {label}
    </Button>
  );
  return (
    <Menu.Root>
      <Menu.Trigger disabled={disabled} render={trigger} />
      {popup}
    </Menu.Root>
  );
}
