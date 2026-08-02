# Feature: Templates & Workflow Scripts (PWS)

> Templates are reusable workflow definitions. The system ships JSON v2 templates (registered by `TemplateRegistry`) and supports **Programmatic Workflow Scripts (PWS)** — `.workflow.mjs` files loaded at boot by `WorkflowScriptLoader`.

---

## 1. JSON templates

Live in [templates/](../../templates/) and [templates/system/](../../templates/system/).

### Shipped templates

| Template | File | Stages |
|---|---|---|
| Code Generation | `system/code-generation-workflow.json` | ~4 |
| Code Review | `system/code-review-workflow.json` | ~4 |
| Refactoring | `system/refactoring-workflow.json` | ~4 (E2E verified) |
| Test Generation | `system/test-generation-workflow.json` | ~4 |
| E2E Testing | `system/e2e-testing-workflow.json` | ~4 |

Plus legacy v1 JSON (still loaded for compatibility): `templates/code-generation.json`, `code-review.json`, `refactoring.json`, `test-generation.json`, `workflow-upload-template.json`.

### Loading

`TemplateRegistry.loadTemplates()` runs at server boot:

1. Scans `templatesDir` for `*.json` (default `~/.generatorai/templates`).
2. Parses each via `WorkflowTemplate` schema.
3. Indexes by `id` (or filename).
4. Exposes via:
   - `GET /api/templates` → list with metadata cards.
   - `GET /api/templates/:id` → full template JSON.
   - `POST /api/orchestrator/runs` → start workflow from template (orchestrator path).
   - `POST /api/workflow-definitions/from-template/:id` → clone template into a mutable WorkflowDefinition.

Templates are **read-only**. To customize one, clone it (`from-template`) and edit the resulting definition.

---

## 2. Programmatic Workflow Scripts (PWS)

`.workflow.mjs` files live in [templates/scripts/](../../templates/scripts/) by default (configurable via `GENERATORAI_SCRIPTS_DIR` / SDK `scriptsDir` option). Each exports a default `workflow(builder => …)` invocation.

### Shipped scripts

- `code-review.workflow.mjs` — 3-stage workflow review (analyze → critique → recommend).
- `comprehensive-test.workflow.mjs` — 4-stage comprehensive test plan generator.
- `e2e-feature-coverage.workflow.mjs` — diamond DAG with all options used (used for E2E test coverage).

### Anatomy

```js
import { workflow } from '@generatorai/sdk';

export default workflow((b) => {
  b.id('e2e-feature-coverage')
   .name('E2E Feature Coverage')
   .description('Diamond DAG covering every option')
   .tags('e2e-test', 'script')

   .variable({
     name: 'topic',
     type: 'string',
     label: 'Topic',
     defaultValue: 'AI',
     required: false,
   })

   .harnessConfig({ model: 'claude-sonnet-4.6', availableTools: ['*'] })

   // Workflow-scope hook
   .hook({
     id: 'wf-start',
     phase: 'on_run_start',
     type: 'script',
     priority: 0,
     enabled: true,
     failurePolicy: 'continue',
     timeoutMs: 5000,
     retries: 0,
     config: { type: 'script', command: 'node', args: ['-e', 'console.log("RUN_START")'] },
   })

   // Stages
   .stage('classify', s => s
     .name('Classify Topic')
     .order(0)
     .prompts([{ label: 'p', text: 'Classify {{topic}} → JSON {classification:"…"}', source: 'inline' }])
     .outputFormat('json')
     .outputSchema({
       type: 'object',
       properties: { classification: { type: 'string' } },
       required: ['classification'],
     })
     .resultValidation([{ type: 'contains', value: 'classification', message: 'must include the field' }])
     .retryPolicy({ maxRetries: 2, backoffMs: 1000, backoffMultiplier: 2 })
     .timeoutMs(30000)
     .contextFilter('none')
   )

   .stage('branchA', s => s
     .name('Branch A — Summarize')
     .prompts([{ text: 'Summarize {{topic}}' }])
     .contextFilter('summary-only')
     .hooks([{
       id: 'pre',
       phase: 'pre_run',
       type: 'script',
       config: { type: 'script', command: 'node', args: ['-e', 'console.log("SUMMARIZE_PRE_RUN")'] },
       priority: 0, enabled: true, failurePolicy: 'continue', timeoutMs: 5000, retries: 0,
     }])
   )

   .stage('branchB', s => s.name('Branch B — Keywords').prompts([{ text: 'Keywords for {{topic}}' }]))
   .stage('final',   s => s.name('Final Synthesis').prompts([{ text: 'Synthesize both' }]).contextFilter('full'))

   // Edges (diamond)
   .edge('classify', 'branchA', 'on_success')
   .edge('classify', 'branchB', 'on_success')
   .edge('branchA',  'final',   'on_success')
   .edge('branchB',  'final',   'on_completion')

   // Profiles
   .profile({
     name: 'quick-surface',
     description: 'Skip Branch B keywords stage',
     sessionMode: 'single',
     permissionMode: 'bypassPermissions',
     variables: { topic: 'caching strategies' },
     stageOverrides: [{ stageName: 'Branch B — Keywords', skip: true }],
   })
   .profile({
     name: 'thorough-with-overrides',
     sessionMode: 'per-stage',
     stageOverrides: [
       { stageName: 'Branch A — Summarize', timeoutMs: 60000, variables: { audience: 'engineers' } },
     ],
   })
   .profile({ name: 'comprehensive-all' });
});
```

