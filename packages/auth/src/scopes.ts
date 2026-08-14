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
  'write:chats',
  'write:reviews',
  'stream:events',
  'exec:agent',
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
