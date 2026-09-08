import { describe, expect, it } from 'vitest';

import {
  BROWSER_VISIBILITY_OPTIONS,
  DEFAULT_BROWSER_PICKER_VALUE,
  browserSummary,
  pickerValueToBrowserConfig,
} from '../browserConfig';
import {
  addTag,
  buildCreateChatBody,
  isEmptyOverrides,
  overrideIncludes,
  toggleOverrideId,
} from '../newChatModel';
import {
  defaultNewBranch,
  describeDraft,
  draftFromCodebase,
  draftsToSources,
  resolvePrimary,
  sanitizeAlias,
  slugifyChatName,
  uniqueAlias,
  validateDrafts,
  type DraftSource,
} from '../sourceModel';

const draft = (over: Partial<DraftSource> = {}): DraftSource => ({
  id: 'd1',
  kind: 'codebase',
  codebaseId: 'cb-1',
  name: 'frontend',
  alias: 'frontend',
  mode: 'worktree',
  branchMode: 'current',
  branch: '',
  newBranch: '',
  baseRef: '',
  ...over,
});

describe('sourceModel', () => {
  it('slugifies chat names for the default branch', () => {
    expect(slugifyChatName('Fix Cart: checkout bug!')).toBe('fix-cart-checkout-bug');
    expect(defaultNewBranch('')).toBe('generatorai/chat');
  });

  it('sanitizes and uniquifies aliases', () => {
    expect(sanitizeAlias('My Repo (v2)')).toBe('My-Repo-v2');
    expect(uniqueAlias('api', ['api', 'api-2'])).toBe('api-3');
    expect(uniqueAlias('api', [])).toBe('api');
  });

  it('maps drafts onto CreateChatSchema.sources exactly', () => {
    const sources = draftsToSources(
      [
        draft(),
        draft({ id: 'd2', alias: 'api', codebaseId: 'cb-2', branchMode: 'existing', branch: ' release ' }),
        draft({ id: 'd3', alias: 'docs', codebaseId: 'cb-3', mode: 'in-place', branchMode: 'new', newBranch: '', baseRef: 'main' }),
      ],
      'Cart fix',
    );
    expect(sources).toEqual([
      { kind: 'codebase', codebaseId: 'cb-1', mode: 'worktree', alias: 'frontend' },
      { kind: 'codebase', codebaseId: 'cb-2', mode: 'worktree', alias: 'api', branch: 'release' },
      { kind: 'codebase', codebaseId: 'cb-3', mode: 'in-place', alias: 'docs', newBranch: 'generatorai/cart-fix', baseRef: 'main' },
    ]);
  });

  it('describes a draft the way web does', () => {
    expect(describeDraft(draft(), 'x')).toBe('frontend → worktree');
    expect(describeDraft(draft({ branchMode: 'new', newBranch: 'feat', baseRef: 'main' }), 'x')).toBe(
      'frontend → worktree on feat from main',
    );
    expect(describeDraft(draft({ mode: 'in-place', branchMode: 'existing', branch: 'dev' }), 'x')).toBe(
      'frontend → in place on dev',
    );
  });

  it('validates aliases, duplicates and ref names', () => {
    expect(validateDrafts([draft()])).toBeNull();
    expect(validateDrafts([draft(), draft({ id: 'd2' })])).toMatch(/share the alias/);
    expect(validateDrafts([draft({ alias: 'bad alias' })])).toMatch(/Alias/);
    expect(validateDrafts([draft({ branchMode: 'existing', branch: 'no spaces here' })])).toMatch(/not a valid branch/);
    expect(validateDrafts([draft({ branchMode: 'new', baseRef: 'a~b' })])).toMatch(/base ref/);
    expect(validateDrafts([draft({ codebaseId: '' })])).toMatch(/missing its codebase/);
  });

  it('builds a draft from a codebase with a unique alias and its default branch', () => {
    const d = draftFromCodebase({ id: 'cb', alias: 'web app', defaultBranch: 'main' }, ['web-app']);
    expect(d.alias).toBe('web-app-2');
    expect(d.mode).toBe('worktree');
    expect(d.defaultBranch).toBe('main');
  });

  it('resolves the primary only when it names a draft that still exists', () => {
    expect(resolvePrimary([draft()], 'frontend')).toBe('frontend');
    expect(resolvePrimary([draft()], 'gone')).toBeUndefined();
    expect(resolvePrimary([], 'frontend')).toBeUndefined();
  });
});

