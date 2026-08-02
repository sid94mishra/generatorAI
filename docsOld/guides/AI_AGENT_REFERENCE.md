# GeneratorAI — AI Agent & LLM Reference

> **CONTEXT FOR AI AGENTS:** This document is a structured, machine-readable reference for GeneratorAI.  
> **SCAN THIS FIRST** — then deep-dive into specific sections as needed.  
> **Cross-references:** [USER_GUIDE.md](USER_GUIDE.md) (user guide) | [TECHNICAL_REFERENCE.md](TECHNICAL_REFERENCE.md) (developer guide)

---

## QUICK CONTEXT

**GeneratorAI** = AI workflow orchestration platform. Two modes:
1. **Chats** — Direct AI conversations (like ChatGPT)
2. **Workflows** — Multi-stage DAG pipelines where each stage sends prompts to GitHub Copilot

**Stack:** TypeScript monorepo. Express server + React web + Commander.js CLI + SQLite + Copilot SDK.

**Key insight for agents:** Everything is accessible via REST API at `http://localhost:3100/api`. Workflows are the primary automation primitive — create a definition, configure stages with prompts, add edges between them, then run.

---

## ENTITY MODEL (CRITICAL)

```
WorkflowDefinition (blueprint/template)
  ├── StageDefinition[] (DAG nodes — each has prompts[])
  ├── StageEdge[] (DAG connections — on_success/on_failure/on_completion/always)
  └── VariableDefinition[] (configurable params with {{interpolation}})

WorkflowRun (execution instance of a definition)
  ├── StageRun[] (one per StageDefinition)
  │   ├── status: pending → queued → running → completed|failed|skipped|cancelled
  │   ├── sessionId (Copilot conversation)
  │   ├── currentStep/totalSteps (prompt progress)
  │   └── summary (AI-generated completion summary)
  └── status: created → starting → running → completed|failed|cancelled

Chat (standalone AI conversation)
  ├── sessionId → Copilot session
  ├── messages[] (user/assistant/system/tool roles)
  └── status: active | archived
```

---

## API QUICK REFERENCE

### Base: `http://localhost:3100/api`

### Workflow Definition CRUD

```http
POST   /workflow-definitions                    # Create definition
GET    /workflow-definitions                    # List all
GET    /workflow-definitions/:id               # Get with stages + edges
PATCH  /workflow-definitions/:id               # Update
DELETE /workflow-definitions/:id               # Delete (cascade)

POST   /workflow-definitions/:id/stages         # Add stage
PUT    /workflow-definitions/:id/stages/:sid    # Update stage
DELETE /workflow-definitions/:id/stages/:sid    # Delete stage

POST   /workflow-definitions/:id/edges          # Add edge
DELETE /workflow-definitions/:id/edges/:eid     # Delete edge

POST   /workflow-definitions/:id/validate       # Validate DAG → 200 or 422
POST   /workflow-definitions/import             # From template ID
POST   /workflow-definitions/import-json        # From JSON body
GET    /workflow-definitions/:id/export         # Export as template JSON
```

### Workflow Run Lifecycle

```http
POST   /workflow-runs                          # Create run
GET    /workflow-runs                          # List (?status=&definitionId=)
GET    /workflow-runs/:id                      # Get run + stage runs
POST   /workflow-runs/:id/start               # Start execution → 202
POST   /workflow-runs/:id/pause               # Pause all stages
POST   /workflow-runs/:id/resume              # Resume paused
POST   /workflow-runs/:id/cancel              # Cancel all stages
DELETE /workflow-runs/:id                      # Delete run

GET    /workflow-runs/:id/stages              # List stage runs
POST   /workflow-runs/:rid/stages/:sid/pause  # Pause one stage
POST   /workflow-runs/:rid/stages/:sid/resume # Resume one stage
POST   /workflow-runs/:rid/stages/:sid/cancel # Cancel one stage
POST   /workflow-runs/:rid/stages/:sid/retry  # Retry failed stage
```

### Orchestrated Runs (with git clone + preprocessing)

