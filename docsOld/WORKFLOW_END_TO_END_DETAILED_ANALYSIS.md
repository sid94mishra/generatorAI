# GeneratorAI Workflow System: End-to-End Detailed Analysis

## Purpose

This document provides complete end-to-end coverage of the workflow subsystem in GeneratorAI, including:

- Workflow definition CRUD (create, read, update, delete)
- Template and JSON import/export flows
- Script/template upload and usage model
- Workflow-level settings and options
- Stage-level settings and options
- Stage handoff and DAG edge semantics
- Hook system (Harness-level vs GeneratorAI-level)
- Event model and streaming behavior
- Validation and retry/failure logic
- Workflow run execution flow and run profiles
- Web UI vs CLI behavior for runs
- Concrete examples for multi-stage workflows with hooks, conditions, validation, and retry

This is based on code-level analysis of the current codebase.

---

## 1. Architectural Model

At a high level, GeneratorAI uses a DAG-based orchestration model:

1. A workflow definition contains stages and edges.
2. A workflow run is an execution instance of that definition.
3. The DAG scheduler computes which stages are ready.
4. Stage execution runs prompts through an AI harness session.
5. Outputs are validated, summarized, persisted, and handed off.
6. Events are persisted and streamed to clients (Web UI and CLI).

### Core layers

- API routes (server): accept CRUD and run commands
- Service layer (core): business logic and orchestration
- Repositories (db): persistence via Drizzle + SQLite
- Shared types/schemas: strict Zod and TypeScript contracts
- Clients (web/cli): create definitions, launch runs, stream progress

---

## 2. Data Model (Core Tables and Responsibilities)

Primary schema file:

- packages/db/src/schema.ts

### 2.1 workflow_definitions

Represents a reusable DAG definition.

Key columns include:

- id
- name
- description
- version
- sessionMode (`single | per-stage | auto`)
- harnessConfig (JSON)
- variables (JSON)
- tags (JSON)
- hooks (JSON)
- orchestratorConfig (JSON)
- createdAt
- updatedAt

### 2.2 stage_definitions

Represents stage nodes belonging to a workflow definition.

Key columns include:

- id
- workflowDefinitionId
- name
- description
- order
- prompts (JSON)
- harnessConfigOverrides (JSON)
- variables (JSON)
- hooks (JSON)
- retryPolicy (JSON)
- timeoutMs
- condition (JSON)
- contextFilter
- contextSources (JSON)
- outputFormat (`text | json`)
- outputSchema (JSON)
- resultValidation (JSON)
- expectedOutput
- agentName
- iterationConfig (JSON)
- createdAt
- updatedAt

### 2.3 stage_edges

Represents DAG edges between stages.

Key columns include:

- id
- workflowDefinitionId
- fromStageId
- toStageId
- edgeType (`on_success | on_failure | on_completion | always`)

### 2.4 workflow_runs

Represents runtime instances of workflow execution.

Key columns include:

- id
- definitionId
- status
- masterSessionId
- variables (runtime)
- permissionMode
- createdAt
- startedAt
- completedAt

### 2.5 stage_runs

Represents runtime execution records per stage.

Key columns include:

- id
- workflowRunId
- stageDefinitionId
- status
- retryCount
- error
- summary
- outputData (JSON)
- artifactManifest (JSON)
- wakeAt
- sleptSince
- interruptData (HITL)
- version (optimistic locking)

---

## 3. Workflow Definition CRUD: End-to-End

Primary route file:

- apps/server/src/routes/workflowDefinitions.ts

Primary service file:

- packages/core/src/services/WorkflowDefinitionService.ts

### 3.1 Create workflow definition

Endpoint:

- POST /api/workflow-definitions

Flow:

1. Request validated through schema
2. Service creates definition record
3. Defaults applied (tools/streaming/session behavior as configured)
4. Persisted by repository
5. Definition returned

### 3.2 Read/list definitions

Endpoints:

- GET /api/workflow-definitions
- GET /api/workflow-definitions/:id

Behavior:

- List supports filtering (for example project scoping)
- Single definition fetch can include stages and edges via service join/assembly logic

### 3.3 Update definition

Endpoint:

- PATCH /api/workflow-definitions/:id

