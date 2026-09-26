# Feature: Hooks

> Hooks are user-defined extension points that fire at well-known phases of workflow / stage / harness lifecycle. Three types (script / http / function), 22+ phases, three failure policies.

---

## 1. Concepts

A `HookDefinition`:

```typescript
interface HookDefinition {
  id: string;
  name: string;
  phase: HookPhase;
  type: 'script' | 'http' | 'function';
  priority: number;                            // lower = runs first
  enabled: boolean;
  failurePolicy: 'abort' | 'skip' | 'continue';
  timeoutMs: number;                           // default 30_000
  retries: number;                             // default 0
  config: ScriptHookConfig | HttpHookConfig | FunctionHookConfig;
}
```

Hooks fire **in priority order** within a phase. Failure policy:

| Policy | Behavior |
|---|---|
| `abort` | Hook failure stops the workflow/stage immediately (`abort=true` in `HookResult`). |
| `skip` | Logs the failure, skips remaining hooks of this phase, continues stage/run. |
| `continue` | Logs the failure, continues to the next hook of this phase. |

Return shape (`HookResult`) — hooks can mutate downstream behavior:

```typescript
{
  variables?: Record<string, unknown>;    // merged into run variables
  contextMessages?: Array<{ content: string, metadata?: unknown }>;  // injected before next prompt
  attachments?: Array<{ filename: string, content: string | Buffer }>;  // written to workspace
  abort?: boolean;                        // forces stage/run abort
  abortReason?: string;
}
```

---

## 2. Hook phases (22)

### Workflow lifecycle (4)
- `on_run_start` — after run state becomes `running`, before any stage executes.
- `on_run_complete` — after all stages terminal and run state is `completed`.
- `on_run_failed` — when run transitions to `failed`.
- `on_run_cancelled` — when run transitions to `cancelled`.

### Git / SCM (4)
- `pre_clone`, `post_clone` — around `WorktreeService.createRunWorktrees` per codebase.
- `pre_commit`, `post_commit` — around `workspace commit`.

### Workflow orchestration (5)
- `on_pr_created` — after `GitManager.createPullRequest`.
- `on_preprocessing_complete` — after `WorkflowPreprocessor` setup.
- `on_postprocessing_start` — before postprocessing pass.
- `on_all_stages_scheduled` — after `DAGScheduler.getRootStages` triggered initial dispatch.
- `on_stage_completed` / `on_stage_failed` / `on_parallel_join` — fired between stages.

### Stage lifecycle (3)
- `pre_run` — before the first prompt of a stage. **Blocking + can abort.**
- `post_run` — after the stage completes. **Fire-and-forget** (failure does not affect stage status).

### Prompt lifecycle (2)
- `pre_prompt` / `post_prompt` — around each prompt within a stage (multi-prompt aware).

### Harness lifecycle (5 — used via `HookBridge` for synchronous intercepts)
- `pre_tool_use` — **can deny** a tool call by returning `{ permissionDecision: 'deny' }`.
- `post_tool_use` — observes/modifies tool result.
- `on_message` — fires for each `harness.message_complete`.
- `on_reasoning` — fires for each `harness.reasoning_complete`.
- `on_session_start`, `on_session_idle`, `on_session_error` — session lifecycle.

### Client lifecycle (4)
- `on_client_start`, `on_client_stop`, `on_client_error`, `on_client_restart` — outer harness client (not per-session).

### Security (1)
- `on_permission` — emitted alongside permission requests; informational.

### Stage errors (1)
- `on_error` — fired when a stage fails (after its `retry` attempts are exhausted).

---

## 3. Hook types

### 3.1 Script hook

```typescript
type ScriptHookConfig = {
  type: 'script';
  command: string;             // allowlist: node|python|bash|git|echo|pwsh|pip|pnpm|npm
  args?: string[];
  cwd?: string;                // default: workspace.rootPath
  env?: Record<string, string>;
}
```

Executed by `HookExecutor` via `IScriptRunner` (sandboxed if `SANDBOX_ENABLED=true`).

Input to the script via env:
- `GENERATORAI_HOOK_PHASE`
- `GENERATORAI_HOOK_CTX` — JSON of the hook context: `{ runId, stageRunId?, sessionId?, variables, predecessorSummaries, … }`

Output:
- stdout — should contain a JSON `HookResult` (parsed automatically); if not, treated as `{}`.
- exit code 0 = success, non-zero = failure (counts against `retries`).

> **Security:** non-allowlisted commands throw `ScriptExecutionError` before spawning. `cmd.exe` is not allowed.

### 3.2 HTTP hook

```typescript
type HttpHookConfig = {
  type: 'http';
  url: string;                            // supports {{variables}} interpolation
  method: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  bodyTemplate?: string;                  // mustache-interpolated body
  responsePath?: string;                  // dotted path → variables map
}
```

