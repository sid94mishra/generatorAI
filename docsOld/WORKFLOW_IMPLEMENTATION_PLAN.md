# GeneratorAI — Workflow & Chat Implementation Plan (v2)

> **Date**: February 28, 2026  
> **Architecture Document**: [WORKFLOW_ARCHITECTURE.md](./WORKFLOW_ARCHITECTURE.md)  
> **Estimated Total Effort**: ~393 hours (~49 days)  
> **Phases**: 10 phases with dependency ordering

---

## Phase Overview

| Phase | Name | Tasks | Est. Hours | Dependencies |
|-------|------|-------|-----------|-------------|
| P0 | Shared Types & Schema | 16 | 27h | None |
| P1 | Domain Layer (State Machines + DAG) | 12 | 36h | P0 |
| P2 | Infrastructure (Repositories + Migration) | 14 | 41h | P0, P1 |
| P3 | Core Services | 19 | 80.5h | P1, P2 |
| P4 | Server API Routes | 16 | 40h | P3 |
| P5 | Web UI — Chat Features ✅ | 12 | 36h | P4 |
| P6 | Web UI — Workflow Builder | 16 | 52h | P4 |
| P7 | Web UI — Workflow Runs & Monitoring ✅ | 12 | 36h | P4, P6 |
| P8 | CLI Updates ✅ | 10 | 24h | P3, P4 |
| P9 | Integration Testing & Polish ✅ | 8 | 20h | P5-P8 |

**Critical Path**: P0 → P1 → P2 → P3 → P4 → P6 → P7 → P9 (~320h)

---

## Phase 0: Shared Types & Schema (24h) ✅ COMPLETE

> Establish the type foundation and database schema for the new entity model.

### P0.1 — New Domain Types (4h)
- **File**: `packages/shared/src/types/Chat.ts`
- **Task**: Define `Chat`, `ChatStatus`, `CreateChatParams` interfaces
- **Acceptance**: Types exported from `@generatorai/shared`

### P0.2 — WorkflowDefinition Types (4h)
- **File**: `packages/shared/src/types/WorkflowDefinition.ts`
- **Task**: Define `WorkflowDefinition`, `WorkflowSessionMode`, `CreateWorkflowDefinitionParams`, `VariableDefinition` (name, type, label, description, required, defaultValue, options), `WorkflowDefinitionWithStages` compound type
- **Acceptance**: Types exported, Zod schemas for validation

### P0.3 — StageDefinition Types (4h)
- **File**: `packages/shared/src/types/StageDefinition.ts`
- **Task**: Define `StageDefinition`, `StageEdge`, `StageEdgeType`, `PromptDefinition`, `RetryPolicy`, `StageCondition`, `CreateStageParams`, `CreateEdgeParams`. Reuse existing `HookDefinition` from `@generatorai/shared`.
- **Acceptance**: Types exported, Zod schemas for all creation params

### P0.4 — WorkflowRun & StageRun Types (3h)
- **File**: `packages/shared/src/types/WorkflowRun.ts`
- **Task**: Define `WorkflowRun`, `WorkflowRunStatus`, `StageRun`, `StageRunStatus`, `WorkflowRunWithStages` compound type
- **Acceptance**: All runtime types exported

### P0.5 — Revised Session Types (3h)
- **File**: `packages/shared/src/types/Session.ts` (MODIFY)
- **Task**: Add `ownerType`, `ownerId`, `conversationId` to `Session` interface. Add new `SessionStatus` values (`created`, `active`, `paused`, `closed`, `error`). Keep old `Session` type as `SessionV1` alias for backward compat. Define v1→v2 status mapping: `starting→created`, `running→active`, `completed→closed`, `cancelled→closed`, `cancelling→active`, `deleted→closed`. Add `@deprecated` JSDoc to old status values. Keep both `completedAt` and `closedAt` during transition.
- **Acceptance**: Old code still compiles, new fields available, status mapping exported

### P0.6 — New Event Kinds (3h)
- **File**: `packages/shared/src/types/AgentEvent.ts` (MODIFY)
- **Task**: Add `chat.*`, `workflow_run.*`, `stage_run.*` event kinds to discriminated union. Add factory functions and type guards.
- **Acceptance**: `createAgentEvent()` supports all new event kinds

### P0.7 — Database Schema Updates (3h)
- **File**: `packages/db/src/schema.ts` (MODIFY)
- **Task**: Add Drizzle schema definitions for 6 new tables (`chats`, `workflow_definitions`, `stage_definitions`, `stage_edges`, `workflow_runs`, `stage_runs`). Add new columns to existing tables. Note: `workflows.conversation_id` semantics change — sessions now own conversations, not workflows. The existing `workflows.conversation_id` values must be migrated to `sessions.conversation_id` in Phase P2.11.
- **Acceptance**: Schema compiles, matches SQL in architecture doc

### P0.8 — Database Migration (2h)
- **File**: `packages/db/src/index.ts` (MODIFY)
- **Task**: Add `CREATE TABLE IF NOT EXISTS` for new tables and `ALTER TABLE ... ADD COLUMN` for existing table changes in `migrateDB()`.
- **Acceptance**: Migration runs idempotently, all new tables/columns created

### P0.9 — Shared Index Exports (1h)
- **File**: `packages/shared/src/index.ts` (MODIFY)
- **Task**: Re-export all new types from barrel file
- **Acceptance**: `import { Chat, WorkflowDefinition, ... } from '@generatorai/shared'` works

### P0.10 — New Error Types (1h)
- **File**: `packages/shared/src/errors/index.ts` (MODIFY)
- **Task**: Add `DAGValidationError` (category: `validation`, severity: `warning`, recoverable: `true`), `SessionAllocationError` (category: `resource`, severity: `error`, recoverable: `true`), `StageExecutionError` (category: `execution`, severity: `error`, recoverable: `false`)
- **Acceptance**: Error classes exported with correct categories and HTTP mappings

### P0.11 — WorkflowDefinition Zod Schemas (2h)
- **File**: `packages/shared/src/config/WorkflowDefinition.ts` (NEW)
- **Task**: Create comprehensive Zod schemas for `CreateWorkflowDefinitionSchema`, `CreateStageSchema`, `CreateEdgeSchema`, `WorkflowDefinitionSchema` (full validation including variable definitions)
- **Acceptance**: All API request bodies validatable via Zod

### P0.12 — Chat Zod Schemas (1h)
- **File**: `packages/shared/src/config/Chat.ts` (NEW)
- **Task**: Create `CreateChatSchema` Zod schema
- **Acceptance**: Chat creation request body validatable

### P0.13 — Constants Updates (0.5h)
- **File**: `packages/shared/src/constants/index.ts` (MODIFY)
- **Task**: Add max stages per workflow (50), max edges per workflow (200), max concurrent stage sessions (10)
- **Acceptance**: Constants exported

### P0.14 — Unit Tests for Types (1.5h)
- **Files**: `packages/shared/__tests__/types.test.ts`, `packages/shared/__tests__/schemas.test.ts`
- **Task**: Test Zod schema validation for all new types (valid + invalid cases)
- **Acceptance**: All schema tests pass

### P0.15 — IPlatformClient Interface Updates (1h)
- **File**: `packages/shared/src/types/IPlatformClient.ts` (MODIFY)
- **Task**: Extend `IPlatformClient` with new method signatures for chat operations (`createChat`, `archiveChat`, `sendChatPrompt`, `listChats`, `getChatHistory`) and workflow operations (`createDefinition`, `listDefinitions`, `createRun`, `startRun`, `pauseRun`, `resumeRun`, `cancelRun`, `listRuns`)
- **Acceptance**: Both `HttpPlatformClient` and `DirectPlatformClient` will implement new methods in later phases

