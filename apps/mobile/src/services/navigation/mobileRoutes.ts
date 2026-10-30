// The mobile half of link resolution (04 §1.6, MG-20, MD-34, MD-145). `deepLinkToRoute` (shared) has already reduced
// an untrusted path to an allowlisted, web-shaped route; this maps it onto the mobile route tree, which mirrors web
// paths (MD-79) but builds some screens later. Roots the app has no screen for are rejected (null → Home). Pure.

/** First path segments with a screen in the (app) tree. */
const ROOTS = new Set(['', 'chats', 'projects', 'agents', 'workflows', 'automations', 'scripts', 'settings', 'needs-you', 'search', 'servers', 'scope-request', 'share']);

/** Settings sections (web SETTINGS_NAV ids + the device rows); anything else → /settings. */
const SETTINGS_SECTIONS = new Set([
  'general', 'appearance', 'providers', 'agents', 'skills', 'mcp', 'templates',
  'source-control', 'browser-terminal', 'computer-use', 'audio', 'extensions', 'security', 'storage', 'diagnostics',
  'notifications', 'app-lock', 'widgets',
]);

/** `/x/new` create links: the module's own creation UI until its route lands (New chat is `/chats/new` since M6-05). */
const CREATE: Record<string, string> = {
  chats: '/chats/new',
  workflows: '/workflows/new',
  projects: '/projects/new',
  agents: '/agents/new',
  automations: '/automations/new',
  scripts: '/scripts',
};

function withQuery(path: string, query: string): string {
  if (!query) return path;
  return path.includes('?') ? `${path}&${query}` : `${path}?${query}`;
}

/**
 * Map an allowlisted route (output of `deepLinkToRoute`) to the mobile tree, or null when the app has no screen for
 * it (the legacy `runs`, `changes`, `terminal`, `approvals` roots).
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

  // New chat keeps its entry params (`?project=&agent=`).
  if (id === 'new' && parts.length === 2 && CREATE[root]) return root === 'chats' ? withQuery(CREATE[root]!, query) : CREATE[root]!;

  switch (root) {
    case 'chats':
      // The plan sheet became the pane's Plan tab (M6-11): open the chat there, on that plan.
      if (id && sub === 'plan' && subId) return withQuery(`/chats/${id}`, `dock=plan&plan=${encodeURIComponent(subId)}${query ? `&${query}` : ''}`);
      return route;
    case 'settings': {
      if (!id) return withQuery('/settings', query);
      return SETTINGS_SECTIONS.has(id) ? `/settings/${id}` : '/settings';
    }
    case 'workflows':
      // The builder (`/workflows/<id>/edit`, M8-05), runs, their stages and the stage approval sheet (MB-50) have routes.
      return route;
    case 'automations':
      // The webhook credentials are a section of the automation (MD-169); edit and executions have their routes.
      if (id && sub === 'webhook') return `/automations/${id}`;
      if (id && sub === 'executions' && !subId) return `/automations/${id}`;
      return route;
    case 'agents':
      // `/agents/<id>` and `/agents/<id>/edit` have screens since M7-03 (MD-83).
      if (id && sub && sub !== 'edit') return `/agents/${id}`;
      return route;
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
