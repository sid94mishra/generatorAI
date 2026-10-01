import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../client.js';
import { createAdminApi } from '../admin.js';

const recorder = () => vi.fn(async () => new Response('{}'));

describe('device and notification contracts', () => {
  it('revokes using DELETE, an encoded id and a JSON reason', async () => {
    const fetch = recorder();
    await createAdminApi(fetch).devices.revokeWithReason('a/b?c', 'lost phone');
    expect(fetch).toHaveBeenCalledWith('/api/auth/devices/a%2Fb%3Fc', expect.objectContaining({ method: 'DELETE', body: '{"reason":"lost phone"}' }));
  });
  it('rotates credentials and sends the full scope list', async () => {
    const fetch = recorder();
    const { devices } = createAdminApi(fetch);
    await devices.rotate('d/1');
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/devices/d%2F1/rotate', expect.objectContaining({ method: 'POST', body: '{}' }));
    await devices.setScopes('d1', ['read:status']);
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/devices/d1/scopes', expect.objectContaining({ method: 'PUT', body: '{"scopes":["read:status"]}' }));
  });
  it('posts a permission answer through the same endpoint as the chat card', async () => {
    const fetch = recorder();
    await createApiClient(fetch).chats.respondPermission('c1', 'i1', { behavior: 'allow' });
    expect(fetch).toHaveBeenCalledWith('/api/chats/c1/interactions/i1/permission', expect.objectContaining({ method: 'POST', body: '{"behavior":"allow"}' }));
  });
  it('registers push and explicitly clears server muting', async () => {
    const fetch = recorder();
    const { auth } = createApiClient(fetch);
    const registration = { token: 'test-only-token', provider: 'expo' as const, platform: 'ios' };
    await auth.registerPush(registration);
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/push-token', expect.objectContaining({ method: 'PUT', body: JSON.stringify(registration) }));
    await auth.mutePush(null);
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/push-token/mute', expect.objectContaining({ method: 'PUT', body: '{"mutedUntil":null}' }));
  });
  it('reads config content without pretending the response is a config row', async () => {
    const fetch = vi.fn(async () => new Response('{"content":"# Instructions"}'));
    const result = await createAdminApi(fetch).projects.configs.content('p/a', 'c/b');
    expect(result.content).toBe('# Instructions');
    expect(fetch).toHaveBeenCalledWith('/api/projects/p%2Fa/configs/c%2Fb', undefined);
  });
});