### P0.16 — Config Barrel Exports (0.5h)
- **File**: `packages/shared/src/config/index.ts` (MODIFY)
- **Task**: Re-export new Zod schemas from `WorkflowDefinition.ts` and `Chat.ts`
- **Acceptance**: `import { CreateWorkflowDefinitionSchema } from '@generatorai/shared/config'` works

---

## Phase 1: Domain Layer — State Machines & DAG (36h) ✅ COMPLETE

> Implement the core domain logic: state machines, DAG validation, and port interfaces.

### P1.1 — Session State Machine (Revised) (3h)
- **File**: `packages/core/src/domain/state-machines/SessionStateMachineV2.ts` (NEW)
- **Task**: Implement 6-state machine (`created`, `active`, `paused`, `closing`, `closed`, `error`) with 9 transitions. The `closing` state ensures no new prompts are accepted while SDK abort/destroy calls are in progress. Each transition maps to specific Copilot SDK method calls:
  - `sys:activate` → `copilot.createConversation()`
  - `user:pause` → `copilot.abortConversation()` (abort in-flight turn)
  - `user:resume` → `copilot.resumeConversation()` if handle lost
  - `user:close` → `copilot.abortConversation()` + `copilot.destroyConversation()`
  - `sys:cleanup_done` → (cleanup complete)
  - `sys:error` → (SDK already errored)
  - `sys:recover` → `copilot.resumeConversation()`
  Keep V1 for backward compat.
- **Acceptance**: All transitions validated, invalid transitions throw `InvalidTransitionError`. Each transition documents which SDK method it implies.

### P1.2 — WorkflowRun State Machine (4h)
- **File**: `packages/core/src/domain/state-machines/WorkflowRunStateMachine.ts` (NEW)
- **Task**: Implement 8-state, 10-transition state machine per architecture doc
- **Acceptance**: Comprehensive transition table tests (valid + invalid transitions)

### P1.3 — StageRun State Machine (4h)
- **File**: `packages/core/src/domain/state-machines/StageRunStateMachine.ts` (NEW)
- **Task**: Implement 8-state machine (including `skipped`) with `isTerminal`, `validTransitions` helpers
- **Acceptance**: All transitions tested

### P1.4 — DAG Validator (6h)
- **File**: `packages/core/src/domain/dag/DAGValidator.ts` (NEW)
- **Task**: Implement:
  - `validateDAG(stages, edges)`: cycle detection via Kahn's algorithm, reachability check, self-edge check, duplicate edge check
  - `topologicalSort(stages, edges)`: returns ordered stage IDs
  - `getExecutionLayers(stages, edges)`: returns stages grouped by execution layer (parallel groups)
- **Acceptance**: Tests cover: valid DAGs, cycles, disconnected nodes, self-edges, diamond dependencies, complex branching

### P1.5 — DAG Data Structures (2h)
- **File**: `packages/core/src/domain/dag/types.ts` (NEW)
- **Task**: Define `DAG`, `StageNode`, `DAGValidationResult`, execution layer types
- **Acceptance**: Types exported

### P1.6 — Port Interfaces — New Repositories (4h)
- **Files**: `packages/core/src/domain/ports/IChatRepository.ts`, `IWorkflowDefinitionRepository.ts`, `IStageDefinitionRepository.ts`, `IStageEdgeRepository.ts`, `IWorkflowRunRepository.ts`, `IStageRunRepository.ts` (NEW)
- **Task**: Define:
  - `IChatRepository` — CRUD + list by status
  - `IWorkflowDefinitionRepository` — CRUD + list 
  - `IStageDefinitionRepository` — CRUD + list by definition + reorder
  - `IStageEdgeRepository` — CRUD + list by definition + getByStage
  - `IWorkflowRunRepository` — CRUD + list by definition/status
  - `IStageRunRepository` — CRUD + list by run + updateStatus + batch operations
- **Acceptance**: All interfaces match schema, exported from `@generatorai/core`

### P1.7 — Port Interfaces — New Services (2h)
- **File**: `packages/core/src/domain/ports/IServiceInterfaces.ts` (NEW)
- **Task**: Define service interfaces for `ISessionAllocator`, `IDAGScheduler`
- **Acceptance**: Interfaces exported

### P1.8 — State Machine Tests (5h)
- **Files**: `packages/core/__tests__/SessionStateMachineV2.test.ts`, `WorkflowRunStateMachine.test.ts`, `StageRunStateMachine.test.ts`
- **Task**: Comprehensive state machine tests for all three machines (valid transitions, invalid transitions, terminal state checks, helper methods)
- **Acceptance**: 100% transition coverage

### P1.9 — DAG Validator Tests (4h)
- **File**: `packages/core/__tests__/DAGValidator.test.ts`
- **Task**: Tests for:
  - Simple linear DAG
  - Diamond dependency
  - Parallel stages with shared dependency
  - Cycle detection (simple, complex)
  - Self-edge rejection
  - Disconnected graph detection
  - Large DAG (50 stages)
  - Empty graph
  - Single node
- **Acceptance**: All edge cases covered

### P1.10 — Core Index Updates (0.5h)
- **File**: `packages/core/src/index.ts` (MODIFY)
- **Task**: Export all new state machines, DAG types, port interfaces
- **Acceptance**: Clean barrel exports

### P1.11 — Mock Implementations for Testing (1.5h)
- **Files**: `packages/core/__tests__/MockRepositories.ts` (NEW)
- **Task**: Create in-memory mock implementations of all 6 new repository interfaces for service-level testing
- **Acceptance**: Mocks pass basic CRUD operations

### P1.12 — Condition Evaluator (2h)
- **File**: `packages/core/src/domain/dag/ConditionEvaluator.ts` (NEW)
- **Task**: Evaluate `StageCondition` against stage run context:
  - `always` → true
  - `on_success` → parent completed
  - `on_failure` → parent failed
  - `expression` → simple expression evaluator (safe, no eval)
- **Acceptance**: Tests for all condition types

---

## Phase 2: Infrastructure — Repositories & Migration (40h) ✅ COMPLETE

> Implement database repositories and data migration logic.

### P2.1 — DrizzleChatRepository (3h)
- **File**: `packages/db/src/repositories/DrizzleChatRepository.ts` (NEW)
- **Task**: Implement `IChatRepository` with Drizzle queries
- **Acceptance**: CRUD operations, list with status filter, row mapping

### P2.2 — DrizzleWorkflowDefinitionRepository (3h)
- **File**: `packages/db/src/repositories/DrizzleWorkflowDefinitionRepository.ts` (NEW)
- **Task**: Implement `IWorkflowDefinitionRepository`
- **Acceptance**: CRUD, list, version incrementing on update

### P2.3 — DrizzleStageDefinitionRepository (3h)
- **File**: `packages/db/src/repositories/DrizzleStageDefinitionRepository.ts` (NEW)
- **Task**: Implement `IStageDefinitionRepository` with JSON field serialization
- **Acceptance**: CRUD, list by definition ordered by `order`, reorder operation

### P2.4 — DrizzleStageEdgeRepository (2h)
- **File**: `packages/db/src/repositories/DrizzleStageEdgeRepository.ts` (NEW)
- **Task**: Implement `IStageEdgeRepository`
- **Acceptance**: CRUD, list by definition, get by stage (from/to), unique constraint

### P2.5 — DrizzleWorkflowRunRepository (3h)
- **File**: `packages/db/src/repositories/DrizzleWorkflowRunRepository.ts` (NEW)
- **Task**: Implement `IWorkflowRunRepository`
- **Acceptance**: CRUD, list by definition/status, status transitions

### P2.6 — DrizzleStageRunRepository (3h)
- **File**: `packages/db/src/repositories/DrizzleStageRunRepository.ts` (NEW)
- **Task**: Implement `IStageRunRepository`
- **Acceptance**: CRUD, list by run, batch status updates, retry count increment

