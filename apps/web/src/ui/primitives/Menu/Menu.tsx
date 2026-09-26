// ────────────────────────────────────────────────────────────────
// P-30 Menu — dropdown, context menu and submenus (03 §2 P-30; Base UI Menu,
// ContextMenu; Rosetta "overlay r8 pad 4 box with 30h items r5").
//
// Popup: `bg-overlay`, 1px line, card radius, `shadow-pop`, pad 4, min 220.
// Item 30h (h-item), pad 0 8, control-sm radius, gap 8, ui text, 16 icon;
// highlighted `bg-selected`; trailing Kbd (`shortcut`) or a chevron on
// submenu triggers; `danger` items in err; disabled fg-3; `description` makes
// the 40h two-line item (Servers menu); `trailing` is small fg-3 content at
// the right end (a server's "● Connected", a hint such as "Security &
// devices"). Checkbox/radio items keep a 14px
// check column. GroupLabel 28h small fg-3; Separator 1px line-soft, margin 4 0.
// Every positioner carries `data-gai-overlay="menu"` (D-19) on the dropdown
// layer (D-41). Triggers take any element through `render`:
// `<Menu.Trigger render={<IconButton icon="more" label="More" />} />`.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { overlayProps } from '../../lib/overlay.js';
import { floatSurface, listPopup } from '../../lib/popup.js';
import { Icon } from '../../icons/Icon.js';
import { Kbd } from '../Kbd/Kbd.js';

const itemBase = cn(
  'flex min-h-item w-full cursor-default items-center gap-2 rounded-control-sm px-2 text-ui text-fg outline-none select-none',
  'data-highlighted:bg-selected data-disabled:cursor-not-allowed data-disabled:text-fg-3',
);

type Side = 'top' | 'bottom' | 'left' | 'right' | 'inline-start' | 'inline-end';
type Align = 'start' | 'center' | 'end';

// ── Root / Trigger ─────────────────────────────────────────────

/** Menu state container (open, modal, nested). All Base UI Menu.Root props. */
export const MenuRoot = BaseMenu.Root;
/** The element that opens the menu; pass the visible control through `render`. */
export const MenuTrigger = BaseMenu.Trigger;

// ── Popup ──────────────────────────────────────────────────────

export interface MenuPopupProps extends Omit<ComponentProps<typeof BaseMenu.Popup>, 'className'> {
  /**
   * Position against this element instead of the Trigger — a menu opened by
   * a plain button (many rows, one lazily mounted menu).
   */
  anchor?: ComponentProps<typeof BaseMenu.Positioner>['anchor'];
  side?: Side;
  align?: Align;
  sideOffset?: number;
  className?: string;
}

/** Portal + positioner + the styled popup box. */
export function MenuPopup({ anchor, side = 'bottom', align = 'start', sideOffset = 4, className, children, ...rest }: MenuPopupProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        {...(anchor !== undefined ? { anchor } : {})}
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-dropdown outline-none"
        {...overlayProps('menu')}
      >
        <BaseMenu.Popup className={cn(floatSurface, listPopup, className)} {...rest}>
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

// ── Items ──────────────────────────────────────────────────────

interface ItemDecor {
  /** Leading 16px glyph. */
  icon?: IconConcept;
  /** Trailing shortcut chord, e.g. `['F2']`, `['Del']`. */
  shortcut?: readonly string[];
  /** Destructive: err text. */
  danger?: boolean;
  /** Second line (mono micro fg-3): the 40h two-line item. */
  description?: ReactNode;
  /** Small fg-3 content at the right end: a status ("● Connected") or a hint. */
  trailing?: ReactNode;
}

function ItemBody({ icon, shortcut, description, trailing, children }: ItemDecor & { children?: ReactNode }) {
  return (
    <>
      {icon ? <Icon concept={icon} size={16} className="text-current" /> : null}
      {description != null ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{children}</span>
          <span className="truncate font-mono text-micro text-fg-3">{description}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">{children}</span>
      )}
      {trailing != null ? (
        <span className="ml-2 flex shrink-0 items-center gap-1.5 text-small text-fg-3">{trailing}</span>
      ) : null}
      {shortcut ? <Kbd keys={shortcut} aria-hidden className="ml-4" /> : null}
    </>
  );
}

export interface MenuItemProps extends Omit<ComponentProps<typeof BaseMenu.Item>, 'className'>, ItemDecor {
  className?: string;
}

/** An action row. */
export function MenuItem({ icon, shortcut, danger = false, description, trailing, className, children, ...rest }: MenuItemProps) {
  return (
    <BaseMenu.Item
      className={cn(itemBase, description != null && 'min-h-10 py-1', danger && 'text-err', className)}
      {...rest}
    >
      <ItemBody icon={icon} shortcut={shortcut} description={description} trailing={trailing}>
        {children}
      </ItemBody>
    </BaseMenu.Item>
  );
}

/** The 14px check column shared by checkbox and radio items. */
function CheckColumn({ children }: { children: ReactNode }) {
  return <span className="flex size-3.5 shrink-0 items-center justify-center">{children}</span>;
}

export interface MenuCheckboxItemProps
  extends Omit<ComponentProps<typeof BaseMenu.CheckboxItem>, 'className'>,
    Omit<ItemDecor, 'danger'> {
  className?: string;
}

