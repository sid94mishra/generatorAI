// Pure Header logic (03 ML-02; 06 §2.4; MD-22, MD-94): which actions stay in the bar, the toggle names, the native
// options the iOS header takes (typed locally: ui/ never imports router types, MD-86).
import { geometry } from '../../../platform/geometry';
import type { HeaderAction, HeaderProps } from './Header.types';

/** Visible trailing actions: the platform max (iOS 3 / Android 2), 1 at font scale ≥ 1.6; destructive always overflow. */
export function splitActions(actions: ReadonlyArray<HeaderAction>, fontScale: number, max = geometry().controls.header.maxTrailing): { inline: HeaderAction[]; overflow: HeaderAction[] } {
  const limit = fontScale >= 1.6 ? 1 : max;
  const candidates = actions.filter((a) => !a.destructive);
  const destructive = actions.filter((a) => a.destructive);
  const fits = candidates.length + (destructive.length ? 1 : 0) <= limit;
  if (fits && !destructive.length) return { inline: candidates, overflow: [] };
  const inline = candidates.slice(0, Math.max(0, limit - 1));
  return { inline, overflow: [...candidates.slice(inline.length), ...destructive] };
}

/** "Open workspace pane, 2 changes" / "Hide workspace pane, 2 changes" (03 ML-02; MD-23). */
export function paneToggleLabel(open: boolean, count: number): string {
  const verb = open ? 'Hide workspace pane' : 'Open workspace pane';
  return count > 0 ? `${verb}, ${count} ${count === 1 ? 'change' : 'changes'}` : verb;
}

export function sidebarToggleLabel(state: HeaderProps['sidebarToggleState'] = 'drawer', android = false): string {
  if (state === 'shown') return android ? 'Hide navigation drawer' : 'Hide sidebar';
  return android && state === 'hidden' ? 'Show navigation drawer' : 'Open sidebar';
}

/** "Back to <parent>": the last breadcrumb segment is the parent. */
export function backLabel(breadcrumb: HeaderProps['breadcrumb']): string {
  const parent = breadcrumb?.[breadcrumb.length - 1]?.label;
  return parent ? `Back to ${parent}` : 'Back';
}

export function actionTestID(action: HeaderAction): string {
  return action.testID ?? `header-${action.id}`;
}

export interface IosHeaderOptions {
  headerShown: true;
  title: string;
  headerLargeTitle: boolean;
  headerTransparent: boolean;
  headerShadowVisible: false;
  headerLargeTitleShadowVisible: false;
  headerBackVisible: boolean;
  headerTitleAlign: 'center';
}

/**
 * The native-stack options for the iOS header (the title view and toolbars are added by Header.ios). Next to a
 * persistent iPad sidebar (`sidebarToggleState: 'shown'`) a module root uses the inline centred title: the native
 * large title is laid out flush against the sidebar's edge there, without the content's leading inset (MD-147).
 */
export function iosHeaderOptions({ role, title, largeTitle, onBack, opaque, sidebarToggleState, count }: Pick<HeaderProps, 'role' | 'title' | 'largeTitle' | 'onBack' | 'opaque' | 'sidebarToggleState' | 'count'>): IosHeaderOptions {
  const contentTitle = iosContentLargeTitle({ role, largeTitle, count });
  return {
    headerShown: true,
    title,
    headerLargeTitle: role === 'top' && largeTitle !== false && sidebarToggleState !== 'shown' && !contentTitle,
    // The in-content large title (MD-153) sits under an opaque bar, so its scroll offset starts at 0 for the fade.
    headerTransparent: role !== 'modal' && !opaque && !contentTitle,
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    headerBackVisible: (role === 'detail' || role === 'workspace') && !onBack,
    headerTitleAlign: 'center',
  };
}

/** A module root with a title count draws its large title in the content (`LargeTitle`), not natively (MD-153). */
export function iosContentLargeTitle({ role, largeTitle, count }: Pick<HeaderProps, 'role' | 'largeTitle' | 'count'>): boolean {
  return role === 'top' && largeTitle !== false && count !== undefined;
}

/** The inline title's opacity for a content offset: hidden while the large title is in view (MD-153). */
export function inlineTitleOpacity(offset: number): number {
  'worklet';
  return Math.min(1, Math.max(0, (offset - 24) / 20));
}

/** The theme colours the iOS header needs (a subset of `useThemeColors()`). */
export interface HeaderThemeColors {
  surface: string;
  fg: string;
  appearance: 'light' | 'dark';
}

export interface IosHeaderColorOptions {
  headerStyle: { backgroundColor?: string };
  headerLargeStyle: { backgroundColor?: string };
  headerTintColor: string;
  headerTitleStyle: { color: string };
  headerLargeTitleStyle: { color: string };
  headerBlurEffect?: 'systemChromeMaterialDark' | 'systemChromeMaterialLight';
}

/**
 * The header follows the active theme (02 §2.6, 03 ML-02): titles, large titles and bar items in `fg`; an opaque bar
 * (modal, legacy bodies) painted `surface`; a transparent bar keeps its system scroll-edge material, chosen for the
 * theme's appearance rather than the OS's, so a dark theme never gets a light bar.
 */
