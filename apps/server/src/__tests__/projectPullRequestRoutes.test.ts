// ────────────────────────────────────────────────────────────────
// /api/projects/:id/(codebases/:cid/)pull-requests* — doc §6
//
// These pin the parts a provider mock cannot: that one unreachable codebase
// degrades to an `unavailable` row instead of blanking the whole list, that a
// host with no connected account is a 409 (the PR exists — we just cannot
// read it) rather than a 404, and that "Review in chat" creates the chat on
// the PR head branch and seeds it with the review prompt.
// ────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createProjectRoutes } from '../routes/projects.js';

const getByProjectId = vi.fn();
const getCodebaseStatus = vi.fn();
const getRemoteUrl = vi.fn();
const gitFetch = vi.fn();
const providerFor = vi.fn();
const readiness = vi.fn();
const createChat = vi.fn();
const sendPrompt = vi.fn();

const listPullRequests = vi.fn();
const getPullRequestDetail = vi.fn();
const listPullRequestFiles = vi.fn();
const listPullRequestComments = vi.fn();
const getStatusChecks = vi.fn();

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const provider = {
  id: 'github',
  listPullRequests,
  getPullRequestDetail,
  listPullRequestFiles,
  listPullRequestComments,
  getStatusChecks,
};

const WEB = { id: 'cb-web', alias: 'web', clonePath: '/srv/web' };
const API = { id: 'cb-api', alias: 'api', localPath: '/srv/api' };

function pr(number: number, title: string) {
  return {
    provider: 'github', number, url: `https://github.com/acme/web/pull/${number}`,
    title, state: 'open', head: 'feature', base: 'main',
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
    repoReadinessService: { readiness },
    chatManagementService: { createChat, sendPrompt },
    gitManager: { getRemoteUrl, fetch: gitFetch },
    logger,
  };
  const app = express();
  app.use(express.json());
  app.use('/api/projects', createProjectRoutes(container as never));
  return app;
}

beforeEach(() => {
  for (const fn of [
    getByProjectId, getCodebaseStatus, getRemoteUrl, gitFetch, providerFor,
    readiness, createChat, sendPrompt, listPullRequests, getPullRequestDetail,
    listPullRequestFiles, listPullRequestComments, getStatusChecks,
    logger.debug, logger.info, logger.warn, logger.error,
  ]) {
    fn.mockReset();
  }
  getByProjectId.mockResolvedValue([WEB, API]);
  getCodebaseStatus.mockImplementation(async (id: string) => (id === 'cb-api' ? API : WEB));
  getRemoteUrl.mockResolvedValue('git@github.com:acme/web.git');
  providerFor.mockReturnValue(provider);
  listPullRequests.mockResolvedValue([pr(1, 'One')]);
});

describe('GET /api/projects/:id/pull-requests', () => {
  it('merges every codebase and tags each row with the codebase it came from', async () => {
    const res = await request(makeApp()).get('/api/projects/p1/pull-requests');

    expect(res.status).toBe(200);
    expect(res.body.unavailable).toEqual([]);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((i: { codebaseId: string }) => i.codebaseId).sort()).toEqual(['cb-api', 'cb-web']);
    expect(res.body.items[0]).toMatchObject({ number: 1, title: 'One', codebaseAlias: expect.any(String) });
  });

  it('defaults the state to open and forwards a valid one', async () => {
    await request(makeApp()).get('/api/projects/p1/pull-requests');
    expect(listPullRequests.mock.calls[0]![0]).toMatchObject({ owner: 'acme', repo: 'web', state: 'open' });

    listPullRequests.mockClear();
    await request(makeApp()).get('/api/projects/p1/pull-requests?state=all');
    expect(listPullRequests.mock.calls[0]![0]).toMatchObject({ state: 'all' });

    // An unknown value falls back to `open` rather than being handed to the host.
    listPullRequests.mockClear();
    await request(makeApp()).get('/api/projects/p1/pull-requests?state=weird');
    expect(listPullRequests.mock.calls[0]![0]).toMatchObject({ state: 'open' });
  });

  it('puts a codebase with no remote under unavailable without failing the response', async () => {
    getRemoteUrl.mockImplementation(async (dir: string) => (dir === '/srv/api' ? null : 'git@github.com:acme/web.git'));

    const res = await request(makeApp()).get('/api/projects/p1/pull-requests');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.unavailable).toEqual([
      { codebaseId: 'cb-api', alias: 'api', reason: 'No git remote configured' },
    ]);
  });

  it('puts a codebase whose host is not connected under unavailable, with the Settings hint', async () => {
    providerFor.mockImplementation(() => null);
    const res = await request(makeApp()).get('/api/projects/p1/pull-requests');

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.unavailable).toHaveLength(2);
    expect(res.body.unavailable[0].reason).toContain('is not connected');
    expect(res.body.unavailable[0].reason).toContain('Settings');
  });

  it('puts a codebase whose host call threw under unavailable, carrying the reason', async () => {
    listPullRequests
      .mockResolvedValueOnce([pr(1, 'One')])
      .mockRejectedValueOnce(new Error('502 from github.com'));

    const res = await request(makeApp()).get('/api/projects/p1/pull-requests');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.unavailable).toHaveLength(1);
    expect(res.body.unavailable[0].reason).toContain('502');
  });

  it('puts a codebase with no local checkout under unavailable', async () => {
    getByProjectId.mockResolvedValue([WEB, { id: 'cb-new', alias: 'new' }]);
    const res = await request(makeApp()).get('/api/projects/p1/pull-requests');
    expect(res.body.unavailable).toEqual([
      { codebaseId: 'cb-new', alias: 'new', reason: 'This codebase has no local checkout yet' },
    ]);
  });
});

