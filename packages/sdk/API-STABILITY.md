# `@generatorai/sdk` — API Stability & Versioning

This document defines what is covered by the SDK's semantic-versioning contract,
so you know what is safe to build on and what can change underneath you.

## TL;DR

- **Build on the stable surface** (the package root `@generatorai/sdk` +
  `@generatorai/sdk/testing`). It follows semver.
- **The advanced surface** (`@generatorai/sdk/internal` and the `services` /
  `orchestrator` / `streamBroker` instance fields) is **not** covered by semver
  and can change in any minor release. Pin an exact version if you use it.

## Stable surface (semver-protected)

Exported from `@generatorai/sdk`:

- `createGeneratorAI(config)` / `GeneratorAI` — factory, `initialize()`,
  `shutdown()`, `config`.
- The **facades** and their option/return types:
  `workflows`, `chat`, `automations`, `scripts`, `events`, `tools`, `projects`,
  `hooks`, `hitl`, `workspaces`, plus the `tool()` helper.
- **Configuration**: `GeneratorAIConfig`, `ResolvedConfig`, `LoggerConfig`,
  `SandboxConfig`.
- **Builders**: `WorkflowBuilder`, `StageBuilder`.
- **Domain types** re-exported from `@generatorai/shared` (e.g.
  `WorkflowDefinition`, `WorkflowRun`, `Chat`, `ChatMessage`, `Automation`,
  `PersistedEvent`, `HookDefinition`, …).
- **Errors**: `GeneratorAIError`, `ValidationError`, `HarnessConnectionError`.
- **State machines**: `WorkflowRunStateMachine`, `StageRunStateMachine`,
  `SessionStateMachine` (pure, dependency-free).
- **Bring-your-own-harness**: the `IAgentHarness` interface and the harness
  provider types (`HarnessType`, `HarnessProviderConfig`). Implement
  `IAgentHarness` and pass the instance as `config.provider` to run on any
  harness you like.
- The testing entry point `@generatorai/sdk/testing` (`MockHarness`,
  `createTestGeneratorAI`).

Within a `0.x` line we treat **minor** as the breaking-change boundary and
**patch** as non-breaking; from `1.0.0` onward, standard semver applies (breaking
changes only in majors). Deprecations are marked with `@deprecated` JSDoc for at
least one minor before removal.

## Advanced / unstable surface (NOT semver-protected)

Exported from `@generatorai/sdk/internal`, and the `@internal`-tagged instance
fields `ai.services`, `ai.orchestrator`, `ai.streamBroker`:

- `CoreServices` / `CoreServicesInputs`
- The raw service classes (`WorkflowOrchestrator`, `StreamBroker`,
  `ProjectService`, `WorkspaceManager`, `HitlService`, `DurableSleepService`, …)
- Repository / infrastructure ports (`ISessionRepository`,
  `IWorkflowRunRepository`, `IScriptRunner`, …) other than `IAgentHarness`
- DAG utilities (`buildDAG`, `validateDAG`, `topologicalSort`,
  `getExecutionLayers`, `evaluateCondition`)

These exist for power users composing the engine directly. They can change —
including breaking changes — in any minor release. If you depend on them, pin an
exact SDK version and expect to adjust on upgrade.

## Durability note (important for embedders)

Workflow runs are driven by an in-process scheduler backed by the durable SQLite
state. If your host process restarts, `initialize()` auto-resumes interrupted
runs from the database (in-flight stages re-run at-least-once). Make stage side
effects idempotent where possible. This behaviour is part of the stable
contract; the mechanism (`StartupRecoveryService` etc.) is not.
