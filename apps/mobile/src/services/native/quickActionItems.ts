// Home-screen quick actions / app shortcuts (MX-08, 06 §7.6, MD-184). Pure: the four items, their titles (the shared
// launcher labels where desktop has the same action), icons and the link each opens. Each link goes through the
// shared allowlist when pressed; a link only navigates (06 §6.6).
import { LAUNCHER_ACTIONS, launcherActionLabel, launcherActionLink, type LauncherAction } from '@generatorai/shared/ui-contract';

export interface QuickActionItem {
  id: 'new-chat' | 'home' | 'workflows' | 'search';
  title: string;
  /** iOS only (Android shortcuts have no subtitle). */
  subtitle: string | null;
  /** iOS: `symbol:<SF Symbol>`; Android: the adaptive mipmap the config plugin generates. */
  icon: string;
  params: { href: string };
}

/** Android mipmap names (app.config.ts `androidIcons`). */
export const ANDROID_SHORTCUT_ICONS: Record<QuickActionItem['id'], string> = {
  'new-chat': 'shortcut_new_chat',
  home: 'shortcut_home',
  workflows: 'shortcut_workflows',
  search: 'shortcut_search',
};

const IOS_SYMBOLS: Record<QuickActionItem['id'], string> = {
  'new-chat': 'symbol:square.and.pencil',
  home: 'symbol:house',
  workflows: 'symbol:play',
  search: 'symbol:magnifyingglass',
};

function launcher(match: (a: LauncherAction) => boolean): LauncherAction {
  const action = LAUNCHER_ACTIONS.find(match);
  if (!action) throw new Error('LAUNCHER_ACTIONS lost an action the quick actions use');
  return action;
}

/** The items in board order (MShortcuts): New chat, Home ("3 need you"), Run workflow…, Search. iOS shows at most 4. */
export function quickActionItems(needsYou: number, platform: 'ios' | 'android'): QuickActionItem[] {
  const newChat = launcher((a) => a.kind === 'command' && a.command === 'chat.new');
  const home = launcher((a) => a.kind === 'destination' && a.destination === 'home');
  const icon = (id: QuickActionItem['id']) => (platform === 'ios' ? IOS_SYMBOLS[id] : ANDROID_SHORTCUT_ICONS[id]);
  return [
    { id: 'new-chat', title: launcherActionLabel(newChat), subtitle: null, icon: icon('new-chat'), params: { href: launcherActionLink(newChat) } },
    { id: 'home', title: launcherActionLabel(home), subtitle: needsYou > 0 ? `${needsYou} need you` : null, icon: icon('home'), params: { href: launcherActionLink(home) } },
    // The search palette with the Workflows group first; there is no separate run picker (04 §1.6, MDF-130).
    { id: 'workflows', title: 'Run workflow…', subtitle: null, icon: icon('workflows'), params: { href: 'generatorai:///search?kind=workflows' } },
    { id: 'search', title: 'Search', subtitle: null, icon: icon('search'), params: { href: 'generatorai:///search' } },
  ];
}

/** The link a pressed quick action carries, or null for anything that is not ours. */
export function quickActionHref(action: { params?: Record<string, unknown> | null } | null | undefined): string | null {
  const href = action?.params?.['href'];
  return typeof href === 'string' && href.startsWith('generatorai://') ? href : null;
}
