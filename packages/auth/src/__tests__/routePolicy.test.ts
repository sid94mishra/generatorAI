import { describe, expect, it } from 'vitest';

import { resolveRoutePolicy, DEFAULT_POLICY, ROUTE_POLICIES } from '../routePolicy.js';
import {
  DEFAULT_CLI_SCOPES,
  DEFAULT_DEVICE_SCOPES,
  DEFAULT_MOBILE_SCOPES,
  SCOPES,
  hasAllScopes,
  type Scope,
} from '../scopes.js';

/** Mirrors the middleware: safe methods need `read`, everything else `write`. */
function required(path: string, method: 'GET' | 'POST'): Scope[] {
  const policy = resolveRoutePolicy(path);
  const base = method === 'GET' ? policy.read : policy.write;
  return [...base, ...(policy.always ?? [])];
}

function allowed(scopes: readonly string[], path: string, method: 'GET' | 'POST'): boolean {
  const policy = resolveRoutePolicy(path);
  if (policy.public) return true;
  return hasAllScopes(scopes, required(path, method));
}

describe('route policy — resolution', () => {
  it('falls back to an admin-only policy for an unclassified route', () => {
    // Fail closed: a route nobody classified must not be reachable by a
    // low-privilege device just because it was forgotten.
    expect(resolveRoutePolicy('/something-nobody-registered')).toBe(DEFAULT_POLICY);
    expect(DEFAULT_POLICY.read).toContain('admin:settings');
  });

  it('prefers the longest matching prefix', () => {
    // `/workspaces/:id/terminals` must beat `/workspaces`, or terminal
    // access silently degrades to the workspace scope.
    expect(resolveRoutePolicy('/workspaces/w1/terminals/t1').read).toEqual(['exec:terminal']);
    expect(resolveRoutePolicy('/workspaces/w1').read).toEqual(['read:workspaces']);
  });

  it('exposes pairing preview publicly without opening the pairing admin API', () => {
    // The joining device holds only a pairing code, so it must be able to ask
    // what that code grants before redeeming it.
    expect(resolveRoutePolicy('/auth/pair/preview').public).toBe(true);

    // ...but the surrounding pairing API stays admin-only. If longest-prefix
    // matching ever regressed, `/auth/pair` would inherit the public policy
    // and let an unauthenticated caller mint grants.
    expect(resolveRoutePolicy('/auth/pair').public).toBeFalsy();
    expect(resolveRoutePolicy('/auth/pair').write).toContain('admin:devices');
    expect(resolveRoutePolicy('/auth/pair/pending').public).toBeFalsy();
    expect(allowed([], '/auth/pair', 'POST')).toBe(false);
    expect(allowed([], '/auth/pair/pending', 'GET')).toBe(false);
    expect(allowed([], '/auth/pair/preview', 'POST')).toBe(true);
  });

  it('matches `:param` segments positionally', () => {
    expect(resolveRoutePolicy('/workspaces/any-id-at-all/browser').read).toEqual(['exec:browser']);
  });

  it('exposes the webhook delivery endpoint publicly without opening automations admin', () => {
    // A webhook sender (GitHub, Stripe, a cron pinger) can never hold
    // `write:workflows` + `exec:agent` — the route authenticates itself via
    // the per-automation token (path or header) and an optional HMAC
    // signature, not the caller's scopes.
    expect(resolveRoutePolicy('/automations/webhooks/abc123').public).toBe(true);
    expect(allowed([], '/automations/webhooks/abc123', 'POST')).toBe(true);

    // ...but the surrounding automations admin API stays scope-gated. If
    // longest-prefix matching ever regressed, '/automations' would inherit
    // the public policy and let an unauthenticated caller list/create them.
    expect(resolveRoutePolicy('/automations').public).toBeFalsy();
    expect(resolveRoutePolicy('/automations/a1').public).toBeFalsy();
    // The v1 /webhooks routes are gone; no public entry may survive them.
    expect(resolveRoutePolicy('/webhooks/github').public).toBeFalsy();
    expect(allowed([], '/automations', 'GET')).toBe(false);
    expect(allowed([], '/automations', 'POST')).toBe(false);
  });

  it('only lists scopes that actually exist', () => {
    // A typo'd scope silently becomes unsatisfiable, locking everyone out of
    // the route with a 403 that looks like a permissions bug.
    const known = new Set<string>(SCOPES);
    for (const policy of ROUTE_POLICIES) {
      for (const scope of [...policy.read, ...policy.write, ...(policy.always ?? [])]) {
        expect(known.has(scope), `${policy.prefix} references unknown scope "${scope}"`).toBe(true);
      }
    }
  });

  it('splits agent READING from agent AUTHORING', () => {
    // AGT-01: an agent bundles skills, MCP servers and a tool policy, so
    // authoring one is a capability grant and must sit behind `admin:settings`.
    // READING the catalog is not — a paired device has to be able to list
    // agents in order to pick one when starting a chat.
    expect(resolveRoutePolicy('/agents').read).toEqual(['read:workflows']);
    expect(resolveRoutePolicy('/agents').write).toContain('admin:settings');
    expect(resolveRoutePolicy('/agents/some-id/export').write).toContain('admin:settings');

    // A device with only run-time scopes may browse but not author.
    const runtimeOnly = ['read:workflows', 'exec:agent'];
    expect(allowed(runtimeOnly, '/agents', 'GET')).toBe(true);
    expect(allowed(runtimeOnly, '/agents', 'POST')).toBe(false);
    expect(allowed(runtimeOnly, '/agents/import', 'POST')).toBe(false);
  });
});