describe('browserConfig', () => {
  it('sends nothing for the server default', () => {
    expect(pickerValueToBrowserConfig(DEFAULT_BROWSER_PICKER_VALUE)).toBeUndefined();
  });
  it('sends enabled + knobs once anything is touched', () => {
    expect(pickerValueToBrowserConfig({ visibility: 'visible' })).toEqual({ enabled: true, visibility: 'visible' });
    expect(pickerValueToBrowserConfig({ visibility: 'off', evalAllowed: true, allowedHostsCsv: 'a.com, b.com localhost' })).toEqual({
      enabled: true,
      visibility: 'off',
      evalAllowed: true,
      allowedHosts: ['a.com', 'b.com', 'localhost'],
    });
  });
  it('lists the three visibilities and summarises', () => {
    expect(BROWSER_VISIBILITY_OPTIONS.map((o) => o.value)).toEqual(['headless', 'visible', 'off']);
    expect(browserSummary({ visibility: 'headless' })).toBe('Headless');
    expect(browserSummary({ visibility: 'visible', evalAllowed: true, allowedHostsCsv: 'x' })).toBe('Visible (eval, hosts)');
  });
});

describe('buildCreateChatBody', () => {
  it('mirrors web: sources supersede codebaseIds, primary only with sources, defaults omitted', () => {
    const body = buildCreateChatBody({
      name: '  Cart fix ',
      description: ' ',
      projectId: 'p1',
      defaultAgentMode: 'plan',
      permissionMode: 'default',
      orchestratorMode: false,
      agentRef: 'system:reviewer',
      agentOverrides: { addSkillIds: [] },
      tags: ['bug'],
      sources: [draft()],
      primaryAlias: 'frontend',
      browser: DEFAULT_BROWSER_PICKER_VALUE,
    });
    expect(body).toEqual({
      name: 'Cart fix',
      projectId: 'p1',
      tags: ['bug'],
      defaultAgentMode: 'plan',
      permissionMode: 'default',
      agentRef: 'system:reviewer',
      sources: [{ kind: 'codebase', codebaseId: 'cb-1', mode: 'worktree', alias: 'frontend' }],
      primary: 'frontend',
    });
    expect('codebaseIds' in body).toBe(false);
    expect('useWorktree' in body).toBe(false);
    expect('browserConfig' in body).toBe(false);
  });

  it('includes overrides, orchestrator and browser config when set', () => {
    const body = buildCreateChatBody({
      name: 'x',
      orchestratorMode: true,
      agentOverrides: { removeSkillIds: ['s1'], appendInstructions: 'be brief' },
      browser: { visibility: 'visible' },
    });
    expect(body.orchestratorMode).toBe(true);
    expect(body.agentOverrides).toEqual({ removeSkillIds: ['s1'], appendInstructions: 'be brief' });
    expect(body.browserConfig).toEqual({ enabled: true, visibility: 'visible' });
    expect(body.primary).toBeUndefined();
  });
});

describe('tags + overrides', () => {
  it('adds unique trimmed tags up to 20', () => {
    expect(addTag([], '  bug ')).toEqual(['bug']);
    expect(addTag(['bug'], 'bug')).toEqual(['bug']);
    expect(addTag(Array.from({ length: 20 }, (_, i) => `t${i}`), 'more')).toHaveLength(20);
  });

  it('toggles an id into add/remove relative to the agent base', () => {
    let o = toggleOverrideId({}, 'skill', 's1', false, true);
    expect(o).toEqual({ addSkillIds: ['s1'] });
    o = toggleOverrideId(o, 'skill', 's1', false, false);
    expect(o).toEqual({});
    o = toggleOverrideId(o, 'skill', 'base', true, false);
    expect(o).toEqual({ removeSkillIds: ['base'] });
    expect(overrideIncludes(o, 'skill', 'base', true)).toBe(false);
    expect(overrideIncludes(o, 'skill', 'other', true)).toBe(true);
    expect(overrideIncludes({ addMcpServerIds: ['m'] }, 'mcp', 'm', false)).toBe(true);
  });

  it('knows an empty override set', () => {
    expect(isEmptyOverrides(undefined)).toBe(true);
    expect(isEmptyOverrides({ addSkillIds: [], appendInstructions: '' })).toBe(true);
    expect(isEmptyOverrides({ addSkillIds: ['x'] })).toBe(false);
  });
});
