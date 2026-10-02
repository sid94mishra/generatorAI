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
