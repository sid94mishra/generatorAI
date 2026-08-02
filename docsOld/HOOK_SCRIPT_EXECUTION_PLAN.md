# Lifecycle Hook & Script Execution System — Comprehensive Plan

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Architecture Decision: Two-Tier Hook System](#3-architecture-decision-two-tier-hook-system)
4. [Complete Lifecycle Event Map](#4-complete-lifecycle-event-map)
5. [Hook File Format & Specification](#5-hook-file-format--specification)
6. [Implementation Plan](#6-implementation-plan)
7. [Scenarios & Examples](#7-scenarios--examples)
8. [UI Integration](#8-ui-integration)
9. [Security & Sandboxing](#9-security--sandboxing)
10. [Migration & Backward Compatibility](#10-migration--backward-compatibility)

---

## 1. Executive Summary

**Problem:** Users need to execute custom scripts at various lifecycle points during workflow execution — workflow start/complete, stage start/complete, agent events (tool use, message, error), and orchestration events (clone, commit, PR). Currently, hooks exist only at the **stage level** (per-`StageDefinition.hooks[]`), with only 14 of 22 defined hook phases actually wired. There are **no workflow-level hooks**, no hooks file upload, and the UI exposes only basic `pre_run`/`post_run` configuration.

**Solution:** Implement a **two-tier hook system** (inspired by OpenAI Agents SDK) with a clear separation:

| Tier | Scope | Purpose | Blocking? |
|------|-------|---------|-----------|
| **Workflow Hooks** | Entire run lifecycle | React to run start/complete/fail, orchestration events (clone, commit, PR), cross-stage coordination | Configurable |
| **Stage Hooks** | Per-stage execution | React to stage start/complete/fail, agent session events (tool use, messages, reasoning) | Configurable |

Users can provide hooks via:
1. **Hooks file** (`.hooks.json` or `.hooks.ts`) uploaded during workflow creation
2. **Inline configuration** in the workflow builder UI
3. **API** — programmatic hook registration

---

## 2. Current State Analysis

### What Works Today

| Component | Status | Details |
|-----------|--------|---------|
| `HookDefinition` type | ✅ Complete | 22 phases, 3 types (script/http/function), failure policies |
| `HookExecutor` | ✅ Robust | Timeout, retry, abort, subprocess isolation |
| `HookInterceptor` | ✅ Partial | Only wired for stage-level SDK events |
| `StageDefinition.hooks[]` | ✅ Works | Per-stage hook arrays stored in DB |
| Script execution pipeline | ✅ Complete | `HookExecutor → IScriptRunner → ISandboxProvider → child_process` |
| UI HookEditor | ⚠️ Basic | Only `pre_run`/`post_run`, limited config fields |
| Workflow-level hooks | ❌ Missing | `WorkflowDefinition` has no `hooks` field |
| Hooks file upload | ❌ Missing | No upload/import mechanism |
| 8 of 22 phases | ❌ Unwired | `pre_clone`, `post_clone`, `pre_commit`, `post_commit`, `post_prompt`, `on_error`, `on_cancel`, `on_permission` are defined but never invoked |

### Current Lifecycle Event Flow (with hook gaps marked)

```
┌─────────────────────────────────────────────────────────────────┐
│ WORKFLOW RUN LIFECYCLE                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ① workflow_run.orchestration_started                            │
│     ❌ NO HOOK: on_run_start                                     │
│                                                                  │
│  ② Worktree creation (git clone)                                 │
│     ❌ pre_clone defined but NEVER INVOKED                       │
│     ❌ post_clone defined but NEVER INVOKED                      │
│                                                                  │
│  ③ Preprocessing steps                                           │
│     ❌ NO HOOK: on_preprocessing_complete                        │
│                                                                  │
│  ④ Sandbox creation                                              │
│     ❌ NO HOOK: on_sandbox_ready                                 │
│                                                                  │
│  ⑤ DAG scheduling loop                                           │
│     For each stage:                                              │
│     ┌──────────────────────────────────────────────┐            │
│     │  STAGE LIFECYCLE                              │            │
│     │  ✅ pre_run hooks                              │            │
│     │  ✅ on_session_start hook (via HookBridge)     │            │
│     │  ✅ pre_prompt hook                            │            │
│     │  ✅ pre_tool_use / post_tool_use hooks         │            │
│     │  ✅ on_message / on_reasoning hooks            │            │
│     │  ✅ on_session_idle hook                       │            │
│     │  ✅ post_run hooks                             │            │
│     │  ❌ on_cancel NEVER INVOKED                    │            │
│     │  ❌ on_error NEVER INVOKED (on_session_error   │            │
│     │     is used instead)                           │            │
│     └──────────────────────────────────────────────┘            │
│                                                                  │
│  ⑥ Post-processing steps (auto-commit, auto-PR)                 │
│     ❌ pre_commit defined but NEVER INVOKED                      │
│     ❌ post_commit defined but NEVER INVOKED                     │
│     ❌ NO HOOK: on_pr_created                                    │
│                                                                  │
│  ⑦ workflow_run.completed / failed                               │
│     ❌ NO HOOK: on_run_complete / on_run_failed                  │
│                                                                  │
│  ⑧ Cleanup (sandbox, worktrees)                                  │
│     ❌ NO HOOK: on_cleanup_complete                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Architecture Decision: Two-Tier Hook System

### Why Two Tiers?

Based on research of modern agent frameworks (OpenAI Agents SDK, LangGraph, Temporal, Airflow), the consensus pattern is:

1. **Run-level hooks** — observe / react to the entire execution lifecycle
2. **Stage-level hooks** — observe / react to per-stage agent events

These must be **separate** because:
- A "deploy on workflow success" script should NOT be configured per-stage
- A "lint before tool commit" script should NOT run at workflow level
- Workflow hooks need the orchestrator context (repos, branches, PRs); stage hooks need the agent session context (messages, tools)
- Error handling differs: a failed workflow hook should not retry individual stages; a failed stage hook might skip that one stage

### Decision Matrix

| Pattern | Adopted | Reasoning |
|---------|---------|-----------|
| Two-tier (Run + Stage) | ✅ | OpenAI pattern — clean separation of concerns |
| Middleware `next()` chain | ❌ | Too complex for script hooks; great for in-process only |
| Guardrails vs Hooks split | ✅ Partial | Abort hooks = guardrails; continue hooks = observational |
| Hooks file import | ✅ | Airflow/Dagster pattern — allows version-controlled hooks |
| Decorator pattern | ❌ | CrewAI pattern — requires Python; we're config-driven |

### Proposed Type Hierarchy

```typescript
// ── NEW: Workflow-Level Hooks ──

export type WorkflowHookPhase =
  // Run lifecycle
  | 'on_run_start'          // After orchestration begins, before any stages
  | 'on_run_complete'       // All stages done, workflow succeeded
  | 'on_run_failed'         // Workflow entered failed state
  | 'on_run_cancelled'      // User cancelled the run
  // Git / SCM
  | 'pre_clone'             // Before worktree creation
  | 'post_clone'            // After worktree ready + feature branch checked out
  | 'pre_commit'            // Before auto-commit
  | 'post_commit'           // After auto-commit (SHA available)
  | 'on_pr_created'         // After auto-PR creation (PR URL available)
  // Orchestration
  | 'on_preprocessing_complete'  // All preprocessing steps done
  | 'on_postprocessing_start'    // Before postprocessing begins
  | 'on_all_stages_scheduled'    // DAG fully computed, all stages queued
  // Cross-stage coordination
  | 'on_stage_completed'    // Any stage just completed (workflow-level observer)
  | 'on_stage_failed'       // Any stage just failed (workflow-level observer)
  | 'on_parallel_join'      // Parallel fan-in point reached (all branches done)
  ;

// ── EXISTING (enhanced): Stage-Level Hooks ──

export type StageHookPhase =
  // Stage lifecycle
  | 'pre_run'               // Before stage starts (can abort)
  | 'post_run'              // After stage completes
  | 'on_error'              // Stage errored (can trigger retry)
  | 'on_cancel'             // Stage was cancelled
  | 'on_timeout'            // Stage hit timeout (NEW)
  // Agent session
  | 'on_session_start'      // SDK session created
  | 'on_session_idle'       // Agent finished a turn
  | 'on_session_error'      // SDK session errored
  // Agent interaction
  | 'pre_prompt'            // Before sending prompt to agent
  | 'post_prompt'           // After agent responds to prompt (NEW: wired)
  | 'pre_tool_use'          // Before tool execution (can deny)
  | 'post_tool_use'         // After tool execution
  | 'on_message'            // Agent produced a message
  | 'on_reasoning'          // Agent reasoning/thinking event
  // Permission & HITL
  | 'on_permission'         // Permission requested
  | 'on_awaiting_input'     // Stage entered HITL await (NEW)
  | 'on_input_received'     // HITL input received (NEW)
  ;
```

---

## 4. Complete Lifecycle Event Map

### Workflow Run Lifecycle — Hook Insertion Points

```
USER CREATES WORKFLOW RUN
  │
  ▼
① WorkflowRunService.startRun()
  │ emit: workflow_run.started
  │ 🪝 WORKFLOW HOOK: on_run_start
  │    Context: { runId, definitionId, variables, projectId }
  │
  ▼
② WorkflowOrchestrator.execute()
  │ emit: workflow_run.orchestration_started
  │
  ├─▶ Worktree Creation (for each git repo)
  │   │ 🪝 WORKFLOW HOOK: pre_clone
  │   │    Context: { repoAlias, repoUrl, branch }
  │   │    Abort: skip this repo (failurePolicy='abort' → fail run)
  │   │
  │   │ git worktree add / git clone
  │   │
  │   │ 🪝 WORKFLOW HOOK: post_clone
  │   │    Context: { repoAlias, localPath, branch, commitSha }
  │   │
  │
  ├─▶ Preprocessing Steps
  │   │ (existing: linting, file scanning, dependency install)
  │   │
  │   │ 🪝 WORKFLOW HOOK: on_preprocessing_complete
  │   │    Context: { results: PreprocessingResult[] }
  │   │
  │
  ├─▶ DAG Scheduling → Stage Execution (parallel)
  │   │
  │   │ 🪝 WORKFLOW HOOK: on_all_stages_scheduled
  │   │    Context: { stageCount, parallelGroups }
  │   │
  │   │ For each stage (see Stage Lifecycle below)
  │   │
  │   │ 🪝 WORKFLOW HOOK: on_stage_completed  (per stage)
  │   │    Context: { stageId, stageName, status, duration, outputData }
  │   │
  │   │ 🪝 WORKFLOW HOOK: on_stage_failed  (per stage)
  │   │    Context: { stageId, stageName, error, retryCount }
  │   │
  │   │ 🪝 WORKFLOW HOOK: on_parallel_join
  │   │    Context: { joinedStages: string[], nextStages: string[] }
  │   │
  │
  ├─▶ Post-Processing
  │   │ 🪝 WORKFLOW HOOK: on_postprocessing_start
  │   │
  │   │ Auto-commit (if configured)
  │   │ 🪝 WORKFLOW HOOK: pre_commit
  │   │    Context: { filePaths, commitMessage, repoPath }
  │   │    Abort: skip commit
  │   │
  │   │ 🪝 WORKFLOW HOOK: post_commit
  │   │    Context: { commitSha, filePaths, repoPath }
  │   │
  │   │ Auto-PR (if configured)
  │   │ 🪝 WORKFLOW HOOK: on_pr_created
  │   │    Context: { prUrl, prNumber, title, baseBranch, headBranch }
  │   │
  │
  ▼
③ Run Complete
  │ emit: workflow_run.completed
  │ 🪝 WORKFLOW HOOK: on_run_complete
  │    Context: { runId, duration, stageResults, artifactPaths }
  │
  │ OR
  │
  │ emit: workflow_run.failed
  │ 🪝 WORKFLOW HOOK: on_run_failed
  │    Context: { runId, error, failedStages, partialResults }
  │
  │ OR
  │
  │ emit: workflow_run.cancelled
  │ 🪝 WORKFLOW HOOK: on_run_cancelled
  │    Context: { runId, cancelledBy, completedStages }
```

### Stage Run Lifecycle — Hook Insertion Points

```
STAGE QUEUED BY DAG SCHEDULER
  │
  ▼
① StageExecutionService.executeStage()
  │ emit: stage_run.queued
  │
  │ 🪝 STAGE HOOK: pre_run  (BLOCKING — can abort)
  │    Context: { stageId, stageName, variables, workspacePath, predecessorOutputs }
  │
  ▼
② Session Allocation
  │ emit: stage_run.running
  │
  │ 🪝 STAGE HOOK: on_session_start
  │    Context: { sessionId, stageId, allocMode }
  │
  ▼
③ Prompt Execution Loop (for each prompt)
  │
  │ 🪝 STAGE HOOK: pre_prompt
  │    Context: { promptIndex, promptText, isFirstPrompt }
  │    Modify: can rewrite prompt text (input guardrail)
  │
  │ SDK conversation (Copilot SDK / Anthropic SDK)
  │ │
  │ ├─ Agent uses tool
  │ │  │ 🪝 STAGE HOOK: pre_tool_use  (BLOCKING — can deny)
  │ │  │    Context: { toolName, toolInput, sessionId }
  │ │  │
  │ │  │ tool executes...
  │ │  │
  │ │  │ 🪝 STAGE HOOK: post_tool_use
  │ │  │    Context: { toolName, toolInput, toolOutput, durationMs }
  │ │
  │ ├─ Agent produces message
  │ │  │ 🪝 STAGE HOOK: on_message
  │ │  │    Context: { content, role, tokenCount }
  │ │
  │ ├─ Agent reasoning/thinking
  │ │  │ 🪝 STAGE HOOK: on_reasoning
  │ │  │    Context: { text, isRedacted }
  │ │
  │ ├─ Agent idle (turn complete)
  │ │  │ 🪝 STAGE HOOK: on_session_idle
  │ │  │    Context: { turnIndex, totalTokens }
  │ │
  │ 🪝 STAGE HOOK: post_prompt  (NEW: wired)
  │    Context: { promptIndex, response, artifactsExtracted }
  │
  ▼
④ Output Validation + Summary
  │
  ▼
⑤ Stage Terminal State
  │
  │ IF completed:
  │   🪝 STAGE HOOK: post_run
  │      Context: { stageId, outputData, summary, artifacts, duration }
  │
  │ IF failed:
  │   🪝 STAGE HOOK: on_error
  │      Context: { stageId, error, retryCount, maxRetries }
  │      Action: can trigger retry or custom recovery
  │
  │ IF cancelled:
  │   🪝 STAGE HOOK: on_cancel
  │      Context: { stageId, cancelledBy }
  │
  │ IF timeout:
  │   🪝 STAGE HOOK: on_timeout  (NEW)
  │      Context: { stageId, timeoutMs, elapsedMs }
  │
  │ IF awaiting_input (HITL):
  │   🪝 STAGE HOOK: on_awaiting_input  (NEW)
  │      Context: { stageId, interruptType, interruptData }
  │
  │   (user provides input)
  │   🪝 STAGE HOOK: on_input_received  (NEW)
  │      Context: { stageId, inputData }
```

---

## 5. Hook File Format & Specification

### Option A: JSON Hooks File (`.hooks.json`)

Users can upload or reference a hooks configuration file during workflow creation. This file defines both workflow-level and stage-level hooks in a single declarative document.

```jsonc
{
  "$schema": "https://generatorai.dev/schemas/hooks-v1.json",
  "version": 1,
  
  // ── Workflow-Level Hooks ──
  "workflow": [
    {
      "name": "Notify Slack on Start",
      "phase": "on_run_start",
      "type": "http",
      "enabled": true,
      "failurePolicy": "continue",
      "timeoutMs": 10000,
      "config": {
        "type": "http",
        "url": "https://hooks.slack.com/services/T.../B.../xxx",
        "method": "POST",
        "headers": { "Content-Type": "application/json" },
        "bodyTemplate": "{\"text\": \"🚀 Workflow '{{workflow.name}}' started (Run: {{run.id}})\"}"
      }
    },
    {
      "name": "Run Tests After Commit",
      "phase": "post_commit",
      "type": "script",
      "enabled": true,
      "failurePolicy": "continue",
      "timeoutMs": 120000,
      "config": {
        "type": "script",
        "command": "npm",
        "args": ["test"],
        "cwd": "{{workspace.path}}"
      }
    },
    {
      "name": "Lint Check Before Commit",
      "phase": "pre_commit",
      "type": "script",
      "enabled": true,
      "failurePolicy": "abort",
      "timeoutMs": 60000,
      "config": {
        "type": "script",
        "command": "npx",
        "args": ["eslint", "--max-warnings=0", "."],
        "cwd": "{{workspace.path}}"
      }
    },
    {
      "name": "Deploy to Staging on Success",
      "phase": "on_run_complete",
      "type": "script",
      "enabled": true,
      "failurePolicy": "continue",
      "timeoutMs": 300000,
      "config": {
        "type": "script",
        "command": "bash",
        "args": ["./scripts/deploy-staging.sh"],
        "env": {
          "RUN_ID": "{{run.id}}",
          "BRANCH": "{{git.branch}}"
        }
      }
    }
  ],
  
  // ── Stage-Level Hooks (applied to ALL stages by default) ──
  "stages": {
    // Default hooks applied to every stage unless overridden
    "*": [
      {
        "name": "Log Tool Usage",
        "phase": "post_tool_use",
        "type": "http",
        "enabled": true,
        "failurePolicy": "continue",
        "timeoutMs": 5000,
        "config": {
          "type": "http",
          "url": "https://analytics.internal/tool-usage",
          "method": "POST",
          "bodyTemplate": "{\"tool\": \"{{tool.name}}\", \"stage\": \"{{stage.name}}\", \"duration\": {{tool.durationMs}}}"
        }
      }
    ],
    
    // Stage-specific hooks (by stage name)
    "Code Generation": [
      {
        "name": "Lint Before Completion",
        "phase": "post_run",
        "type": "script",
        "enabled": true,
        "failurePolicy": "continue",
        "timeoutMs": 60000,
        "config": {
          "type": "script",
          "command": "npx",
          "args": ["eslint", "--fix", "{{stage.outputFiles}}"]
        }
      }
    ],
    
    "Security Review": [
      {
        "name": "Block Dangerous Tools",
        "phase": "pre_tool_use",
        "type": "function",
        "enabled": true,
        "failurePolicy": "abort",
        "timeoutMs": 1000,
        "config": {
          "type": "function",
          "handlerName": "denyDangerousTools",
          "args": {
            "blockedTools": ["shell_execute", "file_delete", "git_push"]
          }
        }
      }
    ]
  }
}
```

### Option B: TypeScript Hooks File (`.hooks.ts`)

For advanced users who need programmatic logic:

```typescript
// hooks.ts — TypeScript hooks file
import type { HooksConfig, WorkflowHookContext, StageHookContext } from '@generatorai/shared';

export default {
  version: 1,
  
  workflow: [
    {
      name: 'Custom Validation',
      phase: 'on_run_complete',
      type: 'function',
      enabled: true,
      failurePolicy: 'continue',
      timeoutMs: 30000,
      config: {
        type: 'function',
        modulePath: './hooks/validate-output.ts',
      }
    }
  ],
  
  stages: {
    '*': [
      {
        name: 'Token Budget Guard',
        phase: 'on_message',
        type: 'function',
        enabled: true,
        failurePolicy: 'abort',
        timeoutMs: 1000,
        config: {
          type: 'function',
          handlerName: 'tokenBudgetGuard',
          args: { maxTokensPerStage: 50000 }
        }
      }
    ]
  }
} satisfies HooksConfig;
```

### Template Variable System

Hooks support template variables that are interpolated at execution time:

| Variable | Scope | Example Value |
|----------|-------|---------------|
| `{{run.id}}` | Workflow | `88994b17-ed69-...` |
| `{{run.status}}` | Workflow | `completed` |
| `{{workflow.name}}` | Workflow | `Pipeline E2E Test` |
| `{{workflow.id}}` | Workflow | `3aada389-babe-...` |
| `{{git.branch}}` | Workflow | `generatorai/run-1778599031185` |
| `{{git.commitSha}}` | After commit | `a1b2c3d...` |
| `{{workspace.path}}` | Both | `/tmp/generatorai/runs/xxx` |
| `{{stage.name}}` | Stage | `Code Generation` |
| `{{stage.id}}` | Stage | `2319132b-55bf-...` |
| `{{stage.status}}` | Stage | `completed` |
| `{{stage.outputData}}` | Stage | `{"endpoints": [...]}` |
| `{{stage.summary}}` | Stage | `Generated 5 API endpoints...` |
| `{{tool.name}}` | Stage (tool hooks) | `file_write` |
| `{{tool.durationMs}}` | Stage (tool hooks) | `1234` |
| `{{error.message}}` | Error hooks | `Timeout exceeded` |
| `{{var.XXXX}}` | Both | User-defined variable value |

---

## 6. Implementation Plan

### Phase 1: Wire Missing Stage Hooks (Week 1)

**Goal:** Activate the 8 unwired hook phases that are already defined.

#### 1.1 Wire `on_error` + `on_cancel` + `on_timeout` in StageExecutionService

**File:** `packages/core/src/services/StageExecutionService.ts`

```typescript
// In the catch block of executeStage():
catch (error) {
  // NEW: Fire on_error hook before transitioning to failed state
  await this.hookExecutor.executePhase('on_error', stageHooks, {
    ...hookContext,
    error: error instanceof Error ? error.message : String(error),
    retryCount: currentRetry,
    maxRetries: stageDef.retryPolicy?.maxRetries ?? 0,
  });
  // existing: transition to failed state
}

// In the cancellation handler:
if (abortSignal.aborted) {
  // NEW: Fire on_cancel hook
  await this.hookExecutor.executePhase('on_cancel', stageHooks, {
    ...hookContext,
    cancelledBy: 'user', // or 'timeout', 'parent_failed'
  });
}
```

#### 1.2 Wire `post_prompt` in StageExecutionService

**File:** `packages/core/src/services/StageExecutionService.ts`

After each prompt's SDK conversation completes, fire `post_prompt`:

```typescript
// After SDK turn completes for prompt[i]:
await this.hookExecutor.executePhase('post_prompt', stageHooks, {
  ...hookContext,
  promptIndex: i,
  responseContent: lastAssistantMessage?.content,
  artifactsExtracted: extractedArtifacts.length,
});
```

#### 1.3 Wire `on_permission` in HITL flow

**File:** `packages/core/src/services/StageExecutionService.ts` (HITL section)

```typescript
// When entering awaiting_input state:
await this.hookExecutor.executePhase('on_permission', stageHooks, {
  ...hookContext,
  interruptType: interrupt.type,
  interruptData: interrupt.data,
});
```

### Phase 2: Add Workflow-Level Hooks (Week 2)

#### 2.1 Extend Types

**File:** `packages/shared/src/types/HookDefinition.ts`

```typescript
// Add new export:
export type WorkflowHookPhase =
  | 'on_run_start'
  | 'on_run_complete'
  | 'on_run_failed'
  | 'on_run_cancelled'
  | 'pre_clone'
  | 'post_clone'
  | 'pre_commit'
  | 'post_commit'
  | 'on_pr_created'
  | 'on_preprocessing_complete'
  | 'on_postprocessing_start'
  | 'on_all_stages_scheduled'
  | 'on_stage_completed'
  | 'on_stage_failed'
  | 'on_parallel_join';

// New interface for workflow hooks (reuses HookDefinition shape):
export interface WorkflowHookDefinition {
  id: string;
  name: string;
  phase: WorkflowHookPhase;
  type: HookType;
  priority: number;
  enabled: boolean;
  failurePolicy: HookFailurePolicy;
  timeoutMs: number;
  retries: number;
  config: HookConfig;
}

// Hooks file schema:
export interface HooksFileConfig {
  version: 1;
  workflow: WorkflowHookDefinition[];
  stages: {
    '*'?: HookDefinition[];           // Default for all stages
    [stageName: string]: HookDefinition[];  // Per-stage overrides
  };
}
```

#### 2.2 Add `hooks` field to WorkflowDefinition

**File:** `packages/shared/src/types/WorkflowDefinition.ts`

```typescript
export interface WorkflowDefinition {
  // ... existing fields ...
  /** Workflow-level lifecycle hooks */
  hooks?: WorkflowHookDefinition[];
  /** Hooks file content (imported .hooks.json) */
  hooksFile?: HooksFileConfig;
}
```

#### 2.3 Add `workflow_hooks` column to DB

**File:** `packages/db/src/index.ts` (migrateDB)

```typescript
// Schema version 9:
addColumnIfNotExists('workflow_definitions', 'hooks', "text DEFAULT '[]'");
addColumnIfNotExists('workflow_definitions', 'hooks_file', "text DEFAULT NULL");
```

#### 2.4 Wire Workflow Hooks in WorkflowOrchestrator

**File:** `packages/core/src/services/WorkflowOrchestrator.ts`

```typescript
// Create a WorkflowHookExecutor that uses the same HookExecutor engine
// but with workflow-level context:

interface WorkflowHookContext {
  runId: string;
  definitionId: string;
  workspacePath: string;
  variables: Record<string, unknown>;
  gitRepos: Record<string, { localPath: string; branch: string; commitSha?: string }>;
  eventBus: EventBus;
  abortSignal?: AbortSignal;
}

// In WorkflowOrchestrator.execute():
async execute(params: OrchestratedRunParams): Promise<void> {
  const workflowHooks = definition.hooks ?? [];
  const hookCtx: WorkflowHookContext = { ... };
  
  // ① on_run_start
  await this.hookExecutor.executePhase('on_run_start', workflowHooks, hookCtx);
  
  // ② Worktree creation
  for (const repo of repos) {
    await this.hookExecutor.executePhase('pre_clone', workflowHooks, {
      ...hookCtx, repoAlias: repo.alias, repoUrl: repo.url,
    });
    
    await this.createWorktree(repo);
    
    await this.hookExecutor.executePhase('post_clone', workflowHooks, {
      ...hookCtx, repoAlias: repo.alias, localPath: repo.localPath,
    });
  }
  
  // ③ Preprocessing
  await this.runPreprocessing(ctx);
  await this.hookExecutor.executePhase('on_preprocessing_complete', workflowHooks, hookCtx);
  
  // ④ DAG execution...
  // (on_stage_completed / on_stage_failed fired by event listener)
  
  // ⑤ Post-processing
  await this.hookExecutor.executePhase('on_postprocessing_start', workflowHooks, hookCtx);
  
  if (config.autoCommit) {
    const canCommit = await this.hookExecutor.executePhase('pre_commit', workflowHooks, hookCtx);
    if (canCommit) {
      const sha = await this.commitChanges(ctx);
      await this.hookExecutor.executePhase('post_commit', workflowHooks, {
        ...hookCtx, commitSha: sha,
      });
    }
  }
  
  // ⑥ Completion
  await this.hookExecutor.executePhase('on_run_complete', workflowHooks, hookCtx);
}
```

### Phase 3: Hooks File Import & UI (Week 3)

#### 3.1 Hooks File Upload Endpoint

**File:** `apps/server/src/routes/workflowRoutes.ts`

```typescript
// POST /api/v2/workflow-definitions/:id/hooks-file
router.post('/:id/hooks-file', upload.single('hooksFile'), async (req, res) => {
  const content = req.file?.buffer.toString('utf-8');
  const parsed = validateHooksFile(content); // Zod validation
  await workflowDefService.updateHooksFile(req.params.id, parsed);
  res.json({ success: true, hookCount: parsed.workflow.length + Object.values(parsed.stages).flat().length });
});
```

#### 3.2 Hooks File Validation

**File:** `packages/shared/src/types/HookValidation.ts`

```typescript
import { z } from 'zod';

const hookConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('script'), command: z.string(), args: z.array(z.string()).optional(), cwd: z.string().optional(), env: z.record(z.string()).optional() }),
  z.object({ type: z.literal('http'), url: z.string().url(), method: z.enum(['GET', 'POST', 'PUT']), headers: z.record(z.string()).optional(), bodyTemplate: z.string().optional() }),
  z.object({ type: z.literal('function'), modulePath: z.string().optional(), handlerName: z.string().optional(), args: z.record(z.unknown()).optional() }),
]);

const hookBaseSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['script', 'http', 'function']),
  enabled: z.boolean().default(true),
  failurePolicy: z.enum(['abort', 'skip', 'continue']).default('continue'),
  timeoutMs: z.number().min(100).max(300000).default(30000),
  retries: z.number().min(0).max(10).default(0),
  priority: z.number().min(0).max(100).default(0),
  config: hookConfigSchema,
});

export const hooksFileSchema = z.object({
  version: z.literal(1),
  workflow: z.array(hookBaseSchema.extend({ phase: workflowHookPhaseSchema })).default([]),
  stages: z.record(z.array(hookBaseSchema.extend({ phase: stageHookPhaseSchema }))).default({}),
});
```

#### 3.3 Enhanced Hook Editor UI

**File:** `apps/web/src/components/workflow/HookEditor.tsx`

Expand the UI to support:
- All workflow-level phases (not just pre_run/post_run)
- Script args, cwd, env configuration
- HTTP method, headers, body template
- Hook file upload via drag-and-drop
- Visual hook timeline (shows hook insertion points on the DAG)

#### 3.4 Hooks File Merge Logic

When both inline hooks AND a hooks file exist, they merge with these rules:
1. Hooks file `stages.*` apply to all stages that don't have per-stage overrides
2. Per-stage hooks in the file are merged with inline `StageDefinition.hooks[]`
3. Inline hooks have higher priority (user explicitly configured > file imported)
4. Conflicts resolved by `priority` field (lower number = runs first)

```typescript
function resolveStageHooks(
  stageName: string,
  inlineHooks: HookDefinition[],
  hooksFile?: HooksFileConfig,
): HookDefinition[] {
  const fileDefault = hooksFile?.stages['*'] ?? [];
  const fileStageSpecific = hooksFile?.stages[stageName] ?? [];
  
  // Merge order: inline (highest) > stage-specific file > default file
  const all = [...fileDefault, ...fileStageSpecific, ...inlineHooks];
  
  // Deduplicate by name (last wins = inline wins)
  const byName = new Map<string, HookDefinition>();
  for (const hook of all) {
    byName.set(hook.name, hook);
  }
  
  // Sort by priority
  return [...byName.values()].sort((a, b) => a.priority - b.priority);
}
```

### Phase 4: New Stage Hook Phases (Week 3-4)

#### 4.1 Wire `on_timeout`

**File:** `packages/core/src/services/StageExecutionService.ts`

```typescript
// In the timeout handler:
if (isTimeoutError(error)) {
  await this.hookExecutor.executePhase('on_timeout', stageHooks, {
    ...hookContext,
    timeoutMs: stageDef.timeoutMs,
    elapsedMs: Date.now() - startTime,
  });
}
```

#### 4.2 Wire `on_awaiting_input` / `on_input_received`

**File:** `packages/core/src/services/StageExecutionService.ts`

```typescript
// When entering HITL await:
await this.hookExecutor.executePhase('on_awaiting_input', stageHooks, {
  ...hookContext,
  interruptType: interrupt.type,
});

// When HITL input received:
await this.hookExecutor.executePhase('on_input_received', stageHooks, {
  ...hookContext,
  inputData: userInput,
});
```

---

## 7. Scenarios & Examples

### Scenario 1: CI/CD Integration — Run Tests After Code Generation

**User goal:** After the "Code Generation" stage completes, run `npm test` in the workspace. If tests fail, the stage should be marked as failed.

**Configuration:**
```jsonc
{
  "stages": {
    "Code Generation": [
      {
        "name": "Run Unit Tests",
        "phase": "post_run",
        "type": "script",
        "failurePolicy": "abort",
        "timeoutMs": 120000,
        "config": {
          "type": "script",
          "command": "npm",
          "args": ["test"],
          "cwd": "{{workspace.path}}"
        }
      }
    ]
  }
}
```

**How it works:**
1. Code Generation stage completes → `post_run` hooks fire
2. HookExecutor spawns `npm test` with cwd = workspace path
3. If exit code ≠ 0, failurePolicy `abort` marks the stage as failed
4. DAG scheduler sees stage failure → routes through `on_failure` edges

---

### Scenario 2: Slack Notification on Workflow Events

**User goal:** Send Slack notifications when workflow starts, when any stage fails, and when the entire run completes.

**Configuration:**
```jsonc
{
  "workflow": [
    {
      "name": "Notify Start",
      "phase": "on_run_start",
      "type": "http",
      "failurePolicy": "continue",
      "config": {
        "type": "http",
        "url": "https://hooks.slack.com/services/...",
        "method": "POST",
        "bodyTemplate": "{\"text\":\"🚀 *{{workflow.name}}* started\\nRun: `{{run.id}}`\\nStages: {{run.stageCount}}\"}"
      }
    },
    {
      "name": "Notify Stage Failure",
      "phase": "on_stage_failed",
      "type": "http",
      "failurePolicy": "continue",
      "config": {
        "type": "http",
        "url": "https://hooks.slack.com/services/...",
        "method": "POST",
        "bodyTemplate": "{\"text\":\"❌ Stage *{{stage.name}}* failed\\nError: {{error.message}}\"}"
      }
    },
    {
      "name": "Notify Complete",
      "phase": "on_run_complete",
      "type": "http",
      "failurePolicy": "continue",
      "config": {
        "type": "http",
        "url": "https://hooks.slack.com/services/...",
        "method": "POST",
        "bodyTemplate": "{\"text\":\"✅ *{{workflow.name}}* completed in {{run.duration}}\"}"
      }
    }
  ]
}
```

---

### Scenario 3: Security Guardrail — Block Dangerous Tools

**User goal:** In the "Security Review" stage, block the agent from using `shell_execute`, `file_delete`, or `git_push` tools.

**Configuration:**
```jsonc
{
  "stages": {
    "Security Review": [
      {
        "name": "Block Dangerous Tools",
        "phase": "pre_tool_use",
        "type": "function",
        "failurePolicy": "abort",
        "timeoutMs": 100,
        "config": {
          "type": "function",
          "handlerName": "toolBlocklist",
          "args": {
            "blocked": ["shell_execute", "file_delete", "git_push"],
            "message": "Tool {{tool.name}} is blocked in Security Review stage"
          }
        }
      }
    ]
  }
}
```

**How it works:**
1. Agent requests tool use → `pre_tool_use` hook fires
2. Built-in `toolBlocklist` handler checks tool name against blocklist
3. If blocked: returns `false`, hook interceptor denies the tool call
4. Agent sees tool denied, adapts approach

---

### Scenario 4: Lint + Format Before Git Commit

**User goal:** Before auto-commit, run ESLint --fix and Prettier on all changed files. After commit, log the commit SHA to an audit endpoint.

**Configuration:**
```jsonc
{
  "workflow": [
    {
      "name": "Lint Changed Files",
      "phase": "pre_commit",
      "type": "script",
      "failurePolicy": "abort",
      "timeoutMs": 60000,
      "priority": 10,
      "config": {
        "type": "script",
        "command": "npx",
        "args": ["eslint", "--fix", "."],
        "cwd": "{{workspace.path}}"
      }
    },
    {
      "name": "Format Code",
      "phase": "pre_commit",
      "type": "script",
      "failurePolicy": "continue",
      "timeoutMs": 30000,
      "priority": 20,
      "config": {
        "type": "script",
        "command": "npx",
        "args": ["prettier", "--write", "."],
        "cwd": "{{workspace.path}}"
      }
    },
    {
      "name": "Audit Log Commit",
      "phase": "post_commit",
      "type": "http",
      "failurePolicy": "continue",
      "timeoutMs": 5000,
      "config": {
        "type": "http",
        "url": "https://audit.internal/commits",
        "method": "POST",
        "bodyTemplate": "{\"sha\":\"{{git.commitSha}}\",\"workflow\":\"{{workflow.name}}\",\"run\":\"{{run.id}}\"}"
      }
    }
  ]
}
```

---

### Scenario 5: Custom Data Enrichment via Script Before Stage

**User goal:** Before the "Code Generation" stage runs, execute a Python script that fetches the latest API schema from a remote service and saves it to the workspace. The agent then uses this file.

**Configuration:**
```jsonc
{
  "stages": {
    "Code Generation": [
      {
        "name": "Fetch Latest API Schema",
        "phase": "pre_run",
        "type": "script",
        "failurePolicy": "abort",
        "timeoutMs": 30000,
        "config": {
          "type": "script",
          "command": "python",
          "args": ["scripts/fetch-schema.py", "--output", "{{workspace.path}}/api-schema.json"],
          "env": {
            "API_KEY": "{{var.apiKey}}",
            "SCHEMA_URL": "{{var.schemaEndpoint}}"
          }
        }
      }
    ]
  }
}
```

---

### Scenario 6: Token Budget Guardrail (In-Process Function)

**User goal:** Enforce a maximum token budget per stage. If a stage exceeds 50,000 tokens, abort it.

**Configuration:**
```jsonc
{
  "stages": {
    "*": [
      {
        "name": "Token Budget Guard",
        "phase": "on_message",
        "type": "function",
        "failurePolicy": "abort",
        "timeoutMs": 100,
        "config": {
          "type": "function",
          "handlerName": "tokenBudgetGuard",
          "args": { "maxTokens": 50000 }
        }
      }
    ]
  }
}
```

**Built-in handler registration (server startup):**
```typescript
hookExecutor.registerFunctionHandler('tokenBudgetGuard', async (ctx) => {
  const usage = await eventRepo.getStageTokenUsage(ctx.stageId);
  if (usage > ctx.args.maxTokens) {
    throw new Error(`Token budget exceeded: ${usage}/${ctx.args.maxTokens}`);
  }
});
```

---

### Scenario 7: Parallel Stage Join — Aggregate Results

**User goal:** When both "API Design" and "Security Review" stages complete (parallel fan-in), run a validation script that checks both outputs are consistent before the "Final Report" stage starts.

**Configuration:**
```jsonc
{
  "workflow": [
    {
      "name": "Cross-Stage Validation",
      "phase": "on_parallel_join",
      "type": "script",
      "failurePolicy": "abort",
      "timeoutMs": 60000,
      "config": {
        "type": "script",
        "command": "node",
        "args": ["scripts/validate-api-security.js"],
        "env": {
          "API_OUTPUT": "{{stage.API Design.outputData}}",
          "SECURITY_OUTPUT": "{{stage.Security Review.outputData}}"
        }
      }
    }
  ]
}
```

---

### Scenario 8: HITL Approval Hook — Notify Manager

**User goal:** When a stage enters human-in-the-loop approval mode, send an email to the manager and log to an audit system.

**Configuration:**
```jsonc
{
  "stages": {
    "Production Deploy": [
      {
        "name": "Notify Manager for Approval",
        "phase": "on_awaiting_input",
        "type": "http",
        "failurePolicy": "continue",
        "timeoutMs": 10000,
        "config": {
          "type": "http",
          "url": "https://api.internal/approvals",
          "method": "POST",
          "bodyTemplate": "{\"stage\":\"{{stage.name}}\",\"run\":\"{{run.id}}\",\"approvalUrl\":\"{{app.baseUrl}}/workflows/{{workflow.id}}/runs/{{run.id}}\"}"
        }
      }
    ]
  }
}
```

---

## 8. UI Integration

### Workflow Builder — Hooks Tab

Add a new **"Hooks"** tab in the workflow builder (alongside existing tabs: Stages, Variables, Settings).

```
┌─────────────────────────────────────────────────────────────┐
│ Workflow Builder: Pipeline E2E Test                          │
├──────┬───────────┬──────────┬─────────┬────────────────────┤
│ DAG  │  Stages   │ Variables│ Settings│  🪝 Hooks          │
├──────┴───────────┴──────────┴─────────┴────────────────────┤
│                                                              │
│  ┌─ Upload Hooks File ─────────────────────────────┐         │
│  │  Drop .hooks.json or .hooks.ts here             │         │
│  └─────────────────────────────────────────────────┘         │
│                                                              │
│  ── Workflow Hooks ──────────────────────────────────        │
│                                                              │
│  [+ Add Workflow Hook]                                       │
│                                                              │
│  ┌─ on_run_start: Notify Slack ──────────────── ✅ ─┐       │
│  │  Type: HTTP POST → hooks.slack.com/...            │       │
│  │  Policy: continue | Timeout: 10s                  │       │
│  └───────────────────────────────────────────────────┘       │
│                                                              │
│  ┌─ pre_commit: ESLint Check ────────────────── ✅ ─┐       │
│  │  Type: Script → npx eslint --max-warnings=0 .    │       │
│  │  Policy: abort | Timeout: 60s                     │       │
│  └───────────────────────────────────────────────────┘       │
│                                                              │
│  ── Stage Hooks (Default: All Stages) ──────────────        │
│                                                              │
│  [+ Add Default Stage Hook]                                  │
│                                                              │
│  ┌─ post_tool_use: Log Analytics ────────────── ✅ ─┐       │
│  │  Type: HTTP POST → analytics.internal/...         │       │
│  │  Policy: continue | Timeout: 5s                   │       │
│  └───────────────────────────────────────────────────┘       │
│                                                              │
│  ── Stage-Specific Hooks ────────────────────────────        │
│  (Configure per-stage hooks in the stage properties panel)   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Hook Timeline Visualization

On the Workflow Run page, add a hook execution timeline showing when each hook fired, duration, and pass/fail:

```
Stage: Code Generation
┌────────────────────────────────────────────────────┐
│ pre_run  ███░ 200ms ✅                              │
│ session  ██████████████████████ 44s                  │
│ post_run ██████░ 3.2s ✅ (npm test)                 │
└────────────────────────────────────────────────────┘
```

---

## 9. Security & Sandboxing

### Script Execution Security

| Control | Implementation |
|---------|---------------|
| **Sandbox-first** | Script hooks route through `ISandboxProvider` → Docker MicroVM (preferred) or `HostProcessSandboxProvider` (fallback) |
| **Timeout enforcement** | Per-hook `AbortController` + `proc.kill('SIGKILL')` on timeout |
| **Resource limits** | Docker: CPU/memory limits. Host: `ulimit` on Unix, no limits on Windows |
| **Path traversal** | `HostProcessSandboxProvider` validates cwd is within workspace |
| **Env allowlist** | Only safe host env vars forwarded (PATH, HOME, NODE_PATH, etc.) |
| **No network for untrusted** | Docker sandbox can restrict network access |
| **Script content validation** | Reject scripts containing `rm -rf /`, `:(){ :|:& };:`, etc. (pattern blocklist) |
| **Function hook registry** | Only pre-registered names allowed — no arbitrary code execution via `handlerName` |

### HTTP Hook Security

| Control | Implementation |
|---------|---------------|
| **URL validation** | Reject `file://`, `ftp://`, localhost (unless explicitly allowed) |
| **Timeout** | HTTP requests time out per hook config |
| **No credential leak** | Template variables sanitize sensitive values |
| **TLS required** | Warn on `http://` URLs (allow with explicit override) |

---

## 10. Migration & Backward Compatibility

### DB Migration (Schema v9)

```sql
-- Add hooks column to workflow_definitions
ALTER TABLE workflow_definitions ADD COLUMN hooks TEXT DEFAULT '[]';
ALTER TABLE workflow_definitions ADD COLUMN hooks_file TEXT DEFAULT NULL;

-- Index for efficient hook lookup
-- (Not needed — hooks are loaded with the definition which is already cached)
```

### API Compatibility

- Existing `StageDefinition.hooks[]` continues to work unchanged
- New `WorkflowDefinition.hooks[]` is optional, defaults to empty
- Hooks file is additive — existing inline hooks are preserved
- All new hook phases are backward-compatible (no hooks = no-op)

### Phase -> System Mapping

After implementation, the hook system covers:

| Event Category | Before | After | Hook Phases |
|---------------|--------|-------|-------------|
| **Run lifecycle** | 0 hooks | 4 phases | `on_run_start`, `on_run_complete`, `on_run_failed`, `on_run_cancelled` |
| **Git/SCM** | 0 hooks | 5 phases | `pre_clone`, `post_clone`, `pre_commit`, `post_commit`, `on_pr_created` |
| **Orchestration** | 0 hooks | 3 phases | `on_preprocessing_complete`, `on_postprocessing_start`, `on_all_stages_scheduled` |
| **Cross-stage** | 0 hooks | 3 phases | `on_stage_completed`, `on_stage_failed`, `on_parallel_join` |
| **Stage lifecycle** | 2 hooks | 6 phases | `pre_run`, `post_run`, `on_error`, `on_cancel`, `on_timeout` (new), + existing |
| **Agent session** | 5 hooks | 5 phases | `on_session_start`, `on_session_idle`, `on_session_error`, + existing |
| **Agent interaction** | 4 hooks | 6 phases | `pre_prompt`, `post_prompt` (wired), `pre_tool_use`, `post_tool_use`, `on_message`, `on_reasoning` |
| **HITL** | 0 hooks | 3 phases | `on_permission`, `on_awaiting_input` (new), `on_input_received` (new) |
| **TOTAL** | **11 active** | **35 active** | From 14/22 → 35/35+ |

---

## Files Changed Summary

| Phase | Files | Changes |
|-------|-------|---------|
| Phase 1 | 2 files | Wire 8 unwired hooks in StageExecutionService |
| Phase 2 | 6 files | WorkflowHookDefinition type, WorkflowDefinition.hooks, DB migration, WorkflowOrchestrator wiring |
| Phase 3 | 5 files | Hooks file upload endpoint, Zod validation, HookEditor UI, merge logic |
| Phase 4 | 2 files | Wire on_timeout, on_awaiting_input, on_input_received |
| **Total** | **~15 files** | Types, DB, services, routes, UI |

---

## 11. Review Findings & Critical Fixes

> This section captures the output from independent code review against the actual codebase.

### CRITICAL FIX 1: HookContext Must Support Workflow Scope

`HookExecutor.executePhase()` currently requires `HookContext` with a mandatory `sessionId`. Workflow hooks fire before any session exists.

**Fix:** Create a separate `WorkflowHookContext` and overload `executePhase`:

```typescript
// In HookExecutor.ts — add overloaded signatures:
export interface WorkflowHookContext {
  runId: string;
  definitionId: string;
  workspacePath: string;
  variables: Record<string, unknown>;
  gitRepos?: Record<string, { localPath: string; branch: string; commitSha?: string }>;
  eventBus: EventBus;
  abortSignal?: AbortSignal;
}

// Make sessionId optional on stage context:
export interface HookContext {
  sessionId?: string;  // ← optional (was required)
  workflowId: string;
  workspacePath: string;
  variables: Record<string, string>;
  eventBus: EventBus;
  abortSignal?: AbortSignal;
}
```

### CRITICAL FIX 2: Script Template Variable Injection Prevention

When hook config contains template variables like `{{workspace.path}}` interpolated into script commands, the interpolated values must be shell-escaped to prevent command injection.

**Fix:**
```typescript
// In HookExecutor.ts → executeScript():
// Before spawning, sanitize interpolated values:
function sanitizeForShell(value: string): string {
  // Remove shell metacharacters: ; | & ` $ ( ) { } < > ! #
  return value.replace(/[;|&`$(){}!#<>\\]/g, '');
}

// Better: pass variables as environment variables (env is safe),
// not as interpolated command args:
const env = {
  ...safeHostEnv,
  ...Object.fromEntries(
    Object.entries(context.variables).map(([k, v]) => [`HOOK_VAR_${k}`, String(v)])
  ),
};
// Scripts access via $HOOK_VAR_xxx instead of {{var.xxx}} in args
```

### CRITICAL FIX 3: Hooks File Name Collision Deduplication

When merging hooks from file + inline, deduplicate by `hook.id`, not `hook.name`:

```typescript
function resolveStageHooks(
  stageName: string,
  inlineHooks: HookDefinition[],
  hooksFile?: HooksFileConfig,
): HookDefinition[] {
  const fileDefault = hooksFile?.stages['*'] ?? [];
  const fileStageSpecific = hooksFile?.stages[stageName] ?? [];
  
  // Merge with inline taking precedence
  const all = [...fileDefault, ...fileStageSpecific, ...inlineHooks];
  
  // Deduplicate by id (last occurrence wins = inline wins)
  const byId = new Map<string, HookDefinition>();
  for (const hook of all) byId.set(hook.id, hook);
  
  return [...byId.values()]
    .filter(h => h.enabled)
    .sort((a, b) => a.priority - b.priority);
}
```

### IMPORTANT: on_message Performance Warning

`on_message` hooks fire for EVERY LLM message. In a 4-stage diamond DAG with 2 prompts each:
- ~40 on_message fires per run
- If each HTTP hook takes 2s: 80s overhead (serialized)

**Mitigation:**
- Document that `on_message` hooks must be fast (<100ms) or use `failurePolicy: 'continue'`
- Recommend `on_session_idle` for batch analytics (fires once per turn, not per message)
- Consider adding an `async: true` flag to fire hooks without blocking the main loop

### DOCUMENTED LIMITATION: Automation System Hooks

The `AutomationService` (batch execution, scheduled triggers) is intentionally **out of scope** for Phase 1. Automation runs will inherit their workflow's hooks but don't have batch-specific hook phases like `on_batch_iteration_start`.

**Future Phase:** Add `on_automation_triggered`, `on_batch_iteration_start`, `on_batch_iteration_complete` to a new `AutomationHookPhase` type.

### DOCUMENTED LIMITATION: Iteration/Sub-Workflow Hooks

`IterationConfig` (loop-execute sub-workflows) doesn't have iteration-specific hooks. Each sub-workflow invocation will use its own definition's hooks.

**Future Phase:** Add `on_iteration_start`, `on_iteration_loop_complete`, `on_iteration_exit`.

### DOCUMENTED LIMITATION: Hooks Cannot Modify DAG Topology

Hooks are purely reactive (observe + side-effect). They **cannot** dynamically add/remove stages, alter edge conditions, or modify the DAG. DAG routing is controlled exclusively by stage status and edge conditions.

DAGScheduler caches DAGs by definitionId — this cache is not invalidated by hook execution.

---

## 12. Test Plan

| # | Scenario | Priority | Type |
|---|----------|----------|------|
| 1 | Script hook executes `echo` and receives exit code 0 | HIGH | Unit |
| 2 | Script hook timeout → SIGKILL → hook returns false | HIGH | Unit |
| 3 | HTTP hook sends POST with interpolated body | HIGH | Unit |
| 4 | `pre_run` hook with `abort` policy stops stage execution | HIGH | Integration |
| 5 | `pre_tool_use` hook denies tool → agent adapts | HIGH | Integration |
| 6 | Workflow `pre_commit` hook runs ESLint → abort on failure | HIGH | Integration |
| 7 | Hooks file JSON validates via Zod schema | HIGH | Unit |
| 8 | Invalid stage names in hooks file are silently skipped | MEDIUM | Unit |
| 9 | **Shell injection test** — malicious workspace path sanitized | CRITICAL | Security |
| 10 | Hook retry with exponential backoff (3 retries) | HIGH | Unit |
| 11 | Parallel stages fire `on_stage_completed` hooks concurrently | MEDIUM | Integration |
| 12 | Hook cancellation during workflow cancel | HIGH | Integration |
| 13 | `on_message` hook fires 50+ times, total overhead < 5s | MEDIUM | Performance |
| 14 | Hooks file merge: inline hook overrides file hook with same id | MEDIUM | Unit |
| 15 | Workflow hook `on_run_complete` receives correct stageResults | HIGH | Integration |
| 16 | `.hooks.json` upload via API → stored in DB → loaded at runtime | HIGH | E2E |
| 17 | In-process function handler registered + invoked correctly | HIGH | Unit |
| 18 | Large hooks file (>10MB) rejected at upload | MEDIUM | Validation |

---

## 13. Comparison with Modern Agent Frameworks

| Feature | GeneratorAI (After) | OpenAI Agents SDK | LangGraph | Temporal | Airflow |
|---------|---------------------|-------------------|-----------|----------|---------|
| Run-level hooks | ✅ 15 phases | ✅ 5 phases | ❌ (callbacks only) | ✅ Interceptors | ✅ Listeners |
| Stage-level hooks | ✅ 20 phases | ✅ 8 phases | ✅ 13 callbacks | N/A | ✅ Task callbacks |
| Script execution | ✅ Sandboxed subprocess | ❌ | ❌ | ❌ (code-only) | ✅ BashOperator |
| HTTP webhooks | ✅ Template-based | ❌ | ❌ | ❌ | ✅ HttpOperator |
| In-process functions | ✅ Registry-based | ✅ Class methods | ✅ Callback classes | ✅ Interceptor chain | ❌ |
| Can modify flow | ✅ Via failurePolicy:abort | ❌ (use Guardrails) | ❌ | ✅ Full wrap | ❌ |
| Hooks file import | ✅ .hooks.json | ❌ | ❌ | ❌ | ❌ |
| UI configuration | ✅ Builder + file upload | ❌ (code only) | ❌ | ❌ | ✅ (Airflow UI) |
| Variable interpolation | ✅ {{var.xxx}} templates | ❌ | ❌ | N/A | ✅ Jinja templates |
| **Total hook phases** | **35** | **13** | **13** | **~8** | **~10** |