### P2.7 — DrizzleSessionRepository Updates (2h)
- **File**: `packages/db/src/repositories/DrizzleSessionRepository.ts` (MODIFY)
- **Task**: Add `ownerType`, `ownerId`, `conversationId` to row mapping. Add `getByOwner()` method.
- **Acceptance**: Old tests still pass, new fields populated

### P2.8 — DrizzleEventRepository Updates (1h)
- **File**: `packages/db/src/repositories/DrizzleEventRepository.ts` (MODIFY)
- **Task**: Add `workflowRunId`, `stageRunId` to event persistence and queries
- **Acceptance**: Events queryable by workflow run and stage run

### P2.9 — DrizzleChatMessageRepository Updates (1h)
- **File**: `packages/db/src/repositories/DrizzleChatMessageRepository.ts` (MODIFY)
- **Task**: Add `chatId` field, add `getByChatId()` method
- **Acceptance**: Messages queryable by chat

### P2.10 — DB Index Exports (0.5h)
- **File**: `packages/db/src/index.ts` (MODIFY)
- **Task**: Export all new repositories
- **Acceptance**: Clean barrel exports

### P2.11 — Data Migration Script (7h)
- **File**: `packages/db/src/migrations/migrate-v1-to-v2.ts` (NEW)
- **Task**: Implement migration logic:
  1. Create WorkflowDefinitions from existing template references
  2. Create StageDefinitions from existing Workflow records
  3. Create sequential StageEdges
  4. Create WorkflowRuns from existing session execution data
  5. Create StageRuns from existing workflow execution data
  6. Create Chat records for sessions with chat history
  7. Reparent sessions with `ownerType`/`ownerId`
  8. Migrate chat_messages to associate with chat_id
  9. Migrate `workflows.conversation_id` values to `sessions.conversation_id`
  10. Rewrite `sessions.status` column values using v1→v2 mapping (`running→active`, `completed→closed`, `cancelled→closed`, `starting→created`, `cancelling→active`, `deleted→closed`)
  11. Backfill `events.workflow_run_id` and `events.stage_run_id` by joining events to sessions to their new owner entities
- **Acceptance**: Existing data fully migrated, old tables still readable

### P2.12 — Repository Unit Tests (8h)
- **Files**: `packages/db/__tests__/repositories/` (NEW test files for each repository)
- **Task**: Full CRUD tests for all 6 new repositories + update tests for 3 modified repositories
- **Acceptance**: Tests use in-memory SQLite, cover edge cases (not found, duplicate, cascade delete)

### P2.13 — Migration Tests (3h)
- **File**: `packages/db/__tests__/migration.test.ts` (NEW)
- **Task**: Test migration with sample v1 data → verify v2 data integrity
- **Acceptance**: All migration paths tested

### P2.14 — DrizzleArtifactRepository Updates (1.5h)
- **File**: `packages/db/src/repositories/DrizzleArtifactRepository.ts` (MODIFY)
- **Task**: Add `workflowRunId`, `stageRunId` fields, add query methods
- **Acceptance**: Artifacts queryable by run and stage

---

## Phase 3: Core Services (72h) ✅ COMPLETE

> Implement the core business logic services.

### P3.1 — SessionAllocator Service (7h)
- **File**: `packages/core/src/services/SessionAllocator.ts` (NEW)
- **Task**: Implement session allocation logic for all three modes (`single`, `per-stage`, `auto`). Each allocation operation must handle Copilot SDK lifecycle:
  - `allocateSession()` — creates new session + calls `copilot.createConversation()` (for new sessions) or finds existing session + calls `copilot.resumeConversation()` if in-memory handle was lost (for reused sessions)
  - `releaseSession(stageRunId)` — for per-stage mode: calls `copilot.destroyConversation()` + transitions Session `active → closing → closed`. For shared mode: only releases when last stage in chain completes.
  - `releaseAll(runId)` — destroys all sessions allocated to a workflow run (used during cancel/completion)
  - Reuse detection for shared sessions in `auto` mode
  - Session cleanup on stage completion
- **Acceptance**: Unit tests for each mode, session lifecycle verified, **SDK createConversation/resumeConversation/destroyConversation calls verified per mode**

### P3.2 — ChatManagementService (8h)
- **File**: `packages/core/src/services/ChatManagementService.ts` (NEW)
- **Task**: Implement:
  - `createChat()` — creates Chat + Session, calls `copilot.createConversation()`, transitions Session `created → active`
  - `archiveChat()` — Chat `active → archived`, calls `copilot.abortConversation()` (abort in-flight), `copilot.destroyConversation()` (tear down), transitions Session `active|paused → closing → closed`
  - `sendPrompt()` — verifies Chat & Session status, calls `copilot.resumeConversation()` if in-memory handle lost (e.g. after server restart), then `copilot.sendPrompt()`. Delegates event handling to existing ChatService.
  - `getChatHistory()` — queries by chatId
  - `listChats()` — list with status filter
  - `deleteChat()` — calls `copilot.deleteConversation()` (full server-side cleanup), removes Session record, Chat record, ChatMessages
- **Acceptance**: Full chat lifecycle tested, SDK method calls verified (createConversation on create, abortConversation on archive, resumeConversation on prompt after restart, destroyConversation on archive, deleteConversation on delete)

### P3.3 — WorkflowDefinitionService (8h)
- **File**: `packages/core/src/services/WorkflowDefinitionService.ts` (NEW)
- **Task**: Implement:
  - CRUD for definitions, stages, edges
  - `validateDAG()` — delegates to DAGValidator
  - `importFromTemplate()` — converts WorkflowTemplate to WorkflowDefinition
  - `exportAsTemplate()` — converts back
  - Stage reordering
  - Version incrementing on save
- **Acceptance**: Full CRUD + validation tested, template import/export round-trips

### P3.4 — DAGScheduler Service (10h)
- **File**: `packages/core/src/services/DAGScheduler.ts` (NEW)
- **Task**: Implement:
  - `buildDAG()` — constructs in-memory DAG from definition
  - `scheduleNext()` — identifies ready stages, allocates sessions, starts execution
  - `onStageCompleted()` — evaluates edge conditions, schedules dependents
  - `onStageFailed()` — evaluates failure edges, may fail workflow
  - Helper methods: `getRootStages()`, `getReadyStages()`, `isDAGComplete()`
  - Mutex per workflow run to prevent concurrent scheduling
- **Acceptance**: Tests for linear, parallel, diamond, fan-out/fan-in patterns. Race condition tests.

### P3.5 — StageExecutionService (12h)
- **File**: `packages/core/src/services/StageExecutionService.ts` (NEW)
- **Task**: Extract and adapt prompt execution logic from existing `WorkflowService`. Each lifecycle method must call the correct Copilot SDK method:
  - `executeStage()` — calls `SessionAllocator.allocateSession()`, then `copilot.createConversation()` (new session) or `copilot.resumeConversation()` (reused/restarted), subscribes to events via `copilot.onConversationEvent()`, executes prompts via `copilot.sendPrompt()`, waits for idle, runs hooks. On completion (per-stage mode): `copilot.destroyConversation()` + Session `active → closing → closed`.
  - `pauseStage()` — StageRun `running → paused`, **calls `copilot.abortConversation(session.conversationId)`** to stop in-flight turn, Session `active → paused`, stores `currentStep` for resume
  - `resumeStage()` — StageRun `paused → running`, **calls `copilot.resumeConversation(session.conversationId)`** to re-hydrate SDK handle, Session `paused → active`, re-enters `executeStage()` from `currentStep`
  - `cancelStage()` — StageRun `running|paused → cancelled`, **calls `copilot.abortConversation()` if active** then `copilot.destroyConversation()`, Session `→ closing → closed`
  - `retryStage()` — StageRun `failed → queued`, increment retryCount, allocate fresh session with `copilot.createConversation()`, re-execute from step 0
  - Stage-level retry logic with exponential backoff
  - Timeout enforcement
  - Event emission for stage lifecycle