Behavior:

- Applies patch-like updates for mutable definition fields
- Increments version
- Clears DAG cache for that definition to avoid stale scheduling topology

### 3.4 Delete definition

Endpoint:

- DELETE /api/workflow-definitions/:id

Behavior:

- Cascading cleanup (edges, stages, then definition)
- FK behavior + service-level ordering keeps consistency

### 3.5 Stage CRUD (within definition)

Endpoints:

- POST /api/workflow-definitions/:id/stages
- PUT /api/workflow-definitions/:id/stages/:stageId
- DELETE /api/workflow-definitions/:id/stages/:stageId

Behavior:

- Stage creation auto-computes order if not explicitly fixed
- Stage update supports all stage-level options
- Stage delete removes connected edges and invalidates DAG cache

### 3.6 Edge CRUD (within definition)

Endpoints:

- POST /api/workflow-definitions/:id/edges
- DELETE /api/workflow-definitions/:id/edges/:edgeId

Behavior:

- Adds/removes directed transitions between stages
- Changes invalidate DAG cache

### 3.7 Definition validation endpoint

Endpoint:

- POST /api/workflow-definitions/:id/validate

Behavior:

- Runs DAG validation (cycle checks, invalid references, self edges, etc.)
- Returns validation status + error details

---

## 4. Templates, JSON Import/Export, and Script Sources

### 4.1 Template registry and loading

Key file:

- packages/core/src/services/TemplateRegistry.ts

Boot-time loading (composition root) loads templates from configured directories including system templates.

System template directory:

- templates/system/

Examples:

- code-generation-workflow.json
- code-review-workflow.json
- test-generation-workflow.json
- refactoring-workflow.json
- e2e-testing-workflow.json

### 4.2 Template APIs

Template route file:

- apps/server/src/routes/templates.ts

Endpoints:

- GET /api/templates
- GET /api/templates/:id

### 4.3 Import from template

Endpoint:

- POST /api/workflow-definitions/import

Input:

- templateId
- optional name override

Behavior:

1. Resolve template by id
2. Create definition
3. Create stages in template order
4. Map template edge indices to real stage ids
5. Persist and return definition

### 4.4 Import from JSON

Endpoint:

- POST /api/workflow-definitions/import-json

Validation schema file:

- packages/shared/src/config/WorkflowDefinitionSchemas.ts

Behavior:

1. Validate JSON structure with Zod
2. Pre-check edge indices
3. Create definition/stages/edges
4. Validate resulting DAG
5. On error, cleanup created data to avoid partial imports

### 4.5 Export as template

Endpoint:

- GET /api/workflow-definitions/:id/export

Behavior:

1. Load definition + stages + edges
2. Build stage-id to stage-index map
3. Convert edges to index form
4. Return normalized template object

### 4.6 Data-source scripts and workflow creation support

Directories:

- templates/data-source-scripts/
- templates/scripts/

Use model:

- These scripts are source assets for preprocessing/hook/script-driven data enrichment.
- They are not automatically executed on upload; execution is controlled by workflow configuration (hooks/orchestrator preprocessing/script steps).

Examples found include scripts for:

- GitHub pull request retrieval
- Jira issue retrieval
- Azure DevOps work item retrieval
- Sonar issue retrieval
- Excel to JSON conversion

### 4.7 Programmatic workflow building

Builder files:

- packages/shared/src/builders/WorkflowBuilder.ts
- packages/shared/src/builders/StageBuilder.ts

Capabilities:

- Build definitions with fluent API
- Add variables/stages/edges/hooks declaratively
- Output full workflow definition payload for API persistence

---

## 5. Workflow-Level Settings: Complete Option Set

Main schema/type sources:

- packages/shared/src/config/WorkflowDefinitionSchemas.ts
- packages/shared/src/types (workflow-related types)

### 5.1 Core workflow metadata

- name
- description
- tags
- version (managed)
- projectId association

### 5.2 Session behavior

- sessionMode:
  - single
  - per-stage
  - auto

Semantics:

- single: one session reused across all stages
- per-stage: isolated session per stage
- auto: adaptive strategy (reuse for sequential, isolate for parallel/conflicting)

