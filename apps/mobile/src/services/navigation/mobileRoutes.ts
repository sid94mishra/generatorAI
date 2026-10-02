// The mobile half of link resolution (04 §1.6, MG-20, MD-34, MD-145). `deepLinkToRoute` (shared) has already reduced
// an untrusted path to an allowlisted, web-shaped route; this maps it onto the mobile route tree, which mirrors web
// paths (MD-79) but builds some screens later. Roots the app has no screen for are rejected (null → Home). Pure.

/** First path segments with a screen in the (app) tree. */
const ROOTS = new Set(['', 'chats', 'projects', 'agents', 'workflows', 'automations', 'scripts', 'settings', 'needs-you', 'search', 'servers', 'scope-request']);

/** Settings sections with a screen today; web section ids that live inside one of them; anything else → /settings. */
const SETTINGS_SECTIONS = new Set([
  'appearance', 'audio', 'capabilities', 'diagnostics', 'extensions', 'notifications', 'providers', 'security', 'source-control', 'tools', 'accessibility', 'about',
]);
const SETTINGS_ALIASES: Record<string, string> = {
  'browser-terminal': 'tools',
  agents: 'capabilities',
  skills: 'capabilities',
  mcp: 'capabilities',
  templates: 'capabilities',
  'app-lock': 'accessibility',
};

/** `/x/new` create links: the module's own creation UI until its route lands (New chat M6, the rest M7/M8). */
const CREATE: Record<string, string> = {
  chats: '/chats?new=1',
  workflows: '/workflows?new=1',
  projects: '/projects?new=1',
  agents: '/agents',
  automations: '/automations',
  scripts: '/scripts',
};

function withQuery(path: string, query: string): string {
  if (!query) return path;
  return path.includes('?') ? `${path}&${query}` : `${path}?${query}`;
}

/**
 * Map an allowlisted route (output of `deepLinkToRoute`) to the mobile tree, or null when the app has no screen for
 * it (the legacy `runs`, `changes`, `terminal`, `approvals` roots; `share` until M9; `workspaces` until M6).
 */
export function mobileRoute(route: string | null): string | null {
  const mapped = mapRoute(route);
  if (!mapped || !route) return mapped;
  // A mapped route keeps the link's server, so the queue still switches to it first (MG-19).
  const server = new URLSearchParams(route.split('?')[1] ?? '').get('server');
  return server && !mapped.includes('server=') ? withQuery(mapped, `server=${encodeURIComponent(server)}`) : mapped;
}

function mapRoute(route: string | null): string | null {
  if (!route) return null;
  const q = route.indexOf('?');
  const path = q < 0 ? route : route.slice(0, q);
  const query = q < 0 ? '' : route.slice(q + 1);
  if (path === '/pair') return route;
  const parts = path.split('/').filter(Boolean);
  const [root = '', id, sub, subId, leaf] = parts;
  if (root === 'new-chat') return CREATE.chats!;
  if (!ROOTS.has(root)) return null;

  if (id === 'new' && parts.length === 2 && CREATE[root]) return CREATE[root]!;

  switch (root) {
    case 'settings': {
      if (!id) return withQuery('/settings', query);
      const section = SETTINGS_ALIASES[id] ?? id;
      return SETTINGS_SECTIONS.has(section) ? `/settings/${section}` : '/settings';
    }
    case 'workflows':
      // The builder (M8) and the stage approval sheet (M8) are not built: open the workflow / the run, whose stage
      // card answers the approval.
      if (id && sub === 'edit') return `/workflows/${id}`;
      if (id && sub === 'runs' && subId && leaf === 'approval') return withQuery(`/workflows/${id}/runs/${subId}`, query);
      return route;
    case 'automations':
      // Edit (M7) and an execution's sheet (M7): the automation itself, which lists its executions.
      if (id && (sub === 'edit' || sub === 'executions')) return `/automations/${id}`;
      return route;
    case 'agents':
      if (id && sub === 'edit') return `/agents/${id}`;
      // No agent detail screen before M7: agents open from their list.
      return id ? '/agents' : route;
    case 'scripts':
      return route;
    case 'projects':
      // Codebase tabs: `worktrees` is the codebase screen itself; `files` has its own route.
      if (id && sub === 'codebases' && subId && leaf === 'worktrees') return `/projects/${id}/codebases/${subId}`;
      return route;
    default:
      return route;
  }
}
