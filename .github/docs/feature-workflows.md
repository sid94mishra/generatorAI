# Feature: Workflow Definitions

A workflow definition is **one document**: a v2 `WorkflowGraph` from
[`@generatorai/workflow-spec`](../../packages/workflow-spec/). The builder, the CLI, the SDK,
templates, scripts and import all produce the same document, and the server validates it with
the same validator before anything is stored. Every field, with its type and default, is in the
generated [FIELDS.md](../../docs/workflow-overhaul/generated/FIELDS.md); the JSON Schema is
`@generatorai/workflow-spec/workflow.schema.json`.

Stage configuration is covered in [feature-stages.md](./feature-stages.md).

---

## 1. The document

```jsonc
{
  "formatVersion": 2,
  "workflow": {
    "name": "Review and fix",
    "description": "…",
    "session": { "harnessType": "claude-agent", "model": "…" },   // SessionSpec, merged under each stage's session
    "variables": [{ "name": "ticket", "type": "string", "label": "Ticket", "required": true }],
    "hooks": [],                    // workflow hooks (on_run_start, on_run_complete, …)
    "lifecycle": {                  // codebases, worktrees, pre/post-processing
      "codebaseAliases": [], "useWorktree": true, "requiresCodebase": false,
      "preprocessingSteps": [],
      "postProcessing": { "autoCommit": false, "autoPush": false, "autoCreatePR": false, "steps": [] }
    },
    "tags": [],
    "projectId": null               // null or omitted = global
  },
  "stages": [ { "kind": "agent", "key": "review", "name": "Review", "prompts": [{ "label": "Review", "text": "…" }] } ],
  "edges":  [ { "from": "review", "to": "fix", "on": "success" } ]
}
```

- **Stage keys.** Every stage has a `key` (`^[a-z][a-z0-9_]{0,47}$`, unique). Edges,
  `context.from`, `stages.<key>` in expressions and run stage overrides all use keys. Names are
  display text only and need not be unique.
- **Strict.** Unknown fields are rejected, with a hint when the field is a removed v1 name
  (`retryPolicy` → `retry`, `resultValidation` → `output.rules`, …). See §7.
- **Engine gate.** `validateWorkflow(graph, { engine: 'v1' })` rejects fields the current engine
  cannot execute (code `engine-unsupported`): `join.mode` other than `all`, `repair`,
  `onExhausted: 'pause'`, `sessionReuse: 'continue'`, `sessionGroup`, `budget`,
  `timeouts.queueMs|idleMs|totalMs`, `output.extraction` other than `auto`, `compensate`,
  `onExit`, `onFailure`, `maxParallel`, and edge `handlesFailure`. They become available when
  the engine level changes (one constant, `ENGINE_LEVEL`).

### Validation

`validateWorkflow(input)` returns `{ valid, issues, graph }`. Each issue is
`{ code, severity, path, stageKey?, message, hint? }`, where `path` is a JSON pointer
(`/stages/2/prompts/0/text`). It checks, in layers: the schema; keys and references
(duplicate keys, unknown edge endpoints, self loops, two edges for one pair, `context.from`);
the DAG (cycles); expressions (parse and type-check, declared variables only); templates
(`{{name}}` must be a declared variable); commands (`command`/`args` are literals, templated
values reach commands only through `env`, secrets only as `secretref:`); reserved variable names
(`variables`, `stages`, `run`, … and `^(__|repo_path_|repo_branch_)`); and the engine gate.

---

## 2. Storage, revisions and versions

| Table | What it holds |
|---|---|
| `workflow_definitions` | `id, name, description, project_id, status (draft\|published), revision, current_version_id, archived_at, needs_attention, spec` (workflow-level JSON) |
| `stage_definitions` | one row per stage: `key` (unique per definition), `name`, `ordinal`, `position_x/y`, `spec` (the stage JSON) |
| `stage_edges` | `from_key, to_key, edge_on, when_expr, handles_failure, ordinal` — FKs to the stage keys |
| `workflow_definition_versions` | immutable copies: `version, kind (published\|test), content_hash, spec` |

- **Whole-graph save.** `PUT /api/workflow-definitions/:id/graph` with `{ graph, expectedRevision }`
  replaces the graph in **one transaction**: stages are upserted by key, removed keys deleted,
  edges replaced, `revision` bumped. A stale `expectedRevision` returns **409**
  `REVISION_CONFLICT` with `error.current` (the stored record) and changes nothing.
- **Draft / published.** New definitions are drafts. `POST /:id/publish` stores the working
  graph as an immutable published version (reusing an existing version with the same content
  hash) and makes it current. `hasUnpublishedChanges` says whether the working graph differs
  from the current version.