### 5.3 Harness configuration (workflow default)

Common options:

- model
- streaming toggle
- reasoning effort
- system message mode and content
- available tools / excluded tools
- mcp server definitions (http/stdio)
- custom agents
- skill references

Stage can override these using harnessConfigOverrides.

### 5.4 Workflow variables

Variable definition options:

- name (identifier rule)
- type (string/number/boolean/choice/text, etc.)
- label
- description
- required
- defaultValue
- options (for choice-type)

Interpolation syntax in prompts/config templates:

- {{variableName}}

### 5.5 Workflow hooks

Workflow-level hook collection can bind to run lifecycle events, stage lifecycle events, preprocessing completion, and related orchestration milestones.

### 5.6 Orchestrator-level config

Supports orchestration concerns such as:

- category tagging
- codebase alias selection
- worktree creation behavior
- preprocessing steps
- result validation settings
- codebase requirement flags

---

## 6. Stage-Level Settings: Complete Option Set

Primary type/schema and runtime files:

- packages/shared/src/config/WorkflowDefinitionSchemas.ts
- packages/shared/src/types/StageDefinition.ts
- packages/core/src/services/StageExecutionService.ts
- packages/core/src/services/ConfigResolver.ts

### 6.1 Identity and ordering

- name
- description
- order

### 6.2 Prompts

Prompt object options include:

- label
- text
- source (`inline` or `file`)
- filePath (if source=file)
- attachments
- waitForCompletion

Multiple prompts per stage are supported and sent in sequence.

### 6.3 Harness overrides at stage level

- harnessConfigOverrides merges over workflow-level harnessConfig
- allows per-stage model/tool/agent/system behavior customization

### 6.4 Stage-local variables

- variables object for stage-specific runtime context
- merges into effective interpolation context

### 6.5 Hooks at stage level

- hooks collection with phase/type/failure policy/timeout/priority
- executed around stage lifecycle milestones and tool/prompt activities

### 6.6 Retry and timeout

- retryPolicy:
  - maxRetries
  - backoffMs
  - backoffMultiplier
- timeoutMs

### 6.7 Conditions and gating

condition supports:

- always
- on_success
- on_failure
- expression

Expression evaluation supports logical and comparison operators with a safe parser.

### 6.8 Context handoff controls

- contextFilter options:
  - full
  - summary-only
  - none
  - structured
- contextSources (optional stage names for explicit handoff source selection)

### 6.9 Output controls

- outputFormat:
  - text
  - json
- outputSchema (JSON schema for structured output)
- expectedOutput (human expectation guidance)
- resultValidation rules

### 6.10 Agent and delegation controls

- agentName
- stage-level skill/agent references where supported by schema/runtime

### 6.11 Iteration/sub-loop behavior

- iterationConfig
- supports repeated execution over mapped inputs with controlled parallelism and output aggregation

---

## 7. Stage Handoffs, Edges, and Conditional Transitions

Core files:

- packages/core/src/services/DAGScheduler.ts
- packages/core/src/domain/dag/ConditionEvaluator.ts
- packages/core/src/services/WorkflowRunService.ts

### 7.1 Edge types

- on_success
- on_failure
- on_completion
- always

Meaning:

- on_success: triggers when upstream stage completes successfully
- on_failure: triggers when upstream stage fails
- on_completion/always: triggers on terminal completion regardless of success/failure (depending on semantics adopted in route/service logic)

### 7.2 Readiness logic

A stage becomes ready only when:

1. All required predecessor states are terminal as required by edge semantics
2. Edge conditions evaluate truthy

### 7.3 Condition expression engine

The evaluator uses a safe tokenizer/parser/executor approach (not eval), supporting:

- booleans
- comparison operators
- logical operators
- parenthesis grouping
- dotted variable paths

On parse/eval failure, behavior is fail-safe (non-triggering).

### 7.4 Handoff payload model

From completed predecessors, runtime gathers:

- summary (text)
- outputData (structured json when available)

Injection depends on contextFilter:

- summary-only: summary text only
- full: broader completion output context
- structured: explicit structured output block
- none: no predecessor context injection

---

## 8. Hook System: Harness Hooks vs GeneratorAI Hooks

Main files:

- packages/core/src/domain/ports/IHookBridge.ts
- packages/shared/src/types/HookDefinition.ts
- packages/core/src/services/HookExecutor.ts
- packages/core/src/services/HookInterceptor.ts

### 8.1 Harness-level hooks

Purpose:

- Direct integration-level interception in SDK/harness flow

Typical phases:

- pre_tool_use
- post_tool_use
- user_prompt_submit
- session_start
- session_end
- error_occurred

Capabilities:

- allow/deny tool call
- mutate arguments
- inject/alter prompt/session-level data
- inspect or redirect tool/result flow

### 8.2 GeneratorAI-level hooks

Purpose:

- Platform lifecycle automation around workflow/stage milestones

Common phases include:

- pre_prompt
- post_prompt
- on_error
- on_cancel
- on_session_start
- on_session_end
- on_run_start
- on_run_complete
- on_run_failed
- on_stage_completed
- on_preprocessing_complete
- on_pr_created (when relevant)

### 8.3 Hook types

- script
- http
- function

#### Script hooks

- Execute command + args (sandbox/runner constraints)
- Receives context via env and payload
- Can return structured hook result

#### HTTP hooks

- Perform outbound request (method/url/headers/body template)
- Body can interpolate variables
- Response parsed into hook result where configured

#### Function hooks

- In-process registered handler and/or module path execution model
- Used for trusted internal extension points

### 8.4 Execution behavior

- Ordered by priority
- timeout enforcement
- cancellation via abort signals
- retry with exponential backoff where configured
- failure policy per hook:
  - abort
  - skip
  - continue

### 8.5 Result merging

When multiple hooks return outputs in one phase:

- variables: later hooks overwrite same keys
- messages/attachments: appended

### 8.6 Tool denial suppression logic

Hook interceptor tracks denied tool calls so downstream completion events are suppressed, preventing false positive "tool complete" UI signals.

---

## 9. Event System and Streaming

Primary files:

- packages/shared/src/types/AgentEvent.ts
- packages/core/src/events/EventBus.ts
- packages/core streaming/broker services

### 9.1 Event categories

Broad groups include:

- harness token/tool/message/reasoning/usage/error events
- workflow_run lifecycle events
- stage_run lifecycle events (including sleeping/awaiting_input)
- hook lifecycle events
- session lifecycle events
- artifact/script/git/permission events

### 9.2 Persistence and ordering

EventBus behavior:

- Persist event first
- Broadcast after persistence
- Sequence ordering maintained via per-session serialized queues

This is critical for deterministic replay and UI de-duplication.

### 9.3 SSE streaming model

Unified endpoint pattern:

- GET /api/stream?scope=<scope>&id=<id>

Supports Last-Event-ID style replay for reconnect continuity.

---

## 10. Validation Logic: Full Coverage

Main files:

- packages/core/src/domain/dag/DAGValidator.ts
- packages/core/src/domain/dag/ConditionEvaluator.ts
- packages/shared/src/config/WorkflowDefinitionSchemas.ts
- packages/core/src/services/ResultValidator.ts

### 10.1 Definition-time validation

- Schema validation for workflow and stage payloads (Zod)
- DAG constraints:
  - cycle detection
  - self-edge rejection
  - invalid reference rejection
  - duplicate edge checks
  - disconnected/orphan warnings/errors as configured

### 10.2 Runtime/stage result validation

Validation rules include patterns such as:

- contains
- not_contains
- min_length
- regex
- json_schema
- llm_validation
- custom_script
- max_length (where configured)

For JSON format stages, expected structured output extraction + schema match are enforced.

### 10.3 API input validation

All major create/update/import endpoints use strict schemas before service execution.

### 10.4 JSON column safety validation

Repository layer validates/parses JSON columns defensively on write/read.

---

## 11. Retry and Failure Handling: Full Coverage

Main files:

- packages/core/src/services/StageExecutionService.ts
- packages/core/src/services/WorkflowOrchestrator.ts
- packages/core/src/domain/state-machines/WorkflowRunStateMachine.ts
- packages/core/src/domain/state-machines/StageRunStateMachine.ts
- packages/shared/src/errors/index.ts

### 11.1 Two retry planes

