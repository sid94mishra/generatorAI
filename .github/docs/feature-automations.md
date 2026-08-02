# Feature: Automations

> Automations are scheduled / triggered batch executors. Each automation references one-or-more workflow definitions and fans out into many `WorkflowRun`s when its trigger fires.

For workflow execution semantics, see [feature-workflow-runs.md](./feature-workflow-runs.md).

---

## 1. Entity & DB shape

`automations` table:
```
id                       text PK
name                     text
description?             text
enabled                  bool (default true)
triggerType              enum 'manual' | 'schedule' | 'webhook'
cronExpression?          text                       (for schedule)
webhookToken?            text                       (for webhook)
workflowIds              JSON string[]              (one or more workflow definition IDs)
inputMode                enum 'single' | 'loop' | 'batch' | 'script'
loopVariable?            text                       (for inputMode='loop')
loopItems?               JSON unknown[]             (for inputMode='loop')
batchDataFormat?         enum 'csv' | 'json_array' | 'jsonl'
batchData?               text                       (for inputMode='batch')
batchColumns?            JSON string[]
batchColumnMapping?      JSON Record<string,string>
dataSourceConfig?        JSON DataSourceConfig      (for inputMode='script')
variables                JSON Record<string,unknown>  (base vars merged into every iteration)
maxConcurrency           int (default 1)
onError                  enum 'continue' | 'stop'   (default 'stop')
lastRunAt, nextRunAt
lockedUntil?, lockedByProcess?                       (1.23 — cron lease lock)
scope                    enum 'global' | 'project'
projectId?               FK
useWorktree              bool (default true if projectId set)
createdAt, updatedAt
```

`automation_executions` — one row per trigger firing:
```
id                  text PK
automationId        FK
status              text                           (running | completed | failed | cancelled | partial)
triggeredBy         text                           ('manual' | 'schedule' | 'webhook')
webhookPayload?     JSON
totalIterations     int
completedIterations int
failedIterations    int
error?              text
workspaceId?        FK
startedAt, completedAt, createdAt
```

`automation_execution_runs` — one row per iteration linking to a `workflow_runs` row:
```
id                       text PK
executionId              FK
workflowRunId            FK
workflowDefinitionId     FK
iterationIndex           int
iterationVariables       JSON
iterationLabel?          text
status                   text
```

---

## 2. Trigger types

### `manual`
Default. Fires only via `POST /api/automations/:id/trigger` or the **Trigger** button.

### `schedule`
Cron expression evaluated by `node-cron` inside the server. The composition root starts a `setInterval` (default 30s) that:
1. Queries `automations WHERE enabled=true AND triggerType='schedule' AND lockedUntil < now()`.
2. For each candidate, evaluates `cronExpression` against `lastRunAt`.
3. **Acquires a row-level lease** (1.23): `UPDATE automations SET lockedUntil=now()+60s, lockedByProcess=:pid WHERE id=:id AND lockedUntil < now()`.
4. Fires `automationService.trigger(automation, 'schedule')` and updates `lastRunAt`.

The lease lock means multiple server processes can safely run the cron without duplicate triggers.

UI default cron: `0 9 * * *` (9am daily).

### `webhook`
`webhookToken` is generated on save (32-char URL-safe). Trigger URL: `POST /api/automations/webhook/<token>` with optional JSON body. The body is stored as `automation_executions.webhookPayload`.

The token can be **rotated** via `POST /api/automations/:id/rotate-webhook-token`.

---

## 3. Input modes

Determines how many WorkflowRuns are spawned per trigger.

### `single`
Spawns **one** workflow run per workflow ID, using `automation.variables` as the variables dict.

### `loop`
For each item in `loopItems[]`:
- Spawn one workflow run with variables `= { ...automation.variables, [loopVariable]: item }`.

Example:
```json
{
  "inputMode": "loop",
  "loopVariable": "ticketId",
  "loopItems": ["GH-1", "GH-2", "GH-3"],
  "variables": { "priority": "high" }
}
```
→ 3 runs, each with `{ priority: 'high', ticketId: 'GH-N' }`.