- **Acceptance**: Stage execution with hooks, retry on failure, timeout, pause/resume all tested. **Specifically test**: abort stops streaming, resume re-hydrates conversation, cancel fully tears down SDK session

### P3.6 — WorkflowRunService (10h)
- **File**: `packages/core/src/services/WorkflowRunService.ts` (NEW)
- **Task**: Implement:
  - `createRun()` — snapshots definition, creates StageRun records
  - `startRun()` — validates, transitions to starting, delegates to DAGScheduler
  - `pauseRun()` — WorkflowRun `running → paused`, **cascades to all running StageRuns**: calls `StageExecutionService.pauseStage()` which calls `copilot.abortConversation()` on each stage's session, transitions sessions to `paused`
  - `resumeRun()` — WorkflowRun `paused → running`, **cascades to all paused StageRuns**: calls `StageExecutionService.resumeStage()` which calls `copilot.resumeConversation()` on each stage's session, then re-schedules DAG
  - `cancelRun()` — WorkflowRun `running → cancelling`, **cascades abort+destroy to all non-terminal stages**: for running stages calls `copilot.abortConversation()` + `copilot.destroyConversation()`, for paused stages calls `copilot.destroyConversation()`, for pending/queued stages just marks cancelled. After all stopped: `cancelling → cancelled`. Calls `SessionAllocator.releaseAll(runId)` for final cleanup.
  - `deleteRun()` — cancel first if running, then `copilot.deleteConversation()` for each session (full server-side cleanup), delete all records
  - `onStageCompleted()`/`onStageFailed()` — delegates to DAGScheduler, checks run completion. On completion: destroy all remaining shared sessions.
- **Acceptance**: Full run lifecycle tested, **cascading SDK operations verified**: pause cascades abort to all stage sessions, resume cascades resumeConversation, cancel cascades abort+destroy, completion cleans up shared sessions

### P3.7 — EventBus Extensions (3h)
- **File**: `packages/core/src/events/EventBus.ts` (MODIFY)
- **Task**: Add:
  - `subscribeToWorkflowRun(runId, handler)` — filters events by workflowRunId
  - `subscribeToChat(chatId, handler)` — filters events by chatId (via session)
  - Event enrichment: auto-add `workflowRunId`/`stageRunId` context to events
- **Acceptance**: Subscriptions filter correctly, enrichment works

### P3.8 — ConfigResolver Updates (2h)
- **File**: `packages/core/src/services/ConfigResolver.ts` (MODIFY)
- **Task**: Extend to merge WorkflowDefinition copilotConfig → StageDefinition copilotConfigOverrides → runtime variable overrides
- **Acceptance**: Three-level merge tested

### P3.9 — HookInterceptor Updates (2h)
- **File**: `packages/core/src/services/HookInterceptor.ts` (MODIFY)
- **Task**: Update to accept `StageRun` context instead of `Workflow` context. Update hook phase mapping for stage events.
- **Acceptance**: Hooks fire correctly for stage lifecycle events

### P3.10 — StartupRecoveryService Updates (4h)
- **File**: `packages/core/src/services/StartupRecoveryService.ts` (MODIFY)
- **Task**: Update to recover WorkflowRuns + StageRuns + Sessions in addition to/instead of Sessions + Workflows. On startup:
  1. Find all Sessions with status `active` or `paused` → call `copilot.resumeConversation()` to re-hydrate in-memory SDK handles
  2. Find all Sessions with status `closing` → complete cleanup: `copilot.destroyConversation()` → Session → `closed`
  3. Mark running workflow runs as `paused`, running stage runs as `paused`
  4. If `resumeConversation()` fails (conversation not found in SDK): Session → `error`
- **Acceptance**: Recovery tested with mock interrupted runs, **specifically tests SDK resumeConversation() failure scenarios**

### P3.11 — ErrorHandler Updates (1h)
- **File**: `packages/core/src/services/ErrorHandler.ts` (MODIFY)
- **Task**: Add handling for `DAGValidationError`, `SessionAllocationError`, `StageExecutionError`
- **Acceptance**: Errors normalized and surfaced correctly

### P3.12 — ArtifactService Updates (1h)
- **File**: `packages/core/src/services/ArtifactService.ts` (MODIFY)
- **Task**: Add `workflowRunId`/`stageRunId` association for artifacts created during stage execution
- **Acceptance**: Artifacts queryable by run/stage

### P3.13 — Service Unit Tests — ChatManagement (3h)
- **File**: `packages/core/__tests__/ChatManagementService.test.ts` (NEW)
- **Task**: Test chat creation, archival, prompt sending, history retrieval
- **Acceptance**: All methods tested with mock repos

### P3.14 — Service Unit Tests — WorkflowDefinition (3h)
- **File**: `packages/core/__tests__/WorkflowDefinitionService.test.ts` (NEW)
- **Task**: Test CRUD, DAG validation, template import/export, versioning
- **Acceptance**: All methods tested

### P3.15 — Service Unit Tests — DAGScheduler (5h)
- **File**: `packages/core/__tests__/DAGScheduler.test.ts` (NEW)
- **Task**: Test scheduling for:
  - Linear workflow (A → B → C)
  - Parallel stages (A, B independent → C)
  - Diamond (A → B,C → D)
  - Fan-out (A → B,C,D,E)
  - Failure propagation
  - Condition evaluation
  - Session allocation in each mode
- **Acceptance**: All DAG patterns tested

### P3.16 — Service Unit Tests — StageExecution (3h)
- **File**: `packages/core/__tests__/StageExecutionService.test.ts` (NEW)
- **Task**: Test prompt execution, retry, timeout, hooks, pause/resume
- **Acceptance**: All execution paths tested

### P3.17 — Service Unit Tests — WorkflowRun (3h)
- **File**: `packages/core/__tests__/WorkflowRunService.test.ts` (NEW)
- **Task**: Test run lifecycle, cascading operations, completion detection
- **Acceptance**: All lifecycle states tested

### P3.18 — Deprecate WorkflowService (1h)
- **File**: `packages/core/src/services/WorkflowService.ts` (MODIFY)
- **Task**: Add `@deprecated` JSDoc to `WorkflowService` class and all public methods. Update imports in composition-root and route handlers to use `StageExecutionService` where applicable. Keep class functional for backward compat.
- **Acceptance**: All WorkflowService usages marked deprecated, no runtime behavior change

### P3.19 — Core Index Updates (0.5h)
- **File**: `packages/core/src/index.ts` (MODIFY)
- **Task**: Export all new services
- **Acceptance**: Clean imports from `@generatorai/core`

---

## Phase 4: Server API Routes (40h) ✅ COMPLETE

> Implement the new REST API endpoints and update the composition root.

### P4.1 — Composition Root Updates (4h)
- **File**: `apps/server/src/composition-root.ts` (MODIFY)
- **Task**: Wire all new repositories, services, and DAGScheduler. Update initialization sequence. **Note**: `StageExecutionService` must be created before `DAGScheduler` (dependency order). Disambiguate existing `chatService` (old, Copilot interaction) vs new `chatManagementService` in the Container type. Update `Container` interface (defined in this file, not `types/index.ts`) with all new services.
- **Acceptance**: Container builds successfully, all services wired

### P4.2 — Chat Routes (4h)
- **File**: `apps/server/src/routes/chats.ts` (NEW)
- **Task**: Implement:
  - `POST /api/chats` — create chat (Zod validated)
  - `GET /api/chats` — list chats (with status filter)
  - `GET /api/chats/:id` — get chat details
  - `DELETE /api/chats/:id` — archive chat
  - `POST /api/chats/:id/prompt` — send prompt (FormData, 202)
  - `GET /api/chats/:id/messages` — chat history (pagination)
  - `GET /api/chats/:id/stream` — SSE stream for chat
