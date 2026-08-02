# SDK + CLI — Test Inventory

## PART A — SDK (`packages/sdk`)

`GeneratorAI.create(config)` (GeneratorAI.ts:179-389) → wires facades; `shutdown()` (143-161) flushes/closes. Facades (all readonly props):

- **WorkflowFacade** (WorkflowFacade.ts): create(stages+edges, 82-133), list, get, createRun, run (create+start), orchestrate, stream (replay+subscribe AsyncGenerator 207-254), pause/resume/cancel/status/retry/deleteRun.
- **ChatFacade**: create, send (fire-and-forget), onMessage, list, get, archive.
- **ScriptFacade**: list/get/validate/reload/reloadScript, materialize (.workflow.mjs→def, 76-135), run (materialize+start), setScriptLoader.
- **AutomationFacade**: create/list/get/trigger/update/delete/enable/disable/getExecution.
- **EventFacade**: onAll/onRun/onSession/replay/emit.
- **ToolFacade**: register/unregister/list/has/setRegistry.
- **ProjectFacade**: project CRUD; codebase link/unlink/fetch/listBranches/listFiles/getFileContent; worktree create/remove/list; config upload/list/get/update/delete.
- **HookFacade**: register/unregister/has/list (function hooks).
- **HitlFacade**: interrupt/resume/cancelWaiter.
- **WorkspaceFacade**: create/findByOwner/get/list/complete/archive/delete/resolvePath (traversal guard)/commit/trackArtifact.

**Existing tests: NONE.** Harness: `createTestGeneratorAI(overrides?)` + `MockHarness` from `@generatorai/sdk/testing` (temp DB, in-memory event bus). 

**Gaps** HIGH: create()/shutdown() lifecycle (copilot/claude/prebuilt, migrations, idempotent); WorkflowFacade create/run/orchestrate/stream/status transitions; ChatFacade flow; ProjectFacade codebase+worktree. MED: error cases (missing edges/unknown localId), ScriptFacade materialize+profile-merge, AutomationFacade batch/loop+error-policy, Hook/Hitl/Workspace (resolvePath traversal). LOW: concurrency/tx, DAG cycles, streaming dup/out-of-order.

## PART B — CLI (`apps/cli`)

Commander program (index.tsx); 13 command groups (commands/index.ts). Key commands:
- **workflow**: list/create/show/update/delete/validate/export/import; stage add/update/delete; edge add/delete (--type); from-template; template list/create; config.
- **chat**: list/create/show/send(--no-stream,--verbosity,--thinking)/messages/watch/delete.
- **run**: list/start(--var,--profile,--watch,--permission-mode)/show/watch/messages; hitl mode/pending/resume(--approve/--reject); stage pause/resume/retry/cancel; profile generate/validate/list; workspace.
- **automation**: list/create(--trigger,--schedule,--input-mode,--loop-*,--batch-*,--data-source)/get/trigger/update/delete/enable/disable.
- **project**, **script**, **orchestrator**, **config** (5-layer precedence), **system** (health/models/status/artifacts/mcp-servers), **tui**, **init**, **completions**, **webhook**, **workspace**, **harness**.

Platform client: **HTTP** mode (REST + SSE, withRetry, Bearer/apiKey) via `createClient.ts`; Direct mode = TODO (CLI-1). `HttpPlatformClient` ~105 endpoint methods.

Config precedence: defaults → ~/.generatorai/config.json → ./.generatorai/config.json → env (GENERATORAI_*) → CLI flags. Named profiles.

**Existing tests: NONE** (`tui-e2e.test.tsx` referenced but absent). Harness: `ink-testing-library`; mock fetch / `HttpPlatformClient`; capture stdout/stderr/exit.

**Gaps** HIGH: command happy paths (workflow/chat/run/project) + `--json`/table + ID-prefix resolution; loadConfig 5-layer precedence + profiles; HttpPlatformClient CRUD + 401/404/5xx. MED: command edge cases (ambiguous prefix, missing arg, bad --var), TUI render+keyboard nav+live updates, SSE connect/reconnect/filter. LOW: Direct mode (when impl), perf/large lists, MCP/webhook.
