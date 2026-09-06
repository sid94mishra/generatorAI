import { describe, expect, it } from 'vitest';
import {
  basename,
  defaultNewBranch,
  describeDraft,
  draftFromCodebase,
  draftFromFolder,
  draftsFromSpecs,
  draftsToSources,
  sanitizeAlias,
  slugifyChatName,
  sourcesSummary,
  uniqueAlias,
  validateDrafts,
  type DraftSource,
} from '../sourceModel.js';

const CHAT = 'Cart fix!';

describe('slugifyChatName / defaultNewBranch', () => {
  it('makes a git-safe slug of the chat name', () => {
    expect(slugifyChatName('Cart fix!')).toBe('cart-fix');
    expect(slugifyChatName('  ---  ')).toBe('chat');
    expect(defaultNewBranch('Cart fix!')).toBe('generatorai/cart-fix');
  });
});

describe('aliases', () => {
  it('takes the last segment of a path on either separator', () => {
    expect(basename('C:\\src\\my-app')).toBe('my-app');
    expect(basename('/home/me/proj/')).toBe('proj');
    expect(basename('C:\\')).toBe('C');
  });

  it('coerces text into the server’s alias rule', () => {
    expect(sanitizeAlias('my app (2)')).toBe('my-app-2');
    expect(sanitizeAlias('***')).toBe('source');
  });

  it('de-duplicates against the aliases already in use', () => {
    expect(uniqueAlias('frontend', [])).toBe('frontend');
    expect(uniqueAlias('frontend', ['frontend'])).toBe('frontend-2');
    expect(uniqueAlias('frontend', ['frontend', 'frontend-2'])).toBe('frontend-3');
  });
});

describe('draft defaults', () => {
  it('offers a worktree for a git-remote codebase and refuses in place', () => {
    const d = draftFromCodebase(
      { id: 'cb1', alias: 'frontend', type: 'git-remote', defaultBranch: 'main' },
      [],
    );
    expect(d.mode).toBe('worktree');
    expect(d.branchMode).toBe('new');
    expect(d.baseRef).toBe('main');
    expect(d.meta.allowInPlace).toBe(false);
    expect(d.meta.allowInPlaceReason).toBeTruthy();
    expect(d.meta.allowWorktree).toBe(true);
  });

  it('offers in place for a local-dir codebase and refuses a worktree', () => {
    const d = draftFromCodebase({ id: 'cb2', alias: 'docs', type: 'local-dir' }, []);
    expect(d.mode).toBe('in-place');
    expect(d.branchMode).toBe('current');
    expect(d.meta.allowWorktree).toBe(false);
  });

  it('defaults a folder to in place, and only allows a worktree for a repo', () => {
    const plain = draftFromFolder(
      'C:\\src\\notes',
      { isRepo: false, currentBranch: null, branches: [], dirty: false, nestedRepos: [] },
      [],
    );
    expect(plain.mode).toBe('in-place');
    expect(plain.meta.allowWorktree).toBe(false);

    const repo = draftFromFolder(
      '/home/me/api',
      { isRepo: true, currentBranch: 'develop', branches: ['main', 'develop'], dirty: true, nestedRepos: ['web'] },
      ['api'],
    );
    expect(repo.alias).toBe('api-2');
    expect(repo.meta.allowWorktree).toBe(true);
    expect(repo.meta.dirty).toBe(true);
    expect(repo.meta.nestedRepos).toEqual(['web']);
  });
});

describe('draftsToSources', () => {
  const worktree = draftFromCodebase(
    { id: 'cb1', alias: 'frontend', type: 'git-remote', defaultBranch: 'main' },
    [],
  );
  const folder = draftFromFolder(
    'C:\\src\\backend',
    { isRepo: true, currentBranch: 'develop', branches: ['main', 'develop'], dirty: false, nestedRepos: [] },
    ['frontend'],
  );

  it('sends the placeholder branch name when the field was left empty', () => {
    const [spec] = draftsToSources([worktree], CHAT);
    expect(spec).toEqual({
      kind: 'codebase',
      codebaseId: 'cb1',
      mode: 'worktree',
      alias: 'frontend',
      newBranch: 'generatorai/cart-fix',
      baseRef: 'main',
    });
  });

  it('sends the typed branch name over the placeholder', () => {
    const [spec] = draftsToSources([{ ...worktree, newBranch: '  feature/x  ' }], CHAT);
    expect(spec).toMatchObject({ newBranch: 'feature/x' });
  });

  it('sends `branch` (and no newBranch) for an existing branch', () => {
    const [spec] = draftsToSources(
      [{ ...folder, branchMode: 'existing', branch: 'develop' }],
      CHAT,
    );
    expect(spec).toEqual({
      kind: 'folder',
      path: 'C:\\src\\backend',
      mode: 'in-place',
      alias: 'backend',
      branch: 'develop',
    });
  });

  it('sends neither branch field when the source stays where it is', () => {
    const [spec] = draftsToSources([folder], CHAT);
    expect(spec).toEqual({
      kind: 'folder',
      path: 'C:\\src\\backend',
      mode: 'in-place',
      alias: 'backend',
    });
  });

  it('omits baseRef when no base was chosen', () => {
    const [spec] = draftsToSources([{ ...folder, branchMode: 'new', baseRef: '' }], CHAT);
    expect(spec).not.toHaveProperty('baseRef');
    expect(spec).toMatchObject({ newBranch: 'generatorai/cart-fix' });
  });

  it('preserves order — sources[0] is the agent’s cwd', () => {
    const specs = draftsToSources([worktree, folder], CHAT);
    expect(specs.map((s) => s.alias)).toEqual(['frontend', 'backend']);
  });
});