1. Harness/interaction retry (format/schema adherence retries at stage execution layer)
2. Orchestrator validation retry (post-validation retries with backoff and requeue)

### 11.2 Retry configuration

- Stage retryPolicy controls max retries and backoff
- Exponential backoff formula based on attempt count and multiplier
- Validation feedback is injected into subsequent attempts

### 11.3 Failure categorization and propagation

Error hierarchy includes categories such as:

- harness
- network
- process
- storage
- validation
- state
- resource
- hook
- not_found

Failure propagation behavior:

- failed stage triggers edge-type-based downstream decisions
- some downstream stages become skipped/unreachable
- workflow terminal state determined from aggregate stage outcomes

### 11.4 State machines

Workflow run transitions include:

- created
- starting
- running
- paused/resumed
- cancelling/cancelled
- completed
- failed

Stage run transitions include:

- pending
- queued
- running
- paused/resumed
- sleeping/woken
- awaiting_input (HITL)
- completed
- failed
- cancelled
- skipped

### 11.5 Optimistic concurrency

stage_runs version increments prevent conflicting concurrent updates during retries/pause/resume races.

---

## 12. Human-in-the-Loop (HITL) and Permission Modes

Run-level permission mode options:

- bypassPermissions
- default
- acceptEdits
- plan

When user approval is needed:

1. Stage enters awaiting_input
2. interruptData persisted
3. Awaiting-input event emitted
4. Resume endpoint processes decision
5. Stage continues or terminates accordingly

Resume endpoint pattern:

- POST /api/workflow-runs/:runId/stages/:stageId/resume

---

## 13. Workflow Run Profiles and Runtime Overrides

Key file:

- packages/shared/src/types/RunProfile.ts

Run profile contains reusable launch configuration:

- variables
- stageOverrides
- sessionMode override
- permissionMode override
- project/codebase selection
- prompt/skill/agent file references

### 13.1 Stage override options

Typical per-stage override fields:

- timeoutMs
- contextFilter
- agentName
- variables
- skip

### 13.2 Effective config precedence (runtime)

1. Workflow definition defaults
2. Stage definition overrides
3. Run profile / launch-time overrides
4. Hook-injected runtime variable overlays

---

## 14. Run Execution Flow (End-to-End)

Main files:

- packages/core/src/services/WorkflowRunService.ts
- packages/core/src/services/WorkflowOrchestrator.ts
- packages/core/src/services/DAGScheduler.ts
- packages/core/src/services/StageExecutionService.ts
- packages/core/src/services/SessionAllocator.ts

### 14.1 Start flow

1. Create workflow run record
2. Materialize stage run rows
3. Start orchestration async
4. Scheduler identifies root/ready stages

### 14.2 Stage execution flow

1. Stage state transitions to running
2. Pre hooks execute
3. Prompts resolved/interpolated and sent to harness
4. Streaming events emitted
5. Outputs extracted (text/json)
6. Artifacts saved
7. Post hooks execute
8. Validation executed
9. Retry or terminal transition decided

### 14.3 Multi-stage DAG coordination

- Parallel branches execute concurrently where DAG allows
- Join stages wait for all required predecessor conditions
- Handoff context assembled from predecessor summaries/outputs

### 14.4 Completion

- Run completes when all stage runs are terminal
- Terminal status computed from stage outcomes and cancellation/failure logic

---

## 15. Web UI vs CLI: How Run Profiles and Execution Are Used

### 15.1 Web UI

Main areas:

- workflow list/builder pages
- workflow run page (dag graph + timeline + artifacts + messages)
- SSE subscription for live run updates

Key behavior:

- Visual DAG editing and validation
- Mutation hooks for CRUD/import/export/run actions
- Realtime run monitoring with event stream and reconnect handling

### 15.2 CLI

Main command file:

- apps/cli/src/commands/run.ts

Representative command shapes:

- run list
- run start <definitionId> --var key=value --profile path --watch
- run show <runId>
- run watch <runId>
- run messages <runId>

Profile behavior:

- profile JSON parsed and validated
- merged with CLI flags
- effective run payload sent to server
- watch mode subscribes to run stream and renders events in terminal

---

## 16. Complete Practical Example

### Scenario

