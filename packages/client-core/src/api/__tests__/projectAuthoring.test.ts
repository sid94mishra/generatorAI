import { describe, expect, it, vi } from 'vitest';
import { createAdminApi } from '../admin.js';

describe('project authoring additions', () => {
  it('targets a codebase worktree without touching other codebases', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const { projects } = createAdminApi(fetch);
    await projects.codebases.removeWorktree('p/a', 'c/b', 'w/c');
    expect(fetch).toHaveBeenLastCalledWith('/api/projects/p%2Fa/codebases/c%2Fb/worktrees/w%2Fc', { method: 'DELETE' });
    await projects.codebases.cleanupWorktrees('p/a', 'c/b');
    expect(fetch).toHaveBeenLastCalledWith('/api/projects/p%2Fa/codebases/c%2Fb/worktrees/cleanup', expect.objectContaining({ method: 'POST', body: '{}' }));
  });

  it('keeps bundled preferences separate from custom MCP replacement', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const { systemAdmin } = createAdminApi(fetch);
    await systemAdmin.updateMcp('system', 'm/a', { enabled: false });
    expect(fetch).toHaveBeenLastCalledWith('/api/system/mcp-servers/system/m%2Fa', expect.objectContaining({ method: 'PUT', body: '{"enabled":false}' }));
    const body = { name: 'Custom', command: 'server', enabled: true };
    await systemAdmin.updateMcp('custom', 'm/a', body);
    expect(fetch).toHaveBeenLastCalledWith('/api/system/mcp-servers/custom/m%2Fa', expect.objectContaining({ method: 'PUT', body: JSON.stringify(body) }));
  });
});
