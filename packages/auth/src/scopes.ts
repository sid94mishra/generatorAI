// ────────────────────────────────────────────────────────────────
// Authorization scopes
//
// Every REST route, SSE subscription, WebSocket upgrade and RPC method maps
// to one or more scopes. Transport NEVER implies authorization — a request
// arriving over loopback, SSH or the relay is authorized identically.
// ────────────────────────────────────────────────────────────────

export const SCOPES = [
  'read:status',
  'read:projects',
  'read:workspaces',
  'read:chats',
  'read:workflows',
  'read:files',
  'read:reviews',
  // Subscribe to the global lifecycle feed (entity created/state changed/
  // deleted) without seeing transcripts. Never carries `harness.*` or content
  // events for non-admin holders — `routes/stream.ts` restricts a `global`
  // subscription held under this scope to `LIFECYCLE_EVENT_KINDS` server-side,
  // regardless of the client's own filter. Exists so a paired phone or browser
  // can keep its chat/run/automation LISTS live without `admin:settings`, which
  // is what `global` used to demand and which no default grant carries.
  'read:activity',
  'write:projects',
  'write:workspaces',
  'write:chats',
  'write:workflows',
  'write:files',
  'write:reviews',
  'stream:events',
  'exec:agent',
  'exec:terminal',
  'exec:browser',
  // Answering a Computer Use consent prompt and revoking its grants. Separate
  // from `exec:browser` because it authorises control of the physical machine,
  // and separate from `exec:agent` so approving an agent's QUESTION never
  // implies approving its access to the desktop.
  'exec:computer',
  'admin:harnesses',
  'admin:credentials',
  'admin:devices',
  'admin:settings',
  'admin:relay',
] as const;

export type Scope = (typeof SCOPES)[number];

const SCOPE_SET = new Set<string>(SCOPES);

export function isScope(value: string): value is Scope {
  return SCOPE_SET.has(value);
}

export function parseScopes(values: readonly string[]): Scope[] {
  return values.filter(isScope);
}

/** Everything — used by the local desktop principal and the legacy API key. */
export const ALL_SCOPES: readonly Scope[] = SCOPES;

/**
 * Default grant for a newly paired interactive device (web browser / desktop
 * on another machine). Deliberately excludes `admin:*`, `exec:terminal`,
 * `exec:browser` and `exec:computer`; those must be granted explicitly per
 * device.
 */
export const DEFAULT_DEVICE_SCOPES: readonly Scope[] = [
  'read:status',
  'read:projects',
  'read:workspaces',
  'read:chats',
  'read:workflows',
  'read:files',
  'read:reviews',
  'read:activity',
  'write:chats',
  'write:workflows',
  'write:reviews',
  'stream:events',
  'exec:agent',
];

/**
 * Default grant for a mobile companion device: chats, status, approvals and
 * diffs. Per the plan (§20.6) terminal/browser control is explicitly withheld
 * until a user grants it.
 */
export const DEFAULT_MOBILE_SCOPES: readonly Scope[] = [
  'read:status',
  'read:projects',
  'read:workspaces',
  'read:chats',
  'read:workflows',
  'read:files',
  'read:reviews',
  'read:activity',
  'write:chats',
  'write:reviews',
  'stream:events',
  'exec:agent',
];

/**
 * Standalone preset for a phone the user physically holds and uses as a FULL
 * client (plan MOBILE_STANDALONE_CLIENT_PLAN §5.1): the companion grant plus
 * workspace/file/workflow/project authoring and terminal + browser control.
 * `exec:computer` and every `admin:*` scope stay per-device opt-in — they
 * are granted from a trusted device, never selected at pairing time.
 */
export const STANDALONE_MOBILE_SCOPES: readonly Scope[] = [
  ...DEFAULT_MOBILE_SCOPES,
  'write:workspaces',
  'write:files',
  'write:workflows',
  'write:projects',
  'exec:terminal',
  'exec:browser',
];

/** Default grant for a CLI device — adds terminal/workspace authority. */
export const DEFAULT_CLI_SCOPES: readonly Scope[] = [
  ...DEFAULT_DEVICE_SCOPES,
  'write:projects',
  'write:workspaces',
  'write:files',
  'exec:terminal',
];

/** Scopes that must never be attached to a signed link. */
/**
 * Default grant for an MCP server in remote mode (PD-22): read and start
 * workflow runs and follow them. Authoring (`write:workflows`) is asked for
 * explicitly with `device invite --platform mcp --scopes …`.
 */
export const DEFAULT_MCP_SCOPES: readonly Scope[] = ['read:status', 'read:workflows', 'stream:events', 'exec:agent'];

export const SIGNED_LINK_FORBIDDEN_SCOPES: readonly Scope[] = [
  'exec:terminal',
  'exec:browser',
  'admin:harnesses',
  'admin:credentials',
  'admin:devices',
  'admin:settings',
  'admin:relay',
];

/** Scopes considered high risk; granting them produces a high-severity audit event. */
export const HIGH_RISK_SCOPES: readonly Scope[] = [
  'exec:terminal',
  'exec:browser',
  'admin:credentials',
  'admin:devices',
  'admin:settings',
  'admin:relay',
];

export function hasScope(granted: readonly string[], required: Scope): boolean {
  return granted.includes(required);
}

/** True when EVERY required scope is present. */
export function hasAllScopes(granted: readonly string[], required: readonly Scope[]): boolean {
  return required.every((scope) => granted.includes(scope));
}

/** True when `subset` ⊆ `superset`. Used so a caller cannot grant beyond its own authority. */
export function isScopeSubset(subset: readonly string[], superset: readonly string[]): boolean {
  const sup = new Set(superset);
  return subset.every((scope) => sup.has(scope));
}

export function missingScopes(granted: readonly string[], required: readonly Scope[]): Scope[] {
  return required.filter((scope) => !granted.includes(scope));
}

/** Normalizes + de-duplicates a scope list, dropping anything unrecognized. */
export function normalizeScopes(values: readonly string[] | undefined): Scope[] {
  if (!values) return [];
  return [...new Set(parseScopes(values))].sort() as Scope[];
}
