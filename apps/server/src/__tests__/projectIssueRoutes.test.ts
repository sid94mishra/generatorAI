// ────────────────────────────────────────────────────────────────
// /api/projects/:id/(codebases/:cid/)issues* and …/pull-requests/:n/merge
// (D-146). The provider is mocked — no GitHub call is ever made. These pin
// the routing contract: the codebase → repo-slug resolution shared with the
// PR routes, body validation, the 409s (host not connected, PR not
// mergeable), and that a branch that cannot be deleted never fails a merge.
// ────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PullRequestNotMergeableError } from '@generatorai/core';

import { createProjectRoutes } from '../routes/projects.js';
import { createErrorMiddleware } from '../middleware/errorHandler.js';

const getByProjectId = vi.fn();
const getCodebaseStatus = vi.fn();
const getRemoteUrl = vi.fn();
const providerFor = vi.fn();

const listIssues = vi.fn();
const getIssue = vi.fn();
const listIssueComments = vi.fn();
const createIssue = vi.fn();
const commentOnIssue = vi.fn();
const closeIssue = vi.fn();
const getPullRequestDetail = vi.fn();
const mergePullRequest = vi.fn();
const deleteBranch = vi.fn();

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const provider = {
  id: 'github',
  listIssues,
  getIssue,
  listIssueComments,
  createIssue,
  commentOnIssue,
  closeIssue,
  getPullRequestDetail,
  mergePullRequest,
  deleteBranch,
};

const WEB = { id: 'cb-web', alias: 'web', clonePath: '/srv/web' };
const API = { id: 'cb-api', alias: 'api', localPath: '/srv/api' };
const REF = { owner: 'acme', repo: 'web', number: 7, host: 'github.com' };

function issue(number: number, updatedAt = '2026-10-01T00:00:00Z', extra: Record<string, unknown> = {}) {
  return {
    provider: 'github', number, title: `Issue ${number}`, body: 'Body', state: 'open', labels: ['bug'],
    url: `https://github.com/acme/web/issues/${number}`, createdAt: '2026-09-01T00:00:00Z', updatedAt, comments: 0, ...extra,
  };
}

function makeApp() {
  const container = {
    projectService: {},
    codebaseService: { getByProjectId, getCodebaseStatus },
    worktreeService: {},
    worktreeCleanupService: {},
    projectConfigService: {},
    systemArtifactService: {},
    artifactCatalog: {},
    security: { secretStore: {} },
    sourceControlRegistry: { providerFor },
    repoReadinessService: {},
    chatManagementService: {},
    gitManager: { getRemoteUrl },
    logger,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/projects', createProjectRoutes(container as never));
  app.use(createErrorMiddleware(logger as never));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  getByProjectId.mockResolvedValue([WEB, API]);
  getCodebaseStatus.mockImplementation(async (id: string) => (id === 'cb-api' ? API : WEB));
  getRemoteUrl.mockResolvedValue('git@github.com:acme/web.git');
  providerFor.mockReturnValue(provider);
  getPullRequestDetail.mockResolvedValue({ number: 7, state: 'open', head: 'feature/login', draft: false });
  mergePullRequest.mockResolvedValue({ merged: true, sha: 'abc', message: 'Pull Request successfully merged' });
  deleteBranch.mockResolvedValue(true);
});