- **Note**: Keep existing `routes/chat.ts` (singular) for backward-compat `/sessions/:id/prompt` endpoint. New file `chats.ts` (plural) serves `/api/chats` endpoints. Update `routes/index.ts` to mount both.
- **Acceptance**: All endpoints return correct status codes and response shapes

### P4.3 — Workflow Definition Routes (4h)
- **File**: `apps/server/src/routes/workflowDefinitions.ts` (NEW)
- **Task**: Implement CRUD + stage + edge + validation + import/export endpoints. **Note**: Use `:id` consistently for definition parameter (not `:defId`) across all nested routes.
- **Acceptance**: All 11 definition endpoints working

### P4.4 — Workflow Run Routes (4h)
- **File**: `apps/server/src/routes/workflowRuns.ts` (NEW)
- **Task**: Implement:
  - `POST /api/workflow-runs` — create run
  - `GET /api/workflow-runs` — list runs
  - `GET /api/workflow-runs/:id` — get run with stages
  - `POST /api/workflow-runs/:id/start|pause|resume|cancel` — lifecycle controls
  - `DELETE /api/workflow-runs/:id` — delete run
  - `GET /api/workflow-runs/:id/stream` — SSE stream for run
  - `GET /api/workflow-runs/:id/stages` — list stage runs
  - `POST /api/workflow-runs/:runId/stages/:stageId/pause|resume|retry|cancel` — stage controls
- **Acceptance**: All 12 run endpoints working

### P4.5 — Route Registration (1h)
- **File**: `apps/server/src/routes/index.ts` (MODIFY)
- **Task**: Mount new route handlers under `/api`
- **Acceptance**: All new routes accessible

### P4.6 — SSE Streaming Updates (4h)
- **File**: `apps/server/src/routes/multiplexedStream.ts` (MODIFY)
- **Task**: Extend multiplexed SSE to include `context` metadata (type + id) in each event. Handle new event kinds. Add per-run SSE endpoint.
- **Acceptance**: Web app can distinguish chat vs workflow_run vs stage_run events

### P4.7 — Validation Middleware Updates (2h)
- **File**: `apps/server/src/middleware/validate.ts` (MODIFY)
- **Task**: Add Zod schemas for all new request bodies
- **Acceptance**: Invalid requests return 400 with field-level errors

### P4.8 — Backward Compatibility Layer (3h)
- **File**: `apps/server/src/routes/sessions.ts` (MODIFY)
- **Task**: Add adapter logic to map old session endpoints to new chat/workflow endpoints. Add deprecation headers.
- **Acceptance**: Existing API clients still work, get deprecation warnings

### P4.9 — Chat Route Tests (3h)
- **File**: `apps/server/__tests__/routes/chats.test.ts` (NEW)
- **Task**: Test all 7 chat endpoints with Supertest
- **Acceptance**: All endpoints tested (success + error cases)

### P4.10 — Workflow Definition Route Tests (3h)
- **File**: `apps/server/__tests__/routes/workflowDefinitions.test.ts` (NEW)
- **Task**: Test all definition CRUD + stage + edge + validation endpoints
- **Acceptance**: All endpoints tested

### P4.11 — Workflow Run Route Tests (3h)
- **File**: `apps/server/__tests__/routes/workflowRuns.test.ts` (NEW)
- **Task**: Test all run lifecycle + stage control endpoints
- **Acceptance**: All endpoints tested

### P4.12 — Error Handler Updates (1h)
- **File**: `apps/server/src/middleware/errorHandler.ts` (MODIFY)
- **Task**: Map new error categories to HTTP status codes
- **Acceptance**: `DAGValidationError` → 422, `SessionAllocationError` → 503

### P4.13 — Health Route Updates (0.5h)
- **File**: `apps/server/src/routes/health.ts` (MODIFY)
- **Task**: Add workflow run counts and chat counts to health response
- **Acceptance**: Health endpoint includes new metrics

### P4.14 — Global Events Route Updates (0.5h)
- **File**: `apps/server/src/routes/globalEvents.ts` (MODIFY)
- **Task**: Include workflow_run and stage_run events in global event stream
- **Acceptance**: Global SSE receives new event types

### P4.15 — Container Type Updates (1h)
- **File**: `apps/server/src/composition-root.ts` (MODIFY)
- **Task**: Add new services and repositories to `Container` type (defined in composition-root.ts, not types/index.ts)
- **Acceptance**: TypeScript compiles with new container shape

### P4.16 — Static File Middleware Updates (0.5h)
- **File**: `apps/server/src/middleware/staticFiles.ts` (MODIFY)
- **Task**: Ensure SPA fallback works with new routes
- **Acceptance**: Direct navigation to `/workflows/abc` serves index.html

---

## Phase 5: Web UI — Chat Features (36h) ✅ COMPLETE

> Implement the Chat as a first-class UI concept.

### P5.1 — Chat API Client (3h)
- **File**: `apps/web/src/platform/HttpPlatformClient.ts` (MODIFY)
- **Task**: Add methods for all chat endpoints. Add new query/mutation hooks.
- **Files**: `apps/web/src/hooks/queries.ts` (MODIFY)
- **Acceptance**: All chat operations available via hooks

### P5.2 — ChatList Component (3h)
- **File**: `apps/web/src/components/chat/ChatList.tsx` (NEW)
- **Task**: Sidebar chat list with status indicators, time-ago timestamps, click to navigate, search/filter
- **Acceptance**: Lists chats sorted by updatedAt, active chat highlighted

### P5.3 — CreateChatDialog Component (3h)
- **File**: `apps/web/src/components/chat/CreateChatDialog.tsx` (NEW)
- **Task**: Modal for creating a new chat with name, model selection, optional repo URL, tags
- **Acceptance**: Creates chat and navigates to it

### P5.4 — ChatPage Component (6h)
- **File**: `apps/web/src/pages/ChatPage.tsx` (NEW)
- **Task**: Full chat page with:
  - Chat header (name, model, status)
  - ChatMessageList (reuse existing component)
  - StreamingMessage (reuse existing component)
  - ChatInput (reuse existing component)
  - Connect to chat-specific SSE stream
- **Acceptance**: Full interactive chat working with streaming

### P5.5 — Sidebar Navigation Update (4h)
- **File**: `apps/web/src/components/layout/Sidebar.tsx` (MODIFY)
- **Task**: Add tabbed navigation (Chats / Workflows). Render ChatList in Chats tab, WorkflowDefinitionList in Workflows tab. Add "New Chat" and "New Workflow" buttons.
- **Acceptance**: Both tabs functional, correct lists shown

### P5.6 — Router Updates (2h)
- **File**: `apps/web/src/router.tsx` (MODIFY)
- **Task**: Add new routes for chats, workflows, and workflow runs per architecture doc. Add `sessions/:id` redirect route (`<SessionRedirect />`) that maps old session URLs to the appropriate chat or workflow run page.
- **Acceptance**: All routes navigate correctly, old session bookmarks redirect

### P5.7 — SSE Manager Chat Integration (4h)
- **File**: `apps/web/src/stores/sseManager.ts` (MODIFY)
- **Task**: Update event processing to handle chat context. Route copilot events to chatStore based on session ownership.
- **Acceptance**: Chat streaming works through multiplexed SSE

### P5.8 — Chat Store (3h)
- **File**: `apps/web/src/stores/chatStore.ts` (NEW)
- **Task**: Zustand store for chat-specific state (active chat, streaming state). Adapts existing streamStore patterns.
- **Acceptance**: Chat streaming state managed correctly

### P5.9 — Header Updates (2h)
- **File**: `apps/web/src/components/layout/Header.tsx` (MODIFY)
- **Task**: Context-aware header: show chat actions for /chats/:id, workflow actions for /workflows/:id
- **Acceptance**: Correct action buttons shown for each context

