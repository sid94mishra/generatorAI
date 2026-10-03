import { describe, expect, it } from 'vitest';
import { deepLinkToRoute } from '@generatorai/shared/ui-contract';

import { mobileRoute } from '../mobileRoutes';
import { redirectLink } from '../links';

const resolve = (url: string): string | null => mobileRoute(deepLinkToRoute(url));

describe('deep links → the mobile route tree (04 §1.6, MD-145)', () => {
  it.each([
    ['generatorai://', '/'],
    ['generatorai:///', '/'],
    ['generatorai://chats', '/chats'],
    ['generatorai://chats/new', '/chats/new'],
    ['generatorai://command/chat.new', '/chats/new'],
    ['generatorai://chats/c1?dock=plan&run=r1', '/chats/c1?dock=plan&run=r1'],
    ['generatorai://chats/c1/gate/i1', '/chats/c1/gate/i1'],
    ['generatorai://chats/c1/plan/p1', '/chats/c1?dock=plan&plan=p1'],
    ['generatorai://projects', '/projects'],
    ['generatorai://projects/new', '/projects/new'],
    ['generatorai://projects/p1/customization?kind=skills', '/projects/p1/customization?kind=skills'],
    ['generatorai://projects/p1/codebases/c1', '/projects/p1/codebases/c1'],
    ['generatorai://projects/p1/codebases/c1/worktrees', '/projects/p1/codebases/c1'],
    ['generatorai://projects/p1/codebases/c1/files', '/projects/p1/codebases/c1/files'],
    ['generatorai://projects/p1/codebases/c1/pull-requests/4', '/projects/p1/codebases/c1/pull-requests/4'],
    ['generatorai://agents', '/agents'],
    ['generatorai://agents/new', '/agents/new'],
    ['generatorai://agents/a1', '/agents/a1'],
    ['generatorai://workflows', '/workflows'],
    ['generatorai://workflows/new', '/workflows/new'],
    ['generatorai://command/workflow.new', '/workflows/new'],
    ['generatorai://workflows/w1?run=1', '/workflows/w1?run=1'],
    ['generatorai://workflows/w1/edit', '/workflows/w1/edit'],
    ['generatorai://workflows/w1/runs/r1?dock=terminal', '/workflows/w1/runs/r1?dock=terminal'],
    ['generatorai://workflows/w1/runs/r1/approval/s1', '/workflows/w1/runs/r1/approval/s1'],
    ['generatorai://automations', '/automations'],
    ['generatorai://automations/new', '/automations/new'],
    ['generatorai://automations/a1/edit', '/automations/a1/edit'],
    ['generatorai://automations/a1/webhook', '/automations/a1'],
    ['generatorai://automations/a1/executions/e1', '/automations/a1/executions/e1'],
    ['generatorai://scripts', '/scripts'],
    ['generatorai://scripts/s1', '/scripts/s1'],
    ['generatorai://settings', '/settings'],
    ['generatorai://settings/appearance', '/settings/appearance'],
    ['generatorai://settings/mcp', '/settings/mcp'],
    ['generatorai://settings/general', '/settings/general'],
    ['generatorai://settings/browser-terminal', '/settings/browser-terminal'],
    ['generatorai://settings/storage', '/settings/storage'],
    ['generatorai://settings/app-lock', '/settings/app-lock'],
    ['generatorai://settings/nope', '/settings'],
    ['generatorai://search?kind=workflows', '/search?kind=workflows'],
    ['generatorai://needs-you', '/needs-you'],
    ['generatorai://servers', '/servers'],
    ['generatorai://pair?code=ABCD', '/pair?code=ABCD'],
  ])('%s → %s', (url, route) => {
    expect(resolve(url)).toBe(route);
  });

  it('keeps the server of a mapped link so the queue can switch first', () => {
    expect(resolve('generatorai://command/chat.new?server=B')).toBe('/chats/new?server=B');
    expect(resolve('generatorai://settings/nope?server=B')).toBe('/settings?server=B');
  });

  it('opens the share sheet for /share and for the share extension hand-off (M9-08)', () => {
    expect(resolve('generatorai://share')).toBe('/share');
    expect(redirectLink('generatorai://dataUrl=generatoraiShareKey?nonce=1#text', 'A')).toBe('/share');
    expect(redirectLink('generatorai:///dataUrl=generatoraiShareKey#file', 'A')).toBe('/share');
  });

  it.each([
    'generatorai://runs/r1',
    'generatorai://changes/w1',
    'generatorai://terminal/w1',
    'generatorai://approvals',
    'generatorai://workspaces/w1/commit',
    'generatorai://command/project.new',
    'generatorai://admin',
    'generatorai://chats/%2e%2e/settings',
    'https://evil.test/chats',
  ])('rejects %s (Home)', (url) => {
    expect(resolve(url)).toBeNull();
    expect(redirectLink(url, 'A')).toBe('/');
  });
});
