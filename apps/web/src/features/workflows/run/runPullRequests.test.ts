import { describe, expect, it } from 'vitest';
import type { RunSystemVars } from '@generatorai/shared';
import { runPullRequests } from './runPullRequests.js';

const pr = (number: number) => ({ provider: 'github', number, url: `https://github.com/o/r/pull/${number}`, title: `PR ${number}`, state: 'open', head: 'h', base: 'develop' });

describe('runPullRequests (U-22)', () => {
  it('lists each opened PR once, with its codebase alias', () => {
    const vars = {
      postProcessing: [
        { stepName: 'Commit and push', success: true, durationMs: 1, scm: [{ status: 'ok', alias: 'pulse', steps: [] }] },
        { stepName: 'Open PR', success: true, durationMs: 1, scm: [{ status: 'ok', alias: 'pulse', steps: [], pullRequest: pr(10) }] },
        { stepName: 'Again', success: true, durationMs: 1, scm: [{ status: 'ok', alias: 'pulse', steps: [], pullRequest: pr(10) }] },
      ],
    } as unknown as RunSystemVars;
    expect(runPullRequests(vars)).toEqual([{ alias: 'pulse', pr: pr(10) }]);
  });

  it('is empty without post-processing', () => {
    expect(runPullRequests(undefined)).toEqual([]);
    expect(runPullRequests({} as RunSystemVars)).toEqual([]);
  });
});