### P5.10 — AppLayout Updates (2h)
- **File**: `apps/web/src/components/layout/AppLayout.tsx` (MODIFY)
- **Task**: Update layout to use new sidebar structure, update GlobalSSEManager for chat context
- **Acceptance**: Layout works for both chat and workflow views

### P5.11 — Chat Page Tests (3h) ⏳ DEFERRED TO P9
- **File**: `apps/web/src/__tests__/ChatPage.test.tsx` (NEW)
- **Task**: Test chat page rendering, message display, prompt sending
- **Acceptance**: Key user flows tested

### P5.12 — EmptyState Update (1h)
- **File**: `apps/web/src/pages/EmptyState.tsx` (MODIFY)
- **Task**: Update welcome screen with quick actions for "Start Chat" and "Create Workflow"
- **Acceptance**: Quick actions navigate to correct pages

---

## Phase 6: Web UI — Workflow Builder (52h) ✅ COMPLETE

> Implement the visual DAG workflow builder using React Flow.
>
> **Status**: All 16 subtasks implemented, tests passing (27/27), build successful.
> - Installed `@xyflow/react` v12.10.1 and `@dagrejs/dagre` v2.0.4
> - Full Zustand store with undo/redo, cycle detection, validation
> - TanStack Query hooks for all workflow CRUD operations
> - React Flow canvas with custom StageNode/StageEdge, MiniMap, auto-layout
> - StagePropertiesPanel, PromptEditor, WorkflowConfigPanel, VariableInputModal
> - WorkflowBuilderPage with toolbar, save (new + update with diff), run
> - WorkflowDefinitionPage with read-only DAG, metadata, run history
> - WorkflowListPage with grid/list view, search, tag filter
> - WorkflowDefinitionList sidebar component
> - Router updated with 4 workflow routes, Sidebar updated with Workflows tab
> - Code reviewed by subagent: 3 critical + 5 medium issues found and fixed

### P6.1 — Install React Flow (1h)
- **File**: `apps/web/package.json` (MODIFY)
- **Task**: Install `@xyflow/react` (React Flow v12) and `@dagrejs/dagre` (for auto-layout in P6.15)
- **Acceptance**: Import works

### P6.2 — Workflow API Client & Hooks (4h)
- **File**: `apps/web/src/hooks/workflowQueries.ts` (NEW)
- **Task**: All query and mutation hooks for workflow definitions, stages, edges, runs. API client methods in HttpPlatformClient.
- **Acceptance**: All 20+ workflow operations available via hooks

### P6.3 — Workflow Builder Store (5h)
- **File**: `apps/web/src/stores/workflowBuilderStore.ts` (NEW)
- **Task**: Zustand store managing design-time DAG state:
  - Stages, edges, selected stage, dirty flag, validation errors
  - Node positions (from React Flow)
  - Undo/redo (command pattern)
  - Auto-save debounced
  - DAG validation on change
- **Acceptance**: Full store logic tested

### P6.4 — StageNode Component (4h)
- **File**: `apps/web/src/components/workflow/StageNode.tsx` (NEW)
- **Task**: Custom React Flow node for stages:
  - Shows stage name, template icon/type, status indicator
  - Input/output handle ports for edges
  - Selection highlighting
  - Context menu (edit, delete, duplicate)
  - Design-time vs runtime visual modes
- **Acceptance**: Node renders, connects, shows correct state

### P6.5 — StageEdge Component (2h)
- **File**: `apps/web/src/components/workflow/StageEdge.tsx` (NEW)
- **Task**: Custom React Flow edge:
  - Animated flow direction
  - Edge type label (on_success, on_failure, etc.)
  - Delete button on hover
  - Color coding by type (green=success, red=failure, blue=completion)
- **Acceptance**: Edge renders with correct styling

### P6.6 — DAGCanvas Component (8h)
- **File**: `apps/web/src/components/workflow/DAGCanvas.tsx` (NEW)
- **Task**: React Flow canvas wrapper:
  - Renders stages as nodes, edges as connections
  - Drag-and-drop node placement
  - Click-and-drag edge creation between handles
  - Background grid
  - Controls (zoom, fit-to-view)
  - MiniMap for large workflows
  - Keyboard shortcuts (Delete, Ctrl+Z, Ctrl+Shift+Z)
  - Auto-layout (dagre algorithm for initial positioning)
- **Acceptance**: Full canvas interaction working

### P6.7 — StagePropertiesPanel (6h)
- **File**: `apps/web/src/components/workflow/StagePropertiesPanel.tsx` (NEW)
- **Task**: Right sidebar form:
  - Stage name, description
  - Template selector (dropdown with preview)
  - Model selector
  - Prompt editor (list with drag-to-reorder, add/edit/delete)
  - Variables (key-value editor)
  - Hooks configuration
  - Retry policy (max retries, backoff)
  - Timeout setting
  - Condition type selector
  - Copilot config overrides
- **Acceptance**: All StageDefinition properties editable

### P6.8 — PromptEditor Component (4h)
- **File**: `apps/web/src/components/workflow/PromptEditor.tsx` (NEW)
- **Task**: Editable prompt list:
  - Add/edit/delete prompts
  - Drag-to-reorder (dnd-kit)
  - Textarea with variable interpolation highlighting ({{var}})
  - Wait for completion toggle per prompt
  - Preview mode
- **Acceptance**: Prompt CRUD and reordering working

### P6.9 — WorkflowConfigPanel (3h)
- **File**: `apps/web/src/components/workflow/WorkflowConfigPanel.tsx` (NEW)
- **Task**: Top-level workflow settings:
  - Name, description
  - Session mode selector (single/per-stage/auto with explanations)
  - Variables definition (add/edit variable schema: name, type, label, required, default)
  - Tags
- **Acceptance**: All WorkflowDefinition properties editable

### P6.10 — WorkflowBuilderPage (5h)
- **File**: `apps/web/src/pages/WorkflowBuilderPage.tsx` (NEW)
- **Task**: Full page layout:
  - Toolbar: Save, Run, Validate, Import/Export, Undo/Redo
  - DAGCanvas (center, 70% width)
  - StagePropertiesPanel (right, 30% width, collapsible)
  - WorkflowConfigPanel (accessible via toolbar button)
  - "Add Stage" floating action button on canvas
  - Stage template picker dialog
  - Validation error display
  - Unsaved changes guard (beforeunload)
- **Acceptance**: Full workflow creation flow working

### P6.11 — VariableInputModal (2h)
- **File**: `apps/web/src/components/workflow/VariableInputModal.tsx` (NEW)
- **Task**: Modal shown before starting a run. Renders form fields based on `WorkflowDefinition.variables`:
  - Text input for string
  - Number input for number
  - Checkbox for boolean
  - Dropdown for choice (with options)
  - Textarea for text
  - Required field validation
- **Acceptance**: Variable values collected and passed to createRun

### P6.12 — WorkflowDefinitionPage (3h)
- **File**: `apps/web/src/pages/WorkflowDefinitionPage.tsx` (NEW)
- **Task**: Read-only view of a saved definition:
  - DAG visualization (React Flow in view-only mode)
  - Definition metadata
  - Stage list with details
  - "Edit" button → WorkflowBuilderPage
  - "Run" button → VariableInputModal → create and start run
  - Recent runs list with status badges
- **Acceptance**: Definition viewable, edit/run actions work

### P6.13 — WorkflowListPage (3h)
- **File**: `apps/web/src/pages/WorkflowListPage.tsx` (NEW)
- **Task**: List/grid of workflow definitions:
  - Card view with name, description, stage count, last run status/time
  - "Create New" button
  - Search/filter by name/tags
  - Quick actions (edit, run, delete)
  - Recent runs section at bottom
- **Acceptance**: List renders, all actions work