- **Runs pin a version.** A normal run executes the definition's current published version; a
  draft runs only as a **test run** (`testRun: true`), which pins a `test` version of the working
  graph. Editing or republishing a definition never changes a run already started — the run
  reads its pinned `definitionVersionId`.
- **Delete.** `DELETE /:id` hard-deletes a definition nobody ran and returns `{ deleted: true }`;
  a definition with runs is archived (`{ archived: true, runs }`) so its runs stay readable.
  Archived definitions cannot start runs.
- **Command-bearing fields** (script hooks, `run_script`, `custom_script` rules) can be added or
  changed only by a principal with the `admin:settings` scope; otherwise **403**
  `INSUFFICIENT_SCOPE`. Unchanged commands can be saved by anyone who can edit.
- Definitions migrated from v1 (migration 55) are published with version 1. Values the converter
  could not map are listed in `needsAttention` until the next save.

---

## 3. HTTP API

| Method and path | Result |
|---|---|
| `GET /api/workflow-definitions?projectId&status&q&cursor&limit&includeArchived` | `{ items: WorkflowDefinitionSummary[], nextCursor? }`; `projectId=global` lists definitions without a project |
| `POST /api/workflow-definitions` (body: graph) | 201, the new draft record |
| `POST /api/workflow-definitions/validate` (body: graph) | 200 `{ valid, issues }` |
| `POST /api/workflow-definitions/import[?publish=true]` (body: graph, or `{ templateId, name?, projectId? }`) | 201 record; `publish` only for user principals |
| `GET /api/workflow-definitions/:id` | the record: `{ id, status, revision, currentVersionId, hasUnpublishedChanges, archivedAt, needsAttention, createdAt, updatedAt, graph }` |
| `PUT /api/workflow-definitions/:id/graph` | record; 409 on a stale revision, 422 on an invalid graph |
| `POST /api/workflow-definitions/:id/publish` | record |
| `GET /api/workflow-definitions/:id/versions[/:versionId]` | version summaries / one version with its graph |
| `GET /api/workflow-definitions/:id/export` | the canonical JSON text |
| `DELETE /api/workflow-definitions/:id` | `{ deleted: true }` or `{ archived: true, runs }` |

An invalid graph anywhere returns **422** `{ error: { code: 'WORKFLOW_INVALID', message, issues } }`.

Runs: `POST /api/workflow-runs { workflowDefinitionId, variables?, projectId?, testRun? }`, then
`POST /api/workflow-runs/:id/start`; or `POST /api/orchestrator/runs` (lifecycle-aware start,
also takes `testRun` and `stageOverrides: [{ stageKey, skip?, variables? }]`). Stage runs carry
`stageKey`, and `GET /api/workflow-runs/:id` orders them by the pinned graph.

### Import and export

Export is canonical: the parsed document in schema field order, with every default filled in.
`import(export(g))` gives back `g` exactly, so publishing an unchanged graph reuses its version
(same content hash). The import endpoint accepts only v2 documents; there is no other import
format.

---

## 4. Expressions and templates

**Expression v2** is used by stage `guard`s, edge `when`s and preprocessing `conditional` steps.

- Paths: `variables.<name>`, `stages.<key>.status|output|summary`, `run.id`, `run.name`,
  `run.codebases.<alias>.path|branch|baseRef`, and on an edge `parent.status`.
- Operators: `== != < <= > >=` (strict: no type coercion), `and or not` (also `&& || !`),
  parentheses, string/number/boolean/null literals.
- Functions: `len(x)`, `count(list, x => cond)`, `exists(x)`, `lower(s)`.
- A missing path is `null`. Expressions are parsed and type-checked at save time; an
  unparseable or ill-typed expression is a validation error, never a silent `false` at run time.

**Guards and edges.** A stage's `guard` decides whether the stage runs once its incoming edges
allow it; a false guard skips it. An edge's `on` (`success | failure | completion | always`)
decides whether it carries control for the parent's outcome, and its optional `when` narrows
that further. Skips cascade along `success` edges; `completion` and `always` edges still fire
from a skipped parent.

**Templates** (`{{…}}` in prompts, output instructions, approval prompts and hook `env`):
`{{variables.x}}`, bare `{{x}}` as sugar for a declared variable, `{{stages.<key>.output.y}}`,
`{{run.id}}`, `{{run.codebases.<alias>.path}}`. A bare name that is not a declared variable is a
save-time error (`template-unknown-variable`). A declared variable the run leaves empty renders
empty and raises an `unresolved_variables` warning on the stream.