describe('POST …/pull-requests/:number/merge', () => {
  const url = '/api/projects/p1/codebases/cb-web/pull-requests/7/merge';

  it('merges with the requested method', async () => {
    const res = await request(makeApp()).post(url).send({ method: 'squash' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ merged: true, sha: 'abc', message: 'Pull Request successfully merged' });
    expect(mergePullRequest).toHaveBeenCalledWith(REF, { method: 'squash' });
    expect(deleteBranch).not.toHaveBeenCalled();
  });

  it('defaults to a merge commit and deletes the head branch when asked', async () => {
    const res = await request(makeApp()).post(url).send({ deleteBranch: true });
    expect(mergePullRequest).toHaveBeenCalledWith(REF, { method: 'merge' });
    expect(deleteBranch).toHaveBeenCalledWith('acme', 'web', 'feature/login', 'github.com');
    expect(res.body.branchDeleted).toBe(true);
  });

  it('still answers 200 when the merge happened but the branch could not be deleted', async () => {
    deleteBranch.mockRejectedValue(new Error('GitHub could not delete the branch: Forbidden'));
    const res = await request(makeApp()).post(url).send({ method: 'merge', deleteBranch: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ merged: true, branchDeleted: false, branchDeleteError: 'GitHub could not delete the branch: Forbidden' });
  });

  it('answers 409 SCM_NOT_MERGEABLE with the host\'s reason', async () => {
    mergePullRequest.mockRejectedValue(new PullRequestNotMergeableError('Pull request #7 cannot be merged: Merge conflict'));
    const res = await request(makeApp()).post(url).send({ method: 'merge' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCM_NOT_MERGEABLE');
    expect(res.body.error.message).toContain('Merge conflict');
  });

  it('refuses an already merged pull request before asking the host', async () => {
    getPullRequestDetail.mockResolvedValue({ number: 7, state: 'merged', head: 'x' });
    const res = await request(makeApp()).post(url).send({ method: 'merge' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Pull request #7 is already merged');
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it('400s an unknown method without touching the host', async () => {
    const res = await request(makeApp()).post(url).send({ method: 'octopus' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('method');
    expect(getPullRequestDetail).not.toHaveBeenCalled();
  });

  it('answers 409 SCM_NOT_CONNECTED when the host has no account', async () => {
    providerFor.mockReturnValue(null);
    const res = await request(makeApp()).post(url).send({ method: 'merge' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCM_NOT_CONNECTED');
  });
});

describe('GET /api/projects/:id/issues', () => {
  it('merges every codebase, newest activity first, tagging each row with its codebase', async () => {
    listIssues
      .mockResolvedValueOnce([issue(1, '2026-10-01T00:00:00Z')])
      .mockResolvedValueOnce([issue(2, '2026-10-05T00:00:00Z')]);
    const res = await request(makeApp()).get('/api/projects/p1/issues');

    expect(res.status).toBe(200);
    expect(res.body.unavailable).toEqual([]);
    expect(res.body.items.map((i: { number: number }) => i.number)).toEqual([2, 1]);
    expect(res.body.items[0]).toMatchObject({ codebaseId: expect.any(String), codebaseAlias: expect.any(String) });
    expect(listIssues.mock.calls[0]![0]).toEqual({ owner: 'acme', repo: 'web', state: 'open', host: 'github.com' });
  });

  it('forwards a valid state and labels, and falls back to open', async () => {
    listIssues.mockResolvedValue([]);
    await request(makeApp()).get('/api/projects/p1/issues?state=closed&labels=bug,%20ui');
    expect(listIssues.mock.calls[0]![0]).toMatchObject({ state: 'closed', labels: ['bug', 'ui'] });
    listIssues.mockClear();
    await request(makeApp()).get('/api/projects/p1/issues?state=weird');
    expect(listIssues.mock.calls[0]![0]).toMatchObject({ state: 'open' });
    expect(listIssues.mock.calls[0]![0]).not.toHaveProperty('labels');
  });

  it('lists a codebase that is not connected, or whose host call failed, under unavailable', async () => {
    providerFor.mockImplementation(() => null);
    const res = await request(makeApp()).get('/api/projects/p1/issues');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.unavailable).toHaveLength(2);
    expect(res.body.unavailable[0].reason).toContain('Settings');

    providerFor.mockReturnValue(provider);
    listIssues.mockResolvedValueOnce([issue(1)]).mockRejectedValueOnce(new Error('GitHub could not list issues: issues are disabled'));
    const partial = await request(makeApp()).get('/api/projects/p1/issues');
    expect(partial.body.items).toHaveLength(1);
    expect(partial.body.unavailable[0].reason).toContain('issues are disabled');
  });
});

describe('single-issue routes', () => {
  it('returns the issue with its comments, skipping the comments call when there are none', async () => {
    getIssue.mockResolvedValue(issue(7, undefined, { comments: 2 }));
    listIssueComments.mockResolvedValue([{ id: '1', author: 'a', body: 'x', createdAt: 'c' }]);
    const res = await request(makeApp()).get('/api/projects/p1/codebases/cb-web/issues/7');
    expect(res.status).toBe(200);
    expect(res.body.issue.number).toBe(7);
    expect(res.body.comments).toHaveLength(1);
    expect(getIssue).toHaveBeenCalledWith(REF);

    getIssue.mockResolvedValue(issue(7));
    listIssueComments.mockClear();
    const none = await request(makeApp()).get('/api/projects/p1/codebases/cb-web/issues/7');
    expect(none.body.comments).toEqual([]);
    expect(listIssueComments).not.toHaveBeenCalled();
  });

  it('404s a number that is not an issue, 400s a bad number', async () => {
    getIssue.mockResolvedValue(null);
    const res = await request(makeApp()).get('/api/projects/p1/codebases/cb-web/issues/7');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const bad = await request(makeApp()).get('/api/projects/p1/codebases/cb-web/issues/abc');
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe('Issue number must be a positive integer');
  });

  it('creates an issue (201) and validates the title', async () => {
    createIssue.mockResolvedValue(issue(9));
    const res = await request(makeApp())
      .post('/api/projects/p1/codebases/cb-web/issues')
      .send({ title: '  Login loops  ', body: 'Steps', labels: ['bug'] });
    expect(res.status).toBe(201);
    expect(res.body.number).toBe(9);
    expect(createIssue).toHaveBeenCalledWith({ owner: 'acme', repo: 'web', host: 'github.com', title: 'Login loops', body: 'Steps', labels: ['bug'] });

    const bad = await request(makeApp()).post('/api/projects/p1/codebases/cb-web/issues').send({ title: '' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('title');
  });

  it('does not create an issue when the host is not connected', async () => {
    providerFor.mockReturnValue(null);
    const res = await request(makeApp()).post('/api/projects/p1/codebases/cb-web/issues').send({ title: 'x' });
    expect(res.status).toBe(409);
    expect(createIssue).not.toHaveBeenCalled();
  });

  it('comments (201) and refuses an empty comment', async () => {
    commentOnIssue.mockResolvedValue({ id: 'c1', author: 'me', body: 'On it', createdAt: 'c' });
    const res = await request(makeApp()).post('/api/projects/p1/codebases/cb-web/issues/7/comments').send({ body: 'On it' });
    expect(res.status).toBe(201);
    expect(commentOnIssue).toHaveBeenCalledWith(REF, 'On it');

    const empty = await request(makeApp()).post('/api/projects/p1/codebases/cb-web/issues/7/comments').send({ body: '   ' });
    expect(empty.status).toBe(400);
  });

  it('closes with a reason, posting the comment first', async () => {
    closeIssue.mockResolvedValue(issue(7, undefined, { state: 'closed', stateReason: 'not_planned' }));
    commentOnIssue.mockResolvedValue({ id: 'c1' });
    const res = await request(makeApp())
      .post('/api/projects/p1/codebases/cb-web/issues/7/close')
      .send({ reason: 'not_planned', comment: 'Duplicate of #2' });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('closed');
    expect(commentOnIssue).toHaveBeenCalledWith(REF, 'Duplicate of #2');
    expect(closeIssue).toHaveBeenCalledWith(REF, { reason: 'not_planned' });
    expect(commentOnIssue.mock.invocationCallOrder[0]!).toBeLessThan(closeIssue.mock.invocationCallOrder[0]!);

    const bad = await request(makeApp()).post('/api/projects/p1/codebases/cb-web/issues/7/close').send({ reason: 'wontfix' });
    expect(bad.status).toBe(400);
  });
});
