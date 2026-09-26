# Feature: Stages

A stage is one node of a workflow graph: an `AgentStage` in the v2 document
(`@generatorai/workflow-spec`, [stage.ts](../../packages/workflow-spec/src/schemas/stage.ts)).
Stages are saved with the rest of the graph (see [feature-workflows.md](./feature-workflows.md)
§2) — there are no per-stage create/update/delete endpoints. Every field with its type and default
is in the generated [FIELDS.md](../../docs/workflow-overhaul/generated/FIELDS.md).

---

## 1. Shape

```jsonc
{
  "kind": "agent",
  "key": "fix",                       // ^[a-z][a-z0-9_]{0,47}$, unique; edges and expressions use it
  "name": "Fix",                      // display text
  "description": "…",
  "position": { "x": 320, "y": 80 },  // builder canvas
  "prompts": [{ "label": "Fix", "text": "Fix {{ticket}} using the review." }],
  "guard": "variables.severity != 'low'",
  "session": { "model": "…", "defaultAgentMode": "auto", "agentRef": "project:fixer" },
  "context": { "from": ["review"], "mode": "output" },
  "output": { "format": "text", "instructions": "…", "rules": [{ "type": "contains", "value": "DONE" }] },
  "retry": { "maxAttempts": 3, "initialDelayMs": 2000, "backoffMultiplier": 2 },
  "timeouts": { "attemptMs": 600000 },
  "approval": { "prompt": "Ship it?", "allowChanges": true, "maxRounds": 3 },
  "hooks": []
}
```

Stored as one `stage_definitions` row per stage (`key`, `name`, `ordinal`, `position_x/y`, and the
stage JSON in `spec`). Stage runs carry `stage_key` and read the stage from the run's pinned
definition version, never from the live definition.

---

## 2. Fields

### Prompts
`prompts[]` are sent in order in the stage's conversation. `text` is a template: `{{variables.x}}`,
bare `{{x}}` for a declared variable, `{{stages.<key>.output.y}}`, `{{run.id}}`,
`{{run.codebases.<alias>.path}}`. An undeclared bare name is a save-time error.

### Guard
`guard` is an Expression v2 condition evaluated when the stage becomes ready; false skips the
stage. It can read `variables`, `stages.<key>`, and `run`. Conditions on the parent's outcome
belong on the incoming edge (`on` plus optional `when` with `parent.status`). Expressions are
type-checked at save; see [feature-workflows.md](./feature-workflows.md) §4 for the grammar.

