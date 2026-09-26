// ────────────────────────────────────────────────────────────────
// ArtifactCatalog — G-19 per-project artifact enable/disable, applied at
// the source so `AgentResolver`'s chat/stage resolution (and `AgentService`'s
// save-time validation) both see a project-disabled skill/MCP server as
// simply absent. No projectId, or no callback wired → nothing hidden.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectConfig } from '@generatorai/shared';
import { ArtifactCatalog } from '../ArtifactCatalog.js';
import type { SystemArtifactService } from '../SystemArtifactService.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} } as never;
const systemArtifacts = { listSystemArtifacts: async () => [] } as unknown as SystemArtifactService;

const BUNDLED_MCP = [{ id: 'system-mcp-fs', name: 'Filesystem', serverType: 'stdio', command: 'npx', args: [] }];

describe('ArtifactCatalog — G-19 disabled prefs', () => {
  let dir: string;
  let templates: string;
  let projectSkillConfigs: ProjectConfig[];
  let disabled: Map<string, Set<string>>; // "projectId:type" -> ids

  function catalog() {
    return new ArtifactCatalog(
      systemArtifacts,
      { getByProjectId: async (_p, type) => (type === 'skill' ? projectSkillConfigs : []) },
      templates,
      logger,
      {
        getDisabledArtifactIds: async (projectId, type) =>
          disabled.get(`${projectId}:${type}`) ?? new Set(),
      },
    );
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'catalog-prefs-'));
    templates = join(dir, 'templates');
    mkdirSync(templates);
    writeFileSync(join(templates, 'mcp-servers.json'), JSON.stringify(BUNDLED_MCP), 'utf8');
    projectSkillConfigs = [
      { id: 'skill-1', projectId: 'proj-1', type: 'skill', name: 'Skill One', filePath: 's1.md', metadata: {}, createdAt: new Date(), updatedAt: new Date() },
      { id: 'skill-2', projectId: 'proj-1', type: 'skill', name: 'Skill Two', filePath: 's2.md', metadata: {}, createdAt: new Date(), updatedAt: new Date() },
    ];
    disabled = new Map();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('hides nothing when the project has disabled nothing', async () => {
    const skills = await catalog().listSkills('proj-1');
    expect(skills.map((s) => s.id).sort()).toEqual(['skill-1', 'skill-2']);
  });

  it('hides a project-disabled skill by id', async () => {
    disabled.set('proj-1:skill', new Set(['skill-1']));
    const skills = await catalog().listSkills('proj-1');
    expect(skills.map((s) => s.id)).toEqual(['skill-2']);
  });

  it('hides a project-disabled MCP server by id, regardless of source (system-catalog entries too)', async () => {
    disabled.set('proj-1:mcp', new Set(['system-mcp-fs']));
    const servers = await catalog().listMcpServers('proj-1');
    expect(servers.find((s) => s.id === 'system-mcp-fs')).toBeUndefined();
  });

  it('applies nothing with no projectId (a global/system-only lookup)', async () => {
    disabled.set('proj-1:mcp', new Set(['system-mcp-fs']));
    const servers = await catalog().listMcpServers(); // no projectId
    expect(servers.find((s) => s.id === 'system-mcp-fs')).toBeDefined();
  });

  it('applies nothing when no getDisabledArtifactIds callback is wired (existing callers keep working)', async () => {
    const bareCatalog = new ArtifactCatalog(
      systemArtifacts,
      { getByProjectId: async (_p, type) => (type === 'skill' ? projectSkillConfigs : []) },
      templates,
      logger,
    );
    const skills = await bareCatalog.listSkills('proj-1');
    expect(skills).toHaveLength(2);
  });

  it("a disabled id from a DIFFERENT project's list does not leak across projects", async () => {
    disabled.set('proj-2:skill', new Set(['skill-1']));
    const skills = await catalog().listSkills('proj-1');
    expect(skills.map((s) => s.id).sort()).toEqual(['skill-1', 'skill-2']);
  });
});
