// Where Back goes when there is no history to pop (06 §3.2, MD-87, MD-88): a screen reached by a link, a
// notification or a cold-start restore is the root of the stack, so Back walks up the IA instead (a run → its
// workflow → Workflows). A module root goes to Home (MD-88); Home and the public screens return null (Android
// backgrounds the app). Pure, unit-tested.
import { NAV_DESTINATIONS } from '@generatorai/shared/ui-contract';

const PUBLIC = new Set(['/pair', '/revoked']);
const MODULE_ROOTS = new Set<string>([...NAV_DESTINATIONS.map((d) => d.path).filter((p) => p !== '/'), '/settings']);

export function normalizePath(pathname: string): string {
  const path = (pathname.split(/[?#]/)[0] ?? '').replace(/\/+$/, '');
  return path === '' || path === '/index' ? '/' : path;
}

/** True for Home, the seven module roots and Settings (header role `top`, MD-18). */
export function isModuleRoot(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path === '/' || MODULE_ROOTS.has(path);
}

export function parentHref(pathname: string): string | null {
  const path = normalizePath(pathname);
  if (path === '/' || PUBLIC.has(path)) return null;
  if (MODULE_ROOTS.has(path)) return '/';
  const parts = path.split('/').filter(Boolean);
  const [root, id, sub, subId, leaf] = parts;
  switch (root) {
    case 'chats':
      // A gate or plan sheet closes onto its chat; `/chats/new` and a chat go to Chats.
      return id && id !== 'new' && sub ? `/chats/${id}` : '/chats';
    case 'workflows':
      if (!id || id === 'new') return '/workflows';
      if (sub === 'runs' && subId) return leaf ? `/workflows/${id}/runs/${subId}` : `/workflows/${id}`;
      return sub ? `/workflows/${id}` : '/workflows';
    case 'projects':
      if (!id || id === 'new') return '/projects';
      if (sub === 'codebases' && subId) return leaf ? `/projects/${id}/codebases/${subId}` : `/projects/${id}`;
      return sub ? `/projects/${id}` : '/projects';
    case 'agents':
    case 'automations':
    case 'scripts':
      return id && sub ? `/${root}/${id}` : `/${root}`;
    case 'settings':
      return id && sub ? `/settings/${id}` : '/settings';
    default:
      // needs-you, search, servers, scope-request, the legacy changes / terminal routes, not-found.
      return '/';
  }
}
