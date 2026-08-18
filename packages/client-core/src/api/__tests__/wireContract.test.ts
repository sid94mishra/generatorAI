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
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
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
