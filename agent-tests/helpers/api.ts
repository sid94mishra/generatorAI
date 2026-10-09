// ────────────────────────────────────────────────────────────────
// Shared API client for E2E setup/teardown.
// Tests seed deterministic data via REST (port 3100) instead of
// clicking through creation flows — fast and reliable. All created
// resource ids are tracked so the fixture can clean them up.
// See TEST_PLAN.md §2 (deterministic strategy).
// ────────────────────────────────────────────────────────────────

export const API_BASE = process.env.API_URL || 'http://localhost:3100/api';
export const WEB_BASE = process.env.TARGET_URL || 'http://localhost:5173';

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    // API_KEY: an admin bearer for a sandbox that requires auth (`sandbox.mjs --lan`).
    headers: { 'Content-Type': 'application/json', ...(process.env.API_KEY ? { Authorization: `Bearer ${process.env.API_KEY}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

/**
 * Track ids created during a test so they can be torn down. Keyed by
 * resource kind → delete endpoint builder.
 */
export class ResourceTracker {
  private readonly created: Array<{ kind: string; id: string }> = [];

  track(kind: string, id: string): void {
    if (id) this.created.push({ kind, id });
  }

  async cleanup(): Promise<void> {
    // Delete in reverse creation order (runs before definitions, etc.).
    for (const { kind, id } of this.created.reverse()) {
      const path = DELETE_PATHS[kind]?.(id);
      if (!path) continue;
      try {
        await apiRequest('DELETE', path);
      } catch {
        /* best-effort teardown — never fail a test on cleanup */
      }
    }
    this.created.length = 0;
  }
}

const DELETE_PATHS: Record<string, (id: string) => string> = {
  definition: (id) => `/workflow-definitions/${id}`,
  run: (id) => `/workflow-runs/${id}`,
  chat: (id) => `/chats/${id}`,
  project: (id) => `/projects/${id}`,
  automation: (id) => `/automations/${id}`,
  agent: (id) => `/agents/${id}`,
};

// ── High-level seeders ──────────────────────────────────────────

export interface SeedValidationRule {
  type: 'contains' | 'not_contains' | 'min_length' | 'max_length' | 'regex';
  value?: string | number;
  message: string;
}

export interface SeedStage {
  localId: string;
  name: string;
  prompt: string;
  runCondition?: 'always' | 'on_success' | 'on_failure';
  /** Per-stage result validation rules (e.g. a contains rule that can never match → forces failure). */
  resultValidation?: SeedValidationRule[];
  /** Disable retries so a validation failure fails the stage immediately. */
  noRetry?: boolean;
}

export interface SeedEdge {
  from: string;
  to: string;
  type?: 'on_success' | 'on_failure' | 'on_completion' | 'always';
}

const EDGE_ON = { on_success: 'success', on_failure: 'failure', on_completion: 'completion', always: 'always' } as const;

/** A stage key from a caller's `localId` (keys are lower snake case). */
function stageKey(localId: string): string {
  const k = localId.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '');
  return k || 'stage';
}

/**
 * Create a workflow definition from a v2 graph (formatVersion 2) and
 * publish it, so it can run. Stage keys come from the caller's `localId`s;
 * a `runCondition` other than `always` becomes the `on` of the stage's
 * incoming edges. Returns the created definition id.
 */
export async function seedWorkflowDefinition(
  tracker: ResourceTracker,
  opts: {
    name: string;
    description?: string;
    stages: SeedStage[];
    edges?: SeedEdge[];
    tags?: string[];
  },
): Promise<string> {
  const stages = opts.stages.map((s) => ({
    key: stageKey(s.localId),
    name: s.name,
    kind: 'agent',
    prompts: [{ label: 'P', text: s.prompt }],
    ...(s.resultValidation && s.resultValidation.length > 0 ? { output: { rules: s.resultValidation } } : {}),
    // One attempt: a validation failure fails the stage immediately.
    ...(s.noRetry ? { retry: { maxAttempts: 1 }, onExhausted: 'fail' } : {}),
  }));
  const conditionOf = new Map(opts.stages.map((s) => [stageKey(s.localId), s.runCondition]));
  const edges = (opts.edges ?? []).map((e) => {
    const to = stageKey(e.to);
    const cond = conditionOf.get(to);
    const type = e.type ?? (cond && cond !== 'always' ? cond : 'on_success');
    return { from: stageKey(e.from), to, on: EDGE_ON[type] };
  });
  const graph = {
    formatVersion: 2,
    workflow: {
      name: opts.name,
      description: opts.description ?? `E2E seed: ${opts.name}`,
      tags: opts.tags ?? ['e2e-seed'],
    },
    stages,
    edges,
  };
  const defRes = await apiRequest<{ id: string }>('POST', '/workflow-definitions', graph);
  if (!defRes.ok || !defRes.data?.id) {
    throw new Error(`create definition failed (${defRes.status}): ${JSON.stringify(defRes.data)}`);
  }
  const defId = defRes.data.id;
  tracker.track('definition', defId);
  const pubRes = await apiRequest('POST', `/workflow-definitions/${defId}/publish`);
  if (!pubRes.ok) throw new Error(`publish definition failed (${pubRes.status}): ${JSON.stringify(pubRes.data)}`);
  return defId;
}

export async function seedChat(
  tracker: ResourceTracker,
  opts: {
    name: string;
    model?: string;
    tags?: string[];
    /**
     * P2-00 — the sandbox's needs-you fixture chat needs a mode other than
     * the default 'bypassPermissions', or `decideToolPermission` auto-grants
     * every `permission_request` script entry instead of opening a pending
     * gate (see `packages/core/src/services/agentModePolicy.ts`).
     */
    permissionMode?: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan';
  },
): Promise<string> {
  const res = await apiRequest<{ id: string }>('POST', '/chats', {
    name: opts.name,
    model: opts.model,
    tags: opts.tags ?? ['e2e-seed'],
    ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
  });
  if (!res.ok || !res.data?.id) {
    throw new Error(`seedChat failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  tracker.track('chat', res.data.id);
  return res.data.id;
}

export async function seedProject(
  tracker: ResourceTracker,
  opts: { name: string; description?: string },
): Promise<string> {
  const res = await apiRequest<{ id: string }>('POST', '/projects', {
    name: opts.name,
    description: opts.description ?? 'E2E seed project',
  });
  if (!res.ok || !res.data?.id) {
    throw new Error(`seedProject failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  tracker.track('project', res.data.id);
  return res.data.id;
}

export async function seedAutomation(
  tracker: ResourceTracker,
  opts: {
    name: string;
    workflowIds: string[];
    triggerType?: 'manual' | 'schedule' | 'webhook';
    inputMode?: 'single' | 'loop' | 'batch' | 'script';
    cronExpression?: string;
  },
): Promise<string> {
  const res = await apiRequest<{ id: string }>('POST', '/automations', {
    name: opts.name,
    triggerType: opts.triggerType ?? 'manual',
    workflowIds: opts.workflowIds,
    inputMode: opts.inputMode ?? 'single',
    cronExpression: opts.cronExpression,
    variables: {},
    // Unattended runs must declare a permission mode (Workflow Overhaul PD-18).
    permissionMode: 'acceptEdits',
  });
  if (!res.ok || !res.data?.id) {
    throw new Error(`seedAutomation failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  tracker.track('automation', res.data.id);
  return res.data.id;
}

/** Find an automation by exact name (for cleanup of UI-created automations). */
export async function findAutomationIdByName(name: string): Promise<string | undefined> {
  const res = await apiRequest<Array<{ id: string; name: string }>>('GET', '/automations');
  if (!res.ok || !Array.isArray(res.data)) return undefined;
  return res.data.find((a) => a.name === name)?.id;
}

/**
 * P2-00 — generic "find by exact name in a list endpoint's array response"
 * helper, used by the sandbox seed (`agent-tests/vrt/seed.ts`) to make
 * seeding idempotent: look up a fixed-name entity before creating it, so
 * re-running the seed against an already-seeded DB does not create
 * duplicates.
 */
export async function findIdByName(path: string, name: string): Promise<string | undefined> {
  const res = await apiRequest<Array<{ id: string; name: string }>>('GET', path);
  if (!res.ok || !Array.isArray(res.data)) return undefined;
  return res.data.find((item) => item.name === name)?.id;
}

/**
 * `GET /api/chats` answers a page (`{ items, nextCursor, total, counts }`),
 * not a bare array like the other list endpoints `findIdByName` handles —
 * so this looks up chats with its own request instead of going through it.
 * `workers: true` so a worker chat created by a test is still findable.
 *
 * P2-R22(c) — a plain unfiltered `limit=200` only ever sees the newest 200
 * chats, so seeding (or any other name lookup) against a DB with more than
 * that stopped being idempotent: an older fixed-name chat would look
 * "missing" and get recreated. `q=<name>` uses the server's own substring
 * filter (case-insensitive, over name/description/tag) to narrow the
 * candidates, then this still exact-matches `.name` itself (the endpoint has
 * no exact-match filter), and pages via `cursor` on the rare chance more than
 * one page of `q` matches exists before the exact one is found.
 *
 * P2-R35 — `q=` compares with SQLite `lower()`, which folds only ASCII, so a
 * name like "Über plan" is not in its answer at all. When `q=` finds no
 * exact match, every chat is paged through and matched here.
 */
export async function findChatIdByName(name: string): Promise<string | undefined> {
  const byQuery = await scanChatsForName(name, { q: name });
  if (byQuery !== null) return byQuery;
  return (await scanChatsForName(name, {})) ?? undefined;
}

/**
 * Pages `GET /chats` (plus `filter`) for a chat named exactly `name`.
 * Resolves its id, `null` when every page was read without a match, or
 * `undefined` when a request failed (a failure is not a "no").
 */
async function scanChatsForName(name: string, filter: Record<string, string>): Promise<string | null | undefined> {
  let cursor: string | undefined;
  // A defensive cap against a server that never ends its cursor chain
  // (10,000 chats at 200 per page).
  for (let pagesRead = 0; pagesRead < 50; pagesRead++) {
    const params = new URLSearchParams({ ...filter, workers: 'true', limit: '200' });
    if (cursor) params.set('cursor', cursor);
    const res = await apiRequest<{ items: Array<{ id: string; name: string }>; nextCursor?: string | null }>(
      'GET',
      `/chats?${params.toString()}`,
    );
    if (!res.ok || !Array.isArray(res.data?.items)) return undefined;
    const match = res.data.items.find((item) => item.name === name);
    if (match) return match.id;
    if (!res.data.nextCursor) return null;
    cursor = res.data.nextCursor;
  }
  return null;
}

export async function findProjectIdByName(name: string): Promise<string | undefined> {
  return findIdByName('/projects', name);
}

/**
 * `GET /workflow-definitions` answers a page (`{ items, nextCursor }`, Workflow
 * Overhaul P01), not a bare array: narrow with `q=` and exact-match the name.
 */
export async function findWorkflowDefinitionIdByName(name: string): Promise<string | undefined> {
  const params = new URLSearchParams({ q: name, limit: '200', includeArchived: 'true' });
  const res = await apiRequest<{ items: Array<{ id: string; name: string }> }>('GET', `/workflow-definitions?${params.toString()}`);
  if (!res.ok || !Array.isArray(res.data?.items)) return undefined;
  return res.data.items.find((item) => item.name === name)?.id;
}

export async function findAgentIdByName(name: string): Promise<string | undefined> {
  return findIdByName('/agents', name);
}

/** P2-00 — seed a reusable agent (`agent-tests/vrt/seed.ts`). */
export async function seedAgent(
  tracker: ResourceTracker,
  opts: { name: string; description: string; instructions: string; tags?: string[] },
): Promise<string> {
  const res = await apiRequest<{ id: string }>('POST', '/agents', {
    scope: 'global',
    name: opts.name,
    description: opts.description,
    instructions: opts.instructions,
    tags: opts.tags ?? ['e2e-seed'],
  });
  if (!res.ok || !res.data?.id) {
    throw new Error(`seedAgent failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  tracker.track('agent', res.data.id);
  return res.data.id;
}

/** P2-00 — send a chat prompt (POST /chats/:id/prompt, fire-and-forget on the server; events stream via SSE). */
export async function sendChatPrompt(chatId: string, prompt: string): Promise<void> {
  const res = await apiRequest('POST', `/chats/${chatId}/prompt`, { prompt });
  if (!res.ok) throw new Error(`sendChatPrompt failed (${res.status}): ${JSON.stringify(res.data)}`);
}

/** P2-00 — archive a chat (PATCH /chats/:id { status: 'archived' }). */
export async function archiveChat(chatId: string): Promise<void> {
  const res = await apiRequest('PATCH', `/chats/${chatId}`, { status: 'archived' });
  if (!res.ok) throw new Error(`archiveChat failed (${res.status}): ${JSON.stringify(res.data)}`);
}

/** P2-00 — list a chat's pending interactions (GET /chats/:id/interactions). */
export async function listPendingInteractions(
  chatId: string,
): Promise<Array<{ interactionId: string; kind: string; status: string }>> {
  const res = await apiRequest<Array<{ interactionId: string; kind: string; status: string }>>(
    'GET',
    `/chats/${chatId}/interactions?status=pending`,
  );
  return res.ok && Array.isArray(res.data) ? res.data : [];
}

/** P2-00 — poll until a chat has at least one pending interaction (or time out). */
export async function waitForPendingInteraction(
  chatId: string,
  timeoutMs = 10_000,
): Promise<Array<{ interactionId: string; kind: string; status: string }>> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const pending = await listPendingInteractions(chatId);
    if (pending.length > 0) return pending;
    if (Date.now() - start > timeoutMs) return [];
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Start a run of a published definition through the invocation (created and started in one request). */
export async function startRun(
  tracker: ResourceTracker,
  definitionId: string,
  variables: Record<string, unknown> = {},
): Promise<string> {
  const res = await apiRequest<{ runId: string }>('POST', '/workflow-invocations', {
    target: { kind: 'definition', workflowDefinitionId: definitionId },
    variables,
    client: 'http',
  });
  if (!res.ok || !res.data?.runId) {
    throw new Error(`startRun failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  tracker.track('run', res.data.runId);
  return res.data.runId;
}

/** Fetch a run's stage runs (name → status map). */
export async function getStageStatuses(runId: string): Promise<Record<string, string>> {
  const res = await apiRequest<Array<{ name: string; status: string }>>('GET', `/workflow-runs/${runId}/stages`);
  const map: Record<string, string> = {};
  if (Array.isArray(res.data)) for (const s of res.data) map[s.name] = s.status;
  return map;
}

/** Poll a workflow run until it reaches a terminal status (or times out). */
export async function waitForRunStatus(
  runId: string,
  terminal: string[] = ['completed', 'failed', 'cancelled'],
  timeoutMs = 60_000,
): Promise<string> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await apiRequest<{ status: string }>('GET', `/workflow-runs/${runId}`);
    const status = res.data?.status;
    if (status && terminal.includes(status)) return status;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`run ${runId} did not reach ${terminal.join('|')} within ${timeoutMs}ms (last=${status})`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
