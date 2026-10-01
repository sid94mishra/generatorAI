import { isDeepLinkCommandId, NAV_DESTINATIONS, type DeepLinkCommandId } from './commands.js';

export const DEEP_LINK_QUERY_KEYS = ['pair', 'dock', 'tab', 'kind', 'run', 'server', 'code'] as const;
/** Pairing always opens a consent UI; receiving a code never grants access. */
export const PAIRING_LINK_BEHAVIOR = 'prefill-only' as const;
export const DEEP_LINK_ROUTE_ROOTS: readonly string[] = [
  ...NAV_DESTINATIONS.map((item) => item.path.slice(1)).filter(Boolean),
  'runs', 'changes', 'settings', 'terminal', 'approvals', 'approval', 'scope-request',
  'search', 'share', 'new-chat', 'workspaces',
];
const COMMAND_ROUTES: Record<DeepLinkCommandId, string> = {
  'chat.new': '/chats/new', 'workflow.new': '/workflows/new',
};

/** Pure untrusted-input parser. It returns navigation only, never an action. */
export function deepLinkToRoute(input: unknown): string | null {
  if (typeof input !== 'string' || /[\u0000-\u0020\u007f\\]/.test(input)) return null;
  let value = input;
  if (/^generatorai:\/\//i.test(value)) value = '/' + value.slice('generatorai://'.length).replace(/^\//, '');
  else if (!value.startsWith('/') || value.startsWith('//')) return null;
  value = value.split('#', 1)[0]!;
  const question = value.indexOf('?');
  const path = question < 0 ? value : value.slice(0, question);
  const query = question < 0 ? '' : value.slice(question + 1);
  const parts: string[] = [];
  for (const part of path.slice(1).split('/')) {
    if (!part) continue;
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { return null; }
    // Reject double encodings too: no downstream decoder may reinterpret a segment.
    if (decoded === '.' || decoded === '..' || /[%/\\:?#@\u0000-\u0020\u007f]/.test(decoded)) return null;
    parts.push(encodeURIComponent(decoded));
  }
  const params = new URLSearchParams();
  const supplied = new URLSearchParams(query);
  for (const key of DEEP_LINK_QUERY_KEYS) {
    const values = supplied.getAll(key);
    if (values.length > 1) return null;
    if (values.length === 1) {
      const value = values[0]!;
      if (/[\u0000-\u001f\u007f]/.test(value)) return null;
      if (key === 'server' && !/^[A-Za-z0-9_-]+$/.test(value)) return null;
      params.set(key, value);
    }
  }
  let pathname = '/' + parts.join('/');
  if (parts[0] === 'command') {
    const command = parts[1];
    if (parts.length !== 2 || !isDeepLinkCommandId(command)) return null;
    pathname = COMMAND_ROUTES[command];
  } else if (pathname === '/pair' || (pathname === '/' && params.has('pair'))) {
    const code = params.get('code') ?? params.get('pair');
    return code === null ? '/pair' : `/pair?code=${encodeURIComponent(code)}`;
  } else if (parts.length && !DEEP_LINK_ROUTE_ROOTS.includes(parts[0]!)) return null;
  const search = params.toString();
  return pathname + (search ? `?${search}` : '');
}
