import { describe, expect, it } from 'vitest';

import {
  BUILTIN_COMMANDS,
  NAVIGATE_COMMANDS,
  buildSlashItems,
  rankMentionItems,
  rankSlashItems,
} from '../slashSource';

const CU = 'system-skill-computer-use';

describe('buildSlashItems — merging', () => {
  it('starts with web builtins, then skills, prompts, then mobile pane openers', () => {
    const items = buildSlashItems({
      skills: [{ id: 's1', name: 'deploy', description: 'Ship it' }],
      prompts: [{ id: 'p1', name: 'review', source: 'project' }],
    });
    expect(items.map((i) => i.id)).toEqual([
      ...BUILTIN_COMMANDS.map((b) => b.id),
      'skill:system:s1',
      'prompt:project:p1',
      ...NAVIGATE_COMMANDS.map((n) => n.id),
    ]);
  });

  it('hides locally disabled skills', () => {
    const items = buildSlashItems({
      skills: [{ id: 's1', name: 'deploy' }, { id: 's2', name: 'lint' }],
      disabledSkillIds: ['s1'],
    });
    expect(items.some((i) => i.id === 'skill:system:s1')).toBe(false);
    expect(items.some((i) => i.id === 'skill:system:s2')).toBe(true);
  });

  it('offers the Computer Use skill only when the server has it enabled', () => {
    const off = buildSlashItems({
      skills: [{ id: CU, name: 'computer-use' }],
      computerUse: { enabled: false, skillId: CU },
    });
    expect(off.some((i) => i.name === 'computer-use')).toBe(false);

    const on = buildSlashItems({
      skills: [{ id: CU, name: 'computer-use' }],
      computerUse: { enabled: true, skillId: CU },
    });
    const cmd = on.find((i) => i.name === 'computer-use')!;
    // Names the STAGED skill, never the display name.
    expect(cmd.format?.('open calc')).toContain('generatorai-computer-use');
    expect(cmd.format?.('open calc')).toContain('open calc');
  });

  it('formats builtins with web’s exact wording', () => {
    const browser = BUILTIN_COMMANDS.find((b) => b.name === 'browser')!;
    expect(browser.format?.('check login')).toMatch(/^Use the integrated browser .*\n\nTask: check login$/s);
    expect(browser.pane).toBe('browser');
  });

  it('formats a skill with and without a task', () => {
    const [skill] = buildSlashItems({ skills: [{ id: 's', name: 'Docs' }] }).filter((i) => i.kind === 'skill');
    expect(skill!.format?.('')).toBe('Use the "Docs" skill.');
    expect(skill!.format?.('write me')).toBe('Use the "Docs" skill for the following task.\n\nwrite me');
  });

  it('formats a prompt from its template, appending typed input', async () => {
    const [prompt] = buildSlashItems({
      prompts: [{ id: 'p', name: 'pr' }],
      loadPromptTemplate: async () => 'TEMPLATE',
    }).filter((i) => i.kind === 'prompt');
    expect(await prompt!.loadTemplate?.()).toBe('TEMPLATE');
    expect(prompt!.format?.('extra', 'TEMPLATE')).toBe('TEMPLATE\n\nextra');
    expect(prompt!.format?.('', 'TEMPLATE')).toBe('TEMPLATE');
    expect(prompt!.format?.('only input')).toBe('only input');
  });
});

describe('rankSlashItems — ranking', () => {
  const items = buildSlashItems({
    skills: [{ id: 's1', name: 'deploy', description: 'Ship to prod' }],
    prompts: [{ id: 'p1', name: 'browser-notes', description: 'Notes' }],
  });

  it('keeps catalogue order for an empty query', () => {
    expect(rankSlashItems(items, '').map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it('puts the exact name match first', () => {
    const ranked = rankSlashItems(items, 'browser');
    expect(ranked[0]!.id).toBe('builtin:browser');
    expect(ranked.some((i) => i.name === 'browser-notes')).toBe(true);
  });

  it('matches on description and survives a typo', () => {
    expect(rankSlashItems(items, 'prod')[0]!.name).toBe('deploy');
    expect(rankSlashItems(items, 'deply')[0]!.name).toBe('deploy');
  });

  it('respects the limit', () => {
    expect(rankSlashItems(items, '', 2)).toHaveLength(2);
  });
});

describe('rankMentionItems', () => {
  const files = [
    { path: 'src/ui/Button.tsx', alias: 'app' },
    { path: 'docs/button-notes.md', alias: 'app' },
    { path: 'README.md', alias: 'app' },
  ];
  const agents = [
    { ref: 'system:reviewer', name: 'Reviewer' },
    { ref: 'project:butler', name: 'Butler', enabled: false },
  ];

  it('offers enabled agents before files and inserts refs', () => {
    const items = rankMentionItems('', files, agents);
    expect(items[0]!.kind).toBe('agent');
    expect(items[0]!.agentRef).toBe('system:reviewer');
    expect(items.some((i) => i.agentRef === 'project:butler')).toBe(false);
    expect(items.filter((i) => i.kind === 'file')).toHaveLength(3);
  });

  it('ranks the component above the notes for "button"', () => {
    const items = rankMentionItems('button', files, []);
    expect(items[0]!.path).toBe('src/ui/Button.tsx');
    expect(items[0]!.alias).toBe('app');
    expect(items[0]!.label).toBe('Button.tsx');
  });

  it('dedupes identical paths', () => {
    const items = rankMentionItems('readme', [...files, { path: 'README.md', alias: 'app' }], []);
    expect(items.filter((i) => i.path === 'README.md')).toHaveLength(1);
  });
});