```http
GET    /orchestrator/system-workflows           # List system templates
GET    /orchestrator/system-workflows/:id       # Get system template detail
POST   /orchestrator/from-template              # Create def from system template
POST   /orchestrator/runs                       # Start orchestrated run
GET    /orchestrator/runs/:id/context           # Get orchestration context
POST   /orchestrator/runs/:id/cancel           # Cancel orchestrated run
POST   /orchestrator/workflows/:id/uploads     # Upload files (workflow-level)
GET    /orchestrator/workflows/:id/files        # List workflow files
GET    /orchestrator/workflows/:id/files/download # Download workflow file
DELETE /orchestrator/workflows/:id/files        # Delete workflow file
POST   /orchestrator/runs/:id/uploads          # Upload files (run-level)
GET    /orchestrator/runs/:id/workspace         # Browse run workspace files
GET    /orchestrator/runs/:id/workspace/download # Download run workspace file
```

### Chat

```http
POST   /chats                                  # Create chat
GET    /chats                                  # List (?status=active|archived)
GET    /chats/:id                              # Get chat
DELETE /chats/:id                              # Archive chat
POST   /chats/:id/prompt                       # Send prompt (multipart/form-data)
GET    /chats/:id/messages                     # Message history
GET    /chats/:id/stream                       # SSE stream
```

### Streaming (SSE)

```http
GET    /events/stream                          # Multiplexed SSE (all sessions)
GET    /events/global                          # Global lifecycle events
GET    /sessions/:id/stream                    # Per-session SSE
GET    /sessions/:id/stream/events             # REST event replay (?afterSequence=N)
```

### Utilities

```http
GET    /templates                              # List templates (?category=)
GET    /templates/:id                          # Get template
GET    /health                                 # Health check
GET    /health/config                          # Server config
GET    /copilot/state                          # Copilot SDK status
GET    /sessions/:sid/artifacts                # List artifacts
GET    /artifacts/:id/download                 # Download artifact
```

---

## WORKFLOW CREATION — COMPLETE RECIPE

### Step 1: Create Definition

```http
POST /api/workflow-definitions
Content-Type: application/json

{
  "name": "My Code Generator",
  "description": "Generates a full-stack app from requirements",
  "sessionMode": "per-stage",
  "variables": [
    { "name": "requirements", "label": "Requirements", "type": "text", "required": true },
    { "name": "language", "label": "Language", "type": "string", "required": true, "default": "TypeScript" }
  ],
  "tags": ["code-generation"]
}
```

**Session modes:**
- `per-stage` — Each stage gets isolated Copilot conversation (best for parallelism)
- `single` — All stages share one conversation (best when context continuity matters)
- `auto` — System decides (treated as per-stage)

### Step 2: Add Stages

```http
POST /api/workflow-definitions/{defId}/stages
Content-Type: application/json

{
  "name": "Requirements Analysis",
  "prompts": [
    {
      "label": "Analyze Requirements",
      "text": "Analyze these requirements and create a detailed technical specification:\n\n{{requirements}}\n\nLanguage: {{language}}",
      "waitForCompletion": true
    }
  ],
  "order": 0
}
```

```http
POST /api/workflow-definitions/{defId}/stages
{
  "name": "Code Generation",
  "prompts": [
    {
      "label": "Generate Code",
      "text": "Based on the analysis, generate the complete codebase. Use {{language}}. Follow clean architecture principles.",
      "waitForCompletion": true
    }
  ],
  "order": 1
}
```

```http
POST /api/workflow-definitions/{defId}/stages
{
  "name": "Test Generation",
  "prompts": [
    {
      "label": "Generate Tests",
      "text": "Generate comprehensive unit and integration tests for the generated code.",
      "waitForCompletion": true
    }
  ],
  "order": 2
}
```

### Step 3: Add Edges (Connect Stages)

```http
POST /api/workflow-definitions/{defId}/edges
{ "fromStageId": "{stage1Id}", "toStageId": "{stage2Id}", "edgeType": "on_success" }

POST /api/workflow-definitions/{defId}/edges
{ "fromStageId": "{stage2Id}", "toStageId": "{stage3Id}", "edgeType": "on_success" }
```

**Edge types:** `on_success`, `on_failure`, `on_completion`, `always`

### Step 4: Validate

```http
POST /api/workflow-definitions/{defId}/validate
# Returns: { "valid": true } or { "valid": false, "errors": ["Cycle detected..."] }
```

### Step 5: Create and Start Run

