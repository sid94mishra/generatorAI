// ────────────────────────────────────────────────────────────────
// Route policy — the authoritative operation → scope table.
//
// Every `/api/*` path prefix must resolve to a policy entry. Anything that
// does not match falls through to `DEFAULT_POLICY`, which requires admin
// authority: an un-classified route fails closed rather than open.
//
// `scripts/check-route-scopes.mjs` asserts that every router mounted in
// `apps/server/src/routes/index.ts` is represented here.
// ────────────────────────────────────────────────────────────────

import type { Scope } from './scopes.js';

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export interface RoutePolicy {
  /** Path prefix under `/api`, e.g. `/chats`. */
  prefix: string;
  /** Scopes required for safe (GET/HEAD) methods. */
  read: Scope[];
  /** Scopes required for mutating methods. */
  write: Scope[];
  /** Extra scopes required regardless of method. */
  always?: Scope[];
  /** Reachable without any credential (health, webhooks with their own HMAC). */
  public?: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
}

export const DEFAULT_POLICY: RoutePolicy = {
  prefix: '*',
  read: ['admin:settings'],
  write: ['admin:settings'],
  riskLevel: 'high',
};

export const ROUTE_POLICIES: RoutePolicy[] = [
  // Public — health probes and webhook receivers (own HMAC verification).
  { prefix: '/health', read: [], write: [], public: true },
  { prefix: '/webhooks', read: [], write: [], public: true },
  // Auth bootstrap. Pairing completion is deliberately public: the caller has
  // no credential yet, and the single-use pairing grant IS the credential.
  { prefix: '/auth/pair/complete', read: [], write: [], public: true },
  // Public for the same reason as /pair/complete: the joining device holds
  // only the pairing code, and it must be able to see what that code grants
  // before redeeming it. Returns no credential and does not consume the grant.
  // Longest-prefix matching keeps this ahead of the admin-scoped '/auth/pair'.
  { prefix: '/auth/pair/preview', read: [], write: [], public: true },
  { prefix: '/auth/token/refresh', read: [], write: [], public: true },
  { prefix: '/auth/nonce', read: [], write: [], public: true },
  { prefix: '/auth/server-info', read: [], write: [], public: true },
  { prefix: '/auth/devices', read: ['admin:devices'], write: ['admin:devices'], riskLevel: 'high' },
  { prefix: '/auth/pair', read: ['admin:devices'], write: ['admin:devices'], riskLevel: 'high' },
  { prefix: '/auth/service-accounts', read: ['admin:credentials'], write: ['admin:credentials'], riskLevel: 'high' },
  { prefix: '/auth/audit', read: ['admin:settings'], write: ['admin:settings'] },
  // A device registering its OWN push token. Deliberately `read:status`
  // rather than `admin:devices`: the route derives the device id from the
  // authenticated principal and never accepts one from the body, so a device
  // can only ever write its own row. Requiring an admin scope here would
  // make push unusable from the one client it exists for.
  { prefix: '/auth/push-token', read: ['read:status'], write: ['read:status'] },
  { prefix: '/auth', read: ['read:status'], write: ['read:status'] },

  { prefix: '/security', read: ['read:status'], write: ['admin:settings'], riskLevel: 'high' },
  { prefix: '/relay', read: ['admin:relay'], write: ['admin:relay'], riskLevel: 'high' },

  { prefix: '/stream', read: ['stream:events'], write: ['stream:events'] },

  { prefix: '/chats', read: ['read:chats'], write: ['write:chats'] },
  { prefix: '/orchestrator', read: ['read:chats'], write: ['write:chats', 'exec:agent'] },
  { prefix: '/sessions', read: ['read:chats'], write: ['write:chats'] },

  { prefix: '/workflow-definitions', read: ['read:workflows'], write: ['write:workflows'] },
  // Answering a stage's Human-In-The-Loop gate is a RUN-TIME act — it is
  // literally "answer the agent's question", which is what `exec:agent`
  // means. Requiring `write:workflows` here would conflate that with the
  // DESIGN-TIME authority to edit a workflow definition, and would lock out
  // exactly the client the approval flow exists for: a paired mobile device,
  // whose default grant includes `exec:agent` but deliberately excludes
  // `write:workflows` (see DEFAULT_MOBILE_SCOPES).
  //
  // Longest-prefix matching means these two entries win over `/workflow-runs`
  // for their own paths only; everything else about a run (start, pause,
  // cancel, retry, delete) still needs the full write grant.
  {
    prefix: '/workflow-runs/:id/stages/:stageId/approve',
    read: ['read:workflows'],
    write: ['exec:agent'],
  },
  {
    prefix: '/workflow-runs/:id/stages/:stageId/interrupt',
    read: ['read:workflows'],
    write: ['exec:agent'],
  },
  { prefix: '/workflow-runs', read: ['read:workflows'], write: ['write:workflows', 'exec:agent'] },
  { prefix: '/workflow-scripts', read: ['read:workflows'], write: ['write:workflows'] },
  { prefix: '/automations', read: ['read:workflows'], write: ['write:workflows', 'exec:agent'] },
  { prefix: '/templates', read: ['read:workflows'], write: ['write:workflows'] },
  { prefix: '/hooks', read: ['read:workflows'], write: ['write:workflows'] },

  { prefix: '/projects', read: ['read:projects'], write: ['write:projects'] },
  { prefix: '/source-control', read: ['read:projects'], write: ['write:projects'] },

  // Workspace sub-resources are matched more specifically first (see
  // `resolveRoutePolicy`, which prefers the longest matching prefix).
  { prefix: '/workspaces/:id/terminals', read: ['exec:terminal'], write: ['exec:terminal'], riskLevel: 'high' },
  { prefix: '/workspaces/:id/browser', read: ['exec:browser'], write: ['exec:browser'], riskLevel: 'high' },
  { prefix: '/workspaces/:id/review', read: ['read:reviews'], write: ['write:reviews'] },
  { prefix: '/workspaces', read: ['read:workspaces'], write: ['write:workspaces'] },

  { prefix: '/harness', read: ['read:status'], write: ['admin:harnesses'], riskLevel: 'high' },
  { prefix: '/copilot', read: ['read:status'], write: ['admin:harnesses'] },
  { prefix: '/system', read: ['read:status'], write: ['admin:settings'], riskLevel: 'high' },

  { prefix: '/extensions', read: ['read:status'], write: ['admin:settings'], riskLevel: 'high' },
  { prefix: '/widgets', read: ['read:status'], write: ['write:chats'] },
  { prefix: '/widget-assets', read: [], write: [], public: true },

  { prefix: '/stt', read: ['write:chats'], write: ['write:chats'] },

  // OpenAPI docs.
  { prefix: '/openapi.json', read: [], write: [], public: true },
  { prefix: '/docs', read: [], write: [], public: true },
];

