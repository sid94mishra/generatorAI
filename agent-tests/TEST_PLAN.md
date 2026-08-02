# GeneratorAI — End-to-End Test Suite Plan

Consolidated from subagent discovery across all layers (2026-06-12). Full per-layer inventories live in [discovery/](discovery/):
- [discovery/web-ui-inventory.md](discovery/web-ui-inventory.md) — every Web UI scenario, the **stable-selector audit**, determinism hazards, gap list.
- [discovery/core-packages-inventory.md](discovery/core-packages-inventory.md) — core/db/shared/providers feature + coverage + gaps.
- [discovery/sdk-cli-inventory.md](discovery/sdk-cli-inventory.md) — SDK facade API + CLI commands + gaps.

---

## 1. Layers & test technology

| Layer | Tech | Location | Run |
|---|---|---|---|
| Core engine + packages | Vitest (unit/integration, in-memory SQLite + mock harness) | `packages/*/__tests__` | `pnpm turbo test` |
| SDK (`packages/sdk`) | Vitest, `createTestGeneratorAI()` + `MockHarness` | `packages/sdk/src/__tests__` | `pnpm --filter @generatorai/sdk test` |
| CLI (`apps/cli`) | Vitest + `ink-testing-library`, mocked `HttpPlatformClient` | `apps/cli/src/__tests__` | `pnpm --filter @generatorai/cli test` |
| Web UI | Playwright (driven/derived via the **playwright-cli** skill) | `agent-tests/*.spec.ts` | `cd agent-tests && pnpm test` |

---

## 2. Web UI — deterministic Playwright strategy (the hard part)

**Root blocker discovered:** there are **0 `data-testid` attributes** across all 147 `apps/web` components. Tests today rely on role/text selectors, which work for navigation but are fragile for the DAG canvas, run controls, streaming blocks, and forms.

**Decisions (the "right approach"):**
1. **Add a stable selector layer** — `data-testid` on the elements the selector audit flagged (nav, list cards, builder save/add-stage, stage-properties fields, run controls, runtime DAG nodes, streaming message blocks, chat input/messages, automation/project/settings forms, modals, toasts). Added incrementally per spec, not all at once.
2. **Seed via API, don't click-to-create for setup.** Use REST on `:3100` to create definitions/runs/chats/projects before a UI test, then assert the UI renders them. Reliable + fast. (`fixtures/api.ts`)
3. **AI runs are non-deterministic (content, cost, time).** Two modes:
   - **Mocked mode (default for CI):** `page.route('**/api/**')` intercepts run/stream endpoints to replay a fixed SSE event sequence → deterministic streaming/handoff/state assertions with no model cost.
   - **Live mode (opt-in via `E2E_LIVE=1`):** runs the real agent; asserts only on **status transitions + block structure + file presence**, never exact content.
4. **Assert on status transitions and structure, not generated text.** e.g. stage `pending→running→completed`, "3 tool calls" group present, `src/x.ts` exists — not the prose.
5. **Waits:** `waitForLoadState('load')` (never `networkidle` — SSE never settles); poll for specific `data-testid` elements with explicit timeouts; `waitForTimeout(300)` only for React Flow layout/debounce settle.
6. **Stable keys:** testids keyed by backend ids (`stage-node-{id}`), never nth-child/index.

**How playwright-cli is used:** as the *authoring aid* — open the live app, `snapshot` to read the accessibility tree + element refs, derive the correct role/testid selector, confirm the interaction, then encode it into a deterministic `*.spec.ts`. (It is not the runtime; Playwright Test is.)

---

## 3. Web UI scenario matrix (spec files)

| Spec file | Scenarios | Setup | Determinism |
|---|---|---|---|
| `navigation.spec.ts` | sidebar → every page; collapse/expand; breadcrumb; 404 | none | role/testid |
| `dashboard.spec.ts` | stat cards, quick actions, recent panels, empty states | seed chats/runs | testid |
| `workflows-crud.spec.ts` | list, search, create-from-template, Upload JSON, delete, bulk-select | seed defs | testid |
| `workflow-builder.spec.ts` | name, add stages, connect edges (all 4 types), stage props (model/reasoning/prompts/skills/mcp), execution tab (condition+expression, timeout, retry, validation rules, hooks), **Validate catches undefined {{var}} + missing prompts**, Save persists | build in UI | testid + waits |
| `workflow-run.spec.ts` | seed+start run; status transitions; runtime DAG node colors; per-stage messages (prompt/response/usage); **tool-call blocks**; timeline; handoff summary; resumability (reload replays) | seed def + **mocked SSE** | status/structure |
| `workflow-run-controls.spec.ts` | start/pause/resume/cancel(confirm)/retry; per-stage controls; HITL plan-mode approve/reject | seed run + mock | testid |
| `conditional-routing.spec.ts` | failure-routing DAG: validation fail → on_failure runs, on_success skipped, on_completion runs | seed failure-routing def + mock | status |
| `scripts.spec.ts` | list scripted workflows, run-with-defaults | seed scripts | testid |
| `automations.spec.ts` | list; create each trigger (manual/schedule/webhook) × input mode (single/loop/batch/script); enable/disable; run-now; rotate token; batch parse preview; script test | UI form | testid |
| `templates.spec.ts` | list, search, Use Template → builder | none | testid |
| `chats.spec.ts` | list, search, status filter, bulk delete, archive; create dialog; detail loads | seed chats | testid |
| `chat-streaming.spec.ts` | send prompt; streaming render (text/thinking/tool blocks); model + reasoning-effort selectors; stop | mocked SSE (+ live opt-in) | status/structure |
| `projects.spec.ts` | list, create, detail tabs (codebases/artifacts/settings); add codebase; settings fields | seed project | testid |
| `settings.spec.ts` | tabs; theme switch (light/dark/system); provider view; copilot state; health/advanced | none | testid |
| `error-states.spec.ts` | empty states, toasts on error, validation messages, server-down banner | route-mock errors | testid |