### `batch`
`batchData` parsed by `batchDataParser` (in `@generatorai/shared`) according to `batchDataFormat`:

- `csv` — Papaparse-like CSV parsing. `batchColumns` and `batchColumnMapping` rename columns to variable names.
- `json_array` — JSON.parse → array of objects, each object's keys become variables.
- `jsonl` — newline-delimited JSON, same as json_array.

Each row spawns one run. `automation.variables` are merged underneath (row data wins).

### `script`
`dataSourceConfig: DataSourceConfig`:

```typescript
type DataSourceConfig = {
  type: 'inline' | 'file' | 'script';
  // type='inline'
  data?: string | unknown[];
  format?: 'csv' | 'json_array' | 'jsonl';
  columns?: string[];
  columnMapping?: Record<string, string>;

  // type='file'
  filePath?: string;          // relative to projects/<id>/data-sources/ or absolute
  format?: 'csv' | 'json_array' | 'jsonl';

  // type='script'
  command?: string;           // node, python, bash, etc.
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  // script must output rows to stdout in `format`
};
```

`DataSourceResolver.resolve(config)` returns `{ rows: Record<string, unknown>[], rowCount: number }`. Then each row spawns a run.

Shipped data-source scripts in [templates/data-source-scripts/](../../templates/data-source-scripts/):
- `fetch-github-prs.sh` — list open PRs for a repo
- `fetch-azure-devops-workitems.py` — pull work items
- `fetch-jira-issues.py` — pull Jira issues
- `fetch-sonar-issues.py` — pull SonarQube issues
- `list-dotnet-projects.sh` — list .NET projects in a repo
- `parse-excel-to-json.py` — Excel → JSON rows
- `test-data-source.js` — sample test rows

You can `POST /api/automations/data-source/test` with a `DataSourceConfig` to dry-run a resolver without saving.

---

## 4. Concurrency & error handling

- **`maxConcurrency`** caps simultaneous workflow runs per execution. Default 1. Runs are queued and dispatched as slots free up.
- **`onError`:**
  - `continue` — failed runs are recorded; execution continues with the next iteration.
  - `stop` (default) — first failed run cancels remaining iterations; execution marked `failed` (or `partial` if some completed).

`AutomationService.executeExecution(execution)`:

```
1. Resolve data into rows[] (from inputMode + dataSourceConfig)
2. Update automation_executions.totalIterations = rows.length
3. Build a semaphore with maxConcurrency permits
4. For each row in rows[]:
       a. Build iteration variables = { ...automation.variables, ...row }
       b. acquire semaphore
       c. Create workflow_runs row (status=created)
       d. Insert automation_execution_runs row
       e. workflowRunService.startRun(runId).catch(handleFailure)
       f. release semaphore on completion
       g. On failure: if onError='stop' → cancel remaining + exit
5. Update execution.status based on aggregate (completed/failed/partial/cancelled)
6. Emit automation_execution.completed event
```

---

## 5. Lifecycle APIs

```
POST   /api/automations                          → create
GET    /api/automations [?projectId=<id>]        → list
GET    /api/automations/:id                      → with executions[]
PUT    /api/automations/:id                      → update (any field)
DELETE /api/automations/:id                      → delete
POST   /api/automations/:id/enable
POST   /api/automations/:id/disable
POST   /api/automations/:id/trigger              → manual fire
POST   /api/automations/:id/rotate-webhook-token

GET    /api/automations/:id/executions
GET    /api/automations/executions/:execId
POST   /api/automations/executions/:execId/cancel

POST   /api/automations/data-source/test         → dry-run a DataSourceConfig

POST   /api/automations/webhook/:token           → public endpoint for webhook triggers
```

---

## 6. Web UI

**`CreateAutomationPage`** ([apps/web/src/pages/CreateAutomationPage.tsx](../../apps/web/src/pages/CreateAutomationPage.tsx)) — single form:

