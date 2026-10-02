// ────────────────────────────────────────────────────────────────
// G-02 / G-14 — the chat list, end to end below the HTTP layer and through it.
//
// Real temp SQLite database, real Drizzle repositories, the real
// `AttentionService` (live Needs you / Running), the real `ChatListService`
// and `ChatChangeStatsService`, the real change-summary engine over a
// THROWAWAY dummy git repository (scripts/redesign/make-dummy-repo.mjs —
// never this checkout), and the real `GET /api/chats` route.
//
// What must hold:
//   - the response is `{ items, nextCursor, total, counts }` and keyset
//     paging through the route visits every chat once;
//   - `state=needs_you|running` follows the attention feed, `done|failed`
//     the last turn of a chat that is not live;
//   - `projectId` (G-14), `q`, `sort`, `workers`;
//   - "Changes ±" is the dummy repo's real baseline → working diff, filled in
//     lazily for a row that never had it, and recomputed (with `chat.updated`)
//     when the working tree moves.
// ────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentInteractionService,
  AttentionService,
  ChangeSummaryService,
  ChatChangeStatsService,
  ChatListInvalidator,
  ChatListService,
  EventBus,
  GitManager,
  SandboxedScriptRunner,
  StreamingChatRegistry,
  netChangeStats,
} from '@generatorai/core';
import {
  createDB,
  migrateDB,
  sessions,
  DrizzleAgentInteractionRepository,
  DrizzleAutomationExecutionRepository,
  DrizzleAutomationRepository,
  DrizzleChatMessageRepository,
  DrizzleChatRepository,
  DrizzleProjectRepository,
  DrizzleStageRunRepository,
  SqliteWorkflowDefinitionStore,
  DrizzleWorkflowRunRepository,
  type AppDatabase,
} from '@generatorai/db';
import type { Chat, ChatListItem, ChatListPage, ILogger, PersistedEvent } from '@generatorai/shared';

import { createChatApiRoutes } from '../routes/chats.js';
import { createProjectRoutes } from '../routes/projects.js';
import { createErrorMiddleware } from '../middleware/errorHandler.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const T0 = new Date('2026-09-26T09:00:00.000Z');

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
} as unknown as ILogger;

let dummyRoot: string;
let work: string;
let head: string;

let dir: string;
let db: AppDatabase;
let bus: EventBus;
let streaming: StreamingChatRegistry;
let interactions: AgentInteractionService;
let attention: AttentionService;
let changeStats: ChatChangeStatsService;
let invalidator: ChatListInvalidator;
let app: express.Express;
let chatRepo: DrizzleChatRepository;
let updated: string[];

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

