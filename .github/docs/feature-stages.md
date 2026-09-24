# Feature: Stages

> A **StageDefinition** is a single node in the workflow DAG. This is the most config-heavy entity in the system. Every option exposed in the web `Stage Properties` panel is documented here.

> **Agent binding (AGT-01).** `stage.agentRef` binds a first-class Agent by its
> portable `scope:slug` ref; `harnessConfigOverrides.agentOverrides` is the
> additive delta. Skills and MCP servers selected on the stage **UNION** with
> the agent's own — an agent with 5 skills plus 2 selected here gives the stage
> 7. MCP exclusions go in `harnessConfigOverrides.excludedMcpServerIds` (they
> used to be written into `excludedTools`, which excluded nothing). See
> [feature-agents.md](./feature-agents.md).

---

## 1. Entity & DB shape

`stage_definitions` table:

```
id                            text PK
workflowDefinitionId          FK
name                          text
description?                  text
templateId?                   text                  (cloned-from id)
order                         int                   (display + tie-break for parallel layers)
prompts                       JSON PromptDefinition[]
harnessConfigOverrides        JSON Partial<HarnessConfig>
hooks                         JSON HookDefinition[]
retryPolicy                   JSON { maxRetries, backoffMs, backoffMultiplier }
timeoutMs?                    int
condition                     JSON StageCondition
contextFilter?                enum 'full' | 'summary-only' | 'none' | 'structured'
contextSources?               JSON string[]                  (explicit predecessor list)
resultValidation?             JSON ResultValidationRule[]
outputFormat?                 enum 'text' | 'json'
outputSchema?                 JSON                            (JSON schema for outputFormat=json)
iterationConfig?              JSON                            (schema present, runtime deferred)
createdAt
```

---

## 2. Properties panel — Properties tab

Surfaced in [apps/web/src/components/workflow/StagePropertiesPanel.tsx](../../apps/web/src/components/workflow/StagePropertiesPanel.tsx).

### 2.1 Basic

- **Name** — `name`, free text.
- **Description** — `description`, free text.

### 2.2 Model & Template

- **Template** — `templateId`, the stage template this was cloned from (read-only display).
- **Model Override** — `harnessConfigOverrides.model`. Dropdown populated from `harness.getModels()`. `"Workflow default"` = inherit from `workflow.harnessConfig.model`. Provider-specific.
- **Reasoning Effort** — `harnessConfigOverrides.reasoningEffort`. Five options: `Default | Low | Medium | High | Extra High`. Maps to SDK `reasoningEffort` field. Default = inherit.

### 2.3 Prompts & Context

`prompts: PromptDefinition[]`:

```typescript
type PromptDefinition = {
  label: string;                        // shown in UI
  text: string;                         // prompt body with {{vars}}
  source: 'inline' | 'file' | 'agent';  // file → load from project prompts; agent → use agent's default prompt
  filePath?: string;                    // when source='file'
  wait?: boolean;                       // if true, wait for assistant idle before next prompt in same stage
  isFollowUp?: boolean;                 // sets isFollowUp metadata for multi-turn stages
};
```

A stage can have multiple prompts that are sent sequentially in the **same session** unless `sessionMode = 'per-stage'`. The first prompt always carries the system message + tools/skills; later prompts are plain follow-ups.

**Multi-prompt edge cases:**
- `wait: true` → wait for `harness.idle` before issuing the next prompt.
- `wait: false` (default) → fire next prompt as soon as `message_complete` event.
- If `outputFormat = 'json'`, the JSON shape instruction is appended only to the **first** prompt (verified in session 49 fix). Resume after pause respects the same rule (`i === startStep`, not `i === 0`).

### 2.4 Skills (per-stage)

`SkillSelector.tsx` writes `harnessConfigOverrides.disabledSkills: string[]`. Project skills + system skills are merged into the available list. Toggle to include/exclude. All enabled by default.

### 2.5 MCP Servers