### Lifecycle

`WorkflowScriptLoader` runs at boot (and on `POST /api/workflow-scripts/reload`):

1. Reads `scriptsDir/*.workflow.mjs`.
2. Dynamic-imports each.
3. Calls the exported builder.
4. Validates against `WorkflowScriptSchema` (variables, stages, edges, hooks, profiles).
5. Validation failures are logged but don't block boot.
6. Indexes by `id`.

### APIs

```
GET  /api/workflow-scripts                          → list metadata
GET  /api/workflow-scripts/:id                      → full definition
GET  /api/workflow-scripts/:id/profiles             → just the profiles
POST /api/workflow-scripts/:id/validate             → DAG + schema validate
POST /api/workflow-scripts/:id/materialize          → create mutable WorkflowDefinition row in DB
                                                       body: { profileName?, projectId? }
POST /api/workflow-scripts/:id/run                  → materialize + create run + start
                                                       body: { profileName?, variables?, projectId? }
POST /api/workflow-scripts/reload                   → rescan disk
```

> **Wire detail:** the run endpoint accepts `profileName` (not `profile`) and folds `profile.stageOverrides` + `profile.permissionMode` into the runtime variables and run record (fix from session 63).

### Materialize vs Run

- **Materialize** — creates a `workflow_definitions` row + stages + edges + variables. After this, it's a normal definition; you can edit, version, share.
- **Run** — materializes (creating a transient definition under the hood) + starts a run.

Both apply the named `profile` if specified. Profiles configure `variables`, `sessionMode`, `permissionMode`, `stageOverrides`, `selectedCodebases`, `promptFiles`, `skillFiles`, `agentFiles`.

---

## 3. UI

### Templates page (`TemplateExplorer.tsx`)
Cards for each system template. Click **Use Template** → creates a new mutable `WorkflowDefinition` and navigates to the builder.

