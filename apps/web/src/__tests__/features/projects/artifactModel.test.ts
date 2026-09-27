// The Customization tab rebuilds the server's artifact precedence merge on the
// client (it must list entries G-19 has switched off, which the server's
// merged route hides), so the merge has to agree with
// SystemArtifactService.getAvailableArtifacts: project shadows system by
// (type, name), case-insensitively. The G-19 PUT replaces the whole disabled
// set, so toggling must never drop or duplicate other entries.

import { describe, expect, it } from 'vitest';
import type { ProjectConfig, SystemConfig } from '@generatorai/shared';
import {
  kindFromParam,
  mergeArtifacts,
  skillFolderProblem,
  toggleDisabled,
} from '@/features/projects/detail/customization/artifactModel.js';

const now = new Date('2026-09-01T00:00:00Z');
const sys = (id: string, type: SystemConfig['type'], name: string): SystemConfig => ({
  id, type, name, filePath: `/sys/${name}`, version: '1', metadata: {}, createdAt: now, updatedAt: now,
});
const proj = (id: string, type: ProjectConfig['type'], name: string): ProjectConfig => ({
  id, projectId: 'p1', type, name, filePath: `/proj/${name}`, metadata: {}, createdAt: now, updatedAt: now,
});

describe('mergeArtifacts', () => {
  it('lets a project artifact shadow the system one with the same name (any case), per type', () => {
    const merged = mergeArtifacts(
      [sys('s1', 'skill', 'Testing'), sys('s2', 'skill', 'docs'), sys('s3', 'prompt', 'testing')],
      [proj('p1', 'skill', 'testing'), proj('p2', 'agent', 'docs')],
      'skill',
    );
    expect(merged.map((a) => [a.id, a.source])).toEqual([
      ['p1', 'project'],
      ['s2', 'system'],
    ]);
  });
});

describe('toggleDisabled', () => {
  const base = [
    { type: 'skill' as const, id: 'a' },
    { type: 'mcp' as const, id: 'a' },
  ];
  it('adds an entry once when switched off and removes only that entry when switched on', () => {
    const off = toggleDisabled(base, 'prompt', 'b', false);
    expect(off).toEqual([...base, { type: 'prompt', id: 'b' }]);
    expect(toggleDisabled(off, 'prompt', 'b', false)).toEqual(off);
    expect(toggleDisabled(off, 'skill', 'a', true)).toEqual([{ type: 'mcp', id: 'a' }, { type: 'prompt', id: 'b' }]);
  });
});

describe('skillFolderProblem / kindFromParam', () => {
  const file = (path: string) => Object.assign(new File(['x'], path.split('/').pop()!), { webkitRelativePath: path });
  it('requires SKILL.md somewhere in the folder', () => {
    expect(skillFolderProblem([file('my-skill/Skill.md'), file('my-skill/run.sh')])).toBeNull();
    expect(skillFolderProblem([file('my-skill/README.md')])).toMatch(/SKILL\.md/);
    expect(skillFolderProblem([])).toMatch(/No files/);
  });
  it('maps ?kind= and falls back to skills', () => {
    expect(kindFromParam('mcp')).toBe('mcp');
    expect(kindFromParam('prompts')).toBe('prompt');
    expect(kindFromParam('bogus')).toBe('skill');
    expect(kindFromParam(null)).toBe('skill');
  });
});
