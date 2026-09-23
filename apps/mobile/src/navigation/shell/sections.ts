// ────────────────────────────────────────────────────────────────
// The app's destinations, as the navigation drawer lists them.
//
// Pure, so the rules ("which row is lit for /runs/abc", "where does Agents
// go") are unit-tested without a renderer. The order follows the desktop
// sidebar so the two clients read as one product.
//
// Several destinations share a SCENE (one mounted screen that renders the
// catalogue it is asked for): Projects and Agents share one, Workflows /
// Scripts / Automations another. The drawer addresses the catalogue through a
// `segment` param and the scene reports the one it is showing, so the lit row
// always matches. The scenes show no switcher of their own — the drawer is the
// only way between them, exactly like the desktop sidebar.
// ────────────────────────────────────────────────────────────────

export type ShellSection = 'home' | 'projects' | 'chats' | 'agents' | 'workflows' | 'scripts' | 'automations';

export interface ShellSectionDef {
  id: ShellSection;
  label: string;
  /** Tab-shell route, with the segment it opens on where one applies. */
  href: string;
  /** Rows after a divider start a new group. */
  group: 'primary' | 'work';
  /** The `Tabs.Screen` that hosts it — the key its scroll-to-top is registered under. */
  scene: 'index' | 'chats' | 'runs' | 'projects';
}

// Exactly the desktop sidebar: Dashboard, Projects, Chats, Agents, Workflows,
// Scripts, Automations. There is deliberately no "Runs" destination — on
// desktop a run lives under its workflow (`/workflows/:id/runs/:runId`), and a
// phone that listed runs separately taught a second mental model for the same
// thing. Runs are reached by opening a workflow; the ones that need a person
// or are still moving surface on Home.
export const SHELL_SECTIONS: readonly ShellSectionDef[] = [
  { id: 'home', scene: 'index', label: 'Home', href: '/(tabs)', group: 'primary' },
  { id: 'projects', scene: 'projects', label: 'Projects', href: '/(tabs)/projects?segment=projects', group: 'primary' },
  { id: 'chats', scene: 'chats', label: 'Chats', href: '/(tabs)/chats', group: 'primary' },
  { id: 'agents', scene: 'projects', label: 'Agents', href: '/(tabs)/projects?segment=agents', group: 'primary' },
  { id: 'workflows', scene: 'runs', label: 'Workflows', href: '/(tabs)/runs?segment=workflows', group: 'work' },
  { id: 'scripts', scene: 'runs', label: 'Scripts', href: '/(tabs)/runs?segment=scripts', group: 'work' },
  { id: 'automations', scene: 'runs', label: 'Automations', href: '/(tabs)/runs?segment=automations', group: 'work' },
];

export type WorkTabSegment = 'workflows' | 'automations' | 'scripts';
export type ProjectsTabSegment = 'projects' | 'agents';

export interface ShellSegments {
  work: WorkTabSegment;
  projects: ProjectsTabSegment;
}

/**
 * Which drawer row is lit for a pathname.
 *
 * Detail routes light their catalogue (`/runs/abc` → Runs, `/workflows/x` →
 * Workflows). The two shared tab roots defer to the segment the screen last
 * reported. Anything unrecognised (settings, search, pairing) lights nothing.
 */
export function sectionForPath(pathname: string, segments: ShellSegments): ShellSection | null {
  const path = (pathname.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/(tabs)' || path === '/index') return 'home';
  if (path === '/chats' || path.startsWith('/chats/')) return 'chats';
  if (path === '/runs') return segments.work;
  // A run belongs to its workflow, as on desktop.
  if (path.startsWith('/runs/')) return 'workflows';
  if (path.startsWith('/workflows/')) return 'workflows';
  if (path.startsWith('/automations/')) return 'automations';
  if (path.startsWith('/scripts/')) return 'scripts';
  if (path === '/projects') return segments.projects;
  if (path.startsWith('/projects/')) return 'projects';
  return null;
}

/** Top-level screens: the ones that show the menu button instead of Back. */
export function isShellRoot(pathname: string): boolean {
  const path = (pathname.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
  return path === '/' || path === '/(tabs)' || path === '/index' || path === '/chats' || path === '/runs' || path === '/projects';
}

/**
 * Routes the drawer can be opened on: the top-level sections only. A chat is
 * a pushed screen like any other detail screen, with Back as its leading
 * control, and its left-edge swipe belongs to the platform's back gesture.
 */
export function drawerAvailable(pathname: string): boolean {
  return isShellRoot(pathname);
}