### Scripts page (`ScriptsListPage.tsx` + `ScriptDetailPage.tsx`)
Lists all `.workflow.mjs` cards. Each detail page:
- Stages list (collapsed by default).
- Edges list (with edge types).
- Run Profiles (click to expand each profile's `variables`, `sessionMode`, `permissionMode`, `stageOverrides`).
- **Run Script** button — shows profile picker → triggers `POST /api/workflow-scripts/:id/run`.
- **Materialize** button — creates a mutable definition.
- **Reload** button (top-right) — hits `POST /api/workflow-scripts/reload`.

---

## 4. CLI

```powershell
generatorai script list                                    # all loaded scripts
generatorai script show <id>                               # metadata + stage + edge + profile summary
generatorai script profiles <id>                           # just the profiles
generatorai script validate <id>                           # validate without materializing
generatorai script materialize <id> [--profile <name>] [--project <id>]
generatorai script run <id> [--profile <name>] [--var key=value …] [--project <id>] [--watch]
generatorai script reload                                  # re-scan disk
```

---

## 5. SDK

```typescript
const ai = await createGeneratorAI({
  provider: 'copilot',
  scriptsDir: './workflows',     // auto-loads *.workflow.mjs at boot
});

// List loaded scripts
const scripts = ai.scripts.list();

// Reload after edits
await ai.scripts.reload();

// Validate a file before saving
const result = await ai.scripts.validate('./workflows/new.workflow.mjs');
if (!result.valid) console.error(result.errors);

// Run via the workflows facade
//  (scripts surface in the WorkflowDefinition list once materialized)
const def = await ai.services.workflowScriptLoader.materialize('my-script-id', { profileName: 'fast' });
const run = await ai.workflows.run(def.id, { variables: { topic: 'AI' } });
```

---

## 6. Edge cases & gotchas

1. **Filename mismatch with `b.id(...)`** — totally fine; the ID is whatever you set in `.id()`. Filename is just for grouping in the UI.
2. **Duplicate IDs across files** — last loaded wins; earlier is logged as a warning.
3. **Validation failure at boot** — script is skipped; visible in `system health` output. Fix the file and `POST /api/workflow-scripts/reload`.
4. **Hot reload during a running script** — running runs continue (they hold their snapshot of the materialized definition). Subsequent reads of `script.list()` reflect the new file.
5. **`profile.stageOverrides` with `stageName` vs `stageIndex`** — `stageName` takes precedence; falls back to `stageIndex`. If neither matches, the override is silently ignored.
6. **`profile.permissionMode = 'plan'`** — every tool call awaits approval. Set this only for HITL workflows; otherwise the run hangs forever.
7. **Materialize with no profile** — creates a definition from the script's *base* spec (no profile-time variables). Variables still need to be supplied at run time.
8. **Variable type mismatch** — script declares `type: 'number'` but profile/runtime passes a string → Zod validation fails at run create. Error includes the variable name.
9. **`script` hooks in PWS** — same allowlist applies; `cmd.exe` is rejected.
10. **`function` hooks referencing unregistered handlers** — fail at execute time with `HookError`. Always register handlers before they fire.
11. **Profiles with `selectedCodebases`** — overrides the project's default `codebaseIds`. Useful for "fast" profiles that mount only 1 of N codebases.
12. **`runName` template** — `profile.runName` becomes the `WorkflowRun.name`. Supports mustache like `{{topic}} - {{date}}`.

---

## 7. Authoring a new template

### JSON template

Create `templates/system/my-template.json`:

```json
{
  "id": "my-template",
  "name": "My Template",
  "description": "…",
  "version": 1,
  "sessionMode": "auto",
  "tags": ["custom"],
  "harnessConfig": { "model": "claude-sonnet-4.6" },
  "variables": [
    { "name": "topic", "type": "string", "required": true }
  ],
  "stages": [
    { "id": "s1", "name": "Step 1", "order": 0, "prompts": [{ "text": "Do {{topic}}" }] }
  ],
  "edges": []
}
```

Restart the server → it loads via `TemplateRegistry`.

### PWS

Create `templates/scripts/my.workflow.mjs` using the builder pattern above. Use `POST /api/workflow-scripts/reload` to pick it up without restarting.

---

## 8. Relationship matrix

| | JSON template | PWS script | Workflow definition (DB) | Workflow run |
|---|---|---|---|---|
| Storage | filesystem (`templates/*.json`) | filesystem (`templates/scripts/*.workflow.mjs`) | `workflow_definitions` table | `workflow_runs` table |
| Mutability | read-only | read-only (file-edit then reload) | mutable | snapshot at start |
| Created by | repo / user-drop | repo / user-drop | clone-from-template OR materialize-from-script OR API CRUD | `startRun` |
| Run directly | only via clone-from-template | yes (`script run`) | yes (`run start`) | n/a |
| Profiles | n/a | yes (`.profile()`) | n/a | applied at start |
