// The app's destinations, as the legacy navigation drawer lists them, on the M5 route tree: every destination is
// its own module root (MD-79). Replaced by the Drawer on NAV_DESTINATIONS in M5-02.
import { isModuleRoot } from '../../blocks/shell/parentHref';

export type ShellSection = 'home' | 'projects' | 'chats' | 'agents' | 'workflows' | 'scripts' | 'automations';

export interface ShellSectionDef {
  id: ShellSection;
  label: string;
  href: string;
}

export const SHELL_SECTIONS: readonly ShellSectionDef[] = [
  { id: 'home', label: 'Home', href: '/' },
  { id: 'projects', label: 'Projects', href: '/projects' },
  { id: 'chats', label: 'Chats', href: '/chats' },
  { id: 'agents', label: 'Agents', href: '/agents' },
  { id: 'workflows', label: 'Workflows', href: '/workflows' },
  { id: 'scripts', label: 'Scripts', href: '/scripts' },
  { id: 'automations', label: 'Automations', href: '/automations' },
];

/** Which drawer row is lit for a pathname: a detail lights its module. */
export function sectionForPath(pathname: string): ShellSection | null {
  const path = (pathname.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
  if (path === '/') return 'home';
  const root = path.split('/')[1];
  return SHELL_SECTIONS.find((s) => s.id === root)?.id ?? null;
}

/** The drawer opens on module roots only; details have Back. */
export function drawerAvailable(pathname: string): boolean {
  return isModuleRoot(pathname) && !pathname.startsWith('/settings');
}