**Typed codebase scope.** Codebase checkouts are read from `run.codebases.<alias>`, which is
read-only. Variables named `repo_path_*` / `repo_branch_*` are rejected; migration 55 rewrote
`{{repo_path_<alias>}}` to `{{run.codebases.<alias>.path}}`.

---

## 5. Sessions

`workflow.session` is a `SessionSpec` (provider, model, reasoning effort, agent binding
`agentRef` + `agentOverrides`, tools, MCP, skills, permission mode, browser, …). A stage's
`session` is merged over it. On the current engine every stage gets its own conversation when
the graph has parallel branches, and a purely linear graph shares one conversation; there is no
per-definition session mode (session groups arrive with the engine upgrade).

---

## 6. Templates and scripts

- **System templates**: [templates/system/](../../templates/system/)`*-workflow.json`, each
  `{ id, category, graph }`. `TemplateRegistry` validates every template at boot (a broken
  template fails boot in development and is skipped with an error in production).
  `GET /api/templates` lists them; `POST /api/workflow-definitions/import { templateId }` creates a
  draft tagged `template:<id>`.
- **Workflow scripts**: [templates/scripts/](../../templates/scripts/)`*.workflow.mjs` export a
  builder from `@generatorai/workflow-spec/builders` as their default export, plus optional
  `profiles` (`ScriptRunProfile`, stage overrides by key). The loader builds and validates the
  graph; inline hook functions are registered as handlers. Script loading is off unless enabled.
  See [feature-templates-scripts.md](./feature-templates-scripts.md).

---

## 7. Removed v1 fields

| v1 field | v2 |
|---|---|
| `sessionMode` | none (see §5) |
| `harnessConfig` / `copilotConfig` | `workflow.session` |
| `orchestratorConfig` (codebases, auto-commit/push/PR, pre/post-processing) | `workflow.lifecycle` |
| `orchestratorConfig.resultValidations` | each stage's `output.rules` |
| `hooksFile` | `workflow.hooks` and each stage's `hooks` |
| `scope` | `projectId` (null = global) |
| stage `order` / `id` in edges | stage `key`; edges `{ from, to, on, when? }` |
| edge `edgeType: on_success/on_failure/on_completion/always` | edge `on: success/failure/completion/always` |
| `condition` | stage `guard` or edge `when` |
| `/import-json`, `/from-template/:id`, nested stage/edge routes, `PATCH /:id` | the routes in §3 |

---

## 8. CLI

```bash
generatorai workflow list [--project <ref|global>] [--status draft|published] [--search q]
generatorai workflow create [file|-] [--name n] [--publish]
generatorai workflow import [file|-] | --template <id>  [--publish]
generatorai workflow export <wf> [--out file]
generatorai workflow validate <file|-|wf>          # prints `severity path [stageKey]: message — hint`
generatorai workflow publish|versions|clone|delete <wf>
generatorai stage add|update|remove <wf> <stage> …  # read-modify-write with one retry on 409
generatorai edge add|remove <wf> --from a --to b [--on success] [--when expr]
generatorai run start <wf> [--test-run] [--skip <key>] [--stage-var <key>.<name>=<value>]
```

See [usage-cli.md](./usage-cli.md) for every flag.

---

## 9. SDK

```typescript
import { createGeneratorAI, workflow } from '@generatorai/sdk';

const ai = await createGeneratorAI();
const def = await ai.workflows.create(
  workflow('Review and fix')
    .variable('ticket', { type: 'string', label: 'Ticket', required: true })
    .stage('review', (s) => s.name('Review').prompt('Review {{ticket}}.'))
    .stage('fix', (s) => s.name('Fix').prompt('Fix what the review found.').contextFrom(['review'], 'output'))
    .edge('review', 'fix'),
); // published by default; pass { publish: false } for a draft

const run = await ai.workflows.run(def.id, { variables: { ticket: 'ABC-1' } });
for await (const event of ai.workflows.stream(run.id)) console.log(event.kind);
```

`ai.workflows.save(id, graph, expectedRevision)`, `publish(id)`, `validate(graph)`, `list()`,
`get(id)` mirror the HTTP API. `validateWorkflow`, `exportGraph` and `importGraph` are exported
from the SDK as well.

---

## 10. Edge cases

1. **Renaming a stage** changes only its display name; the key stays, so edges, overrides and
   expressions keep working. Changing a key is a remove plus an add.
2. **Removing a variable** still referenced by a template or expression fails validation.
3. **A stage removed while runs exist** — runs keep their pinned version; the working graph
   simply no longer has the stage.
4. **Workflows with no edges** have one root per stage; all run in parallel.
5. **Concurrent editors** — the second save gets 409 with the current record; re-apply the change
   on it and save with the new revision.
