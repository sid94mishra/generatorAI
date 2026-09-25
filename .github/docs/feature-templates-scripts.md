# Feature: Templates & Workflow Scripts (PWS)

> Templates are reusable workflow definitions. The system ships JSON v2 templates (registered by `TemplateRegistry`) and supports **Programmatic Workflow Scripts (PWS)** — `.workflow.mjs` files loaded at boot by `WorkflowScriptLoader`.

---

## 1. JSON templates

A template file is `templates/system/*-workflow.json`: `{ id, category, graph }`, where `graph` is a canonical v2 `WorkflowGraph` (`WorkflowTemplateSchema` in [definition.ts](../../packages/workflow-spec/src/definition.ts)). `id` is lower-case words joined by `-`; `category` is one of `system`, `code-generation`, `code-review`, `testing`, `e2e-testing`, `refactoring`, `documentation`, `deployment`, `custom`.

### Shipped templates

| Template id | File | Stages |
|---|---|---|
| `system-code-generation` | `system/code-generation-workflow.json` | 4 |
| `system-code-review` | `system/code-review-workflow.json` | 4 |
| `system-refactoring` | `system/refactoring-workflow.json` | 4 |
| `system-test-generation` | `system/test-generation-workflow.json` | 4 |
| `system-e2e-testing` | `system/e2e-testing-workflow.json` | 4 |

The only JSON templates are the system templates above. The four v1 files (`code-generation.json`, `code-review.json`, `refactoring.json`, `test-generation.json`) were removed on 2026-09-05, and the orphan `workflow-upload-template.json` sample (which still used the pre-rename `copilotConfig` key) was removed in the workflow overhaul (P01).

### Loading

