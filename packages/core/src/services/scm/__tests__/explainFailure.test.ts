import { describe, expect, it } from 'vitest';
import { explainScmFailure } from '../explainFailure.js';

describe('explainScmFailure', () => {
  it('a refused commit shows what the hook said, not the checkout path', () => {
    expect(
      explainScmFailure('commit', 'Failed to commit in /Users/me/Library/Application Support/x/shop: lint: src/a.ts:1 no magic numbers\n'),
    ).toBe('The commit was refused: lint: src/a.ts:1 no magic numbers');
    expect(explainScmFailure('commit', 'Failed to commit in /w: Author identity unknown\n\n*** Please tell me who you are.')).toMatch(
      /^Git does not know who is committing/,
    );
  });

  it('a push the remote refused keeps only what the remote said', () => {
    const raw =
      'Failed to push feature to origin: remote: GH006: Protected branch update failed.\n' +
      'To /tmp/origin.git\n ! [remote rejected] feature -> feature (pre-receive hook declined)\n' +
      "error: failed to push some refs to '/tmp/origin.git'";
    expect(explainScmFailure('push', raw)).toBe('The remote refused the push: GH006: Protected branch update failed.');
  });

  it('names a stale branch, bad credentials and an unreachable remote', () => {
    expect(explainScmFailure('push', 'Failed to push f to origin: ! [rejected] f -> f (fetch first)\nhint: Updates were rejected')).toMatch(
      /^The remote branch has commits this checkout does not/,
    );
    expect(explainScmFailure('push', "Failed to push f to origin: fatal: Authentication failed for 'https://github.com/a/b.git/'")).toMatch(
      /^The remote did not accept your credentials/,
    );
    expect(explainScmFailure('push', "Failed to push f to origin: fatal: unable to access 'https://x/': Could not resolve host: x")).toBe(
      'Could not reach the remote. Check the connection and push again.',
    );
  });

  it('anything else passes through without the noise lines', () => {
    expect(explainScmFailure('pull_request', 'Validation Failed: A pull request already exists')).toBe(
      'Validation Failed: A pull request already exists',
    );
  });
});