const SAFE_METHODS = new Set<string>(['GET', 'HEAD', 'OPTIONS']);

/**
 * Resolves the policy for an `/api`-relative path, preferring the longest
 * matching prefix so `/workspaces/x/terminals` beats `/workspaces`.
 */
export function resolveRoutePolicy(apiPath: string): RoutePolicy {
  const normalized = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  let best: RoutePolicy | null = null;
  let bestScore = -1;
  for (const policy of ROUTE_POLICIES) {
    const score = matchScore(normalized, policy.prefix);
    if (score > bestScore) {
      bestScore = score;
      best = policy;
    }
  }
  return best && bestScore >= 0 ? best : DEFAULT_POLICY;
}

/**
 * Segment-aware prefix match supporting `:param` wildcards.
 * Returns the number of matched segments, or -1 for no match.
 */
function matchScore(path: string, prefix: string): number {
  const pathSegments = path.split('/').filter(Boolean);
  const prefixSegments = prefix.split('/').filter(Boolean);
  if (prefixSegments.length > pathSegments.length) return -1;
  for (let i = 0; i < prefixSegments.length; i += 1) {
    const expected = prefixSegments[i]!;
    if (expected.startsWith(':')) continue;
    if (expected !== pathSegments[i]) return -1;
  }
  return prefixSegments.length;
}

/** Scopes required for a concrete (method, path) pair. */
export function requiredScopesFor(method: string, apiPath: string): {
  policy: RoutePolicy;
  scopes: Scope[];
} {
  const policy = resolveRoutePolicy(apiPath);
  if (policy.public) return { policy, scopes: [] };
  const base = SAFE_METHODS.has(method.toUpperCase()) ? policy.read : policy.write;
  return { policy, scopes: [...new Set([...base, ...(policy.always ?? [])])] };
}