A four-stage workflow:

1. Analyze codebase
2. Run security scan
3. Run test generation
4. Produce final report

DAG:

- Analyze -> Security (on_success)
- Analyze -> TestGen (on_success)
- Security -> Report (on_success)
- TestGen -> Report (on_success)

### Settings used

Workflow-level:

- sessionMode: auto
- model: provider default model override
- variables: repoUrl (required), targetBranch (optional)
- hooks: on_run_start (notify), on_run_complete (publish summary)

Stage-level:

- Analyze:
  - contextFilter: none
  - outputFormat: json
  - outputSchema: project analysis schema
- Security:
  - contextFilter: structured
  - retryPolicy: maxRetries=2, backoffMs=2000, multiplier=2
  - resultValidation: contains/no high-risk finding format check
- TestGen:
  - harness override: specialized model/toolset
  - timeoutMs: elevated
- Report:
  - contextFilter: full
  - expectedOutput: markdown summary with sections

Runtime:

- run profile sets permissionMode=acceptEdits
- stage override sets Report timeout longer

### Execution outcome flow

1. Analyze completes with structured JSON
2. Security + TestGen run in parallel with handoff from Analyze
3. If Security validation fails first pass, retry executes with injected feedback
4. Report waits for both branches and receives combined context
5. Workflow emits completion events and artifacts

---

## 17. What "Upload Templates and Scripts" Means in This System

### Template upload/import

- Templates are loaded from configured filesystem directories and exposed by template APIs.
- Workflow creation from templates occurs via import endpoint mapping template definitions into persisted workflow entities.

### JSON upload/import

- Full workflow definitions can be uploaded as JSON through import-json endpoint with strict schema validation and atomic-like cleanup on failure.

### Script upload/use

- Script files live in templates/script locations or project paths.
- Scripts become operational when referenced by:
  - hook definitions (script type)
  - preprocessing/orchestrator steps
  - validation custom_script rules

There is no blind auto-execution on file presence.

---

## 18. Critical Reliability/Safety Characteristics

- Deterministic DAG scheduling with explicit edge semantics
- Cache invalidation on topology changes
- Strong schema validation for API payloads
- Defensive JSON column handling at persistence layer
- Event commit-before-broadcast for replay consistency
- Optimistic locking on stage runs for concurrency safety
- Durable HITL interrupt state

---

## 19. Quick Reference: Key Files by Concern

Workflow CRUD:

- apps/server/src/routes/workflowDefinitions.ts
- packages/core/src/services/WorkflowDefinitionService.ts

Template system:

- apps/server/src/routes/templates.ts
- packages/core/src/services/TemplateRegistry.ts
- templates/system/

Schema and validation:

- packages/shared/src/config/WorkflowDefinitionSchemas.ts
- packages/core/src/domain/dag/DAGValidator.ts
- packages/core/src/domain/dag/ConditionEvaluator.ts
- packages/core/src/services/ResultValidator.ts

Run orchestration:

- packages/core/src/services/WorkflowRunService.ts
- packages/core/src/services/WorkflowOrchestrator.ts
- packages/core/src/services/DAGScheduler.ts
- packages/core/src/services/StageExecutionService.ts
- packages/core/src/services/SessionAllocator.ts

Hooks:

- packages/shared/src/types/HookDefinition.ts
- packages/core/src/services/HookExecutor.ts
- packages/core/src/services/HookInterceptor.ts
- packages/core/src/domain/ports/IHookBridge.ts

Events/streaming:

- packages/shared/src/types/AgentEvent.ts
- packages/core/src/events/EventBus.ts

Web/CLI usage:

- apps/web/src/stores/workflowBuilderStore.ts
- apps/web/src/hooks/workflowQueries.ts
- apps/web/src/pages/WorkflowRunPage.tsx
- apps/cli/src/commands/run.ts

---

## 20. Final Notes

This document covers all requested dimensions from definition authoring through runtime execution and monitoring, including exhaustive option surfaces for workflow and stage configurations, hook/handoff models, event semantics, validation, retry, failure handling, and run profile behavior across Web and CLI.

If you want, the next step can be a second companion document that contains only copy-paste-ready API payload examples for every endpoint and setting combination.