`McpServerSelector.tsx` toggles between system + project MCP servers. Currently the disabled list is *stored* in `harnessConfigOverrides.excludedTools` as a workaround until a dedicated `excludedMcpServers` field is added (tracked TODO).

System MCP servers shipped (8 in [templates/system/mcp-servers.json](../../templates/system/mcp-servers.json)):

- GitHub
- Filesystem
- PostgreSQL
- SQLite
- Slack
- Web Search (Brave)
- Puppeteer
- AWS Knowledge Base

### 2.6 Custom Agent

The stage binds a first-class agent with `agentRef` (a portable `scope:slug` ref, e.g. `project:reviewer`). The agent brings its instructions, skills, MCP servers and tool policy; `harnessConfigOverrides.agentOverrides` adds a per-stage delta.

### 2.7 Variables

Stages have no variables of their own: a stage's prompts see the run's variables (the definition's declared variables plus the values the run was started with) and any per-stage runtime override.

---

## 3. Properties panel — Execution tab

### 3.1 Run Condition

`condition: StageCondition`:

```typescript
type StageCondition = {
  type: 'always' | 'on_success' | 'on_failure' | 'expression';
  expression?: string;        // safe boolean expression evaluator (see architecture.md §domain/dag)
};
```

| Type | Behavior |
|---|---|
| `always` | runs regardless of predecessor status |
| `on_success` | runs only if all in-edge predecessors completed successfully |
| `on_failure` | runs only if at least one in-edge predecessor failed |
| `expression` | evaluates `expression` against `{ parentStatus, variables }` context |

Expression syntax (see [packages/core/src/domain/dag/ConditionEvaluator.ts](../../packages/core/src/domain/dag/ConditionEvaluator.ts)):
- Booleans: `&&` / `AND`, `||` / `OR`, `!` / `NOT`
- Comparisons: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Identifiers: `status`, `parentStatus`, `variables.path.to.key`
- Literals: numbers, `true`, `false`, single- or double-quoted strings
- Parentheses for grouping

Example: `parentStatus == "completed" && variables.priority > 3`

### 3.2 Timeout (seconds)

`timeoutMs: int` — applies to each prompt turn within the stage individually, not the stage as a whole (a multi-prompt stage's total wall-clock time is the sum across its turns). When a turn's deadline elapses, the in-flight harness call is actually **aborted** (via `AbortSignal`, not merely abandoned to keep running against the stage's working directory) and the turn fails with `HarnessTimeoutError`; the stage's normal retry policy (§5) then applies exactly as for any other error. An explicit value is floored at 1s (`MIN_TIMEOUT_MS`); **default if unset: 300s (5min)** — some workflows use much higher (e.g., 1800s for code generation).

A `queued`/`running` stage also beats `stage_runs.heartbeat_at` roughly every 10s for as long as it is doing work. If that beat goes stale (the executor is hung or its process is gone), the run's reconciler fails the stage on the stage's behalf — see [feature-workflow-runs.md](./feature-workflow-runs.md) §"Stage liveness".

### 3.3 Context from Predecessors

`contextFilter`:

| Value | Inject into prompt |
|---|---|
| `full` | the entire assistant response of each predecessor stage |
| `summary-only` (default) | only the predecessor's `stage_runs.summary` (~200-400 chars) |
| `none` | nothing |
| `structured` | parsed `outputData` (only meaningful when predecessor had `outputFormat: 'json'`) |

`contextSources?: string[]` — explicit list of predecessor stage *names* to include. If omitted, includes all DAG predecessors (transitively only when convergence requires it).

Injection format (prepended as a synthesized user message before the stage's first prompt):

```
The following stages have already been completed. Use their output as context for this stage:

### <Stage Name 1>
<content per contextFilter>

### <Stage Name 2>
<content per contextFilter>
```

### 3.4 Retry Policy

`retryPolicy: { maxRetries, backoffMs, backoffMultiplier }`. Applies to **both** execution errors *and* `resultValidation` failures.

Backoff is computed as `backoffMs * (backoffMultiplier ^ retryCount)`. Default: `{ maxRetries: 1, backoffMs: 3000, backoffMultiplier: 1 }`.

Two retry strategies are chosen automatically by `WorkflowRunService.retryStageAfterValidation`:

| Strategy | When |
|---|---|
| **In-session retry** | for the first `maxRetries - 1` attempts. Sends a follow-up prompt in the same harness session with `__validationFeedback` variable injected. Faster, preserves context, but requires the session to still be alive. |
| **Full restart** | for the final attempt. Releases the session, allocates a fresh conversation, re-executes *all* prompts in the stage with `__validationFeedback` + `__validationRetryAttempt` variables. |

> **Edge case:** single-prompt stages cannot in-session retry because the conversation has already closed; they always full-restart.

### 3.5 Result Validation

`resultValidation: ResultValidationRule[]`:

```typescript
type ResultValidationRule =
  | { type: 'contains',      value: string,  message?: string }
  | { type: 'not_contains',  value: string,  message?: string }
  | { type: 'min_length',    value: number,  message?: string }
  | { type: 'max_length',    value: number,  message?: string }
  | { type: 'regex',         value: string,  message?: string, flags?: string }
  | { type: 'custom_script', value: string,  message?: string }   // shell script path
  | { type: 'json_schema',   value: object,  message?: string }   // for outputFormat=json
  | { type: 'llm_validation',value: string,  message?: string };  // free-form rubric to LLM
```

Evaluated by `ResultValidator.validate(content, rules)`. First failing rule triggers stage retry via `retryStageAfterValidation`. After `maxRetries` exhausted, stage transitions to `failed`.

### 3.6 Output Format & Schema

- `outputFormat = 'text'` (default) — assistant produces free text.
- `outputFormat = 'json'` — `StageExecutionService` appends JSON-mode instructions to the **first** prompt. `outputSchema` (JSON Schema draft-2020) is validated against the parsed result.

If a JSON parse fails, `ResultValidator` returns failure → stage retries with `__validationFeedback`.

Successful JSON output is persisted to `RunScratchpad.entries[stageName].outputData` for downstream stages with `contextFilter: 'structured'` to consume.

### 3.7 Hooks (stage-level)

`hooks: HookDefinition[]` — see [feature-hooks.md](./feature-hooks.md).

Stage-scope phases:
- `pre_run` — before the first prompt of the stage (can block; returns `{ variables?, contextMessages?, attachments?, abort?, abortReason? }`).
- `post_run` — after the stage completes (fire-and-forget; failures logged).
- `pre_prompt` / `post_prompt` — around each individual prompt within the stage.
- `on_error` — when the stage fails.

Harness-scope phases (`pre_tool_use`, `post_tool_use`, `on_message`, `on_reasoning`, `on_session_start`, `on_session_idle`, `on_session_error`, `on_client_*`, `on_permission`) can also be configured at the stage level via `HookBridge` (HKS-01).

---

## 4. Stage execution pipeline

[StageExecutionService.executeStage](../../packages/core/src/services/StageExecutionService.ts):

```
1.  Read stageRun + stageDef.
2.  Allocate session via SessionAllocator (mode = workflow.sessionMode).
3.  resolveConfig() → workflowConfig ⊕ stageOverrides ⊕ runtimeOverrides.
4.  Gather predecessor summaries (gatherPredecessorSummaries from DAGScheduler).
5.  Apply contextFilter → build context message (if non-'none').
6.  Run pre_run hooks (blocking; abort → mark stage cancelled).
7.  For each PromptDefinition (starting from startStep on resume):
       7.1  Interpolate {{vars}} into prompt.text.
       7.2  Append JSON instructions on first prompt if outputFormat='json'.
       7.3  Save user message to chat_messages.
       7.4  Run pre_prompt hooks.
       7.5  harness.sendPromptAndWait(sessionId, prompt, attachments, abortSignal).
       7.6  Run post_prompt hooks.
       7.7  Persist assistant message + extract artifacts.
       7.8  Update stageRun.currentStep++.
8.  Validate via ResultValidator(content, resultValidation).
       8.1  If any rule fails → retryStageAfterValidation(reason).
9.  Generate summary (LLM auto-summary or extract from JSON keys).
10. Save stage_runs.summary + .outputData.
11. Update stage_runs.status = 'completed' + completedAt.
12. Run post_run hooks (fire-and-forget).
13. Emit stage_run.completed event → DAGScheduler picks up.
```

If any prompt throws or `abort` fires:
- Run `on_error` hooks.
- Update `stage_runs.status = 'failed'` + `.error`.
- Emit `stage_run.failed`.

---

## 5. Stage CRUD APIs

### Create
`POST /api/workflow-definitions/:defId/stages`

Body (`CreateStageSchema`):
```typescript
{
  name: string;
  description?: string;
  order?: number;
  prompts?: PromptDefinition[];
  harnessConfigOverrides?: Partial<HarnessConfig>;
  variables?: Record<string, unknown>;
  hooks?: HookDefinition[];
  retryPolicy?: { maxRetries; backoffMs; backoffMultiplier };
  timeoutMs?: number;
  condition?: StageCondition;
  contextFilter?: 'full' | 'summary-only' | 'none' | 'structured';
  contextSources?: string[];
  agentRef?: string;
  resultValidation?: ResultValidationRule[];
  outputFormat?: 'text' | 'json';
  outputSchema?: object;
}
```

### Update
`PATCH /api/workflow-definitions/:defId/stages/:stageId` — partial body, same fields.

### Delete
`DELETE /api/workflow-definitions/:defId/stages/:stageId` — fails if the stage is referenced by an edge with no replacement; cascading removal of incident edges performed in-tx.

---

## 6. CLI

```powershell
generatorai workflow stage add <defId> <name> \
  --prompt "Generate code for {{spec}}" \
  --model claude-sonnet-4.6 \
  --timeout 60000 \
  --retries 2

generatorai workflow stage update <defId> <stageId> --name "Renamed" --prompt "..."
generatorai workflow stage delete <defId> <stageId>
```

`--prompt` adds a single inline prompt. For multi-prompt or complex stages, use `workflow import-json`.

---

## 7. Edge cases & gotchas

1. **`agentRef` without project link** — the agent picker filters by the workflow's `projectId`. A `null` project lists only global and system agents.
2. **Prompts are inline text.** There is no file-reference prompt; a `.workflow.mjs` builder script can read a file at authoring time and pass its text.
3. **`outputFormat = 'json'` but `outputSchema` missing** — JSON parse is still attempted; on parse failure the validation step fails. Always pair them.
4. **`contextFilter = 'structured'` but predecessor had `outputFormat: 'text'`** — falls back to `summary-only` automatically.
5. **`condition.type = 'expression'` referencing variables.foo.bar** — dotted path traversal. Missing keys resolve to `undefined`, which compares to anything as `false` (except `!=`).
6. **`hooks` runtime errors** — see `failurePolicy` in [feature-hooks.md](./feature-hooks.md). `abort` fails the stage; `skip` logs and continues; `continue` ignores.
7. **`retryPolicy.maxRetries = 0`** — no retries; first failure terminal.
8. **`iterationConfig` runtime** — currently deferred. Use Automation `input mode: loop` / `batch` for iteration. UI may surface the field but it has no executor.
9. **Stage with no predecessors** — root. Started immediately at run start.
10. **Stage with `condition = on_failure` but only `on_success` in-edges** — never runs; cascades to `skipped` via `skipUnreachableStages`.
11. **Multiple in-edges convergence** — stage doesn't run until **all** predecessor stages are terminal (per `DAGScheduler`).
12. **`sessionMode = 'single'` but stage requires its own session** — currently impossible to express; `sessionMode = 'auto'` is the workaround. Future: per-stage `sessionMode` override.