`TemplateRegistry.loadWorkflowTemplates(dir)` runs at server boot for `templatesDir` (env `TEMPLATES_DIR`, default the repo's `templates/`) and `templatesDir/system`:

1. Reads every `*-workflow.json` in the folder (other JSON files, such as catalogs, are not templates).
2. Parses it with `WorkflowTemplateSchema` and validates `graph` with `validateWorkflow` (the same validator as a save, at the current engine level).
3. Indexes it by `id`. An invalid template **fails boot** in development and test, and is skipped with a warning in production.
4. Exposes it via:
   - `GET /api/templates[?category=…]` → `WorkflowTemplate[]` (`{ id, category, graph }`).
   - `GET /api/templates/:id` → one template.
   - `POST /api/workflow-definitions/import { templateId, name?, projectId? }` (optionally `?publish=true`) → a new definition from the template's graph, tagged `template:<id>`.

Templates are **read-only**. To customize one, import it and edit the resulting definition.

---

## 2. Programmatic Workflow Scripts (PWS)

`.workflow.mjs` files are read from `<templatesDir>/scripts` and `<templatesDir>` on the server (repo default: [templates/scripts/](../../templates/scripts/)); the SDK reads its `scriptsDir` option (default `./workflows`). A script's **default export** (or a named `workflow` export) is a builder from `@generatorai/workflow-spec/builders` — or a plain `WorkflowGraph` document — and an optional named `profiles` export holds run profiles.

**Scripts execute in-process with the server's privileges, so loading is off by default.** Set `GENERATORAI_ALLOW_WORKFLOW_SCRIPTS=true` (config `scripts.workflowScriptsEnabled`) on a trusted deployment; otherwise the boot scan reports what it found and loads nothing, and reload/validate/upload are refused with 403 `WORKFLOW_SCRIPTS_DISABLED`.

### Shipped scripts

- `code-review.workflow.mjs` — 4 stages: `analyze`, `security`, `performance`, `report`.
- `comprehensive-test.workflow.mjs` — 4 stages: `planning`, `codegen`, `testgen`, `documentation`.
- `e2e-feature-coverage.workflow.mjs` — diamond DAG exercising every script feature (used for E2E test coverage).

### Anatomy

Abridged from `e2e-feature-coverage.workflow.mjs`:

```js
import { workflow } from '@generatorai/workflow-spec/builders';

export default workflow('E2E Feature Coverage Workflow')
  .description('Diamond DAG exercising every script feature')
  .tags(['e2e-test', 'script'])
  .variable('topic', { type: 'string', label: 'Topic', required: true, defaultValue: 'workflow scripting' })
  .variable('enable_tests', { type: 'boolean', label: 'Generate Tests', required: false, defaultValue: true })
  .session({ model: 'claude-sonnet-4.6' })

  // Inline hook functions become `function` hooks; the loader registers the handlers.
  .hook('on_run_start', async (ctx) => ({ proceed: true, message: `Run ${ctx.runId} started` }))

  .stage('classify', (s) => s
    .name('Classify Topic')
    .prompt('Classify "{{topic}}". Return JSON { "category": string, "keywords": string[] }.')
    .context({ mode: 'none' })
    .output({ format: 'json', schema: { type: 'object', required: ['category', 'keywords'] } })
    .timeouts({ attemptMs: 120_000 }))

  .stage('summarize', (s) => s
    .name('Branch A — Summarize')
    .prompt('Summarize "{{topic}}". Begin with SUMMARY_OK.')
    .contextFrom(['classify'], 'summary')
    .rule({ type: 'contains', value: 'SUMMARY_OK', message: 'starts with SUMMARY_OK' })
    .retry({ maxAttempts: 2, initialDelayMs: 1000, backoffMultiplier: 2 })
    .hook('pre_run', async (ctx) => ({ proceed: true })))

  .stage('keywords', (s) => s
    .name('Branch B — Keywords')
    .guard('variables.enable_tests')
    .prompt('List keywords for "{{topic}}".'))

  .stage('synthesize', (s) => s
    .name('Final Synthesis')
    .prompt('Synthesize both branches.')
    .contextFrom(['summarize', 'keywords'], 'output'))

  // Edges connect stage keys; `on` defaults to 'success'.
  .edge('classify', 'summarize')
  .edge('classify', 'keywords')
  .edge('summarize', 'synthesize')
  .edge('keywords', 'synthesize', { on: 'completion' }); // still runs when the guard skips `keywords`

// Run profiles (ScriptRunProfile): name, description?, variables, permissionMode?,
// stageOverrides?: [{ stageKey, skip?, variables? }]
export const profiles = [
  {
    name: 'quick-surface',
    description: 'Skip Branch B.',
    variables: { topic: 'quick surface', enable_tests: false },
    permissionMode: 'bypassPermissions',
    stageOverrides: [{ stageKey: 'keywords', skip: true }],
  },
  {
    name: 'thorough-with-overrides',
    variables: { topic: 'thorough run' },
    stageOverrides: [{ stageKey: 'summarize', variables: { override_marker: 'branch-a-override' } }],
  },
];
```

`permissionMode` is one of `plan`, `default`, `acceptEdits`, `bypassPermissions`. A profile with any other field is invalid and skipped with a warning.

### Lifecycle

`WorkflowScriptLoader` runs at boot (and on `POST /api/workflow-scripts/reload`):

1. Reads `*.workflow.mjs` in each script directory (nothing, when scripts are disabled).
2. Dynamic-imports each (30 s timeout; the path must stay inside a script directory).
3. Builds the default export with `buildWithHandlers()` — which validates the graph with `validateWorkflow` — or validates a plain document.
4. Validates each profile with `ScriptRunProfileSchema`; an invalid profile is skipped.
5. Registers the inline hook handlers with the `HookExecutor` under generated names (`script:<workflow>:<stage key|workflow>:<phase>:<n>`).
6. Indexes the script by id = file name without `.workflow.mjs`. A script that fails to load is logged and skipped; it does not block boot.

### APIs

```
GET  /api/workflow-scripts                   → ScriptMetadata[]
GET  /api/workflow-scripts/:id               → { metadata, graph }
GET  /api/workflow-scripts/:id/profiles      → ScriptRunProfile[]
POST /api/workflow-scripts/:id/materialize   → 201 { definitionId, definition, stageCount, edgeCount } (a draft)
                                                body: { name?, projectId? }
POST /api/workflow-scripts/:id/run           → 202 { definitionId, runId, status: 'running' }
                                                body: { profileName?, variables?, projectId? }
POST /api/workflow-scripts/validate          → { valid, errors }   body: { path }
POST /api/workflow-scripts/reload            → { count, scripts, scriptsEnabled }
POST /api/workflow-scripts/:id/reload        → ScriptMetadata
POST /api/workflow-scripts/upload            → 201 ScriptMetadata   body: { filename, source }
```

`/:id/run` needs `write:workflows` + `exec:agent`. `upload` needs `admin:settings` **and** `GENERATORAI_ALLOW_SCRIPT_UPLOAD=true` with scripts enabled; a shipped script cannot be replaced by an upload.

> **Wire detail:** the run endpoint accepts `profileName` (not `profile`). The profile's `variables` are merged under the request's `variables`; its `stageOverrides` (by stage key) ride in the run's `__stageOverrides` variable, with any `__stageOverrides` from the request appended; its `permissionMode` is set on the run before it starts.

### Materialize vs Run

- **Materialize** — creates a **draft** definition from the script's graph (tagged `script:<id>`, optionally renamed and bound to a project) through the one materializer, `WorkflowDefinitionService.createFromSpec`. After this it is a normal definition: edit, publish, version.
- **Run** — creates a **published** definition from the graph the same way, then creates and starts a run. Only `run` applies a profile.

---

## 3. UI

### Templates (Settings → Templates, `Catalogs.tsx`)
Cards for each template (name, category, description). **Use** calls `POST /api/workflow-definitions/import { templateId }` and opens the new definition in the builder.

### Scripts page (`ScriptsListPage.tsx` + `ScriptDetailPage.tsx`)
Lists all `.workflow.mjs` cards; **Reload** (top-right) hits `POST /api/workflow-scripts/reload`. Each detail page shows:
- Stages (name and key, first prompt).
- Edges (`from → to (on)`).
- Run Profiles (description, permission mode); click one to select it.
- **Run Script** — `POST /api/workflow-scripts/:id/run` with the selected profile.
- **Materialize** — creates a draft definition.

---

## 4. CLI

```powershell
generatorai script list                                    # all loaded scripts
generatorai script show <script>                           # metadata + graph summary
generatorai script profiles <script>                       # just the profiles
generatorai script validate <file>                         # validate a file without registering it
generatorai script materialize <script> [--name <n>] [--project <id>]
generatorai script run <script> [--profile <name>] [--watch] [--verbosity <v>]
generatorai script reload [script]                         # re-scan disk
generatorai template list | show <template>
generatorai workflow import --template <id> [--publish]    # a definition from a template
```

---

## 5. SDK

```typescript
const ai = await createGeneratorAI({
  harness: 'copilot',
  scriptsDir: './workflows',     // *.workflow.mjs are discovered here at startup
});

// List loaded scripts
const scripts = ai.scripts.list();

// Reload after edits
await ai.scripts.reload();

// Validate a file before saving
const result = await ai.scripts.validate('./workflows/new.workflow.mjs');
if (!result.valid) console.error(result.errors);

// Materialize (published) and run it yourself …
const def = await ai.scripts.materialize('my-script-id', { name: 'My copy' });
const run = await ai.workflows.run(def.id, { variables: { topic: 'AI' } });

// … or materialize and run in one call (profile variables merged under `variables`)
const run2 = await ai.scripts.run('my-script-id', { profileName: 'fast', variables: { topic: 'AI' } });
```

Unlike the server route, `ai.scripts.run` applies only a profile's `variables`, not its `stageOverrides` or `permissionMode`; and `ai.scripts.materialize` publishes the definition.

> The SDK constructs its `WorkflowScriptLoader` without the `enabled` option, and the loader defaults to disabled, so as of this writing the SDK loads no scripts (`list()` is empty).

---

## 6. Edge cases & gotchas

1. **Script id is the file name** — `my-flow.workflow.mjs` has id `my-flow`; the workflow's display name comes from `workflow('…')`.
2. **The same file name in both script directories** — the last one loaded wins.
3. **Validation failure at boot** — script is skipped; visible in `system health` output. Fix the file and `POST /api/workflow-scripts/reload`.
4. **Hot reload during a running script** — running runs continue (they pin the definition version they started from). Subsequent reads of `script list` reflect the new file; a single-script reload that fails keeps the previous version.
5. **`profile.stageOverrides` match by `stageKey`** — an override whose key matches no stage is silently ignored.
6. **`profile.permissionMode = 'plan'`** — every tool call awaits approval. Set this only for HITL workflows; otherwise the run hangs forever.
7. **Materialize never applies a profile** — it creates a draft from the script's graph as built. Variables are supplied at run time.
8. **Variable type mismatch** — script declares `type: 'number'` but profile/runtime passes a string → run creation fails. Error includes the variable name.
9. **`script` hooks in PWS** — same allowlist applies; `cmd.exe` is rejected.
10. **`function` hooks referencing unregistered handlers** — fail at execute time with `HookError`. Always register handlers before they fire.
11. **Profiles accept only** `name`, `description`, `variables`, `permissionMode` and `stageOverrides`; any other field (for example `sessionMode`, `selectedCodebases`, `runName`) makes the profile invalid and it is skipped.

---

## 7. Authoring a new template

### JSON template

Create `templates/system/my-template-workflow.json` (the `-workflow.json` suffix is required):

```json
{
  "id": "my-template",
  "category": "custom",
  "graph": {
    "formatVersion": 2,
    "workflow": {
      "name": "My Template",
      "description": "…",
      "tags": ["custom"],
      "session": { "model": "claude-sonnet-4.6" },
      "variables": [{ "name": "topic", "type": "string", "label": "Topic", "required": true }]
    },
    "stages": [
      { "kind": "agent", "key": "step_1", "name": "Step 1", "prompts": [{ "label": "Do it", "text": "Do {{topic}}" }] }
    ],
    "edges": []
  }
}
```

Restart the server → it loads via `TemplateRegistry` (an invalid graph fails boot in development). An easy way to get a valid, canonical `graph` is to build the workflow in the app and `GET /api/workflow-definitions/:id/export`.

### PWS

Create `templates/scripts/my.workflow.mjs` using the builder pattern above. Use `POST /api/workflow-scripts/reload` to pick it up without restarting.

---

## 8. Relationship matrix

| | JSON template | PWS script | Workflow definition (DB) | Workflow run |
|---|---|---|---|---|
| Storage | filesystem (`templates/system/*-workflow.json`) | filesystem (`templates/scripts/*.workflow.mjs`) | `workflow_definitions` table | `workflow_runs` table |
| Mutability | read-only | read-only (file-edit then reload) | mutable (draft/published, versions) | pins a definition version |
| Created by | repo / user-drop | repo / user-drop / upload | import (graph or `templateId`) OR materialize-from-script OR create | `createRun` / `startRun` |
| Run directly | no (import it first) | yes (`script run`) | yes (`run start`) | n/a |
| Profiles | n/a | yes (`export const profiles`) | n/a | applied at start |