describe('route policy — mobile device authority', () => {
  const mobile = DEFAULT_MOBILE_SCOPES;

  it('can answer a stage HITL gate', () => {
    // Approving a gate IS "answer the agent's question" — `exec:agent`, a
    // RUN-TIME authority. Requiring `write:workflows` here would conflate it
    // with the DESIGN-TIME right to edit a workflow, and would lock out the
    // one client the approval flow exists for.
    // The commands route admits `exec:agent`; the route itself refuses
    // every command other than `approve` without `write:workflows`.
    expect(allowed(mobile, '/workflow-runs/r1/commands', 'POST')).toBe(true);
  });

  it('still cannot control the run itself', () => {
    // The narrowing above is surgical: operating a run is a different act
    // from answering it, and remains behind the full write grant (the
    // non-approve commands are refused by the commands route itself).
    for (const path of [
      '/workflow-runs',
      '/workflow-runs/r1/start',
      '/workflow-runs/r1/fork',
    ]) {
      expect(allowed(mobile, path, 'POST'), `should NOT be able to POST ${path}`).toBe(false);
    }
  });

  it('cannot edit workflow definitions', () => {
    expect(allowed(mobile, '/workflow-definitions', 'POST')).toBe(false);
    expect(allowed(mobile, '/workflow-definitions/d1/stages', 'POST')).toBe(false);
  });

  it('cannot trigger or modify automations', () => {
    expect(allowed(mobile, '/automations/a1/trigger', 'POST')).toBe(false);
    expect(allowed(mobile, '/automations', 'POST')).toBe(false);
  });

  it('cannot reach the terminal or the browser', () => {
    // Asserted independently of the app so a scope-list edit cannot quietly
    // hand a phone the ability to run shell commands.
    for (const path of ['/workspaces/w1/terminals', '/workspaces/w1/browser']) {
      expect(allowed(mobile, path, 'GET'), `should NOT read ${path}`).toBe(false);
      expect(allowed(mobile, path, 'POST'), `should NOT write ${path}`).toBe(false);
    }
  });

  it('holds no administrative authority at all', () => {
    for (const path of [
      '/auth/devices',
      '/auth/pair',
      '/auth/service-accounts',
      '/relay',
      '/system',
      '/extensions',
      '/harness',
    ]) {
      expect(allowed(mobile, path, 'POST'), `should NOT write ${path}`).toBe(false);
    }
    expect(mobile.some((s) => s.startsWith('admin:'))).toBe(false);
  });

  it('can read everything it needs to be useful', () => {
    for (const path of [
      '/workflow-runs',
      '/workflow-runs/r1',
      '/workflow-definitions',
      '/automations',
      '/automations/a1/executions',
      '/projects',
      '/workspaces',
      '/workspaces/w1/changes',
      '/workspaces/w1/review/threads',
      '/chats',
      '/stream',
      '/health',
      '/auth/server-info',
      '/security',
    ]) {
      expect(allowed(mobile, path, 'GET'), `should be able to GET ${path}`).toBe(true);
    }
  });

  it('can converse and review, which is the point of the app', () => {
    expect(allowed(mobile, '/chats', 'POST')).toBe(true);
    expect(allowed(mobile, '/workspaces/w1/review/threads', 'POST')).toBe(true);
    expect(allowed(mobile, '/workspaces/w1/review/submit', 'POST')).toBe(true);
    expect(allowed(mobile, '/stt', 'POST')).toBe(true);
  });

  it('can register its own push token without admin authority', () => {
    // Push exists FOR this client. Requiring `admin:devices` — which the
    // sibling `/auth/devices` prefix uses — would make it unusable.
    //
    // This is only safe because the route derives the device id from the
    // authenticated principal and never reads one from the body, so a device
    // can write its own row and no other. See apps/server/src/routes/auth.ts.
    expect(allowed(mobile, '/auth/push-token', 'PUT' as 'POST')).toBe(true);
    expect(allowed(mobile, '/auth/push-token/mute', 'POST')).toBe(true);
  });

  it('still cannot list or revoke devices', () => {
    // The narrowing above must not have widened the sibling admin routes,
    // which is exactly what a too-short prefix would have done.
    expect(allowed(mobile, '/auth/devices', 'GET')).toBe(false);
    expect(allowed(mobile, '/auth/devices/d1/revoke', 'POST')).toBe(false);
    expect(allowed(mobile, '/auth/pair', 'POST')).toBe(false);
  });

  it('cannot mutate projects or source-control configuration', () => {
    expect(allowed(mobile, '/projects', 'POST')).toBe(false);
    expect(allowed(mobile, '/source-control/config', 'POST')).toBe(false);
  });
});

