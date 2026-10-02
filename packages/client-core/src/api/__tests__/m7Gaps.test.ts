// Mobile M7-09 wire contracts: MG-01 own device, MG-11 remote refs, MG-12
// import preview, MG-17 / MG-22 typed audio + MCP settings.

import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../client.js';
import { createAdminApi } from '../admin.js';

const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(body), { status }));

describe('M7-09 client methods', () => {
  it('reads the own device record (MG-01)', async () => {
    const view = { deviceId: 'd1', name: 'Phone', platform: 'mobile', scopes: ['read:status'], createdAt: 'x', connectionMode: 'auto', credentialVersion: 1 };
    const fetch = json(view);
    expect(await createApiClient(fetch).auth.devices.me()).toEqual(view);
    expect(fetch).toHaveBeenCalledWith('/api/auth/devices/me', undefined);
  });

  it('lists remote branches before a clone (MG-11)', async () => {
    const fetch = json({ defaultBranch: 'main', branches: ['main'], truncated: false });
    const refs = await createApiClient(fetch).sourceControl.remoteRefs({ url: 'https://github.com/a/b.git' });
    expect(refs.branches).toEqual(['main']);
    expect(fetch).toHaveBeenCalledWith(
      '/api/source-control/remote-refs',
      expect.objectContaining({ method: 'POST', body: '{"url":"https://github.com/a/b.git"}' }),
    );
  });

  it('previews an agent import without writing (MG-12)', async () => {
    const fetch = json({ parsed: { name: 'A' }, warnings: [] });
    await createAdminApi(fetch).agents.importPreview({ markdown: '---', scope: 'global' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/agents/import/preview',
      expect.objectContaining({ method: 'POST', body: '{"markdown":"---","scope":"global"}' }),
    );
  });

  it('types Settings › Audio including the dictation language (MG-17)', async () => {
    const fetch = json({ sttLanguage: 'de' });
    const { systemAdmin } = createAdminApi(fetch);
    expect((await systemAdmin.updateAudio({ sttLanguage: 'de' })).sttLanguage).toBe('de');
    expect(fetch).toHaveBeenLastCalledWith('/api/system/audio', expect.objectContaining({ method: 'PUT', body: '{"sttLanguage":"de"}' }));
    await systemAdmin.audio();
    expect(fetch).toHaveBeenLastCalledWith('/api/system/audio', undefined);
    await systemAdmin.audioModel();
    expect(fetch).toHaveBeenLastCalledWith('/api/system/audio/model', undefined);
    await systemAdmin.downloadAudioModel();
    expect(fetch).toHaveBeenLastCalledWith('/api/system/audio/model', expect.objectContaining({ method: 'POST' }));
    await systemAdmin.deleteAudioModel();
    expect(fetch).toHaveBeenLastCalledWith('/api/system/audio/model', expect.objectContaining({ method: 'DELETE' }));
  });

  it('writes system and custom MCP servers on their routes (MG-22)', async () => {
    const fetch = json({}, 204);
    const { systemAdmin } = createAdminApi(fetch);
    await systemAdmin.setSystemMcp('git/hub', { enabled: false });
    expect(fetch).toHaveBeenLastCalledWith('/api/system/mcp-servers/system/git%2Fhub', expect.objectContaining({ method: 'PUT', body: '{"enabled":false}' }));
    await systemAdmin.removeCustomMcp('c1');
    expect(fetch).toHaveBeenLastCalledWith('/api/system/mcp-servers/custom/c1', expect.objectContaining({ method: 'DELETE' }));
  });
});