```http
POST /api/workflow-runs
{
  "workflowDefinitionId": "{defId}",
  "variables": {
    "requirements": "Build a full-stack todo application with React frontend and Express backend",
    "language": "TypeScript"
  }
}
# Returns run with ID

POST /api/workflow-runs/{runId}/start
# Returns 202 (async)
```

### Step 6: Monitor

```http
# Poll for status
GET /api/workflow-runs/{runId}
# Returns: { status, stageRuns: [{ name, status, currentStep, totalSteps, summary }] }

# Stream real-time events
GET /api/events/stream
# SSE stream with all events
```

### Step 7: Get Results

```http
# Check completed run
GET /api/workflow-runs/{runId}
# stageRuns[].summary = what each stage produced

# Browse workspace files
GET /api/orchestrator/runs/{runId}/workspace
# Returns file tree of generated code

# Download specific file from workspace
GET /api/orchestrator/runs/{runId}/workspace/download?path=src/index.ts

# Get artifacts
GET /api/sessions/{stageSessionId}/artifacts
# Returns file list with download URLs

# Download artifact
GET /api/artifacts/{artifactId}/download
```

---

## USING SYSTEM TEMPLATES — FASTEST PATH

```http
# List available system templates
GET /api/orchestrator/system-workflows

# Create definition from template
POST /api/orchestrator/from-template
{
  "templateId": "system-code-generation",
  "name": "Generate My App",
  "variables": {
    "requirements": "Build a todo app with React and Express",
    "language": "TypeScript",
    "framework": "React + Express",
    "coding_style": "Clean Architecture"
  }
}
# Returns: definition with pre-configured 4-stage pipeline

# Start orchestrated run (with optional git clone)
POST /api/orchestrator/runs
{
  "workflowDefinitionId": "{defId}",
  "variables": {
    "requirements": "Build a todo app",
    "language": "TypeScript"
  },
  "gitRepositories": [
    { "url": "https://github.com/user/repo.git", "alias": "existing", "branch": "main" }
  ]
}
```

### Available System Templates

| ID | Name | Stages | Required Variables |
|---|---|---|---|
| `system-code-generation` | Code Generation | 4 | `requirements` (text), `language` (choice) |
| `system-code-review` | Code Review | 4 | `git_url`, `review_focus` (text), `language` (choice) |
| `system-e2e-testing` | E2E Testing | 4 | `target_url`, `test_scenarios` (text) |
| `system-test-generation` | Test Generation | 4 | `git_url`, `language` (choice) |
| `system-refactoring` | Refactoring | 4 | `git_url`, `refactoring_focus` (text), `refactoring_approach` (choice) |

---

## STAGE CONFIGURATION OPTIONS

```typescript
StageDefinition {
  name: string                           // Required
  prompts: [{                            // Required (at least 1)
    label: string
    text: string                         // Supports {{variable}} interpolation
    waitForCompletion: boolean           // true = wait for AI response
    attachments?: string[]               // File paths
  }]
  order: number                          // Position in definition (auto-assigned)
  condition?: {                          // When to execute
    type: 'always' | 'on_success' | 'on_failure' | 'expression'
    expression?: string                  // e.g., "status == 'completed'"
  }
  copilotConfigOverrides?: {             // Override AI config for this stage
    model?: string                       // e.g., "gpt-4.1"
    systemMessage?: string
    tools?: string[]
  }
  variables?: Record<string, unknown>    // Stage-specific variable values
  retryPolicy?: {                        // Auto-retry on failure
    maxRetries: number                   // Default: 0
    backoffMs: number                    // Initial backoff (ms)
    backoffMultiplier: number            // Multiplier per retry
  }
  timeoutMs?: number                     // Stage execution timeout
  hooks?: HookDefinition[]               // Lifecycle hooks
}
```

---

## EDGE TYPES EXPLAINED

```
A ──on_success──► B     # B runs ONLY if A completes successfully
A ──on_failure──► C     # C runs ONLY if A fails
A ──on_completion──► D  # D runs when A finishes (success OR failure)
A ──always──► E         # E always runs after A
```

**DAG patterns:**
```
Linear:     A → B → C → D
Diamond:    A → [B, C] → D  (B and C run in parallel)
Fan-out:    A → [B, C, D]   (all run in parallel after A)
Fan-in:     [A, B, C] → D   (D waits for all)
Error path: A ──on_failure──► ErrorHandler
```

---