describe('single pull-request routes', () => {
  it('returns the detail with the checks attached', async () => {
    getPullRequestDetail.mockResolvedValue({ ...pr(7, 'Seven'), body: 'B', labels: [] });
    getStatusChecks.mockResolvedValue({ total: 3, passed: 3, failed: 0, pending: 0, conclusion: 'success' });

    const res = await request(makeApp()).get('/api/projects/p1/codebases/cb-web/pull-requests/7');

    expect(res.status).toBe(200);
    expect(res.body.number).toBe(7);
    expect(res.body.checks.conclusion).toBe('success');
    expect(getPullRequestDetail).toHaveBeenCalledWith({
      owner: 'acme', repo: 'web', number: 7, host: 'github.com',
    });
  });

  it('omits the checks rather than failing when the host cannot answer', async () => {
    getPullRequestDetail.mockResolvedValue({ ...pr(7, 'Seven'), body: 'B', labels: [] });
    getStatusChecks.mockRejectedValue(new Error('checks API unavailable'));

    const res = await request(makeApp()).get('/api/projects/p1/codebases/cb-web/pull-requests/7');

    expect(res.status).toBe(200);
    expect(res.body.number).toBe(7);
    expect(res.body.checks).toBeUndefined();
  });

  it('passes files and comments straight through', async () => {
    listPullRequestFiles.mockResolvedValue([{ path: 'a.ts', status: 'modified', additions: 2, deletions: 1 }]);
    listPullRequestComments.mockResolvedValue([{ id: 'c1', author: 'octocat', body: 'lgtm', createdAt: 'x', kind: 'issue' }]);

    const files = await request(makeApp()).get('/api/projects/p1/codebases/cb-web/pull-requests/7/files');
    expect(files.status).toBe(200);
    expect(files.body).toEqual([{ path: 'a.ts', status: 'modified', additions: 2, deletions: 1 }]);

    const comments = await request(makeApp()).get('/api/projects/p1/codebases/cb-web/pull-requests/7/comments');
    expect(comments.status).toBe(200);
    expect(comments.body[0].author).toBe('octocat');
  });

  it.each(['0', '-2', 'abc', '1.5'])('refuses the pull-request number %s with 400', async (number) => {
    const res = await request(makeApp()).get(`/api/projects/p1/codebases/cb-web/pull-requests/${number}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(getPullRequestDetail).not.toHaveBeenCalled();
  });

  it('answers 409 SCM_NOT_CONNECTED when the remote host has no account', async () => {
    providerFor.mockReturnValue(null);
    const res = await request(makeApp()).get('/api/projects/p1/codebases/cb-web/pull-requests/7');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCM_NOT_CONNECTED');
    expect(res.body.error.message).toContain('github.com');
    expect(res.body.error.message).toContain('Settings');
    expect(getPullRequestDetail).not.toHaveBeenCalled();
  });
});

describe('POST …/pull-requests/:number/review-chat', () => {
  beforeEach(() => {
    getPullRequestDetail.mockResolvedValue({
      ...pr(7, 'Seven'), head: 'feature/login', body: 'B', labels: [],
      additions: 1, deletions: 0, changedFiles: 1, commits: 1,
      headSha: 'aaa', baseSha: 'bbb', mergeable: true,
    });
    listPullRequestFiles.mockResolvedValue([
      { path: 'a.ts', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@' },
    ]);
    gitFetch.mockResolvedValue(undefined);
    createChat.mockResolvedValue({ id: 'chat-1', name: 'Review PR #7: Seven' });
    sendPrompt.mockResolvedValue(undefined);
  });

  it('fetches the head, creates a worktree chat on it and sends the review prompt', async () => {
    const res = await request(makeApp())
      .post('/api/projects/p1/codebases/cb-web/pull-requests/7/review-chat')
      .send({ instructions: 'focus on the auth path', model: 'gpt-5' });

    expect(res.status).toBe(201);
    expect(res.body.chat.id).toBe('chat-1');

    expect(gitFetch).toHaveBeenCalledWith('/srv/web', 'origin', 'feature/login');

    const params = createChat.mock.calls[0]![0];
    expect(params.name).toBe('Review PR #7: Seven');
    expect(params.projectId).toBe('p1');
    expect(params.model).toBe('gpt-5');
    expect(params.sources).toEqual([
      {
        kind: 'codebase',
        codebaseId: 'cb-web',
        mode: 'worktree',
        newBranch: expect.stringMatching(/^generatorai\/review-pr-7-[0-9a-f]{6}$/),
        baseRef: 'origin/feature/login',
      },
    ]);

    const [chatId, prompt] = sendPrompt.mock.calls[0]!;
    expect(chatId).toBe('chat-1');
    expect(prompt).toContain('focus on the auth path');
    expect(prompt).toContain('a.ts');
  });

  it('leaves model and agentRef off entirely when they were not asked for', async () => {
    await request(makeApp())
      .post('/api/projects/p1/codebases/cb-web/pull-requests/7/review-chat')
      .send({});
    const params = createChat.mock.calls[0]![0];
    expect(params).not.toHaveProperty('model');
    expect(params).not.toHaveProperty('agentRef');
  });

  it('still creates the chat when the head fetch fails', async () => {
    gitFetch.mockRejectedValue(new Error('no such ref'));
    const res = await request(makeApp())
      .post('/api/projects/p1/codebases/cb-web/pull-requests/7/review-chat')
      .send({});
    expect(res.status).toBe(201);
    expect(createChat).toHaveBeenCalled();
  });

  it('still answers 201 with the chat when the prompt could not be sent', async () => {
    // The chat exists and has the PR branch checked out; throwing it away to
    // report the failure would leave the user worse off than a retry.
    sendPrompt.mockRejectedValue(new Error('chat busy'));
    const res = await request(makeApp())
      .post('/api/projects/p1/codebases/cb-web/pull-requests/7/review-chat')
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.chat.id).toBe('chat-1');
    expect(logger.error).toHaveBeenCalled();
  });

  it('does not create a chat when the host is not connected', async () => {
    providerFor.mockReturnValue(null);
    const res = await request(makeApp())
      .post('/api/projects/p1/codebases/cb-web/pull-requests/7/review-chat')
      .send({});
    expect(res.status).toBe(409);
    expect(createChat).not.toHaveBeenCalled();
  });
});

describe('GET /api/projects/:id/codebases/:cid/readiness', () => {
  it('answers the readiness for the codebase checkout under its own alias', async () => {
    readiness.mockResolvedValue({ alias: 'web', repoDir: '/srv/web', isRepo: true });
    const res = await request(makeApp()).get('/api/projects/p1/codebases/cb-web/readiness');

    expect(res.status).toBe(200);
    expect(res.body.alias).toBe('web');
    expect(readiness).toHaveBeenCalledWith({ repoDir: '/srv/web', alias: 'web' });
  });

  it('400s a codebase that has no local checkout yet', async () => {
    getCodebaseStatus.mockResolvedValue({ id: 'cb-new', alias: 'new' });
    const res = await request(makeApp()).get('/api/projects/p1/codebases/cb-new/readiness');
    expect(res.status).toBe(400);
    expect(readiness).not.toHaveBeenCalled();
  });
});
