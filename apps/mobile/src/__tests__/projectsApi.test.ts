import { describe, expect, it, vi } from 'vitest';

import { createProjectsApi } from '../components/projects/api';

function recorder(status = 200, body: unknown = {}) {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const fetchImpl = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({
      path,
      method: init?.method ?? 'GET',
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status });
  });
  return { calls, api: createProjectsApi(fetchImpl) };
}

describe('project authoring endpoints', () => {
  it('hits the routes the server defines', async () => {
    const { calls, api } = recorder();
    await api.create({ name: 'P' });
    await api.update('p 1', { status: 'archived' } as never);
    await api.remove('p1');
    await api.linkGit('p1', { alias: 'api', type: 'git-remote', url: 'https://github.com/a/api' });
    await api.unlinkCodebase('p1', 'c1');
    await api.configContent('p1', 'cfg');
    await api.updateMcpServer('p1', 'm1', { name: 'x', enabled: false });
    await api.removeWorktree('p1', 'c1', 'w1');
    await api.cleanupWorktrees('p1', 'c1');
    await api.files('p1', 'c1', '');
    await api.files('p1', 'c1', 'src/app');
    await api.fileContent('p1', 'c1', 'src/a b.ts');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/projects',
      'PUT /api/projects/p%201',
      'DELETE /api/projects/p1?force=true',
      'POST /api/projects/p1/codebases',
      'DELETE /api/projects/p1/codebases/c1',
      'GET /api/projects/p1/configs/cfg',
      'PUT /api/projects/p1/mcp-servers/m1',
      'DELETE /api/projects/p1/codebases/c1/worktrees/w1',
      'POST /api/projects/p1/codebases/c1/worktrees/cleanup',
      'GET /api/projects/p1/codebases/c1/files',
      'GET /api/projects/p1/codebases/c1/files?path=src%2Fapp',
      'GET /api/projects/p1/codebases/c1/files/content?path=src%2Fa%20b.ts',
    ]);
    expect(calls[3]!.body).toEqual({ alias: 'api', type: 'git-remote', url: 'https://github.com/a/api' });
  });

  it('surfaces the server reason from the error envelope', async () => {
    const { api } = recorder(400, { error: { code: 'VALIDATION_ERROR', message: 'url is required for git-remote type' } });
    await expect(api.linkGit('p1', { alias: 'a', type: 'git-remote', url: '' })).rejects.toThrow(
      'url is required for git-remote type',
    );
  });

  it('treats 204 as success', async () => {
    const { api } = recorder(204);
    await expect(api.remove('p1')).resolves.toBeUndefined();
  });
});
