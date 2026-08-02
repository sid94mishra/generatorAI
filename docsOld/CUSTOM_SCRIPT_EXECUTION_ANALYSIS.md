# Custom Script Execution in Workflow Runs — Architecture Analysis & Integration Plan

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Current Architecture Deep Dive](#2-current-architecture-deep-dive)
3. [Gap Analysis: What's Missing](#3-gap-analysis-whats-missing)
4. [Proposed Custom Script Execution Architecture](#4-proposed-custom-script-execution-architecture)
5. [Integration Points & Execution Triggers](#5-integration-points--execution-triggers)
6. [Data Model Changes](#6-data-model-changes)
7. [Backend Implementation Plan](#7-backend-implementation-plan)
8. [Frontend Integration Plan](#8-frontend-integration-plan)
9. [Security Architecture](#9-security-architecture)
10. [Industry Best Practices & Design Inspiration](#10-industry-best-practices--design-inspiration)
11. [File-by-File Implementation Guide](#11-file-by-file-implementation-guide)
12. [API Contract](#12-api-contract)
13. [Testing Strategy](#13-testing-strategy)
14. [Migration & Backward Compatibility](#14-migration--backward-compatibility)

---

## 1. Executive Summary

### Goal
Enable users to attach **custom scripts or code snippets** to workflow stages and runs, executed at specific lifecycle points (prerequisites, success criteria, event-driven hooks, tool interception, etc.). Users provide the scripts; the system executes them at the configured trigger point with full context.

### Current State
The codebase **already has significant foundational infrastructure** for this:
- **HookDefinition** system with 28+ lifecycle phases (pre_run, post_run, pre_prompt, post_prompt, pre_tool_use, post_tool_use, on_error, etc.)
- **SandboxedScriptRunner** with command allowlist, injection prevention, timeout/abort controls
- **HookExecutor** supporting script/http/function hook types with retry + failure policies
- **HookInterceptor** mapping SDK events to hook phases in real-time
- **WorkflowPreprocessor** with `run_script` preprocessing steps
- **ResultValidator** with `custom_script` validation type (placeholder — not yet implemented)

### What's Missing
1. **User-facing script management** — No UI or API to let users create/edit/upload scripts
2. **Script storage layer** — No database table or file storage for user scripts
3. **`custom_script` validator** — ResultValidator has the type but returns `true` always
4. **Script editor in UI** — No code editor component for writing inline scripts
5. **Script execution context injection** — Limited context passed to scripts (no stage output, no variables as structured data)
6. **Script result capture** — Hook results (stdout/stderr/exit code) aren't stored or surfaced in UI
7. **Per-stage custom hooks via UI** — Hooks are defined in templates/JSON but no UI panel to add custom hooks per stage
8. **Multi-language script support** — SandboxedScriptRunner supports `node`, `python`, `sh` etc. but no user-facing language selection

---

## 2. Current Architecture Deep Dive

### 2.1 Workflow Execution Flow (End-to-End)

```
[User creates WorkflowDefinition via UI/API]
    │
    ▼
[POST /workflow-runs] → WorkflowRunService.createRun()
    │  Creates WorkflowRun (status='created')
    │  Creates StageRun for each StageDefinition (status='pending')
    │
    ▼
[POST /workflow-runs/:id/start] → WorkflowRunService.startRun()
    │
    ├──▶ WorkflowOrchestrator.orchestrate()
    │      ├── Preprocessing Phase
    │      │     ├── Clone git repos          (GitManager)
    │      │     ├── Run preprocessing scripts (WorkflowPreprocessor)
    │      │     ├── Validate inputs
    │      │     └── Set variables
    │      │
    │      └── DAG Execution Phase
    │            ├── DAGScheduler.buildDAGForDefinition()
    │            │     └── Topological sort → execution layers
    │            └── Schedule root stages
    │
    ├──▶ For each stage: StageExecutionService.executeStage()
    │      │
    │      ├── SessionAllocator.allocateSession()
    │      ├── HookExecutor.executePhase('pre_prompt', hooks)    ◀── HOOK POINT
    │      ├── For each prompt in stage:
    │      │     ├── Variable interpolation ({{var}})
    │      │     ├── Send to Copilot SDK
    │      │     ├── Stream events via HookInterceptor            ◀── HOOK POINT (per event)
    │      │     │     ├── copilot.tool_start  → pre_tool_use     ◀── HOOK POINT
    │      │     │     ├── copilot.tool_complete → post_tool_use  ◀── HOOK POINT
    │      │     │     ├── copilot.message_complete → on_message  ◀── HOOK POINT
    │      │     │     └── copilot.reasoning_* → on_reasoning     ◀── HOOK POINT
    │      │     ├── Store chat messages
    │      │     └── Increment currentStep
    │      ├── HookExecutor.executePhase('post_prompt', hooks)    ◀── HOOK POINT
    │      ├── ResultValidator.validateStageResult()               ◀── VALIDATION POINT
    │      ├── Extract code artifacts
    │      └── Transition: StageRun → completed|failed
    │
    ├──▶ Polling Loop (3s intervals)
    │      ├── DAGScheduler.onStageCompleted() → get next stages
    │      ├── Evaluate edge conditions (on_success/on_failure/expression)
    │      └── Schedule ready stages (fire-and-forget)
    │
    └──▶ When all stages terminal:
           ├── ResultValidator.validateAllStages()                  ◀── VALIDATION POINT
           ├── HookExecutor.executePhase('post_run', hooks)        ◀── HOOK POINT
           └── Cleanup (sessions, git repos)
```

### 2.2 Existing Hook Infrastructure

**File: `packages/shared/src/types/HookDefinition.ts`**

28 hook phases already defined:
| Category | Phases |
|---|---|
| Workflow Lifecycle | `pre_run`, `post_run` |
| Git Operations | `pre_clone`, `post_clone` |
| Prompt Execution | `pre_prompt`, `post_prompt` |
| Artifact Commit | `pre_commit`, `post_commit` |
| Error/Cancel | `on_error`, `on_cancel` |
| Tool Execution | `pre_tool_use`, `post_tool_use` |
| LLM Streaming | `on_message`, `on_reasoning` |
| Session Lifecycle | `on_session_start`, `on_session_idle`, `on_session_error` |
| Client Lifecycle | `on_client_start`, `on_client_stop`, `on_client_error`, `on_client_restart` |
| Permissions | `on_permission` |

**Hook Types:** `script` | `http` | `function`
**Failure Policies:** `abort` | `skip` | `continue`

### 2.3 SandboxedScriptRunner Security

**File: `packages/core/src/infrastructure/SandboxedScriptRunner.ts`**

Security measures already in place:
- **Command allowlist**: `node`, `npm`, `npx`, `pnpm`, `git`, `sh`, `bash`, `python`, `python3`, `pip`, `tsc`, `eslint`, `vitest`, `jest`, etc.
- **Injection prevention**: Regex patterns blocking `; rm -rf`, `$()`, backticks, pipe to shell, `eval`
- **`shell: false`**: Process spawned without shell to prevent metacharacter injection
- **Timeout enforcement**: Configurable per-script, default 60s, process killed via SIGKILL
- **Output limits**: Max 1MB stdout/stderr
- **AbortSignal support**: External cancellation capability
- **Active process tracking**: Graceful shutdown kills all child processes

### 2.4 Result Validation System

**File: `packages/core/src/services/ResultValidator.ts`**

Existing validation rule types:
| Rule Type | Status | Description |
|---|---|---|
| `contains` | Implemented | Substring match on stage output |
| `not_contains` | Implemented | Negative substring match |
| `min_length` | Implemented | Minimum output length |
| `max_length` | Implemented | Maximum output length |
| `regex` | Implemented | Pattern match |
| `custom_script` | **STUB ONLY** | Placeholder — always returns `true` |

### 2.5 Preprocessing System

**File: `packages/core/src/services/WorkflowPreprocessor.ts`**

Step types:
| Type | Status | Description |
|---|---|---|
| `clone_repo` | Implemented | Git clone with branch support |
| `run_script` | Implemented | Execute shell script with env vars |
| `validate_input` | Implemented | Required, regex, min/max length |
| `set_variable` | Implemented | Static or interpolated values |
| `conditional` | Implemented | if/then/else with simple conditions |

---

## 3. Gap Analysis: What's Missing

### 3.1 Script Storage & Management

**Current:** Hooks are JSON objects embedded in StageDefinition or template JSON files. There is no way for users to upload, store, or manage standalone scripts.

**Needed:**
- Database table for user scripts (`user_scripts`)
- File-based storage for larger scripts
- Script versioning
- Script association with workflow definitions, stages, or as global library scripts

### 3.2 Custom Script Validation (ResultValidator)

**Current:** `custom_script` rule type exists in the type system but `evaluateRule()` returns `true` unconditionally with a warning log.

**Needed:**
- Wire `custom_script` rule to `SandboxedScriptRunner`
- Pass stage output as stdin or environment variable to the script
- Interpret exit code 0 as pass, non-zero as fail
- Capture stdout as validation context/message

### 3.3 User-Facing Hook Configuration

**Current:** Hooks can only be configured via:
1. Template JSON files (`templates/system/*.json`)
2. Direct API calls with full HookDefinition JSON
3. No UI for adding/editing hooks per stage

**Needed:**
- Stage properties panel extension for "Custom Scripts" tab
- Inline code editor (Monaco) for writing scripts
- Script trigger selection (which phase to run on)
- Failure policy selection (abort/skip/continue)
- Test/dry-run capability

### 3.4 Script Execution Result Capture

**Current:** HookExecutor emits `hook.started`, `hook.completed`, `hook.failed` events but does NOT capture or store stdout/stderr/exit code from script hooks.

**Needed:**
- Capture script execution results (stdout, stderr, exit code, duration)
- Store in a new `script_execution_results` table or extend events table
- Surface in UI (expandable log viewer per hook execution)
- Make script output available to subsequent stages via variables

### 3.5 Richer Execution Context

**Current:** `HookContext` provides: `sessionId`, `workflowId`, `workspacePath`, `variables`, `eventBus`. `SDKHookContext` adds: `sdkEvent`, `toolName`, `toolArgs`, `toolResult`, `messageContent`, `errorMessage`.

**Needed for custom scripts:**
- Stage output (all assistant messages from the stage)
- Stage artifacts (list of generated files)
- Previous stage results (for cross-stage scripts)
- Workflow-wide accumulated context
- Script-specific input parameters defined by the user

---

## 4. Proposed Custom Script Execution Architecture

### 4.1 Core Concept: "Script Actions"

Introduce a unified abstraction called **ScriptAction** — a user-defined script or code snippet that can be attached to any workflow lifecycle point. This replaces the need for users to understand the low-level hook system.

```typescript
interface ScriptAction {
  id: string;
  name: string;
  description?: string;

  // Script content
  language: 'bash' | 'node' | 'python' | 'inline-js';
  source: ScriptSource;

  // Trigger configuration
  trigger: ScriptTrigger;

  // Execution settings
  timeoutMs: number;           // Default: 60000
  retries: number;             // Default: 0
  failurePolicy: 'abort' | 'skip' | 'continue';  // Default: 'abort'

  // Context requirements
  inputs: ScriptInput[];       // Named inputs from workflow context
  outputs: ScriptOutput[];     // Named outputs injected into workflow variables

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}
```

### 4.2 Script Source Types

```typescript
type ScriptSource =
  | { type: 'inline'; code: string }                    // Direct inline code
  | { type: 'file'; path: string }                      // File in workspace
  | { type: 'stored'; scriptId: string }                // Reference to stored script in DB
  | { type: 'url'; url: string; checksum?: string };    // Remote script (with integrity check)
```

### 4.3 Script Trigger Types

```typescript
type ScriptTrigger =
  // Stage lifecycle
  | { type: 'pre_stage'; stageId: string }              // Before stage executes
  | { type: 'post_stage'; stageId: string }             // After stage completes
  | { type: 'on_stage_failure'; stageId: string }       // When stage fails

  // Prompt lifecycle
  | { type: 'pre_prompt'; stageId: string; promptIndex?: number }   // Before each/specific prompt
  | { type: 'post_prompt'; stageId: string; promptIndex?: number }  // After each/specific prompt

  // Success criteria
  | { type: 'success_criteria'; stageId: string }       // Validates stage output
  | { type: 'prerequisite'; stageId: string }           // Gate before stage begins

  // Workflow lifecycle
  | { type: 'pre_run' }                                 // Before entire workflow
  | { type: 'post_run' }                                // After entire workflow
  | { type: 'on_error' }                                // On any error

  // Tool interception
  | { type: 'pre_tool'; toolName?: string }             // Before tool executes (optionally filter by tool name)
  | { type: 'post_tool'; toolName?: string }            // After tool executes

  // Event-driven
  | { type: 'on_event'; eventKind: string }             // Custom event matching
  | { type: 'on_message' }                              // After LLM message received
  | { type: 'periodic'; intervalMs: number };           // Recurring during execution
```

### 4.4 Script Input/Output Contract

```typescript
interface ScriptInput {
  name: string;                // Environment variable name exposed to script
  source: 'variable' | 'stage_output' | 'artifact_list' | 'context' | 'literal';
  key?: string;                // Variable name, stage ID, or literal value
  required: boolean;
}

interface ScriptOutput {
  name: string;                // Variable name to set in workflow context
  extractFrom: 'stdout' | 'exit_code' | 'json_stdout' | 'file';
  path?: string;               // JSON path or file path for extraction
}
```

### 4.5 Execution Flow for Script Actions

```
Script Action triggered (by lifecycle event)
    │
    ├── 1. Resolve ScriptSource
    │     ├── inline → use code directly
    │     ├── file → read from workspace
    │     ├── stored → load from DB
    │     └── url → fetch + verify checksum
    │
    ├── 2. Build execution context
    │     ├── Set environment variables from ScriptInputs
    │     ├── Set standard env vars:
    │     │     WORKFLOW_RUN_ID, STAGE_RUN_ID, STAGE_NAME,
    │     │     WORKSPACE_PATH, SESSION_ID, TRIGGER_TYPE
    │     ├── Write stage output to temp file (for success criteria)
    │     └── Write artifacts list to temp file
    │
    ├── 3. Execute via SandboxedScriptRunner
    │     ├── Select command based on language:
    │     │     bash → sh -c <code>
    │     │     node → node -e <code>  or  node <file>
    │     │     python → python3 -c <code>  or  python3 <file>
    │     │     inline-js → node --eval <code>
    │     ├── Apply timeout, abort signal
    │     └── Capture stdout, stderr, exit code
    │
    ├── 4. Process results
    │     ├── Extract outputs per ScriptOutput definitions
    │     ├── Set workflow variables from outputs
    │     ├── Store execution result in DB
    │     └── Emit events (script.started, script.completed, script.failed)
    │
    └── 5. Apply failure policy
          ├── abort → throw to cancel stage/workflow
          ├── skip → log warning, continue
          └── continue → log error, continue
```

---

## 5. Integration Points & Execution Triggers

### 5.1 How Each Trigger Maps to Existing Code

| Trigger Type | Integration Point | File | Mechanism |
|---|---|---|---|
| `prerequisite` | Before `StageExecutionService.executeStage()` | `StageExecutionService.ts` | New guard check before session allocation |
| `success_criteria` | After stage completes, before status transition | `ResultValidator.ts` | Implement `custom_script` rule type |
| `pre_stage` | Maps to `pre_prompt` hook phase (first prompt) | `HookExecutor.ts` | Existing hook phase execution |
| `post_stage` | Maps to `post_prompt` hook phase (last prompt) | `HookExecutor.ts` | Existing hook phase execution |
| `pre_run` / `post_run` | Orchestrator lifecycle | `WorkflowOrchestrator.ts` | Existing hook phases |
| `pre_tool` / `post_tool` | HookInterceptor event mapping | `HookInterceptor.ts` | Existing `pre_tool_use` / `post_tool_use` |
| `on_message` | HookInterceptor `on_message` phase | `HookInterceptor.ts` | Existing phase |
| `on_error` | Error handler in execution service | `StageExecutionService.ts` | Existing `on_error` phase |
| `on_event` | EventBus subscription | New `ScriptEventHandler.ts` | Subscribe to specific event kinds |
| `periodic` | setInterval during run | New `PeriodicScriptRunner.ts` | Timer-based execution during active runs |

### 5.2 New Hook Phases Needed

Two new phases are recommended for clarity (while still mapping internally to existing phases when possible):

```typescript
// Add to HookPhase union type in HookDefinition.ts
| 'prerequisite'      // Gate check before stage begins (distinct from pre_prompt)
| 'success_criteria'  // Validation after stage output (distinct from post_prompt)
```

These provide semantic clarity for users versus `pre_prompt`/`post_prompt` and enable different context injection (prerequisite gets no stage output, success_criteria gets full stage output).

---

## 6. Data Model Changes

### 6.1 New Database Table: `script_actions`

```sql
CREATE TABLE script_actions (
  id TEXT PRIMARY KEY,

  -- Ownership
  workflowDefinitionId TEXT REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  stageDefinitionId TEXT REFERENCES stage_definitions(id) ON DELETE SET NULL,

  -- Identity
  name TEXT NOT NULL,
  description TEXT,

  -- Script
  language TEXT NOT NULL CHECK(language IN ('bash', 'node', 'python', 'inline-js')),
  sourceType TEXT NOT NULL CHECK(sourceType IN ('inline', 'file', 'stored')),
  sourceCode TEXT,           -- For inline scripts
  sourcePath TEXT,           -- For file-based scripts
  sourceScriptId TEXT,       -- For stored script references

  -- Trigger
  triggerType TEXT NOT NULL,  -- pre_stage, post_stage, prerequisite, success_criteria, etc.
  triggerConfig JSON,         -- Additional trigger config (toolName filter, promptIndex, etc.)

  -- Execution
  timeoutMs INTEGER DEFAULT 60000,
  retries INTEGER DEFAULT 0,
  failurePolicy TEXT DEFAULT 'abort' CHECK(failurePolicy IN ('abort', 'skip', 'continue')),
  priority INTEGER DEFAULT 100,
  enabled BOOLEAN DEFAULT 1,

  -- I/O
  inputs JSON DEFAULT '[]',   -- ScriptInput[]
  outputs JSON DEFAULT '[]',  -- ScriptOutput[]

  -- Meta
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX idx_script_actions_workflow ON script_actions(workflowDefinitionId);
CREATE INDEX idx_script_actions_stage ON script_actions(stageDefinitionId);
CREATE INDEX idx_script_actions_trigger ON script_actions(triggerType);
```

### 6.2 New Database Table: `script_execution_results`

```sql
CREATE TABLE script_execution_results (
  id TEXT PRIMARY KEY,

  -- References
  scriptActionId TEXT NOT NULL REFERENCES script_actions(id) ON DELETE CASCADE,
  workflowRunId TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  stageRunId TEXT REFERENCES stage_runs(id) ON DELETE SET NULL,

  -- Execution
  triggerType TEXT NOT NULL,
  startedAt INTEGER NOT NULL,
  completedAt INTEGER,
  durationMs INTEGER,
  exitCode INTEGER,
  stdout TEXT,
  stderr TEXT,
  passed BOOLEAN,            -- For success_criteria / prerequisite

  -- Extracted outputs
  extractedOutputs JSON,     -- { variableName: value }

  -- Error info
  error TEXT,
  timedOut BOOLEAN DEFAULT 0
);

CREATE INDEX idx_script_results_run ON script_execution_results(workflowRunId);
CREATE INDEX idx_script_results_stage ON script_execution_results(stageRunId);
CREATE INDEX idx_script_results_action ON script_execution_results(scriptActionId);
```

### 6.3 Drizzle Schema Additions

```typescript
// In packages/db/src/schema.ts

export const scriptActions = sqliteTable('script_actions', {
  id: text('id').primaryKey(),
  workflowDefinitionId: text('workflowDefinitionId')
    .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  stageDefinitionId: text('stageDefinitionId')
    .references(() => stageDefinitions.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description'),
  language: text('language', { enum: ['bash', 'node', 'python', 'inline-js'] }).notNull(),
  sourceType: text('sourceType', { enum: ['inline', 'file', 'stored'] }).notNull(),
  sourceCode: text('sourceCode'),
  sourcePath: text('sourcePath'),
  sourceScriptId: text('sourceScriptId'),
  triggerType: text('triggerType').notNull(),
  triggerConfig: text('triggerConfig', { mode: 'json' }),
  timeoutMs: integer('timeoutMs').default(60000),
  retries: integer('retries').default(0),
  failurePolicy: text('failurePolicy', { enum: ['abort', 'skip', 'continue'] }).default('abort'),
  priority: integer('priority').default(100),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  inputs: text('inputs', { mode: 'json' }).default('[]'),
  outputs: text('outputs', { mode: 'json' }).default('[]'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
});

export const scriptExecutionResults = sqliteTable('script_execution_results', {
  id: text('id').primaryKey(),
  scriptActionId: text('scriptActionId')
    .notNull()
    .references(() => scriptActions.id, { onDelete: 'cascade' }),
  workflowRunId: text('workflowRunId')
    .notNull()
    .references(() => workflowRuns.id, { onDelete: 'cascade' }),
  stageRunId: text('stageRunId')
    .references(() => stageRuns.id, { onDelete: 'set null' }),
  triggerType: text('triggerType').notNull(),
  startedAt: integer('startedAt', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completedAt', { mode: 'timestamp' }),
  durationMs: integer('durationMs'),
  exitCode: integer('exitCode'),
  stdout: text('stdout'),
  stderr: text('stderr'),
  passed: integer('passed', { mode: 'boolean' }),
  extractedOutputs: text('extractedOutputs', { mode: 'json' }),
  error: text('error'),
  timedOut: integer('timedOut', { mode: 'boolean' }).default(false),
});
```

---

## 7. Backend Implementation Plan

### 7.1 New Service: `ScriptActionService`

**File: `packages/core/src/services/ScriptActionService.ts`**

```typescript
export class ScriptActionService {
  constructor(
    private scriptActionRepo: IScriptActionRepository,
    private scriptResultRepo: IScriptExecutionResultRepository,
    private scriptRunner: IScriptRunner,
    private eventBus: EventBus,
    private logger: ILogger,
  ) {}

  // CRUD for script actions
  async create(params: CreateScriptActionParams): Promise<ScriptAction>;
  async update(id: string, params: UpdateScriptActionParams): Promise<ScriptAction>;
  async delete(id: string): Promise<void>;
  async getById(id: string): Promise<ScriptAction>;
  async getByWorkflowDefinition(defId: string): Promise<ScriptAction[]>;
  async getByStage(stageDefId: string): Promise<ScriptAction[]>;
  async getByTrigger(defId: string, trigger: string): Promise<ScriptAction[]>;

  // Execution
  async executeScriptAction(
    action: ScriptAction,
    context: ScriptExecutionContext,
  ): Promise<ScriptExecutionResult>;

  // Convert ScriptActions to HookDefinitions for the existing hook system
  convertToHookDefinitions(actions: ScriptAction[]): HookDefinition[];

  // Build execution context
  buildContext(params: {
    workflowRunId: string;
    stageRunId?: string;
    workspacePath: string;
    variables: Record<string, unknown>;
    stageOutput?: string;
    artifactPaths?: string[];
  }): ScriptExecutionContext;

  // Dry run / test
  async testScript(params: TestScriptParams): Promise<ScriptExecutionResult>;
}
```

### 7.2 Integrate into StageExecutionService

**File: `packages/core/src/services/StageExecutionService.ts`**

Changes needed to the `executeStage()` method:

```typescript
async executeStage(stageRun, workflowRunId, ...) {
  // NEW: Load script actions for this stage
  const scriptActions = await this.scriptActionService
    .getByStage(stageRun.stageDefinitionId);

  // NEW: Execute prerequisite scripts
  const prerequisites = scriptActions.filter(a => a.triggerType === 'prerequisite' && a.enabled);
  for (const prereq of prerequisites.sort((a, b) => a.priority - b.priority)) {
    const result = await this.scriptActionService.executeScriptAction(prereq, context);
    if (!result.passed) {
      if (prereq.failurePolicy === 'abort') {
        // Skip this stage
        await this.transitionStageRun(stageRunId, 'skipped', `Prerequisite "${prereq.name}" failed`);
        return;
      }
    }
    // Merge outputs into variables
    this.mergeOutputs(result.extractedOutputs, variables);
  }

  // ... existing session allocation + prompt execution ...

  // NEW: Execute success criteria scripts (after stage completes)
  const successCriteria = scriptActions.filter(a => a.triggerType === 'success_criteria' && a.enabled);
  for (const criteria of successCriteria.sort((a, b) => a.priority - b.priority)) {
    const result = await this.scriptActionService.executeScriptAction(criteria, {
      ...context,
      stageOutput: assistantOutput,          // Pass full stage output
      artifactPaths: extractedArtifacts,     // Pass generated file paths
    });
    if (!result.passed) {
      if (criteria.failurePolicy === 'abort') {
        // Mark stage as failed
        await this.transitionStageRun(stageRunId, 'failed', `Success criteria "${criteria.name}" failed`);
        return;
      }
    }
  }
}
```

### 7.3 Implement `custom_script` in ResultValidator

**File: `packages/core/src/services/ResultValidator.ts`**

```typescript
private async evaluateRule(rule: ResultValidationRule, output: string): Promise<boolean> {
  // ... existing rules ...

  case 'custom_script': {
    // rule.value contains the script content or script ID
    const scriptSource = typeof rule.value === 'string' ? rule.value : '';
    const tempFile = path.join(os.tmpdir(), `validation-${randomUUID()}.sh`);

    try {
      // Write stage output to temp file for the script to read
      const outputFile = path.join(os.tmpdir(), `stage-output-${randomUUID()}.txt`);
      await fs.writeFile(outputFile, output);

      const result = await this.scriptRunner.run('sh', ['-c', scriptSource], {
        cwd: process.cwd(),
        env: {
          STAGE_OUTPUT: output.slice(0, 1024 * 64),  // First 64KB via env
          STAGE_OUTPUT_FILE: outputFile,               // Full output via file
          STAGE_NAME: rule.message || 'unknown',
        },
        timeout: 30_000,
      });

      return result.exitCode === 0;
    } finally {
      // Cleanup temp files
    }
  }
}
```

### 7.4 Wire ScriptActions into HookExecutor

Converting user-friendly ScriptActions into the existing HookDefinition format:

```typescript
// In ScriptActionService
convertToHookDefinition(action: ScriptAction): HookDefinition {
  const hookPhase = this.mapTriggerToHookPhase(action.triggerType);

  return {
    id: action.id,
    name: action.name,
    phase: hookPhase,
    type: 'script',
    priority: action.priority,
    enabled: action.enabled,
    failurePolicy: action.failurePolicy,
    timeoutMs: action.timeoutMs,
    retries: action.retries,
    config: {
      type: 'script',
      command: this.getCommand(action.language),
      args: this.getArgs(action),
      env: this.buildEnvFromInputs(action.inputs),
    } as ScriptHookConfig,
  };
}

private mapTriggerToHookPhase(trigger: string): HookPhase {
  const mapping: Record<string, HookPhase> = {
    'pre_stage': 'pre_prompt',
    'post_stage': 'post_prompt',
    'prerequisite': 'pre_prompt',       // But with special handling
    'success_criteria': 'post_prompt',  // But with special handling
    'pre_run': 'pre_run',
    'post_run': 'post_run',
    'on_error': 'on_error',
    'pre_tool': 'pre_tool_use',
    'post_tool': 'post_tool_use',
    'on_message': 'on_message',
  };
  return mapping[trigger] ?? 'post_prompt';
}
```

### 7.5 New API Routes

**File: `apps/server/src/routes/scriptActions.ts`**

```typescript
// Script Action CRUD
router.post('/workflow-definitions/:defId/script-actions', createScriptAction);
router.get('/workflow-definitions/:defId/script-actions', listScriptActions);
router.get('/script-actions/:id', getScriptAction);
router.put('/script-actions/:id', updateScriptAction);
router.delete('/script-actions/:id', deleteScriptAction);

// Stage-specific script actions
router.get('/stages/:stageId/script-actions', getStageScriptActions);

// Script execution results
router.get('/workflow-runs/:runId/script-results', getScriptResults);
router.get('/stage-runs/:stageRunId/script-results', getStageScriptResults);

// Test/dry-run
router.post('/script-actions/:id/test', testScriptAction);
router.post('/script-actions/test-inline', testInlineScript);
```

---

## 8. Frontend Integration Plan

### 8.1 Stage Properties Panel Extension

Add a "Scripts" tab to the existing `StagePropertiesPanel` component:

```
[StagePropertiesPanel]
  ├── Tab: General (name, description, prompts)
  ├── Tab: Configuration (model, tools, timeout)
  ├── Tab: Conditions (edge conditions, retry)
  └── Tab: Scripts ◀── NEW
        ├── Prerequisites Section
        │     ├── [+ Add Prerequisite Script]
        │     └── List of prerequisite scripts with:
        │           ├── Name field
        │           ├── Language selector (Bash/Node/Python)
        │           ├── Code editor (Monaco, collapsible)
        │           ├── Timeout input
        │           ├── Failure policy dropdown
        │           └── Delete button
        ├── Success Criteria Section
        │     ├── [+ Add Success Criteria Script]
        │     └── Same fields as above
        └── Event Hooks Section
              ├── [+ Add Event Hook]
              ├── Trigger type selector (pre_prompt, post_prompt, on_message, etc.)
              └── Same script fields
```

### 8.2 Code Editor Component

Use Monaco Editor (already available via `@monaco-editor/react`) for inline script editing:

```
[ScriptEditor]
  ├── Language selector (bash | node | python)
  ├── Monaco editor with language-specific syntax highlighting
  ├── Available context variables panel (collapsible)
  │     Shows: WORKFLOW_RUN_ID, STAGE_RUN_ID, STAGE_OUTPUT, etc.
  ├── [Test Script] button → dry run with sample data
  └── Execution settings toggle (timeout, retries, failure policy)
```

### 8.3 Workflow Run Monitor Enhancement

Add script execution visualization to the run monitor:

```
[WorkflowRunPanel]
  └── [StageRunCard]
        ├── Status, duration, prompts progress (existing)
        └── Script Executions ◀── NEW
              ├── ✓ Prerequisite: "Check dependencies" (0.5s)
              ├── ✓ Success: "Verify output format" (1.2s)
              └── ✗ Success: "Run tests" (FAILED - exit 1)
                    └── [Expand] → stdout/stderr viewer
```

### 8.4 New UI Components Needed

| Component | Purpose |
|---|---|
| `ScriptActionsTab` | Tab panel for stage scripts management |
| `ScriptActionEditor` | Individual script action form with code editor |
| `InlineCodeEditor` | Monaco wrapper with language selection |
| `ScriptResultsViewer` | Expandable stdout/stderr log viewer |
| `ScriptTestModal` | Modal for testing scripts with sample data |
| `ContextVariablesPanel` | Reference panel showing available env vars |

---

## 9. Security Architecture

### 9.1 Script Sandboxing (Leveraging Existing Infrastructure)

The existing `SandboxedScriptRunner` provides a solid foundation. Additional measures for user-provided scripts:

| Layer | Mechanism | Status |
|---|---|---|
| Command Allowlist | Only `node`, `python`, `sh`, `bash`, etc. | **Existing** |
| Injection Prevention | Regex for dangerous patterns | **Existing** |
| No Shell Mode | `shell: false` in spawn | **Existing** |
| Timeout Enforcement | SIGKILL after timeout | **Existing** |
| Output Limits | 1MB max stdout/stderr | **Existing** |
| Path Traversal | Workspace path validation | **Existing** (in HookExecutor's `executeFunction`) |
| Network Isolation | Restrict outbound network access | **NEW — Optional** |
| Resource Limits | CPU/memory limits via cgroups (Linux) | **NEW — Optional** |
| Script Size Limit | Max script content length | **NEW** |
| Rate Limiting | Max script executions per run | **NEW** |

### 9.2 New Security Measures for User Scripts

```typescript
// Script content validation before storage
function validateScriptContent(code: string, language: string): ValidationResult {
  // 1. Size limit: max 100KB
  if (code.length > 100 * 1024) return { valid: false, error: 'Script exceeds 100KB limit' };

  // 2. Language-specific dangerous pattern detection
  const dangerousPatterns: Record<string, RegExp[]> = {
    bash: [
      /rm\s+-rf\s+\//,           // rm -rf /
      /mkfs\./,                   // filesystem formatting
      /dd\s+if=/,                 // raw disk operations
      />\s*\/dev\//,              // writing to devices
    ],
    node: [
      /child_process/,            // Spawning additional processes
      /require\s*\(\s*['"]fs['"]\s*\)/,  // Direct fs access (use provided context instead)
      /process\.exit/,            // Direct process termination
    ],
    python: [
      /subprocess\./,             // Spawning additional processes
      /os\.system/,               // System calls
      /__import__/,               // Dynamic imports
    ],
  };

  // 3. No eval/exec in any language
  if (/\beval\b/.test(code)) return { valid: false, error: 'eval() is not allowed' };

  return { valid: true };
}
```

### 9.3 Environment Variable Isolation

```typescript
// Only expose declared inputs as env vars, plus standard context
function buildScriptEnvironment(
  action: ScriptAction,
  context: ScriptExecutionContext,
): Record<string, string> {
  const env: Record<string, string> = {
    // Standard context (always available)
    GENAI_WORKFLOW_RUN_ID: context.workflowRunId,
    GENAI_STAGE_RUN_ID: context.stageRunId ?? '',
    GENAI_STAGE_NAME: context.stageName ?? '',
    GENAI_WORKSPACE_PATH: context.workspacePath,

    // Prevent inheriting sensitive parent env vars
    // Only pass through PATH and essential system vars
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    TEMP: process.env.TEMP ?? os.tmpdir(),
    TMP: process.env.TMP ?? os.tmpdir(),
  };

  // Add user-declared inputs only
  for (const input of action.inputs) {
    const value = resolveInput(input, context);
    if (value !== undefined) {
      env[`GENAI_INPUT_${input.name}`] = String(value);
    }
  }

  return env;
}
```

---

## 10. Industry Best Practices & Design Inspiration

### 10.1 GitHub Actions Model
- **Expressions**: `${{ }}` syntax for dynamic values — we already have `{{variable}}` interpolation
- **Status check functions**: `success()`, `failure()`, `always()`, `cancelled()` — our DAG edge conditions cover this
- **Step outputs**: Steps can set outputs consumed by later steps — our `ScriptOutput` system mirrors this
- **Conditional execution**: `if: ${{ condition }}` — our `StageCondition.expression` type covers this

### 10.2 Temporal.io Activity Model
- **Deterministic workflows** with **non-deterministic activities** — our model is similar: workflows are deterministic DAGs, scripts are activities
- **Activity timeouts**: Schedule-to-close and start-to-close — we should support both
- **Retry policies with backoff**: Already have `RetryPolicy` with `backoffMultiplier`
- **Heartbeating**: Long-running activities send heartbeats — consider for long scripts
- **Cancellation scopes**: Nested cancellation propagation — our `AbortSignal` support covers basic cases

### 10.3 Prefect Model
- Decorator-based task definition (not applicable to our model)
- **Timeout enforcement**: `timeout_seconds` parameter — we have `timeoutMs`
- **Retry with configurable delay**: Matches our retry model
- **Task runners**: Thread pool vs process pool — relevant for our sandboxing discussion

### 10.4 Key Takeaways Applied to Our Design

| Best Practice | Our Implementation |
|---|---|
| Scripts are first-class citizens | `ScriptAction` entity with dedicated DB table, CRUD API |
| Declarative trigger configuration | `ScriptTrigger` type-safe union with clear semantics |
| Input/output contracts | `ScriptInput[]` and `ScriptOutput[]` with typed sources |
| Result capture and observability | `script_execution_results` table + SSE events |
| Failure isolation | `failurePolicy` per script: abort/skip/continue |
| Security sandboxing | Multi-layer: allowlist + injection prevention + timeout |
| Timeout and cancellation | `timeoutMs` + `AbortSignal` propagation |
| Retry with backoff | Existing `RetryPolicy` infrastructure |
| Testing before deployment | `testScript()` endpoint for dry runs |

---

## 11. File-by-File Implementation Guide

### Phase 1: Data Model & Storage (Foundation)

| # | File | Action | Description |
|---|---|---|---|
| 1 | `packages/db/src/schema.ts` | MODIFY | Add `scriptActions` and `scriptExecutionResults` tables |
| 2 | `packages/db/src/migrations/` | CREATE | New migration for script tables |
| 3 | `packages/shared/src/types/ScriptAction.ts` | CREATE | TypeScript interfaces: `ScriptAction`, `ScriptTrigger`, `ScriptSource`, `ScriptInput`, `ScriptOutput`, `ScriptExecutionResult` |
| 4 | `packages/shared/src/types/HookDefinition.ts` | MODIFY | Add `prerequisite` and `success_criteria` to `HookPhase` union |
| 5 | `packages/shared/src/types/index.ts` | MODIFY | Export new types |
| 6 | `packages/shared/src/schemas/scriptAction.ts` | CREATE | Zod validation schemas for API input |

### Phase 2: Repository Layer

| # | File | Action | Description |
|---|---|---|---|
| 7 | `packages/core/src/domain/ports/IScriptActionRepository.ts` | CREATE | Port interface for script action storage |
| 8 | `packages/core/src/domain/ports/IScriptExecutionResultRepository.ts` | CREATE | Port interface for execution results |
| 9 | `packages/db/src/repositories/DrizzleScriptActionRepository.ts` | CREATE | Drizzle implementation |
| 10 | `packages/db/src/repositories/DrizzleScriptExecutionResultRepository.ts` | CREATE | Drizzle implementation |

### Phase 3: Core Service

| # | File | Action | Description |
|---|---|---|---|
| 11 | `packages/core/src/services/ScriptActionService.ts` | CREATE | Main service: CRUD + execution + context building + hook conversion |
| 12 | `packages/core/src/services/ScriptContextBuilder.ts` | CREATE | Builds execution context from workflow/stage state |
| 13 | `packages/core/src/services/ResultValidator.ts` | MODIFY | Implement `custom_script` rule evaluation via SandboxedScriptRunner |
| 14 | `packages/core/src/services/StageExecutionService.ts` | MODIFY | Add prerequisite check + success criteria execution |
| 15 | `packages/core/src/services/WorkflowRunService.ts` | MODIFY | Load script actions during run setup |
| 16 | `packages/shared/src/types/AgentEvent.ts` | MODIFY | Add `script.started`, `script.completed`, `script.failed` event kinds |
| 17 | `packages/core/src/index.ts` | MODIFY | Export new services |

### Phase 4: API Routes

| # | File | Action | Description |
|---|---|---|---|
| 18 | `apps/server/src/routes/scriptActions.ts` | CREATE | REST endpoints for script action CRUD + test |
| 19 | `apps/server/src/routes/scriptResults.ts` | CREATE | REST endpoints for execution results |
| 20 | `apps/server/src/composition-root.ts` | MODIFY | Wire ScriptActionService into DI container |
| 21 | `apps/server/src/app.ts` | MODIFY | Mount new routes |
| 22 | `apps/cli/src/platform/composition-root.ts` | MODIFY | Wire ScriptActionService for CLI |

### Phase 5: Frontend

| # | File | Action | Description |
|---|---|---|---|
| 23 | `apps/web/src/hooks/scriptActionQueries.ts` | CREATE | React Query hooks for script action API |
| 24 | `apps/web/src/components/workflow/ScriptActionsTab.tsx` | CREATE | Tab panel for managing stage scripts |
| 25 | `apps/web/src/components/workflow/ScriptActionEditor.tsx` | CREATE | Individual script form + code editor |
| 26 | `apps/web/src/components/workflow/InlineCodeEditor.tsx` | CREATE | Monaco editor wrapper with lang selection |
| 27 | `apps/web/src/components/workflow/ScriptResultsViewer.tsx` | CREATE | Run results stdout/stderr viewer |
| 28 | `apps/web/src/components/workflow/StagePropertiesPanel.tsx` | MODIFY | Add "Scripts" tab |
| 29 | `apps/web/src/components/workflow/WorkflowRunStageCard.tsx` | MODIFY | Show script execution results inline |
| 30 | `apps/web/src/components/workflow/ContextVariablesPanel.tsx` | CREATE | Reference panel for available env vars |

### Phase 6: Testing

| # | File | Action | Description |
|---|---|---|---|
| 31 | `packages/core/__tests__/ScriptActionService.test.ts` | CREATE | Unit tests for script execution |
| 32 | `packages/core/__tests__/ResultValidator.custom-script.test.ts` | CREATE | Tests for custom_script validation |
| 33 | `packages/core/__tests__/StageExecutionService.prerequisites.test.ts` | CREATE | Tests for prerequisite gates |
| 34 | `apps/server/__tests__/scriptActions.routes.test.ts` | CREATE | API route tests |
| 35 | `agent-tests/workflow-scripts-e2e.spec.ts` | CREATE | E2E test for full script execution flow |

---

## 12. API Contract

### 12.1 Create Script Action

```
POST /workflow-definitions/:defId/script-actions
Content-Type: application/json

{
  "name": "Check Dependencies",
  "description": "Verify all required dependencies are installed",
  "language": "bash",
  "sourceType": "inline",
  "sourceCode": "#!/bin/bash\nnpm ls --production 2>/dev/null\nexit $?",
  "triggerType": "prerequisite",
  "triggerConfig": {},
  "stageDefinitionId": "stage-uuid-123",
  "timeoutMs": 30000,
  "retries": 1,
  "failurePolicy": "abort",
  "priority": 100,
  "inputs": [
    { "name": "PROJECT_DIR", "source": "variable", "key": "repo_path_frontend", "required": true }
  ],
  "outputs": [
    { "name": "dep_check_result", "extractFrom": "stdout" }
  ]
}

Response: 201 Created
{
  "id": "sa-uuid-456",
  ...allFields
}
```

### 12.2 Test Script (Dry Run)

```
POST /script-actions/test-inline
Content-Type: application/json

{
  "language": "node",
  "code": "const output = process.env.GENAI_INPUT_STAGE_OUTPUT;\nconsole.log(output?.includes('function') ? 'PASS' : 'FAIL');\nprocess.exit(output?.includes('function') ? 0 : 1);",
  "sampleInputs": {
    "STAGE_OUTPUT": "export function hello() { return 'world'; }"
  },
  "timeoutMs": 10000
}

Response: 200 OK
{
  "exitCode": 0,
  "stdout": "PASS",
  "stderr": "",
  "durationMs": 45,
  "passed": true
}
```

### 12.3 Get Script Execution Results

```
GET /workflow-runs/:runId/script-results

Response: 200 OK
[
  {
    "id": "result-uuid",
    "scriptActionId": "sa-uuid-456",
    "scriptActionName": "Check Dependencies",
    "workflowRunId": "run-uuid",
    "stageRunId": "stage-run-uuid",
    "triggerType": "prerequisite",
    "startedAt": "2026-03-16T10:00:00Z",
    "completedAt": "2026-03-16T10:00:01Z",
    "durationMs": 500,
    "exitCode": 0,
    "stdout": "All dependencies installed",
    "stderr": "",
    "passed": true,
    "extractedOutputs": { "dep_check_result": "All dependencies installed" }
  }
]
```

---

## 13. Testing Strategy

### 13.1 Unit Tests

| Test Area | What to Test |
|---|---|
| `ScriptActionService.executeScriptAction()` | Bash/Node/Python execution, timeout, cancellation, output extraction |
| `ScriptActionService.convertToHookDefinitions()` | All trigger type → hook phase mappings |
| `ScriptContextBuilder` | Environment variable construction, input resolution, temp file creation |
| `ResultValidator.custom_script` | Exit code interpretation, output passing, timeout handling, error capture |
| `ScriptAction validation` | Zod schema validation for all fields |
| `Security validation` | Dangerous pattern detection, size limits, path traversal prevention |

### 13.2 Integration Tests

| Test | Description |
|---|---|
| Prerequisite gate | Create workflow with prerequisite script → script passes → stage runs |
| Prerequisite block | Create workflow with prerequisite script → script fails → stage skipped |
| Success criteria pass | Stage runs → output validated by script → exit 0 → success |
| Success criteria fail | Stage runs → script returns exit 1 → stage marked failed |
| Script output injection | Script sets output → next stage accesses it via variable |
| Multi-language execution | Test bash, node, python scripts all work correctly |
| Timeout enforcement | Script exceeds timeout → killed → appropriate error |
| Failure policy skip | Script fails with policy=skip → workflow continues |

### 13.3 E2E Test Scenario

```typescript
// agent-tests/workflow-scripts-e2e.spec.ts
test('workflow with prerequisite and success criteria scripts', async () => {
  // 1. Create workflow definition with 2 stages
  // 2. Add prerequisite script to stage 1: check env variable exists
  // 3. Add success criteria to stage 1: output contains "function"
  // 4. Add post_stage script to stage 1: write summary to file
  // 5. Create run with variables
  // 6. Start run
  // 7. Verify: prerequisite passed, stage executed, criteria passed
  // 8. Check script execution results via API
  // 9. Verify output variable was set from script stdout
});
```

---

## 14. Migration & Backward Compatibility

### 14.1 Database Migration

- New tables only — no changes to existing tables
- Existing `HookDefinition[]` in `stageDefinitions.hooks` JSON column continues to work
- Script actions are an **additive layer** on top of the existing hook system

### 14.2 Backward Compatibility Strategy

| Concern | Strategy |
|---|---|
| Existing hook definitions | Continue to work as-is; ScriptActions are converted to HookDefinitions at runtime via `convertToHookDefinitions()` and merged |
| Existing templates | Template hooks continue to work; ScriptActions are optional additions |
| Hook priority ordering | ScriptActions have a `priority` field (default 100); template hooks have `priority` (default 50). Template hooks run first by default |
| `custom_script` validation type | Now implemented instead of returning `true` — technically a behavior change but previous behavior was non-functional |
| API versioning | New endpoints only, no changes to existing endpoints |

### 14.3 Merge Strategy: ScriptActions + Template Hooks

```typescript
// In StageExecutionService, when building hooks for a stage:
function getEffectiveHooks(
  templateHooks: HookDefinition[],
  scriptActions: ScriptAction[],
): HookDefinition[] {
  const convertedHooks = scriptActionService.convertToHookDefinitions(scriptActions);

  // Merge and sort by priority
  return [...templateHooks, ...convertedHooks]
    .sort((a, b) => a.priority - b.priority);
}
```

---

## Summary: Implementation Priority

### Wave 1 (MVP — Core Script Execution)
1. Data model (`ScriptAction` types + DB tables)
2. `ScriptActionService` with execute capability
3. Implement `custom_script` in `ResultValidator`
4. Prerequisite + success criteria integration in `StageExecutionService`
5. API routes for CRUD + test
6. Basic UI: Scripts tab in stage panel with inline code editor

### Wave 2 (Enhanced UX)
7. Script execution results storage + API
8. Run monitor showing script results
9. Context variables reference panel
10. Script templates / examples library
11. Multi-language support refinement

### Wave 3 (Advanced Features)
12. Script library (reusable across workflows)
13. Script versioning
14. Output variable injection across stages
15. Event-driven and periodic triggers
16. Enhanced security (optional container sandboxing)