## STATE MACHINES

### WorkflowRun States
```
created ──start──► starting ──ready──► running ──done──► completed
                                     ──error──► failed
                             running ◄──resume── paused
                             running ──pause──► paused
                             running ──cancel──► cancelling ──done──► cancelled
```

### StageRun States
```
pending ──schedule──► queued ──session_ready──► running ──done──► completed
                                              ──error──► failed
                                              ──retry──► queued (reset)
                                     running ◄──resume── paused
                                     running ──pause──► paused
                                     pending ──skip──► skipped
                                     * ──cancel──► cancelled
```

---

## EVENT SYSTEM

### Key Event Types (for SSE consumers)

| Event | When | Data |
|---|---|---|
| `workflow_run.created` | Run created | { runId, definitionId } |
| `workflow_run.starting` | DAG being built | { runId } |
| `workflow_run.running` | Execution started | { runId } |
| `workflow_run.completed` | All stages done | { runId } |
| `workflow_run.failed` | Run failed | { runId, error } |
| `stage_run.queued` | Stage ready to execute | { stageRunId, stageName } |
| `stage_run.running` | Stage executing | { stageRunId, sessionId } |
| `stage_run.step_started` | Prompt being sent | { stageRunId, stepIndex } |
| `stage_run.completed` | Stage done | { stageRunId, summary } |
| `stage_run.failed` | Stage failed | { stageRunId, error } |
| `stage_run.skipped` | Stage skipped | { stageRunId, reason } |
| `copilot.token` | AI token received | { token, sessionId } |
| `copilot.message_complete` | AI response done | { content, sessionId } |
| `copilot.tool_start` | Tool invoked | { toolName, args } |
| `copilot.tool_complete` | Tool finished | { toolName, result } |

### SSE Connection

```javascript
// Multiplexed stream (recommended for agents)
const evtSource = new EventSource('/api/events/stream');
evtSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // data.kind = event type
  // data.context.type = 'workflow_run' | 'stage_run' | 'chat' | 'copilot'
  // data.context.id = entity ID
};
```

---

## EXECUTION FLOW — COMPLETE SEQUENCE

```
1. CREATE: POST /workflow-definitions → definition ID
2. STAGES: POST /workflow-definitions/{id}/stages (repeat per stage)
3. EDGES:  POST /workflow-definitions/{id}/edges (connect stages)
4. VALIDATE: POST /workflow-definitions/{id}/validate → { valid: true }
5. RUN:    POST /workflow-runs { definitionId, variables }
6. START:  POST /workflow-runs/{id}/start → 202
7. MONITOR: GET /workflow-runs/{id} (poll) or GET /events/stream (SSE)
8. WAIT:   Poll until run.status === 'completed' | 'failed'
9. RESULTS: 
   a. GET /workflow-runs/{id} → stageRuns[].summary
   b. GET /sessions/{sessionId}/artifacts → file list
   c. GET /artifacts/{id}/download → file content
```

**Shortcut with orchestrator + template:**
```
1. POST /orchestrator/from-template { templateId, variables } → definition
2. POST /orchestrator/runs { definitionId, variables, gitRepositories } → starts immediately
3. Monitor and collect results as above
```

---

## FILE OUTPUT STRUCTURE

```
~/.generatorai/artifacts/runs/{runId}/
├── workspace/          ← CODE FILES (primary output)
│   └── (generated source code, preserving directory structure)
├── artifacts/          ← RESPONSE DOCS
│   └── stage_response_N.md (full AI responses per stage)
└── uploads/            ← USER INPUT FILES
    └── (uploaded files referenced by variables)
```

---

## VARIABLE INTERPOLATION

Variables in prompts use `{{variableName}}` syntax:

```
"Analyze the {{language}} codebase at {{repo_path}} focusing on {{focus_area}}"
```

**Resolution order (3-level merge):**
1. Workflow-level variables (definition defaults)
2. Stage-level variables (per-stage overrides)
3. Runtime variables (provided at run creation)

**Special auto-set variables:**
- `__workingDirectory` — Run workspace path (absolute)
- `__artifactsDirectory` — Run artifacts path (absolute)
- `repo_path_{alias}` — Cloned repo absolute path (set by preprocessing when `gitRepositories` provided)
- `repo_subdir_{alias}` — Repo subdirectory (if specified in git config)

