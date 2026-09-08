// ────────────────────────────────────────────────────────────────
// ContextMenu — the long-press menu.
//
// Two entry points, because rows come in two shapes:
//
//   <ContextMenu items={…}>{children}</ContextMenu>
//     Wraps a NON-pressable child (a message bubble, a diff hunk, a card)
//     and owns the touch: long-press scales the child down, fires a haptic
//     and opens the menu. Nested pressables would swallow the long-press,
//     so a child that is itself a `Touchable` uses the hook instead.
//
//   const { open } = useContextMenu();
//     For rows that already have `onLongPress` (`ListRow`, `SheetRow`).
//     Needs `<ContextMenuProvider>` above it — one per app, mounted once.
//
// Built on `ActionSheet` rather than a native menu: the product constraint
// is no extra native modules, and on a phone a bottom-anchored sheet is the
// reachable place for these actions anyway. `anchor` is accepted so a
// native, anchored menu can be substituted later without touching callers.
// ────────────────────────────────────────────────────────────────

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { PressableProps, ViewStyle } from 'react-native';
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ActionSheet, type MenuAction } from './ActionSheet';
import { AnimatedPressable } from './animated';
import { PRESS_SCALE, SPRING_PRESS, useReducedMotionPreset } from './motion';
import { haptics } from './haptics';
import { useReduceMotion } from './accessibility';

export type ContextMenuItem = MenuAction;

export interface ContextMenuAnchor {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface ContextMenuOptions {
  /** Names what the actions apply to. Menus without a subject delete the wrong thing. */
  title?: string;
  message?: string;
  /** Where the menu was invoked from. Unused by the sheet; kept for parity. */
  anchor?: ContextMenuAnchor;
}

interface ContextMenuApi {
  open: (items: ContextMenuItem[], options?: ContextMenuOptions) => void;
  close: () => void;
}

const noop: ContextMenuApi = {
  open: () => {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('useContextMenu(): no <ContextMenuProvider> above this component.');
    }
  },
  close: () => {},
};

const ContextMenuContext = createContext<ContextMenuApi>(noop);

interface MenuState extends ContextMenuOptions {
  items: ContextMenuItem[];
}

/** Hosts the single shared menu sheet. Mount once, near the toast provider. */
export function ContextMenuProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const open = useCallback((items: ContextMenuItem[], options?: ContextMenuOptions) => {
    if (items.length === 0) return;
    haptics.commit();
    setMenu({ items, ...options });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  const api = useMemo<ContextMenuApi>(() => ({ open, close }), [open, close]);

  return (
    <ContextMenuContext.Provider value={api}>
      {children}
      <ActionSheet
        visible={menu !== null}
        onClose={close}
        actions={menu?.items ?? []}
        {...(menu?.title ? { title: menu.title } : {})}
        {...(menu?.message ? { message: menu.message } : {})}
      />
    </ContextMenuContext.Provider>
  );
}

/**
 * `open(items, { title, anchor })` from any row that already handles its own
 * long-press. Safe without a provider (warns in dev, no-ops in release).
 */
export function useContextMenu(): ContextMenuApi {
  return useContext(ContextMenuContext);
}

export interface ContextMenuProps {
  items: ContextMenuItem[];
  title?: string;
  message?: string;
  children: React.ReactNode;
  /** A normal tap, when the wrapped content is also tappable. */
  onPress?: () => void;
  disabled?: boolean;
  /** Called when the menu opens — analytics, or closing a swiped row. */
  onOpen?: () => void;
  /** Milliseconds; RN's default 500 reads as unresponsive next to native menus. */
  longPressDelay?: number;
  accessibilityLabel?: string;
  /** Defaults to `none` so a wrapped bubble does not announce as a button. */
  a11yRole?: PressableProps['accessibilityRole'];
  className?: string;
  style?: ViewStyle;
}

export function ContextMenu({
  items,
  title,
  message,
  children,
  onPress,
  disabled = false,
  onOpen,
  longPressDelay = 350,
  accessibilityLabel,
  a11yRole = 'none',
  className,
  style,
}: ContextMenuProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const pressed = useSharedValue(0);
  const reduceMotion = useReduceMotion();
  const presets = useReducedMotionPreset();
  // Whether the current touch became a long-press, so the release that
  // follows it does not also fire `onPress`.
  const openedThisTouch = useRef(false);

  const animatedStyle = useAnimatedStyle(
    () => ({
      transform: [{ scale: reduceMotion ? 1 : 1 - pressed.value * (1 - PRESS_SCALE) }],
    }),
    [reduceMotion],
  );

  const open = useCallback(() => {
    if (disabled || items.length === 0) return;
    openedThisTouch.current = true;
    haptics.commit();
    onOpen?.();
    setVisible(true);
  }, [disabled, items.length, onOpen]);

  const close = useCallback(() => setVisible(false), []);

  return (
    <>
      <AnimatedPressable
        accessibilityRole={a11yRole}
        {...(accessibilityLabel ? { accessibilityLabel } : {})}
        // A long-press is not performable with a screen reader; the menu is
        // reachable through the actions rotor instead.
        accessibilityActions={[{ name: 'longpress', label: 'Show actions' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress') open();
        }}
        disabled={disabled}
        delayLongPress={longPressDelay}
        onPressIn={() => {
          openedThisTouch.current = false;
          pressed.value = withSpring(1, presets.springPress);
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, SPRING_PRESS);
        }}
        onLongPress={open}
        onPress={() => {
          if (openedThisTouch.current) return;
          onPress?.();
        }}
        className={className}
        style={[animatedStyle, style]}
      >
        {children}
      </AnimatedPressable>
      <ActionSheet
        visible={visible}
        onClose={close}
        actions={items}
        {...(title ? { title } : {})}
        {...(message ? { message } : {})}
      />
    </>
  );
}
