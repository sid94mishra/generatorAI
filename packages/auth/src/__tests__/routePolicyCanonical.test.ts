// Audit F-1 (D-115): Express routes case-insensitively and tolerates a
// trailing slash, so the route → scope policy must resolve every spelling the
// router dispatches to an entry to that SAME entry — never to a shorter,
// weaker prefix. Paths with no canonical form fail closed.

import { describe, expect, it } from 'vitest';

import {
  canonicalApiPath,
  DEFAULT_POLICY,
  requiredScopesFor,
  resolveRoutePolicy,
  ROUTE_POLICIES,
} from '../routePolicy.js';

/** A concrete path for a policy prefix (`:param` → a mixed-case id). */
function concrete(prefix: string): string {
  return prefix.replace(/:[^/]+/g, 'Id-X1');
}

function mixedCase(path: string): string {
  let upper = true;
  return path.replace(/[a-z]/gi, (ch) => {
    upper = !upper;
    return upper ? ch.toUpperCase() : ch.toLowerCase();
  });
}

/** Percent-encodes the first letter of every literal segment (`devices` → `%64evices`). */
function escapedLetters(path: string): string {
  return path
    .split('/')
    .map((seg) =>
      /^[a-z]/i.test(seg) ? `%${seg.charCodeAt(0).toString(16).toUpperCase()}${seg.slice(1)}` : seg,
    )
    .join('/');
}

const VARIANTS: Array<[string, (p: string) => string]> = [
  ['UPPER CASE', (p) => p.toUpperCase()],
  ['MiXeD case', mixedCase],
  ['Capitalised segments', (p) => p.replace(/\/([a-z])/g, (_m, c: string) => `/${c.toUpperCase()}`)],
  ['trailing slash', (p) => `${p}/`],
  ['upper case + trailing slash', (p) => `${p.toUpperCase()}/`],
  ['escaped unreserved letters', escapedLetters],
  ['sub-resource under the entry', (p) => `${mixedCase(p)}/Child`],
];

describe('route policy — canonical matching (audit F-1)', () => {
  for (const policy of ROUTE_POLICIES) {
    const base = concrete(policy.prefix);
    for (const [name, variant] of VARIANTS) {
      it(`${policy.prefix} — ${name} resolves to the same entry`, () => {
        const path = variant(base);
        const sub = name === 'sub-resource under the entry';
        const expected = sub ? resolveRoutePolicy(`${base}/child`) : policy;
        expect(resolveRoutePolicy(path), path).toBe(expected);
        for (const method of ['GET', 'POST', 'DELETE']) {
          expect(requiredScopesFor(method, path).scopes, `${method} ${path}`).toEqual(
            requiredScopesFor(method, sub ? `${base}/child` : base).scopes,
          );
        }
      });
    }
  }

  it('the audit reproductions now demand their real scopes', () => {
    expect(requiredScopesFor('GET', '/auth/Devices').scopes).toEqual(['admin:devices']);
    expect(requiredScopesFor('GET', '/auth/Audit').scopes).toEqual(['admin:settings']);
    expect(requiredScopesFor('POST', '/auth/Pair').scopes).toEqual(['admin:devices']);
    expect(requiredScopesFor('DELETE', '/auth/Devices/d1').scopes).toEqual(['admin:devices']);
    expect(requiredScopesFor('GET', '/workspaces/x/Terminals').scopes).toEqual(['exec:terminal']);
    expect(requiredScopesFor('GET', '/workspaces/x/Computer/control').scopes).toEqual(['exec:computer']);
    expect(requiredScopesFor('GET', '/workspaces/x/Computer/frames').scopes).toEqual(['exec:computer']);
  });

  it('a mixed-case public prefix stays public but never widens its admin parent', () => {
    expect(resolveRoutePolicy('/Auth/Pair/Preview').public).toBe(true);
    expect(resolveRoutePolicy('/Auth/Pair/Pending').public).toBeFalsy();
    expect(requiredScopesFor('GET', '/AUTH/PAIR/PENDING').scopes).toEqual(['admin:devices']);
  });

  it('paths with no canonical form fail closed to DEFAULT_POLICY', () => {
    for (const path of [
      '/auth/x/../devices',
      '/auth/x/%2e%2e/devices',
      '/auth/x/%2E/devices',
      '/auth//devices',
      '//auth/devices',
      '/workspaces/w1//terminals',
      '/auth/devices/%zz',
      '/auth/devices/%4',
      '/chats/./x',
    ]) {
      expect(canonicalApiPath(path), path).toBeNull();
      expect(resolveRoutePolicy(path), path).toBe(DEFAULT_POLICY);
    }
  });

  it('keeps non-equivalent escapes encoded so an id segment cannot split', () => {
    // `%2F` is NOT `/` (RFC 3986 §2.2): `/auth/devices%2Fx` is one segment the
    // router will not dispatch to `/auth/devices/x`.
    expect(canonicalApiPath('/source-control/branch/feature%2Fx')).toBe('/source-control/branch/feature%2fx');
    expect(canonicalApiPath('/Auth/%44evices/')).toBe('/auth/devices');
  });
});
