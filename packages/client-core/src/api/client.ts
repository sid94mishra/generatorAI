// ────────────────────────────────────────────────────────────────
// Typed API client.
//
// Wraps a caller-supplied `fetch` (already authenticated and routed) so
// every client speaks to the same endpoints with the same shapes. No auth,
// no transport, no retries live here — those belong to the layers below.
// ────────────────────────────────────────────────────────────────

export interface ApiFetch {
  (path: string, init?: RequestInit): Promise<Response>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The credential is gone or was revoked — the caller must re-authenticate. */
  get isAuthFailure(): boolean {
    return this.status === 401;
  }

  /** Authenticated, but this device lacks the scope. */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/**
 * `request`, but a listed status is treated as a normal, parseable response
 * rather than an error.
 *
 * Needed for routes that answer a legitimate question with a non-2xx status
 * and a meaningful JSON body — `POST /api/workflow-definitions/:id/validate`
 * answers 422 with `{valid:false, errors, warnings, issues}`, which is the
 * ANSWER, not a failure to deliver one. Routed through plain `request` it
 * threw `ApiError("422 Unprocessable Entity")` and the findings were
 * discarded entirely, so `generatorai workflow validate` on a genuinely
 * invalid definition reported the status line and nothing else — its own
 * `if (!result.valid)` branch was unreachable.
 *
 * Deliberately narrow: only the exact statuses a caller names are tolerated,
 * so a 500 or a 401 on the same route still throws like everywhere else.
 */
export async function requestAllowing<T>(
  fetchImpl: ApiFetch,
  path: string,
  allowedStatuses: readonly number[],
  init?: RequestInit,
): Promise<T> {
  const res = await fetchImpl(path, init);
  if (!res.ok && !allowedStatuses.includes(res.status)) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      detail = describeErrorBody(await res.json()) ?? detail;
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    throw new ApiError(res.status, path, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * For routes that answer with bytes rather than JSON.
 *
 * `request` always calls `res.json()`, which is right for almost everything
 * here — but the terminal scrollback route serves `application/octet-stream`
 * (a raw VT byte ring), so `terminal scrollback` died on its own output with
 * `Unexpected token '', "[?9001h["... is not valid JSON`. The command was
 * unusable for its entire existence; nothing else reads that route.
 */
export async function requestText(
  fetchImpl: ApiFetch,
  path: string,
  init?: RequestInit,
): Promise<string> {
  const res = await fetchImpl(path, init);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      detail = describeErrorBody(await res.json()) ?? detail;
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    throw new ApiError(res.status, path, detail);
  }
  if (res.status === 204) return '';
  return res.text();
}

export async function request<T>(fetchImpl: ApiFetch, path: string, init?: RequestInit): Promise<T> {
  const res = await fetchImpl(path, init);
  if (!res.ok) {
    // Prefer the server's message: it distinguishes "missing scope" from
    // "not found", which the status code alone does not.
    let detail = `${res.status} ${res.statusText}`;
    try {
      detail = describeErrorBody(await res.json()) ?? detail;
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    throw new ApiError(res.status, path, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Renders an error body as a sentence.
 *
 * `error` is a string on some routes and `{ code, message }` on others, and a
 * failed Zod parse puts the whole issue array in `message`. Interpolating any
 * of those directly yields "[object Object]", which tells the user nothing
 * about what they typed wrong.
 */
export function describeErrorBody(body: unknown): string | null {
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return null;

  const shape = body as { error?: unknown; message?: unknown };
  const candidate = shape.error ?? shape.message;

  if (typeof candidate === 'string') return formatZodIssues(candidate) ?? candidate;
  if (candidate && typeof candidate === 'object') {
    const nested = (candidate as { message?: unknown }).message;
    if (typeof nested === 'string') return formatZodIssues(nested) ?? nested;
    if (Array.isArray(nested)) return summariseIssues(nested);
    return JSON.stringify(candidate);
  }
  return null;
}

/** Zod's `error.message` is a JSON array of issues; unpack it when it is. */
function formatZodIssues(message: string): string | null {
  if (!message.trimStart().startsWith('[')) return null;
  try {
    const issues: unknown = JSON.parse(message);
    return Array.isArray(issues) ? summariseIssues(issues) : null;
  } catch {
    return null;
  }
}

function summariseIssues(issues: unknown[]): string {
  return issues
    .map((issue) => {
      const i = issue as { path?: unknown[]; message?: string };
      const where = Array.isArray(i.path) && i.path.length ? `${i.path.join('.')}: ` : '';
      return `${where}${i.message ?? 'invalid'}`;
    })
    .join('; ');
}

export const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Same as `json` but for the verbs the server uses for partial updates. */
export const jsonWith = (method: 'PUT' | 'PATCH' | 'DELETE', body?: unknown): RequestInit => ({
  method,
  ...(body === undefined
    ? {}
    : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
});

/** Builds `?a=1&b=2`, omitting undefined values. Returns '' when empty. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ── Wire shapes ─────────────────────────────────────────────────

/**
 * A timestamp as the server actually serialises it.
 *
 * The server sends ISO-8601 STRINGS ("2026-07-31T11:30:43Z") for every
 * `createdAt` / `updatedAt` / `startedAt` on every entity — verified against
 * live `/api/chats`, `/api/workflow-runs`, `/api/projects` and
 * `/api/automations`. These were previously declared `number`, which compiled
 * fine and then failed silently at runtime in the worst possible way:
 *
 *   • `b.updatedAt - a.updatedAt` is NaN, so every sort became a no-op and
 *     lists rendered in whatever order the server happened to return;
 *   • `Date.now() - updatedAt < DAY_MS` is `false`, so the mobile "Today"
 *     filter excluded EVERYTHING and the screen read "nothing today" while
 *     137 items sat waiting.
 *
 * Declaring the union forces every consumer through `toEpochMs`.
 */
export type Timestamp = number | string;

/**
 * Normalises a wire timestamp to epoch milliseconds.
 *
 * Returns null rather than NaN for anything unparseable, so callers must
 * decide what to render instead of silently producing "Invalid Date".
 */
export function toEpochMs(value: Timestamp | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Convenience for sort comparators: unparseable values sort last. */
export function epochOr(value: Timestamp | null | undefined, fallback = 0): number {
  return toEpochMs(value) ?? fallback;
}

/**
 * A chat as the server actually serialises it.
 *
 * Verified against a live `GET /api/chats/:id`. The field is `name`, NOT
 * `title` — the previous declaration used `title`, so every consumer read
 * `undefined` and the mobile list rendered every row as "Untitled chat".
 *
 * There is likewise no `archived` boolean: archival is `status === 'archived'`.
 */
/**
 * Body of `POST /api/chats/:id/cancel` — what `StopController` computes for a
 * press. `force` (the second press) also destroys the provider conversation;
 * `budgetSeconds` bounds the server's wait for the provider to acknowledge.
 */
export interface CancelTurnOptions {
  force?: boolean;
  budgetSeconds?: number;
}

export interface ChatSummary {
  id: string;
  name: string;
  sessionId: string | null;
  status: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  tags?: string[];
  projectId?: string | null;
  workspaceId?: string | null;
  model?: string | null;
  defaultAgentMode?: AgentMode | null;
  permissionMode?: string | null;
  orchestratorMode?: boolean;
  /** Conversation-branch provenance (a fork stays in the sidebar; workers do not). */
  forkedFromChatId?: string | null;
  forkedAtTurnId?: string | null;
  /**
   * One line of the newest message, for a catalogue row. Present on the LIST
   * response only — a single chat is fetched with its messages anyway.
   */
  preview?: string;
  previewRole?: 'user' | 'assistant' | 'system' | 'tool';
  previewAt?: Timestamp;
}

/** True when a chat has been archived. */
export function isArchived(chat: Pick<ChatSummary, 'status'>): boolean {
  return chat.status === 'archived';
}

/**
 * A persisted tool call.
 *
 * These do NOT arrive as `role: 'tool'` messages — they hang off the
 * ASSISTANT message that made them, in `metadata.toolCalls`. A client that
 * only renders message content therefore shows an agent narrating work it
 * appears never to have done.
 */
export interface PersistedToolCall {
  id: string;
  tool: string;
  args: unknown;
  result?: unknown;
  status: 'running' | 'complete' | 'error';
}

/**
 * A chat message as the server actually serialises it.
 *
 * The timestamp field is `timestamp` (ISO string), NOT `createdAt` — verified
 * against a live `GET /api/chats/:id/messages`. `createdAt` is kept optional
 * because nothing validates the wire and an older server may still send it.
 */
export interface ChatMessage {
  id: string;
  chatId: string;
  sessionId?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: Timestamp;
  createdAt?: Timestamp;
  metadata?: {
    turnId?: string;
    agentMode?: string;
    toolCalls?: PersistedToolCall[];
    [key: string]: unknown;
  };
}

/** The message's time, whichever field the server used. */
export function messageTime(message: ChatMessage): Timestamp | null {
  return message.timestamp ?? message.createdAt ?? null;
}

/** Tool calls attached to a message, or an empty array. */
export function messageToolCalls(message: ChatMessage): PersistedToolCall[] {
  const calls = message.metadata?.toolCalls;
  return Array.isArray(calls) ? calls : [];
}

export interface PlanSummary {
  planId: string;
  revision: number;
  title: string;
  summary: string;
  status: string;
  actions: string[];
  fileName?: string;
  interactionId?: string;
}

export interface InteractionSummary {
  interactionId: string;
  kind: string;
  status: string;
  payload?: Record<string, unknown>;
}

/** A worker spawned by an orchestrator chat. */
export type RewindScope = 'all' | 'code' | 'conversation';

export interface RewindChatResponse {
  chatId: string;
  turnId: string;
  scope: RewindScope;
  /** The prompt of the turn that was rewound — offered back in the composer. */
  prompt?: string;
  /** How the provider's own history was moved: natively, by a seeded fresh session, or not at all (`code` scope). */
  conversation: 'native' | 'synthetic' | 'skipped';
  files?: {
    mounts: Array<{ alias: string; ok: boolean; restored?: number; deleted?: number; skipped?: number; error?: string }>;
    restored: number;
    deleted: number;
    skipped: number;
  };
}

export interface ForkChatResponse {
  chat: ChatSummary;
  turnId?: string;
  conversation: 'native' | 'synthetic';
}

export interface BackgroundTaskSummary {
  taskId: string;
  taskName: string;
  status: string;
  model?: string;
  reviewRounds: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider?: string;
  description?: string;
  category?: string;
  contextWindow?: number;
  /** The context-gauge denominator. Prefer this over `contextWindow`. */
  promptTokenLimit?: number;
  totalContextWindow?: number;
  maxOutputTokens?: number;
  supportsReasoning?: boolean;
  /**
   * The effort levels this model accepts.
   *
   * An ARRAY (`["low","medium","high","xhigh","max"]`) — verified against a
   * live `/api/harness/models`. This was declared as a space-separated
   * string, so calling `.trim()` on it threw and took the entire app down
   * the moment a reasoning-capable model was selected. The union keeps the
   * older shape parseable rather than trading one hard assumption for
   * another.
   */
  reasoningEfforts?: string[] | string;
  defaultReasoningEffort?: string;
  /** Present when the model offers a long-context tier. */
  supportsLongContext?: boolean;
  standardContextWindow?: number;
  longContext?: { promptTokenLimit?: number; totalContextWindow?: number };
}

/** Per-turn agent mode. Mirrors `AGENT_MODES` in @generatorai/shared. */
export type AgentMode = 'auto' | 'plan';

export interface SendMessageInput {
  message: string;
  /** Per-turn agent mode; omit to inherit the chat's default. */
  mode?: AgentMode;
}

// ── Runs ────────────────────────────────────────────────────────

export interface WorkflowSummary {
  id: string;
  name: string;
  description?: string;
  projectId?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  tags?: string[];
}

export type RunStatus =
  | 'created'
  | 'pending'
  | 'starting'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WorkflowRunSummary {
  id: string;
  workflowDefinitionId: string;
  /** Run inputs. A run started for a project carries it as `__projectId`. */
  variables?: Record<string, unknown>;
  name?: string;
  status: RunStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  startedAt?: Timestamp | null;
  completedAt?: Timestamp | null;
  error?: string | null;
  workspaceId?: string | null;
  /** Set on a retry: the failed or cancelled run it replaced. */
  ancestorRunId?: string | null;
}

export type StageRunStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'paused'
  | 'sleeping'
  | 'awaiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export interface StageRunSummary {
  id: string;
  workflowRunId: string;
  stageDefinitionId: string;
  name?: string;
  status: StageRunStatus;
  sessionId?: string | null;
  startedAt?: Timestamp | null;
  completedAt?: Timestamp | null;
  error?: string | null;
  retryCount?: number;
  currentStep?: number;
  totalSteps?: number;
  /** Harness-produced summary of what the stage did. */
  summary?: string | null;
  /** Full raw output of the stage's main prompt(s). */
  outputText?: string | null;
  outputData?: Record<string, unknown> | null;
  artifactManifest?: Array<{ path: string; language: string; action: string; sizeBytes: number }> | null;
  /** The parked payload while `awaiting_input` — shape varies by gate kind. */
  interruptData?: unknown;
  wakeAt?: Timestamp | null;
}

/**
 * One entry of `GET /workflow-runs/:id/pending-interrupts`.
 *
 * The server returns the parked STAGE RUN rows themselves
 * (`HitlService.listPending` → `StageRun[]`), so `id` is the stage-run id —
 * the id the approve/interrupt routes take — and the prompt, when there is
 * one, lives inside `interruptData`. This previously declared a
 * `{ stageId, prompt }` shape the server never sent, which is how a client
 * ended up matching on a field that was always undefined.
 */
export interface PendingInterrupt {
  id: string;
  workflowRunId: string;
  stageDefinitionId: string;
  name?: string;
  status: StageRunStatus;
  sessionId?: string | null;
  interruptData?: unknown;
}

/** Outcomes the HITL approve endpoint accepts. */
export type ApprovalOutcome = 'approved' | 'changes_requested' | 'rejected';

// ── Automations ─────────────────────────────────────────────────

export interface AutomationSummary {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  triggerType: 'manual' | 'schedule' | 'webhook';
  workflowDefinitionId: string;
  workflowIds?: string[];
  cronExpression?: string;
  timezone?: string;
  nextRunAt?: Timestamp | null;
  lastRunAt?: Timestamp | null;
  createdAt: Timestamp;
}

export interface AutomationExecutionSummary {
  id: string;
  automationId: string;
  status: string;
  /** @deprecated The server sends the `*Iterations` counts below; kept for older callers. */
  totalRuns?: number;
  completedRuns?: number;
  failedRuns?: number;
  totalIterations?: number;
  completedIterations?: number;
  failedIterations?: number;
  triggeredBy?: string;
  error?: string | null;
  startedAt?: Timestamp | null;
  completedAt?: Timestamp | null;
}

// ── Changes / review ────────────────────────────────────────────

export interface ChangeFileEntry {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  isBinary: boolean;
  isTooLarge: boolean;
  oldBlob?: string;
  newBlob?: string;
  lang?: string;
  /** True while the user's accepted blob still equals the head blob. */
  kept?: boolean;
}

/** Either side of a comparison, as the summary resolved it. */
export interface ChangeRevisionEntry {
  kind: 'baseline' | 'checkpoint' | 'working' | 'ref';
  id?: string;
  treeish?: string;
  label?: string;
  normalized?: boolean;
}

export interface ChangeRepoEntry {
  alias: string;
  kind: string;
  hasBaseline: boolean;
  /**
   * THIS mount's base / head. Optional only so an older server still
   * type-checks; every mount resolves the selector differently, so the
   * response-level pair is wrong for all but the first.
   */
  base?: ChangeRevisionEntry;
  head?: ChangeRevisionEntry;
  stats: { files: number; additions: number; deletions: number };
  files: ChangeFileEntry[];
  keptCount?: number;
}

export interface ChangeSummary {
  workspaceId: string;
  hasGit: boolean;
  repos: ChangeRepoEntry[];
  stats: { files: number; additions: number; deletions: number };
  keptCount?: number;
}

/** One file, named the way both review routes want it. */
export interface ChangeFileRef {
  alias: string;
  /** Repo-relative, never alias-prefixed. */
  path: string;
}

export interface ReviewChangesResult {
  workspaceId: string;
  kept: number;
  unkept: number;
  /** Total kept files in the workspace after the change. */
  keptCount: number;
}

export interface DiscardChangesResult {
  workspaceId: string;
  mounts: Array<{
    alias: string;
    ok: boolean;
    restored: number;
    deleted: number;
    preRestoreCheckpointId?: string | null;
    error?: string;
  }>;
  restoredCount: number;
  deletedCount: number;
  discardedCount: number;
  /** Paths refused for safety — symlinks / hard links. */
  skipped: Array<{ alias: string; path: string; reason: string }>;
}

export interface ChangeFilePatch {
  path: string;
  alias: string;
  patch: string;
  truncated: boolean;
  cacheKey: string;
}

export interface ReviewComment {
  id: string;
  threadId: string;
  author: 'user' | 'agent';
  body: string;
  intent?: string;
  createdAt: string | number;
}

export interface ReviewThread {
  id: string;
  workspaceId: string;
  repoAlias: string;
  path: string;
  side: 'additions' | 'deletions';
  startLine: number;
  endLine: number;
  anchorText: string;
  status: string;
  reviewRound: number;
  comments: ReviewComment[];
  baseCheckpointId: string;
  headCheckpointId: string;
}

// ── Projects ────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  status?: string;
  createdAt: Timestamp;
}

export interface CodebaseSummary {
  id: string;
  projectId: string;
  alias: string;
  type: 'git-remote' | 'git-local' | 'local-dir';
  url?: string;
  localPath?: string;
  defaultBranch?: string;
  status?: string;
  lastFetchedAt?: Timestamp | null;
}

// ── Agents (AGT-01) ─────────────────────────────────────────────

/**
 * The subset of an `Agent` a thin client needs to render a picker.
 * Deliberately NOT the full row: instructions and the tool policy are large
 * and are only meaningful on an authoring surface.
 */
export interface AgentSummary {
  id: string;
  /** Portable `scope:slug` binding identifier. */
  ref: string;
  scope: 'system' | 'global' | 'project';
  slug: string;
  name: string;
  description: string;
  role: 'agent' | 'orchestrator';
  enabled: boolean;
  skillIds: string[];
  mcpServerIds: string[];
  version: number;
}

export interface WorkspaceSummary {
  id: string;
  name?: string;
  status: string;
  projectId?: string | null;
  rootPath?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Workspace tree ──────────────────────────────────────────────

/**
 * The file tree is served SEPARATELY from the change summary on purpose: the
 * path set only moves when files are created or deleted, whereas the change
 * summary moves on every write. Keeping them apart lets the Files view stay
 * mounted without refetching on every token.
 */
export interface WorkspaceTreeRepo {
  alias: string;
  kind: string;
  /** Repo-relative paths, sorted. NOT alias-prefixed. */
  paths: string[];
  truncated: boolean;
}

export interface WorkspaceTree {
  workspaceId: string;
  hasGit: boolean;
  repos: WorkspaceTreeRepo[];
  totalPaths: number;
}

/** Mirrors `WorkspaceTreeFile` — the field is `contents`, not `content`. */
export interface WorkspaceFile {
  alias: string;
  path: string;
  /** null when the file is binary or over the inline budget. */
  contents: string | null;
  size: number;
  isBinary: boolean;
  isTooLarge: boolean;
  lang: string;
  cacheKey: string;
}

// ── Checkpoints ─────────────────────────────────────────────────

export interface WorkspaceCheckpoint {
  id: string;
  workspaceId: string;
  repoAlias: string;
  /** baseline | turn | stage | autorun | live | manual | pre_restore */
  kind: string;
  label?: string | null;
  createdAt: number;
  fileCount?: number;
}

export interface CheckpointList {
  workspaceId: string;
  checkpoints: WorkspaceCheckpoint[];
}

export interface RestoreResult {
  restored: number;
  removed: number;
  /** Paths refused for safety — symlinks pointing outside the workspace. */
  skipped?: Array<{ path: string; reason: string }>;
}

// ── Terminals ───────────────────────────────────────────────────

export interface TerminalDescriptor {
  id: string;
  cwd: string;
  shell: string;
  pid?: number;
  /** pty | sandbox | fallback — `fallback` cannot run full-screen apps. */
  host: string;
  /** null while the process is alive. */
  exitCode: number | null;
  cols?: number;
  rows?: number;
  /**
   * ms since epoch — last observed activity (input/output/resize/ack). The
   * route (`terminalService.describe()`) always sends this; added here for
   * Phase 5 item 6's idle-state display, which was the first caller to need
   * it — additive only, so it does not disturb `apps/mobile`'s existing use
   * of this same type.
   */
  lastActivityAt?: number;
}

// ── Providers / health ──────────────────────────────────────────

export interface ProviderStatus {
  type: string;
  label: string;
  installed: boolean;
  connected: boolean;
  authenticated: boolean;
  ready: boolean;
  error?: string | null;
  checkedAt?: number;
  modelCount: number;
  models?: ModelInfo[];
}

export interface ProvidersResponse {
  primary: string;
  providers: ProviderStatus[];
}

/** The full `/api/health` body, not just `{ status }`. */
export interface HealthSnapshot {
  status: string;
  copilot: boolean;
  harness: { type: string; healthy: boolean };
  db: boolean;
  uptime: number;
  timestamp: string;
  /** `process.platform` of the SERVER host — where terminals and editors run. */
  platform?: NodeJS.Platform;
  activeChats: number;
  activeWorkflowRuns: number;
  runningChatIds: string[];
  otel?: { enabled: boolean; endpoint?: string; serviceName?: string };
}

// ── System catalogues ───────────────────────────────────────────

/** A skill, prompt or agent shipped with the install. */
export interface SystemArtifact {
  id: string;
  name: string;
  type: 'agent' | 'prompt' | 'skill';
  description?: string;
  path?: string;
  tags?: string[];
}

export interface McpServerEntry {
  id?: string;
  name: string;
  description?: string;
  command?: string;
  args?: string[];
  url?: string;
  transport?: string;
}

/** Credentials are never returned; only whether one is configured. */
export interface SourceControlConfig {
  activeProvider: 'github' | 'none';
  github?: { host?: string; hasToken?: boolean; username?: string };
}

export interface SourceControlStatus {
  activeProvider: string;
  enabled: boolean;
}


/**
 * A device's request for more scopes (`/api/auth/**\/scope-requests`).
 * `scopes` are the ones asked for; `grantedScopes` the subset an admin
 * approved (null until then). `deviceName`/`platform` are joined in by the
 * server so a list needs no second fetch.
 */
export interface DeviceScopeRequest {
  requestId: string;
  deviceId: string;
  deviceName: string | null;
  platform: string | null;
  scopes: string[];
  reason: string | null;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  grantedScopes: string[] | null;
}

/** Query keys, shared so web and mobile invalidate the same entries. */
export const queryKeys = {
  chats: () => ['chats'] as const,
  chat: (id: string) => ['chats', id] as const,
  chatMessages: (id: string) => ['chats', id, 'messages'] as const,
  chatPlans: (id: string) => ['chats', id, 'plans'] as const,
  chatInteractions: (id: string) => ['chats', id, 'interactions'] as const,
  chatTasks: (id: string) => ['chats', id, 'background-tasks'] as const,
  models: () => ['models'] as const,
  providers: () => ['harness', 'providers'] as const,
  health: () => ['health'] as const,
  devices: () => ['auth', 'devices'] as const,
  /** This device's own scope requests. */
  myScopeRequests: () => ['auth', 'scope-requests', 'me'] as const,
  /** The admin queue of pending scope requests. */
  pendingScopeRequests: () => ['auth', 'scope-requests', 'pending'] as const,
  posture: () => ['security', 'posture'] as const,
  workflows: () => ['workflows'] as const,
  /**
   * Runs. Every key shares the `['runs']` root so a lifecycle event that
   * invalidates the list also refreshes an open run — but the per-workflow
   * list and a single run live under DIFFERENT second segments. They used to
   * both be `['runs', <id>]`, distinguished only by which kind of id happened
   * to be in the slot.
   */
  runs: (workflowId?: string) =>
    workflowId ? (['runs', 'by-workflow', workflowId] as const) : (['runs'] as const),
  run: (runId: string) => ['runs', 'detail', runId] as const,
  runStages: (runId: string) => ['runs', 'detail', runId, 'stages'] as const,
  runInterrupts: (runId: string) => ['runs', 'detail', runId, 'interrupts'] as const,
  runScratchpad: (runId: string) => ['runs', 'detail', runId, 'scratchpad'] as const,
  /** One stage session's persisted transcript. */
  stageTranscript: (runId: string, stageRunId: string) =>
    ['runs', 'detail', runId, 'stage', stageRunId, 'transcript'] as const,
  automationExecution: (id: string, execId: string) =>
    ['automations', id, 'executions', execId] as const,
  agent: (id: string) => ['agents', 'detail', id] as const,
  agentUsage: (id: string) => ['agents', 'detail', id, 'usage'] as const,
  projectChats: (projectId: string) => ['chats', 'by-project', projectId] as const,
  projectWorkflows: (projectId: string) => ['workflows', 'by-project', projectId] as const,
  projectAutomations: (projectId: string) => ['automations', 'by-project', projectId] as const,
  codebaseStatus: (projectId: string, cid: string) =>
    ['projects', projectId, 'codebases', cid, 'status'] as const,
  codebaseReadiness: (projectId: string, cid: string) =>
    ['projects', projectId, 'codebases', cid, 'readiness'] as const,
  codebaseBranches: (projectId: string, cid: string) =>
    ['projects', projectId, 'codebases', cid, 'branches'] as const,
  automations: () => ['automations'] as const,
  automation: (id: string) => ['automations', id] as const,
  automationExecutions: (id: string) => ['automations', id, 'executions'] as const,
  projects: () => ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  codebases: (projectId: string) => ['projects', projectId, 'codebases'] as const,
  workspaces: () => ['workspaces'] as const,
  workspaceTree: (workspaceId: string) => ['workspaces', workspaceId, 'tree'] as const,
  /** Keyed on the server's cache key so an edited file re-reads. */
  workspaceFile: (workspaceId: string, path: string, alias?: string) =>
    ['workspaces', workspaceId, 'tree', 'file', alias ?? '.', path] as const,
  changes: (workspaceId: string) => ['workspaces', workspaceId, 'changes'] as const,
  /**
   * A diff must be keyed by CONTENT identity, not just by path.
   *
   * With a path-only key and any staleTime at all, editing a file leaves the
   * previous diff on screen — the query looks fresh because the key did not
   * change. The blob pair is the content identity.
   */
  changeFile: (workspaceId: string, path: string, oldBlob?: string, newBlob?: string) =>
    ['workspaces', workspaceId, 'changes', path, oldBlob ?? '-', newBlob ?? '-'] as const,
  checkpoints: (workspaceId: string) => ['workspaces', workspaceId, 'checkpoints'] as const,
  reviewThreads: (workspaceId: string) => ['workspaces', workspaceId, 'review'] as const,
} as const;

export function createApiClient(fetchImpl: ApiFetch) {
  return {
    health: () => request<HealthSnapshot>(fetchImpl, '/api/health'),

    harness: {
      /**
       * Provider readiness and per-provider model counts.
       *
       * `refresh` forces a re-probe, which spawns each provider's CLI and can
       * take seconds — so it is only ever passed on an explicit user action.
       */
      providers: (refresh = false) =>
        request<ProvidersResponse>(
          fetchImpl,
          `/api/harness/providers${refresh ? '?refresh=1' : ''}`,
        ),

      /** Change the DEFAULT provider. Existing chats keep their own. */
      setDefault: (type: string) =>
        request<{ message: string; type: string; switched: boolean }>(
          fetchImpl,
          '/api/harness/switch',
          json({ type }),
        ),
    },

    chats: {
      // NOTE ON LIST SHAPES
      //
      // Every list endpoint on this server responds with a BARE ARRAY, not a
      // `{ chats: [...] }` envelope. These signatures previously declared an
      // envelope, which type-checked fine (nothing validates the wire at
      // runtime) and then silently produced `undefined` at every call site —
      // the mobile Chats tab rendered "No chats yet" against a server holding
      // 128 chats. Verified against the live API; keep these in step with
      // `apps/server/src/routes/chats.ts`, which does `res.json(chats)`.
      list: (params?: { archived?: boolean; limit?: number; projectId?: string }) => {
        const q = new URLSearchParams();
        if (params?.archived !== undefined) q.set('archived', String(params.archived));
        if (params?.projectId) q.set('projectId', params.projectId);
        if (params?.limit !== undefined) q.set('limit', String(params.limit));
        const suffix = q.toString() ? `?${q}` : '';
        return request<ChatSummary[]>(fetchImpl, `/api/chats${suffix}`);
      },

      get: (id: string) => request<ChatSummary>(fetchImpl, `/api/chats/${id}`),

      /**
       * Create a chat.
       *
       * The server field is `name`, NOT `title` — `CreateChatSchema` requires
       * it (min length 1). Sending `{}` returned 400 and made the mobile
       * "New chat" button a dead end.
       *
       * The optional fields mirror `CreateChatSchema` exactly. They are the
       * ones a phone can meaningfully supply: anything that needs a host
       * filesystem path (`gitRepositories`) is deliberately absent.
       */
      create: (input: {
        name: string;
        description?: string;
        model?: string;
        projectId?: string;
        codebaseIds?: string[];
        tags?: string[];
        defaultAgentMode?: AgentMode;
        permissionMode?: string;
        orchestratorMode?: boolean;
        useWorktree?: boolean;
        /** AGT-01 — portable `scope:slug` ref of the driving agent. */
        agentRef?: string;
      }) => request<ChatSummary>(fetchImpl, '/api/chats', json(input)),

      messages: (id: string, params?: { limit?: number; before?: string }) => {
        const q = new URLSearchParams();
        if (params?.limit !== undefined) q.set('limit', String(params.limit));
        if (params?.before) q.set('before', params.before);
        const suffix = q.toString() ? `?${q}` : '';
        return request<ChatMessage[]>(
          fetchImpl,
          `/api/chats/${id}/messages${suffix}`,
        );
      },

      /**
       * Send a prompt.
       *
       * The route is `/prompt`, NOT `/messages` — `/messages` is GET-only, so
       * the previous POST to it 404'd and mobile could never send anything.
       * The server accepts multipart (for attachments) or JSON; JSON is enough
       * until mobile supports attachments.
       */
      send: (id: string, input: SendMessageInput) =>
        request<{ sessionId: string }>(
          fetchImpl,
          `/api/chats/${id}/prompt`,
          json({
            prompt: input.message,
            ...(input.mode ? { mode: input.mode } : {}),
          }),
        ),

      /**
       * Same route as {@link send}, multipart instead of JSON — the only way
       * to carry files. `multer.array('attachments', 10)` on the server names
       * both the field (`attachments`) and the 10-file cap; anything past
       * that the server rejects, so callers should not silently truncate.
       */
      sendWithAttachments: (
        id: string,
        input: SendMessageInput,
        attachments: Array<{ name: string; data: Uint8Array; mimeType?: string }>,
      ) => {
        const form = new FormData();
        form.set('prompt', input.message);
        if (input.mode) form.set('mode', input.mode);
        for (const file of attachments) {
          form.append(
            'attachments',
            // `Uint8Array<ArrayBufferLike>` (what `fs.readFile` returns) vs.
            // Node's `Blob` constructor wanting `ArrayBufferView<ArrayBuffer>`
            // is a real, harmless typings mismatch — any Buffer/Uint8Array is
            // a valid Blob source at runtime regardless of its backing buffer.
            new Blob([file.data as unknown as ArrayBuffer], {
              type: file.mimeType || 'application/octet-stream',
            }),
            file.name,
          );
        }
        // No `content-type` header: the fetch implementation sets the
        // multipart boundary itself from the `FormData` body. Setting one by
        // hand here would omit the boundary and the server could not parse it.
        return request<{ sessionId: string }>(fetchImpl, `/api/chats/${id}/prompt`, {
          method: 'POST',
          body: form,
        });
      },

      /**
       * Stop the in-flight turn. `options` is what `StopController` computes
       * for the press — the first, graceful press and the forced second press
       * differ only here — and was previously dropped on the floor by every
       * caller, which sent `{}`.
       */
      cancel: (id: string, options?: CancelTurnOptions) =>
        request<void>(fetchImpl, `/api/chats/${id}/cancel`, json(options ?? {})),

      /**
       * Update chat metadata.
       *
       * Field names mirror the server exactly: `name` (not `title`) and
       * `status: 'archived'` (not `archived: true`). The previous signature
       * used the client-side names, so every field it sent was silently
       * dropped by the route's destructure.
       *
       * `model` and `defaultAgentMode` live here rather than on the prompt
       * because the server has no per-turn model override — the composer
       * changes the chat's model, which then applies to subsequent turns.
       */
      update: (
        id: string,
        patch: {
          name?: string;
          description?: string;
          model?: string;
          defaultAgentMode?: AgentMode;
          permissionMode?: string;
          projectId?: string;
          tags?: string[];
          status?: string;
          /**
           * Portable `scope:slug` ref of the agent driving this chat from now
           * on. `''`/`null` unbinds it. Distinct from `defaultAgentMode`,
           * which is the plan/auto/HITL permission posture, not an identity.
           */
          agentRef?: string | null;
        },
      ) =>
        request<ChatSummary>(fetchImpl, `/api/chats/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        }),

      archive: (id: string) =>
        request<ChatSummary>(fetchImpl, `/api/chats/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'archived' }),
        }),

      remove: (id: string) => request<void>(fetchImpl, `/api/chats/${id}`, { method: 'DELETE' }),

      plans: (id: string) => request<PlanSummary[]>(fetchImpl, `/api/chats/${id}/plans`),

      planContent: (id: string, planId: string) =>
        request<{ content: string }>(fetchImpl, `/api/chats/${id}/plans/${planId}/content`),

      /**
       * Record a decision on a plan.
       *
       * The shape is `PlanDecisionSchema` on the server and nothing else
       * validates: `approved` is REQUIRED, and the discriminator between
       * "implement it" and "stop here" is `action`, not `approved`. Sending
       * `{action, comment}` — which reads plausibly — is rejected with a 400.
       */
      decidePlan: (
        id: string,
        planId: string,
        decision: {
          approved: boolean;
          action?: 'exit_only' | 'implement_interactive' | 'implement_autopilot';
          feedback?: string;
          useEditedContent?: boolean;
          expectedRevision?: number;
        },
      ) =>
        request<void>(fetchImpl, `/api/chats/${id}/plans/${planId}/decision`, json(decision)),

      interactions: (id: string) =>
        request<InteractionSummary[]>(fetchImpl, `/api/chats/${id}/interactions`),

      /**
       * Workers spawned by an orchestrator chat.
       *
       * Note the envelope: this route answers `{ tasks: [...] }`, unlike the
       * bare arrays the other chat list routes return.
       */
      backgroundTasks: (id: string) =>
        request<{ tasks: BackgroundTaskSummary[] }>(
          fetchImpl,
          `/api/chats/${id}/background-tasks`,
        ),

      respond: (
        id: string,
        interactionId: string,
        response: { answers?: Record<string, string[]>; freeformResponse?: string; action?: string },
      ) =>
        request<void>(
          fetchImpl,
          `/api/chats/${id}/interactions/${interactionId}/respond`,
          json(response),
        ),

      /**
       * Answer a blocking tool-permission prompt (review finding 5.1) —
       * sibling of `respond` above, same interaction resource, distinct verb
       * (`ChatManagementService.buildPermissionHandler`'s route, not the
       * question/plan `respond` route).
       */
      respondPermission: (
        id: string,
        interactionId: string,
        response: { behavior: 'allow' | 'deny'; message?: string },
      ) =>
        request<void>(
          fetchImpl,
          `/api/chats/${id}/interactions/${interactionId}/permission`,
          json(response),
        ),

      /** The whole transcript, oldest first (no page cap). */
      transcript: (id: string) =>
        request<{ chatId: string; name: string; messages: ChatMessage[] }>(
          fetchImpl,
          `/api/chats/${id}/transcript`,
        ),

      /**
       * Rewind to the START of a turn — files, conversation or both. The
       * server answers 409 `CHAT_BUSY` while a turn is streaming.
       */
      rewind: (id: string, input: { turnId: string; scope?: RewindScope }) =>
        request<RewindChatResponse>(fetchImpl, `/api/chats/${id}/rewind`, json(input)),

      /** Branch the conversation after a turn (default: the last one) into a new chat. */
      fork: (id: string, input: { turnId?: string; name?: string } = {}) =>
        request<ForkChatResponse>(fetchImpl, `/api/chats/${id}/fork`, json(input)),

      setPermissionMode: (id: string, mode: string) =>
        request<void>(fetchImpl, `/api/chats/${id}/permission-mode`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          // `SetChatPermissionModeSchema` names this `mode`.
          body: JSON.stringify({ mode }),
        }),
    },

    models: () => request<ModelInfo[]>(fetchImpl, '/api/harness/models'),

    workflows: {
      list: (projectId?: string) =>
        request<WorkflowSummary[]>(
          fetchImpl,
          `/api/workflow-definitions${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
        ),

      get: (id: string) =>
        request<WorkflowSummary & { stages: unknown[]; edges: unknown[] }>(
          fetchImpl,
          `/api/workflow-definitions/${id}`,
        ),
    },

    runs: {
      list: (params?: { definitionId?: string; status?: string }) => {
        const q = new URLSearchParams();
        if (params?.definitionId) q.set('definitionId', params.definitionId);
        if (params?.status) q.set('status', params.status);
        const suffix = q.toString() ? `?${q}` : '';
        return request<WorkflowRunSummary[]>(fetchImpl, `/api/workflow-runs${suffix}`);
      },

      get: (id: string) =>
        request<WorkflowRunSummary & { stageRuns: StageRunSummary[] }>(
          fetchImpl,
          `/api/workflow-runs/${id}`,
        ),

      stages: (id: string) =>
        request<StageRunSummary[]>(fetchImpl, `/api/workflow-runs/${id}/stages`),

      pendingInterrupts: (id: string) =>
        request<PendingInterrupt[]>(fetchImpl, `/api/workflow-runs/${id}/pending-interrupts`),

      /**
       * Answer a stage's HITL gate.
       *
       * This is the ONE mutating run operation a mobile device can perform:
       * the route policy classifies it as `exec:agent` (answering the agent)
       * rather than `write:workflows` (editing the workflow). Everything else
       * below is intentionally absent from the mobile surface.
       */
      approve: (
        runId: string,
        stageId: string,
        body: {
          outcome?: ApprovalOutcome;
          approved?: boolean;
          reason?: string;
          followUpPrompt?: string;
          value?: unknown;
        },
      ) =>
        request<{ message: string; outcome: string; approved: boolean }>(
          fetchImpl,
          `/api/workflow-runs/${runId}/stages/${stageId}/approve`,
          json(body),
        ),

      /** Supply data to a stage waiting on input. Also `exec:agent`. */
      interrupt: (runId: string, stageId: string, body: { data?: unknown; prompt?: string }) =>
        request<{ message: string }>(
          fetchImpl,
          `/api/workflow-runs/${runId}/stages/${stageId}/interrupt`,
          json(body),
        ),
    },

    automations: {
      list: (projectId?: string) =>
        request<AutomationSummary[]>(
          fetchImpl,
          `/api/automations${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
        ),

      get: (id: string) =>
        request<AutomationSummary & { executions: AutomationExecutionSummary[] }>(
          fetchImpl,
          `/api/automations/${id}`,
        ),

      executions: (id: string) =>
        request<AutomationExecutionSummary[]>(fetchImpl, `/api/automations/${id}/executions`),
    },

    workspaces: {
      list: (params?: { projectId?: string; limit?: number }) => {
        const q = new URLSearchParams();
        if (params?.projectId) q.set('projectId', params.projectId);
        if (params?.limit !== undefined) q.set('limit', String(params.limit));
        const suffix = q.toString() ? `?${q}` : '';
        return request<WorkspaceSummary[]>(fetchImpl, `/api/workspaces${suffix}`);
      },

      get: (id: string) => request<WorkspaceSummary>(fetchImpl, `/api/workspaces/${id}`),

      changes: (id: string, params?: { base?: string; head?: string; alias?: string }) => {
        const q = new URLSearchParams({ v: '2' });
        if (params?.base) q.set('base', params.base);
        if (params?.head) q.set('head', params.head);
        if (params?.alias) q.set('alias', params.alias);
        return request<ChangeSummary>(fetchImpl, `/api/workspaces/${id}/changes?${q}`);
      },

      /**
       * One file's unified diff.
       *
       * The blob SHAs are passed through so the server can answer 304 and the
       * client can key its cache on content identity.
       */
      filePatch: (
        id: string,
        params: { path: string; alias?: string; oldBlob?: string; newBlob?: string; base?: string; head?: string },
      ) => {
        const q = new URLSearchParams({ path: params.path, form: 'patch' });
        if (params.alias) q.set('alias', params.alias);
        if (params.oldBlob) q.set('oldBlob', params.oldBlob);
        if (params.newBlob) q.set('newBlob', params.newBlob);
        if (params.base) q.set('base', params.base);
        if (params.head) q.set('head', params.head);
        return request<ChangeFilePatch>(fetchImpl, `/api/workspaces/${id}/changes/file?${q}`);
      },

      /** Every tracked path, grouped by repo. Browsable independent of diffs. */
      tree: (id: string, alias?: string) =>
        request<WorkspaceTree>(
          fetchImpl,
          `/api/workspaces/${id}/tree${alias ? `?alias=${encodeURIComponent(alias)}` : ''}`,
        ),

      /**
       * One file's CURRENT content.
       *
       * Distinct from `filePatch`: that only serves paths appearing in a diff,
       * which is why browsing an untouched file needs this route instead.
       */
      treeFile: (id: string, params: { path: string; alias?: string }) => {
        const q = new URLSearchParams({ path: params.path });
        if (params.alias) q.set('alias', params.alias);
        return request<WorkspaceFile>(fetchImpl, `/api/workspaces/${id}/tree/file?${q}`);
      },

      /** Snapshots taken before each turn — the "compare against" list. */
      checkpoints: (id: string) =>
        request<CheckpointList>(fetchImpl, `/api/workspaces/${id}/checkpoints`),

      /**
       * Rewinds the workspace, or just the given paths.
       *
       * The server writes a `pre_restore` checkpoint first, so this is itself
       * undoable — which is the only reason it is safe to offer as a
       * one-tap "discard" on a phone.
       */
      restoreCheckpoint: (id: string, checkpointId: string, body?: { paths?: string[] }) =>
        request<RestoreResult>(
          fetchImpl,
          `/api/workspaces/${id}/checkpoints/${checkpointId}/restore`,
          json(body ?? {}),
        ),

      /**
       * Record which files the user has accepted ("Keep"), or drop that.
       *
       * `blob` is the head blob the client saw — `''` for a deleted file.
       * Content identity, not a flag: the acceptance evaporates on its own
       * the moment the agent edits the file again.
       */
      reviewChanges: (
        id: string,
        body: {
          keep?: Array<ChangeFileRef & { blob: string }>;
          unkeep?: ChangeFileRef[];
          keepAll?: boolean;
        },
      ) =>
        request<ReviewChangesResult>(
          fetchImpl,
          `/api/workspaces/${id}/changes/review`,
          json(body),
        ),

      /**
       * Undo files, each mount restored from its OWN base. Works for every
       * mount kind, including those whose base is a bare commit rather than
       * a checkpoint — and writes a `pre_restore` snapshot first, so it is
       * itself undoable.
       */
      discardChanges: (id: string, body: { files?: ChangeFileRef[]; all?: boolean }) =>
        request<DiscardChangesResult>(
          fetchImpl,
          `/api/workspaces/${id}/changes/discard`,
          json(body),
        ),
    },

    /**
     * Terminal sessions.
     *
     * A session is created over authenticated HTTP and only then attached to
     * over a WebSocket — the upgrade cannot carry an Authorization header, so
     * the session id is the thing the socket URL is built from.
     */
    terminals: {
      create: (workspaceId: string, body: { cols: number; rows: number }) =>
        request<TerminalDescriptor>(
          fetchImpl,
          `/api/workspaces/${workspaceId}/terminals`,
          json(body),
        ),

      get: (workspaceId: string, sid: string) =>
        request<TerminalDescriptor>(
          fetchImpl,
          `/api/workspaces/${workspaceId}/terminals/${sid}`,
        ),

      kill: (workspaceId: string, sid: string) =>
        request<void>(fetchImpl, `/api/workspaces/${workspaceId}/terminals/${sid}`, {
          method: 'DELETE',
        }),
    },

    review: {
      threads: (workspaceId: string, params?: { path?: string; status?: string }) => {
        const q = new URLSearchParams();
        if (params?.path) q.set('path', params.path);
        if (params?.status) q.set('status', params.status);
        const suffix = q.toString() ? `?${q}` : '';
        return request<{ workspaceId: string; threads: ReviewThread[] }>(
          fetchImpl,
          `/api/workspaces/${workspaceId}/review/threads${suffix}`,
        );
      },

      createThread: (
        workspaceId: string,
        body: {
          path: string;
          body: string;
          anchorText: string;
          scopeId: string;
          baseCheckpointId: string;
          headCheckpointId: string;
          side: 'additions' | 'deletions';
          startLine: number;
          endLine: number;
          alias?: string;
          intent?: string;
          scope?: string;
        },
      ) =>
        request<ReviewThread>(
          fetchImpl,
          `/api/workspaces/${workspaceId}/review/threads`,
          json(body),
        ),

      addComment: (
        workspaceId: string,
        threadId: string,
        body: { body: string; intent?: string },
      ) =>
        request<ReviewComment>(
          fetchImpl,
          `/api/workspaces/${workspaceId}/review/threads/${threadId}/comments`,
          json(body),
        ),

      setThreadStatus: (workspaceId: string, threadId: string, status: string) =>
        request<ReviewThread>(
          fetchImpl,
          `/api/workspaces/${workspaceId}/review/threads/${threadId}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status }),
          },
        ),

      submit: (workspaceId: string, body: { threadIds: string[]; note?: string; preview?: boolean }) =>
        request<{ prompt: string; threadIds: string[]; reviewRound: number; delivered: boolean }>(
          fetchImpl,
          `/api/workspaces/${workspaceId}/review/submit`,
          json(body),
        ),
    },

    projects: {
      list: () => request<ProjectSummary[]>(fetchImpl, '/api/projects'),

      get: (id: string) =>
        request<ProjectSummary & { codebases: CodebaseSummary[] }>(
          fetchImpl,
          `/api/projects/${id}`,
        ),

      codebases: (id: string) =>
        request<CodebaseSummary[]>(fetchImpl, `/api/projects/${id}/codebases`),
    },

    /**
     * AGT-01 — reusable agents. Read-only on mobile: authoring an agent grants
     * capability and is deliberately kept on the desktop/web surface where the
     * full capability policy is visible.
     */
    agents: {
      /** Picker list — project agents shadow global, global shadows system. */
      selectable: (projectId?: string) =>
        request<AgentSummary[]>(
          fetchImpl,
          `/api/agents?selectable=1${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`,
        ),

      list: () => request<AgentSummary[]>(fetchImpl, '/api/agents'),
    },

    /**
     * Events since `afterSeq`, for cold start and gap-fill after a drop.
     *
     * The envelope is `{ rows, nextAfterSeq }` — NOT `{ events }`, which is
     * what this previously declared. Nothing validates the wire, so the
     * mismatch type-checked and then produced `undefined` at every call site:
     * a client that dropped its stream would silently replay nothing and sit
     * on a stale transcript with no error.
     */
    replay: (scope: string, id: string, afterSeq = 0, limit?: number) =>
      request<{
        rows: Array<{
          id: number;
          scope: string;
          scopeId: string;
          seq: number;
          kind: string;
          payload?: Record<string, unknown>;
          ts: number;
        }>;
        nextAfterSeq: number;
      }>(
        fetchImpl,
        `/api/stream/replay?scope=${encodeURIComponent(scope)}&id=${encodeURIComponent(id)}&afterSeq=${afterSeq}${
          limit === undefined ? '' : `&limit=${limit}`
        }`,
      ),

    /**
     * Read-only catalogues.
     *
     * Enabling or disabling a skill / MCP server is a machine-wide change,
     * so it stays on the desktop. Mobile shows what is installed and what it
     * does, which is the part worth checking away from a desk.
     */
    system: {
      artifacts: (type?: 'agent' | 'prompt' | 'skill') =>
        request<SystemArtifact[]>(
          fetchImpl,
          `/api/system/artifacts${type ? `?type=${type}` : ''}`,
        ),

      artifactContent: (id: string) =>
        request<{ content: string }>(fetchImpl, `/api/system/artifacts/${id}`),

      mcpServers: () => request<McpServerEntry[]>(fetchImpl, '/api/system/mcp-servers'),
    },

    /**
     * What a device can do about its OWN grant. Needs only `read:status`;
     * the server takes the device id from the credential, never from the
     * body. Reviewing other devices' requests is the admin half — see
     * `createAdminApi().devices.scopeRequests`.
     */
    auth: {
      scopeRequests: {
        /**
         * Ask for scopes this device does not hold. 403 `SCOPE_NOT_REQUESTABLE`
         * for `admin:*` from a non-admin device; 409 `REQUEST_PENDING` (with
         * the open request under `existing`) when one is already waiting.
         */
        create: (body: { scopes: string[]; reason?: string }) =>
          request<DeviceScopeRequest>(fetchImpl, '/api/auth/devices/me/scope-requests', json(body)),
        /** Newest first. Lets the UI show "Pending since …" or the last answer. */
        mine: async () =>
          (await request<{ requests: DeviceScopeRequest[] }>(
            fetchImpl,
            '/api/auth/devices/me/scope-requests',
          )).requests ?? [],
        cancel: (requestId: string) =>
          request<void>(fetchImpl, `/api/auth/devices/me/scope-requests/${encodeURIComponent(requestId)}`, {
            method: 'DELETE',
          }),
      },
    },

    sourceControl: {
      config: () => request<SourceControlConfig>(fetchImpl, '/api/source-control/config'),
      status: () => request<SourceControlStatus>(fetchImpl, '/api/source-control/status'),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
