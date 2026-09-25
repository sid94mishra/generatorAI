# Feature: Workflow Definitions

> A **WorkflowDefinition** is a reusable, design-time DAG of **StageDefinition**s connected by **StageEdge**s. This file covers everything about *defining* workflows. For *executing* them see [feature-workflow-runs.md](./feature-workflow-runs.md). For per-stage configuration depth, see [feature-stages.md](./feature-stages.md).

---

## 1. Entity & DB shape

`workflow_definitions` table:

```
id                   text PK
name                 text                     (unique not enforced)
description?         text
version              int (default 1)
sessionMode          enum 'single' | 'per-stage' | 'auto'
harnessConfig        JSON HarnessConfig       (template defaults — model, reasoningEffort, mcpServers, …)
variables            JSON VariableDefinition[]
hooks                JSON HookDefinition[]    (workflow-scope phases)
hooksFile?           JSON                     (separate .hooks.json reference)
orchestratorConfig?  JSON                     (system templates + preprocessing config)
tags                 JSON string[]
projectId?           FK → projects.id   (null = global)
useWorktree          boolean (default true when projectId set)
createdAt, updatedAt
```

Plus:

`stage_definitions` table — one row per stage (see [feature-stages.md](./feature-stages.md)).
`stage_edges` table — one row per edge:

```
id                       text PK
workflowDefinitionId     FK
fromStageId              FK → stage_definitions.id
toStageId                FK → stage_definitions.id
edgeType                 enum 'on_success' | 'on_failure' | 'on_completion' | 'always'
```

---

## 2. Lifecycle operations

### 2.1 Create

API: `POST /api/workflow-definitions`  
Body: `CreateWorkflowDefinitionSchema`:

```typescript
{
  name: string;
  description?: string;
  sessionMode?: 'single' | 'per-stage' | 'auto';   // default 'auto'
  harnessConfig?: Partial<HarnessConfig>;
  variables?: VariableDefinition[];
  hooks?: HookDefinition[];
  tags?: string[];
  scope?: 'global' | 'project';                    // default 'global'
  projectId?: string;
  useWorktree?: boolean;
  orchestratorConfig?: OrchestratorConfig;
  // stages/edges can be provided inline or added via subsequent calls
  stages?: CreateStageParams[];
  edges?: CreateEdgeParams[];
}
```

Server-side flow ([WorkflowDefinitionService.createDefinition](../../packages/core/src/services/WorkflowDefinitionService.ts)):

1. Validate body via Zod schema.
2. Generate UUID.
3. Insert `workflow_definitions` row.
4. If `stages` provided: insert each `stage_definitions` row (order = array index unless explicit).
5. If `edges` provided: insert each `stage_edges` row.
6. If any DAG validation issues, transaction rolls back and `ValidationError` is thrown.
7. Return `WorkflowDefinitionWithStages` (def + stages + edges).

### 2.2 Read

```
GET /api/workflow-definitions
  Query: ?projectId=<id> | ?scope=global|project | ?tags=tag1,tag2 | ?search=text
GET /api/workflow-definitions/:id     → WorkflowDefinitionWithStages (def + stages + edges)
GET /api/workflow-definitions/:id/export → JSON download (re-importable)
```

### 2.3 Update

`PATCH /api/workflow-definitions/:id` accepts a partial body. Updating any field bumps `version`. The DAG cache is invalidated by hash — adding/removing stages forces re-computation on next run.

Stage operations:

```
POST   /api/workflow-definitions/:id/stages
PATCH  /api/workflow-definitions/:id/stages/:stageId
DELETE /api/workflow-definitions/:id/stages/:stageId
```

Edge operations:

```
POST   /api/workflow-definitions/:id/edges
DELETE /api/workflow-definitions/:id/edges/:edgeId
```

> **Edge case — delete with active runs:** `DELETE /api/workflow-definitions/:id` returns `400 ValidationError("Delete the runs first")` when `workflow_runs` rows reference the definition. Cancel/delete the runs first.

### 2.4 Validate

