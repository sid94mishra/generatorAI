# GeneratorAI  Complete Implementation Plan

> **Author**: Implementation Lead
> **Date**: February 20, 2026
> **Status**: Ready for Execution
> **Source**: ARCHITECTURE_ANALYSIS.md (22 Sections, 3 Appendices)
> **Total**: 202 tasks across 10 phases, ~515.5 hours estimated

## Executive Summary

| Phase | Name | Tasks | Hours |
|-------|------|:-----:|:-----:|
| **P0** | Project Scaffolding | 19 | 20 |
| **P1** | Domain Layer | 26 | 48.5 |
| **P2** | Infrastructure Layer | 21 | 58 |
| **P3** | Application Services | 25 | 97.5 |
| **P4** | Server (Express HTTP) | 24 | 48 |
| **P5** | CLI Application | 17 | 39.5 |
| **P6** | Web Application | 30 | 69 |
| **P7** | Desktop (Electron) | 16 | 41 |
| **P8** | Integration & E2E | 12 | 44.5 |
| **P9** | Polish & Release | 12 | 49.5 |
| | **TOTAL** | **202** | **~515.5** |

### Phase Dependency Diagram

```
P0 (Scaffolding)
  P1 (Domain)
        P2 (Infrastructure)
              P3 (Application Services)
                    P4 (Server)  
                    P5 (CLI)      Can run in parallel   
                    P6 (Web App)  Can run in parallel   
                          P7 (Desktop)  after P6 UI   
                                                                   
                               All P4-P7    
                                                                  
                                                        P8 (Integration & E2E)
                                                               
                                                               
                                                        P9 (Polish & Release)
```

### Critical Path

```
P0-T07  P1-T01  P1-T06  P1-T11  P1-T14  P2-T01  P2-T02  P2-T04 
P2-T10 → P3-T01 → P3-T07 → P3-T07B → P3-T03 → P3-T04A → P3-T12 → P4-T01 → P4-T07 → P4-T16 
P8-T01 → P8-T04 → P9-T11

~190 hours on the critical path
With 3 developers parallelizing P4/P5/P6: ~240 calendar hours
```

---


## Phase 0 — Project Scaffolding

