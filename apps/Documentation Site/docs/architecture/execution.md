---
title: Execution and durability
description: How chat turns, workflow stages, automations, and live events flow through the runtime.
---

# Execution and durability

The server coordinates execution through explicit services and state machines. Clients start work and observe it; provider completion, stored chat history, workflow status, and visible streaming output are related but separate responsibilities.

## Chat turn lifecycle

```text
Client message + attachments + selected agent/model/mode
   → authenticated chat route and schema validation
   → ChatManagementService resolves agent and workspace configuration
   → provider conversation creation/resume through IAgentHarness
   → prompt dispatch + tools + human-input requests
   → normalized AgentEvents
   → EventBus / StreamBroker durable append
   → SSE live delivery and transcript updates
   → terminal outcome, checkpoints and configured post-turn work
```

`ChatManagementService` combines several concerns that must agree for a turn to work:

1. Resolve the chat's agent projection, model/provider selection, skill/MCP references, overrides, and permission mode.
2. Resolve actual execution directories through workspace mounts. The directory shown to the user, used by the provider, and opened by terminal/source-control tools must refer to the same source.
3. Bind or resume a provider conversation with a bounded creation/resume deadline.
4. Supply supported built-in tools, hook/policy bridges, attachments, and turn context.
5. Normalize the provider stream into application events and persist the resulting user/assistant history.
6. Record final state and run enabled workspace/checkpoint/source-control follow-up behavior.

Automatic source-control behavior is configuration-dependent; a normal chat turn does not unconditionally commit or push code. The relevant code lives in `services/scm/AutoSourceControlRunner.ts` and the chat configuration.

## Human decisions

Plan documents and revisions, questions, and permission requests are first-class state rather than ephemeral dialogs. `PlanService` and `AgentInteractionService` persist the records that clients render and answer. `HitlService` supplies interrupt/resume behavior for workflow execution.

Application plan modes and provider-native plan modes are not equivalent capabilities. GeneratorAI may construct a plan workflow/prompt/tool policy while the selected provider does not support native plan-mode switching. UI choices must follow the effective provider capabilities and warnings.

Computer-use consent is a separate authority from ordinary agent execution. Approving a question or tool request does not automatically authorize control of the physical desktop.

Workflow completion review currently releases its stage concurrency permit while waiting, but retains the live `executeStage` frame, allocated agent session, awakeable bookkeeping, and timer. Fully suspending the stage and re-entering it on approval without retaining those resources is not implemented. Durable decision records and recovery therefore do not imply zero-resource waiting; see the approval loop in `StageExecutionService.ts`.

## Workflow execution

A workflow definition contains stage definitions, directed edges, variables/defaults, and orchestration configuration. A run stores a definition snapshot so an edit to the reusable definition does not silently rewrite an in-flight graph.

| Component | Responsibility |
| --- | --- |
| `WorkflowDefinitionService` | Definition CRUD and graph-level validation |
| `WorkflowRunService` | Run state, stage runs, lifecycle operations and scheduling coordination |
| `DAGScheduler` | Pure readiness/skip/terminal decisions plus repository-backed reconciliation |
| `StageExecutionService` | Prepare a stage session, execute the selected harness, capture output and settle state |
| `SessionAllocator` | Decide session reuse/allocation and persist ownership mappings |
| `WorkflowPreprocessor` | Resolve variables and pre-execution configuration/source setup |
| `WorkflowOrchestrator` | Workspace/repository preparation, hooks, cleanup and post-processing |
| `ResultValidator` | Validate configured outputs and surface validation failures |
| `WorkflowScriptLoader` | Discover/import/validate programmatic workflow definitions and hooks |

Parallel graph branches can run concurrently subject to global session/stage/provider limits. Parallel edges are not a guarantee that all stages will start simultaneously.

### Edge semantics

The scheduler centralizes readiness in `resolveStageReadiness` and `reconcileDAG`.

| Edge type | Activates when its predecessor is… |
| --- | --- |
| `on_success` | Completed |
| `on_failure` | Failed |
| `on_completion` | Completed or failed |
| `always` | Any terminal state, including skipped or cancelled |