### P6.14 — WorkflowDefinitionList Sidebar (2h)
- **File**: `apps/web/src/components/workflow/WorkflowDefinitionList.tsx` (NEW)
- **Task**: Sidebar list component (for Workflows tab):
  - Compact list of definitions
  - Click to navigate to definition/builder page
  - Status indicators for recent runs
- **Acceptance**: Navigates correctly, shows relevant info

### P6.15 — Auto-Layout Algorithm (2h)
- **File**: `apps/web/src/utils/dagLayout.ts` (NEW)
- **Task**: Use dagre library to auto-position nodes in a DAG layout:
  - Left-to-right layout by default
  - Configurable spacing
  - Called on first render and via toolbar button
- **Acceptance**: Nodes positioned in logical DAG order

### P6.16 — Workflow Builder Tests (4h)
- **Files**: `apps/web/src/__tests__/WorkflowBuilder.test.tsx` and related
- **Task**: Test stage creation, edge creation, validation, save, property editing
- **Acceptance**: Key builder interactions tested

---

## Phase 7: Web UI — Workflow Runs & Monitoring (36h) ✅ COMPLETE

> Implement runtime workflow monitoring with live DAG visualization.

### P7.1 — Workflow Run Store (4h)
- **File**: `apps/web/src/stores/workflowRunStore.ts` (NEW)
- **Task**: Zustand store for run monitoring:
  - Per-run state: WorkflowRun, StageRun[], stage streaming states
  - Update handlers for SSE events
  - Stage selection for detail view
- **Acceptance**: Store updates correctly from SSE events

### P7.2 — SSE Manager Workflow Integration (4h)
- **File**: `apps/web/src/stores/sseManager.ts` (MODIFY)
- **Task**: Add workflow run and stage run event handling:
  - Route `workflow_run.*` events to workflowRunStore
  - Route `stage_run.*` events to workflowRunStore  
  - Route `copilot.*` events to stage-specific streams via session→stage mapping
  - Invalidate TanStack queries on status changes
- **Acceptance**: Run monitoring receives real-time updates

### P7.3 — Runtime DAGCanvas (5h)
- **File**: `apps/web/src/components/workflow/RuntimeDAGCanvas.tsx` (NEW)
- **Task**: React Flow canvas in runtime mode:
  - Stages show runtime status (pending/running/completed/failed)
  - Progress bars within stage nodes
  - Animated edges for active data flow
  - Color transitions as stages progress
  - Click stage to show detail
  - Cannot edit (view-only mode)
- **Acceptance**: Live status updates reflected in DAG visualization

### P7.4 — StageOutput Component (5h)
- **File**: `apps/web/src/components/workflow/StageOutput.tsx` (NEW)
- **Task**: Panel showing selected stage's output:
  - Chat-style message display (user prompts + assistant responses)
  - Streaming message support (reuse StreamingMessage)
  - Tool calls display
  - Error display for failed stages
  - Stage timeline (step progress)
- **Acceptance**: Stage output streams in real-time

### P7.5 — WorkflowRunPage (6h)
- **File**: `apps/web/src/pages/WorkflowRunPage.tsx` (NEW)
- **Task**: Full run monitoring page:
  - Header: Run name, status badge, duration timer
  - Controls: Pause/Resume/Cancel buttons
  - Split view: RuntimeDAGCanvas (left) + StageOutput (right)
  - Run timeline (bottom, collapsible)
  - Stage selection interaction (click node → show output)
  - Auto-scroll to active stage
- **Acceptance**: Full run monitoring flow working

### P7.6 — RunTimeline Component (3h)
- **File**: `apps/web/src/components/workflow/RunTimeline.tsx` (NEW)
- **Task**: Vertical timeline showing run events:
  - Stage start/complete/fail events with timestamps
  - Duration calculations
  - Expandable event details
  - Color-coded by event type
- **Acceptance**: Timeline renders, updates in real-time

### P7.7 — RunControls Component (2h)
- **File**: `apps/web/src/components/workflow/RunControls.tsx` (NEW)
- **Task**: Action buttons for run lifecycle:
  - Start (if created), Pause (if running), Resume (if paused), Cancel (if running/paused)
  - Stage-level controls (pause/resume/retry/cancel for selected stage)
  - Confirmation dialogs for destructive actions
- **Acceptance**: All controls trigger correct mutations

### P7.8 — RunStatusBadge Component (1h)
- **File**: `apps/web/src/components/workflow/RunStatusBadge.tsx` (NEW)
- **Task**: Color-coded status badge for workflow run and stage run statuses
- **Acceptance**: Correct colors and icons for all 8 states

### P7.9 — Connection Store Updates (2h)
- **File**: `apps/web/src/stores/connectionStore.ts` (MODIFY)
- **Task**: Add per-run connection tracking alongside per-session
- **Acceptance**: Connection status accurate for run SSE streams

### P7.10 — Run History Panel (2h)
- **File**: `apps/web/src/components/workflow/RunHistoryPanel.tsx` (NEW)
- **Task**: List of runs for a definition with status, duration, date. Click to navigate to run page.
- **Acceptance**: History loads, navigates correctly

### P7.11 — Workflow Run Tests (3h)
- **Files**: `apps/web/src/__tests__/WorkflowRunPage.test.tsx` and related
- **Task**: Test run monitoring, stage output display, controls
- **Acceptance**: Key monitoring flows tested

### P7.12 — Breadcrumb Updates (1h)
- **File**: `apps/web/src/components/layout/Breadcrumb.tsx` (MODIFY)
- **Task**: Context-aware breadcrumbs:
  - Chat: Home > Chats > {chatName}
  - Workflow: Home > Workflows > {workflowName}
  - Run: Home > Workflows > {workflowName} > Run #{number}
- **Acceptance**: Breadcrumbs show correctly for all contexts

---

## Phase 8: CLI Updates (24h) ✅ COMPLETE

> Update the CLI with new commands and terminal DAG visualization.
> 
> **Delivered**: All 10 subtasks completed. CLI composition root wired with v2 services, DirectPlatformClient implements 20+ v2 methods, chat commands (start/list/resume), workflow definition commands (list/show/create/delete), workflow run commands (run/runs/status/pause/resume/cancel/watch), DAGProgress terminal visualization with live EventBus updates, command deprecation layer with v2 command groups (`c`/`workflow`), and CLI tests.

### P8.1 — CLI Composition Root Updates (3h)
- **File**: `apps/cli/src/platform/composition-root.ts` (MODIFY)
- **Task**: Update `createCLIContainer()` function and `CLIContainer` type to wire new services (ChatManagementService, WorkflowDefinitionService, WorkflowRunService, DAGScheduler, SessionAllocator). Note: CLI container is a subset of the server container.
- **Acceptance**: CLI container builds with new services

### P8.2 — DirectPlatformClient Updates (2h)
- **File**: `apps/cli/src/platform/DirectPlatformClient.ts` (MODIFY)
- **Task**: Add methods for chat and workflow operations, delegating to new services
- **Acceptance**: All new operations callable from CLI

### P8.3 — Chat CLI Commands (3h)
- **Files**: `apps/cli/src/commands/chatStart.tsx`, `apps/cli/src/commands/chatList.tsx`, `apps/cli/src/commands/chatResume.tsx` (NEW)
- **Task**: Implement `generatorai chat start`, `generatorai chat list`, `generatorai chat resume` commands
- **Acceptance**: Chat creation and interactive chat working in terminal

### P8.4 — Workflow Definition CLI Commands (3h)
- **Files**: `apps/cli/src/commands/workflowList.tsx`, `apps/cli/src/commands/workflowShow.tsx`, `apps/cli/src/commands/workflowCreate.tsx`, `apps/cli/src/commands/workflowDelete.tsx` (NEW)
- **Task**: Implement workflow definition management commands. `workflow create` uses interactive prompts for stage building.
- **Acceptance**: Workflow CRUD from CLI