`POST /api/workflow-definitions/:id/validate` runs:
- `DAGValidator.validateDAG(stages, edges)` — cycle detection (Kahn's algorithm), missing/dangling references, duplicate edges, self-edges.
- Schema validation of every stage.
- Resolution check on `condition.expression` references (parses but does not evaluate).

Response shape:
```json
{ "valid": true, "errors": [], "warnings": [] }
```

### 2.5 Import / Export

- `POST /api/workflow-definitions/import-json` — body is the exported JSON. Generates new IDs; preserves stage order; rewires edges to new IDs.
- `GET /api/workflow-definitions/:id/export` — returns the canonical JSON.
- `POST /api/workflow-definitions/from-template/:templateId` — copies a system template into a new mutable definition.

### 2.6 Delete

`DELETE /api/workflow-definitions/:id` — fails with `400` if runs exist. Cascades to `stage_definitions` + `stage_edges` rows via FK.

---

## 3. Configurations explained

### 3.1 `sessionMode`

Determines how harness sessions are allocated per stage during execution:

| Mode | Behavior |
|---|---|
| `single` | All stages share **one** harness session (`SessionAllocator.allocateSession()` returns the same conversation for every stage). Stage prompts are sequential. No parallelism possible. |
| `per-stage` | Each stage gets its **own** harness session. Maximum parallelism. Independent context. |
| `auto` (default) | Resolved once at run start for the WHOLE run: `per-stage` if the DAG has any parallelism (more than one root, or any execution layer with more than one stage), otherwise `single`. It is not a per-chain hybrid — a shared session cannot serve two concurrent stages, so `single` is also force-overridden to `per-stage` when the DAG is parallel. The resolved value is written back to `workflow_runs.sessionMode`. |

Override at run time via `runProfile.sessionMode`. See [feature-workflow-runs.md](./feature-workflow-runs.md#session-allocation).

### 3.2 `harnessConfig` (template defaults)

```typescript
type HarnessConfig = {
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTurns?: number;                            // Anthropic only currently
  systemMessage?: { mode: 'append' | 'replace'; content: string };
  availableTools?: string[];                    // ['*'] = all
  excludedTools?: string[];
  skillDirectories?: string[];
  disabledSkills?: string[];
  customAgents?: CustomAgentConfig[];
  mcpServers?: Record<string, McpServerConfig>;
  provider?: BYOKProviderConfig;                // { name, baseUrl, apiKey, model? }
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
};
```

Each stage may override any of these in `harnessConfigOverrides`. `ConfigResolver` deep-merges (objects merge, arrays replace).

### 3.3 `variables` (workflow-scope)

```typescript
type VariableDefinition = {
  name: string;                                 // unique within workflow; used as {{name}}
  type: 'string' | 'number' | 'boolean' | 'choice' | 'text';
  label?: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];                           // for type='choice'
};
```

Variables are surfaced in the Run dialog (web) and `--var key=value` (CLI). Mustache-style `{{name}}` is interpolated into prompts at execution time.

System variables auto-injected at run start: `__workingDirectory`, `__artifactsDirectory`, `__workflowRunId`, `__workspaceId`, `repo_path_<alias>`, `repo_branch_<alias>`, `repo_path_target`.

Validation feedback variables auto-injected during in-session retry: `__validationFeedback`, `__validationRetryAttempt`.

### 3.4 `hooks` (workflow-scope)

Phases (15 workflow-scope, see [feature-hooks.md](./feature-hooks.md)):

```
on_run_start | on_run_complete | on_run_failed | on_run_cancelled
pre_clone | post_clone | pre_commit | post_commit | on_pr_created
on_preprocessing_complete | on_postprocessing_start
on_all_stages_scheduled | on_stage_completed | on_stage_failed | on_parallel_join
```

Hooks at this level run *between* stages or at run boundaries. Stage-scope hooks (`pre_run`, `post_run`, `pre_prompt`, `post_prompt`, `on_error`, plus 12 harness phases) live on `StageDefinition.hooks`.

### 3.5 `scope` + `projectId` + `useWorktree`

- `scope = 'global'` — visible to every project; defaults when creating from web home.
- `scope = 'project'` + `projectId` — only visible inside that project page. Useful for project-specific automations.
- `useWorktree = true` — at run start, `WorkspaceManager` + `WorktreeService` create worktrees from the project's codebases into the run's workspace `source/<alias>/` directory. Set to `false` for a workflow that doesn't touch git.

### 3.6 `orchestratorConfig` (advanced, system templates)

```typescript
type OrchestratorConfig = {
  templateId?: string;                          // origin template if cloned
  codebaseAliases?: string[];                   // which of the project's codebases to use
  requiresCodebase?: boolean;
  autoCommit?: boolean;                         // commit the worktrees after a successful run
  autoPush?: boolean;                           // push the work branch (implied by autoCreatePR)
  autoCreatePR?: boolean;
  preprocessing?: { ... };                      // pre-prompt enrichment passes
  postprocessing?: { ... };                     // post-stage transformations
};
```

Mostly used by the Orchestrator + system templates. Plain user workflows usually omit this.

**Codebases.** A project-linked run checks out one worktree per `codebaseAliases` entry
(every ready project codebase when the list is empty). A run without a project clones its
repository in a template's `clone_repo` step, from the URL entered in the run form.

`autoCommit` / `autoPush` / `autoCreatePR` apply to whatever the run actually has checked out
— the worktrees created from `codebaseAliases` or a `clone_repo` clone.

**They run through the source-control flow.** `buildPostProcessingSteps` turns the flags into a
`commit_and_push` step (`generateMessage: true`, `push: autoPush || autoCreatePR`) at order 100
and a `create_pr` step (`generateText: true`) at order 200, and `WorkflowPreprocessor` routes
both through `SourceControlFlowService.run`, once per run worktree — the same flow the Changes
tab and agent-native chats use, so there is one branch policy, one base-branch sync and one
conflict dry-run. The generated commit message / PR text is written from the diff with
`"<workflow name> (workflow run <run id>)"` as the hint; the PR base is the codebase's
`defaultBranch` (`OrchestratorContext.baseBranches`), overridden by an explicit
`create_pr.baseBranch`. See [feature-source-control.md](./feature-source-control.md) §4–§5.

**Failure semantics.** Both auto-steps are `failOnError: true`. A result that is not `ok` —
`conflicts`, `blocked` or `failed` — fails the step and stops the post-processing sequence, so a
PR is never opened on top of a commit that did not land. The failed `PreprocessingResult` carries
`error` (one user-facing line) **and** `scm: ScmFlowResult[]` — the conflict report, the blocking
reason and every step the flow ran — which is what the run page renders. A conflict never leaves
a half-applied merge: the flow probes the merge with `git merge-tree --write-tree` (falling back
to a `--no-commit` merge it immediately aborts), so `ScmConflictReport.mergeStarted` is `false`
and the worktree is exactly as the run left it.

**One path.** The flow service is a required dependency of `createCoreServices`: the server and the SDK both wire `SourceControlFlowService`, so there is no `GitManager` / `gh` CLI fallback.

### 3.7 `tags`

Free-form strings. Web `WorkflowListPage` and CLI `workflow list` support tag filtering. Tags are normalized to lowercase server-side.

---

## 4. Stages, edges, and the DAG

Each `StageDefinition` is a node (see [feature-stages.md](./feature-stages.md) for full config). Each `StageEdge` is a directed dependency.

### Edge types

| Type | Fires when |
|---|---|
| `on_success` | predecessor in terminal status `completed` |
| `on_failure` | predecessor in terminal status `failed` |
| `on_completion` | predecessor in `completed` OR `failed` (terminal regardless of result) |
| `always` | any terminal status incl. `skipped` and `cancelled` |

Edge eval is implemented in `DAGScheduler.onStageCompleted()` (see [feature-workflow-runs.md → DAG scheduling](./feature-workflow-runs.md#dag-scheduling)).

> **Setting the type in the builder:** click an edge's condition badge on the canvas to open the picker. New edges are created as `on_success`.

> **Skipped predecessors are asymmetric.** A stage skipped because *its own* condition or incoming edges never fired routes as `skipped`, so only an `always` edge leaves it. A stage skipped by a run-time **stage override** routes as `completed`, so its `on_success` edges DO fire — otherwise skipping any non-leaf stage would kill the whole downstream, which is not what an operator asking to skip one stage means.

### DAG validity rules (`DAGValidator.validateDAG`)

- No cycles (Kahn's algorithm).
- No self-edges (`fromStageId === toStageId`).
- No dangling edges (both `fromStageId` and `toStageId` must exist).
- No duplicate edges with identical `(from, to, edgeType)`.
- Disconnected stages are allowed but flagged as warnings (they will never run unless promoted to a root).

### Execution layers

`DAGValidator.getExecutionLayers(dag)` returns `string[][]` — each inner array is a set of stages that can execute in parallel (all their dependencies are in earlier layers). UI uses this to visually align nodes.

---

## 5. Templates

Five system v2 templates in [templates/system/](../../templates/system/):

| Template | File |
|---|---|
| Code Generation | `code-generation-workflow.json` |
| Code Review | `code-review-workflow.json` |
| Refactoring | `refactoring-workflow.json` |
| Test Generation | `test-generation-workflow.json` |
| E2E Testing | `e2e-testing-workflow.json` |

Plus three programmatic workflow scripts in [templates/scripts/](../../templates/scripts/):

- `code-review.workflow.mjs`
- `comprehensive-test.workflow.mjs`
- `e2e-feature-coverage.workflow.mjs`

`TemplateRegistry` loads JSON templates on boot. `WorkflowScriptLoader` loads `.workflow.mjs` files.

API:

```
GET  /api/templates                    → list metadata cards
GET  /api/templates/:id                → full template JSON
POST /api/orchestrator/runs           → start from template (legacy orchestrator path)
POST /api/workflow-definitions/from-template/:id  → clone template to a mutable definition
```

See [feature-templates-scripts.md](./feature-templates-scripts.md) for the PWS deep-dive.

---

## 6. CLI

```powershell
# CRUD
generatorai workflow list [--project <id>] [--tag <tag>] [--scope global|project]
generatorai workflow create <name> [--description "..."] [--session-mode single|per-stage|auto]
generatorai workflow show <id>                                  # full def + stages + edges
generatorai workflow update <id> [--name "..."] [--description "..."]
generatorai workflow delete <id>                                # fails if runs exist
generatorai workflow validate <id>                              # DAG + schema validation
generatorai workflow export <id>                                # JSON to stdout
generatorai workflow import-json <path>                         # import (new IDs assigned)
generatorai workflow from-template <templateId> --name "..."   # clone a system template

# Stages
generatorai workflow stage add <defId> <name> --prompt "Tell me..." [--model claude-sonnet-4.6] [--timeout 30000]
generatorai workflow stage update <defId> <stageId> --name "..." --prompt "..."
generatorai workflow stage delete <defId> <stageId>

# Edges
generatorai workflow edge add <defId> --from <stageId> --to <stageId> [--on on_success|on_failure|on_completion|always] [--condition "expr"]
generatorai workflow edge delete <defId> <edgeId>
```

---

## 7. SDK

```typescript
import { createGeneratorAI, workflow } from '@generatorai/sdk';

const ai = await createGeneratorAI({ provider: 'copilot' });

const def = await ai.workflows.create(workflow(b => b
  .id('triage-tickets')
  .name('Triage support tickets')
  .description('Classify → summarize → label')
  .variable({ name: 'ticketId', type: 'string', required: true })
  .harnessConfig({ model: 'claude-sonnet-4.6', reasoningEffort: 'high' })

  .stage('classify', s => s
    .name('Classify')
    .prompts([{ text: 'Classify ticket {{ticketId}}. Output exactly one of: bug | feature | question | other' }])
    .outputFormat('text')
    .resultValidation([{ type: 'regex', value: '^(bug|feature|question|other)$', message: 'Bad class' }])
    .retryPolicy({ maxRetries: 2, backoffMs: 1000, backoffMultiplier: 2 })
  )
  .stage('summarize', s => s
    .name('Summarize')
    .prompts([{ text: 'Summarize ticket {{ticketId}} in 2 sentences.' }])
  )
  .stage('label', s => s
    .name('Apply label')
    .prompts([{ text: 'Set GitHub label to {{classify.output}}' }])
    .agentRef('project:github-labeler')
  )

  .edge('classify', 'summarize', 'on_success')
  .edge('classify', 'label', 'on_success')
  .edge('summarize', 'label', 'on_success')   // diamond convergence on `label`

  .profile({ name: 'fast', sessionMode: 'single' })
  .profile({
    name: 'thorough',
    sessionMode: 'per-stage',
    stageOverrides: [{ stageName: 'Summarize', timeoutMs: 60000 }],
  })
));

// Run it
const run = await ai.workflows.run(def.id, { variables: { ticketId: 'GH-123' } });
for await (const event of ai.workflows.stream(run.id)) {
  console.log(event.kind, event.data);
}
```

---

## 8. Edge cases & gotchas

1. **Stage order changes** — `stages[].order` is an int. Updating it does not break edges (edges reference IDs).
2. **Renaming a stage** — does not break anything; `RunProfile.stageOverrides` can match by `stageName` *or* `stageIndex`.
3. **Removing a variable** still referenced in a prompt `{{name}}` — interpolation leaves the literal string. Validation does not currently catch this.
4. **Adding a variable to an existing template** — old runs use the snapshot in `workflow_runs.variables`; new runs see the new variable.
5. **Re-importing a JSON export** — IDs are re-generated. To overwrite an existing definition, delete it first then import.
6. **Validation passes but run fails** — usually means the assistant ignored output format / a tool failed. Look at `stage_runs.error` and the `harness.error` SSE event.
7. **Condition expression grammar** — `condition.expression` cannot reference downstream stages. Operands are `status` / `parentStatus`, `variables.<dotted.path>`, and quoted-string / numeric / boolean literals. Comparisons are `== != < <= > >=` (**not** `===`). Logical operators are `AND` / `OR` / `NOT` (case-insensitive) or `&& || !`, with parentheses. Anything unparseable evaluates to **false**, so a typo silently prevents the stage from running — e.g. `status == 'completed' AND variables.env == 'prod'`.
8. **`scope='project'` workflows** filtered out of the global `/workflows` list. Make sure the UI passes `projectId` when you want both.
9. **Workflows with no edges** — a workflow with N stages and zero edges has N roots; all run in parallel.
10. **Duplicate names** — allowed at the definition level (names aren't unique). Use IDs in CLI/SDK.
