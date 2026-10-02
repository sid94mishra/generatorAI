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

/** The native-stack options for the iOS header (the title view and toolbars are added by Header.ios). */
export function iosHeaderOptions({ role, title, largeTitle, onBack, opaque }: Pick<HeaderProps, 'role' | 'title' | 'largeTitle' | 'onBack' | 'opaque'>): IosHeaderOptions {
  return {
    headerShown: true,
    title,
    headerLargeTitle: role === 'top' && largeTitle !== false,
    headerTransparent: role !== 'modal' && !opaque,
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    headerBackVisible: (role === 'detail' || role === 'workspace') && !onBack,
    headerTitleAlign: 'center',
  };
}