describe('route policy — other principals keep their authority', () => {
  it('a CLI device can operate runs and the terminal', () => {
    expect(allowed(DEFAULT_CLI_SCOPES, '/workspaces/w1/terminals', 'POST')).toBe(true);
    expect(allowed(DEFAULT_CLI_SCOPES, '/workspaces/w1', 'POST')).toBe(true);
  });

  it('a paired interactive device cannot reach the terminal by default', () => {
    // The desktop/web default grant is broader than mobile but still
    // withholds shell access until it is granted explicitly.
    expect(allowed(DEFAULT_DEVICE_SCOPES, '/workspaces/w1/terminals', 'POST')).toBe(false);
  });

  it('running a workflow script needs exec:agent, not just write:workflows', () => {
    // POST /workflow-scripts/:id/run materialises a definition and STARTS a
    // run, so it must match `/workflow-runs` (write:workflows + exec:agent).
    const designOnly = ['read:workflows', 'write:workflows'];
    expect(allowed(designOnly, '/workflow-scripts/s1/run', 'POST')).toBe(false);
    expect(allowed([...designOnly, 'exec:agent'], '/workflow-scripts/s1/run', 'POST')).toBe(true);
    expect(resolveRoutePolicy('/workflow-scripts/s1/run').write).toEqual(['write:workflows', 'exec:agent']);

    // Authoring and reading scripts are unchanged.
    expect(allowed(designOnly, '/workflow-scripts/s1/materialize', 'POST')).toBe(true);
    expect(allowed(designOnly, '/workflow-scripts/reload', 'POST')).toBe(true);
    expect(allowed(['read:workflows'], '/workflow-scripts/s1/profiles', 'GET')).toBe(true);
    expect(allowed(['read:workflows'], '/workflow-scripts', 'GET')).toBe(true);
  });

  it('the HITL narrowing did not widen anything for a read-only principal', () => {
    const readOnly = ['read:workflows'];
    expect(allowed(readOnly, '/workflow-runs/r1/commands', 'POST')).toBe(false);
    expect(allowed(readOnly, '/workflow-runs/r1/commands', 'GET')).toBe(true);
  });
});
