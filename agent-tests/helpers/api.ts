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
    headers: { 'Content-Type': 'application/json' },
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

/**
 * Create a workflow definition with stages + edges. The server creates the
 * definition first, then stages (each returns a real UUID), then edges that
 * reference those UUIDs — so we resolve the caller's friendly `localId`s to
 * the server-assigned stage ids. Returns the created definition id.
 */
export async function seedWorkflowDefinition(
  tracker: ResourceTracker,
  opts: {
    name: string;
    description?: string;
    stages: SeedStage[];
    edges?: SeedEdge[];
    sessionMode?: 'auto' | 'single' | 'per-stage';
    tags?: string[];
  },
): Promise<string> {
  const defRes = await apiRequest<{ id: string }>('POST', '/workflow-definitions', {
    name: opts.name,
    description: opts.description ?? `E2E seed: ${opts.name}`,
    sessionMode: opts.sessionMode ?? 'auto',
    tags: opts.tags ?? ['e2e-seed'],
  });
  if (!defRes.ok || !defRes.data?.id) {
    throw new Error(`create definition failed (${defRes.status}): ${JSON.stringify(defRes.data)}`);
  }
  const defId = defRes.data.id;
  tracker.track('definition', defId);

  // Create stages, mapping localId -> server stage id.
  const idByLocal: Record<string, string> = {};
  for (let i = 0; i < opts.stages.length; i++) {
    const s = opts.stages[i]!;
    const body: Record<string, unknown> = {
      name: s.name,
      order: i,
      prompts: [{ label: 'P', text: s.prompt, waitForCompletion: true }],
    };
    if (s.runCondition && s.runCondition !== 'always') {
      body.condition = { type: s.runCondition };
    }
    if (s.resultValidation && s.resultValidation.length > 0) {
      body.resultValidation = s.resultValidation;
    }
    if (s.noRetry) {
      // backoffMs has a schema floor of 100; maxRetries:0 disables retries anyway.
      body.retryPolicy = { maxRetries: 0, backoffMs: 100, multiplier: 1 };
    }
    const stageRes = await apiRequest<{ id: string }>('POST', `/workflow-definitions/${defId}/stages`, body);
    if (!stageRes.ok || !stageRes.data?.id) {
      throw new Error(`create stage "${s.name}" failed (${stageRes.status}): ${JSON.stringify(stageRes.data)}`);
    }
    idByLocal[s.localId] = stageRes.data.id;
  }

  // Create edges using resolved stage ids.
  for (const e of opts.edges ?? []) {
    const fromStageId = idByLocal[e.from];
    const toStageId = idByLocal[e.to];
    if (!fromStageId || !toStageId) {
      throw new Error(`edge references unknown stage localId: ${e.from}->${e.to}`);
    }
    const edgeRes = await apiRequest('POST', `/workflow-definitions/${defId}/edges`, {
      fromStageId,
      toStageId,
      edgeType: e.type ?? 'on_success',
    });
    if (!edgeRes.ok) {
      throw new Error(`create edge ${e.from}->${e.to} failed (${edgeRes.status}): ${JSON.stringify(edgeRes.data)}`);
    }
  }
  return defId;
}

export async function seedChat(
  tracker: ResourceTracker,
  opts: { name: string; model?: string; tags?: string[] },
): Promise<string> {
  const res = await apiRequest<{ id: string }>('POST', '/chats', {
    name: opts.name,
    model: opts.model,
    tags: opts.tags ?? ['e2e-seed'],
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

/** Create a workflow run (status 'created', not started). */
export async function createRun(
  tracker: ResourceTracker,
  definitionId: string,
  variables: Record<string, unknown> = {},
): Promise<string> {
  const res = await apiRequest<{ id: string }>('POST', '/workflow-runs', {
    workflowDefinitionId: definitionId,
    variables,
  });
  if (!res.ok || !res.data?.id) {
    throw new Error(`createRun failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  tracker.track('run', res.data.id);
  return res.data.id;
}

/** Start a previously-created run. */
export async function startRun(runId: string): Promise<void> {
  const res = await apiRequest('POST', `/workflow-runs/${runId}/start`);
  if (!res.ok) throw new Error(`startRun failed (${res.status}): ${JSON.stringify(res.data)}`);
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
