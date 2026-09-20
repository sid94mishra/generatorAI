import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentStagingService } from '../src/services/AgentStagingService.js';
import { AgentResolver } from '../src/services/AgentResolver.js';
import { ArtifactCatalog } from '../src/services/ArtifactCatalog.js';

describe('provider-readable skill staging', () => {
  it('reads a project skill from its config directory rather than the process working directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gai-project-skill-'));
    try {
      await writeFile(join(dir, 'review.md'), '# Project review\nPROJECT_SKILL_CONTENT');
      const catalog = new ArtifactCatalog(
        { listSystemArtifacts: async () => [] } as never,
        { getByProjectId: async () => [{ id: 'project-review', name: 'review', filePath: 'review.md' }] } as never,
        dir,
        { warn: () => {} } as never,
        { resolveProjectConfigPath: (config) => join(dir, config.filePath) },
      );
      const projection = AgentResolver.empty();
      projection.skills.refs = await catalog.listSkills('project-1');
      const result = await new AgentStagingService({ warn: () => {} } as never).ensureStaged(dir, projection);
      expect(result.warnings).toEqual([]);
      expect(await readFile(join(result.skillDirectories[0]!, 'review/SKILL.md'), 'utf8')).toContain('PROJECT_SKILL_CONTENT');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it.each([['plain', '# Testing\nCover edge cases.'], ['existing', '---\nname: testing\ndescription: Existing instructions\n---\nCover edge cases.']])('stages %s Markdown as a discoverable SKILL.md', async (_kind, content) => {
    const dir = await mkdtemp(join(tmpdir(), 'gai-skill-'));
    try {
      const filePath = join(dir, 'input.md');
      await writeFile(filePath, content!);
      const projection = AgentResolver.empty();
      projection.skills.refs = [{ id: 'test', name: 'testing', source: 'system', filePath }];
      const service = new AgentStagingService({ warn: () => {} } as never);
      const result = await service.ensureStaged(dir, projection);
      const staged = await readFile(join(result.skillDirectories[0]!, 'testing/SKILL.md'), 'utf8');
      expect(staged).toMatch(/^---\nname: /);
      expect(staged).toContain('description: ');
      expect(staged).toContain('Cover edge cases.');
      if (_kind === 'existing') expect(staged).toBe(content);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
