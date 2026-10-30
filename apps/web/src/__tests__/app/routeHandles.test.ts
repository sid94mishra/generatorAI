// Every area route names its sidebar destination in `handle.nav` (D-46), the
// source P3's sidebar active state reads. It must agree with the path rule
// `navDestinationFor` applies, and every destination must own a route.
import { describe, expect, it } from 'vitest';
import { NAV_DESTINATIONS, navDestinationFor } from '@generatorai/shared/ui-contract';
import type { RouteObject } from 'react-router';
import { PAGE_ROUTES } from '@/app/routes/index.js';
import type { GaiRouteHandle } from '@/app/routes/defineRoute.js';

const pathOf = (r: RouteObject) => (r.index ? '/' : `/${r.path ?? ''}`.replace(/:[^/]+/g, 'x'));
const handleOf = (r: RouteObject) => r.handle as GaiRouteHandle | undefined;

describe('route handles: nav', () => {
  it('matches the destination the path belongs to, on every page route', () => {
    for (const route of PAGE_ROUTES) {
      const path = pathOf(route);
      if (path === '/*') continue;
      expect(handleOf(route)?.nav, path).toBe(navDestinationFor(path)?.id);
    }
  });

  it('every sidebar destination owns at least one route', () => {
    const navs = new Set(PAGE_ROUTES.map((r) => handleOf(r)?.nav));
    for (const d of NAV_DESTINATIONS) expect(navs.has(d.id), d.id).toBe(true);
  });
});
