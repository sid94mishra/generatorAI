import { describe, expect, it } from 'vitest';
import { createAdminApi } from '../admin.js';
import { createApiClient } from '../client.js';

function recorder(body: unknown) {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const fetchImpl = async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

describe('MG-22 typed wrappers — server folders and conflict start', () => {
  it('lists folders and reads git info with an encoded path', async () => {
    const { calls, fetchImpl } = recorder({ path: '', parent: null, entries: [] });
    const admin = createAdminApi(fetchImpl);
    await admin.fs.dirs('/Users/me/My Repo');
    await admin.fs.gitInfo('C:\\src\\app');
    expect(calls.map((c) => c.path)).toEqual(['/api/fs/dirs?path=%2FUsers%2Fme%2FMy+Repo', '/api/fs/git-info?path=C%3A%5Csrc%5Capp']);
  });

  it('starts a conflict merge on the workspace route', async () => {
    const { calls, fetchImpl } = recorder({ files: ['a.ts'] });
    await createApiClient(fetchImpl).scm.startConflicts('ws 1', { alias: '.', base: 'main' });
    expect(calls).toEqual([{ path: '/api/workspaces/ws%201/scm/conflicts/start', method: 'POST', body: { alias: '.', base: 'main' } }]);
  });
});