`HookExecutor` uses `FetchHttpClient` with `AbortSignal` from the timeout. Response body parsed as JSON → wrapped into `HookResult.variables` at `responsePath` or `result`.

### 3.3 Function hook

```typescript
type FunctionHookConfig = {
  type: 'function';
  handlerName?: string;                   // registered name (handlerName or modulePath is required)
  modulePath?: string;                    // optional subprocess module loader
  args?: Record<string, unknown>;
}
```

`HookExecutor` first looks up the name in `functionHandlerRegistry`. If not found and `modulePath` is set, falls back to a subprocess module loader.

**Built-in handlers** wired in [apps/server/src/composition-root.ts](../../apps/server/src/composition-root.ts):
- `enrichContext` — returns enriched variables from runtime context.
- `injectRequirements` — injects project requirements as a context message.
- `addAttachment` — writes an attachment file into the workspace.
- `logCompletion` — logs workflow completion info.

Register your own:

```typescript
ai.services.hookExecutor.registerFunctionHandler('myHook', async (ctx) => {
  // ctx has runId, stageRunId?, variables, … (no SDK types)
  return {
    variables: { computed: 'value' },
    contextMessages: [{ content: 'Note: …' }],
  };
});
```

---

## 4. HookBridge (HKS-01)

For *synchronous* hooks called from inside the harness event loop, there's a separate path: the **HookBridge** ([packages/core/src/domain/ports/IHookBridge.ts](../../packages/core/src/domain/ports/IHookBridge.ts)).

```typescript
interface HookBridge {
  onPreToolUse?(input, invocation): Promise<PreToolUseHookOutput | void>;
  onPostToolUse?(input, invocation): Promise<PostToolUseHookOutput | void>;
  onUserPromptSubmitted?(input, invocation): Promise<UserPromptSubmittedHookOutput | void>;
  onSessionStart?(input, invocation): Promise<SessionStartHookOutput | void>;
}
```

These are passed into `harness.createConversation({ hooks: bridge })`. Each provider adapts them to its native SDK hooks (Copilot SDK's `SessionHooks`, Claude Agent SDK's equivalent).

The most powerful is `onPreToolUse` — return `{ decision: 'allow' | 'deny' | 'ask' }` to enforce permissions. The `HitlService` uses this to implement permission modes.

---

## 5. Hook execution flow

`HookExecutor.executePhase(phase, ctx)`:

```
1. Read hooks for this phase, sorted by priority asc.
2. For each enabled hook:
       2.1  Create AbortController.
       2.2  Start timer (ORC-02) → controller.abort() after hook.timeoutMs.
       2.3  Run hook:
                - script: spawn subprocess with signal propagation
                - http:   fetch with signal
                - function: invoke handler (sync or async)
       2.4  On timeout: kill subprocess / close socket. Treat as failure.
       2.5  On error and retries > 0: backoff (60s max) and retry.
       2.6  On final failure: apply failurePolicy.
            abort: throw HookError; phase aborts; stage/run aborts.
            skip:  log + skip remaining; phase succeeds.
            continue: log + next hook.
       2.7  Emit hook.started / hook.completed / hook.failed / hook.skipped events.
3. Merge all HookResults into the accumulated result.
4. Return accumulated HookResult.
```

Listener leak detection (ORC-05): tracked separately per session inside the harness adapter.

---

## 6. Configuration

### Inside a workflow definition

Workflow hooks live in `workflow.hooks` of the v2 document:

```json
{
  "formatVersion": 2,
  "workflow": {
    "name": "…",
    "hooks": [
      {
        "id": "h1",
        "name": "validate-input",
        "phase": "on_run_start",
        "type": "script",
        "priority": 0,
        "enabled": true,
        "failurePolicy": "abort",
        "timeoutMs": 30000,
        "retries": 1,
        "config": {
          "type": "script",
          "command": "node",
          "args": ["./scripts/validate-input.mjs"],
          "env": { "STRICT": "true" }
        }
      }
    ]
  },
  "stages": [ … ],
  "edges": [ … ]
}
```

`command` and `args` are literals; templated values reach a script only through `env`. Adding or changing a script hook needs the `admin:settings` scope.

### Inside a stage definition

Same shape in the stage's `hooks[]`, but accepted phases are stage-scope (`pre_run`, `post_run`, `pre_prompt`, `post_prompt`, `on_error`, `on_cancel`) plus the harness-scope phases routed via HookBridge.

There is no side-car hooks file: `hooksFile` was removed; hooks live only in `workflow.hooks` and each stage's `hooks`.

### Programmatic Workflow Script (PWS)

