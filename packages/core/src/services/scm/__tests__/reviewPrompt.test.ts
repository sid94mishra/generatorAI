import { describe, it, expect } from 'vitest';
import type { PullRequestDetail, PullRequestFile } from '@generatorai/shared';
import { buildPullRequestReviewPrompt } from '../reviewPrompt.js';

const pr: PullRequestDetail = {
  provider: 'github',
  number: 42,
  url: 'https://github.com/acme/web/pull/42',
  title: 'Add the widget registry',
  state: 'open',
  head: 'feature/widgets',
  base: 'main',
  author: 'octocat',
  body: 'Adds a registry so widgets can be looked up by name.',
  mergeable: true,
  additions: 120,
  deletions: 14,
  changedFiles: 2,
  commits: 3,
  headSha: 'aaa',
  baseSha: 'bbb',
  labels: ['feature'],
};

const files: PullRequestFile[] = [
  {
    path: 'src/widgets/registry.ts',
    status: 'added',
    additions: 100,
    deletions: 0,
    patch: '@@ -0,0 +1,3 @@\n+export class Registry {}\n',
  },
  {
    path: 'src/widgets/index.ts',
    previousPath: 'src/widgets/old.ts',
    status: 'renamed',
    additions: 20,
    deletions: 14,
  },
];

describe('buildPullRequestReviewPrompt', () => {
  const prompt = buildPullRequestReviewPrompt({ pr, files });

  it('names the PR', () => {
    expect(prompt).toContain('#42');
    expect(prompt).toContain('Add the widget registry');
    expect(prompt).toContain('octocat');
    expect(prompt).toContain('`main` ← `feature/widgets`');
    expect(prompt).toContain('Adds a registry so widgets can be looked up by name.');
  });

  it('lists the changed files and their patches', () => {
    expect(prompt).toContain('src/widgets/registry.ts');
    expect(prompt).toContain('src/widgets/index.ts');
    expect(prompt).toContain('was `src/widgets/old.ts`');
    expect(prompt).toContain('+export class Registry {}');
    expect(prompt).toContain('no patch available');
  });

  it('states the review dimensions', () => {
    for (const dimension of [
      'Correctness and edge cases',
      'Security',
      'path traversal',
      'SSRF',
      'Error handling and resource cleanup',
      'Concurrency',
      'Tests',
      'Performance',
      'API and contract compatibility',
      'Readability and consistency',
    ]) {
      expect(prompt).toContain(dimension);
    }
    expect(prompt).toContain('Read the repository around the diff');
    expect(prompt).toContain('Do not invent problems; if the diff is fine, say so.');
  });

  it('fixes the output format, the severity ordering and the verdict', () => {
    expect(prompt).toContain('- **[severity]** `path:line` — <what is wrong> → <the fix>');
    expect(prompt).toContain('Order them severity-descending');
    expect(prompt).toContain('`blocker`, `major`, `minor`, `nit`');
    expect(prompt).toContain('## Verdict');
    expect(prompt).toContain('`approve`, `approve with comments`, or `request changes`');
  });

  it('appends extra reviewer instructions only when given', () => {
    expect(prompt).not.toContain('## Extra instructions from the reviewer');
    const withExtra = buildPullRequestReviewPrompt({
      pr,
      files,
      instructions: 'Focus on the SQL layer.',
    });
    expect(withExtra).toContain('## Extra instructions from the reviewer');
    expect(withExtra).toContain('Focus on the SQL layer.');
  });

  it('caps the patch text', () => {
    const huge: PullRequestFile[] = Array.from({ length: 50 }, (_, i) => ({
      path: `src/f${i}.ts`,
      status: 'modified' as const,
      additions: 1,
      deletions: 1,
      patch: '+x\n'.repeat(5000),
    }));
    const big = buildPullRequestReviewPrompt({ pr, files: huge });
    // The prompt scaffolding is small; the patch block itself is bounded.
    expect(big.length).toBeLessThan(60_000);
  });
});