| Section | Fields |
|---|---|
| **Basic Info** | Name, Description |
| **Trigger** | radio (Manual / Schedule / Webhook) + Schedule has `cron` input (default `0 9 * * *` + help), Webhook shows "token generated on save" |
| **Project Scope** | All Projects (Global) or per-project picker |
| **Workflows** | multi-select; shows `(global)` badge on global definitions |
| **Input Mode** | 4 radios (Single / Loop / Batch / Script) → conditional sub-forms |
| **Base Variables** | JSON editor (merged into every run) |

**`AutomationDetailPage`** shows trigger config, executions table with per-iteration runs, and Enable/Disable/Trigger buttons.

---

## 7. CLI

```powershell
generatorai automation list [--project <pid>]
generatorai automation create \
  --name "Nightly review" \
  --definition <wfDefId> \
  --trigger schedule \
  --schedule "0 2 * * *" \
  --input-mode loop \
  --loop-variable repo \
  --var '["repoA","repoB","repoC"]' \
  --max-concurrency 2 \
  --on-error continue
generatorai automation show <id>
generatorai automation update <id> --enabled false
generatorai automation enable <id>
generatorai automation disable <id>
generatorai automation trigger <id>
generatorai automation delete <id>
generatorai automation rotate-webhook-token <id>
generatorai automation execution <id>                          # list executions
generatorai automation execution <id> <execId>                # show with nested runs
generatorai automation execution <id> <execId> cancel
```

---

## 8. SDK

```typescript
const auto = await ai.automations.create({
  name: 'Nightly triage',
  triggerType: 'schedule',
  cronExpression: '0 2 * * *',
  workflowIds: ['wf-triage-id'],
  inputMode: 'loop',
  loopVariable: 'ticketId',
  loopItems: ['T-1', 'T-2', 'T-3'],
  maxConcurrency: 3,
  onError: 'continue',
  variables: { project: 'core' },
  projectId: 'proj-abc',
});

await ai.automations.enable(auto.id);

// Fire manually
const exec = await ai.automations.trigger(auto.id);
console.log('Execution started:', exec.id);

// Watch executions
const detailed = await ai.automations.get(auto.id);
for (const e of detailed.executions ?? []) {
  console.log(e.status, e.completedIterations, '/', e.totalIterations);
}
```

---

## 9. Streaming

Automation executions stream via `scope=automation` (or `scope=global` for cross-execution monitoring). Each nested workflow run also streams via `scope=run`.

Event kinds:

```
automation.triggered
automation.execution_started
automation.execution_progress      payload: { completed, failed, total }
automation.execution_completed
automation.execution_failed
automation.execution_cancelled
automation.iteration_started       payload: { iterationIndex, iterationLabel }
automation.iteration_completed
automation.iteration_failed
```

---

## 10. Edge cases & gotchas

1. **`schedule` trigger with invalid cron** — server rejects on save (Zod validates against `cron-parser`).
2. **Webhook payload variable interpolation** — payload is *not* automatically mapped into variables. Use `inputMode: 'script'` with a tiny preprocessor script if you need that.
3. **`maxConcurrency = 0`** — illegal; Zod requires `>= 1`.
4. **`onError = 'continue'` with many runs** — execution status will be `partial` if any failed; `completed` only if all succeeded.
5. **Cron lease lock TTL = 60s** — if a process crashes mid-execution, the lock auto-expires; another process can pick it up next tick. Stale executions are marked failed by `StartupRecoveryService`.
6. **Project-scoped automations** — only visible from inside that project page. Set `scope='project'` + `projectId`.
7. **Data source script timeout** — default 60s. Override per `dataSourceConfig.timeoutMs`. Script stdout is captured up to 64MB.
8. **`batchData` size limits** — stored as TEXT in SQLite; we recommend < 1MB. For larger batches use `inputMode: 'script'` to stream rows.
9. **`useWorktree` false** — speeds up batch runs but stages won't have git repos available.
10. **Concurrency leak through pause** — pausing an automation execution stops dispatching new iterations but in-flight runs continue. Use `cancel` to abort them.