Only pending stages can become ready or skipped, and all predecessors must first be terminal. An inactive edge from a predecessor with a real outcome can veto a join; an inactive edge from a skipped branch does not activate or veto it. At least one inbound edge must activate a non-root stage. Stage conditions are evaluated against the relevant outcome/variables.

This matters for a diamond graph: if one required success branch fails, the join should be skipped or routed by explicit failure/completion edges instead of remaining pending forever. These are source-defined semantics, not generic assumptions about DAG libraries.

## Automation execution

`AutomationService` binds a trigger to one or more workflows and an input/iteration policy. `DataSourceResolver` resolves batch/script inputs; `IterationPlanner` shapes the work; executions track their associated workflow runs. Manual, schedule, and webhook triggering share execution bookkeeping, idempotency, and recovery concerns.

`AutomationRecoveryService` reconciles interrupted executions and idempotency records before scheduling resumes. Durable iterations are created up front, atomically claimed, and settled individually. A lease identifies a running iteration whose worker disappeared, allowing recovery to make it eligible again under the execution rules.

Retry policy is distinct from arbitrary re-execution of side effects. A retried automation can invoke a workflow again; a durable effect replay decision controls whether a partially completed operation may safely run twice.

## Durable operation model

`DurableExecutionEngine` uses mutable `registers` and append-oriented `entries`:

```text
Commit intent and stable output identifiers
   → perform effect
   → commit settlement and advance operation state
```

On recovery, a stored settlement is reused. An intent without settlement is uncertain: safe/read-only work can be replayed, while non-repeatable work uses `replay: never` and produces a recoverable error outcome instead of silently repeating it.

The engine also provides named signals, one-time awakeables, compare-and-swap register updates, and leased iteration claiming. The server exposes selected resolution paths through its routes. This is a persistence mechanism for the execution engine; it is not a claim of exactly-once behavior for arbitrary network services or shell commands.

## Live events and reconnects

The production server wires `EventBus` to `StreamBroker` as the durable session event store. The broker:

- Commits an event before broadcasting it.
- Maintains monotonic sequence numbers per scope (`session`, `run`, `chat`, `global`).
- Supports replay after a cursor and communicates expired/truncated resumes.
- Applies bounded connection queues and ordered-event backpressure.
- Filters known noise while preserving user-visible content.

`apps/server/src/routes/stream.ts` provides unified SSE, replay, ticket, and multiplexed subscription operations. Multiplexing allows one physical connection to carry multiple logical subscriptions. It does not mean cross-tab connection sharing is shipped; the capability ledger currently marks that false.

`packages/client-core/src/stream/` owns event reduction and stream routing shared across clients. High-latency surfaces can buffer partial text to completed Markdown blocks, show typing state, and flush before ordered events or turn completion. This changes delivery cadence without intentionally losing ordered content.

## Recovery and shutdown

Startup reconciles interrupted sessions/turns, automations, durable work, and pending workflow post-processing. Workspace/resource cleanup is ordered. Shutdown flushes EventBus/stream writers and tears down managed services and child processes, with bounded fallback flushing during fatal failures.

A client disconnect is not necessarily a cancellation. Reopening a chat must recover authoritative state and resume its event stream. Conversely, a provider process crash is not a successful empty answer: provider adapters and recovery services need to surface an explicit terminal or recoverable failure.

## Source evidence

`packages/core/src/services/ChatManagementService.ts`, `WorkflowRunService.ts`, `StageExecutionService.ts`, `DAGScheduler.ts`, `WorkflowOrchestrator.ts`, `AutomationService.ts`, `AutomationRecoveryService.ts`, `DurableExecutionEngine.ts`, `InterruptedTurnRecoveryService.ts`, and `StartupRecoveryService.ts`; `packages/core/src/events/EventBus.ts`; `apps/server/src/routes/stream.ts`; `apps/server/src/composition-root.ts`.

Related: [Data and storage](./data-and-storage.md), [Providers](./providers.md), [Transport](./transports.md), and [Feature guides](../features/index.md).