Existing `browser-ui-e2e.spec.ts` (16 passing) is the smoke baseline; these specs supersede/expand it.

---

## 4. Core / packages Vitest gaps (prioritized)

Existing coverage is GOOD on DAGScheduler, DAGValidator, EventBus, StreamBroker, SessionAllocator, state machines, HookExecutor, WorkflowRunLifecycle.e2e. **HIGH-priority gaps to add:**

- `ConditionEvaluator.test.ts` — edge expressions (and/or/not, numeric compares, dotted vars, parse errors → fail-safe false).
- `interpolation.test.ts` (shared) — dotted paths, `{{ ws }}` trimming, undefined → literal, depth limit, object→JSON.
- `ResultValidator.test.ts` — contains/not_contains/min_length/max_length/regex/custom_script + failure routing.
- StageExecutionService — retry+backoff (multiplier^attempt), retry exhaustion, timeout abort, **extractCodeBlocks classification** (file vs prose, bare-path-first-line, untitled→extracted/), **agent-wrote-files → skip fence scrape**.
- providers — **availableTools resolution: empty/[]/['*']/list** (the bug we fixed), event-mapper tool_start/complete + reasoning_delta/complete.
- WorkflowRunService — pause/resume/cancel/retry, transaction atomicity.
- EventBus — concurrent per-session serialization, persist-failure gap tracking, subscriber-throw isolation.
- DAGScheduler — diamond dependency join, mid-run definition-hash cache invalidation.

MED/LOW: WorkflowScriptLoader, ProjectConfigService, WebhookService, db migrations idempotency, telemetry.

Harness: in-memory `Mock*Repository` (`packages/core/__tests__/MockRepositories.ts`), `MockAgentHarness`, in-memory SQLite via `migrateDB(drizzle(new Database(':memory:')))`.

---

## 5. SDK Vitest gaps (no tests exist today)

`createTestGeneratorAI()` + `MockHarness` from `@generatorai/sdk/testing`. Per facade:
- `GeneratorAI.create()/shutdown()` lifecycle (copilot/claude/prebuilt; migrations; idempotent shutdown).
- WorkflowFacade: create (stages+edges, unknown localId, dup names), run/orchestrate, stream (replay+live+terminal), pause/resume/cancel/retry/status.
- ChatFacade, ScriptFacade (materialize+run, profile merge), AutomationFacade (trigger, batch/loop, error policy), Event/Tool/Hook/Hitl/Workspace (resolvePath traversal), ProjectFacade (codebase link/fetch/worktree).

---

## 6. CLI Vitest gaps (no tests exist today)

`ink-testing-library` for TUI; mock `HttpPlatformClient` (fetch stub) for commands.
- Commands: workflow/chat/run/automation/project/script/orchestrator/config/system groups — happy path + ID-prefix resolution + `--json` vs table + error exit codes.
- `HttpPlatformClient`: endpoint mapping, 401/404/5xx handling, retry/backoff, SSE parse.
- `loadConfig`: 5-layer precedence (defaults→user→project→env→flags), profiles.
- TUI: view routing, keyboard nav, live event updates.

---

## 7. Phasing

1. **Phase 1 (this PR):** Web UI infra (config/fixtures/api/mock-SSE) + testids batch-1 + navigation/workflows-crud/builder/run specs running green; core HIGH-gap unit tests (ConditionEvaluator, interpolation, ResultValidator, providers availableTools).
2. **Phase 2:** remaining Web UI specs + testids; SDK facade tests.
3. **Phase 3:** CLI command + client + config + TUI tests; core MED/LOW gaps.
4. **CI:** wire `agent-tests` into a Playwright CI job (web+server spun up); keep `pnpm turbo test` for unit/integration.