With the builder from `@generatorai/workflow-spec/builders`, `.hook()` takes either a full hook definition or a phase plus an inline function (registered by the script loader as a `function` hook with a generated `handlerName`):

```js
import { workflow } from '@generatorai/workflow-spec/builders';

export default workflow('Summarize')
  .variable('topic', { type: 'string', label: 'Topic', required: true })
  .hook({
    id: 'wf-start',
    name: 'startup',
    phase: 'on_run_start',
    type: 'script',
    priority: 0,
    enabled: true,
    failurePolicy: 'continue',
    timeoutMs: 5000,
    retries: 0,
    config: { type: 'script', command: 'node', args: ['-e', 'console.log("hi")'] },
  })
  .hook('on_run_complete', async (ctx) => ({ proceed: true, message: `Run ${ctx.runId} complete` }))

  // Per-stage hooks
  .stage('summarize', (s) => s
    .name('Summarize')
    .prompt('Summarize {{topic}}')
    .hook({
      id: 'pre',
      name: 'inject requirements',
      phase: 'pre_run',
      type: 'function',
      config: { type: 'function', handlerName: 'injectRequirements' },
      priority: 0,
      enabled: true,
      failurePolicy: 'continue',
      timeoutMs: 5000,
      retries: 0,
    })
    .hook('post_run', async (ctx) => ({ proceed: true })));
```

A `function` hook with a `handlerName` must have that handler registered with the `HookExecutor` (`registerFunctionHandler`) before it fires.

---

## 7. APIs

```
GET  /api/hooks/phases                       → { totalPhases: 22, categories: { workflow:[…], git:[…], stage:[…], tool:[…], session:[…], client:[…], permission:[…] } }
POST /api/sessions/:id/hooks/test            → fire a hook with a custom payload (dry-run)
```

Workflow definition routes carry hooks in the JSON body (CRUD via the definition endpoints).

---

## 8. CLI

```powershell
generatorai hook phases                      # lists all 22 with category + description
generatorai hook test <sessionId> <phase> [--payload '{"foo":"bar"}']
```

> The `hook phases` CLI previously crashed because the API returns `{ totalPhases, categories: {...} }` (an object) not an array. Fixed in session 66 by flattening `Object.values(response.categories).flat()` before tabulating.

---

## 9. UI

Two locations in the web app:

1. **Workflow Settings → Hooks tab** (`HooksTab.tsx`) — workflow-scope hooks. Phase dropdown has 15 options.
2. **Stage Properties → Execution → Hooks** (inline editor in `StagePropertiesPanel.tsx`) — stage-scope hooks. Add/edit/delete with phase + type + config + failure policy.

---

## 10. Edge cases & gotchas

1. **Priority ties** — equal-priority hooks run in insertion order. Sorting is stable.
2. **`abort` policy on `post_run`** — `post_run` is fire-and-forget; setting `abort` policy is effectively `skip`. The stage has already completed.
3. **Hook timeout vs SDK call timeout** — independent. A 10s `pre_tool_use` hook can hold up the entire `sendPromptAndWait` for those 10s.
4. **`script` hook killed on timeout** — SIGKILL on POSIX, `taskkill /F` on Windows. Cleanup of subprocess children is best-effort.
5. **`http` hook with self-signed cert** — node-fetch respects `NODE_TLS_REJECT_UNAUTHORIZED=0` env. Be careful.
6. **Function handler not registered** — throws `HookError("Unknown handler")` at execute time. `failurePolicy` determines if run continues. Always register handlers in composition root before they fire.
7. **`HookBridge.onPreToolUse` returning `'deny'`** — the harness sends a synthetic `tool_complete` event with `success: false` and an "Action denied" payload. UI shows the deny reason.
8. **Concurrent hook execution** — hooks within a phase run sequentially; phases on parallel stages can run concurrently. The `EventBus` per-session serialization preserves event ordering.
9. **Hook results merging** — later hooks' `variables` overwrite earlier ones on key collision. `contextMessages` and `attachments` arrays are concatenated.
10. **Hook events suppressed on denied tool calls** — `HookInterceptor` suppresses matching `tool_complete` events to avoid double-counting (ORC-06).
11. **Backoff cap** — `retries` use exponential backoff capped at 60s.
12. **`script` hook stdout > 1MB** — truncated and the truncation flag is set in the result. Use stderr for logs to avoid this.
13. **Stage hooks on a `single`-session workflow** — same session reused across stages; `pre_run`/`post_run` still fire per-stage. `pre_tool_use`/`post_tool_use` fire per-tool within whatever stage is active.
14. **Workflow hook + stage hook on the same phase** — both fire. Workflow hook runs first; its result merges into the context before the stage hook runs.
