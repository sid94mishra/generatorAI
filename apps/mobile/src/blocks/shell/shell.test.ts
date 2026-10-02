import { describe, expect, it } from 'vitest';

import { chatHref, gateHref, runHref, stageHref, workflowHref } from './hrefs';
import { isModuleRoot, parentHref } from './parentHref';
import { routePath } from './routePath';

describe('hrefs (MD-79, MD-80)', () => {
  it('builds web-shaped paths; a run lives under its workflow', () => {
    expect(chatHref('c1')).toBe('/chats/c1');
    expect(gateHref('c1', 'i9')).toBe('/chats/c1/gate/i9');
    expect(workflowHref('w1')).toBe('/workflows/w1');
    expect(runHref('w1', 'r1')).toBe('/workflows/w1/runs/r1');
    expect(stageHref('w1', 'r1', 's1')).toBe('/workflows/w1/runs/r1/stages/s1');
  });

  it('escapes ids that would otherwise break the path', () => {
    expect(gateHref('a/b', 'x y')).toBe('/chats/a%2Fb/gate/x%20y');
  });
});

describe('parentHref (06 §3.2, MD-88)', () => {
  it('walks up the IA from a detail with no history', () => {
    expect(parentHref('/chats/c1')).toBe('/chats');
    expect(parentHref('/chats/c1/gate/i1')).toBe('/chats/c1');
    expect(parentHref('/chats/new')).toBe('/chats');
    expect(parentHref('/workflows/w1')).toBe('/workflows');
    expect(parentHref('/workflows/w1/runs/r1')).toBe('/workflows/w1');
    expect(parentHref('/workflows/w1/runs/r1/stages/s1')).toBe('/workflows/w1/runs/r1');
    expect(parentHref('/projects/p1/pull-requests')).toBe('/projects/p1');
    expect(parentHref('/projects/p1/codebases/c1')).toBe('/projects/p1');
    expect(parentHref('/projects/p1/codebases/c1/pull-requests/4')).toBe('/projects/p1/codebases/c1');
    expect(parentHref('/agents/a1')).toBe('/agents');
    expect(parentHref('/settings/appearance')).toBe('/settings');
    expect(parentHref('/needs-you')).toBe('/');
    expect(parentHref('/search?kind=workflows')).toBe('/');
  });

  it('sends a module root other than Home to Home, and leaves Home and the public screens alone', () => {
    for (const root of ['/chats', '/projects', '/agents', '/workflows', '/automations', '/scripts', '/settings']) {
      expect(parentHref(root), root).toBe('/');
      expect(isModuleRoot(root), root).toBe(true);
    }
    expect(parentHref('/')).toBeNull();
    expect(parentHref('/pair')).toBeNull();
    expect(parentHref('/revoked')).toBeNull();
    expect(isModuleRoot('/chats/c1')).toBe(false);
  });
});

describe('routePath', () => {
  it('fills a route file name with its params', () => {
    expect(routePath('workflows/[id]/runs/[runId]/index', { id: 'w1', runId: 'r 1' })).toBe('/workflows/w1/runs/r%201');
    expect(routePath('index', {})).toBe('/');
    expect(routePath('(app)/settings/index', undefined)).toBe('/settings');
  });
});
