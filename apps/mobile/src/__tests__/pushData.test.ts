import { expect, it } from 'vitest';
import { intentFromResponse } from '../services/notifications/notificationCategories';
import { normalizePushData } from '../services/notifications/pushData';
const data = { v: 2, serverId: 'server-B', href: '/chats/c/gate/g?dock=plan', route: '/chats/wrong', category: 'approval', threadId: 'chat:c', chatId: 'c', interactionId: 'g', kind: 'permission', actions: ['approve', 'deny'] };
it('v2 uses href and server B for both a tap and a permission action', () => {
  expect(intentFromResponse('tap', data, 'tap')).toEqual({ type: 'open', route: '/chats/c/gate/g?dock=plan&server=server-B' });
  expect(intentFromResponse('approve', data, 'tap')).toMatchObject({ type: 'decide', serverId: 'server-B', chatId: 'c', interactionId: 'g' });
});
it('invalid or future envelopes never fall back to legacy routing or decisions', () => {
  for (const malformed of [{ ...data, serverId: undefined }, { ...data, href: 'https://evil.test' }, { ...data, href: '/chats/%2e%2e/settings' }, { ...data, v: 3 }]) {
    expect(normalizePushData(malformed)).toBeNull();
    expect(intentFromResponse('approve', malformed, 'tap').type).toBe('ignore');
  }
});