export function iosHeaderColorOptions(colors: HeaderThemeColors, transparent: boolean): IosHeaderColorOptions {
  const background = transparent ? {} : { backgroundColor: colors.surface };
  return {
    headerStyle: background,
    headerLargeStyle: background,
    headerTintColor: colors.fg,
    headerTitleStyle: { color: colors.fg },
    headerLargeTitleStyle: { color: colors.fg },
    ...(transparent ? { headerBlurEffect: colors.appearance === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight' } : {}),
  };
}

/**
 * The iOS bar as plain values (no callbacks): what Header.ios renders into the native toolbars and title view. Its
 * JSON is the identity the header memoizes on, so a caller that rebuilds equal props each render (fresh arrays,
 * inline handlers) never re-applies the navigator options — re-applying them re-renders the navigator, and a screen
 * that re-renders with it would loop (MD-162). Presses go through `dispatchHeaderPress` with the latest props.
 */
export interface IosHeaderModel {
  title: string;
  /** The title view: breadcrumb (detail / workspace), the fading inline title (counted root), or the native title. */
  titleView: 'breadcrumb' | 'inline' | 'native';
  crumbs: Array<{ label: string; accessibilityLabel?: string; pressable: boolean }>;
  left: Array<{ target: 'sidebar' | 'back' | 'cancel'; icon?: string; label: string; text?: string; selected?: boolean }>;
  right: Array<
    | { kind: 'button'; target: string; icon: HeaderAction['icon']; label: string; selected?: boolean }
    | { kind: 'menu'; target: string; icon: HeaderAction['icon']; label: string; items: Array<{ target: string; label: string; icon?: HeaderAction['icon']; destructive?: boolean; disabled?: boolean; checked?: boolean }> }
    | { kind: 'pane'; open: boolean; count: number; label: string }
    | { kind: 'overflow'; items: Array<{ target: string; label: string; icon: HeaderAction['icon']; destructive?: boolean }> }
    | { kind: 'primary'; label: string; disabled: boolean }
  >;
}

export function iosHeaderModel(props: HeaderProps, fontScale: number): IosHeaderModel {
  const { role, title, breadcrumb, actions = [], onSidebarToggle, sidebarToggleState = 'drawer', onBack, paneToggle, modal } = props;
  const detail = role === 'detail' || role === 'workspace';
  const { inline, overflow } = splitActions(actions, fontScale);
  const left: IosHeaderModel['left'] = [];
  if (role === 'top' && onSidebarToggle) left.push({ target: 'sidebar', icon: 'sidebar.left', label: sidebarToggleLabel(sidebarToggleState), selected: sidebarToggleState === 'shown' });
  if (detail && onBack) left.push({ target: 'back', icon: 'chevron.left', label: backLabel(breadcrumb) });
  if (role === 'modal' && modal) left.push({ target: 'cancel', label: modal.cancelLabel ?? 'Cancel', text: modal.cancelLabel ?? 'Cancel' });
  const right: IosHeaderModel['right'] = inline.map((a) =>
    a.menu?.length
      ? {
          kind: 'menu' as const,
          target: `action:${a.id}`,
          icon: a.icon,
          label: a.label,
          items: a.menu.flatMap((m) =>
            'type' in m ? [] : [{ target: `menu:${a.id}:${m.id}`, label: m.label, ...(m.icon ? { icon: m.icon } : {}), ...(m.destructive ? { destructive: true } : {}), ...(m.disabled ? { disabled: true } : {}), ...(m.checked !== undefined ? { checked: m.checked } : {}) }],
          ),
        }
      : { kind: 'button' as const, target: `action:${a.id}`, icon: a.icon, label: a.label, ...(a.selected !== undefined ? { selected: a.selected } : {}) },
  );
  if (role === 'workspace' && paneToggle) right.push({ kind: 'pane', open: paneToggle.open, count: paneToggle.count, label: paneToggleLabel(paneToggle.open, paneToggle.count) });
  if (overflow.length) right.push({ kind: 'overflow', items: overflow.map((a) => ({ target: `action:${a.id}`, label: a.label, icon: a.icon, ...(a.destructive ? { destructive: true } : {}) })) });
  if (role === 'modal' && modal?.primary) right.push({ kind: 'primary', label: modal.primary.label, disabled: Boolean(modal.primary.disabled || modal.primary.loading) });
  return {
    title,
    titleView: detail ? 'breadcrumb' : iosContentLargeTitle(props) ? 'inline' : 'native',
    crumbs: (breadcrumb ?? []).map((c) => ({ label: c.label, ...(c.accessibilityLabel ? { accessibilityLabel: c.accessibilityLabel } : {}), pressable: Boolean(c.onPress) })),
    left,
    right,
  };
}

/** Run a press from the iOS bar against the latest props (`target` from `iosHeaderModel`). */
export function dispatchHeaderPress(props: HeaderProps, target: string): void {
  if (target === 'sidebar') return props.onSidebarToggle?.();
  if (target === 'back') return props.onBack?.();
  if (target === 'cancel') return props.modal?.onCancel();
  if (target === 'pane') return props.paneToggle?.onPress();
  if (target === 'primary') return props.modal?.primary?.onPress();
  if (target.startsWith('crumb:')) return props.breadcrumb?.[Number(target.slice(6))]?.onPress?.();
  const [kind, actionId, ...rest] = target.split(':');
  const action = props.actions?.find((a) => a.id === actionId);
  if (!action) return;
  if (kind === 'menu') return action.onMenuSelect?.(rest.join(':'));
  if (kind === 'action') return action.onPress?.();
}
