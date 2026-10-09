// Routes that are presented over the stack — sheets, the search palette, the server picker and the full-screen
// editors (MD-21). One list for the (app) stack's presentation options and for the cold-start restore rule: a
// presented route restored on a cold start opens with nothing underneath it, and an editor or decision restored
// half an hour later is stale (lastRouteRules). Pure.

/** Decision sheets (approval detent). */
export const SHEET_ROUTES = ['chats/[id]/gate/[interactionId]', 'workflows/[id]/runs/[runId]/approval/[stageRunId]', 'scope-request'] as const;

/** Full-screen modal editors (MD-21). */
export const EDITOR_ROUTES = [
  'workflows/new', 'workflows/[id]/edit', 'projects/new', 'projects/[id]/skills/[configId]/edit', 'agents/create', 'agents/[id]/edit',
  'automations/new', 'automations/[id]/edit', 'settings/mcp/add',
] as const;

/** Route sheets at the large detent. */
export const LARGE_SHEET_ROUTES = [
  'workflows/[id]/run', 'chats/[id]/turn', 'chats/new', 'workspaces/[workspaceId]/commit', 'projects/[id]/add-codebase', 'agents/new',
  'agents/import', 'automations/[id]/executions/[executionId]', 'scripts/[id]/run', 'pickers/model', 'share',
] as const;

export const PALETTE_ROUTE = 'search';
export const PICKER_ROUTE = 'servers';

const PRESENTED = [...SHEET_ROUTES, ...LARGE_SHEET_ROUTES, PALETTE_ROUTE, PICKER_ROUTE];

/** `chats/[id]/turn` → /^\/chats\/[^/]+\/turn\/?$/; `nested` also matches the screens of the route's own stack. */
function pattern(route: string, nested = false): RegExp {
  const body = route
    .split('/')
    .map((segment) => (/^\[[^\]]+\]$/.test(segment) ? '[^/]+' : segment.replace(/[.*+?^${}()|\\]/g, '\\$&')))
    .join('\\/');
  return new RegExp(`^\\/${body}${nested ? '(?:\\/.*)?' : '\\/?'}$`);
}

// An editor can be a stack of its own (`workflows/[id]/edit` holds the stage editor, add stage, versions…).
const PATTERNS = [...PRESENTED.map((r) => pattern(r)), ...EDITOR_ROUTES.map((r) => pattern(r, true))];

/** Is this pathname (query ignored) a presented route — a sheet, the palette, the picker or an editor? */
export function isPresentedRoute(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? '';
  return PATTERNS.some((re) => re.test(path));
}