### P8.5 — Workflow Run CLI Commands (3h)
- **Files**: `apps/cli/src/commands/workflowRun.tsx`, `apps/cli/src/commands/workflowRuns.tsx`, `apps/cli/src/commands/workflowStatus.tsx`, `apps/cli/src/commands/workflowPause.tsx`, `apps/cli/src/commands/workflowResume.tsx`, `apps/cli/src/commands/workflowCancel.tsx` (NEW)
- **Task**: Implement run lifecycle commands with --var, --detach, --json options
- **Acceptance**: Full run lifecycle from CLI

### P8.6 — Terminal DAG Visualization (4h)
- **File**: `apps/cli/src/components/DAGProgress.tsx` (NEW)
- **Task**: Ink component for terminal DAG visualization:
  - Box-drawing characters for stage nodes
  - Unicode status indicators (●, ✓, ✕, ⏸, ○)
  - Progress bars per stage
  - Duration timers
  - Edge connections (simplified for terminal)
  - Auto-refresh via EventBus subscription
- **Acceptance**: Visual DAG renders in terminal with live updates

### P8.7 — Command Deprecation Layer (2h)
- **File**: `apps/cli/src/index.tsx` (MODIFY)
- **Task**: Alias old commands to new ones with deprecation warnings:
  - `start` → `workflow run`
  - `stop` → `workflow pause/cancel`
  - `list` → combined chat and workflow run list
  - `chat` → `chat resume`
- **Acceptance**: Old commands still work, show deprecation messages

### P8.8 — Workflow Watch Command (2h)
- **File**: `apps/cli/src/commands/workflowWatch.tsx` (NEW)
- **Task**: Real-time workflow run watcher using DAGProgress component + event stream
- **Acceptance**: Live updates shown in terminal

### P8.9 — CLI Tests (2h)
- **Files**: `apps/cli/__tests__/workflowCommands.test.ts` (NEW)
- **Task**: Test new commands (chat start, workflow list, workflow run, workflow status)
- **Acceptance**: Key command flows tested

### P8.10 — Help Text Updates (0.5h)
- **File**: `apps/cli/src/index.tsx` (MODIFY)
- **Task**: Update help text with new command structure
- **Acceptance**: `generatorai --help` shows updated command list

---

## Phase 9: Integration Testing & Polish (20h) ✅ COMPLETE

> End-to-end testing and final polish.
> 
> **Delivered**: E2E tests for chat API lifecycle (P9.1), workflow definition lifecycle with stages/edges/validation (P9.2), workflow run lifecycle with session allocation (P9.3+P9.4). UI polish verified on ChatPage and WorkflowRunPage (P9.6). Test mocks aligned with actual service method signatures (archiveChat, getChatHistory, deleteStage, deleteEdge, validateDefinition). P9.5 (migration E2E), P9.7 (perf), P9.8 (docs) deferred as lower priority.

### P9.1 — E2E: Chat Flow (3h)
- **Task**: Full chat flow test:
  1. Create chat via API
  2. Send prompt, verify streaming response
  3. Verify chat history
  4. Archive chat
  5. Verify session closed
- **Acceptance**: Complete chat lifecycle works end-to-end

### P9.2 — E2E: Workflow Definition Flow (3h)
- **Task**: Full workflow definition flow:
  1. Create definition
  2. Add stages (A, B, C)
  3. Add edges (A→C, B→C)
  4. Validate DAG
  5. Save definition
  6. Edit definition (add stage D, edge C→D)
  7. Delete definition
- **Acceptance**: Complete definition lifecycle works

### P9.3 — E2E: Workflow Run Flow (4h)
- **Task**: Full workflow run flow:
  1. Create run from definition
  2. Set variables
  3. Start run
  4. Verify parallel stage execution (A, B start simultaneously)
  5. Verify dependent stage waits (C starts after A and B)
  6. Verify completion
  7. Pause/resume during execution
  8. Cancel during execution
- **Acceptance**: DAG execution with parallelism works correctly

### P9.4 — E2E: Session Allocation (2h)
- **Task**: Test session allocation modes:
  1. Single mode: all stages share one session
  2. Per-stage mode: each stage gets own session
  3. Auto mode: parallel stages get own sessions, chains share
- **Acceptance**: Session allocation correct for each mode

### P9.5 — Migration E2E Test (2h)
- **Task**: Test data migration from v1 to v2:
  1. Create v1 data (sessions, workflows, chat messages)
  2. Run migration
  3. Verify v2 data (chats, workflow definitions, runs)
  4. Verify old API endpoints still work
- **Acceptance**: Migration preserves all data

### P9.6 — UI Polish (3h)
- **Task**: 
  - Responsive layout for workflow builder (tablet/desktop breakpoints)
  - Loading states for all new pages
  - Error states with retry options
  - Empty states for lists
  - Keyboard accessibility for DAG canvas
  - Tooltips and help text
- **Acceptance**: No visual regressions, accessibility audit passes

### P9.7 — Performance Testing (2h)
- **Task**:
  - Test React Flow with 50-stage workflow
  - Test concurrent stage execution (10 parallel stages)
  - Test SSE with multiple active runs
  - Measure DAG validation performance
- **Acceptance**: No degradation with max-scale scenarios

### P9.8 — Documentation Updates (1h)
- **Task**: Update README.md with new workflow features. Update API docs if auto-generated.
- **Acceptance**: Documentation reflects new capabilities

---

## Dependency Graph

```
P0 ──▶ P1 ──▶ P2 ──▶ P3 ──▶ P4 ──┬──▶ P5 ──────────┐
                                   ├──▶ P6 ──▶ P7 ────┼──▶ P9
                                   └──▶ P8 ────────────┘
```

- **P0-P4** are sequential (each depends on the previous)
- **P5, P6, P8** can be worked in parallel after P4
- **P7** depends on P6 (needs WorkflowBuilder components)
- **P9** depends on P5, P7, P8 (integration testing)

---

## Risk Mitigation Checkpoints

| After Phase | Checkpoint |
|-------------|-----------|
| P0 | Types compile across all packages, schema migration runs |
| P1 | State machines have 100% transition coverage, DAG validator handles all edge cases |
| P2 | All repositories pass CRUD tests, migration transforms data correctly |
| P3 | DAGScheduler handles linear, parallel, and diamond patterns; ChatManagement creates working chats |
| P4 | All API routes return correct responses via Supertest |
| P6 | Workflow builder creates valid DAGs, saves/loads correctly |
| P7 | Live DAG visualization updates in real-time during run execution |
| P9 | Full E2E flows pass, performance within acceptable bounds |

---

## Files Summary

### New Files (~67)
| Package | Files |
|---------|-------|
| `packages/shared` | 6 (types, schemas, errors) |
| `packages/core` | 15 (state machines, DAG, services, ports) |
| `packages/db` | 8 (repositories, migration) |
| `apps/server` | 4 (routes) |
| `apps/web` | 22 (pages, components, stores, hooks, utils) |
| `apps/cli` | 12 (commands, components) |

### Modified Files (~30)
| Package | Files |
|---------|-------|
| `packages/shared` | 4 (existing types, index, errors, constants) |
| `packages/core` | 6 (EventBus, ConfigResolver, HookInterceptor, StartupRecoveryService, ErrorHandler, index) |
| `packages/db` | 5 (schema, index, existing repositories) |
| `apps/server` | 8 (composition-root, routes, middleware, types) |
| `apps/web` | 8 (router, sidebar, header, stores, platform client, hooks) |
| `apps/cli` | 3 (index, composition-root, DirectPlatformClient) |

### New Test Files (~20)
| Package | Files |
|---------|-------|
| `packages/shared` | 2 |
| `packages/core` | 8 |
| `packages/db` | 3 |
| `apps/server` | 3 |
| `apps/web` | 3 |
| `apps/cli` | 1 |