**Goal**: Establish the monorepo infrastructure so that every subsequent phase drops code into a fully configured, buildable, lintable, testable workspace.

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P0-T01 | pnpm workspace init | Initialize the root `package.json` with `"private": true`, set Node engine to `>=20`, and create `pnpm-workspace.yaml` declaring `apps/*` and `packages/*` globs. Run `pnpm init` and pin pnpm version in `packageManager` field. | `package.json`, `pnpm-workspace.yaml`, `.npmrc` | — | 1 | • `pnpm install` succeeds with zero packages (empty workspace). • `pnpm-workspace.yaml` lists both `apps/*` and `packages/*`. |
| P0-T02 | Turborepo configuration | Add `turbo` as a root dev-dependency. Create `turbo.json` defining the task pipeline: `build` depends on `^build`, `test` has no deps, `lint` has no deps, `typecheck` depends on `^build`. Configure caching for `build` outputs (`dist/**`). | `turbo.json`, `package.json` (devDeps update) | P0-T01 | 1 | • `pnpm turbo build` and `pnpm turbo test` resolve the task graph without errors (no packages yet, but no config errors). • Pipeline declares `build`, `test`, `lint`, `typecheck`, `dev` tasks. |
| P0-T03 | TypeScript config hierarchy | Create a root `tsconfig.base.json` with strict settings (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`, `target: "ES2022"`, `module: "ESNext"`). Each package/app gets its own `tsconfig.json` extending `../../tsconfig.base.json` (or `../..` as appropriate) with local `paths`, `outDir`, `rootDir`, and `composite: true` for project references. | `tsconfig.base.json`, `packages/core/tsconfig.json`, `packages/shared/tsconfig.json`, `packages/db/tsconfig.json`, `packages/copilot-bridge/tsconfig.json`, `packages/streaming/tsconfig.json`, `packages/ui/tsconfig.json`, `apps/server/tsconfig.json`, `apps/web/tsconfig.json`, `apps/desktop/tsconfig.json`, `apps/cli/tsconfig.json` | P0-T01 | 2 | • `tsc --noEmit -p tsconfig.base.json` exits 0 (no source files is fine). • Every `tsconfig.json` compiles independently via `tsc -p <path>` without config errors. |
| P0-T04 | ESLint + Prettier setup | Install `eslint` (flat config), `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `eslint-plugin-boundaries` (layer enforcement), `prettier`, and `eslint-config-prettier`. Create root `eslint.config.mjs` with TS rules and boundary rules enforcing the four-layer architecture (Domain cannot import from Application/Infrastructure/Presentation). Create `.prettierrc` with project conventions (single quotes, trailing commas, 120 print width). Add `lint` and `format` scripts to root `package.json`. | `eslint.config.mjs`, `.prettierrc`, `.editorconfig`, `package.json` (devDeps + scripts) | P0-T01 | 2 | • `pnpm lint` runs without configuration errors. • `eslint-plugin-boundaries` rules are declared for all four layers plus the Bridge layer. |
| P0-T05 | Vitest setup | Install `vitest` as a root dev-dependency. Create `vitest.config.ts` at root with workspace-mode enabled (`vitest.workspace.ts` pointing to `packages/*/vitest.config.ts` and `apps/*/vitest.config.ts`). Configure TypeScript path aliases, coverage with `v8` provider, and a default `test` script in root `package.json`. Each package also gets a minimal `vitest.config.ts`. | `vitest.config.ts`, `vitest.workspace.ts`, `packages/core/vitest.config.ts`, `packages/shared/vitest.config.ts`, `packages/db/vitest.config.ts`, `packages/copilot-bridge/vitest.config.ts`, `packages/streaming/vitest.config.ts`, `packages/ui/vitest.config.ts`, `apps/server/vitest.config.ts`, `package.json` (scripts) | P0-T03 | 2 | • `pnpm test` resolves vitest workspace and reports "no test suites found" (not a config error). • Coverage provider is set to `v8`. |
| P0-T06 | Package scaffolding — `packages/shared` | Create `packages/shared/package.json` (`@generatorai/shared`, `"type": "module"`, `"main": "./src/index.ts"`, `exports` map), `src/index.ts` barrel, and subdirectory stubs: `src/types/`, `src/config/`, `src/errors/`, `src/constants/`, `src/utils/`. Add `zod` as a dependency (used for config schemas). | `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/types/.gitkeep`, `packages/shared/src/config/.gitkeep`, `packages/shared/src/errors/.gitkeep`, `packages/shared/src/constants/.gitkeep`, `packages/shared/src/utils/.gitkeep` | P0-T01, P0-T03 | 1 | • `pnpm --filter @generatorai/shared build` (or `tsc`) succeeds. • `zod` is listed as a dependency. |
| P0-T07 | Package scaffolding — `packages/core` | Create `packages/core/package.json` (`@generatorai/core`), directory skeleton matching architecture: `src/domain/entities/`, `src/domain/value-objects/`, `src/domain/ports/`, `src/domain/state-machines/`, `src/domain/events/`, `src/services/`, `src/events/`, `src/config/`. Depends on `@generatorai/shared`. Barrel `src/index.ts`. | `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, plus directory stubs under `src/domain/**` and `src/services/` | P0-T06 | 1 | • `pnpm --filter @generatorai/core build` succeeds. • Workspace dependency on `@generatorai/shared` resolves. |
| P0-T08 | Package scaffolding — `packages/db` | Create `packages/db/package.json` (`@generatorai/db`), stubs for `src/schema.ts`, `src/migrations/`, `src/repositories/`. Depends on `@generatorai/core` and `@generatorai/shared`; lists `drizzle-orm` and `better-sqlite3` as dependencies (install but don't implement). | `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/src/index.ts`, `packages/db/src/schema.ts`, `packages/db/src/repositories/.gitkeep`, `packages/db/src/migrations/.gitkeep` | P0-T07 | 1 | • `pnpm --filter @generatorai/db build` succeeds. • `drizzle-orm` and `better-sqlite3` in `dependencies`. |
| P0-T09 | Package scaffolding — `packages/copilot-bridge` | Create `packages/copilot-bridge/package.json` (`@generatorai/copilot-bridge`), stubs for `src/CopilotAdapter.ts`, `src/tool-factory.ts`. Depends on `@generatorai/core`. | `packages/copilot-bridge/package.json`, `packages/copilot-bridge/tsconfig.json`, `packages/copilot-bridge/src/index.ts`, `packages/copilot-bridge/src/CopilotAdapter.ts`, `packages/copilot-bridge/src/tool-factory.ts` | P0-T07 | 0.5 | • Package resolves in workspace. • Imports from `@generatorai/core` compile. |
| P0-T10 | Package scaffolding — `packages/streaming` | Create `packages/streaming/package.json` (`@generatorai/streaming`), stubs for `src/SSETransport.ts`, `src/DurableStreamManager.ts`. Depends on `@generatorai/core`. | `packages/streaming/package.json`, `packages/streaming/tsconfig.json`, `packages/streaming/src/index.ts`, `packages/streaming/src/SSETransport.ts`, `packages/streaming/src/DurableStreamManager.ts` | P0-T07 | 0.5 | • Package resolves in workspace. |
| P0-T11 | Package scaffolding — `packages/ui` | Create `packages/ui/package.json` (`@generatorai/ui`), stubs for `src/components/`, `src/hooks/`, `src/stores/`. Lists `react`, `react-dom` as peer dependencies. | `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/src/index.ts`, `packages/ui/src/components/.gitkeep`, `packages/ui/src/hooks/.gitkeep`, `packages/ui/src/stores/.gitkeep` | P0-T01, P0-T03 | 0.5 | • Package resolves in workspace. |
| P0-T12 | App scaffolding — `apps/server` | Create `apps/server/package.json` (`@generatorai/server`), stubs for `src/index.ts`, `src/routes/`, `src/middleware/`, `src/composition-root.ts`. Depends on `@generatorai/core`, `@generatorai/db`, `@generatorai/copilot-bridge`, `@generatorai/streaming`. Lists `express` (or `fastify`) as a dependency. | `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/index.ts`, `apps/server/src/composition-root.ts`, `apps/server/src/routes/.gitkeep`, `apps/server/src/middleware/.gitkeep` | P0-T07, P0-T08, P0-T09, P0-T10 | 1 | • `pnpm --filter @generatorai/server build` succeeds. |
| P0-T13 | App scaffolding — `apps/web` | Create `apps/web/package.json` (`@generatorai/web`), Vite config stub, `src/App.tsx`, `src/platform/` directory. Depends on `@generatorai/ui` and `@generatorai/shared`. | `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/src/App.tsx`, `apps/web/src/platform/.gitkeep`, `apps/web/index.html` | P0-T11, P0-T06 | 1 | • `pnpm --filter @generatorai/web build` succeeds (Vite compiles empty app). |
| P0-T14 | App scaffolding — `apps/desktop` | Create `apps/desktop/package.json` (`@generatorai/desktop`), Electron-Forge or electron-builder config stub, `src/main/`, `src/preload/`, `src/renderer/` stubs. Depends on `@generatorai/ui`, `@generatorai/core`. | `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/index.ts` | P0-T11, P0-T07 | 1 | • Package resolves in workspace with `electron` listed. |
| P0-T15 | App scaffolding — `apps/cli` | Create `apps/cli/package.json` (`@generatorai/cli`), stubs for `src/index.tsx`, `src/commands/`, `src/components/`, `src/platform/`. Depends on `@generatorai/core`, `@generatorai/shared`. Lists `commander`, `ink`, `ink-spinner` as dependencies. | `apps/cli/package.json`, `apps/cli/tsconfig.json`, `apps/cli/src/index.tsx`, `apps/cli/src/commands/.gitkeep`, `apps/cli/src/components/.gitkeep`, `apps/cli/src/platform/.gitkeep` | P0-T07, P0-T06 | 1 | • Package resolves in workspace. |
| P0-T16 | Git hooks with Husky | Install `husky` and `lint-staged` as root dev-dependencies. Run `husky init`. Configure `pre-commit` hook to run `lint-staged` (which runs `eslint --fix` on staged `.ts/.tsx` files and `prettier --write` on all staged files). Configure `commit-msg` hook to validate conventional commit format. | `.husky/pre-commit`, `.husky/commit-msg`, `package.json` (devDeps + `lint-staged` config), `commitlint.config.js` | P0-T04 | 1 | • Running `git commit` with a bad commit message is rejected. • Staged TS files are auto-linted before commit. |
| P0-T17 | CI workflow (GitHub Actions) | Create `.github/workflows/ci.yml` with: trigger on push/PR to `main`, matrix strategy for Node 20, steps: checkout → pnpm install (with cache) → turbo build → turbo lint → turbo typecheck → turbo test. | `.github/workflows/ci.yml` | P0-T02, P0-T04, P0-T05 | 1 | • Workflow YAML is valid (parseable). • All five Turbo pipeline steps are invoked. |
| P0-T18 | Templates directory scaffold | Create `templates/` directory at monorepo root with placeholder JSON files: `code-generation.json`, `code-review.json`, `test-generation.json`, `refactoring.json`. Each contains a minimal valid `WorkflowTemplate` skeleton (will be fully populated later). | `templates/code-generation.json`, `templates/code-review.json`, `templates/test-generation.json`, `templates/refactoring.json` | P0-T01 | 0.5 | • Each JSON is well-formed. • Template directory exists at the expected monorepo-root location. |
| P0-T19 | Root scripts & DX polish | Add root `package.json` scripts: `dev` (turbo dev), `build` (turbo build), `test` (turbo test), `lint` (turbo lint), `format` (prettier --write), `typecheck` (turbo typecheck), `clean` (turbo clean + rm -rf node_modules). Create `.gitignore` covering `node_modules`, `dist`, `.turbo`, `*.db`, coverage dirs. Create `README.md` stub with project name and setup instructions. | `package.json` (scripts), `.gitignore`, `README.md` | P0-T02 | 1 | • `pnpm build`, `pnpm test`, `pnpm lint` all execute via Turbo. • `.gitignore` prevents `node_modules`, `dist`, `.turbo` from being tracked. |

### Phase 0 — Hour Total: **20 hours**

---

## Phase 1 — Domain Layer

**Goal**: Implement the pure-TypeScript domain layer inside `packages/core/src/domain/` and `packages/shared/src/`. Zero runtime dependencies (except Zod in `shared` for config schemas). Every type, interface, state machine, event, and error class defined in the architecture document is delivered with unit tests.

### 1A — Entities & Value Objects

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P1-T01 | Session entity | Define the `Session` interface and `SessionWithWorkflows` interface as specified in §12.1 of the architecture document. Includes all fields: `id`, `name`, `description`, `status`, `repoUrl`, `repoBranch`, `requiresCodebase`, `workspacePath`, `tags`, `triggeredBy`, timestamps. Export from domain barrel. | `packages/core/src/domain/entities/Session.ts`, `packages/core/src/domain/entities/index.ts` | P0-T07 | 1 | • Interface compiles with `tsc --noEmit`. • All 14 fields from the architecture doc are present with correct types. |
| P1-T02 | Workflow entity | Define the `Workflow` interface as specified in §12.2. All fields: `id`, `sessionId`, `templateId`, `name`, `order`, `status`, `conversationId`, `variables`, `hookOverrides`, `copilotConfigOverrides`, `currentStep`, `totalSteps`, `error`, timestamps. | `packages/core/src/domain/entities/Workflow.ts`, update `packages/core/src/domain/entities/index.ts` | P0-T07 | 1 | • Interface compiles. • All 15 fields present. |
| P1-T03 | ChatMessage value object | Define the `ChatMessage` interface as specified in §12.3. Fields: `id`, `sessionId`, `role` (union of `'user' | 'assistant' | 'system' | 'tool'`), `content`, `attachments`, `toolName`, `toolArgs`, `toolResult`, `workflowId`, `timestamp`. | `packages/core/src/domain/value-objects/ChatMessage.ts`, `packages/core/src/domain/value-objects/index.ts` | P0-T07 | 0.5 | • Interface compiles. • `role` field is a string literal union. |
| P1-T04 | Artifact value object | Define the `Artifact` interface as specified in §12.4. Fields: `id`, `sessionId`, `workflowId`, `name`, `path`, `mimeType`, `size`, `direction` (`'inbound' | 'outbound'`), `createdAt`. Intentionally omits the DB blob field per architecture rationale. | `packages/core/src/domain/value-objects/Artifact.ts`, update `packages/core/src/domain/value-objects/index.ts` | P0-T07 | 0.5 | • Interface compiles. • `direction` is a literal union type. |
| P1-T05 | WorkflowStep value object | Define the `WorkflowStep` interface representing a single prompt step within a workflow. Fields: `label`, `text` (resolved/interpolated), `attachments`, `waitForCompletion`. Derived from the `prompts` array inside `WorkflowTemplate` (§10.3). | `packages/core/src/domain/value-objects/WorkflowStep.ts`, update `packages/core/src/domain/value-objects/index.ts` | P0-T07 | 0.5 | • Interface compiles. • Shape matches the `prompts[*]` element in `WorkflowTemplateSchema`. |
| P1-T06 | HookDefinition value object | Define the `HookDefinition` interface with fields: `id`, `name`, `phase` (`HookPhase`), `type` (`'script' | 'http' | 'function'`), `priority`, `enabled`, `failurePolicy` (`'abort' | 'skip' | 'retry'`), `timeoutMs`, `retries`, `config`. Define `HookPhase` as a string literal union of 22 phases across 4 categories: **Workflow phases** (`pre_run`, `post_run`, `pre_clone`, `post_clone`, `pre_prompt`, `post_prompt`, `pre_commit`, `post_commit`, `on_error`, `on_cancel`), **SDK session hooks** (`pre_tool_use`, `post_tool_use`, `on_message`, `on_reasoning`, `on_session_start`, `on_session_idle`, `on_session_error`), **CLI client hooks** (`on_client_start`, `on_client_stop`, `on_client_error`, `on_client_restart`), **Permission hooks** (`on_permission`). Also define `SDKHookContext` interface extending `HookContext` with `event`, `toolName?`, `toolArgs?`, `toolResult?`, `messageContent?`, `errorMessage?` fields for SDK lifecycle hooks. | `packages/core/src/domain/value-objects/HookDefinition.ts`, `packages/core/src/domain/value-objects/SDKHookContext.ts`, update `packages/core/src/domain/value-objects/index.ts` | P0-T07 | 1.5 | • Interface compiles. • `HookPhase` union has 22 members. • `SDKHookContext` extends `HookContext` with event-specific data. • `failurePolicy` is a narrow literal union. |

### 1B — State Machines

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P1-T07 | SessionStateMachine | Implement the `SessionStateMachine` class with the full transition table from §2.1: 8 states (`created`, `starting`, `running`, `paused`, `cancelling`, `cancelled`, `completed`, `deleted`), 12 transition types, `transition()` method returning new state, `canTransition()` predicate, `isChatEnabled` getter. Throws `InvalidTransitionError` on illegal transitions. | `packages/core/src/domain/state-machines/SessionStateMachine.ts`, `packages/core/src/domain/state-machines/index.ts` | P1-T01, P1-T14 | 3 | • All valid transitions from the architecture transition table execute correctly. • Invalid transitions throw `InvalidTransitionError`. |
| P1-T08 | WorkflowStateMachine | Implement the `WorkflowStateMachine` class with the full transition table from §2.2: 7 states (`pending`, `queued`, `running`, `paused`, `completed`, `failed`, `cancelled`), 10 transition types, `transition()`, `canTransition()`, `isTerminal` getter. Throws `InvalidTransitionError` on illegal transitions. | `packages/core/src/domain/state-machines/WorkflowStateMachine.ts`, update `packages/core/src/domain/state-machines/index.ts` | P1-T02, P1-T14 | 2.5 | • All valid transitions execute per tile table. • Terminal states (`completed`, `failed`, `cancelled`) reject all transitions. |
| P1-T09 | Unit tests — SessionStateMachine | Write exhaustive Vitest tests covering every valid transition edge in the table (≥18 positive cases), every invalid transition from each state (≥25 negative cases), the `isChatEnabled` getter (true only for `completed` and `cancelled`), and edge cases like double-transition sequences. | `packages/core/src/__tests__/domain/state-machines/SessionStateMachine.test.ts` | P1-T07 | 3 | • ≥40 test cases pass. • 100% branch coverage on the `SessionStateMachine` class. |
| P1-T10 | Unit tests — WorkflowStateMachine | Write exhaustive Vitest tests covering every valid transition edge (≥14 positive cases), every invalid transition from each state (≥20 negative cases), the `isTerminal` getter, and multi-step sequences (e.g., `pending → queued → running → paused → running → completed`). | `packages/core/src/__tests__/domain/state-machines/WorkflowStateMachine.test.ts` | P1-T08 | 2.5 | • ≥30 test cases pass. • 100% branch coverage on the `WorkflowStateMachine` class. |

### 1C — Port Interfaces

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P1-T11 | ICopilotPort interface | Define the `ICopilotPort` interface exactly as specified in §1.2 of the architecture with **15+ methods** organized into 5 categories: **Client Lifecycle** (`initialize`, `stop`, `forceStop`, `getClientState`, `onClientEvent`), **Model Discovery** (`getModels`, `ping`), **Conversation Lifecycle** (`createConversation`, `resumeConversation`, `listConversations`, `getLastConversationId`, `destroyConversation`, `deleteConversation`), **Messaging** (`sendPrompt`, `sendPromptAndWait`, `abortConversation`, `getMessages`), **Event Subscription** (`onConversationEvent`). Define supporting types: `CreateConversationParams` (15+ fields including `systemMessage` with append/replace modes, `availableTools`/`excludedTools`, `customAgents`, `disabledSkills`, `provider` BYOK config, `streaming`, `configDir`, `onPermissionRequest`), `ToolDefinition`, `McpServerConfig`, `AttachmentRef`, `CopilotClientState`, `CopilotClientEvent`, `CopilotModel`, `ConversationResponse`, `ConversationMessage`, `SystemMessageConfig`, `CustomAgentConfig`, `BYOKProviderConfig`, `PermissionRequest`, `PermissionResponse`, `PermissionRequestHandler`. All domain-pure — no SDK imports. | `packages/core/src/domain/ports/ICopilotPort.ts`, `packages/core/src/domain/ports/types/CopilotTypes.ts`, `packages/core/src/domain/ports/index.ts` | P0-T07, P1-T17 | 4 | • Interface compiles with zero third-party imports. • All 15+ methods and 16 supporting types are present. • `CreateConversationParams` includes systemMessage modes, BYOK, customAgents, permissions. |
| P1-T12 | Repository port interfaces | Define all six repository port interfaces exactly as specified in §12.5: `ISessionRepository` (8 methods), `IWorkflowRepository` (6 methods), `IEventRepository` (5 methods), `IChatMessageRepository` (3 methods), `IArtifactRepository` (5 methods), `IWebhookRepository` (8 methods). Each interface is in its own file under `ports/`. | `packages/core/src/domain/ports/ISessionRepository.ts`, `packages/core/src/domain/ports/IWorkflowRepository.ts`, `packages/core/src/domain/ports/IEventRepository.ts`, `packages/core/src/domain/ports/IChatMessageRepository.ts`, `packages/core/src/domain/ports/IArtifactRepository.ts`, `packages/core/src/domain/ports/IWebhookRepository.ts`, update `packages/core/src/domain/ports/index.ts` | P1-T01, P1-T02, P1-T03, P1-T04 | 2.5 | • All 6 interfaces compile. • Method signatures match architecture doc exactly (parameter and return types). |
| P1-T13 | IScriptRunner + ILogger ports | Define `IScriptRunner` interface as specified in §22.1 with `run()` and `isAvailable()` methods, plus the `ScriptRunOptions` and `ScriptRunResult` types. Define `ILogger` interface as specified in §19.3 with `debug()`, `info()`, `warn()`, `error()` methods. | `packages/core/src/domain/ports/IScriptRunner.ts`, `packages/core/src/domain/ports/ILogger.ts`, update `packages/core/src/domain/ports/index.ts` | P0-T07 | 1 | • Both interfaces compile with zero external imports. • `IScriptRunner.run()` accepts `ScriptRunOptions` and returns `Promise<ScriptRunResult>`. |

### 1D — Events

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P1-T14 | AgentEvent discriminated union | Define the complete `AgentEvent` discriminated union type from §3.2 covering all event categories: Copilot SDK events (12 kinds: `copilot.token`, `copilot.message_complete`, `copilot.tool_start`, `copilot.tool_complete`, `copilot.idle`, `copilot.error`, `copilot.session_start`, `copilot.reasoning_delta`, `copilot.user_message`, `copilot.reasoning_complete`, `copilot.session_idle`, `copilot.session_error`), Client lifecycle events (4 kinds: `copilot.client_started`, `copilot.client_stopped`, `copilot.client_error`, `copilot.client_restarting`), Workflow events (7 kinds), Session events (6 kinds), Git events (6 kinds), Script events (3 kinds), Hook events (4 kinds: `hook.started`, `hook.completed`, `hook.failed`, `hook.skipped`), Artifact events (2 kinds), Permission events (3 kinds: `permission.requested`, `permission.granted`, `permission.denied`) — totalling **~50 event kinds**. Also define `AgentEventKind` (extracted `kind` union), `PersistedEvent` interface, and `HookPhase` type. Provide a runtime `AGENT_EVENT_KINDS` array constant for validation. | `packages/shared/src/types/AgentEvent.ts`, `packages/shared/src/types/index.ts`, `packages/shared/src/constants/eventKinds.ts` | P0-T06 | 4 | • Type compiles. • `AgentEventKind` union has ≥50 members. • `AGENT_EVENT_KINDS` array length matches the union member count. • Client lifecycle, permission, and hook.skipped events are included. |
| P1-T15 | Domain event helpers | Create type-guard functions for each event category: `isCopilotEvent(e)`, `isWorkflowEvent(e)`, `isSessionEvent(e)`, `isGitEvent(e)`, `isScriptEvent(e)`, `isHookEvent(e)`, `isArtifactEvent(e)`. Also create a factory function `createEvent(kind, data)` with full type inference from the discriminated union. | `packages/shared/src/types/eventHelpers.ts`, update `packages/shared/src/types/index.ts` | P1-T14 | 1.5 | • Each type guard correctly narrows the `AgentEvent` type (verified by `tsc`). • `createEvent('copilot.token', { text: 'hi' })` type-checks; `createEvent('copilot.token', { wrong: 1 })` fails. |

### 1E — Error Hierarchy

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P1-T16 | GeneratorAIError base class + types | Implement the abstract `GeneratorAIError` base class from §9.1 with `category`, `severity`, `recoverable`, `timestamp`, `code`, and `cause` fields. Define the `ErrorCategory` (9 values) and `ErrorSeverity` (4 values) literal union types. | `packages/shared/src/errors/GeneratorAIError.ts`, `packages/shared/src/errors/types.ts`, `packages/shared/src/errors/index.ts` | P0-T06 | 1 | • Abstract class compiles. • Cannot be instantiated directly (enforced by `abstract`). • `name` property auto-set to subclass constructor name. |
| P1-T17 | Concrete error subclasses (12 classes) | Implement all concrete error classes from §9.2: `CopilotConnectionError`, `CopilotSessionError`, `CopilotTimeoutError`, `GitError`, `ScriptError` (with `exitCode`), `InvalidTransitionError`, `ValidationError` (with `fields` map), `ResourceLimitError`, `HookTimeoutError`, `HookAbortError`, `SecurityError`, `StorageError`. Each statically sets its own `category`, `severity`, `recoverable`, and `code`. Also add `ProcessNotFoundError` and `UnknownError` for the ErrorHandler's `normalize()` method. | `packages/shared/src/errors/CopilotErrors.ts`, `packages/shared/src/errors/ProcessErrors.ts`, `packages/shared/src/errors/StateErrors.ts`, `packages/shared/src/errors/ValidationErrors.ts`, `packages/shared/src/errors/ResourceErrors.ts`, `packages/shared/src/errors/HookErrors.ts`, `packages/shared/src/errors/SecurityErrors.ts`, `packages/shared/src/errors/StorageErrors.ts`, update `packages/shared/src/errors/index.ts` | P1-T16 | 3 | • ≥14 concrete classes exist, each extending `GeneratorAIError`. • Every class has a unique `code` string constant. |
| P1-T18 | Error status code map | Define the `ERROR_STATUS_MAP` constant mapping each `ErrorCategory` to an HTTP status code, exactly matching the table in §9.5 (e.g., `validation → 400`, `state → 409`, `copilot → 502`). Export from shared errors. | `packages/shared/src/errors/statusMap.ts`, update `packages/shared/src/errors/index.ts` | P1-T16 | 0.5 | • Map contains all 9 error categories. • Values are valid HTTP status codes. |
| P1-T19 | Unit tests — Error hierarchy | Test that every concrete error class: (a) is an instance of `GeneratorAIError` and `Error`, (b) has the correct `category`, `severity`, `code`, and `recoverable` values, (c) preserves `cause` when chained, (d) sets `name` to the class name, (e) `timestamp` is a positive number. Test `ValidationError.fields` and `ScriptError.exitCode` extra fields. | `packages/shared/src/__tests__/errors/errors.test.ts` | P1-T17 | 2 | • ≥25 test cases pass. • Every error subclass is tested for its static properties. |

### 1F — Configuration Schemas

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P1-T20 | AppConfig Zod schema | Implement the `AppConfigSchema` with all nested objects as specified in §10.2: top-level fields (`port`, `dbPath`, `workspacesDir`, `artifactsDir`, `maxConcurrentSessions`, `logLevel`), nested `copilot` config (6 fields), `streaming` config (2 fields), `security` config (3 fields), `webhooks` config (3 fields). Include defaults so `AppConfigSchema.parse({})` returns a fully populated config. Export `AppConfig` as `z.infer<typeof AppConfigSchema>`. | `packages/shared/src/config/AppConfig.ts`, `packages/shared/src/config/index.ts` | P0-T06 | 2 | • `AppConfigSchema.parse({})` succeeds and returns an object with all default values populated. • `AppConfigSchema.parse({ port: 99 })` throws (below minimum 1024). |
| P1-T21 | WorkflowTemplate Zod schema | Implement the `WorkflowTemplateSchema` as specified in §10.3 covering: top-level fields (`id`, `name`, `description`, `category` enum, `version`, `icon`, `requiresCodebase`), nested `copilotConfig` (6 fields), `prompts` array of objects, `tools` array, `hooks` array (referencing `HookDefinitionSchema`), and `variables` array with `type` enum. Also define and export `HookDefinitionSchema` as a Zod object. | `packages/shared/src/config/WorkflowTemplate.ts`, `packages/shared/src/config/HookDefinitionSchema.ts`, update `packages/shared/src/config/index.ts` | P0-T06, P1-T06 | 3 | • `WorkflowTemplateSchema.parse(minimalValidTemplate)` succeeds. • Schema correctly rejects missing required field `id`. • `prompts` is a required non-empty array. |
| P1-T22 | CreateSessionParams type | Define the `CreateSessionParams` interface from §10.6 with fields: `name`, `description`, `repoUrl`, `repoBranch`, `workflows` array (each with `templateId`, `variables`, `hookOverrides`, `copilotConfigOverrides`), `mcpServers`, `tags`. Optionally include a Zod schema for request validation. | `packages/shared/src/types/CreateSessionParams.ts`, update `packages/shared/src/types/index.ts` | P0-T06, P1-T06 | 1 | • Interface compiles. • `workflows` array type requires `templateId` as mandatory. |
| P1-T23 | Unit tests — Config schemas | Test `AppConfigSchema`: defaults population, partial overrides, invalid values (bad port, bad enum), nested object defaults. Test `WorkflowTemplateSchema`: minimal valid template, full template, missing required fields, invalid category enum, prompt array validation. | `packages/shared/src/__tests__/config/AppConfig.test.ts`, `packages/shared/src/__tests__/config/WorkflowTemplate.test.ts` | P1-T20, P1-T21 | 2.5 | • ≥20 test cases across both schemas. • Coverage includes happy path, defaults, and error paths for each schema. |

### 1G — Domain Barrel Exports & Integration

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P1-T24 | Core package barrel exports | Wire up all domain layer exports through `packages/core/src/domain/index.ts` and the top-level `packages/core/src/index.ts`. Ensure all entities, value objects, ports, state machines, and event types are publicly accessible via `import { ... } from '@generatorai/core'`. Wire up `packages/shared/src/index.ts` to re-export all types, errors, config schemas, constants, and utils. | `packages/core/src/domain/index.ts`, `packages/core/src/index.ts`, `packages/shared/src/index.ts` | P1-T01 through P1-T22 | 1.5 | • `import { Session, SessionStateMachine, ICopilotPort, AgentEvent, GeneratorAIError, AppConfigSchema } from '@generatorai/core'` (or appropriate packages) compiles. • `pnpm turbo typecheck` passes for all packages. |
| P1-T25 | Full type-check & lint pass | Run `pnpm turbo typecheck` and `pnpm turbo lint` across the entire monorepo. Fix any cross-package reference issues, circular imports, or ESLint boundary violations. Ensure the domain layer has zero imports from Node.js built-ins or third-party libraries (other than Zod in `shared`). | No new files — fix existing ones | P1-T24 | 2 | • `pnpm turbo typecheck` exits 0. • `pnpm turbo lint` exits 0. • `packages/core/src/domain/**` contains zero `import` statements referencing `node:*` or any `node_modules` package. |

### 1H — Platform Abstraction Contract

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P1-T26 | IPlatformClient interface | Define the `IPlatformClient` interface per §6.2 with all methods: `getSessions()`, `getSession(id)`, `createSession(params)`, `startSession(id)`, `pauseSession(id)`, `resumeSession(id)`, `cancelSession(id)`, `deleteSession(id)`, `getWorkflows(sessionId)`, `pauseWorkflow(id)`, `resumeWorkflow(id)`, `sendPrompt(sessionId, prompt, attachments?)`, `getChatHistory(sessionId, limit?, offset?)`, `getWorkflowTemplates()`, `getArtifacts(sessionId)`, `downloadArtifact(id)`, `subscribeToEvents(sessionId, handler)` (returns Unsubscribe). Also define `selectDirectory()` and `openInEditor(path)` for desktop. Include the `platform` property (`'web' | 'desktop' | 'cli'`). | `packages/shared/src/types/IPlatformClient.ts`, update `packages/shared/src/types/index.ts` | P0-T06, P1-T01, P1-T02, P1-T03, P1-T14 | 1.5 | • Interface compiles with `tsc --noEmit`. • All §6.2 methods present with correct signatures. • Three downstream client implementations (HTTP, IPC, Direct) can type-check against it. |

### Phase 1 — Hour Total: **48.5 hours**

---

## Combined Summary

| Phase | Tasks | Hours |
|-------|-------|-------|
| **Phase 0 — Project Scaffolding** | 19 tasks (P0-T01 → P0-T19) | **20 h** |
| **Phase 1 — Domain Layer** | 26 tasks (P1-T01 → P1-T26) | **48.5 h** |
| **Total** | 45 tasks | **68.5 h** |

---

## Dependency Graph (Critical Path)

```
P0-T01 (pnpm workspace)
  ├── P0-T02 (turborepo) ──► P0-T17 (CI) ──► P0-T19 (root scripts)
  ├── P0-T03 (tsconfig) ──┬── P0-T05 (vitest)
  │                        ├── P0-T06 (shared pkg) ──┬── P0-T07 (core pkg) ──┬── P0-T08 (db pkg) ───┐
  │                        │                         │                       ├── P0-T09 (bridge pkg)│
  │                        │                         │                       ├── P0-T10 (stream pkg)│
  │                        │                         │                       └── P0-T15 (cli app)   │
  │                        │                         │                                              │
  │                        │                         └── P1-T01…T06 (entities/VOs) ──┐             │
  │                        │                                                          │             │
  │                        ├── P0-T11 (ui pkg) ──┬── P0-T13 (web app)                │             │
  │                        │                     └── P0-T14 (desktop app)             │             │
  │                        └── P0-T18 (templates)                                     │             │
  │                                                                                   │             │
  ├── P0-T04 (eslint) ──► P0-T16 (husky)                                             │             │
  │                                                                                   ▼             │
  │                                                                         P1-T07…T08 (SMs)       │
  │                                                                            │                    │
  │                                                                            ▼                    │
  │                                                                         P1-T09…T10 (SM tests)  │
  │                                                                                                 │
  │  P0-T06 ──► P1-T14 (AgentEvent) ──► P1-T15 (event helpers)                                    │
  │          ──► P1-T16 (base error) ──► P1-T17 (error subclasses) ──► P1-T19 (error tests)       │
  │          ──► P1-T20 (AppConfig) ──┬── P1-T23 (config tests)                                   │
  │          ──► P1-T21 (WfTemplate)──┘                                                           │
  │          ──► P1-T22 (CreateSessionParams)                                                     │
  │                                                                                                │
  │  P1-T01…T04, P1-T14 ──► P1-T11 (ICopilotPort)                                               │
  │  P1-T01…T04 ──► P1-T12 (repo ports)                                                          │
  │  ──► P1-T13 (IScriptRunner + ILogger)                                                        │
  │                                                                                                │
  └── All P1 tasks ──► P1-T24 (barrel exports) ──► P1-T25 (full lint/typecheck)   ◄───────────────┘
```

**Critical path**: P0-T01 → P0-T03 → P0-T06 → P0-T07 → P1-T01 → P1-T07 → P1-T09 → P1-T24 → P1-T25

---

## Notes

1. **Domain purity invariant**: Throughout Phase 1, the `packages/core/src/domain/` directory must contain **zero** imports from Node.js built-ins (`node:fs`, `node:path`, etc.), NPM packages, or any other layer. Only pure TypeScript types and logic. The `packages/shared/` layer is allowed `zod` as its single external dependency (for config schemas).

2. **State machine approach**: State machines use a static transition table (plain `Record<State, Partial<Record<Transition, State>>>`) — no XState or other library. This keeps the domain layer dependency-free and maximally testable.

3. **Testing target**: Phase 1 tests (P1-T09, P1-T10, P1-T19, P1-T23) should collectively achieve **100% branch coverage** on state machines and error classes, establishing the quality bar for all subsequent phases.

4. **Monorepo package naming**: All packages use the `@generatorai/` npm scope. Apps use the same scope internally but are not published.

5. **Parallel work**: P1 tasks in groups 1C (ports), 1D (events), and 1E (errors) are largely independent and can be executed in parallel by different developers after the entities/VOs in 1A are complete.


---

## Phase 2 — Infrastructure Layer

**Goal**: Implement all concrete infrastructure adapters that fulfil the domain port interfaces defined in Phase 1. After this phase, every repository, the Copilot bridge, the script runner, the Git manager, and the logger are functional and proven against real (in-memory) SQLite. Zero application-layer logic — pure adapter code.

### 2A — Database Foundation

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P2-T01 | SQLite + better-sqlite3 + Drizzle wiring | Install `better-sqlite3`, `drizzle-orm`, and `drizzle-kit` into `packages/db`. Implement the `createDB(dbPath)` function from §11.3 that opens a better-sqlite3 connection, sets WAL mode, `synchronous = NORMAL`, 64 MB cache, foreign keys ON, and 5 s busy timeout, then returns a typed Drizzle instance. Export `createDB` and `createTestDB()` (`:memory:` variant) from the package barrel. Add a `drizzle.config.ts` pointing at `src/schema.ts`. | `packages/db/src/index.ts`, `packages/db/drizzle.config.ts`, `packages/db/package.json` (deps update) | P0-T08 (db scaffold) | 2 | • `createDB('/tmp/test.db')` returns a Drizzle instance without error. • `createTestDB()` returns an in-memory Drizzle instance. • All six SQLite PRAGMAs are set (verifiable via `PRAGMA journal_mode` returning `wal`). |
| P2-T02 | Full Drizzle schema — 7 tables | Transcribe the complete schema from §11.1 into `packages/db/src/schema.ts`: `sessions` (2 indexes), `workflows` (3 indexes), `events` (3 indexes, including unique composite), `chatMessages` (2 indexes), `artifacts` (1 index), `webhookRegistrations`, `webhookDeliveries`. All column types, JSON mode columns, foreign-key cascades, and default values must match the architecture doc exactly. Generate the initial migration via `drizzle-kit generate`. | `packages/db/src/schema.ts`, `packages/db/src/migrations/0000_initial.sql`, `packages/db/src/migrations/meta/` | P2-T01 | 3 | • `drizzle-kit generate` produces a migration file with 7 `CREATE TABLE` statements. • Each table has the correct columns, types, and indexes as specified in §11.1. • Foreign keys cascade on delete where specified. |
| P2-T03 | Migration runner | Implement `runMigrations(db)` that applies pending Drizzle migrations from the `migrations/` folder. Expose it from the package barrel alongside `createDB`. Integrate so that `createDB` optionally auto-migrates on first call. | `packages/db/src/migrate.ts`, update `packages/db/src/index.ts` | P2-T02 | 1 | • Calling `runMigrations(db)` on a fresh `:memory:` database creates all 7 tables. • Calling it twice is idempotent (no errors). |

### 2B — Repository Implementations

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P2-T04 | SessionRepository | Implement `ISessionRepository` (8 methods from §12.5) using Drizzle ORM against the `sessions` table. Map between the Drizzle row type and the domain `Session` entity — convert integer timestamps to `Date`, parse JSON `tags` and `triggeredBy`. `updateStatus` also sets `updatedAt`, and conditionally sets `startedAt`/`completedAt` for terminal transitions. | `packages/db/src/repositories/SessionRepository.ts` | P2-T02, P1-T01, P1-T12 | 3 | • All 8 interface methods are implemented. • `create` → `getById` round-trips all fields including JSON columns. • `getByStatus(['running', 'paused'])` returns only matching rows. |
| P2-T05 | WorkflowRepository | Implement `IWorkflowRepository` (6 methods from §12.5) using Drizzle against the `workflows` table. Handle JSON columns (`variables`, `hookOverrides`, `copilotConfigOverrides`). `getBySessionId` orders by the `order` column ascending. | `packages/db/src/repositories/WorkflowRepository.ts` | P2-T02, P1-T02, P1-T12 | 2.5 | • All 6 interface methods are implemented. • `getBySessionId` returns workflows sorted by `order`. • `updateStatus` + `update` compose correctly for concurrent field changes. |
| P2-T06 | EventRepository | Implement `IEventRepository` (5 methods from §12.5) using Drizzle against the `events` table. `insert` stores data as JSON text and returns the auto-increment `id`. `getAfterSequence` returns events with `sequenceId > afterSeqId` ordered by `sequenceId` ASC for SSE replay. `getMaxSequencePerSession` uses a `GROUP BY` / `MAX` aggregate for startup recovery. | `packages/db/src/repositories/EventRepository.ts` | P2-T02, P1-T14, P1-T12 | 2.5 | • `insert` returns a positive integer ID. • `getAfterSequence(sid, 5)` returns only events with `sequenceId > 5`. • `getMaxSequencePerSession()` returns correct maximums across multiple sessions. |
| P2-T07 | ChatMessageRepository | Implement `IChatMessageRepository` (3 methods from §12.5) using Drizzle against the `chatMessages` table. `getBySessionId` supports `limit` and `offset` for pagination and orders by `timestamp` ASC. JSON columns `attachments`, `toolArgs`, `toolResult` are correctly serialized/deserialized. | `packages/db/src/repositories/ChatMessageRepository.ts` | P2-T02, P1-T03, P1-T12 | 2 | • All 3 interface methods are implemented. • `getBySessionId` with `limit=10, offset=5` returns correct page. • Attachment JSON round-trips faithfully. |
| P2-T08 | ArtifactRepository | Implement `IArtifactRepository` (5 methods from §12.5) using Drizzle against the `artifacts` table. `upsert` uses Drizzle's `onConflictDoUpdate` on the primary key. The `content` blob column is handled but the domain `Artifact` entity omits it — the repo accepts an optional `content` buffer on `create`/`upsert` for small files. | `packages/db/src/repositories/ArtifactRepository.ts` | P2-T02, P1-T04, P1-T12 | 2 | • All 5 interface methods are implemented. • `upsert` inserts on first call, updates on second with same ID. • `getBySessionId` returns artifacts sorted by `createdAt` DESC. |
| P2-T09 | WebhookRepository | Implement `IWebhookRepository` (8 methods from §12.5) using Drizzle against `webhookRegistrations` and `webhookDeliveries` tables. `getActiveRegistrations` filters by `source`, `eventType`, and `enabled = true`. `getDeliveryById` looks up by the external `deliveryId` column (for deduplication). `updateDelivery` performs a partial update on the delivery row. | `packages/db/src/repositories/WebhookRepository.ts` | P2-T02, P1-T12 | 2.5 | • All 8 interface methods are implemented. • `getActiveRegistrations('github', 'push')` returns only enabled matching rows. • `logDelivery` → `getDeliveryById` round-trip succeeds. |

### 2C — Infrastructure Adapters

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P2-T10 | CopilotAdapter (ICopilotPort impl) | Implement the `CopilotAdapter` class in `packages/copilot-bridge/` that implements `ICopilotPort` with all **15+ methods**. Wraps the Copilot SDK's `CopilotClient` as a single shared instance per §4.1. **Client Lifecycle**: `initialize()` (start CLI with autoRestart), `stop()`, `forceStop()`, `getClientState()` (maps SDK state enum), `onClientEvent()` (client-level event subscription). **Model Discovery**: `getModels()` (delegates to SDK), `ping()`. **Conversation Lifecycle**: `createConversation(params)` (maps full `CreateConversationParams` to SDK SessionConfig including `systemMessage` mode resolution, `availableTools`/`excludedTools`, `customAgents`, BYOK `provider` config, `onPermissionRequest` callback bridging, `streaming` flag), `resumeConversation()`, `listConversations()`, `getLastConversationId()`, `destroyConversation()`, `deleteConversation()`. **Messaging**: `sendPrompt()` (with attachments), `sendPromptAndWait()` (returns final message), `abortConversation()`, `getMessages()`. **Event Subscription**: `onConversationEvent()` maps all 11 SDK event types (`user.message`, `assistant.message`, `assistant.message_delta`, `assistant.reasoning`, `assistant.reasoning_delta`, `tool.execution_start`, `tool.execution_complete`, `session.start`, `session.idle`, `session.error`) to domain `AgentEvent` kinds. Includes crash-recovery polling loop from §4.3 (5 s health check interval, `resumeAllConversations()` on reconnect, client lifecycle event emission). Tracks active conversations in a `Map`. | `packages/copilot-bridge/src/CopilotAdapter.ts`, `packages/copilot-bridge/src/event-mapper.ts`, `packages/copilot-bridge/src/permission-bridge.ts`, `packages/copilot-bridge/src/index.ts` | P0-T09, P1-T11, P1-T14 | 9 | • Class implements all 15+ `ICopilotPort` methods. • `createConversation` maps all new params (systemMessage modes, BYOK, customAgents, permissions). • Event mapper handles all 11 SDK event types. • Client lifecycle events (`copilot.client_started/stopped/error/restarting`) are emitted. • Recovery loop resumes all tracked conversations after reconnect. |
| P2-T11 | SandboxedScriptRunner | Implement `IScriptRunner` as `SandboxedScriptRunner` per §22.2. Constructor takes `allowedCommands: Set<string>`. `run()` validates the command basename against the allowlist, rejects args containing shell metacharacters (`` ` $ ; | & ``), spawns with `shell: false`, streams stdout/stderr via `streamTo` callback, respects `AbortSignal`, enforces timeout (default 5 min), caps output buffer at 10 MB, and returns `ScriptRunResult`. `isAvailable()` uses `where`/`which` to check PATH. | `packages/core/src/infrastructure/SandboxedScriptRunner.ts` | P1-T13 | 3 | • Rejects disallowed commands with `SecurityError`. • Rejects args with shell metacharacters. • Spawns with `shell: false`. • `streamTo` callback fires for each stdout/stderr chunk. • `AbortSignal` aborts kills the process with SIGTERM → SIGKILL fallback. |
| P2-T12 | GitManager | Implement `GitManager` per §7.2. Constructor takes `workspacesDir` and an `EventBus` reference. Methods: `getSessionWorkspace(sessionId)`, `getRepoDir(sessionId)`, `getArtifactsDir(sessionId)`, `clone(sessionId, options)` (creates directories, runs `git clone` with optional branch/depth, writes `.metadata.json`, emits `git.clone_start/progress/complete` events), `commitAndPush(sessionId, message, branch?)` (checkout branch, add all, commit, push, emits `git.commit/push`), `createPullRequest(sessionId, title, body, baseBranch?)` (uses `gh pr create`, emits `git.pr_created`), `cleanup(sessionId)` (recursive rm). Private helpers spawn `git`/`gh` processes and stream stderr to event bus. | `packages/core/src/infrastructure/GitManager.ts` | P1-T14, P1-T13 | 4 | • `clone` creates `<workspacesDir>/<sessionId>/repo/` and writes `.metadata.json`. • `commitAndPush` returns a commit SHA string. • `cleanup` removes the entire session workspace directory. • All git operations emit the correct `AgentEvent` kinds. |
| P2-T13 | Pino Logger adapter | Implement `ILogger` as `PinoLogger` in `packages/shared/src/logging/`. Wraps a `pino` instance created via the `createLogger` factory from §19.1. Constructor accepts `{ level, service }`. Adapts the `ILogger` interface (`debug`, `info`, `warn`, `error` each accept `msg: string` and optional `context: Record<string, unknown>`) to pino's `logger.info(context, msg)` call style. Applies `pino-pretty` transport in development (`NODE_ENV === 'development'`). Configures `redact` paths for sensitive fields (`*.apiKey`, `*.token`, `*.secret`, `*.password`). | `packages/shared/src/logging/PinoLogger.ts`, `packages/shared/src/logging/index.ts`, `packages/shared/package.json` (add `pino`, `pino-pretty` deps) | P1-T13 | 2 | • `PinoLogger` implements all 4 `ILogger` methods. • `logger.info('hello', { sessionId: '123' })` outputs structured JSON with `service` base field. • Sensitive fields matching redact patterns are replaced with `[Redacted]`. |

### 2D — Integration Tests

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P2-T14 | Test helper: in-memory DB factory | Create a shared test utility that spins up a `:memory:` SQLite database via `createTestDB()`, runs migrations, and returns the DB instance plus all six repository instances pre-wired. Provides a `cleanup()` that closes the connection. Used by all repo integration tests. | `packages/db/src/__tests__/helpers/testDb.ts` | P2-T03, P2-T04 through P2-T09 | 1.5 | • `createTestEnv()` returns `{ db, sessionRepo, workflowRepo, eventRepo, chatRepo, artifactRepo, webhookRepo, cleanup }`. • Calling `cleanup()` closes the DB without errors. |
| P2-T15 | Integration tests — SessionRepository | Test all 8 methods: `create` with all fields, `getById` for existing and missing IDs, `getAll` ordering, `getByStatus` filtering, `countByStatus` accuracy, `update` partial fields, `updateStatus` timestamp side-effects, `delete` cascade (verify child workflows are deleted via FK cascade). | `packages/db/src/__tests__/repositories/SessionRepository.test.ts` | P2-T14, P2-T04 | 3 | • ≥15 test cases pass. • Tests run against `:memory:` SQLite. • Cascade delete verified. |
| P2-T16 | Integration tests — WorkflowRepository | Test all 6 methods: `create`, `getById`, `getBySessionId` (verify ordering by `order`), `updateStatus`, `update` JSON columns, `delete`. Verify FK constraint — creating a workflow with non-existent `sessionId` throws. | `packages/db/src/__tests__/repositories/WorkflowRepository.test.ts` | P2-T14, P2-T05 | 2.5 | • ≥12 test cases pass. • `getBySessionId` returns sorted by `order`. |
| P2-T17 | Integration tests — EventRepository | Test all 5 methods: `insert` returns auto-increment IDs, `getBySessionId` returns all events, `getAfterSequence` filters correctly, `getMaxSequencePerSession` aggregates across sessions, `deleteBySession` removes only target session's events. Insert 20+ events across 3 sessions to validate. | `packages/db/src/__tests__/repositories/EventRepository.test.ts` | P2-T14, P2-T06 | 2.5 | • ≥12 test cases pass. • Sequence-based replay returns correct subset. • Max-sequence aggregation correct for 3 sessions. |
| P2-T18 | Integration tests — ChatMessageRepository | Test all 3 methods: `create` with all fields including JSON attachments, `getBySessionId` with pagination (`limit`/`offset`), `deleteBySession`. Insert messages with various roles and verify JSON round-tripping for `attachments`, `toolArgs`, `toolResult`. | `packages/db/src/__tests__/repositories/ChatMessageRepository.test.ts` | P2-T14, P2-T07 | 2 | • ≥8 test cases pass. • Pagination returns correct window. • JSON columns preserve complex objects. |
| P2-T19 | Integration tests — ArtifactRepository | Test all 5 methods: `create`, `upsert` (insert + update path), `getById` (found + not-found), `getBySessionId`, `deleteBySession`. Verify that `upsert` with same ID updates the row rather than erroring. | `packages/db/src/__tests__/repositories/ArtifactRepository.test.ts` | P2-T14, P2-T08 | 2 | • ≥10 test cases pass. • `upsert` idempotency verified. |
| P2-T20 | Integration tests — WebhookRepository | Test all 8 methods: `createRegistration`, `getRegistration`, `getAllRegistrations`, `getActiveRegistrations` (filter by source + eventType + enabled), `deleteRegistration`, `logDelivery`, `getDeliveryById` (by external deliveryId), `updateDeliveryStatus`, `updateDelivery`. Test deduplication scenario — log delivery, retrieve by deliveryId, verify uniqueness. | `packages/db/src/__tests__/repositories/WebhookRepository.test.ts` | P2-T14, P2-T09 | 2.5 | • ≥12 test cases pass. • `getActiveRegistrations` correctly filters disabled registrations. • Delivery dedup lookup returns correct row. |
| P2-T21 | Integration tests — SandboxedScriptRunner | Test `run()` with an allowed command (e.g., `node -e "console.log('ok')"`), a disallowed command (expect `SecurityError`), an arg with shell metacharacters (expect `SecurityError`), a command that exits non-zero, a command that exceeds timeout, and `streamTo` callback invocation. Test `isAvailable()` for `node` (true) and a non-existent command (false). | `packages/core/src/__tests__/infrastructure/SandboxedScriptRunner.test.ts` | P2-T11 | 2 | • ≥8 test cases pass. • Security validations fire before any process spawn. |

### Phase 2 — Hour Total: **58 hours**

---

## Phase 3 — Application Services

**Goal**: Implement all application-layer orchestration services inside `packages/core/src/services/`. These services drive the domain state machines, coordinate cross-aggregate flows, and interact with infrastructure adapters exclusively through port interfaces. After this phase the full backend business logic is functional end-to-end (minus HTTP routes).

### 3A — Event Infrastructure

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P3-T01 | EventBus (with persistence + SSE bridge + global channel) | Implement `EventBus` per §3.3. Uses an in-process `EventEmitter`. `emit(sessionId, event)` assigns a monotonic per-session `sequenceId`, persists the event to `IEventRepository` (if injected), broadcasts to `session:<id>` and `session:*` channels, and returns the `PersistedEvent`. `subscribe(sessionId, handler)` and `subscribeAll(handler)` return unsubscribe functions. `restoreCounters()` loads max sequence IDs from the DB for session resumption. `setMaxListeners(1000)` to support many SSE connections. **Global channel**: `emitGlobal(event)` broadcasts to the `global:*` channel for session-agnostic events (client lifecycle: `copilot.client_started/stopped/error/restarting`). `subscribeGlobal(handler)` returns an unsubscribe function. Global events are persisted to a special `__global__` session partition. | `packages/core/src/events/EventBus.ts` | P1-T14, P1-T12 (IEventRepository port), P2-T06 (EventRepository impl for integration) | 4 | • `emit` increments sequence IDs monotonically per session. • `subscribe` receives only events for its session. • `subscribeAll` receives events from all sessions. • `restoreCounters` initializes counters from DB max values. • `emitGlobal` broadcasts on global channel. • `subscribeGlobal` receives only global events. |
| P3-T02 | SSETransport | Implement the `SSETransport` class from §3.4 in `packages/streaming/`. `createHandler()` returns an Express-compatible `(req, res)` handler for `GET /api/sessions/:sessionId/stream`. Supports `Last-Event-ID` header for replay from `IEventRepository`, live streaming via `EventBus.subscribe`, 15 s heartbeat, event filtering via `?filter=` query parameter (§3.6), and cleanup on client disconnect. Implements write-buffer backpressure check (§3.5) — marks slow clients and throttles `copilot.token` events. | `packages/streaming/src/SSETransport.ts`, `packages/streaming/src/index.ts` | P3-T01, P2-T06 | 3 | • Handler sets correct SSE headers (`text/event-stream`, `no-cache`). • `Last-Event-ID: 5` replays events with `sequenceId > 5` from DB, then switches to live. • Heartbeat comments sent every 15 s. • Disconnect triggers unsubscribe + heartbeat cleanup. |

### 3B — Core Services

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P3-T03 | SessionService | Implement `SessionService` with methods: `createSession(params: CreateSessionParams)` — validates params, creates session + workflow rows, returns session; `startSession(sessionId)` — enforces `MAX_CONCURRENT_SESSIONS` (§4.6), transitions session state machine `created → starting → running`, clones repo if `requiresCodebase`, runs `post_clone` hooks, queues workflows, starts first workflow; `pauseSession(sessionId)` — transitions to `paused`, pauses running workflow; `resumeSession(sessionId)` — transitions to `running`, resumes paused workflow; `cancelSession(sessionId)` — transitions to `cancelling → cancelled`, aborts Copilot conversation, runs `on_cancel` hooks; `deleteSession(sessionId)` — destroys Copilot conversation, cleans up workspace via `GitManager.cleanup`, deletes DB rows; `onWorkflowCompleted(sessionId, workflowId)` — advances to next queued workflow or marks session `completed`; `onWorkflowFailed(sessionId, workflowId, error)` — marks session as `completed` with error or retries based on config. All transitions emit the corresponding `session.*` events via `EventBus`. | `packages/core/src/services/SessionService.ts` | P3-T01, P1-T07, P1-T12, P2-T04, P2-T05, P2-T12 | 8 | • `createSession` persists session + workflows and returns a `Session` with status `created`. • `startSession` transitions through `starting → running` and invokes `workflowService.startWorkflow` for the first workflow. • `cancelSession` aborts the active Copilot conversation and emits `session.cancelled`. • `onWorkflowCompleted` advances to next workflow or completes session. |
| P3-T04A | WorkflowService — Core Execution Pipeline | Implement the core `WorkflowService` class per §15.1. Constructor accepts `HookInterceptor` in addition to other dependencies. `startWorkflow(workflowId)` executes the primary pipeline: (1) resolve config via `ConfigResolver`, (2) run `pre_run` hooks via `HookExecutor`, (3) create Copilot conversation via `ICopilotPort.createConversation` passing all expanded params (systemMessage modes, tools, customAgents, BYOK provider, permissions, streaming), (4) use `HookInterceptor.createInterceptedEventHandler(sessionId, hooks)` to subscribe to conversation events — this routes events through SDK lifecycle hooks before forwarding to `EventBus`, (5) loop over prompts sequentially — check workflow still `running` between prompts, run `pre_prompt` hooks, save user prompt to `IChatMessageRepository`, send prompt to Copilot with optional attachments, `waitForIdle`, run `post_prompt` hooks, (6) unsubscribe, (7) run `post_run` hooks, (8) mark completed, (9) call `sessionService.onWorkflowCompleted`. Handle circular `SessionService` dependency via setter injection. | `packages/core/src/services/WorkflowService.ts` | P3-T03, P3-T07, P3-T07B, P3-T10, P1-T08, P1-T11, P1-T12, P2-T05, P2-T07 | 7 | • `startWorkflow` executes all prompts sequentially, emitting `workflow.started`, `workflow.step_started/completed` per prompt, and `workflow.completed` at the end. • Events pass through HookInterceptor (SDK lifecycle hooks can intercept tool calls). • Between prompts, re-fetches workflow status — exits early if paused/cancelled. • Hooks run at `pre_run`, `pre_prompt`, `post_prompt`, `post_run` phases. • All new CreateConversationParams fields passed to ICopilotPort. |
| P3-T04B | WorkflowService — Lifecycle & Error Handling | Extend `WorkflowService` with lifecycle methods and error path: `pauseWorkflow(workflowId)` (abort Copilot conversation, set status `paused`), `resumeWorkflow(workflowId)` (re-enter `startWorkflow` from `currentStep`), and full error handling: run `on_error` hooks, mark `failed`, call `sessionService.onWorkflowFailed`. Add `detectArtifacts` call after each prompt completes (delegates to `ArtifactService`). Add attachment resolution via `AttachmentService.resolveAttachments()` before sending each prompt. | `packages/core/src/services/WorkflowService.ts` | P3-T04A, P3-T06, P3-T06B | 5 | • On error, runs `on_error` hooks and emits `workflow.failed`. • `pauseWorkflow` aborts the Copilot conversation and sets status to `paused`. • `resumeWorkflow` resumes from `currentStep`. • Artifact detection runs after each prompt completion. |
| P3-T05 | ChatService | Implement `ChatService` with methods: `sendMessage(sessionId, content, attachments?)` — routes a user chat prompt to the active Copilot conversation (if running workflow) or creates an ad-hoc conversation (if session completed/paused for free chat), persists the user message, waits for assistant response, persists the response; `getHistory(sessionId, limit?, offset?)` — returns paginated chat messages from `IChatMessageRepository`; `getWorkflowHistory(workflowId)` — filters messages by `workflowId`. Emits `copilot.*` events through `EventBus` for live streaming to UI. | `packages/core/src/services/ChatService.ts` | P3-T01, P1-T11, P1-T12 (IChatMessageRepository), P2-T07 | 4 | • `sendMessage` persists a `user` message and an `assistant` response after Copilot replies. • `getHistory` returns messages in chronological order with correct pagination. • Free chat works when no active workflow exists. |
| P3-T06 | ArtifactService | Implement `ArtifactService` with methods: `detectArtifacts(sessionId, workflowId, workspacePath)` — scans the workspace `artifacts/` directory for new/changed files, computes metadata (name, path, mimeType, size), upserts into `IArtifactRepository`, reads small files (< 1 MB) into the `content` blob, emits `artifact.created` events; `getArtifacts(sessionId)` — lists all artifacts for a session; `getArtifact(artifactId)` — returns a single artifact; `deleteArtifacts(sessionId)` — removes artifact records and optionally the files on disk. | `packages/core/src/services/ArtifactService.ts` | P3-T01, P1-T12 (IArtifactRepository), P2-T08 | 3 | • `detectArtifacts` discovers files in the artifacts directory and creates DB records. • Files < 1 MB have `content` populated; larger files have `content = null`. • `artifact.created` event emitted per new artifact. |
| P3-T06B | AttachmentService | Implement `AttachmentService` with methods: `storeUpload(sessionId, file)` — validates file type/size against allowed MIME types and max upload size from config, stores the file to `workspaces/<sessionId>/attachments/`, returns an `Attachment` object with `{ id, name, path, mimeType, size }`; `resolveAttachments(workflowId, promptIndex)` — looks up attachments configured for the given prompt in the workflow definition, resolves file paths, returns an array of `{ filePath, mimeType }` suitable for passing to `ICopilotPort.sendMessage()`; `deleteAttachments(sessionId)` — removes all attachment files for a session. | `packages/core/src/services/AttachmentService.ts` | P3-T01, P1-T12, P3-T10 | 2 | • `storeUpload` rejects files exceeding max size with `ValidationError`. • `storeUpload` rejects disallowed MIME types. • `resolveAttachments` returns correct file paths for prompt attachments. • `deleteAttachments` removes files from disk. |
| P3-T01B | ErrorHandler | Implement `ErrorHandler` class per §9. `handle(error, context?)` — normalizes the error via `normalize()`, logs it with full context (session ID, workflow ID, operation) via the logger, emits an `error.occurred` event via `EventBus`, and returns the normalized error. `normalize(error)` — maps unknown errors to the domain error hierarchy: `CopilotError` for SDK failures (with `code`, `retryable` flag), `ValidationError` for input issues, `SecurityError` for auth/permission failures, `StorageError` for DB/file issues, and `GeneratorAIError` as the base catch-all. Extracts meaningful messages from nested error chains. Integrates with the retry logic in `WorkflowService` for retryable errors. | `packages/core/src/services/ErrorHandler.ts` | P3-T01, P1-T09 | 2 | • `normalize` maps a raw `Error` to the correct domain error subclass. • `handle` logs the error and emits `error.occurred` event. • Unknown errors become `GeneratorAIError` with the original as `cause`. • `CopilotError` with `retryable: true` triggers retry logic. |

### 3C — Hook & Webhook Systems

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P3-T07 | HookExecutor | Implement `HookExecutor` per §5.3. `executePhase(phase, hooks, context)` filters hooks by `phase` and `enabled`, sorts by `priority` ASC, executes each sequentially with retry logic (exponential backoff: 1 s, 2 s, 4 s…). Supports all 22 hook phases across 4 categories: **Workflow phases** (10: `pre_run`, `post_run`, `pre_clone`, `post_clone`, `pre_prompt`, `post_prompt`, `pre_commit`, `post_commit`, `on_error`, `on_cancel`), **SDK session hooks** (7: `pre_tool_use`, `post_tool_use`, `on_message`, `on_reasoning`, `on_session_start`, `on_session_idle`, `on_session_error`), **CLI client hooks** (4: `on_client_start`, `on_client_stop`, `on_client_error`, `on_client_restart`), **Permission hooks** (1: `on_permission`). Supports 3 hook types: `script` (delegates to `IScriptRunner`, injects `SESSION_ID`/`WORKFLOW_ID` env vars, streams output to `EventBus`), `http` (makes HTTP request with template-interpolated body via `{{variables}}`), `function` (dynamic-imports a module and calls its default export). SDK lifecycle hooks receive `SDKHookContext` (extends `HookContext` with `event`, `toolName`, `toolArgs`, `toolResult`, `messageContent`, `errorMessage`). Applies failure policies: `abort` → return false (caller aborts workflow), `skip` → log and continue, `continue` → silent continue. Enforces per-hook timeout via `Promise.race`. Emits `hook.started`, `hook.completed`, `hook.failed`, `hook.skipped` events. | `packages/core/src/services/HookExecutor.ts`, `packages/core/src/services/IHttpClient.ts` (minimal HTTP port) | P3-T01, P1-T06, P1-T13, P2-T11 | 6 | • `executePhase('pre_run', hooks, ctx)` runs enabled hooks sorted by priority. • Script hook delegates to `IScriptRunner` with correct cwd and env. • HTTP hook interpolates `{{variable}}` placeholders. • `abort` failure policy returns `false`; `skip` continues to next hook. • Timeout fires `HookTimeoutError` if hook exceeds `timeoutMs`. • SDK lifecycle hooks receive `SDKHookContext` with event data. • `hook.skipped` emitted when no hooks match a phase. |
| P3-T07B | HookInterceptor | Implement `HookInterceptor` per §5.5. Sits between `CopilotAdapter` and `EventBus` in the event pipeline. Constructor accepts `HookExecutor`, `EventBus`, and `ILogger`. `createInterceptedEventHandler(sessionId, hooks)` returns a handler function that: (1) maps incoming `AgentEvent` to the appropriate `HookPhase` (e.g., `copilot.tool_start` → `pre_tool_use`, `copilot.tool_complete` → `post_tool_use`, `copilot.message_complete` → `on_message`, `copilot.reasoning_complete` → `on_reasoning`, `copilot.session_start` → `on_session_start`), (2) builds `SDKHookContext` with event-specific data (`toolName`, `toolArgs`, `toolResult`, `messageContent`, `errorMessage`), (3) executes matching hooks via `HookExecutor.executePhase()`, (4) if hooks return `false` (abort) for `pre_tool_use`, emits `hook.skipped` event and suppresses the original event, (5) otherwise forwards the event to `EventBus.emit()`. `registerGlobalHooks(hooks)` registers client lifecycle hooks that subscribe to `EventBus.subscribeGlobal()` and execute `on_client_start/stop/error/restart` hooks. | `packages/core/src/services/HookInterceptor.ts` | P3-T07, P3-T01, P1-T06 | 4 | • `createInterceptedEventHandler` returns a function that intercepts events. • `pre_tool_use` abort prevents event from reaching EventBus. • `SDKHookContext` populated with correct fields per event type. • `registerGlobalHooks` subscribes to global EventBus channel. • `hook.skipped` emitted when pre_tool_use hooks abort. |
| P3-T08 | WebhookService | Implement `WebhookService` per §14.2. `handleGitHub(headers, payload)` — verifies HMAC-SHA256 signature against configured secret, deduplicates via `deliveryId`, logs delivery to DB, matches active registrations by `source='github'` + `eventType`, evaluates optional condition filters (simple JSONPath-like: `==`, `!=`, `contains`), creates a session per matched registration using `SessionService.createSession`, auto-starts if `autoStart` is true, updates delivery status. `handleCustom(trigger, payload)` — matches registrations for `source='custom'`, creates and optionally starts sessions. `extractVariables(payload)` — extracts contextual GitHub fields (`repoUrl`, `branch`, `sender`, `action`, `prNumber`, `prTitle`, `commitSha`) for template interpolation. | `packages/core/src/services/WebhookService.ts` | P3-T03, P3-T09, P1-T12 (IWebhookRepository), P2-T09 | 4 | • GitHub webhook with valid signature processes successfully. • Invalid signature throws `ValidationError`. • Duplicate `deliveryId` short-circuits with `duplicate` status. • Matching registration triggers session creation. • `autoStart: true` calls `startSession` after creation. |

### 3D — Configuration

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P3-T09 | TemplateRegistry | Implement `TemplateRegistry` per §10.5. `loadBuiltins()` registers the predefined templates (code-generation, code-review, test-generation, refactoring, documentation). `loadFromDirectory(dir)` reads `.json` and `.ts` files, validates each against `WorkflowTemplateSchema`, and registers valid templates (logs warnings for invalid ones). `register(template)`, `get(id)`, `getAll()`, `getByCategory(category)`. Templates stored in an internal `Map<id, WorkflowTemplate>`. | `packages/core/src/config/TemplateRegistry.ts`, `packages/core/src/config/templates/code-generation.ts`, `packages/core/src/config/templates/code-review.ts`, `packages/core/src/config/templates/test-generation.ts`, `packages/core/src/config/templates/refactoring.ts`, `packages/core/src/config/templates/documentation.ts` | P1-T21 | 3 | • `loadBuiltins()` registers ≥5 templates. • `get('code-generation-v1')` returns the full template. • `loadFromDirectory` ignores invalid files and logs a warning. • `getByCategory('code-generation')` filters correctly. |
| P3-T10 | ConfigResolver | Implement `ConfigResolver` per §10.7. `resolve(templateId, sessionOverrides)` merges: (1) template defaults from `TemplateRegistry`, (2) session-level variable overrides, (3) copilot config overrides, (4) hook overrides (by hook ID). Validates required variables — throws `ValidationError` if missing. Interpolates `{{variable}}` placeholders in prompt texts. Returns a `ResolvedWorkflowConfig` containing the merged `template`, `prompts`, `copilotConfig`, `hooks`, and `variables`. Define the `ResolvedWorkflowConfig` type. | `packages/core/src/services/ConfigResolver.ts`, `packages/core/src/services/types/ResolvedWorkflowConfig.ts` | P3-T09, P1-T20, P1-T21, P1-T22 | 3 | • `resolve('code-generation-v1', { variables: { userPrompt: 'Build X' } })` returns config with interpolated prompts. • Missing required variable throws `ValidationError`. • Hook overrides merge correctly (e.g., disabling a hook by setting `enabled: false`). |

### 3E — Recovery & Composition

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P3-T11 | StartupRecoveryService | Implement `StartupRecoveryService` per §21.1. `recover()` — called once at app initialization: (1) calls `eventBus.restoreCounters()`, (2) queries sessions with status `running`, `starting`, or `cancelling`, (3) marks each as `paused`, (4) marks their `running`/`queued` workflows as `paused`, (5) attempts `copilot.resumeConversation` for each workflow with a `conversationId` (best-effort, logs warning on failure), (6) emits `session.paused` event for each recovered session. Uses `ILogger` for structured logging throughout. | `packages/core/src/services/StartupRecoveryService.ts` | P3-T01, P3-T03, P1-T11, P1-T13, P2-T04, P2-T05 | 3 | • With 2 sessions in `running` state, `recover()` marks both as `paused`. • Running/queued workflows under those sessions are also paused. • `eventBus.restoreCounters()` is called before any event emission. • Failed Copilot resume logs a warning but does not throw. |
| P3-T12 | Composition root | Implement `apps/server/src/composition-root.ts` that wires all services together using constructor injection (no DI container). Instantiation order: (1) load and validate `AppConfig`, (2) `createDB(config.dbPath)` + `runMigrations`, (3) instantiate all 6 repositories, (4) `PinoLogger`, (5) `EventBus(eventRepo)`, (6) `TemplateRegistry` + `loadBuiltins()`, (7) `ConfigResolver`, (8) `CopilotAdapter`, (9) `SandboxedScriptRunner(config.security.allowedCommands)`, (10) `GitManager`, (11) `HookExecutor`, (12) **`HookInterceptor(hookExecutor, eventBus, logger)`**, (13) `ArtifactService`, (14) `ChatService`, (15) `SessionService`, (16) `WorkflowService(hookInterceptor, ...)` (+ `setSessionService` for circular dep), (17) `WebhookService`, (18) `SSETransport`, (19) `StartupRecoveryService` + call `recover()`, (20) **register global client lifecycle hooks**: `hookInterceptor.registerGlobalHooks(globalHooks)` to subscribe to `on_client_start/stop/error/restart` events. Returns a `Container` object exposing all services for route handlers. | `apps/server/src/composition-root.ts` | All P3 tasks, all P2 tasks | 5 | • `createContainer(config)` returns an object with all services instantiated. • `HookInterceptor` is wired with `HookExecutor` and `EventBus`. • `WorkflowService` receives `HookInterceptor` in constructor. • Global client lifecycle hooks registered during composition. • Circular dependency between `SessionService` ↔ `WorkflowService` is resolved via setter injection. • `StartupRecoveryService.recover()` is invoked during composition. • DB migrations run before any repository is used. |

### 3F — Service Tests

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P3-T13 | MockCopilotPort | Implement `MockCopilotPort` per §18.3 for use in all service tests. Implements all **15+ `ICopilotPort` methods**: **Client Lifecycle**: `initialize` (sets state to `running`), `stop`/`forceStop` (sets state to `stopped`), `getClientState` (returns current mock state), `onClientEvent` (registers handlers). **Model Discovery**: `getModels` (returns configurable model list), `ping` (returns true). **Conversation Lifecycle**: `createConversation` (tracks in Map), `resumeConversation`, `listConversations`, `getLastConversationId`, `destroyConversation`, `deleteConversation`. **Messaging**: `sendPrompt` (emits `copilot.message_complete` + `copilot.idle` after 10 ms delay), `sendPromptAndWait` (returns mock response message), `abortConversation`, `getMessages` (returns tracked messages). **Event Subscription**: `onConversationEvent` (registers handlers, returns unsubscribe). Exposes test helpers: `emitEvent(conversationId, event)` for manually injecting events, `emitClientEvent(event)` for global lifecycle events, `setModels(models)` for configuring available models, `simulateError(conversationId)` for triggering error scenarios. | `packages/core/src/__tests__/mocks/MockCopilotPort.ts` | P1-T11 | 3 | • Implements all 15+ `ICopilotPort` methods. • `sendPrompt` triggers `message_complete` + `idle` events on registered handlers. • `sendPromptAndWait` returns a mock response directly. • `emitEvent` test helper fires handlers for a specific conversation. • `emitClientEvent` fires global lifecycle event handlers. |
| P3-T14 | Unit tests — EventBus | Test `emit` sequence numbering (monotonically increasing per session, independent across sessions), `subscribe` channel isolation, `subscribeAll` receives all events, unsubscribe stops delivery, `restoreCounters` sets correct starting values. Use `:memory:` EventRepository for persistence verification. | `packages/core/src/__tests__/events/EventBus.test.ts` | P3-T01, P2-T06, P2-T14 | 2.5 | • ≥10 test cases pass. • Sequence IDs are correct after `restoreCounters`. |
| P3-T15 | Unit tests — SessionService | Test `createSession` (persists session + workflows), `startSession` (full flow with `MockCopilotPort` — transitions `created → starting → running`, invokes clone if `requiresCodebase`, starts first workflow), `pauseSession` / `resumeSession` round-trip, `cancelSession` (aborts conversation, runs `on_cancel` hooks), `deleteSession` (calls cleanup), `onWorkflowCompleted` (advances to next workflow or completes session), `onWorkflowFailed` (marks session appropriately). Verify `MAX_CONCURRENT_SESSIONS` limit throws `ResourceLimitError` when exceeded. All tests use `MockCopilotPort`, in-memory repos, and a real `EventBus`. | `packages/core/src/__tests__/services/SessionService.test.ts` | P3-T03, P3-T13, P2-T14 | 5 | • ≥15 test cases pass. • Full session lifecycle test (create → start → complete) passes end-to-end. • Concurrent session limit enforced. |
| P3-T16 | Unit tests — WorkflowService | Test `startWorkflow` full pipeline with `MockCopilotPort` and `HookInterceptor`: config resolution, `pre_run` hook execution, Copilot conversation creation (verify all new params: systemMessage, customAgents, BYOK, etc. are passed), prompt loop (multiple prompts sent sequentially), `post_run` hooks, completion. Verify events pass through `HookInterceptor.createInterceptedEventHandler` — test that SDK lifecycle hooks can intercept `pre_tool_use` and block tool execution. Test error path: failed Copilot response triggers `on_error` hooks and `workflow.failed` event. Test `pauseWorkflow` / `resumeWorkflow`. Verify that `waitForIdle` resolves on `copilot.idle` and rejects on `copilot.error`. | `packages/core/src/__tests__/services/WorkflowService.test.ts` | P3-T04A, P3-T13, P3-T07, P3-T07B, P3-T10, P2-T14 | 6 | • ≥14 test cases pass. • Multi-prompt workflow completes with all step events emitted. • Events routed through HookInterceptor. • CreateConversationParams tested with new fields. • Error path marks workflow as `failed` and notifies session. |
| P3-T17 | Unit tests — HookExecutor | Test all 3 hook types: script (mock `IScriptRunner`), http (mock `IHttpClient`), function (mock dynamic import). Test priority ordering (lower runs first). Test failure policies: `abort` stops execution and returns false, `skip` continues to next hook, `continue` ignores. Test retry logic with exponential backoff (use fast timers). Test timeout enforcement. Test that `hook.started`, `hook.completed`, `hook.failed`, `hook.skipped` events are emitted correctly. Test SDK lifecycle hooks receive `SDKHookContext` with event-specific data. | `packages/core/src/__tests__/services/HookExecutor.test.ts` | P3-T07, P3-T01 | 3.5 | • ≥14 test cases pass. • Priority ordering verified (hook with priority 50 runs before 100). • `abort` policy returns false from `executePhase`. • Retry count respected with backoff delays. • SDK hooks receive `SDKHookContext` with toolName, messageContent, etc. |
| P3-T17B | Unit tests — HookInterceptor | Test `createInterceptedEventHandler`: verify that `copilot.tool_start` triggers `pre_tool_use` hooks with correct `SDKHookContext` (toolName, toolArgs), `copilot.tool_complete` triggers `post_tool_use`, `copilot.message_complete` triggers `on_message`, `copilot.reasoning_complete` triggers `on_reasoning`, `copilot.session_start` triggers `on_session_start`. Test **event suppression**: `pre_tool_use` hook returning `false` prevents event from reaching EventBus and emits `hook.skipped`. Test **passthrough**: events without matching hooks pass through to EventBus unchanged. Test `registerGlobalHooks`: verify global client lifecycle hooks execute on `emitGlobal` events. Test edge cases: empty hooks array, hooks with `enabled: false` are skipped. | `packages/core/src/__tests__/services/HookInterceptor.test.ts` | P3-T07B, P3-T01, P3-T13 | 3 | • ≥12 test cases pass. • Event-to-phase mapping verified for all SDK event types. • `pre_tool_use` abort suppresses event correctly. • Global hooks registered and triggered. |
| P3-T18 | Unit tests — ConfigResolver + TemplateRegistry | Test `TemplateRegistry`: `loadBuiltins` populates ≥5 templates, `get` returns correct template, `getByCategory` filters, `register` adds custom template. Test `ConfigResolver`: `resolve` with default variables, with overrides, with missing required variable (throws `ValidationError`), prompt interpolation (`{{userPrompt}}` replaced), hook override merging (disable hook by `enabled: false`), copilot config deep merge. | `packages/core/src/__tests__/services/ConfigResolver.test.ts`, `packages/core/src/__tests__/config/TemplateRegistry.test.ts` | P3-T09, P3-T10 | 3 | • ≥14 test cases pass across both test files. • Variable interpolation verified in prompt text. • Missing required variable throws with field name. |
| P3-T19 | Unit tests — WebhookService | Test `handleGitHub`: valid signature passes, invalid signature throws, duplicate `deliveryId` short-circuits, matching registration creates session, `autoStart` triggers `startSession`, condition filter gates matching, `extractVariables` returns correct GitHub fields. Test `handleCustom`: matching registration creates session. Use mock repos and mock `SessionService`. | `packages/core/src/__tests__/services/WebhookService.test.ts` | P3-T08, P3-T13 | 3 | • ≥10 test cases pass. • Signature verification tested with known HMAC-SHA256 digest. • Deduplication prevents double-processing. |
| P3-T20 | Unit tests — StartupRecoveryService | Test with 2 sessions in `running` state and 1 in `starting`: all 3 marked `paused`, their running/queued workflows marked `paused`, Copilot resume attempted for conversations with IDs, failed resume logged as warning, `session.paused` events emitted. Test with 0 active sessions: no-op. | `packages/core/src/__tests__/services/StartupRecoveryService.test.ts` | P3-T11, P3-T13, P2-T14 | 2 | • ≥6 test cases pass. • Recovery is idempotent (running twice doesn't error). |

### Phase 3 — Hour Total: **97.5 hours**

---

## Combined Summary

| Phase | Tasks | Hours |
|-------|-------|-------|
| **Phase 0 — Project Scaffolding** (P0-T01 → P0-T19) | 19 | **20 h** |
| **Phase 1 — Domain Layer** (P1-T01 → P1-T26) | 26 | **48.5 h** |
| **Phase 2 — Infrastructure Layer** (P2-T01 → P2-T21) | 21 | **58 h** |
| **Phase 3 — Application Services** (P3-T01 → P3-T20) | 25 | **97.5 h** |
| **Grand Total** | 91 | **224 h** |

---

## Dependency Graph (Phase 2 & 3 Critical Path)

```
P1-T24/T25 (Phase 1 complete — domain layer, ports, types)
    │
    ├── P2-T01 (SQLite + Drizzle wiring)
    │     └── P2-T02 (7-table schema)
    │           └── P2-T03 (migration runner)
    │                 └── P2-T04…T09 (6 repositories) ────────────────────┐
    │                       └── P2-T14 (test DB factory)                  │
    │                             └── P2-T15…T20 (repo integration tests) │
    │                                                                     │
    ├── P2-T10 (CopilotAdapter) ──────────────────────────────────────────┤
    ├── P2-T11 (SandboxedScriptRunner) ── P2-T21 (runner tests)          │
    ├── P2-T12 (GitManager)                                               │
    ├── P2-T13 (PinoLogger)                                               │
    │                                                                     │
    │  ┌──────────────────────────────────────────────────────────────────┘
    │  │
    │  ▼
    │  P3-T01 (EventBus + global channel) ─── P3-T02 (SSETransport)
    │  │
    │  ├── P3-T09 (TemplateRegistry) ── P3-T10 (ConfigResolver) ──┐
    │  │                                                            │
    │  ├── P3-T07 (HookExecutor) ── P3-T07B (HookInterceptor) ────┤
    │  │                                                            │
    │  └──► P3-T03 (SessionService) ◄──────────────────────────────┤
    │         │                                                     │
    │         ├── P3-T04 (WorkflowService + HookInterceptor) ◄─────┘
    │         │     (circular dep resolved via setter injection)
    │         │
    │         ├── P3-T05 (ChatService)
    │         ├── P3-T06 (ArtifactService)
    │         ├── P3-T08 (WebhookService)
    │         └── P3-T11 (StartupRecoveryService)
    │
    └───► P3-T12 (Composition root + HookInterceptor + global hooks) ◄─── ALL P3 services
              │
              └── P3-T13 (MockCopilotPort — 15+ methods)
                    └── P3-T14…T20, P3-T17B (service + HookInterceptor tests)
```

**Critical path**: P2-T01 → P2-T02 → P2-T03 → P2-T04 → P2-T14 → P3-T01 → P3-T07 → P3-T07B → P3-T03 → P3-T04A → P3-T12 → P3-T15

---

## Notes

1. **Infrastructure purity**: Phase 2 code in `packages/db/` and `packages/copilot-bridge/` depends only downward to `packages/core/src/domain/` (port interfaces) and `packages/shared/` (types). No service-layer imports are allowed in infrastructure code — enforced by `eslint-plugin-boundaries` rules from P0-T04.

2. **Test database strategy**: All repository integration tests (P2-T15 → P2-T20) use `:memory:` SQLite via `createTestDB()`. This ensures tests are fast (~ms per test), isolated (fresh DB each test), and require zero filesystem setup. The `P2-T14` test helper standardizes this pattern.

3. **MockCopilotPort is the test seam**: All service tests in Phase 3 use `MockCopilotPort` (P3-T13) instead of the real Copilot SDK. This eliminates external dependencies in tests and allows deterministic behavior (simulated `idle` events after 10 ms). The mock faithfully implements all 15+ `ICopilotPort` methods including client lifecycle, model discovery, and messaging.

4. **Circular dependency resolution**: `WorkflowService` needs `SessionService` (to call `onWorkflowCompleted`/`onWorkflowFailed`) and `SessionService` needs `WorkflowService` (to call `startWorkflow`). This is resolved via setter injection: `WorkflowService.setSessionService(svc)` is called in the composition root (P3-T12) after both are instantiated.

5. **Parallel execution opportunities**:
   - Phase 2: P2-T04 → P2-T09 (6 repos) can be parallelized after P2-T03. P2-T10, P2-T11, P2-T12, P2-T13 are all independent of each other.
   - Phase 3: P3-T05, P3-T06, P3-T08, P3-T09 can proceed in parallel once P3-T01 and P3-T03 are complete. P3-T07 (HookExecutor) and P3-T07B (HookInterceptor) are sequential since the interceptor depends on the executor. Tests (P3-T14 → P3-T20, P3-T17B) can be parallelized once their subject services are implemented.

6. **Hook HTTP client**: P3-T07 introduces a minimal `IHttpClient` port interface for HTTP hooks. The concrete implementation (using `fetch` or `undici`) is a thin adapter instantiated in the composition root — not a separate task since it's ~20 lines of code.


---

## Phase 4 — Server (Express HTTP Layer)

**Goal**: Implement the Express HTTP server that exposes all REST API endpoints from §13, wires middleware (validation, error handling, request ID, CORS), serves the SSE streaming endpoint, handles webhook ingress with signature verification, and provides health/config routes. After this phase the full backend is accessible over HTTP and proven via supertest integration tests.

### 4A — Express App & Middleware

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P4-T01 | Express app factory | Create `createApp(container)` that instantiates an Express application, applies global middleware in order (requestId → CORS → JSON body parser → URL-encoded parser), mounts the API router from `createApiRouter(container)` at `/api`, mounts the error-handling middleware last, and returns the app instance. | `apps/server/src/app.ts` | P3-T12 (composition root) | 2 | • `createApp(container)` returns an Express app with all middleware registered. • Middleware order is: requestId, CORS, body parsers, routes, error handler. |
| P4-T02 | Request ID middleware | Implement `requestIdMiddleware` per §19.2. Reads `x-request-id` from incoming headers or generates a `randomUUID`. Attaches it to `req.requestId` and sets `x-request-id` response header. Extends the Express `Request` type declaration. | `apps/server/src/middleware/requestId.ts`, `apps/server/src/types/express.d.ts` | P4-T01 | 1 | • Requests without `x-request-id` get a UUID assigned. • Requests with `x-request-id` preserve the incoming value. |
| P4-T03 | CORS middleware | Configure `cors()` with allowed origins from `AppConfig.security.corsOrigins` (defaults to `['http://localhost:5173']` for Vite dev). Allows `Content-Type`, `Authorization`, `x-request-id`, and `Last-Event-ID` headers. Supports preflight. | `apps/server/src/middleware/cors.ts` | P4-T01, P1-T20 (AppConfig) | 1 | • `OPTIONS` preflight returns 204 with correct `Access-Control-Allow-*` headers. • Non-allowed origins are rejected. |
| P4-T04 | Zod validation middleware | Implement the generic `validate(schema)` middleware factory from §13.3. Wraps `schema.safeParse(req.body)` — on success assigns parsed data to `req.body` and calls `next()`; on failure returns 400 with `{ error: { code: 'VALIDATION_ERROR', message, fields } }`. Also implement `validateQuery(schema)` and `validateParams(schema)` variants for query strings and route params. | `apps/server/src/middleware/validate.ts` | P4-T01 | 1.5 | • Invalid body returns 400 with Zod-formatted field errors. • Valid body is replaced with the parsed (stripped) output. • `validateQuery` parses `req.query`; `validateParams` parses `req.params`. |
| P4-T05 | Error handling middleware | Implement `errorMiddleware` per §9.5. Normalizes all thrown errors to `GeneratorAIError` using the `normalize()` logic, maps `category` to HTTP status via `ERROR_STATUS_MAP`, returns JSON `{ error: { code, category, message, recoverable } }`. Includes stack trace only when `NODE_ENV === 'development'`. Logs the error via `ILogger`. | `apps/server/src/middleware/errorHandler.ts` | P4-T01, P1-T16, P1-T17, P1-T18 | 2 | • `ValidationError` maps to 400. • `InvalidTransitionError` maps to 409. • `CopilotConnectionError` maps to 502. • Unknown errors map to 500 with `UNKNOWN_ERROR` code. |

### 4B — Route Modules

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P4-T06 | API router index | Implement `createApiRouter(container)` per §13.2 that creates an Express `Router` and mounts all sub-routers: `/sessions`, `/workflows`, `/sessions` (chat, nested), `/sessions` (stream, nested), `/artifacts`, `/templates`, `/webhooks`, `/health`, **`/copilot`** (new: models, state, conversations, ping), **`/hooks`** (new: phases, session hooks, test), **`/events`** (new: global SSE stream). | `apps/server/src/routes/index.ts` | P4-T01 | 1.5 | • All 11 sub-router mount points are registered. • Router exports a single `createApiRouter` function. |
| P4-T07 | Session routes (7 endpoints) | Implement `createSessionRoutes(container)` with all 7 session endpoints from §13.1: `POST /` (create, 201), `GET /` (list with `?status` filter), `GET /:id` (detail with workflows), `POST /:id/start` (202), `POST /:id/pause`, `POST /:id/resume`, `POST /:id/cancel`, `DELETE /:id` (204). Apply `validate(CreateSessionParamsSchema)` on POST create. Each handler delegates to `container.sessionService` and wraps in try/catch flowing to `next(err)`. | `apps/server/src/routes/sessions.ts` | P4-T04, P4-T06, P3-T03 (SessionService) | 3 | • `POST /api/sessions` with valid body returns 201 + Session JSON. • `GET /api/sessions?status=running,paused` returns filtered list. • `DELETE /api/sessions/:id` returns 204 with empty body. |
| P4-T08 | Workflow routes (3 endpoints) | Implement `createWorkflowRoutes(container)` with: `GET /sessions/:id/workflows` (list by session), `POST /workflows/:id/pause`, `POST /workflows/:id/resume`. Each delegates to `container.workflowService`. Note: the workflow list endpoint is mounted under `/sessions` in the router index due to the nested path. | `apps/server/src/routes/workflows.ts` | P4-T06, P3-T04 (WorkflowService) | 1.5 | • `GET /api/sessions/:id/workflows` returns an array sorted by `order`. • `POST /api/workflows/:id/pause` returns 200. |
| P4-T09 | Chat routes (2 endpoints) | Implement `createChatRoutes(container)` with: `POST /sessions/:id/prompt` (accepts `multipart/form-data` via `multer` — fields: `prompt` text, `attachments[]` files; returns 202) and `GET /sessions/:id/chat` (paginated history with `?limit=50&offset=0`). The prompt handler passes files through `AttachmentService.storeUpload` before forwarding to `ChatService.sendMessage`. | `apps/server/src/routes/chat.ts` | P4-T06, P3-T05 (ChatService), P3-T06 (ArtifactService) | 2.5 | • `POST /api/sessions/:id/prompt` with FormData returns 202. • `GET /api/sessions/:id/chat?limit=10&offset=0` returns paginated messages array. |
| P4-T10 | Streaming SSE route (1 endpoint) | Implement `createStreamRoutes(container)` with: `GET /sessions/:id/stream`. Delegates to `container.sseTransport.createHandler()`. Adds CORS headers for SSE (`Cache-Control: no-cache`, `Connection: keep-alive`). Supports `Last-Event-ID` header for replay and `?filter=` query parameter for event type filtering per §3.6. | `apps/server/src/routes/stream.ts` | P4-T06, P3-T02 (SSETransport) | 1.5 | • `GET /api/sessions/:id/stream` returns `Content-Type: text/event-stream`. • `Last-Event-ID` replays missed events before switching to live. • `?filter=workflow,session` delivers only matching event prefixes. |
| P4-T11 | Artifact routes (2 endpoints) | Implement `createArtifactRoutes(container)` with: `GET /sessions/:sessionId/artifacts` (list with metadata + `downloadUrl`) and `GET /artifacts/:id/download` (binary stream with `Content-Type`, `Content-Disposition`, `Content-Length` headers). Uses `createReadStream` for efficient large-file delivery. Note: the session artifacts route is mounted under `/sessions` while the download route is under `/artifacts`. | `apps/server/src/routes/artifacts.ts` | P4-T06, P3-T06 (ArtifactService) | 1.5 | • `GET /api/sessions/:id/artifacts` returns array with `downloadUrl` per artifact. • `GET /api/artifacts/:id/download` streams the file binary with correct headers. |
| P4-T12 | Template routes (2 endpoints) | Implement `createTemplateRoutes(container)` with: `GET /templates` (list all, supports `?category=` filter) and `GET /templates/:id` (single template detail). Delegates to `container.templateRegistry`. | `apps/server/src/routes/templates.ts` | P4-T06, P3-T09 (TemplateRegistry) | 1 | • `GET /api/templates` returns all registered templates. • `GET /api/templates?category=code-generation` returns filtered subset. • `GET /api/templates/:id` returns 404 for unknown ID. |
| P4-T13 | Webhook routes (5 endpoints) | Implement `createWebhookRoutes(container)` with: `POST /webhooks/github` (GitHub payload, HMAC verification before handler), `POST /webhooks/custom/:trigger` (custom payload, token-based auth via `Authorization` header), `GET /webhooks/registrations` (list), `POST /webhooks/registrations` (create, 201), `DELETE /webhooks/registrations/:id` (204). GitHub route reads `x-hub-signature-256`, `x-github-event`, `x-github-delivery` headers and passes them to `WebhookService.handleGitHub`. | `apps/server/src/routes/webhooks.ts` | P4-T06, P4-T14, P3-T08 (WebhookService) | 2.5 | • `POST /api/webhooks/github` with valid HMAC signature returns 200. • Invalid signature returns 401. • `POST /api/webhooks/registrations` returns 201 with the created registration. |
| P4-T14 | Webhook signature verification middleware | Implement `verifyGitHubSignature` middleware that reads the raw request body (via `express.raw()` or a `rawBody` capture), computes HMAC-SHA256 against the configured `webhooks.githubSecret`, and uses `crypto.timingSafeEqual` to compare with the `x-hub-signature-256` header. Returns 401 on mismatch. Also implement `verifyWebhookToken` middleware for custom webhooks (compares `Authorization: Bearer <token>`). | `apps/server/src/middleware/webhookAuth.ts` | P4-T01, P1-T20 (AppConfig webhooks section) | 2 | • Correct HMAC signature passes through. • Incorrect signature returns 401. • `timingSafeEqual` used to prevent timing attacks. • Missing signature header returns 401. |
| P4-T15 | Health routes (2 endpoints) | Implement `createHealthRoutes(container)` with: `GET /health` (returns `{ status: 'ok' | 'degraded', copilot: boolean, db: boolean, uptime: number }` — pings Copilot via `ICopilotPort.ping()`, verifies DB with a test query) and `GET /config` (returns non-sensitive `PublicAppConfig` subset: `port`, `maxConcurrentSessions`, `logLevel`, `templates` count). | `apps/server/src/routes/health.ts` | P4-T06, P1-T11 (ICopilotPort), P1-T20 (AppConfig) | 1.5 | • `GET /api/health` returns 200 with all status fields. • `GET /api/config` returns only non-sensitive configuration. • When Copilot is unreachable, `copilot: false` and status is `degraded`. |
| P4-T15B | Copilot routes (5 endpoints) | Implement `createCopilotRoutes(container)` with new endpoints per §13.1: `GET /copilot/models` (list available Copilot models via `ICopilotPort.getModels()`), `GET /copilot/state` (get Copilot client state via `ICopilotPort.getClientState()`), `GET /copilot/conversations` (list active conversations via `ICopilotPort.listConversations()`), `GET /copilot/conversations/:id/messages` (get conversation messages via `ICopilotPort.getMessages(id)`), `POST /copilot/ping` (health ping returning `{ alive: boolean }`). All routes delegate to the `CopilotAdapter` through the port interface. | `apps/server/src/routes/copilot.ts` | P4-T06, P1-T11 (ICopilotPort) | 2 | • `GET /api/copilot/models` returns array of model objects. • `GET /api/copilot/state` returns current client state string. • `GET /api/copilot/conversations` returns active conversation list. • `POST /api/copilot/ping` returns `{ alive: true/false }`. |
| P4-T15C | Hooks routes (3 endpoints) | Implement `createHooksRoutes(container)` with: `GET /hooks/phases` (returns all 22 available hook phases with descriptions organized by category), `GET /sessions/:id/hooks` (returns hooks configured for a session, including workflow and SDK lifecycle hooks), `POST /sessions/:id/hooks/test` (tests a hook configuration by executing it in dry-run mode with a synthetic `SDKHookContext` — validates the hook config without side effects). | `apps/server/src/routes/hooks.ts` | P4-T06, P3-T07, P3-T07B | 2 | • `GET /api/hooks/phases` returns 22 phases organized by category. • `GET /api/sessions/:id/hooks` returns session hook configuration. • `POST /api/sessions/:id/hooks/test` validates hook without side effects and returns success/failure. |
| P4-T15D | Global events SSE route (1 endpoint) | Implement `createGlobalEventRoutes(container)` with: `GET /events/global` — SSE endpoint for session-agnostic events (client lifecycle: `copilot.client_started/stopped/error/restarting`). Subscribes to `EventBus.subscribeGlobal()`. Sets correct SSE headers. Supports `Last-Event-ID` for replay. Sends 15 s heartbeat. Used by web UI to display Copilot client connection status. | `apps/server/src/routes/globalEvents.ts` | P4-T06, P3-T01 (EventBus with global channel) | 1.5 | • `GET /api/events/global` returns `Content-Type: text/event-stream`. • Client lifecycle events are received. • Heartbeat sent every 15 s. • Disconnect cleans up subscription. |

### 4C — Server Lifecycle

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P4-T16 | Server startup & graceful shutdown | Implement the `startServer(config)` entry point that: (1) loads and validates `AppConfig`, (2) calls `createContainer(config)` from the composition root, (3) calls `createApp(container)`, (4) starts `app.listen(config.port)`, (5) logs startup info (port, environment, DB path). Implement graceful shutdown on `SIGTERM`/`SIGINT`: drains active SSE connections, closes the DB, calls `copilotAdapter.shutdown()`, and exits. | `apps/server/src/index.ts` | P4-T01, P3-T12 (composition root) | 2 | • `node dist/index.mjs` starts the server and logs the listening port. • `SIGTERM` triggers graceful shutdown: DB closed, Copilot adapter shut down, process exits 0. |
| P4-T17 | Static file serving (web app) | When `NODE_ENV === 'production'`, serve the `apps/web/dist/` static files at the root path `/`. All non-API routes fall through to `index.html` for client-side routing. In development, this is skipped (Vite dev server handles it). | `apps/server/src/middleware/staticFiles.ts` | P4-T01 | 1 | • In production, `GET /` returns the web app's `index.html`. • `GET /api/*` routes are not affected by static file serving. |

### 4D — API Integration Tests

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P4-T18 | Test helper: supertest app factory | Create a test utility that instantiates the full app with an in-memory SQLite database, `MockCopilotPort`, and all real services. Returns the supertest agent and a cleanup function. Reusable across all route test files. | `apps/server/src/__tests__/helpers/testApp.ts` | P4-T01, P3-T13 (MockCopilotPort), P2-T14 (test DB factory) | 2 | • `createTestApp()` returns `{ agent, container, cleanup }`. • `agent.get('/api/health')` returns 200. |
| P4-T19 | Integration tests — Session routes | Test all 7 session endpoints via supertest: create session (201 + correct body), list sessions, list with status filter, get session by ID (200 + includes workflows), get non-existent session (404), start session (202), pause/resume round-trip, cancel session, delete session (204). Verify error responses for invalid transitions (409). | `apps/server/src/__tests__/routes/sessions.test.ts` | P4-T18, P4-T07 | 3 | • ≥12 test cases pass. • Full lifecycle tested: create → start → pause → resume → cancel. |
| P4-T20 | Integration tests — Chat & streaming | Test `POST /api/sessions/:id/prompt` with text-only and with file attachments (multipart). Test `GET /api/sessions/:id/chat` with pagination. Test SSE endpoint: connect, receive events (inject via `MockCopilotPort.emitEvent`), verify `Last-Event-ID` replay returns missed events, verify heartbeat. | `apps/server/src/__tests__/routes/chat.test.ts`, `apps/server/src/__tests__/routes/stream.test.ts` | P4-T18, P4-T09, P4-T10 | 3 | • Multipart prompt upload returns 202. • SSE stream receives events in order. • `Last-Event-ID` replay delivers missed events. |
| P4-T21 | Integration tests — Webhooks, templates, health, copilot, hooks | Test GitHub webhook with valid/invalid signature. Test custom webhook with valid/invalid token. Test template listing and filtering. Test health endpoint (degraded when Copilot mock returns `ping: false`). Test config endpoint excludes sensitive fields. **Test Copilot routes**: `GET /copilot/models` returns mock models, `GET /copilot/state` returns `running`, `GET /copilot/conversations` returns tracked conversations, `POST /copilot/ping` returns `{ alive: true }`. **Test Hooks routes**: `GET /hooks/phases` returns 22 phases, `GET /sessions/:id/hooks` returns configured hooks. **Test Global events**: `GET /events/global` connects and receives client lifecycle events injected via `MockCopilotPort.emitClientEvent()`. | `apps/server/src/__tests__/routes/webhooks.test.ts`, `apps/server/src/__tests__/routes/templates.test.ts`, `apps/server/src/__tests__/routes/health.test.ts`, `apps/server/src/__tests__/routes/copilot.test.ts`, `apps/server/src/__tests__/routes/hooks.test.ts`, `apps/server/src/__tests__/routes/globalEvents.test.ts` | P4-T18, P4-T13, P4-T12, P4-T15, P4-T15B, P4-T15C, P4-T15D | 5 | • ≥18 test cases across all test files. • Webhook signature verification tested with known HMAC digest. • Copilot model list returned. • Hook phases endpoint returns 22 phases. • Global SSE receives client lifecycle events. |

### Phase 4 — Hour Total: **48 hours**

---

## Phase 5 — CLI Application (Ink + Commander.js)

**Goal**: Implement a fully functional terminal UI application using Commander.js for command parsing and Ink for interactive rendering. The CLI uses `DirectPlatformClient` to call core services in-process (no server required). After this phase, users can manage sessions, run workflows, and chat via the terminal.

### 5A — CLI Foundation

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P5-T01 | CLI entry point & Commander.js setup | Implement the main CLI entry point with Commander.js. Register all top-level commands: `init`, `start`, `stop`, `list`, `status`, `chat`, `watch`, `template`. Configure global options: `--config <path>` (config file), `--verbose` / `-v` (debug logging), `--json` (JSON output mode for scripting). Set the CLI name to `generatorai`, version from `package.json`. Add a shebang line and configure `bin` in `package.json`. | `apps/cli/src/index.tsx`, `apps/cli/package.json` (bin field) | P0-T15 (CLI scaffold), P1-T20 (AppConfig) | 2 | • `generatorai --help` prints all commands. • `generatorai --version` prints the version. • Each command is registered and reachable (even if handler is a stub). |
| P5-T02 | DirectPlatformClient | Implement `DirectPlatformClient` per §6.5. Constructor accepts a config object (with `dbPath`, `workspacesDir`, etc.). `initialize()` calls `createContainer()` internally (same composition as the server but without Express). Implements all `IPlatformClient` methods by delegating directly to the in-process core services. `subscribeToEvents` uses `EventBus.subscribe` directly (no SSE overhead). `selectDirectory()` returns `process.cwd()`. Includes an `async shutdown()` for cleanup. | `apps/cli/src/platform/DirectPlatformClient.ts`, `apps/cli/src/platform/composition-root.ts` | P1-T26 (IPlatformClient), P3-T12 (composition root pattern) | 3 | • Implements all `IPlatformClient` methods. • `initialize()` sets up DB, migrations, and all services. • `subscribeToEvents` receives events directly from EventBus without HTTP. |
| P5-T03 | Config file loading | Implement config file resolution: reads `~/.generatorai/config.json` (or path from `--config`), merges with `AppConfig` defaults via `AppConfigSchema.parse()`, validates, and passes to `DirectPlatformClient`. Creates the `~/.generatorai/` directory on first run if missing. Supports environment variable overrides (`GENERATORAI_PORT`, `GENERATORAI_DB_PATH`, etc.) with precedence: CLI flags > env vars > config file > defaults. | `apps/cli/src/config/loadConfig.ts` | P5-T01, P1-T20 (AppConfig schema) | 2 | • Missing config file uses all defaults (no error). • Config file values override defaults. • Env vars override config file values. • Invalid config values produce a clear error message. |

### 5B — CLI Commands

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P5-T04 | `init` command | Implements `generatorai init [directory]`. Creates the `~/.generatorai/` directory structure (`config.json`, `data.db` placeholder). If a directory argument is provided, creates a `.generatorai.json` project config in that directory. Prompts interactively for base settings using Ink text input (or accepts `--defaults` flag for non-interactive mode). | `apps/cli/src/commands/init.tsx` | P5-T01, P5-T03 | 2 | • `generatorai init` creates `~/.generatorai/config.json`. • `generatorai init ./my-project` creates `.generatorai.json` in the target directory. |
| P5-T05 | `start` command | Implements `generatorai start <template> [--repo <url>] [--branch <branch>] [--name <name>] [--var key=value...]`. Creates a session from the specified template with optional variables, starts it, and renders the `WorkflowProgress` Ink component to stream live progress. Exits with code 0 on success, 1 on failure. Supports `--detach` flag to start and return immediately (print session ID only). | `apps/cli/src/commands/start.tsx` | P5-T02, P5-T08, P3-T03, P3-T09 | 3 | • `generatorai start code-generation --repo https://... --var userPrompt="Build X"` creates and starts a session. • Live progress renders workflow steps. • `--detach` prints session ID and exits. |
| P5-T06 | `stop` command | Implements `generatorai stop <sessionId> [--cancel | --pause]`. Pauses or cancels the specified session (defaults to `--pause`). Confirms the action unless `--force` is passed. Prints the new session status. | `apps/cli/src/commands/stop.tsx` | P5-T02 | 1 | • `generatorai stop abc123 --cancel` cancels the session. • Without `--force`, prompts for confirmation. |
| P5-T07 | `list` command | Implements `generatorai list [--status <filter>] [--json]`. Lists all sessions in a formatted table (ID, name, status, created date, workflow count). Supports `--status running,paused` filter. `--json` outputs raw JSON array for scripting. Uses Ink `<Box>` and `<Text>` for table rendering. | `apps/cli/src/commands/list.tsx`, `apps/cli/src/components/SessionList.tsx` | P5-T02, P5-T09 | 2 | • `generatorai list` prints a formatted table. • `--status running` filters correctly. • `--json` outputs parseable JSON array. |
| P5-T08 | `status` command | Implements `generatorai status <sessionId>`. Shows detailed session info: name, status, creation/start/completion times, repo URL, workflows (each with status, current step, duration). Uses the `SessionList` Ink component in single-session detail mode. | `apps/cli/src/commands/status.tsx` | P5-T02, P5-T09 | 1.5 | • `generatorai status abc123` prints session detail with workflow table. • Non-existent session returns clear error. |
| P5-T09 | `chat` command | Implements `generatorai chat <sessionId>`. Opens an interactive chat loop using Ink. Renders `ChatView` component with message history and a text input. User types messages, presses Enter to send, sees streaming responses with a spinner. Supports `Ctrl+C` to exit. Loads existing chat history on start. | `apps/cli/src/commands/chat.tsx`, `apps/cli/src/components/ChatView.tsx` | P5-T02, P5-T10, P5-T11 | 3 | • Interactive chat loop sends and receives messages. • Streaming tokens render progressively. • `Ctrl+C` exits cleanly. |
| P5-T10 | `watch` command | Implements `generatorai watch <sessionId>`. Subscribes to session events via `DirectPlatformClient.subscribeToEvents` and renders a live-updating `WorkflowProgress` Ink component. Shows real-time event stream (workflow steps, git events, chat messages). Exits when the session completes or is cancelled. | `apps/cli/src/commands/watch.tsx` | P5-T02, P5-T11 | 2 | • `generatorai watch abc123` renders live event stream. • Workflow progress updates in real-time. • Auto-exits on session completion. |
| P5-T11 | `template` command | Implements `generatorai template [list | show <id>]`. `list` shows available templates in a table (ID, name, category, description). `show <id>` prints the full template detail including prompts, variables (with types and defaults), and hooks. Supports `--json` output. | `apps/cli/src/commands/template.tsx` | P5-T02, P3-T09 | 1.5 | • `generatorai template list` prints template table. • `generatorai template show code-generation-v1` prints full template detail. |

### 5C — Ink Components

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P5-T12 | SessionList Ink component | Renders a table of sessions with columns: ID (truncated), Name, Status (color-coded: green=running, yellow=paused, red=cancelled, blue=completed, gray=created), Workflows (count), Created. Uses Ink `<Box>`, `<Text>` with color props. Supports single-session detail mode for the `status` command. | `apps/cli/src/components/SessionList.tsx` | P5-T01 | 2 | • Renders formatted table with color-coded status. • Single-detail mode shows expanded session info with workflow sub-table. |
| P5-T13 | WorkflowProgress Ink component | Renders a vertical timeline of workflow steps. Each step shows: status icon (spinner for running, ✓ for completed, ✗ for failed, ○ for pending), step name, and elapsed time. Uses `ink-spinner` for the active step. Subscribes to events and updates in real-time. Shows overall session progress percentage. | `apps/cli/src/components/WorkflowProgress.tsx` | P5-T01 | 2.5 | • Active step shows spinner. • Completed steps show checkmark with duration. • Overall progress updates as steps complete. |
| P5-T14 | ChatView Ink component | Renders chat messages in a scrollable list (last N messages). User messages right-aligned, assistant messages left-aligned. Markdown code blocks rendered with syntax highlighting (via `ink-syntax-highlight` or plain indentation). Streaming tokens append to the current assistant message with a blinking cursor indicator. Text input at the bottom for composing messages. | `apps/cli/src/components/ChatView.tsx` | P5-T01 | 3 | • User and assistant messages visually distinct. • Code blocks are indented/highlighted. • Streaming text appends progressively. |
| P5-T15 | Spinner & status indicators | Create reusable `<Spinner>` (wraps `ink-spinner` with label), `<StatusBadge>` (colored status text), and `<ErrorBox>` (red bordered error display) components shared across all commands. | `apps/cli/src/components/Spinner.tsx`, `apps/cli/src/components/StatusBadge.tsx`, `apps/cli/src/components/ErrorBox.tsx` | P5-T01 | 1 | • `<Spinner label="Cloning..." />` renders animated spinner with text. • `<StatusBadge status="running" />` renders green "running" text. |

### 5D — CLI Tests

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P5-T16 | CLI snapshot tests | Write Vitest snapshot tests for all Ink components using `ink-testing-library`. Render `SessionList` with mock session data, `WorkflowProgress` with mock step data, `ChatView` with mock messages. Verify output matches expected snapshots. Also test the `list` and `status` commands end-to-end by rendering them with mock `DirectPlatformClient`. | `apps/cli/src/__tests__/components/SessionList.test.tsx`, `apps/cli/src/__tests__/components/WorkflowProgress.test.tsx`, `apps/cli/src/__tests__/components/ChatView.test.tsx`, `apps/cli/src/__tests__/commands/list.test.tsx` | P5-T12, P5-T13, P5-T14, P5-T07 | 3 | • ≥8 snapshot tests pass. • Snapshots capture color codes and layout. • Updating mock data intentionally breaks snapshots (proving they detect regressions). |
| P5-T17 | Config loading tests | Test config file resolution: missing file uses defaults, partial config merges correctly, invalid config throws with clear message, env var override precedence, `--config` flag override. Mock filesystem for `~/.generatorai/config.json`. | `apps/cli/src/__tests__/config/loadConfig.test.ts` | P5-T03 | 1.5 | • ≥6 test cases pass. • Precedence order verified: CLI flags > env vars > file > defaults. |

### Phase 5 — Hour Total: **39.5 hours**

---

## Phase 6 — Web Application (React + Vite)

**Goal**: Implement the full web client using React, Vite, TanStack Query, Zustand, Tailwind CSS, and shadcn/ui. The web app communicates with the server via `HttpPlatformClient` over REST + SSE. After this phase the complete web UI is functional with live streaming, dark mode, and all views from §17.

> **STATUS: ✅ COMPLETE** — Phase 6 has been implemented and verified. All P6 tasks (P6-T01 through P6-T30) are done.
> The web UI builds cleanly (`pnpm --filter @generatorai/web build` — 0 errors).
>
> **Key deliverables:**
> - Full chat view with markdown rendering, syntax highlighting (highlight.js + rehype-highlight), and code block copy
> - Multi-session support with independent per-session stream state (Zustand)
> - SSE streaming via single multiplexed EventSource with durable stream pattern (REST replay, dedup, 100ms token buffering)
> - Session persistence on refresh via event replay
> - Real-time status indicators with spinners in chat panel and session list
> - Thinking, tool call, and text blocks rendered in temporal order
> - Dark/light theme with dynamic highlight.js theme switching
> - Settings page with General, Copilot, and Advanced tabs (health endpoint)
> - Workflow timeline with auto-expand, pause/resume, and isolated elapsed time display
> - Template explorer, artifact browser, connection status indicator
>
> **Bug fixes applied during implementation:**
> 1. Fixed streamStore `completeToolCall` no-op ternary
> 2. Fixed highlight.js dual-theme import (light mode was overridden by dark) — now uses dynamic `?url` imports
> 3. Optimized WorkflowTimeline performance (extracted ElapsedTimeDisplay component)
> 4. Fixed 30s idle timer race condition (timer can no longer clear a new turn's data)
> 5. Added ARIA attributes and Escape key to CreateSessionDialog
> 6. Added `error` status to session status colors/labels
> 7. Memoized SessionListItem with React.memo
> 8. Added double-submit guard to CreateSessionDialog
> 9. Added clipboard error handling in MarkdownRenderer
> 10. Added SSE event shape validation
> 11. Auto-expand workflow cards when status transitions to running
> 12. Reduced blob URL hold time from 60s to 5s
> 13. Removed unused `Navigate` import and `class-variance-authority` dependency
> 14. Fixed AdvancedSettings to use platform client's `baseUrl`

### 6A — Project Setup & Providers

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P6-T01 | React + Vite scaffold | Configure the Vite project with React plugin, TypeScript, path aliases (`@/` → `src/`), proxy config for `/api` to the dev server (`localhost:3100`), and build output. Install React 19, react-dom, and configure `index.html` with the root mount point. | `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/tsconfig.json` | P0-T13 (web scaffold) | 1.5 | • `pnpm --filter @generatorai/web dev` starts Vite dev server. • `/api` requests proxy to `localhost:3100`. • Hot module reload works. |
| P6-T02 | Tailwind CSS + shadcn/ui setup | Install and configure Tailwind CSS v4 with the project's design tokens (CSS variables for colors, spacing, typography). Initialize shadcn/ui with the `default` theme. Install base shadcn components: `Button`, `Card`, `Dialog`, `Input`, `Textarea`, `Tabs`, `Badge`, `ScrollArea`, `Tooltip`, `DropdownMenu`, `Sheet`. Configure Inter (sans) and JetBrains Mono (code) fonts via `@fontsource`. | `apps/web/tailwind.config.ts`, `apps/web/src/styles/globals.css`, `apps/web/src/lib/utils.ts`, `apps/web/components.json`, `apps/web/src/components/ui/*.tsx` (shadcn generated) | P6-T01 | 2 | • Tailwind classes render correctly. • shadcn/ui `Button` component renders with correct styling. • Inter and JetBrains Mono fonts load. |
| P6-T03 | TanStack Query provider setup | Install `@tanstack/react-query` and `@tanstack/react-query-devtools`. Create `QueryClientProvider` wrapper with configured defaults: `staleTime: 30_000`, `retry: 1`, `refetchOnWindowFocus: true`. Mount devtools in development mode. Wrap the app tree with the provider. | `apps/web/src/providers/QueryProvider.tsx`, `apps/web/src/App.tsx` (updated) | P6-T01 | 1 | • `QueryClientProvider` wraps the app. • React Query devtools panel visible in dev mode. • Default staleTime and retry configured. |
| P6-T04 | HttpPlatformClient | Implement `HttpPlatformClient` per §6.3. Sets `platform = 'web'`. Constructor accepts optional `baseUrl` (defaults to `''` for same-origin). Implements all `IPlatformClient` methods using `fetch`: `createSession` (POST JSON), `getSessions` (GET), `getSession` (GET), `startSession` (POST), `pauseSession` (POST), `resumeSession` (POST), `cancelSession` (POST), `deleteSession` (DELETE), `getWorkflows` (GET), `pauseWorkflow` (POST), `resumeWorkflow` (POST), `sendPrompt` (POST FormData), `getChatHistory` (GET with query params), `getWorkflowTemplates` (GET), `getArtifacts` (GET), `downloadArtifact` (GET as Blob). `subscribeToEvents` creates an `EventSource` and dispatches typed events. Includes a shared `apiFetch` helper with error handling (reads JSON error body, throws `GeneratorAIError`). | `apps/web/src/platform/HttpPlatformClient.ts`, `apps/web/src/platform/apiFetch.ts` | P6-T01, P1-T26 (IPlatformClient) | 3 | • All `IPlatformClient` methods implemented. • `apiFetch` throws typed errors on non-2xx responses. • `subscribeToEvents` returns an unsubscribe function that closes the EventSource. |
| P6-T05 | PlatformProvider & dark mode ThemeProvider | Create `PlatformProvider` (React context providing `HttpPlatformClient` instance). Create `ThemeProvider` that reads `prefers-color-scheme` media query, persists user preference to `localStorage`, and applies `dark` class to `<html>`. Mount both providers in the app tree. | `apps/web/src/providers/PlatformProvider.tsx`, `apps/web/src/providers/ThemeProvider.tsx`, `apps/web/src/App.tsx` (updated) | P6-T03, P6-T04 | 2 | • `usePlatform()` hook returns the `HttpPlatformClient` instance. • System dark mode preference is auto-detected. • User can toggle dark/light mode and preference persists. |

### 6B — TanStack Query Hooks & Zustand Store

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P6-T06 | Query hooks — sessions, workflows, chat, templates, artifacts | Implement all TanStack Query hooks per §16.2: `useSessions()`, `useSession(id)`, `useWorkflows(sessionId)`, `useChatHistory(sessionId)`, `useTemplates()`, `useArtifacts(sessionId)`. Each hook uses `usePlatform()` internally and returns a standard `UseQueryResult`. Configure `staleTime: Infinity` for templates, `refetchInterval: 30_000` for sessions list. | `packages/ui/src/queries/sessions.ts`, `packages/ui/src/queries/workflows.ts`, `packages/ui/src/queries/chat.ts`, `packages/ui/src/queries/templates.ts`, `packages/ui/src/queries/artifacts.ts`, `packages/ui/src/queries/index.ts` | P6-T05, P1-T26 (IPlatformClient) | 3 | • `useSessions()` returns `{ data: Session[], isLoading, error }`. • `useTemplates()` has `staleTime: Infinity`. • All hooks compile and use the platform context. |
| P6-T07 | Mutation hooks — create, start, pause, resume, cancel, delete, sendPrompt | Implement all TanStack Query mutation hooks per §16.2: `useCreateSession()`, `useStartSession()`, `usePauseSession()`, `useResumeSession()`, `useCancelSession()`, `useDeleteSession()`, `useSendPrompt(sessionId)`. Each mutation invalidates relevant query caches on success (e.g., `useCreateSession` invalidates `['sessions']`; `useStartSession` invalidates `['session', id]` and `['sessions']`). | `packages/ui/src/queries/mutations.ts`, `packages/ui/src/queries/index.ts` (updated) | P6-T06 | 2 | • `useCreateSession().mutate(params)` calls `platform.createSession` and invalidates session list cache. • `useSendPrompt(id).mutate({ prompt })` invalidates chat cache. |
| P6-T08 | Zustand stream store | Implement the `useStreamStore` Zustand store per §16.4. State: `streams: Record<sessionId, { text, status }>`. Actions: `appendToken(sessionId, token)` (appends to text, sets status to `streaming`), `completeStream(sessionId)` (sets status to `complete`), `clearStream(sessionId)` (resets to empty/idle). Designed for high-frequency updates outside React lifecycle. | `packages/ui/src/stores/streamStore.ts` | P6-T01 | 1 | • `appendToken` concatenates tokens to the session's text buffer. • `completeStream` sets status to `complete`. • Store updates do not trigger full component tree re-render. |
| P6-T09 | useSessionEvents SSE hook | Implement `useSessionEvents(sessionId)` per §16.3. Subscribes to platform events via `subscribeToEvents`. Routes `copilot.token` events to Zustand `appendToken`. Routes `session.*` and `workflow.*` events to `queryClient.invalidateQueries`. Routes `copilot.message_complete` to chat cache invalidation + Zustand `completeStream`. Routes `artifact.created` to artifact cache invalidation. Cleans up subscription on unmount. | `packages/ui/src/hooks/useSessionEvents.ts` | P6-T06, P6-T07, P6-T08 | 2 | • SSE events trigger correct cache invalidations. • Token events update Zustand store. • Unmount calls unsubscribe. |

### 6C — Layout & Navigation

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P6-T10 | AppLayout | Implement the top-level layout shell per §17.2. Includes a fixed sidebar (collapsible), a top header bar, and a main content area. Uses CSS Grid or Flexbox. Sidebar collapses to an icon-only rail on smaller screens and can be toggled via a hamburger button. Renders `<Outlet>` (or children) for page content. | `apps/web/src/components/layout/AppLayout.tsx`, `apps/web/src/components/layout/index.ts` | P6-T02 | 2 | • Layout renders with sidebar, header, and main content area. • Sidebar collapses/expands on toggle. • Responsive: drawer mode on mobile widths. |
| P6-T11 | Sidebar | Implement the sidebar per §17.3. Contains: `SessionList` (top section), a "New Session" button, a divider, "Templates" link, and "Settings" link at the bottom. Highlights the active session. Scrollable when session list is long. | `apps/web/src/components/layout/Sidebar.tsx` | P6-T10, P6-T12 | 2 | • Sidebar renders session list with active highlight. • "New Session" button opens `CreateSessionDialog`. • Scrolls independently from main content. |
| P6-T12 | Header | Implement the header bar per §17.3. Contains: breadcrumb navigation (showing current session name), `ConnectionStatus` indicator, session action buttons (Start/Pause/Resume/Cancel/Delete — contextual based on session status), settings gear icon, and dark mode toggle. | `apps/web/src/components/layout/Header.tsx` | P6-T10, P6-T20 | 2 | • Header shows session name in breadcrumb. • Action buttons are contextually enabled/disabled based on session status. • Dark mode toggle works. |
| P6-T13 | React Router setup | Install `react-router-dom`. Define routes: `/` (redirect to session list or last active session), `/sessions` (session list/empty state), `/sessions/:id` (session detail with tabs), `/settings` (placeholder). Mount inside `AppLayout`. | `apps/web/src/router.tsx`, `apps/web/src/App.tsx` (updated) | P6-T10 | 1.5 | • Navigation between routes works. • URL reflects current session. • Unknown routes show 404 page. |

### 6D — Session Views

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P6-T14 | SessionList component | Renders the list of sessions in the sidebar. Each item shows: status indicator (colored dot), session name (truncated), last activity time. Clicking selects the session and navigates to `/sessions/:id`. Loading and empty states handled. Uses `useSessions()` hook. | `apps/web/src/components/sessions/SessionList.tsx`, `apps/web/src/components/sessions/SessionListItem.tsx` | P6-T06 | 2 | • Renders session list from query data. • Active session highlighted. • Empty state shows "No sessions yet" message. |
| P6-T15 | CreateSessionDialog | Modal dialog (shadcn `Dialog`) for creating a new session. Form fields: name (required), description, template selection (dropdown from `useTemplates()`), repo URL, branch, variables (dynamic key-value inputs based on template's variable definitions). Submit button calls `useCreateSession().mutate()`. Shows validation errors inline. | `apps/web/src/components/sessions/CreateSessionDialog.tsx` | P6-T06, P6-T07, P6-T02 | 3 | • Dialog opens from "New Session" button. • Template selection populates variable fields dynamically. • Successful creation closes dialog and navigates to new session. |
| P6-T16 | SessionDetail page with tabs | Main detail view per §17.2. Shows session name, status badge, and a tab bar with three tabs: **Workflows**, **Chat**, **Artifacts**. Uses shadcn `Tabs` component. Activates `useSessionEvents(sessionId)` to start SSE subscription. Default tab is "Workflows" for running sessions, "Chat" for completed sessions. | `apps/web/src/pages/SessionDetail.tsx` | P6-T09, P6-T02 | 2 | • Tab navigation between Workflows, Chat, Artifacts. • SSE subscription active while on the page. • Default tab selected based on session status. |

### 6E — Workflow & Chat Components

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P6-T17 | WorkflowTimeline | Renders a vertical timeline of workflows and their steps per §17.3. Each workflow shows: status icon (spinner for running, checkmark for completed, X for failed, circle for pending), name, elapsed time, and expandable step list. Steps show similar status icons with step name. Uses `useWorkflows(sessionId)` hook. Includes per-workflow Pause/Resume action buttons. Uses Framer Motion for expand/collapse animation. | `apps/web/src/components/workflows/WorkflowTimeline.tsx`, `apps/web/src/components/workflows/WorkflowStep.tsx` | P6-T06, P6-T07 | 3 | • Running step shows animated spinner. • Completed steps show duration. • Expand/collapse animation is smooth. • Pause/Resume buttons trigger mutations. |
| P6-T18 | ChatView with markdown & streaming | Implement the full chat view per §17.4. Scrollable message list with: `UserMessage` (prompt text, attachment chips), `AssistantMessage` (rendered via `react-markdown` with Shiki syntax highlighting for code blocks), `StreamingMessage` (live token buffer from Zustand `useStreamStore` + blinking cursor `▊`). Auto-scrolls to bottom on new messages. Uses `useChatHistory(sessionId)` for history and `useStreamStore` for live text. | `apps/web/src/components/chat/ChatView.tsx`, `apps/web/src/components/chat/ChatMessageList.tsx`, `apps/web/src/components/chat/UserMessage.tsx`, `apps/web/src/components/chat/AssistantMessage.tsx`, `apps/web/src/components/chat/StreamingMessage.tsx` | P6-T06, P6-T08, P6-T02 | 4 | • Chat history renders with markdown formatting. • Code blocks have syntax highlighting. • Streaming text appends with cursor animation. • Auto-scroll to latest message. |
| P6-T19 | ChatInput | Text input area at the bottom of the chat view. Multiline `Textarea` (shadcn) with `Ctrl+Enter` to send. Attachment picker supporting drag-and-drop and file selection (renders file chips). Send button calls `useSendPrompt(sessionId).mutate()`. Disabled when mutation is in-flight (shows spinner). Disabled when session does not allow chat. | `apps/web/src/components/chat/ChatInput.tsx`, `apps/web/src/components/chat/AttachmentPicker.tsx` | P6-T07, P6-T02 | 2.5 | • `Ctrl+Enter` sends the message. • Attached files shown as removable chips. • Button disabled during send (loading state). |

### 6F — Artifacts & Status

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P6-T20 | ArtifactBrowser | Renders artifacts in a card grid. Each card shows: file icon (based on mimeType), file name, size (formatted), and a download button. Clicking downloads the artifact via `platform.downloadArtifact()`. Image artifacts show a thumbnail preview. Uses `useArtifacts(sessionId)` hook. Empty state when no artifacts exist. | `apps/web/src/components/artifacts/ArtifactBrowser.tsx`, `apps/web/src/components/artifacts/ArtifactCard.tsx` | P6-T06, P6-T02 | 2.5 | • Artifacts render as cards with correct icons. • Download button triggers file download. • Image mimeTypes show thumbnail preview. |
| P6-T21 | ConnectionStatus indicator | A small indicator component in the header showing SSE connection state: green dot + "Connected", yellow dot + "Reconnecting...", red dot + "Disconnected". Tracks `EventSource.readyState`. Updates in real-time. Shows a tooltip with details (last event time, events received count). | `apps/web/src/components/status/ConnectionStatus.tsx` | P6-T09, P6-T02 | 1.5 | • Green indicator when SSE connected. • Yellow during reconnection. • Red when disconnected. • Tooltip shows connection details. |
| P6-T22 | Dark mode support | Ensure all components render correctly in both light and dark modes. Apply `dark:` Tailwind variants throughout. Verify shadcn/ui components respect the dark class. Test contrast ratios for WCAG AA compliance. Configure CSS variables for both themes in `globals.css`. Verify code block themes adapt (light theme for light mode, dark theme for dark). | `apps/web/src/styles/globals.css` (updated), component files as needed | P6-T02, P6-T05 | 2 | • All components render correctly in both themes. • Code blocks use theme-appropriate syntax highlighting colors. • No contrast issues in dark mode. |

### 6G — Component Tests

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P6-T23 | Test helpers: mock providers | Create a `renderWithProviders` test utility that wraps components in `QueryClientProvider` (fresh client), `PlatformProvider` (mock `HttpPlatformClient`), `ThemeProvider`, and `MemoryRouter`. Create `MockPlatformClient` that implements `IPlatformClient` with controllable return values and event emission. | `apps/web/src/__tests__/helpers/renderWithProviders.tsx`, `apps/web/src/__tests__/helpers/MockPlatformClient.ts` | P6-T05, P6-T04 | 2 | • `renderWithProviders(<Component />)` mounts with all providers. • `MockPlatformClient` methods can be configured to return specific data. |
| P6-T24 | Component tests — SessionList + CreateSessionDialog | Test SessionList rendering with mock data (loading state, empty state, populated state, active session highlighting). Test CreateSessionDialog: form renders, template selection updates variable fields, submission calls `createSession`, validation errors display. | `apps/web/src/__tests__/components/SessionList.test.tsx`, `apps/web/src/__tests__/components/CreateSessionDialog.test.tsx` | P6-T23, P6-T14, P6-T15 | 2.5 | • ≥8 test cases pass. • Loading spinner, empty state, and populated list all verified. • Dialog form validation tested. |
| P6-T25 | Component tests — ChatView & WorkflowTimeline | Test ChatView: renders message history, streaming message with cursor, markdown code blocks render, auto-scroll. Test WorkflowTimeline: step statuses render correct icons, expand/collapse works, pause/resume buttons call mutations. | `apps/web/src/__tests__/components/ChatView.test.tsx`, `apps/web/src/__tests__/components/WorkflowTimeline.test.tsx` | P6-T23, P6-T17, P6-T18 | 3 | • ≥10 test cases pass. • Streaming message displays Zustand store text. • Workflow step icons match status. |
| P6-T26 | Component tests — ArtifactBrowser & ConnectionStatus | Test ArtifactBrowser: renders cards, download triggers, image preview, empty state. Test ConnectionStatus: green/yellow/red states render correct indicators. | `apps/web/src/__tests__/components/ArtifactBrowser.test.tsx`, `apps/web/src/__tests__/components/ConnectionStatus.test.tsx` | P6-T23, P6-T20, P6-T21 | 2 | • ≥6 test cases pass. • Download button calls `downloadArtifact`. • Connection status colors match state. |

| P6-T27 | EventStream indicator component | Build `<EventStreamStatus>` component that displays SSE connection state (connected / reconnecting / disconnected) with a colored dot indicator. Shows reconnection countdown timer. Uses `useEventSource` hook from Zustand streaming store. Renders in the session header bar. | `packages/ui/src/components/EventStreamStatus.tsx` | P6-T04, P6-T08 | 2 | • Shows green dot when SSE connected. • Shows yellow dot with countdown during reconnection. • Shows red dot when disconnected. |
| P6-T28 | TemplateExplorer page | Build `<TemplateExplorer>` page component that displays available session templates in a grid/list layout. Each template card shows name, description, prompt count, and a 'Use Template' button that navigates to the create-session form pre-filled. Supports search/filter by name. Uses `useQuery` for template list from `/api/templates`. | `packages/ui/src/pages/TemplateExplorer.tsx`, `packages/ui/src/components/TemplateCard.tsx` | P6-T03, P6-T04 | 2 | • Displays template cards in a responsive grid. • Search filters templates by name. • 'Use Template' navigates to create form with pre-filled data. |
| P6-T29 | Settings page | Build `<SettingsPage>` component with tabbed sections: General (theme toggle, default model selection), API Keys (BYOK key entry with masked display), Webhooks (list/add/edit/delete webhook endpoints), and Advanced (log level, max concurrent sessions, workspace root path). Uses `useMutation` to PATCH `/api/config`. Validates inputs client-side before submission. | `packages/ui/src/pages/SettingsPage.tsx`, `packages/ui/src/components/settings/` | P6-T03, P6-T04 | 3 | • Theme toggle switches between light/dark and persists. • API key input masks the value after save. • Webhook form validates URL format. • Settings save via PATCH and show success toast. |
| P6-T30 | Framer Motion animations | Add `framer-motion` to `packages/ui`. Implement page transition animations (fade + slide for route changes via `<AnimatePresence>`), list item animations (stagger entrance for session list, message list), and micro-interactions (button press scale, toast entrance/exit). Create shared animation variants in `packages/ui/src/lib/animations.ts`. | `packages/ui/src/lib/animations.ts`, `packages/ui/package.json` | P6-T03 | 2 | • Route transitions animate with fade+slide. • Session list items stagger on entrance. • `framer-motion` added to package.json. |
### Phase 6 — Hour Total: **69 hours**

---

## Combined Summary

| Phase | Tasks | Hours |
|-------|-------|-------|
| **Phase 0 — Project Scaffolding** (P0-T01 → P0-T19) | 19 | **20 h** |
| **Phase 1 — Domain Layer** (P1-T01 → P1-T26) | 26 | **48.5 h** |
| **Phase 2 — Infrastructure Layer** (P2-T01 → P2-T21) | 21 | **58 h** |
| **Phase 3 — Application Services** (P3-T01 → P3-T20) | 25 | **97.5 h** |
| **Phase 4 — Server** (P4-T01 → P4-T21) | 24 | **48 h** |
| **Phase 5 — CLI Application** (P5-T01 → P5-T17) | 17 | **39.5 h** |
| **Phase 6 — Web Application** (P6-T01 → P6-T26) | 26 | **60 h** |
| **Grand Total** | 158 | **371.5 h** |

---

## Dependency Graph (Phase 4, 5 & 6 Critical Path)

```
P3-T12 (Composition root — Phase 3 complete)
    │
    ├────────────────────────────────────────────────────────────────┐
    │                                                                │
    ▼                                                                ▼
  PHASE 4 — Server                                    PHASE 5 — CLI (parallel)
    │                                                                │
    ├── P4-T01 (Express app factory)                    P5-T01 (Commander.js entry)
    │     ├── P4-T02 (requestId middleware)                ├── P5-T03 (config loading)
    │     ├── P4-T03 (CORS middleware)                    │     └── P5-T04 (init cmd)
    │     ├── P4-T04 (Zod validation middleware)          │
    │     ├── P4-T05 (error middleware)                   ├── P5-T02 (DirectPlatformClient)
    │     └── P4-T17 (static file serving)                │     ├── P5-T05 (start cmd)
    │                                                     │     ├── P5-T06 (stop cmd)
    ├── P4-T06 (API router index)                         │     ├── P5-T07 (list cmd)
    │     ├── P4-T07 (session routes)                     │     ├── P5-T08 (status cmd)
    │     ├── P4-T08 (workflow routes)                    │     ├── P5-T09 (chat cmd)
    │     ├── P4-T09 (chat routes)                        │     ├── P5-T10 (watch cmd)
    │     ├── P4-T10 (SSE stream route)                   │     └── P5-T11 (template cmd)
    │     ├── P4-T11 (artifact routes)                    │
    │     ├── P4-T12 (template routes)                    ├── P5-T12…T15 (Ink components)
    │     ├── P4-T13 (webhook routes) ◄── P4-T14         │
    │     ├── P4-T15 (health routes)                      └── P5-T16…T17 (CLI tests)
    │     ├── P4-T15B (copilot routes)
    │     ├── P4-T15C (hooks routes)
    │     └── P4-T15D (global events SSE)
    │
    ├── P4-T16 (server startup/shutdown)
    │
    └── P4-T18 (test app factory)
          └── P4-T19…T21 (integration tests)
                │
                ▼
          PHASE 6 — Web Application (after Phase 4 server is testable)
                │
                ├── P6-T01 (Vite scaffold)
                │     ├── P6-T02 (Tailwind + shadcn/ui)
                │     └── P6-T03 (TanStack Query)
                │
                ├── P6-T04 (HttpPlatformClient) ◄── needs Phase 4 API contract
                │     └── P6-T05 (PlatformProvider + ThemeProvider)
                │
                ├── P6-T06 (query hooks) ── P6-T07 (mutation hooks)
                ├── P6-T08 (Zustand store)
                ├── P6-T09 (useSessionEvents SSE hook)
                │
                ├── P6-T10 (AppLayout) ── P6-T11 (Sidebar) ── P6-T12 (Header)
                ├── P6-T13 (React Router)
                │
                ├── P6-T14 (SessionList) ── P6-T15 (CreateSessionDialog)
                ├── P6-T16 (SessionDetail with tabs)
                │     ├── P6-T17 (WorkflowTimeline)
                │     ├── P6-T18 (ChatView) ── P6-T19 (ChatInput)
                │     └── P6-T20 (ArtifactBrowser)
                │
                ├── P6-T21 (ConnectionStatus)
                ├── P6-T22 (Dark mode)
                │
                └── P6-T23 (test helpers)
                      └── P6-T24…T26 (component tests)
```

**Critical path**: P3-T12 → P4-T01 → P4-T06 → P4-T07 → P4-T18 → P4-T19 → P6-T04 → P6-T06 → P6-T09 → P6-T18

(New P4-T15B/C/D routes are off the critical path — they depend on P4-T06 but are not on the main dependency chain.)

---

## Notes

1. **Phase 4 and Phase 5 are parallelizable**: The CLI (Phase 5) does not depend on the server (Phase 4) — it uses `DirectPlatformClient` which calls core services in-process. Both phases depend only on Phase 3's composition root. Assigning separate developers to P4 and P5 is the optimal parallelization strategy.

2. **Phase 6 depends on Phase 4's API contract**: The web app's `HttpPlatformClient` (P6-T04) depends on knowing the exact API shape from Phase 4. However, the shared `IPlatformClient` interface (P1-T26) and the REST API spec (§13.1) define this contract, so P6 scaffold and UI work (P6-T01 → P6-T03, P6-T10 → P6-T13) can proceed in parallel with P4 using just the interface types.

3. **Shared `packages/ui` for hooks and stores**: The TanStack Query hooks (P6-T06, P6-T07), Zustand store (P6-T08), and SSE hook (P6-T09) are implemented in `packages/ui/` — not in `apps/web/`. This ensures they are reusable by the Desktop app (Phase 7+) which shares the same React component library.

4. **SSE testing strategy**: Testing the SSE endpoint (P4-T20) with supertest requires careful handling since supertest doesn't natively support streaming responses. Use event injection via `MockCopilotPort.emitEvent` to push events, then verify the response chunks. Alternatively, use a raw HTTP client or `eventsource` library in tests.

5. **CLI snapshot update workflow**: Snapshot tests (P5-T16) should be run with `--update` flag after intentional UI changes. The CI pipeline (from P0-T17) should fail on unexpected snapshot mismatches, forcing developers to review and explicitly approve visual changes.

6. **Dark mode implementation**: Tailwind's `dark:` variant strategy with a class-based toggle (not media query only) is used. The `ThemeProvider` (P6-T05) applies the `dark` class to `<html>` and stores preference in `localStorage`. System preference is the default, but user override takes precedence.

7. **multer for file uploads**: The chat route (P4-T09) uses `multer` with memory storage for handling multipart form data. Files are stored temporarily in memory and passed to `AttachmentService.storeUpload` which persists them to the session workspace. Configure a 10 MB file size limit.

8. **Parallel work within Phase 6**: After P6-T05 (providers complete), the layout work (P6-T10 → P6-T13), hook work (P6-T06 → P6-T09), and individual view components (P6-T14 → P6-T22) can proceed in parallel across multiple developers.


---

## Phase 7 — Desktop Application (Electron)

**Goal**: Deliver a fully functional desktop application using Electron + Vite, reusing the shared UI from `packages/ui` and connecting to core services via an IPC bridge that implements `IPlatformClient`. Include native platform features (system tray, menu bar, window state persistence, auto-update) and produce distributable installers for macOS, Windows, and Linux.

### 7A — Electron + Vite Scaffold

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P7-T01 | Electron + Vite scaffold with electron-builder | Configure the `apps/desktop` package with `electron-vite` (or `vite-plugin-electron`) for dual Vite builds: main process (Node target) and renderer process (browser target). Add `electron` and `electron-builder` as dev-dependencies. Create `electron-builder.yml` with default config (appId, productName, directories). Add `dev`, `build`, and `package` scripts to `apps/desktop/package.json`. | `apps/desktop/package.json`, `apps/desktop/electron-builder.yml`, `apps/desktop/vite.config.ts` (or `vite.main.config.ts` + `vite.renderer.config.ts`), `apps/desktop/tsconfig.json` (updated) | P0-T14 (desktop scaffold), P6-T01 (Vite patterns) | 3 | • `pnpm --filter @generatorai/desktop dev` launches Electron with a blank renderer window. • Vite HMR works in the renderer process during development. |
| P7-T02 | Renderer entry point with shared UI | Create the renderer entry point that imports `packages/ui` components and mounts the full app tree (PlatformProvider → QueryClientProvider → ThemeProvider → AppLayout). Configure Tailwind CSS and shadcn/ui in the renderer the same way as `apps/web`. Import the `IpcPlatformClient` (from P7-T05) as the platform provider value. | `apps/desktop/src/renderer/index.tsx`, `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/index.html`, `apps/desktop/src/renderer/styles/globals.css` | P7-T01, P6-T02 (Tailwind/shadcn), P6-T05 (providers pattern) | 2.5 | • Renderer loads and renders the full UI (Sidebar, Header, MainContent) identically to the web app. • `packages/ui` components render without modification. |

### 7B — Main Process & IPC

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P7-T03 | Main process setup (BrowserWindow + app lifecycle) | Implement the Electron main process entry point. Create the main `BrowserWindow` with `webPreferences: { preload, contextIsolation: true, nodeIntegration: false }`. Handle `app.whenReady()`, `window-all-closed`, and `activate` (macOS dock re-open) events. Configure sensible default window size (1280×800), min size (800×600), and title. In development, open DevTools automatically and load Vite dev URL; in production, load the built `index.html`. | `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/createWindow.ts` | P7-T01 | 3 | • App launches with a BrowserWindow of correct dimensions. • Context isolation is enabled and `nodeIntegration` is false. |
| P7-T04 | Preload script with context isolation | Implement the preload script using `contextBridge.exposeInMainWorld('platform', { ... })` per §6.4. Expose all `IPlatformClient` method stubs that delegate to `ipcRenderer.invoke(channel, ...args)`. Also expose `subscribeToEvents` using `ipcRenderer.on/removeListener` pattern for streaming. Expose desktop-specific methods: `selectDirectory()` and `openInEditor()`. Type the exposed API with a `Window` augmentation. | `apps/desktop/src/preload/preload.ts`, `apps/desktop/src/preload/types.d.ts` | P7-T03 | 2.5 | • `window.platform` is accessible in the renderer. • All `IPlatformClient` methods are available on `window.platform`. • Direct `require('electron')` from renderer is blocked. |
| P7-T05 | IpcPlatformClient implementing IPlatformClient | Implement `IpcPlatformClient` class in the renderer that reads from `window.platform` (the preload-exposed API) and conforms to the `IPlatformClient` interface. This is the renderer-side adapter that the PlatformProvider consumes. `subscribeToEvents` wraps the preload's IPC `on/removeListener` callbacks into the standard `Unsubscribe` pattern. `platform` property returns `'desktop'`. | `apps/desktop/src/renderer/platform/IpcPlatformClient.ts` | P7-T04, P6-T04 (HttpPlatformClient pattern) | 2 | • `IpcPlatformClient` passes TypeScript type-checking against `IPlatformClient`. • `subscribeToEvents` returns an `Unsubscribe` function that removes the listener. |
| P7-T06 | IPC handler registration (main process) | Implement `registerIpcHandlers(container)` per §6.4. Register `ipcMain.handle` for every `IPlatformClient` method: `session:create`, `session:start`, `session:pause`, `session:resume`, `session:cancel`, `session:delete`, `session:get`, `session:list`, `workflow:list`, `workflow:pause`, `workflow:resume`, `chat:send`, `chat:history`, `template:list`, `artifact:list`, `artifact:download`, `dialog:selectDirectory`, `shell:openInEditor`. Forward `EventBus` events to renderer via `mainWindow.webContents.send`. | `apps/desktop/src/main/ipc-handlers.ts` | P7-T03, P3-T12 (composition root pattern) | 4 | • Each `ipcMain.handle` channel correctly delegates to the corresponding service method. • Events are forwarded to the renderer via `webContents.send`. |

### 7C — Embedded Server & Event Forwarding

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P7-T07 | Embedded core services (in-process composition root) | Create a desktop-specific composition root that instantiates all core services in-process (same pattern as the server's `composition-root.ts` but without Express). Initialize DB, repositories, EventBus, CopilotAdapter, services. Run `StartupRecoveryService.recover()` on launch. Store the DB in the user's app data directory (`app.getPath('userData')`). | `apps/desktop/src/main/composition-root.ts` | P7-T03, P3-T12 (server composition root), P3-T11 (StartupRecoveryService) | 3 | • All core services initialize successfully on app launch. • SQLite database is created at `userData/generatorai.db`. • Startup recovery runs and recovers interrupted sessions. |
| P7-T08 | SSE-over-IPC event forwarding | Implement the event forwarding bridge in the main process that subscribes to `EventBus.subscribeAll()` and routes events to the renderer via `mainWindow.webContents.send('session:events:<sessionId>', event)`. Handle renderer window not ready (queue events until `did-finish-load`). Handle multiple windows if needed. Ensure events include full `PersistedEvent` shape (kind, sequenceId, data, sessionId, timestamp). | `apps/desktop/src/main/event-bridge.ts` | P7-T07, P3-T01 (EventBus) | 2.5 | • Events emitted by core services arrive in the renderer within 50 ms. • Events are correctly scoped by `sessionId`. • No events are lost during window initialization. |

### 7D — Native Features

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P7-T09 | Application menu bar | Create a custom `Menu` using Electron's `Menu.buildFromTemplate`. Include standard menus (App/File/Edit/View/Window/Help) with platform-appropriate shortcuts. Add GeneratorAI-specific items: New Session (`Cmd/Ctrl+N`), Toggle Sidebar (`Cmd/Ctrl+B`), Open DevTools (`Cmd/Ctrl+Shift+I`), Settings (`Cmd/Ctrl+,`), Check for Updates. Send menu actions to the renderer via IPC. | `apps/desktop/src/main/menu.ts` | P7-T03 | 2 | • Menu bar renders with all expected items on macOS, Windows, and Linux. • Keyboard shortcuts trigger the correct actions. |
| P7-T10 | System tray | Create a `Tray` instance with the app icon. Tray context menu includes: Show/Hide Window, active session count indicator, New Session, Quit. Left-click toggles window visibility. Show notification balloon/toast when a session completes (using `Notification` API). Persist tray across window close on non-macOS (app stays running). | `apps/desktop/src/main/tray.ts`, `apps/desktop/resources/tray-icon.png` (+ `@2x` variant) | P7-T03, P7-T07 | 2.5 | • Tray icon appears in the system tray area. • Context menu shows active session count. • Session completion triggers a desktop notification. |
| P7-T11 | Window state persistence | Persist window bounds (x, y, width, height) and maximized state to a JSON file in `userData`. Restore on next launch. Use `electron-store` or a simple JSON read/write. Debounce `move`/`resize` event writes (500 ms). Handle multi-monitor edge cases (clamp to visible display). | `apps/desktop/src/main/window-state.ts` | P7-T03 | 1.5 | • Window position and size are restored after closing and reopening the app. • Maximized state is preserved. • Window is clamped to a visible display if the previously used monitor is removed. |

### 7E — Auto-Update & Packaging

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P7-T12 | Auto-updater (electron-updater) | Integrate `electron-updater` per §20.3. Call `autoUpdater.checkForUpdatesAndNotify()` on app ready (with a 10 s delay). Listen for `update-available`, `update-downloaded`, and `error` events. Forward update status to the renderer via IPC (`update:available`, `update:ready`). Add an "Update Available" banner component in the renderer that prompts the user to restart and apply. Configure update feed URL (GitHub Releases). | `apps/desktop/src/main/updater.ts`, `apps/desktop/src/renderer/components/UpdateBanner.tsx` | P7-T03, P7-T08 | 2.5 | • App checks for updates on startup. • Update banner appears in the renderer when an update is downloaded. • Clicking "Restart & Update" calls `autoUpdater.quitAndInstall()`. |
| P7-T13 | Code signing configuration | Configure code signing in `electron-builder.yml` for all platforms: macOS (Apple Developer ID certificate via `CSC_LINK`/`CSC_KEY_PASSWORD` env vars, notarization via `afterSign` hook calling `@electron/notarize`), Windows (EV code signing certificate via `CSC_LINK`), Linux (no signing required). Add env var documentation. Configure CI environment variables in `.github/workflows/release.yml`. | `apps/desktop/electron-builder.yml` (updated), `apps/desktop/scripts/notarize.js`, `docs/code-signing.md` | P7-T01 | 2 | • `electron-builder.yml` contains valid macOS and Windows signing configuration. • Notarize script calls `@electron/notarize` with correct parameters. |
| P7-T14 | Packaging (.dmg, .exe, .AppImage) | Configure `electron-builder.yml` targets: macOS (`dmg` + `zip`), Windows (`nsis` installer), Linux (`AppImage` + `deb`). Set app icons for each platform (`.icns`, `.ico`, `.png`). Configure `files` globs to include renderer dist, main dist, preload, and `node_modules` dependencies. Add a `pnpm package:desktop` root script that runs `pnpm --filter @generatorai/desktop build && electron-builder`. Test that the build produces artifacts in `apps/desktop/dist/`. | `apps/desktop/electron-builder.yml` (updated), `apps/desktop/resources/icon.icns`, `apps/desktop/resources/icon.ico`, `apps/desktop/resources/icon.png`, `package.json` (root script) | P7-T01, P7-T13 | 3 | • `pnpm package:desktop` produces `.dmg` on macOS, `.exe` on Windows, `.AppImage` on Linux. • Installer size is < 200 MB. • Installed app launches and renders the full UI. |

### 7F — Desktop-Specific Testing

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P7-T15 | IPC handler unit tests | Test all IPC handlers: verify each `ipcMain.handle` channel correctly delegates to the service method. Mock the container services. Verify event forwarding sends events to `webContents.send`. Verify `dialog:selectDirectory` returns the selected path or null on cancel. Test error propagation (service error → IPC error response). | `apps/desktop/src/__tests__/ipc-handlers.test.ts` | P7-T06, P3-T13 (MockCopilotPort) | 3 | • ≥15 test cases pass. • Every IPC channel is tested. |
| P7-T16 | Window state persistence tests | Test save/restore cycle: save bounds → read back → verify match. Test debounce (rapid resize events produce only one write). Test multi-monitor clamping (saved position outside screen bounds → clamped). Test fresh launch with no saved state → uses defaults. | `apps/desktop/src/__tests__/window-state.test.ts` | P7-T11 | 1.5 | • ≥6 test cases pass. • Debounce verified with fake timers. |

### Phase 7 — Hour Total: **41 hours**

---

## Phase 8 — Integration & End-to-End Testing

**Goal**: Validate the entire system through end-to-end tests spanning the full stack (UI → API → core services → Copilot mock). Cover the web app with Playwright, the desktop app with Playwright for Electron, and run cross-platform smoke tests. Stress-test concurrency, SSE reconnection, and error recovery.

### 8A — Test Infrastructure

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P8-T01 | Playwright setup for web | Install Playwright and configure it for the web app. Create `playwright.config.ts` with `webServer` config that starts `apps/server` (with `MockCopilotPort`) and `apps/web` (Vite dev or preview). Configure 3 browser projects: Chromium, Firefox, WebKit. Set up base URL, screenshot-on-failure, trace collection, and retry policy. Create page object model base class with common navigation helpers. | `e2e/playwright.config.ts`, `e2e/package.json`, `e2e/tsconfig.json`, `e2e/fixtures/base.ts`, `e2e/pages/BasePage.ts` | P4-T16 (server startup), P6-T01 (web app) | 3 | • `pnpm test:e2e` launches the server+web, opens a browser, and runs a smoke test. • Tests run on Chromium, Firefox, and WebKit. |
| P8-T02 | Playwright for Electron setup | Configure Playwright's Electron integration (`electron.launch`) to test the desktop app. Create a fixture that builds the desktop app, launches it via `_electron.launch({ args: ['apps/desktop/dist/main/index.js'] })`, and provides the main `ElectronApplication` and first `Page` objects. Configure the embedded services to use `:memory:` SQLite and `MockCopilotPort`. | `e2e/electron.config.ts`, `e2e/fixtures/electron.ts` | P7-T01, P7-T07, P8-T01 | 3 | • Playwright launches the Electron app in test mode. • `electronApp.firstWindow()` returns a `Page` with the rendered UI. • Tests can interact with the renderer DOM. |
| P8-T03 | E2E test helpers & mock Copilot server | Create shared E2E helpers: `TestSessionFactory` (creates sessions via API/IPC with deterministic data), `MockCopilotServer` (a lightweight stub that responds to Copilot SDK JSON-RPC calls with canned responses for E2E — emits token events, message_complete, idle), `waitForEvent(page, eventKind)` helper for SSE assertions. Create seed data fixtures (templates, webhook registrations). | `e2e/helpers/TestSessionFactory.ts`, `e2e/helpers/MockCopilotServer.ts`, `e2e/helpers/waitForEvent.ts`, `e2e/fixtures/seed-data.ts` | P8-T01, P3-T13 (MockCopilotPort patterns) | 4 | • `MockCopilotServer` responds to conversation requests with configurable canned responses. • `TestSessionFactory` creates sessions reproducibly. |

### 8B — Core E2E Flows

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P8-T04 | E2E: create session → run workflow → verify artifacts (web) | Full happy-path test on the web app: navigate to dashboard, click "New Session", fill in the creation form (select template, provide name, set variables), submit, click "Start", observe workflow timeline progressing (workflow steps transition from pending → running → completed), switch to Chat tab (verify assistant messages arrive), switch to Artifacts tab (verify output artifacts listed), verify session status is "completed". | `e2e/tests/web/session-lifecycle.spec.ts` | P8-T01, P8-T03 | 5 | • Test passes end-to-end in < 60 seconds. • All three tabs (Workflows, Chat, Artifacts) show expected content. |
| P8-T05 | E2E: create session → run workflow → verify artifacts (Electron) | Same happy-path flow as P8-T04 but running in the Electron app. Verify that IPC-based platform client produces identical UX to the web app. Additionally test the desktop-only `selectDirectory` dialog interaction (mock the dialog response). | `e2e/tests/electron/session-lifecycle.spec.ts` | P8-T02, P8-T03 | 4 | • Full lifecycle completes successfully in the Electron window. • `selectDirectory` dialog is intercepted and returns a mock path. |
| P8-T06 | E2E: webhook trigger → auto-session | Test the webhook-to-session flow: send a POST request to `/api/webhooks/github` with a valid HMAC signature, a `push` event payload, and a matching webhook registration. Verify that a session is automatically created and started. Wait for the session to appear in the session list UI. Verify the session's `triggeredBy` metadata reflects the GitHub webhook source. | `e2e/tests/web/webhook-auto-session.spec.ts` | P8-T01, P8-T03, P4-T13 (webhook routes) | 3.5 | • Webhook POST returns 200. • Session appears in the UI within 5 seconds. • Session `triggeredBy` shows `github` source. |
| P8-T07 | E2E: pause / resume / cancel lifecycle | Test session lifecycle controls: start a session, click "Pause" in the header, verify workflow timeline shows paused state and pause icon, click "Resume", verify workflow resumes (steps continue progressing), start a new session, click "Cancel", confirm the cancel dialog, verify session status transitions to "cancelled" and workflows show cancelled status. | `e2e/tests/web/session-controls.spec.ts` | P8-T01, P8-T03 | 3.5 | • Pause → paused status reflected in UI within 2 seconds. • Resume → running status within 2 seconds. • Cancel → cancelled status and all workflows terminated. |

### 8C — Stress & Resilience Tests

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P8-T08 | Concurrent session stress test | Create 5 sessions via the API, start them all simultaneously, and verify all 5 complete (or are queued per `maxConcurrentSessions` limit). Verify the semaphore correctly limits active Copilot conversations. Monitor memory usage and event throughput. Assert no cross-session event leakage (events for session A never arrive on session B's SSE channel). | `e2e/tests/stress/concurrent-sessions.spec.ts` | P8-T01, P8-T03 | 4 | • All 5 sessions reach `completed` status. • No cross-session event leakage detected. • Semaphore blocks sessions 4–5 until slots free (when `maxConcurrentSessions=3`). |
| P8-T09 | SSE reconnection test | Test SSE durability: connect to a session's SSE stream, receive initial events, programmatically close the EventSource, reconnect with `Last-Event-ID` set to the last received sequence ID, and verify that missed events are replayed (no gaps, no duplicates). Also test the scenario where the server restarts mid-stream: connect, kill the server, restart, verify the client reconnects and replays. | `e2e/tests/resilience/sse-reconnection.spec.ts` | P8-T01, P8-T03, P3-T02 (SSETransport) | 4 | • Reconnected stream replays all missed events. • No duplicate events received. • `Last-Event-ID` correctly resumes from the right sequence. |
| P8-T10 | Error recovery test | Test system resilience: (1) Start a session where the `MockCopilotServer` returns a `copilot.error` event mid-workflow — verify the `on_error` hook is invoked and the workflow transitions to `failed`. (2) Simulate a network timeout on a Copilot request — verify `CopilotTimeoutError` is caught and the session can be retried. (3) Trigger a `SecurityError` by injecting a hook with a disallowed command — verify the session reports the error. Verify all error events appear in the UI error display. | `e2e/tests/resilience/error-recovery.spec.ts` | P8-T01, P8-T03 | 4 | • Copilot error → workflow `failed` status + error displayed in UI. • Timeout → recoverable error message shown. • Security error → clear error message with `SecurityError` code. |

### 8D — Cross-Platform Smoke Tests

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P8-T11 | Cross-platform CI smoke tests | Create a GitHub Actions workflow matrix that runs the core E2E suite (P8-T04 session lifecycle) on: Ubuntu (Chromium), macOS (WebKit), Windows (Chromium). For Electron tests, run on all 3 OS targets. Configure artifact uploads for screenshots and traces on failure. Set timeout to 10 minutes per platform. | `.github/workflows/e2e.yml`, `e2e/scripts/setup-ci.ts` | P8-T04, P8-T05, P0-T17 (CI workflow) | 3 | • E2E tests pass on all 3 OS platforms. • Failure screenshots and Playwright traces are uploaded as CI artifacts. |
| P8-T12 | CLI integration tests | Test CLI commands end-to-end against a live in-process core: `generatorai start code-generation --detach` → verify session created, `generatorai list` → verify session appears, `generatorai status <id>` → verify correct status shown, `generatorai stop <id> --cancel --force` → verify session cancelled. Run against `:memory:` SQLite with `MockCopilotPort`. | `e2e/tests/cli/cli-integration.spec.ts` | P5-T01 (CLI), P5-T02 (DirectPlatformClient), P8-T03 | 3 | • All CLI commands produce expected output. • Exit codes are correct (0 for success, 1 for failure). |

### Phase 8 — Hour Total: **44.5 hours**

---

## Phase 9 — Polish & Release

**Goal**: Prepare the project for public release. Polish documentation (API reference, user guide, developer guide), curate a starter template library, refine error messages and accessibility, profile performance, harden security, and automate the full release pipeline (Docker, npm, GitHub Releases, CHANGELOG).

### 9A — Documentation

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P9-T01 | API documentation (OpenAPI / Swagger) | Generate an OpenAPI 3.1 specification for all REST API endpoints defined in §13. Document every route with path, method, request body schema (referencing Zod schemas), response schemas, status codes, and example payloads. Integrate `swagger-ui-express` at `/api/docs` endpoint (development only). Validate the spec with `@apidevtools/swagger-parser`. | `apps/server/src/routes/openapi.ts`, `apps/server/src/middleware/swagger.ts`, `docs/api/openapi.yaml` | P4-T06 (API router), P4-T07–P4-T15 (all routes) | 5 | • `/api/docs` renders Swagger UI with all endpoints. • `openapi.yaml` passes schema validation with zero errors. |
| P9-T02 | User guide (getting started, configuration, templates) | Write a comprehensive user guide covering: installation (Docker, npm CLI, desktop download), first session walkthrough (step-by-step with screenshots), configuration reference (all `AppConfig` fields with descriptions and defaults), template format documentation (how to write custom templates), webhook setup guide (GitHub integration), and FAQ. Target audience: end users. | `docs/user-guide/README.md`, `docs/user-guide/getting-started.md`, `docs/user-guide/configuration.md`, `docs/user-guide/templates.md`, `docs/user-guide/webhooks.md`, `docs/user-guide/faq.md` | P1-T20 (AppConfig), P1-T21 (WorkflowTemplate), P4-T13 (webhooks) | 6 | • Guide covers all 5 main topics. • Configuration reference documents every `AppConfig` field. |
| P9-T03 | Developer guide (architecture overview, contributing) | Write a developer guide covering: architecture overview (4-layer diagram, package map, data flow), local development setup (prerequisites, `pnpm install`, running dev), contributing guidelines (branch naming, commit conventions, PR template, testing requirements), code style guide (ESLint rules, boundary layer rules), how to add a new workflow template, how to add a new hook type. Create `CONTRIBUTING.md` at repo root. | `docs/developer-guide/README.md`, `docs/developer-guide/architecture.md`, `docs/developer-guide/local-development.md`, `docs/developer-guide/adding-templates.md`, `CONTRIBUTING.md` | P0-T04 (ESLint), P0-T16 (Husky), P0-T17 (CI) | 4 | • `CONTRIBUTING.md` exists at repo root. • Architecture diagram matches the actual monorepo structure. |

### 9B — Template Library

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P9-T04 | Workflow template library (10 starter templates) | Create 10 production-quality workflow templates beyond the 4 existing placeholders. Templates: (1) `code-generation` — generate code from description, (2) `code-review` — review PR diff, (3) `test-generation` — generate unit tests, (4) `refactoring` — refactor code with goals, (5) `documentation` — generate API/code docs, (6) `bug-fix` — diagnose and fix a reported bug, (7) `migration` — database/API migration assistant, (8) `security-audit` — scan for vulnerabilities, (9) `performance-optimization` — profile and optimize, (10) `api-design` — design REST API from requirements. Each template includes well-crafted prompts, appropriate variables, hooks, and Copilot config. | `templates/code-generation.json`, `templates/code-review.json`, `templates/test-generation.json`, `templates/refactoring.json`, `templates/documentation.json`, `templates/bug-fix.json`, `templates/migration.json`, `templates/security-audit.json`, `templates/performance-optimization.json`, `templates/api-design.json` | P1-T21 (WorkflowTemplateSchema), P3-T09 (TemplateRegistry) | 6 | • All 10 templates pass `WorkflowTemplateSchema.parse()` validation. • Each template has ≥2 prompts, appropriate variables with descriptions, and at least one hook. |

### 9C — Quality & Hardening

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P9-T05 | Error message refinement | Audit all error classes and error handling paths. Ensure every user-facing error message is clear, actionable, and non-technical. Add `userMessage` field to `GeneratorAIError` that provides a human-friendly explanation distinct from the technical `message`. Update the error handling middleware to return `userMessage` in the API response. Update the web UI error display and CLI `ErrorBox` to show the user-friendly message. | `packages/shared/src/errors/GeneratorAIError.ts` (updated), `apps/server/src/middleware/errorHandler.ts` (updated), error subclass files (updated), `packages/ui/src/components/ErrorDisplay.tsx` | P1-T16, P1-T17, P4-T05 | 3 | • Every error subclass has a meaningful `userMessage`. • API error responses include `userMessage` field. |
| P9-T06 | Accessibility audit | Run `axe-core` accessibility checks on all web UI pages (dashboard, session detail, each tab, create dialog, settings). Fix any WCAG 2.1 AA violations. Verify keyboard navigation works throughout (tab order, focus trapping in dialogs, Escape to close). Verify screen reader announcements for status changes (session started, workflow completed) using `aria-live` regions. Test with high contrast mode. | `e2e/tests/accessibility/a11y-audit.spec.ts`, UI component files (updated as needed) | P6-T10–P6-T22 (all web components), P8-T01 (Playwright) | 4 | • `axe-core` reports zero critical or serious violations. • All interactive elements are keyboard-accessible. |
| P9-T07 | Performance profiling | Profile and optimize critical paths: (1) SQLite query performance — verify WAL mode is active, add `EXPLAIN QUERY PLAN` assertions for key queries (session list, event replay), ensure indexes are used. (2) SSE throughput — measure token-per-second delivery under load (target: 1000 events/sec across 10 concurrent streams). (3) Concurrent session CPU/memory — profile 5 concurrent sessions, ensure memory stays under 512 MB RSS. (4) React rendering — identify and fix unnecessary re-renders using React Profiler on the ChatView during streaming. Document baseline metrics. | `docs/performance-baseline.md`, `e2e/tests/performance/benchmarks.spec.ts`, `packages/db/src/__tests__/performance/query-plans.test.ts` | P2-T01 (SQLite), P3-T02 (SSETransport), P6-T18 (ChatView) | 5 | • WAL mode confirmed active. • Key queries use indexes (no full table scans). • SSE delivers ≥1000 events/sec without backpressure. |
| P9-T08 | Security hardening checklist | Implement and verify security measures: (1) Helmet middleware for HTTP security headers (CSP, HSTS, X-Frame-Options). (2) Rate limiting on API endpoints (100 req/min per IP). (3) Input sanitization audit — confirm all user inputs pass through Zod validation before processing. (4) Dependency audit — run `pnpm audit` and resolve all high/critical vulnerabilities. (5) Secret management — verify no secrets in code, `.env.example` documents all required env vars. (6) CORS restricted to configured origins. (7) CSP headers for Electron (`webPreferences.contentSecurityPolicy`). Create a checklist document. | `apps/server/src/middleware/security.ts`, `apps/server/src/middleware/rateLimiter.ts`, `.env.example`, `docs/security-checklist.md` | P4-T01 (Express app), P4-T03 (CORS), P7-T03 (Electron) | 4 | • Helmet headers present on all responses. • Rate limiting returns 429 when exceeded. • `pnpm audit` reports zero high/critical issues. |

### 9D — Release Pipeline

| Task ID | Name | Description | Files | Dependencies | Effort (h) | Acceptance Criteria |
|---------|------|-------------|-------|--------------|-------------|---------------------|
| P9-T09 | Docker image build + publish | Create a production Dockerfile per §20.2 (multi-stage: builder installs + builds, runner uses `node:22-alpine` with git). Add health check (`HEALTHCHECK CMD curl -f http://localhost:3100/api/health`). Create `docker-compose.yml` with sensible defaults (ports, volumes for DB persistence, environment variables). Add GitHub Actions step to build and push to Docker Hub / GitHub Container Registry on tagged release. | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.github/workflows/release.yml` (Docker steps) | P4-T16 (server), P0-T17 (CI) | 4 | • `docker build` produces an image under 300 MB. • `docker compose up` starts the server and web UI accessible at `localhost:3100`. • Health check passes. |
| P9-T10 | npm package publish for CLI | Configure `apps/cli/package.json` for npm publishing: set `name` to `@generatorai/cli`, `bin` to `{ "generatorai": "./dist/index.js" }`, `files` to `["dist"]`. Add a build step using `tsup` that produces a CJS/ESM bundle with shebang. Create a publish script that runs `pnpm build` then `npm publish --access public`. Add npm publish step to GitHub Actions release workflow. | `apps/cli/package.json` (updated), `apps/cli/tsup.config.ts`, `.github/workflows/release.yml` (npm steps) | P5-T01 (CLI), P0-T17 (CI) | 2.5 | • `npx @generatorai/cli --version` prints the correct version. • Published package includes `dist/` with executable entry point. |
| P9-T11 | GitHub Release automation | Create a GitHub Actions release workflow triggered by version tags (`v*`). Steps: (1) run full test suite, (2) build all packages, (3) build Docker image + push, (4) publish CLI to npm, (5) build Electron installers for all 3 platforms (macOS, Windows, Linux) with code signing, (6) create GitHub Release with auto-generated release notes, (7) upload Electron installers as release assets. Use `changesets` or `standard-version` for version management. | `.github/workflows/release.yml`, `.changeset/config.json` (or `.versionrc`) | P7-T14 (packaging), P9-T09 (Docker), P9-T10 (npm) | 4 | • Pushing a `v*` tag triggers the full release pipeline. • GitHub Release page contains Electron installers for all 3 platforms. |
| P9-T12 | CHANGELOG generation | Configure automated changelog generation from conventional commits. Use `@changesets/cli` (or `conventional-changelog`) to generate `CHANGELOG.md` from commit history. Categorize entries: Features, Bug Fixes, Breaking Changes, Performance, Documentation. Include PR numbers and author attribution. Integrate with the release workflow so the changelog is updated on each release. | `CHANGELOG.md`, `.changeset/config.json`, `package.json` (scripts: `changeset`, `version`) | P0-T16 (Husky/commitlint), P9-T11 | 2 | • `CHANGELOG.md` is generated with categorized entries. • Release workflow auto-updates the changelog. |

### Phase 9 — Hour Total: **49.5 hours**

---

## Full Summary Table — All Phases (P0–P9)

| Phase | Name | Task Count | Hours | Key Deliverable |
|-------|------|:----------:|:-----:|-----------------|
| **P0** | Project Scaffolding | 19 | 20 | Monorepo infrastructure, CI, tooling |
| **P1** | Domain Layer | 26 | 48.5 | Entities, state machines, ports, types, errors, config schemas |
| **P2** | Infrastructure Layer | 21 | 58 | SQLite/Drizzle repos, Copilot adapter (15+ methods), ScriptRunner, Git manager |
| **P3** | Application Services | 25 | 97.5 | EventBus (+ global channel), SSE, SessionService, WorkflowService (+ HookInterceptor), hooks (22 phases), webhooks, AttachmentService, ErrorHandler |
| **P4** | Server (Express HTTP) | 24 | 48 | REST API routes (+ copilot/hooks/global-events), middleware, SSE endpoint, server startup |
| **P5** | CLI Application | 17 | 39.5 | Commander.js commands, Ink components, DirectPlatformClient |
| **P6** | Web Application | 30 | 69 | React + Vite app, TanStack Query, UI components, ChatView, Settings, TemplateExplorer, Framer Motion |
| **P7** | Desktop (Electron) | 16 | 41 | Electron app, IPC bridge, native features, auto-update, packaging |
| **P8** | Integration & E2E | 12 | 44.5 | Playwright E2E, stress tests, SSE resilience, cross-platform CI |
| **P9** | Polish & Release | 12 | 49.5 | Docs, templates, a11y, security, Docker, npm, GitHub Releases |
| | **TOTALS** | **202** | **515.5** | |

---

## Critical Path Analysis

The **critical path** (longest dependency chain determining minimum project duration) traverses:

```
P0-T07 (core scaffold)
  → P1-T01 (Session entity)
    → P1-T07 (SessionStateMachine)
      → P1-T12 (Repository ports)
        → P2-T04 (SessionRepository)
          → P2-T14 (Test helpers)
            → P3-T01 (EventBus + global channel)
              → P3-T07 (HookExecutor)
                → P3-T07B (HookInterceptor)
                  → P3-T03 (SessionService)
                    → P3-T04 (WorkflowService + HookInterceptor)
                      → P3-T12 (Composition root + global hooks)
                        → P4-T01 (Express app factory)
                          → P4-T07 (Session routes)
                            → P4-T16 (Server startup)
                              → P6-T04 (HttpPlatformClient)
                                → P6-T09 (useSessionEvents)
                                  → P6-T16 (SessionDetail)
                                    → P7-T07 (Desktop composition root)
                                      → P7-T06 (IPC handlers)
                                        → P8-T04 (E2E lifecycle test)
                                          → P9-T11 (Release automation)
```

**Critical path length**: ~23 sequential milestones spanning P0 → P9
**Estimated critical path duration**: ~190 hours (of the 515.5 total)

This means with a single developer, the minimum project duration is ~175 hours of sequential work. Additional developers can reduce total calendar time by parallelizing non-critical tasks.

---

## Parallelization Opportunities

### Within-Phase Parallelism

| Phase | Parallel Tracks | Details |
|-------|----------------|---------|
| **P0** | 3 tracks | Track A: workspace+turbo+TS config (T01–T03) → Track B: ESLint+Vitest (T04–T05) → Track C: package scaffolding (T06–T15 can be 2 devs) |
| **P1** | 4 tracks | 1A (entities) ∥ 1C (ports) ∥ 1D (events) ∥ 1E (errors) — all independent after P0; 1B (state machines) depends on 1A+1D |
| **P2** | 3 tracks | Track A: repos (T04–T09 after T01–T03) ∥ Track B: Copilot adapter (T10) ∥ Track C: ScriptRunner+Git+Logger (T11–T13) |
| **P3** | 2 tracks | Track A: EventBus+SSE+global channel (T01–T02) ∥ Track B: HookExecutor+HookInterceptor+TemplateRegistry+ConfigResolver (T07–T07B–T09–T10); services (T03–T06) depend on both |
| **P4–P6** | **Full parallelism** | P4 (server), P5 (CLI), P6 (web) can run on 3 developers simultaneously — they share only P3 outputs |
| **P7** | 2 tracks | Track A: Electron scaffold+main+IPC (T01–T08) ∥ Track B: native features (T09–T11 once T03 is done) |
| **P8** | 2 tracks | Track A: web E2E (T01, T04, T06–T10) ∥ Track B: Electron E2E (T02, T05) + CLI tests (T12) |
| **P9** | 4 tracks | Docs (T01–T03) ∥ Templates (T04) ∥ Quality (T05–T08) ∥ Release pipeline (T09–T12) |

### Cross-Phase Parallelism

```
                  ┌─── P4 (Server) ───────┐
                  │                        │
P0 → P1 → P2 → P3 ┼─── P5 (CLI) ──────────┼─── P7 (Desktop) ──┐
                  │                        │                     │
                  └─── P6 (Web) ──────────┘                     ├── P8 (E2E)
                                                                │
                                                                └── P9 (Polish)
```

| Parallel Window | Tracks Running Concurrently | Developers Needed |
|----------------|-----------------------------|:-----------------:|
| **P4 + P5 + P6** | Server, CLI, Web all start from P3 outputs | 3 |
| **P7 ∥ P8-web** | Desktop build begins while web E2E starts | 2 |
| **P9 docs ∥ P9 quality ∥ P9 release** | Three independent workstreams within P9 | 3 |

**With 3 developers**: Estimated calendar time drops from ~515.5 sequential hours to **~240 hours** by parallelizing P4/P5/P6 and P9 workstreams.

---

## Phase Dependency Diagram

```
┌─────────┐
│  P0     │  Project Scaffolding (20h)
│ Scaffold│
└────┬────┘
     │
     ▼
┌─────────┐
│  P1     │  Domain Layer (48.5h)
│ Domain  │
└────┬────┘
     │
     ▼
┌─────────┐
│  P2     │  Infrastructure Layer (58h)
│ Infra   │
└────┬────┘
     │
     ▼
┌─────────┐
│  P3     │  Application Services (97.5h)
│ Services│
└────┬────┘
     │
     ├──────────────────┬──────────────────┐
     │                  │                  │
     ▼                  ▼                  ▼
┌─────────┐      ┌─────────┐       ┌─────────┐
│  P4     │      │  P5     │       │  P6     │   ◄── Can run in parallel
│ Server  │      │  CLI    │       │  Web    │
│ (48h)   │      │ (39.5h) │       │ (60h)  │
└────┬────┘      └────┬────┘       └────┬────┘
     │                │                  │
     └────────────────┼──────────────────┘
                      │
                      ▼
               ┌─────────┐
               │  P7     │  Desktop / Electron (41h)
               │ Desktop │  (needs P6 UI + P3 services)
               └────┬────┘
                    │
          ┌─────────┴─────────┐
          │                   │
          ▼                   ▼
   ┌─────────┐         ┌─────────┐
   │  P8     │         │  P9     │   ◄── Can partially overlap
   │  E2E    │         │ Polish  │
   │ (44.5h) │         │ (49.5h) │
   └─────────┘         └─────────┘
```

**Dependency Rules**:
- **P0** → P1 → P2 → P3: Strictly sequential (each layer builds on the one below)
- **P4, P5, P6**: All depend on P3; independent of each other (fully parallelizable)
- **P7**: Depends on P6 (shared UI) and P3 (core services)
- **P8**: Depends on P4 + P6 + P7 (tests all presentation layers)
- **P9**: Depends on P4 (API docs), P7 (packaging), P8 (quality validation); documentation tasks (T01–T04) can start as early as P4 completion
- **P9 release tasks** (T09–T12): Depend on P7 (Electron packaging) and P8 (test validation)
