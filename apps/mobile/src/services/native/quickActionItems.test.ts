import { describe, expect, it } from 'vitest';
import { deepLinkToRoute } from '@generatorai/shared/ui-contract';
import { mobileRoute } from '../navigation/mobileRoutes';
import { quickActionHref, quickActionItems } from './quickActionItems';

describe('quick actions (MX-08)', () => {
  it('lists New chat, Home, Run workflow… and Search with the shared launcher labels', () => {
    const items = quickActionItems(3, 'ios');
    expect(items.map((i) => [i.title, i.subtitle, i.icon])).toEqual([
      ['New chat', null, 'symbol:square.and.pencil'],
      ['Home', '3 need you', 'symbol:house'],
      ['Run workflow…', null, 'symbol:play'],
      ['Search', null, 'symbol:magnifyingglass'],
    ]);
    expect(quickActionItems(0, 'android').map((i) => [i.subtitle, i.icon])).toEqual([
      [null, 'shortcut_new_chat'], [null, 'shortcut_home'], [null, 'shortcut_workflows'], [null, 'shortcut_search'],
    ]);
  });

  it('opens screens the app has, through the shared allowlist', () => {
    expect(quickActionItems(0, 'ios').map((i) => mobileRoute(deepLinkToRoute(i.params.href)))).toEqual([
      '/chats/new', '/', '/search?kind=workflows', '/search',
    ]);
  });

  it('accepts only our own links', () => {
    expect(quickActionHref({ params: { href: 'generatorai:///search' } })).toBe('generatorai:///search');
    expect(quickActionHref({ params: { href: 'https://evil.test' } })).toBeNull();
    expect(quickActionHref(null)).toBeNull();
  });
});