**How repo variables are injected:**
When orchestrated runs clone git repositories, preprocessing automatically creates `repo_path_{alias}` and `repo_subdir_{alias}` variables. System templates like Code Review reference these as `{{repo_path_target}}` where `target` is the git repository alias.

---

## CONFIGURATION — ENVIRONMENT VARIABLES

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3100 | Server port |
| `DB_PATH` | `packages/db/data/generatorai.db` | SQLite path |
| `ARTIFACTS_DIR` | `~/.generatorai/artifacts` | Output storage |
| `TEMPLATES_DIR` | `./templates` | Template directory |
| `COPILOT_MODEL` | `gpt-4.1` | Default AI model |
| `MAX_CONCURRENT_SESSIONS` | 10 | Copilot session limit |

---

## ARCHITECTURE — PACKAGE MAP

```
packages/shared    → Types, errors, constants (no deps)
packages/db        → SQLite + Drizzle ORM (depends: shared)
packages/streaming → SSE transport (depends: shared)
packages/copilot-bridge → Copilot SDK adapter (depends: shared)
packages/core      → Business logic engine (depends: all packages above)
apps/server        → Express API + SSE endpoints (depends: core)
apps/web           → React SPA (talks to server via HTTP)
apps/cli           → Commander.js + Ink CLI (depends: core, direct in-process)
```

---

## CODEBASE KEY FILES

| What | File |
|---|---|
| **Workflow orchestration** | `packages/core/src/services/WorkflowOrchestrator.ts` |
| **Run lifecycle** | `packages/core/src/services/WorkflowRunService.ts` |
| **Stage execution** | `packages/core/src/services/StageExecutionService.ts` |
| **DAG scheduling** | `packages/core/src/services/DAGScheduler.ts` |
| **DAG validation** | `packages/core/src/domain/dag/DAGValidator.ts` |
| **Session allocation** | `packages/core/src/services/SessionAllocator.ts` |
| **Config merge** | `packages/core/src/services/ConfigResolver.ts` |
| **Chat service** | `packages/core/src/services/ChatManagementService.ts` |
| **Event bus** | `packages/core/src/events/EventBus.ts` |
| **DB schema** | `packages/db/src/schema.ts` |
| **API DI container** | `apps/server/src/composition-root.ts` |
| **API routes** | `apps/server/src/routes/*.ts` |
| **Web app entry** | `apps/web/src/App.tsx` |
| **SSE manager (client)** | `apps/web/src/stores/sseManager.ts` |
| **Workflow builder store** | `apps/web/src/stores/workflowBuilderStore.ts` |
| **Run monitoring store** | `apps/web/src/stores/workflowRunStore.ts` |
| **System templates** | `templates/system/*.json` |

---

## CHAT QUICK REFERENCE

```http
# Create chat
POST /api/chats
{ "name": "My Chat" }

# Send message
POST /api/chats/{id}/prompt
Content-Type: multipart/form-data
prompt=Hello, help me build a REST API

# Get history
GET /api/chats/{id}/messages

# Stream responses (SSE)
GET /api/chats/{id}/stream
```

**Chat message metadata includes:**
- `thinkingText` — AI reasoning process
- `toolCalls[]` — Tools used { name, args, result }
- `systemMessages[]` — Sub-agent / system messages

---

## ERROR CODES

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid input |
| `NOT_FOUND` | 404 | Resource not found |
| `INVALID_TRANSITION` | 409 | Illegal state change |
| `DAG_VALIDATION_ERROR` | 422 | DAG has cycles/orphans |
| `SESSION_ALLOCATION_ERROR` | 503 | No sessions available |

Error response format:
```json
{ "error": { "code": "...", "category": "...", "message": "...", "recoverable": true } }
```

---

## SYSTEM LIMITS

| Limit | Value |
|---|---|
| Max stages per workflow | 50 |
| Max edges per workflow | 200 |
| Max file upload size | 10 MB |
| Max files per upload | 20 |
| Max concurrent sessions | 10 (configurable) |
| SSE replay buffer | 2000 events |
| Default AI timeout | 120 seconds |

---

*For detailed usage instructions, see [USER_GUIDE.md](USER_GUIDE.md). For development guide, see [TECHNICAL_REFERENCE.md](TECHNICAL_REFERENCE.md).*
