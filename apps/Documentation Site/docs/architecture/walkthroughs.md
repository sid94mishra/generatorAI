# End-to-end architecture walkthroughs

These traces link user actions, configuration, execution, persistence and rendering. They describe the current architecture rather than asserting that every optional provider or native process was run in this documentation task. The [module inventory](./modules.md) covers every application and shared package; the [configuration map](../configuration/index.md) links their settings.

## A chat prompt becomes a reviewed code change

```text
Composer + source/model/agent selections
  → platform/client-core API
  → client-runtime credentials + client-transport route
  → Express authentication, scopes and chat route validation
  → chat management, agent resolution and execution services
  → workspace mounts + harness/provider session
  → provider events and tool interactions
  → durable repositories + event streaming
  → shared client reducer → transcript, plan, changes and tool panes
```

For the [planning-chat example](../configuration/examples.md#create-a-planning-chat), the host resolves the source to its own filesystem, binds the configured provider and applies chat/agent policy. The per-turn `mode` can override the chat default. A provider's actual capabilities still constrain the resulting session. Uploads use the chat prompt route's multipart handling; internal attachment references are created from uploaded files.

A question or approval becomes a persisted interaction linked to that execution. A plan edit includes its revision so concurrent changes can produce a conflict instead of an unnoticed overwrite. After implementation, the changes service compares the intended workspace/baseline, checkpoints provide inspection/restore primitives, and review comments retain file/line anchors. Source control is a separate operation over those changes.

Configuration to inspect: [chat fields](../configuration/chats.md), [agent fields](../configuration/agents.md), [browser](../configuration/browser.md), device scopes and host capabilities. Failure boundaries include invalid input, source preparation, authentication, provider readiness, tool permissions and stream disconnection. A disconnected client is not proof that server execution stopped.

Sources: `apps/server/src/routes/chats.ts`, `packages/core/src/services/{ChatManagementService,AgentResolver,AgentStagingService}.ts`, `packages/client-core/src/stream/`, `packages/agent-harness-providers/src/`, and the `changes`, `checkpoints`, `review` packages.

## A workflow graph becomes gated stage executions

```text
Builder/import → definition + stage/edge records
  → run request + variables + profile overrides
  → workspace preparation + DAG scheduling
  → stage execution + resolved context/provider/tools
  → result validation or human review gate
  → success/failure/completion edge evaluation
  → next eligible stages → aggregate run outcome
```

The [reviewed delivery example](../configuration/examples.md#import-a-multi-stage-brownfield-workflow) uses explicit stage indices in its import edges. The stored graph uses persisted IDs after import. A run profile names a saved definition and supplies run-time overrides; it is not an import payload.

The orchestrator schedules dependency-ready stages, while the stage execution service owns prompts, provider sessions, timeouts and result handling. Context policies determine what predecessors contribute to a stage. Waiting for human review releases scheduling capacity but retains execution state and its relevant session/timing context. Review outcomes can approve, request changes or reject; failure edges and required-success dependencies determine what happens next.

Hooks and executable workflow scripts are separate extensibility paths. Hook schema acceptance is not a guarantee that an arbitrary command succeeds. Validation labels also have implementation limits: the current JSON/LLM validation paths must be understood from the [run guide](../features/workflow-runs.md), not inferred from their names.

Sources: `packages/core/src/services/WorkflowOrchestrator.ts`, `packages/core/src/services/engine/StageExecutor.ts`, `packages/shared/src/config/WorkflowDefinitionSchemas.ts`, `apps/server/src/routes/{workflowDefinitions,workflowRuns,workflowScripts}.ts`.

## An automation fans input into child runs

```text
Manual / scheduled / webhook trigger
  → trigger policy and overlap/missed-run handling
  → data source or saved/request dataset
  → schema checks + row/group/single iteration planning
  → bounded iteration queue
  → workflow child runs + retries/error policy
  → execution history and aggregate status
```

The [typed automation example](../configuration/examples.md#run-a-typed-dataset-through-a-workflow) uses each-row iteration. A grouped variant changes the variable envelope and number of iterations. Preview is useful because parsing a dataset, planning iterations and executing workflows are different stages with different failure modes.

`maxConcurrency` bounds iterations; workflow stage parallelism and host session limits impose additional bounds. Automation retries and stage retries are distinct and can multiply execution attempts. `onError: stop` changes continuation policy, but a trigger returning successfully does not establish that all child runs finished successfully. Scheduled schema-driven pipelines need their default dataset at trigger time.

Configuration: [automation fields](../configuration/automations.md), [server scheduler/session settings](../configuration/server.md), [feature behavior](../features/automations.md). Sources: automation services under `packages/core/src/services/`, `apps/server/src/routes/automations.ts`, shared cron utilities and automation schemas.

## The same host is used by desktop, web, mobile and CLI

Desktop wraps the React renderer in Electron and manages native lifecycle/IPC plus a local or selected remote host. Web runs the shared renderer without those native capabilities. Mobile uses Expo/React Native and native key/storage/navigation adapters. CLI/TUI uses the shared client stack with terminal-specific presentation and configuration.

All remote client paths need host identity, credentials, transport selection and capability scopes. Direct routes, optional relay forwarding and native IPC are not equivalent trust boundaries. The live relay can observe forwarded content; encryption helper availability is not evidence of end-to-end encryption through that relay.

A client can restore its own layout/theme while showing host state from a different server. Conversely, changing a host preference can affect several connected clients without synchronizing their local appearance or microphone choices. See [transports](./transports.md), [security](./security.md), [processes](./processes.md) and [settings scopes](../configuration/projects-and-settings.md).

## An extension widget crosses an isolated UI boundary

An installed extension's entry module registers active contributions through its API. Widget instances carry an owning execution, state, schema and declared actions. The renderer loads widget content through the isolated widget asset origin and mediates messages through the bridge; capability checks remain at the service/RPC boundary.

Changing a widget form is therefore different from changing a host setting: instance state is scoped to that widget, while a tool action may request a separate host operation. Missing assets, failed handshakes, denied permissions and extension reloads have different recovery paths. See [extension architecture](./extensions.md), [widget contracts](../configuration/widgets.md) and [manifest configuration](../configuration/extensions.md).

## Recovery, retention and observability

SQLite repositories are the operational state authority. Event/replay storage supports reconnecting views; it is not interchangeable with filesystem checkpoints, Git commits or optional DeltaLog output. Each retention policy targets its own objects. Removing old event payloads does not automatically remove a workspace, and deleting a workspace is not a database backup operation.

Use a trace/run/chat identifier to correlate host logs, stage state, provider events and client rendering. Telemetry export requires both configuration and a reachable collector. Optional agent/PTY host processes have explicit enablement paths; standalone browser/CUA host implementations are not proof that the default execution uses them. See [data/storage](./data-and-storage.md), [voice and observability](./voice-and-observability.md) and [deployment](../operations/deployment.md).
