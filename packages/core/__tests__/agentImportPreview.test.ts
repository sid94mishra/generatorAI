// AgentService.previewImport (mobile MG-12): what an import would create,
// resolved against the catalog, without writing anything.

import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@generatorai/shared';
import { AgentService } from '../src/services/AgentService.js';

const DOC = [
  '---',
  'name: Release Scribe',
  'description: Turns merged pull requests into release notes.',
  'model: claude-haiku-4-5',
  'x-generatorai:',
  '  reasoningEffort: low',
  '  skills: [documentation, missing-skill]',
  '  mcpServers: [GitHub, jira]',
  '---',
  'You turn merged pull requests and commits into release notes.',
].join('\n');

function service(existing: { id: string; name: string; ref: string; version: number } | null = null) {
  const create = vi.fn();
  const update = vi.fn();
  const svc = new AgentService({
    agentRepo: { getByRef: vi.fn(async () => existing), create, update } as never,
    catalog: {
      listSkills: vi.fn(async () => [{ id: 's1', name: 'documentation' }]),
      listMcpServers: vi.fn(async () => [{ id: 'm1', name: 'github' }]),
    } as never,
    logger: { debug() {}, info() {}, warn() {}, error() {} } as never,
  });
  return { svc, create, update };
}

describe('AgentService.previewImport', () => {
  it('parses, resolves and reports unresolved names without writing', async () => {
    const { svc, create, update } = service();
    const preview = await svc.previewImport(DOC, { scope: 'global' });
    expect(preview.parsed).toMatchObject({
      name: 'Release Scribe',
      slug: 'release-scribe',
      ref: 'global:release-scribe',
      role: 'agent',
      model: 'claude-haiku-4-5',
      effort: 'low',
      skills: ['documentation', 'missing-skill'],
      mcp: ['GitHub', 'jira'],
      team: [],
    });
    expect(preview.parsed.instructionsBytes).toBeGreaterThan(10);
    expect(preview.warnings.map((w) => [w.code, w.params?.['id']])).toEqual([
      ['SKILL_NOT_FOUND', 'missing-skill'],
      ['MCP_SERVER_NOT_FOUND', 'jira'],
    ]);
    expect(preview.warnings[1]!.message).toContain('jira');
    expect(preview.conflict).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('names the agent an import would replace', async () => {
    const { svc } = service({ id: 'a1', name: 'Release Scribe', ref: 'global:release-scribe', version: 3 });
    expect((await svc.previewImport(DOC, { scope: 'global' })).conflict).toEqual({
      agentId: 'a1',
      name: 'Release Scribe',
      ref: 'global:release-scribe',
      version: 3,
    });
  });

  it('throws the import validation errors for a document it could never store', async () => {
    const { svc } = service();
    await expect(svc.previewImport('no frontmatter', { scope: 'global' })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      svc.previewImport(DOC.replace('Turns merged pull requests into release notes.', 'short'), { scope: 'global' }),
    ).rejects.toThrow(/at least 10/);
  });
});