beforeAll(() => {
  // A throwaway repo with a modified, an added, a deleted, a renamed and an untracked file.
  const out = execFileSync(process.execPath, [join(REPO_ROOT, 'scripts', 'redesign', 'make-dummy-repo.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .toString()
    .trim()
    .split(/\r?\n/);
  work = out[out.length - 1]!;
  dummyRoot = dirname(work);
  expect(work).toContain('generatorai-dummy-repo-');
  head = git('rev-parse', 'HEAD');
}, 60_000);

afterAll(() => {
  rmSync(dummyRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'generatorai-g02-test-'));
  db = createDB(join(dir, 'chats.db'));
  migrateDB(db);
  bus = new EventBus();
  streaming = new StreamingChatRegistry();
  interactions = new AgentInteractionService(new DrizzleAgentInteractionRepository(db), undefined, undefined, {
    sweepIntervalMs: 0,
  });
  chatRepo = new DrizzleChatRepository(db);
  updated = [];
  bus.subscribeAll((event: PersistedEvent) => {
    if (event.kind === 'chat.updated') updated.push((event.data as { chatId: string }).chatId);
  });

  attention = new AttentionService({
    eventBus: bus,
    chats: chatRepo,
    projects: new DrizzleProjectRepository(db),
    interactions,
    streaming: {
      getStreamingSince: () => streaming.since(),
      onStreamingChange: (listener) => streaming.onChange(listener),
    },
    runs: new DrizzleWorkflowRunRepository(db),
    stageRuns: new DrizzleStageRunRepository(db),
    definitions: new SqliteWorkflowDefinitionStore(db),
    automations: new DrizzleAutomationRepository(db),
    executions: new DrizzleAutomationExecutionRepository(db),
    seqBase: 1,
  });

  // The real change engine, over the dummy repo mounted as `app` — the same
  // call the composition root makes, minus the workspace manager lookup.
  const gitManager = new GitManager(new SandboxedScriptRunner(logger), logger, { workspacesDir: dir });
  const summaries = new ChangeSummaryService(
    gitManager,
    { getBaseline: async () => null, getById: async () => null, getLatest: async () => null },
    logger,
  );
  changeStats = new ChatChangeStatsService({
    eventBus: bus,
    chats: chatRepo,
    debounceMs: 20,
    computeStats: async (workspaceId) => {
      if (workspaceId !== 'ws-dummy') return null;
      const summary = await summaries.getSummary({
        workspaceId,
        freshWorkingTree: true,
        rootPath: dir,
        mounts: [{ alias: 'app', path: work, baseCommit: head }],
        autoInit: false,
      });
      return netChangeStats(summary.repos);
    },
    logger,
  });
  changeStats.start();
  invalidator = new ChatListInvalidator({ eventBus: bus, chats: chatRepo, attention, logger });
  invalidator.start();

  const chatListService = new ChatListService({
    chats: chatRepo,
    attention,
    messages: new DrizzleChatMessageRepository(db),
    changeStats,
    logger,
  });
  app = express();
  app.use(express.json());
  app.use(
    '/api/chats',
    createChatApiRoutes({
      chatListService,
      chatEntityRepo: chatRepo,
      chatManagementService: {},
      workspaceManager: { getExecutionWorkspace: async () => null },
      eventBus: bus,
      logger,
    } as never),
  );
  const projectRepo = new DrizzleProjectRepository(db);
  app.use(
    '/api/projects',
    createProjectRoutes({
      // The repository delete is the part that unlinks the chats; the service
      // around it only adds filesystem cleanup.
      projectService: { deleteProject: (id: string) => projectRepo.delete(id) },
      security: { secretStore: {} },
      chatListInvalidator: invalidator,
      logger,
    } as never),
  );
  app.use(createErrorMiddleware(logger));
});

afterEach(async () => {
  invalidator.stop();
  attention.stop();
  // A recompute still running would share the dummy repo with the next test.
  await changeStats.settled();
  changeStats.stop();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the handle a moment longer */
  }
});

async function makeChat(id: string, over: Partial<Chat> = {}, activityOffsetMs = 0): Promise<void> {
  await db.insert(sessions).values({ id: `sess-${id}`, name: id, status: 'active', createdAt: T0, updatedAt: T0 });
  await chatRepo.create({
    id,
    name: `Chat ${id}`,
    sessionId: `sess-${id}`,
    tags: [],
    status: 'active',
    createdAt: T0,
    updatedAt: T0,
    ...over,
  } as Chat);
  await chatRepo.touchActivity(id, new Date(T0.getTime() + activityOffsetMs));
}

async function list(query = ''): Promise<ChatListPage> {
  const res = await request(app).get(`/api/chats${query ? `?${query}` : ''}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as ChatListPage;
}

const ids = (page: ChatListPage) => page.items.map((c) => c.id);

async function seed(): Promise<void> {
  await new DrizzleProjectRepository(db).create({
    id: 'p1',
    name: 'Website',
    settings: {},
    rootPath: join(dir, 'p1'),
    status: 'active',
    createdAt: T0,
    updatedAt: T0,
  });
  await makeChat('c-dummy', { name: 'Refactor app', projectId: 'p1', workspaceId: 'ws-dummy', tags: ['refactor'] }, 9_000);
  await makeChat('c-ask', { name: 'Push release', projectId: 'p1' }, 8_000);
  await makeChat('c-run', { name: 'Build docs' }, 7_000);
  await makeChat('c-done', { name: 'Write tests', projectId: 'p1' }, 6_000);
  await makeChat('c-failed', { name: 'Deploy preview' }, 5_000);
  await makeChat('c-back', { name: 'Back again' }, 4_000);
  await makeChat('c-archived', { name: 'Old deploy', status: 'archived', projectId: 'p1' }, 3_000);
  await makeChat('c-worker', { name: 'Worker', parentChatId: 'c-run', projectId: 'p1' }, 10_000);

  await chatRepo.recordTurnEnd('c-done', { status: 'succeeded', endedAt: new Date(T0.getTime() + 6_000) });
  await chatRepo.recordTurnEnd('c-failed', { status: 'failed', endedAt: new Date(T0.getTime() + 5_000), error: 'Rate limited' });
  // Done before, running again now: it is Running, not Done.
  await chatRepo.recordTurnEnd('c-back', { status: 'succeeded', endedAt: new Date(T0.getTime() + 4_000) });

  void interactions.open({ kind: 'chat', chatId: 'c-ask', sessionId: 'sess-c-ask', turnId: 't1' }, 'tool_permission', {
    toolName: 'Bash',
    inputSummary: 'git push',
  });
  await vi.waitFor(async () => expect(await interactions.listPendingAll()).toHaveLength(1));
  streaming.set('c-run', () => {});
  streaming.set('c-back', () => {});
  await attention.start();
}

describe('GET /api/chats — chat list v2', () => {
  it('answers a page with totals and segment counts; workers are left out', async () => {
    await seed();
    const page = await list();
    expect(ids(page)).toEqual(['c-dummy', 'c-ask', 'c-run', 'c-done', 'c-failed', 'c-back', 'c-archived']);
    expect(page).toMatchObject({ nextCursor: null, total: 7, counts: { all: 7, active: 6, archived: 1 } });

    const failed = page.items.find((c) => c.id === 'c-failed')!;
    expect(failed.summary).toMatchObject({
      lastActivityAt: new Date(T0.getTime() + 5_000).toISOString(),
      lastTurn: { status: 'failed', error: 'Rate limited' },
    });
    expect((failed as unknown as Record<string, unknown>)['conversationSeed']).toBeUndefined();

    expect(ids(await list('workers=true'))).toContain('c-worker');
  });

  it('pages through the route with nextCursor, under every sort', async () => {
    await seed();
    for (const sort of ['activity', 'name', 'created']) {
      const all = ids(await list(`sort=${sort}`));
      const walked: string[] = [];
      let cursor: string | null = null;
      do {
        const page: ChatListPage = await list(`sort=${sort}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(page.items.length).toBeLessThanOrEqual(2);
        expect(page.total).toBe(7);
        walked.push(...ids(page));
        cursor = page.nextCursor;
      } while (cursor);
      expect(walked, sort).toEqual(all);
    }
    expect(ids(await list('sort=name'))[0]).toBe('c-back');

    const first = await list('sort=name&limit=2');
    const wrongSort = await request(app).get(`/api/chats?sort=activity&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(wrongSort.status).toBe(400);
    expect(wrongSort.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('filters by state: live from the attention feed, done/failed from the last turn', async () => {
    await seed();
    expect(ids(await list('state=needs_you'))).toEqual(['c-ask']);
    expect(ids(await list('state=running'))).toEqual(['c-run', 'c-back']);
    expect(ids(await list('state=done'))).toEqual(['c-done']);
    expect(ids(await list('state=failed&state=needs_you'))).toEqual(['c-ask', 'c-failed']);

    // The turn ends: c-back is Done again.
    streaming.delete('c-back');
    await attention.settled();
    expect(ids(await list('state=done'))).toEqual(['c-done', 'c-back']);
  });

  it('filters by project (G-14), search and status, with counts that ignore the status', async () => {
    await seed();
    const project = await list('projectId=p1');
    expect(ids(project)).toEqual(['c-dummy', 'c-ask', 'c-done', 'c-archived']);
    expect(project.counts).toEqual({ all: 4, active: 3, archived: 1 });

    const active = await list('projectId=p1&status=active');
    expect(ids(active)).toEqual(['c-dummy', 'c-ask', 'c-done']);
    expect(active.total).toBe(3);
    expect(active.counts).toEqual({ all: 4, active: 3, archived: 1 });

    expect(ids(await list('q=deploy'))).toEqual(['c-failed', 'c-archived']);
    expect(ids(await list('q=REFACTOR'))).toEqual(['c-dummy']); // name and tag
    expect(ids(await list('tag=refactor&tag=missing'))).toEqual(['c-dummy']);
  });

  it('fills in "Changes ±" from the dummy repo and keeps it current', async () => {
    await seed();
    const row = (page: ChatListPage): ChatListItem => page.items.find((c) => c.id === 'c-dummy')!;

    // Never computed: unknown on the first page, filled in behind it.
    expect(row(await list()).summary.changes).toBeUndefined();
    await changeStats.settled();
    const before = row(await list()).summary.changes!;
    // The dummy working tree: src/app.ts modified, src/added.ts added,
    // src/legacy.ts deleted, src/old-name.ts renamed, notes/untracked.md new.
    expect(before.files).toBeGreaterThanOrEqual(4);
    expect(before.additions).toBeGreaterThan(0);
    expect(before.deletions).toBeGreaterThan(0);
    expect(updated).toEqual(['c-dummy']);
    // Only the chat on that workspace was touched.
    expect(row(await list()).summary.changes).toEqual(before);

    // The agent edits a file: the next `workspace.changed` recomputes.
    appendFileSync(join(work, 'README.md'), 'one\ntwo\nthree\n');
    writeFileSync(join(work, 'CHANGELOG.md'), 'added\n');
    await bus.emit('sess-c-dummy', {
      kind: 'workspace.changed',
      data: { workspaceId: 'ws-dummy', repoAlias: 'app', changedPaths: [], stats: { files: 0, additions: 0, deletions: 0 } },
    } as never);
    await changeStats.settled();
    const after = row(await list()).summary.changes!;
    // README.md (committed clean) is now modified, CHANGELOG.md is new.
    expect(after.files).toBe(before.files + 2);
    expect(after.additions).toBe(before.additions + 4);
    expect(after.deletions).toBe(before.deletions);
    expect(updated).toEqual(['c-dummy', 'c-dummy']);

    // Nothing moved: no announcement.
    await bus.emit('sess-c-dummy', { kind: 'workspace.changed', data: { workspaceId: 'ws-dummy' } } as never);
    await changeStats.settled();
    expect(updated).toEqual(['c-dummy', 'c-dummy']);
  });
});

describe('PATCH /api/chats/:id — live lists (P2-R2)', () => {
  it('emits chat.updated for every list-visible field, and the attention title follows a rename', async () => {
    await seed();
    await attention.settled();
    const patch = (id: string, body: Record<string, unknown>) =>
      request(app).patch(`/api/chats/${id}`).send(body).expect((r) => expect(r.status, JSON.stringify(r.body)).toBe(200));

    await patch('c-run', { name: 'Build the docs site' });
    await patch('c-archived', { status: 'active' }); // unarchive
    await patch('c-done', { tags: ['qa'] });
    await patch('c-done', { description: 'Covers the parser' });
    await patch('c-archived', { projectId: null }); // moved out of its project
    await patch('c-done', { model: 'gpt-5.6-terra' }); // the row shows the model (P2-R33)
    expect(updated).toEqual(['c-run', 'c-archived', 'c-done', 'c-done', 'c-archived', 'c-done']);

    // Not shown by any list: no event.
    await patch('c-done', { harnessConfig: { streaming: true } });
    expect(updated).toHaveLength(6);

    // The list and the attention feed both show the new name.
    expect((await list('q=docs site')).items.map((c) => c.id)).toEqual(['c-run']);
    await attention.settled();
    const running = attention.getSnapshot().running.find((i) => i.entityId === 'c-run');
    expect(running?.title).toBe('Build the docs site');
  });
});

describe('MG-02 — pinned and unread chats', () => {
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/chats/${id}`).send(body).expect((r) => expect(r.status, JSON.stringify(r.body)).toBe(200));

  it('pins to the top under every sort, filters by pin, and pages across the pin boundary', async () => {
    await seed();
    await patch('c-failed', { pinned: true });
    await patch('c-back', { pinned: true });
    expect(updated).toEqual(['c-failed', 'c-back']);

    for (const sort of ['activity', 'name', 'created']) {
      const all = ids(await list(`sort=${sort}`));
      expect(all.slice(0, 2).sort(), sort).toEqual(['c-back', 'c-failed']);
      // Keyset paging crosses from the pinned group into the rest once, in order.
      const walked: string[] = [];
      let cursor: string | null = null;
      do {
        const page: ChatListPage = await list(`sort=${sort}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        walked.push(...ids(page));
        cursor = page.nextCursor;
      } while (cursor);
      expect(walked, sort).toEqual(all);
    }

    expect(ids(await list('pinned=only')).sort()).toEqual(['c-back', 'c-failed']);
    expect(ids(await list('pinned=exclude'))).not.toContain('c-failed');
    expect((await list()).items.find((c) => c.id === 'c-failed')!.pinnedAt).toBeTruthy();

    await patch('c-failed', { pinned: false });
    expect(ids(await list('pinned=only'))).toEqual(['c-back']);
    const bad = await request(app).get('/api/chats?pinned=yes');
    expect(bad.status).toBe(400);
  });

  it('marks unread and read (MD-112: a chat never opened is not unread)', async () => {
    await seed();
    const unreadOf = async (id: string) => (await list()).items.find((c) => c.id === id)!.summary.unread;
    expect((await list()).items.some((c) => c.summary.unread)).toBe(false);

    await patch('c-done', { unread: true });
    expect(await unreadOf('c-done')).toBe(true);
    await patch('c-done', { unread: false }); // opening the chat marks it read
    expect(await unreadOf('c-done')).toBeUndefined();
  });
});

describe('indirect list-visible writes (P2-R33)', () => {
  it('a project delete announces every chat it unlinked, and the attention feed drops the project', async () => {
    await seed();
    await attention.settled();
    expect(attention.getSnapshot().needsYou.find((i) => i.entityId === 'c-ask')?.project).toEqual({ id: 'p1', name: 'Website' });
    updated.length = 0;

    const res = await request(app).delete('/api/projects/p1?force=true');
    expect(res.status, JSON.stringify(res.body)).toBe(204);

    expect([...updated].sort()).toEqual(['c-archived', 'c-ask', 'c-done', 'c-dummy', 'c-worker']);
    await attention.settled();
    const ask = attention.getSnapshot().needsYou.find((i) => i.entityId === 'c-ask');
    expect(ask).toBeDefined();
    expect(ask?.project).toBeUndefined();
    expect(ids(await list('projectId=p1'))).toEqual([]);
  });

  it('an agent rename or delete announces every chat bound to that agent', async () => {
    await makeChat('c-a1', { agentRef: 'global:reviewer' });
    await makeChat('c-a2', { agentRef: 'global:reviewer', status: 'archived' });
    await makeChat('c-other', { agentRef: 'global:writer' });
    await makeChat('c-none');
    updated.length = 0;

    // The shape AgentService emits through the composition root.
    await bus.emitGlobal({ kind: 'agent.updated', data: { agentId: 'a1', ref: 'global:reviewer', name: 'Reviewer 2', version: 2 } });
    await invalidator.settled();
    expect([...updated].sort()).toEqual(['c-a1', 'c-a2']);

    updated.length = 0;
    await bus.emitGlobal({ kind: 'agent.deleted', data: { agentId: 'a2', ref: 'global:writer', soft: true } });
    await invalidator.settled();
    expect(updated).toEqual(['c-other']);

    // An agent no chat is bound to announces nothing.
    updated.length = 0;
    await bus.emitGlobal({ kind: 'agent.updated', data: { agentId: 'a3', ref: 'global:idle', name: 'Idle', version: 3 } });
    await invalidator.settled();
    expect(updated).toEqual([]);
  });
});
