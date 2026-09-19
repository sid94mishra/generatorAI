// ────────────────────────────────────────────────────────────────
// Wire-contract regression tests.
//
// Every bug these cover was the same shape: the CLI sent a plausible field
// name that no server schema reads, the request was accepted, the field was
// stripped by `validate()`, and the command reported success while doing
// nothing. Types did not catch them because the call sites used `as never`.
//
// These assert the exact JSON that leaves the process, against the field
// names in `packages/shared/src/config/*Schemas.ts`.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client.js';
import { createAdminApi } from '../admin.js';

interface Captured {
  path: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function capture(): { calls: Captured[]; fetchImpl: typeof fetch } {
  const calls: Captured[] = [];
  const fetchImpl = (async (path: string, init?: RequestInit) => {
    calls.push({
      path,
      method: init?.method ?? 'GET',
      // A `FormData` body (multipart) is not JSON — keep it as-is so a test
      // can inspect its fields directly instead of failing on `JSON.parse`.
      body: init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('chat wire contract', () => {
  it('sends the prompt as `prompt`, which is what SendChatPromptSchema reads', async () => {
    const { calls, fetchImpl } = capture();
    await createApiClient(fetchImpl).chats.send('c1', { message: 'hello world' });

    expect(calls[0]?.path).toBe('/api/chats/c1/prompt');
    expect(calls[0]?.body).toEqual({ prompt: 'hello world' });
  });

  it('names the permission mode `mode`, not `permissionMode`', async () => {
    const { calls, fetchImpl } = capture();
    await createApiClient(fetchImpl).chats.setPermissionMode('c1', 'acceptEdits');

    // SetChatPermissionModeSchema is `{ mode }`; `permissionMode` is stripped
    // and the required field then reads as missing.
    expect(calls[0]?.body).toEqual({ mode: 'acceptEdits' });
  });
});

describe('chat update wire contract', () => {
  it('sends agentRef, matching the field the PATCH /chats/:id route reads to bind an agent', async () => {
    const { calls, fetchImpl } = capture();
    await createApiClient(fetchImpl).chats.update('c1', { agentRef: 'core:reviewer' });

    expect(calls[0]?.path).toBe('/api/chats/c1');
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toEqual({ agentRef: 'core:reviewer' });
  });
});

describe('chat attachment wire contract', () => {
  it('sends multipart with fields `prompt`/`mode` and files under `attachments`, matching multer.array("attachments")', async () => {
    const { calls, fetchImpl } = capture();
    await createApiClient(fetchImpl).chats.sendWithAttachments(
      'c1',
      { message: 'see attached' },
      [{ name: 'note.txt', data: new TextEncoder().encode('hello') }],
    );

    expect(calls[0]?.path).toBe('/api/chats/c1/prompt');
    expect(calls[0]?.method).toBe('POST');
    const form = calls[0]?.body as unknown as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('prompt')).toBe('see attached');
    const file = form.get('attachments') as File;
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe('note.txt');
  });
});

describe('automation wire contract (create/update)', () => {
  it('sends workflowIds/cronExpression/batchDataFormat/onError, not the CLI-flag-shaped names', async () => {
    const { calls, fetchImpl } = capture();
    await createAdminApi(fetchImpl).automations.create({
      name: 'nightly',
      workflowIds: ['00000000-0000-0000-0000-000000000001'],
      triggerType: 'schedule',
      inputMode: 'batch',
      variables: {},
      cronExpression: '0 2 * * *',
      batchDataFormat: 'csv',
      onError: 'stop',
    });

    expect(calls[0]?.path).toBe('/api/automations');
    // `CreateAutomationSchema` rejects/strips `workflowDefinitionIds`,
    // `schedule`, `batchFormat`, `errorPolicy` and `enabled` — none of those
    // legacy names may appear here again.
    expect(calls[0]?.body).toMatchObject({
      workflowIds: ['00000000-0000-0000-0000-000000000001'],
      cronExpression: '0 2 * * *',
      batchDataFormat: 'csv',
      onError: 'stop',
    });
    expect(calls[0]?.body).not.toHaveProperty('workflowDefinitionIds');
    expect(calls[0]?.body).not.toHaveProperty('schedule');
    expect(calls[0]?.body).not.toHaveProperty('errorPolicy');
    expect(calls[0]?.body).not.toHaveProperty('enabled');
  });

  it('update sends cronExpression/onError, not schedule/errorPolicy', async () => {
    const { calls, fetchImpl } = capture();
    await createAdminApi(fetchImpl).automations.update('a1', { cronExpression: '0 3 * * *', onError: 'stop' });

    expect(calls[0]?.path).toBe('/api/automations/a1');
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toEqual({ cronExpression: '0 3 * * *', onError: 'stop' });
  });
});

describe('workflow stage/edge wire contract', () => {
  it('addStage sends prompts/harnessConfigOverrides/timeoutMs/retryPolicy, not prompt/model/timeoutSeconds/maxRetries', async () => {
    const { calls, fetchImpl } = capture();
    await createAdminApi(fetchImpl).definitions.addStage('wf1', {
      name: 'build',
      prompts: [{ label: 'prompt', text: 'build it', source: 'inline', waitForCompletion: true }],
      harnessConfigOverrides: { model: 'gpt-5' },
      timeoutMs: 60_000,
      retryPolicy: { maxRetries: 2, backoffMs: 1000, backoffMultiplier: 2 },
    });

    expect(calls[0]?.path).toBe('/api/workflow-definitions/wf1/stages');
    expect(calls[0]?.body).toMatchObject({
      name: 'build',
      prompts: [{ label: 'prompt', text: 'build it', source: 'inline', waitForCompletion: true }],
      harnessConfigOverrides: { model: 'gpt-5' },
      timeoutMs: 60_000,
      retryPolicy: { maxRetries: 2, backoffMs: 1000, backoffMultiplier: 2 },
    });
    for (const legacyKey of ['prompt', 'model', 'timeoutSeconds', 'maxRetries']) {
      expect(calls[0]?.body).not.toHaveProperty(legacyKey);
    }
  });

  it('addEdge sends only fromStageId/toStageId/edgeType — there is no server-side "condition" on an edge', async () => {
    const { calls, fetchImpl } = capture();
    await createAdminApi(fetchImpl).definitions.addEdge('wf1', {
      fromStageId: 's1',
      toStageId: 's2',
      edgeType: 'on_success',
    });

    expect(calls[0]?.path).toBe('/api/workflow-definitions/wf1/edges');
    expect(calls[0]?.body).toEqual({ fromStageId: 's1', toStageId: 's2', edgeType: 'on_success' });
  });
});

describe('agent resolve-preview wire contract', () => {
  it('sends scope, agentRef, projectId, harnessType with the real field names', async () => {
    const { calls, fetchImpl } = capture();
    await createAdminApi(fetchImpl).agents.resolvePreview({
      scope: 'chat',
      agentRef: 'core:reviewer',
      projectId: 'p1',
      harnessType: 'claude-agent',
    });

    expect(calls[0]?.path).toBe('/api/agents/resolve-preview');
    expect(calls[0]?.body).toEqual({
      scope: 'chat',
      agentRef: 'core:reviewer',
      projectId: 'p1',
      harnessType: 'claude-agent',
    });
  });
});

describe('run wire contract', () => {
  it('names the run permission mode `mode`', async () => {
    const { calls, fetchImpl } = capture();
    await createAdminApi(fetchImpl).runs.permissionMode.set('r1', 'plan');

    expect(calls[0]?.path).toBe('/api/workflow-runs/r1/permission-mode');
    expect(calls[0]?.body).toEqual({ mode: 'plan' });
  });
});

describe('automation wire contract', () => {
  it('triggers through the authenticated route, not the public webhook', async () => {
    const { calls, fetchImpl } = capture();
    await createAdminApi(fetchImpl).automations.trigger(
      'a1',
      { dataset: { topic: 'caching' } },
      { idempotencyKey: 'key-1' },
    );

    expect(calls[0]?.path).toBe('/api/automations/a1/trigger');
    expect(calls[0]?.body).toEqual({ dataset: { topic: 'caching' } });
    // Without this a retried invocation double-fires the whole fan-out.
    expect(calls[0]?.headers['idempotency-key']).toBe('key-1');
  });

  it('keeps the webhook path available but separate', async () => {
    const { calls, fetchImpl } = capture();
    await createAdminApi(fetchImpl).automations.triggerByToken('tok', { a: 1 });
    expect(calls[0]?.path).toBe('/api/automations/webhooks/tok');
  });
});

describe('hook wire contract', () => {
  it('sends a full HookDefinition body — enabled, numeric timeout/retries, config.type set', async () => {
    const { calls, fetchImpl } = capture();
    await createAdminApi(fetchImpl).hooks.test('sess_1', 'pre_run', {
      type: 'script',
      config: { type: 'script', command: 'echo', args: ['hi'] },
    });

    expect(calls[0]?.path).toBe('/api/hooks/sessions/sess_1/hooks/test');
    // `hooks.ts` 400s without `type`, and the executor silently runs the
    // hook zero times without a real `retries`/`timeoutMs`/`enabled: true` —
    // both regressions previously shipped as a reported "success".
    expect(calls[0]?.body).toMatchObject({
      phase: 'pre_run',
      type: 'script',
      enabled: true,
      retries: 0,
      timeoutMs: 10_000,
      config: { type: 'script', command: 'echo', args: ['hi'] },
    });
  });

  it('types the grouped { workflowHooks, globalHooks } envelope instead of a bare array', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ sessionId: 's1', workflowHooks: [], globalHooks: [{ id: 'g1' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const result = await createAdminApi(fetchImpl).hooks.sessionHooks('s1');
    // Previously typed `Array<Record<string, unknown>>` — a caller indexing
    // `result[0]` compiled fine and read `undefined` at every index.
    expect(result.globalHooks[0]?.id).toBe('g1');
    expect(result.workflowHooks).toEqual([]);
  });
});

describe('review wire contract', () => {
  it('sends startLine/endLine and side:additions|deletions, not line/side:old|new', async () => {
    const { calls, fetchImpl } = capture();
    await createApiClient(fetchImpl).review.createThread('ws_1', {
      path: 'a.ts',
      body: 'fix this',
      anchorText: '',
      scopeId: 'chat_1',
      baseCheckpointId: '',
      headCheckpointId: '',
      side: 'additions',
      startLine: 10,
      endLine: 12,
      scope: 'chat',
    });

    expect(calls[0]?.path).toBe('/api/workspaces/ws_1/review/threads');
    // `review.ts`'s POST route 400s without `scopeId`, `startLine`, `endLine`,
    // and only recognises `side: 'additions' | 'deletions'`.
    expect(calls[0]?.body).toMatchObject({
      path: 'a.ts',
      body: 'fix this',
      scopeId: 'chat_1',
      side: 'additions',
      startLine: 10,
      endLine: 12,
    });
  });
});

describe('device wire contract', () => {
  it('unwraps the `{ devices: [] }` envelope the route returns', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ devices: [{ deviceId: 'd1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    const devices = await createAdminApi(fetchImpl).devices.list();
    expect(Array.isArray(devices)).toBe(true);
    expect(devices[0]?.deviceId).toBe('d1');
  });
});

describe('terminal wire contract', () => {
  it('unwraps the `{ terminals: [] }` envelope the route returns, and keeps the fields a caller actually needs', async () => {
    // Previously typed as a bare `TerminalRecord[]` matching neither the
    // route's real envelope NOR its real per-item shape (`pid`/`exitCode`/
    // `lastActivityAt`/`host` were all missing from the old hand-written
    // type) — nothing had ever called this to notice.
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          terminals: [
            {
              id: 't1',
              workspaceId: 'ws_1',
              pid: 4242,
              cwd: '/repo',
              cols: 80,
              rows: 24,
              host: 'node-pty',
              shell: '/bin/bash',
              exitCode: null,
              createdAt: 1000,
              lastActivityAt: 2000,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const terminals = await createAdminApi(fetchImpl).terminals.list('ws_1');
    expect(Array.isArray(terminals)).toBe(true);
    expect(terminals[0]?.id).toBe('t1');
    expect(terminals[0]?.pid).toBe(4242);
    expect(terminals[0]?.lastActivityAt).toBe(2000);
    expect(terminals[0]?.exitCode).toBeNull();
  });
});

// Phase 7 item 1 — three real gaps found while building the TUI's workspace
// tree pane: `.worktrees()` was mistyped as a DIFFERENT domain type
// (project/codebase-scoped `WorktreeInfo`, not workspace-scoped
// `WorktreeDetail` — they share two field names by coincidence, not
// contract), `.files()`'s real response isn't an array at all, and
// `.fileContent()` never exposed the real `source`/`worktreeAlias` params
// the route reads, nor the `path`/`truncated`/`size` fields it always sends
// back alongside `content`.
describe('workspace wire contract', () => {
  it('.worktrees() returns the real workspace-scoped shape, not the project-scoped one it was typed as', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify([
          {
            codebaseId: 'cb_1',
            alias: 'frontend',
            branchName: 'feature/foo',
            baseBranch: 'main',
            worktreePath: 'source/frontend',
            status: 'active',
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const worktrees = await createAdminApi(fetchImpl).workspaces.worktrees('ws_1');
    expect(worktrees[0]?.alias).toBe('frontend');
    expect(worktrees[0]?.worktreePath).toBe('source/frontend');
    expect(worktrees[0]?.branchName).toBe('feature/foo');
  });

  it('.files() returns the real grouped-by-category shape, not an array', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          workspaceId: 'ws_1',
          rootPath: '/ws/ws_1',
          codeRoot: '/ws/ws_1',
          workspaceFiles: ['a.ts'],
          artifactFiles: ['report.md'],
          sourceFiles: [],
          worktrees: [{ alias: 'frontend', worktreePath: '/ws/ws_1/source/frontend', files: ['index.ts'] }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const files = await createAdminApi(fetchImpl).workspaces.files('ws_1');
    expect(Array.isArray(files)).toBe(false);
    expect(files.artifactFiles).toEqual(['report.md']);
    expect(files.worktrees[0]?.files).toEqual(['index.ts']);
  });

  it('.fileContent() sends `source`/`worktreeAlias` and returns the full response, not just `content`', async () => {
    let capturedUrl = '';
    const fetchImpl = (async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({ path: 'report.md', content: 'hello', truncated: false, size: 5 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const result = await createAdminApi(fetchImpl).workspaces.fileContent('ws_1', 'report.md', {
      source: 'artifacts',
    });
    expect(capturedUrl).toContain('source=artifacts');
    expect(result).toEqual({ path: 'report.md', content: 'hello', truncated: false, size: 5 });
  });
});

describe('error bodies', () => {
  it('renders a structured error object as a sentence, not [object Object]', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'fromStageId: Required' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    await expect(createApiClient(fetchImpl).chats.list()).rejects.toThrow('fromStageId: Required');
  });

  it('unpacks a Zod issue array into readable field errors', async () => {
    const issues = JSON.stringify([
      { path: ['toStageId'], message: 'Required' },
      { path: ['edgeType'], message: 'Invalid enum value' },
    ]);
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { code: 'INVALID_BODY', message: issues } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    await expect(createApiClient(fetchImpl).chats.list()).rejects.toThrow(
      'toStageId: Required; edgeType: Invalid enum value',
    );
  });
});

// ── Workflow validation (Phase 7 item 6) ───────────────────────────
//
// `POST /workflow-definitions/:id/validate` answers 422 when a definition
// is invalid, with the findings in the body. Routed through plain
// `request()` that threw `ApiError("422 Unprocessable Entity")` and the
// findings were discarded — so `generatorai workflow validate` on a
// genuinely invalid workflow reported the status line and nothing else, and
// its own `if (!result.valid)` branch was unreachable.

describe('workflow validation wire contract', () => {
  const respondWith = (status: number, body: unknown): typeof fetch =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

  it('returns the body of a 422 instead of throwing, so the findings survive', async () => {
    const body = {
      valid: false,
      errors: ["Self-edge detected on stage 'A'"],
      warnings: [],
      issues: [
        {
          severity: 'error',
          code: 'self-edge',
          message: "Self-edge detected on stage 'A'",
          stageIds: ['A'],
          edge: { fromStageId: 'A', toStageId: 'A', edgeType: 'on_success' },
        },
      ],
    };

    const result = await createAdminApi(respondWith(422, body)).definitions.validate('wf-1');

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["Self-edge detected on stage 'A'"]);
    expect(result.issues?.[0]?.stageIds).toEqual(['A']);
  });

  it('still returns a 200 body unchanged', async () => {
    const result = await createAdminApi(
      respondWith(200, { valid: true, errors: [], warnings: ['DAG has no stages'], issues: [] }),
    ).definitions.validate('wf-1');

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(['DAG has no stages']);
  });

  it('still throws on a status that is NOT in the allow list', async () => {
    // The tolerance is narrow on purpose: 422 means "here is the answer",
    // 500 means the answer never got computed.
    await expect(
      createAdminApi(respondWith(500, { error: 'boom' })).definitions.validate('wf-1'),
    ).rejects.toThrow('boom');
  });
});

// ── Envelope unwrapping (Phase 8) ──────────────────────────────────
//
// Six routes in the browser/computer/widget namespaces answer an ENVELOPE
// and were typed as bare arrays or bare objects. Types cannot catch it:
// `request<T>()` casts with no runtime validation, so every one of these
// rendered as permanently empty (or as an object with one key) against a
// real server while looking correct in the source.

describe('list-envelope wire contracts', () => {
  const respondWith = (body: unknown): typeof fetch =>
    (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

  it('unwraps browser snapshots from { artifacts }', async () => {
    const api = createAdminApi(respondWith({ artifacts: [{ id: 'a1' }, { id: 'a2' }] }));
    expect(await api.browser.snapshots('ws-1')).toHaveLength(2);
  });

  it('unwraps computer grants from { grants }', async () => {
    const api = createAdminApi(respondWith({ grants: [{ appIdentity: 'Notes' }] }));
    expect(await api.computer.grants('ws-1')).toEqual([{ appIdentity: 'Notes' }]);
  });

  it('unwraps computer activity from { entries }', async () => {
    const api = createAdminApi(respondWith({ entries: [{ action: 'click' }] }));
    expect(await api.computer.activity('ws-1')).toEqual([{ action: 'click' }]);
  });

  it('unwraps computer frames from { enabled, frames }', async () => {
    const api = createAdminApi(respondWith({ enabled: true, frames: [{ id: 'f1' }] }));
    expect(await api.computer.frames('ws-1')).toEqual([{ id: 'f1' }]);
  });

  it('unwraps a single widget from { instance }', async () => {
    const api = createAdminApi(respondWith({ instance: { id: 'w1', title: 'Latency' } }));
    expect(await api.widgets.get('w1')).toEqual({ id: 'w1', title: 'Latency' });
  });

  it('unwraps a widget state write from { instance }', async () => {
    const api = createAdminApi(respondWith({ instance: { id: 'w1', state: { range: '1h' } } }));
    expect((await api.widgets.setState('w1', { range: '1h' })).state).toEqual({ range: '1h' });
  });

  it('answers an empty array, not undefined, when an envelope key is missing', async () => {
    // A server that answers `{}` must not make `.length` throw inside a render.
    const api = createAdminApi(respondWith({}));
    expect(await api.computer.grants('ws-1')).toEqual([]);
    expect(await api.browser.snapshots('ws-1')).toEqual([]);
  });

  it('scopes the widget list, which returns nothing without one', async () => {
    const { calls, fetchImpl } = capture();
    await createAdminApi(fetchImpl).widgets.list({ chatId: 'c1' });
    expect(calls[0]?.path).toBe('/api/widgets?chatId=c1');
  });
});

describe('browser semantic inspector wire contract', () => {
  it('POSTs read-page and returns the accessibility tree', async () => {
    const { calls, fetchImpl } = capture();
    await createAdminApi(fetchImpl).browser.readPage('ws-1');

    // POST, not GET: it re-issues element refs on the host, so it drives the
    // page rather than reading a cacheable resource.
    expect(calls[0]?.path).toBe('/api/workspaces/ws-1/browser/read-page');
    expect(calls[0]?.method).toBe('POST');
  });

  it('asks the actions route for a screenshot, not the region-capture route', async () => {
    // `/browser/capture` requires a clip rectangle and answers raw
    // `image/png`; `browser screenshot` used to post to it with `fullPage`
    // and would have thrown inside `res.json()` even had the schema passed.
    const { calls, fetchImpl } = capture();
    await createAdminApi(fetchImpl).browser.actions('ws-1', { kind: 'screenshot' });

    expect(calls[0]?.path).toBe('/api/workspaces/ws-1/browser/actions');
    expect(calls[0]?.body).toEqual({ kind: 'screenshot' });
  });

  it('percent-encodes each artifact path segment without escaping the separators', async () => {
    const captured: string[] = [];
    const fetchImpl = (async (path: string) => {
      captured.push(path);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as unknown as typeof fetch;

    await createAdminApi(fetchImpl).browser.file('ws-1', 'browser/shots/a b.png');
    // The route matches on `/files/(.+)` and rejects anything outside
    // `browser/`, so the slashes must survive while the space must not.
    expect(captured[0]).toBe('/api/workspaces/ws-1/browser/files/browser/shots/a%20b.png');
  });
});

describe('orchestrator run uploads wire contract', () => {
  it('posts multipart `category` + `files`, which is what the multer route reads', async () => {
    const { calls, fetchImpl } = capture();
    await createAdminApi(fetchImpl).orchestrator.uploadRunFiles('r1', 'skills', [
      { name: 'skill.md', data: new TextEncoder().encode('# hi'), mimeType: 'text/markdown' },
    ]);

    expect(calls[0]?.path).toBe('/api/orchestrator/runs/r1/uploads');
    expect(calls[0]?.method).toBe('POST');
    const form = calls[0]?.body as unknown as FormData;
    expect(form.get('category')).toBe('skills');
    const files = form.getAll('files') as File[];
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('skill.md');
  });
});