describe('summary line', () => {
  it('reads as one sentence per source', () => {
    const worktree = draftFromCodebase(
      { id: 'cb1', alias: 'frontend', type: 'git-remote', defaultBranch: 'main' },
      [],
    );
    const backend: DraftSource = {
      ...draftFromFolder(
        '/src/backend',
        { isRepo: true, currentBranch: 'develop', branches: ['develop'], dirty: false, nestedRepos: [] },
        ['frontend'],
      ),
      branchMode: 'existing',
      branch: 'develop',
    };
    expect(describeDraft(worktree, CHAT)).toBe(
      'frontend → worktree on generatorai/cart-fix from main',
    );
    expect(sourcesSummary([worktree, backend], CHAT)).toBe(
      'frontend → worktree on generatorai/cart-fix from main · backend → in place on develop',
    );
  });
});

describe('validateDrafts', () => {
  const base = draftFromCodebase({ id: 'cb1', alias: 'frontend', type: 'git-remote' }, []);

  it('accepts a well-formed plan', () => {
    expect(validateDrafts([base])).toBeNull();
  });

  it('rejects two sources with the same name', () => {
    expect(validateDrafts([base, { ...base, key: 'k2' }])).toMatch(/both called "frontend"/);
  });

  it('rejects an alias the server would not accept', () => {
    expect(validateDrafts([{ ...base, alias: 'my app' }])).toMatch(/not a valid name/);
  });

  it('rejects a worktree on something that is not a repository', () => {
    const plain = draftFromFolder(
      '/src/notes',
      { isRepo: false, currentBranch: null, branches: [], dirty: false, nestedRepos: [] },
      [],
    );
    expect(validateDrafts([{ ...plain, mode: 'worktree' }])).toMatch(/cannot use a worktree/);
  });

  it('rejects in-place on a bare clone', () => {
    expect(validateDrafts([{ ...base, mode: 'in-place' }])).toMatch(/cannot be edited in place/);
  });

  it('rejects a branch name git would refuse', () => {
    expect(validateDrafts([{ ...base, newBranch: 'has space' }])).toMatch(/not a valid branch name/);
  });
});

describe('draftsFromSpecs (prefill)', () => {
  it('round-trips a saved plan back into editable drafts', () => {
    const specs = draftsToSources(
      [
        draftFromCodebase(
          { id: 'cb1', alias: 'frontend', type: 'git-remote', defaultBranch: 'main' },
          [],
        ),
      ],
      CHAT,
    );
    const drafts = draftsFromSpecs(specs, {
      codebases: [{ id: 'cb1', alias: 'frontend', type: 'git-remote', defaultBranch: 'main' }],
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      alias: 'frontend',
      mode: 'worktree',
      branchMode: 'new',
      newBranch: 'generatorai/cart-fix',
      baseRef: 'main',
    });
    // …and back out again unchanged.
    expect(draftsToSources(drafts, CHAT)).toEqual(specs);
  });

  it('does not reject a saved plan just because the catalogue has not loaded', () => {
    const specs = draftsToSources(
      [
        {
          ...draftFromCodebase({ id: 'cb9', alias: 'api', type: 'local-dir' }, []),
          mode: 'in-place',
          branchMode: 'current',
        },
      ],
      CHAT,
    );
    // No `codebases` and no `mounts`: nothing is known about cb9 yet.
    const drafts = draftsFromSpecs(specs, {});
    expect(drafts[0]).toMatchObject({ alias: 'api', mode: 'in-place' });
    expect(validateDrafts(drafts)).toBeNull();
  });

  it('falls back to the realised mounts when the chat predates `sources`', () => {
    const drafts = draftsFromSpecs(undefined, {
      mounts: [
        {
          id: 'm1',
          workspaceId: 'w1',
          position: 0,
          alias: 'api',
          originKind: 'folder',
          originPath: '/src/api',
          mode: 'in-place',
          path: '/src/api',
          git: { isRepo: true, branch: 'develop' },
          status: 'ready',
          hasUncommittedChanges: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ alias: 'api', kind: 'folder', mode: 'in-place' });
    expect(drafts[0]!.meta.dirty).toBe(true);
  });
});