/** A toggle row with a check column (`menuitemcheckbox`). */
export function MenuCheckboxItem({ icon, shortcut, description, trailing, className, children, ...rest }: MenuCheckboxItemProps) {
  return (
    <BaseMenu.CheckboxItem className={cn(itemBase, description != null && 'min-h-10 py-1', className)} {...rest}>
      <CheckColumn>
        <BaseMenu.CheckboxItemIndicator>
          <Icon concept="check" size={14} />
        </BaseMenu.CheckboxItemIndicator>
      </CheckColumn>
      <ItemBody icon={icon} shortcut={shortcut} description={description} trailing={trailing}>
        {children}
      </ItemBody>
    </BaseMenu.CheckboxItem>
  );
}

/** Groups radio items; `value` / `onValueChange` hold the choice. */
export const MenuRadioGroup = BaseMenu.RadioGroup;

export interface MenuRadioItemProps
  extends Omit<ComponentProps<typeof BaseMenu.RadioItem>, 'className'>,
    Omit<ItemDecor, 'danger'> {
  className?: string;
}

/** One choice in a MenuRadioGroup (`menuitemradio`); `description` = two-line server row. */
export function MenuRadioItem({ icon, shortcut, description, trailing, className, children, ...rest }: MenuRadioItemProps) {
  return (
    <BaseMenu.RadioItem className={cn(itemBase, description != null && 'min-h-10 py-1', className)} {...rest}>
      <CheckColumn>
        <BaseMenu.RadioItemIndicator>
          <Icon concept="check" size={14} />
        </BaseMenu.RadioItemIndicator>
      </CheckColumn>
      <ItemBody icon={icon} shortcut={shortcut} description={description} trailing={trailing}>
        {children}
      </ItemBody>
    </BaseMenu.RadioItem>
  );
}

// ── Submenu ────────────────────────────────────────────────────

/** Wraps a SubmenuTrigger and its MenuPopup. */
export const MenuSubmenuRoot = BaseMenu.SubmenuRoot;

export interface MenuSubmenuTriggerProps extends Omit<ComponentProps<typeof BaseMenu.SubmenuTrigger>, 'className'> {
  icon?: IconConcept;
  className?: string;
}

/** A row that opens a nested menu (trailing chevron). */
export function MenuSubmenuTrigger({ icon, className, children, ...rest }: MenuSubmenuTriggerProps) {
  return (
    <BaseMenu.SubmenuTrigger className={cn(itemBase, 'data-popup-open:bg-selected', className)} {...rest}>
      <ItemBody icon={icon}>{children}</ItemBody>
      <Icon concept="chevron-right" size={14} className="text-fg-3" />
    </BaseMenu.SubmenuTrigger>
  );
}

// ── Structure ──────────────────────────────────────────────────

/** Groups rows under a GroupLabel. */
export const MenuGroup = BaseMenu.Group;

/** 28h small fg-3 heading of a group. */
export function MenuGroupLabel({ className, ...rest }: Omit<ComponentProps<typeof BaseMenu.GroupLabel>, 'className'> & { className?: string }) {
  return <BaseMenu.GroupLabel className={cn('flex h-step items-center px-2 text-small text-fg-3 select-none', className)} {...rest} />;
}

/** 1px line-soft rule between groups. */
export function MenuSeparator({ className, ...rest }: Omit<ComponentProps<typeof BaseMenu.Separator>, 'className'> & { className?: string }) {
  return <BaseMenu.Separator className={cn('-mx-1 my-1 border-t border-line-soft', className)} {...rest} />;
}

/** Compound access mirroring 03 §2 P-30: `Menu.Root`, `Menu.Item` … */
export const Menu = {
  Root: MenuRoot,
  Trigger: MenuTrigger,
  Popup: MenuPopup,
  Item: MenuItem,
  CheckboxItem: MenuCheckboxItem,
  RadioGroup: MenuRadioGroup,
  RadioItem: MenuRadioItem,
  SubmenuRoot: MenuSubmenuRoot,
  SubmenuTrigger: MenuSubmenuTrigger,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
  Separator: MenuSeparator,
};

// ── Context menu ───────────────────────────────────────────────

/** Right-click (long-press) menu root. */
export const ContextMenuRoot = BaseContextMenu.Root;
/** The area that opens the context menu. */
export const ContextMenuTrigger = BaseContextMenu.Trigger;

export interface ContextMenuPopupProps extends Omit<ComponentProps<typeof BaseContextMenu.Popup>, 'className'> {
  className?: string;
}

/** Portal + positioner (at the pointer) + the same popup box as MenuPopup. */
export function ContextMenuPopup({ className, children, ...rest }: ContextMenuPopupProps) {
  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner className="z-dropdown outline-none" {...overlayProps('menu')}>
        <BaseContextMenu.Popup className={cn(floatSurface, listPopup, className)} {...rest}>
          {children}
        </BaseContextMenu.Popup>
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  );
}

/** `ContextMenu.*` has the same item parts as `Menu.*`. */
export const ContextMenu = {
  Root: ContextMenuRoot,
  Trigger: ContextMenuTrigger,
  Popup: ContextMenuPopup,
  Item: MenuItem,
  CheckboxItem: MenuCheckboxItem,
  RadioGroup: MenuRadioGroup,
  RadioItem: MenuRadioItem,
  SubmenuRoot: MenuSubmenuRoot,
  SubmenuTrigger: MenuSubmenuTrigger,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
  Separator: MenuSeparator,
};
