import { describe, expect, it } from 'vitest';
import type { RepoReadiness } from '@generatorai/shared';
import { composeFlowRequest, shipActionOf, splitCommitMessage, type ShipForm } from '../scmFlow.js';

function repo(overrides: Partial<RepoReadiness> = {}): RepoReadiness {
  return {
    alias: '.',
    repoDir: '/w',
    isRepo: true,
    hasRemote: true,
    connected: true,
    branch: 'feature',
    detached: false,
    defaultBranch: 'main',
    onDefaultBranch: false,
    dirty: false,
    changedFiles: 0,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    mergeInProgress: false,
    conflictedFiles: [],
    openPullRequest: null,
    can: { commit: true, push: true, pullRequest: true },
    reasons: {},
    ...overrides,
  };
}

const FORM: ShipForm = {
  mode: 'pr',
  summary: '',
  description: '',
  prTitle: '',
  prBody: '',
  base: 'main',
  draft: false,
  reviewers: ['ana'],
  assignees: [],
  labels: ['bug'],
  closesIssues: [7],
};

describe('shipActionOf', () => {
  it('names the next step for the repo state', () => {
    expect(shipActionOf(repo({ dirty: true }))?.label).toBe('Commit');
    expect(shipActionOf(repo({ ahead: 2 }))?.label).toBe('Push');
    expect(shipActionOf(repo())?.label).toBe('Pull request');
    const pr = { provider: 'github' as const, number: 9, url: 'u', title: 't', state: 'open' as const, head: 'feature', base: 'main' };
    expect(shipActionOf(repo({ openPullRequest: pr }))?.label).toBe('PR #9');
  });

  it('offers nothing for a clean, never-pushed branch, the default branch, or a folder', () => {
    expect(shipActionOf(repo({ hasUpstream: false, ahead: null }))).toBeNull();
    expect(shipActionOf(repo({ onDefaultBranch: true, branch: 'main' }))).toBeNull();
    expect(shipActionOf(repo({ isRepo: false }))).toBeNull();
  });
});

describe('composeFlowRequest', () => {
  it('asks for generated text, and carries the sidebar picks and linked issues', () => {
    expect(composeFlowRequest(repo({ dirty: true }), FORM, undefined)).toEqual({
      alias: '.',
      commit: { generate: true },
      push: true,
      pullRequest: { generate: true, base: 'main', draft: false, reviewers: ['ana'], labels: ['bug'], closesIssues: [7] },
    });
  });

  it('never asks for a PR or push the mount cannot do', () => {
    const request = composeFlowRequest(repo({ can: { commit: true, push: false, pullRequest: false } }), FORM, undefined);
    expect(request.push).toBe(false);
    expect(request.pullRequest).toBeUndefined();
  });

  it('round-trips a generated message into summary and description', () => {
    expect(splitCommitMessage('Add slugify\n\nStrips accents.\nKeeps digits.')).toEqual({
      summary: 'Add slugify',
      description: 'Strips accents.\nKeeps digits.',
    });
  });
});