### Session
`session` is a partial `SessionSpec` merged over `workflow.session`: provider (`harnessType`),
`model`, `reasoningEffort`, `maxTurns`, `permissionMode`, `defaultAgentMode` (`auto` or `plan`),
the agent binding `agentRef` + `agentOverrides` (skills and MCP servers selected on the stage
union with the agent's own), `tools`, `mcp`, `skills`, `systemPromptAppend`, `browser`, and so on.
See [feature-agents.md](./feature-agents.md).

### Context
`context.mode` chooses what upstream results the stage receives: `summary` (default, each
source's summary), `output` (the full output text), `structured` (summary plus JSON output),
`none`. `context.from` lists source stage keys; omitted means the direct predecessors. On the
current engine context is delivered as a separate turn before the first prompt.

### Output
- `output.format`: `text` or `json`; with `json`, `schema` (JSON Schema) describes the value.
- `output.instructions`: appended to the first prompt as the expected-output contract.
- `output.rules[]`: hard checks run before the stage completes. Rule types: `contains`,
  `not_contains`, `min_length`, `max_length`, `regex` (`pattern` + `flags` of `i`/`m`/`s`, run on a
  linear-time engine), `json_schema` (`schema`, validated with Ajv 2020), and `custom_script`
  (`command` + literal `args`, templated `env`; the output is in `STAGE_OUTPUT`; exit 0 passes;
  adding one needs `admin:settings`). A failed rule retries the stage in its session while the
  `retry` budget lasts (without `retry`, the first violation fails the stage).

### Retry and timeouts
`retry.maxAttempts` counts the first attempt (`maxAttempts: 3` = two retries), with
`initialDelayMs` and `backoffMultiplier`. With no `retry`, a stage whose turn
fails (provider error, timeout) is retried once after 3 s. `timeouts.attemptMs` bounds each prompt turn.

### Approval
`approval` parks the finished stage in `awaiting_input` for a reviewer: approve, reject, or
request changes (another turn). `prompt` is what the reviewer is asked.

### Hooks
`hooks[]` run at stage phases (`pre_run`, `post_run`, `pre_prompt`, `post_prompt`, `on_error`,
`on_cancel`, tool and session events). Types: `script` (`command` + literal `args`, templated
values only through `env`), `http`, and `function` (a registered handler). Script hooks need
`admin:settings` to add or change.

---

## 3. Execution on the current engine

[StageExecutionService](../../packages/core/src/services/StageExecutionService.ts):

1. Read the stage from the run's pinned version (`RunDefinitionReader`, by `stageKey`).
2. Allocate a fresh session for the stage (`sessionReuse: 'fresh'`).
3. Resolve the session config: workflow `session` ⊕ stage `session` ⊕ run overrides.
4. Send the context turn (unless `context.mode` is `none`).
5. Run `pre_run` hooks; then for each prompt: render the template, send it, run `pre_prompt` /
   `post_prompt` hooks, persist the reply.
6. Validate `output.rules`; a failure retries in the session or fails the stage.
7. Summarise, store `summary` / `outputText` / `outputData`, mark the stage completed (or park it
   for approval), run `post_run` hooks, and let the DAG scheduler launch successors.

Fields the engine cannot run yet (`join` other than `all`, `repair`, `onExhausted: 'pause'`,
`sessionReuse: 'continue'`, `sessionGroup`, `budget`, `timeouts.queueMs|idleMs|totalMs`,
non-`auto` `output.extraction`, `compensate`, `session.provider`, MCP `secretref:` values, and
non-default `retry.maxDelayMs|jitter|retryOn|mode|restoreCheckpointOnRestart` or
`approval.allowChanges|maxRounds`) are rejected at save with `engine-unsupported`.

---

## 4. Removed v1 stage fields

| v1 | v2 |
|---|---|
| `order` | graph order; `position` for the canvas |
| `condition` | `guard`, or an edge `when` |
| `harnessConfigOverrides`, `agentRef`, `agentMode` | `session` (`agentRef`, `defaultAgentMode`) |
| `contextFilter` (`full`/`summary-only`/`structured`/`none`), `contextSources` (names) | `context.mode` (`output`/`summary`/`structured`/`none`), `context.from` (keys) |
| `resultValidation`, `expectedOutput`, `outputFormat`, `outputSchema` | `output.rules`, `output.instructions`, `output.format`, `output.schema` |
| `retryPolicy { maxRetries, backoffMs, backoffMultiplier }` | `retry { maxAttempts = maxRetries + 1, initialDelayMs, backoffMultiplier }` |
| `timeoutMs` | `timeouts.attemptMs` |
| `approvalRequired` | `approval: {}` |
| stage `variables`, `templateId`, `iterationConfig`, prompt `source`/`filePath`/`attachments` | removed |

---

## 5. CLI

```bash
generatorai stage list <wf>
generatorai stage add <wf> --name "Fix" [--key fix] --prompt "…" [--guard expr] [--retry-attempts 3] \
  [--timeout-ms 600000] [--output-format json] [--context-from review --context-mode output] \
  [--agent project:fixer] [--model m] [--approval on]
generatorai stage update <wf> <stage> …
generatorai stage remove <wf> <stage>      # also drops its edges and context.from references
generatorai stage hook list|add|remove <wf> <stage> …
```

Every edit reads the definition, changes the graph, validates it locally and saves it with the
revision it read; on a 409 it re-reads and retries once.
