# Unified Workspace Management — Implementation Plan

> **End-to-end workspace isolation, path resolution, and artifact tracking for Chat, Workflow, and Automation execution in GeneratorAI.**

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Gap Analysis](#3-gap-analysis)
4. [Modern Agent Workspace Patterns (Industry Research)](#4-modern-agent-workspace-patterns)
5. [Architecture Design](#5-architecture-design)
6. [Filesystem Structure](#6-filesystem-structure)
7. [Database Schema Changes](#7-database-schema-changes)
8. [Service Layer Changes](#8-service-layer-changes)
9. [Execution Scenarios (End-to-End)](#9-execution-scenarios)
10. [API Changes](#10-api-changes)
11. [Migration Strategy](#11-migration-strategy)
12. [Security Considerations](#12-security-considerations)
13. [Implementation Phases](#13-implementation-phases)
14. [File-by-File Change Map](#14-file-by-file-change-map)
15. [Parallel Stage Handling &amp; Concurrency](#15-parallel-stage-handling--concurrency)
16. [Event System Integration](#16-event-system-integration)
17. [Platform Client Parity (CLI DirectMode)](#17-platform-client-parity-cli-directmode)
18. [Workspace Idempotency &amp; Reentrance](#18-workspace-idempotency--reentrance)
19. [Disk Quota Enforcement](#19-disk-quota-enforcement)
20. [Symlink Escape Prevention](#20-symlink-escape-prevention)
21. [Migration Transition Plan](#21-migration-transition-plan)

---

## 1. Executive Summary

### Problem Statement

GeneratorAI currently has **fragmented workspace management** across Chat, Workflow, and Automation execution modes. Each mode uses slightly different path resolution, artifact storage, and worktree management patterns. Key gaps include:

- No unified per-execution workspace created for all execution modes
- Chat sessions without `useWorktree: true` get no filesystem context
- Worktrees created INSIDE project dirs (`projects/<id>/worktrees/`) rather than inside per-execution workspaces
- No DB tracking of worktree ↔ execution mapping for informed cleanup decisions
- Artifacts keyed by session ID rather than by execution entity (chat/run)
- Agent has unrestricted file access outside the workspace
- No snapshot/persistence of workspace state for reproducibility
- Automation data-source scripts lack workspace scoping

### Solution Summary

Introduce a **Unified Workspace Manager** that:

1. Creates a **dedicated, self-contained workspace directory** for every execution (chat session, workflow run, automation execution)
2. Places **all worktrees INSIDE** the execution workspace (not the project directory)
3. Enforces **filesystem boundary** — agent SDK sessions are constrained to the workspace root
4. Tracks **every workspace and its worktrees** in a new `execution_workspaces` table with full metadata (owner type, owner ID, project linkage, worktree details, git branch info)
5. Provides **git-backed artifact tracking** — automatic `git init` inside workspace for change tracking
6. Supports **volume-mount readiness** — workspace directory is the single mount point for future sandbox/Docker isolation
7. Handles **all artifacts (code, markdown, scripts, uploads) inside the workspace** under well-known subdirectories

---

## 2. Current State Analysis

### 2.1 Base Directory Resolution

| Source     | Server Default                      | CLI Default                  | Override                              |
| ---------- | ----------------------------------- | ---------------------------- | ------------------------------------- |
| Database   | `packages/db/data/generatorai.db` | `~/.generatorai/data.db`   | `DB_PATH` / `GENERATORAI_DB_PATH` |
| Workspaces | `~/.generatorai/workspaces`       | same                         | `WORKSPACES_DIR`                    |
| Artifacts  | `~/.generatorai/artifacts`        | same                         | `ARTIFACTS_DIR`                     |
| Templates  | `./templates` (project root)      | `~/.generatorai/templates` | `TEMPLATES_DIR`                     |

### 2.2 Current Chat Working Directory Flow

```
ChatManagementService.createChat(projectId?, codebaseIds?)
  ├─ If projectId + codebaseIds:
  │   ├─ WorktreeService.createRunWorktrees(projectId, chatId, codebaseIds, 'manual')
  │   │   └─ Creates: <projectRoot>/worktrees/<chatId>/<alias>/
  │   └─ Sets conversationConfig.workingDirectory = first worktree path
  ├─ If no project:
  │   └─ No filesystem context (SDK has no workingDirectory)
  └─ Artifacts stored at: <artifactsDir>/<sessionId>/<artifactId>-<filename>
```

**Issues:**

- No workspace created unless project is linked
- Worktrees inside project dir, not execution-scoped
- `archiveChat()` doesn't clean up worktrees (orphaned)
- No boundary enforcement — agent can write anywhere

### 2.3 Current Workflow Working Directory Flow

```
WorkflowRunService.startRun(runId)
  ├─ Create: <artifactsDir>/runs/<runId>/workspace/
  ├─ Create: <artifactsDir>/runs/<runId>/artifacts/
  ├─ Store as system variables: __workingDirectory, __artifactsDirectory
  ├─ If projectId:
  │   ├─ WorktreeService.createRunWorktrees(projectId, runId, aliases, 'workflow')
  │   │   └─ Creates: <projectRoot>/worktrees/<runId>/<alias>/
  │   └─ Override __workingDirectory = first worktree path
  └─ StageExecutionService:
      ├─ Code blocks → __workingDirectory/<filename>
      └─ Response markdown → __artifactsDirectory/<stage>_response.md
```

**Issues:**

- Two locations diverge: `artifacts/runs/<runId>/workspace/` vs `<project>/worktrees/<runId>/`
- When project worktrees are used, the `artifacts/runs/<runId>/workspace/` directory goes unused
- No git tracking of generated artifacts
- Stage-to-stage handoff relies only on shared directory (no explicit manifest)

### 2.4 Current Automation Working Directory Flow

```
AutomationService.runSingleWorkflow(iteration)
  ├─ Creates a WorkflowRun per iteration
  ├─ Each WorkflowRun → same flow as §2.3
  └─ Per-iteration isolation via separate runId
```

**Issues:**

- Data-source scripts execute with `process.cwd()` as working directory
- No scoped workspace for data-source output staging
- Batch/loop iterations don't share intermediate results

### 2.5 System & Project Artifacts

```
System Level:   <templatesDir>/system/artifacts/{agents,prompts,skills}/
Project Level:  <projectRoot>/config/{agents,prompts,skills,mcp}s/
```

These are **read at runtime** and injected into SDK sessions — no issues with their storage. The gap is how they're **carried into execution workspaces**.

---

## 3. Gap Analysis

| #   | Gap                                                        | Impact                                               | Priority |
| --- | ---------------------------------------------------------- | ---------------------------------------------------- | -------- |
| G1  | No workspace created for chats without project             | Chat artifacts go to flat `artifacts/<sessionId>/` | HIGH     |
| G2  | Worktrees created in project dir, not workspace            | Can't volume-mount a single dir for sandboxing       | HIGH     |
| G3  | No filesystem boundary enforcement                         | Agent can write to arbitrary paths                   | HIGH     |
| G4  | No git tracking of workspace changes                       | No reproducibility or diff history                   | MEDIUM   |
| G5  | `archiveChat` doesn't cleanup worktrees                  | Orphaned worktrees leak disk space                   | HIGH     |
| G6  | Artifact storage split between workspace and artifacts dir | Confusing, inconsistent paths                        | MEDIUM   |
| G7  | No DB tracking of workspace ↔ execution entity            | Users can't make informed cleanup decisions          | HIGH     |
| G8  | Data-source scripts have unrestricted CWD                  | Security risk; output not captured                   | MEDIUM   |
| G9  | Chat `useWorktree` not configurable per-chat             | All-or-nothing                                       | LOW      |
| G10 | No workspace snapshot for resume/replay                    | Can't reproduce a run's state                        | LOW      |

---

## 4. Modern Agent Workspace Patterns

### OpenAI Agents SDK (Sandbox Agents)

Key patterns we adopt:

| Pattern                     | Description                                             | Our Adaptation                                              |
| --------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| **Manifest**          | Declares workspace content before execution starts      | `WorkspaceManifest` object computed per-execution         |
| **Per-run workspace** | Each run gets isolated filesystem                       | Unified workspace dir per execution                         |
| **Sandbox lifecycle** | Create → Start → Run tools → Stop → Persist/Cleanup | Create → Git init → Execute → Snapshot → Archive/Delete |
| **Snapshot/Resume**   | Save workspace state for later runs                     | Git-backed history + optional tarball                       |
| **Capabilities**      | Declarative filesystem/shell/skills                     | ProjectConfig + SystemArtifacts staged into workspace       |
| **Client-agnostic**   | Same agent def, different execution backend             | Volume-mount workspace path works for Docker or host        |
| **Permissions**       | User-based access within workspace                      | Read-only vs writable zones (source vs output)              |

### Anthropic Computer Use Pattern

Key pattern: **Containerized execution environment with well-defined workspace boundaries.** The agent receives a sandboxed environment where all work happens. Our workspace directory IS that boundary.

### Key Design Principle Adopted

> **"The workspace directory is the single source of truth and the single mount point."**
>
> Everything the agent needs (source code, skills, prompts, scripts, data) is staged INTO the workspace before execution. Everything the agent produces (code, artifacts, logs) lives INSIDE the workspace. The workspace path = the volume mount path for future sandbox isolation.

---

## 5. Architecture Design

### 5.1 Core Concept: Execution Workspace

```typescript
interface ExecutionWorkspace {
  id: string;                       // UUID
  ownerType: 'chat' | 'workflow_run' | 'automation_execution';
  ownerId: string;                  // chatId, runId, or executionId
  projectId?: string;               // Optional project linkage
  rootPath: string;                 // Absolute path to workspace directory
  status: 'creating' | 'active' | 'completed' | 'archived' | 'failed';
  gitEnabled: boolean;              // Whether workspace has git tracking
  createdAt: Date;
  completedAt?: Date;
  metadata: {
    useWorktree: boolean;           // Whether codebases are checked out as worktrees
    codebaseAliases?: string[];     // Which codebases were staged
    worktreeDetails?: WorktreeDetail[];
    snapshotPath?: string;          // Path to archived snapshot (if archived)
  };
}

interface WorktreeDetail {
  codebaseId: string;
  alias: string;
  branchName: string;
  baseBranch: string;
  worktreePath: string;             // Relative to workspace root
  status: 'active' | 'committed' | 'pushed' | 'deleted';
}
```

### 5.2 Workspace Directory Layout

Every execution (chat, workflow run, automation execution) gets:

```
<workspacesDir>/executions/<executionId>/
├── .workspace.json             ← Workspace manifest (metadata, config)
├── .git/                       ← Optional: workspace-level git tracking
├── source/                     ← Worktrees or cloned codebases
│   ├── <alias1>/               ← Worktree from codebase 1
│   │   ├── .git (worktree)
│   │   └── [project files]
│   └── <alias2>/               ← Worktree from codebase 2
├── output/                     ← All agent-generated code output
│   └── [files written by agent]
├── artifacts/                  ← Response markdowns, logs
│   ├── stream-log.jsonl
│   ├── stage-responses/        ← Per-stage markdown (workflows)
│   └── attachments/            ← Uploaded files
├── scripts/                    ← Data-source scripts staged for execution
├── config/                     ← Staged artifacts for this execution
│   ├── agents/
│   ├── prompts/
│   ├── skills/
│   └── mcp/
└── .snapshots/                 ← Local snapshots (optional)
```

### 5.3 Service Architecture

```
┌─────────────────────────────────────────────────────┐
│                WorkspaceManager                       │
│  (Central service for workspace lifecycle)           │
├─────────────────────────────────────────────────────┤
│  createWorkspace(params) → ExecutionWorkspace        │
│  setupWorktrees(workspaceId, codebases) → paths[]   │
│  stageArtifacts(workspaceId, project, system)       │
│  getWorkingDirectory(workspaceId) → string          │
│  archiveWorkspace(workspaceId) → snapshotPath       │
│  deleteWorkspace(workspaceId)                        │
│  getWorkspaceStatus(workspaceId) → WorkspaceInfo    │
│  listWorkspaces(filters) → WorkspaceInfo[]          │
│  cleanupExpiredWorkspaces(retentionPolicy)           │
└─────────────────────────────────────────────────────┘
          │
          ├── Uses: GitManager (for worktrees + workspace git tracking)
          ├── Uses: IWorkspaceRepository (DB persistence)
          ├── Uses: ProjectService (for codebase info)
          └── Uses: SystemArtifactService (for system artifacts)
```

### 5.4 Integration Points

```
ChatManagementService
  └─ ALWAYS calls WorkspaceManager.createWorkspace(...)
     └─ Even without project → workspace created for artifacts/output

WorkflowRunService.startRun()
  └─ calls WorkspaceManager.createWorkspace(...)
     └─ Replaces manual directory creation + variable injection

AutomationService.runSingleWorkflow()
  └─ calls WorkspaceManager.createWorkspace(...)
     └─ Scopes data-source script execution to workspace/scripts/

StageExecutionService
  └─ Writes code blocks → workspace output/ (or source/ if worktree)
  └─ Writes response MDs → workspace artifacts/stage-responses/
```

---

## 6. Filesystem Structure

### 6.1 Full Application Data Directory (Updated)

```
~/.generatorai/
├── data.db                         ← SQLite database
├── config.json                     ← User config (optional)
│
├── workspaces/
│   └── executions/                 ← ALL execution workspaces live here
│       ├── <chat-id>/           
│       │   └── [workspace layout per §5.2]
│       ├── <workflow-run-id>/   
│       │   └── [workspace layout per §5.2]
│       └── <automation-exec-id>/ 
│           └── [workspace layout per §5.2]
│
├── projects/                       ← Project metadata + bare repos (unchanged)
│   └── <projectId>/
│       ├── repos/                  ← Bare clones (source of truth for worktrees)
│       │   └── <alias>/
│       ├── config/                 ← Project-scoped artifacts
│       │   ├── agents/, prompts/, skills/, mcp/
│       │   └── scripts/            ← NEW: project-scoped data-source scripts
│       └── metadata.json
│
├── templates/                      ← System templates & artifacts
│   ├── system/
│   │   ├── artifacts/{agents,prompts,skills}/
│   │   ├── scripts/                ← NEW: system-level scripts
│   │   └── *.json                  ← System workflow templates
│   └── data-source-scripts/        ← Legacy (migrated to system/scripts/)
│
├── archives/                       ← NEW: Archived workspace snapshots
│   └── <executionId>.tar.gz
│
└── backups/
    └── data-*.db
```

### 6.2 Working Directory Resolution Logic

The `WorkspaceManager.getWorkingDirectory()` method resolves the SDK `workingDirectory` via a priority chain:

```typescript
getWorkingDirectory(workspace: ExecutionWorkspace): string {
  // Priority 1: If worktrees exist, use first worktree (or primary codebase)
  if (workspace.metadata.worktreeDetails?.length > 0) {
    const primary = workspace.metadata.worktreeDetails[0];
    return path.join(workspace.rootPath, 'source', primary.alias);
  }

  // Priority 2: If no worktrees but project linked, use output/ as CWD
  // (source code is read-only reference; agent writes to output/)
  if (workspace.projectId) {
    return path.join(workspace.rootPath, 'output');
  }

  // Priority 3: No project — workspace root IS the working directory
  // Agent has full read/write in workspace root
  return path.join(workspace.rootPath, 'output');
}
```

### 6.3 Chat Workspace Scenarios

| Scenario                                 | Workspace Created? | Working Directory               | Worktrees?                                                 |
| ---------------------------------------- | ------------------ | ------------------------------- | ---------------------------------------------------------- |
| Chat with no project                     | YES                | `workspace/output/`           | No                                                         |
| Chat with project,`useWorktree: true`  | YES                | `workspace/source/<primary>/` | Yes                                                        |
| Chat with project,`useWorktree: false` | YES                | `workspace/output/`           | No (project codebases available as read-only reference)    |
| Chat with file attachments               | YES                | Same as above                   | Attachments staged to `workspace/artifacts/attachments/` |

### 6.4 Workflow Workspace Scenarios

| Scenario                         | Working Directory               | Stage Artifacts                          | Inter-Stage Access                                  |
| -------------------------------- | ------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| Workflow without project         | `workspace/output/`           | `workspace/artifacts/stage-responses/` | Shared `output/` dir                              |
| Workflow with project + worktree | `workspace/source/<primary>/` | Same                                     | Shared worktree                                     |
| Multi-codebase workflow          | `workspace/source/<primary>/` | Same                                     | All worktrees accessible via `../` within source/ |

### 6.5 Automation Workspace Scenarios

| Scenario                          | Working Directory                  | Data Source Output                 | Per-Iteration? |
| --------------------------------- | ---------------------------------- | ---------------------------------- | -------------- |
| Single execution                  | `workspace/output/`              | `workspace/scripts/output/`      | N/A            |
| Batch (N iterations)              | Each iteration gets own workspace  | Staged into each workspace         | YES            |
| With project                      | `workspace/source/<primary>/`    | `workspace/scripts/output/`      | YES            |
| Dynamic data-source (script/HTTP) | Resolved BEFORE workspace creation | Data cached, staged into workspace | YES            |

---

## 7. Database Schema Changes

### 7.1 New Table: `execution_workspaces`

```sql
CREATE TABLE IF NOT EXISTS execution_workspaces (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('chat', 'workflow_run', 'automation_execution')),
  owner_id TEXT NOT NULL,
  project_id TEXT,
  root_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK(status IN ('creating', 'active', 'completed', 'archived', 'failed')),
  git_enabled INTEGER NOT NULL DEFAULT 1,
  use_worktree INTEGER NOT NULL DEFAULT 1,
  snapshot_path TEXT,
  metadata TEXT,  -- JSON: additional config, labels, etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  archived_at TEXT,
  
  UNIQUE(owner_type, owner_id)
);

CREATE INDEX idx_execution_workspaces_owner 
  ON execution_workspaces(owner_type, owner_id);
CREATE INDEX idx_execution_workspaces_project 
  ON execution_workspaces(project_id);
CREATE INDEX idx_execution_workspaces_status
  ON execution_workspaces(status);
```

### 7.2 New Table: `workspace_worktrees`

```sql
CREATE TABLE IF NOT EXISTS workspace_worktrees (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES execution_workspaces(id),
  codebase_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_branch TEXT NOT NULL DEFAULT 'main',
  relative_path TEXT NOT NULL,       -- Relative to workspace root (e.g., 'source/frontend')
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'committed', 'pushed', 'deleted', 'error')),
  commit_hash TEXT,                  -- Latest commit SHA on this worktree
  has_uncommitted_changes INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(workspace_id, alias)
);

CREATE INDEX idx_workspace_worktrees_workspace
  ON workspace_worktrees(workspace_id);
CREATE INDEX idx_workspace_worktrees_codebase
  ON workspace_worktrees(codebase_id);
```

### 7.3 New Table: `workspace_artifacts`

```sql
CREATE TABLE IF NOT EXISTS workspace_artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES execution_workspaces(id),
  stage_run_id TEXT,                 -- NULL for chat; set for workflow stages
  artifact_type TEXT NOT NULL 
    CHECK(artifact_type IN ('code_file', 'response_md', 'attachment', 'script_output', 'log', 'snapshot')),
  relative_path TEXT NOT NULL,       -- Path relative to workspace root
  file_size INTEGER,
  mime_type TEXT,
  metadata TEXT,                     -- JSON: source stage, generation timestamp, etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_workspace_artifacts_workspace
  ON workspace_artifacts(workspace_id);
CREATE INDEX idx_workspace_artifacts_stage
  ON workspace_artifacts(stage_run_id);
```

### 7.4 Modifications to Existing Tables

```sql
-- Add workspace_id reference to chats
ALTER TABLE chats ADD COLUMN workspace_id TEXT;

-- Add workspace_id reference to workflow_runs
ALTER TABLE workflow_runs ADD COLUMN workspace_id TEXT;

-- Add workspace_id reference to automation_executions
ALTER TABLE automation_executions ADD COLUMN workspace_id TEXT;

-- Add use_worktree preference to chats (default true)
ALTER TABLE chats ADD COLUMN use_worktree INTEGER NOT NULL DEFAULT 1;

-- Add use_worktree preference to workflow definitions
ALTER TABLE workflow_definitions ADD COLUMN use_worktree INTEGER NOT NULL DEFAULT 1;

-- Add use_worktree preference to automations
ALTER TABLE automations ADD COLUMN use_worktree INTEGER NOT NULL DEFAULT 1;
```

---

## 8. Service Layer Changes

### 8.1 New Service: `WorkspaceManager`

**File:** `packages/core/src/services/WorkspaceManager.ts`

```typescript
export interface CreateWorkspaceParams {
  ownerType: 'chat' | 'workflow_run' | 'automation_execution';
  ownerId: string;
  projectId?: string;
  codebaseIds?: string[];      // Which codebases to checkout
  useWorktree?: boolean;        // Default: true (if project linked)
  gitEnabled?: boolean;         // Default: true (workspace-level git tracking)
  stageSystemArtifacts?: boolean;   // Stage system prompts/agents/skills
  stageProjectArtifacts?: boolean;  // Stage project-specific artifacts
  stageMcpConfig?: boolean;         // Stage MCP server config
  scriptPaths?: string[];       // Data-source scripts to stage
  attachments?: AttachmentRef[];    // Files to stage
}

export interface WorkspaceInfo {
  id: string;
  ownerType: string;
  ownerId: string;
  projectId?: string;
  rootPath: string;
  workingDirectory: string;     // Computed SDK working directory
  sourcePaths: string[];        // All worktree/source paths
  artifactsPath: string;
  status: string;
  worktrees: WorktreeDetail[];
  diskUsage?: number;           // Bytes
  createdAt: Date;
}

export class WorkspaceManager {
  constructor(
    private workspaceRepo: IWorkspaceRepository,
    private worktreeRepo: IWorktreeRepository,
    private artifactRepo: IWorkspaceArtifactRepository,
    private gitManager: GitManager,
    private projectService: ProjectService,
    private codebaseService: CodebaseService,
    private systemArtifactService: SystemArtifactService,
    private config: { workspacesDir: string; defaultGitEnabled: boolean },
    private logger: Logger,
  ) {}

  /**
   * Create a fully-initialized workspace for any execution type.
   * This is the ONLY entry point for workspace creation.
   */
  async createWorkspace(params: CreateWorkspaceParams): Promise<ExecutionWorkspace> {
    // 1. Generate workspace ID and compute root path
    // 2. Create directory structure
    // 3. If projectId + useWorktree: create worktrees in source/
    // 4. If gitEnabled: git init workspace root
    // 5. Stage system/project artifacts into config/
    // 6. Stage scripts into scripts/
    // 7. Stage attachments into artifacts/attachments/
    // 8. Write .workspace.json manifest
    // 9. Persist to DB
    // 10. Return workspace info
  }

  /**
   * Get the resolved SDK working directory for a workspace.
   */
  getWorkingDirectory(workspace: ExecutionWorkspace): string { ... }

  /**
   * Register a file written by the agent/stage in the workspace.
   */
  async trackArtifact(params: TrackArtifactParams): Promise<void> { ... }

  /**
   * Archive a workspace (tar.gz + move to archives/).
   */
  async archiveWorkspace(workspaceId: string): Promise<string> { ... }

  /**
   * Delete a workspace and all its contents.
   */
  async deleteWorkspace(workspaceId: string): Promise<void> { ... }

  /**
   * Cleanup old workspaces based on retention policy.
   */
  async cleanupExpiredWorkspaces(policy: RetentionPolicy): Promise<number> { ... }

  /**
   * List workspaces with filtering.
   */
  async listWorkspaces(filters: WorkspaceFilters): Promise<WorkspaceInfo[]> { ... }

  /**
   * Get detailed info about a workspace including disk usage.
   */
  async getWorkspaceInfo(workspaceId: string): Promise<WorkspaceInfo> { ... }

  /**
   * Commit all changes in workspace to workspace-level git.
   */
  async commitWorkspaceChanges(workspaceId: string, message: string): Promise<string> { ... }

  /**
   * Get git diff of workspace changes since creation.
   */
  async getWorkspaceDiff(workspaceId: string): Promise<string> { ... }
}
```

### 8.2 New Port: `IWorkspaceRepository`

**File:** `packages/core/src/domain/ports/IWorkspaceRepository.ts`

```typescript
export interface IWorkspaceRepository {
  create(workspace: ExecutionWorkspace): Promise<void>;
  findById(id: string): Promise<ExecutionWorkspace | null>;
  findByOwner(ownerType: string, ownerId: string): Promise<ExecutionWorkspace | null>;
  findByProject(projectId: string): Promise<ExecutionWorkspace[]>;
  updateStatus(id: string, status: string, metadata?: Partial<ExecutionWorkspace>): Promise<void>;
  list(filters: WorkspaceFilters): Promise<ExecutionWorkspace[]>;
  delete(id: string): Promise<void>;
}

export interface IWorktreeRepository {
  create(worktree: WorktreeRecord): Promise<void>;
  findByWorkspace(workspaceId: string): Promise<WorktreeRecord[]>;
  findByCodebase(codebaseId: string): Promise<WorktreeRecord[]>;
  updateStatus(id: string, status: string, commitHash?: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface IWorkspaceArtifactRepository {
  create(artifact: WorkspaceArtifactRecord): Promise<void>;
  findByWorkspace(workspaceId: string): Promise<WorkspaceArtifactRecord[]>;
  findByStage(stageRunId: string): Promise<WorkspaceArtifactRecord[]>;
  delete(id: string): Promise<void>;
}
```

### 8.3 Modified Service: `ChatManagementService`

**Changes:**

```typescript
// BEFORE:
async createChat(params: CreateChatParams): Promise<Chat> {
  // ... create session, conversation
  if (params.projectId && params.codebaseIds) {
    const worktrees = await this.worktreeService.createRunWorktrees(...);
    config.workingDirectory = worktrees[0].worktreePath;
  }
}

// AFTER:
async createChat(params: CreateChatParams): Promise<Chat> {
  // ... create session, conversation
  
  // ALWAYS create a workspace
  const workspace = await this.workspaceManager.createWorkspace({
    ownerType: 'chat',
    ownerId: chat.id,
    projectId: params.projectId,
    codebaseIds: params.codebaseIds,
    useWorktree: params.useWorktree ?? true,  // New param, default true
    gitEnabled: true,
    stageSystemArtifacts: true,
    stageProjectArtifacts: !!params.projectId,
    stageMcpConfig: true,
    attachments: params.attachments,
  });

  // Update chat with workspace reference
  await this.chatRepo.update(chat.id, { workspaceId: workspace.id });

  // SDK working directory from workspace
  config.workingDirectory = this.workspaceManager.getWorkingDirectory(workspace);
}
```

### 8.4 Modified Service: `WorkflowRunService`

**Changes:**

```typescript
// BEFORE (in startRun):
const workspaceDir = path.join(artifactsDir, 'runs', run.id, 'workspace');
const artifactsDirectory = path.join(artifactsDir, 'runs', run.id, 'artifacts');
await mkdir(workspaceDir, { recursive: true });
await mkdir(artifactsDirectory, { recursive: true });
run.variables.__workingDirectory = workspaceDir;
run.variables.__artifactsDirectory = artifactsDirectory;

// AFTER:
const workspace = await this.workspaceManager.createWorkspace({
  ownerType: 'workflow_run',
  ownerId: run.id,
  projectId: run.projectId,
  codebaseIds: run.codebaseIds,
  useWorktree: definition.useWorktree ?? true,
  gitEnabled: true,
  stageSystemArtifacts: true,
  stageProjectArtifacts: !!run.projectId,
});

await this.workflowRunRepo.update(run.id, { workspaceId: workspace.id });

// Inject paths into run variables
run.variables.__workingDirectory = this.workspaceManager.getWorkingDirectory(workspace);
run.variables.__artifactsDirectory = path.join(workspace.rootPath, 'artifacts');
run.variables.__workspaceRoot = workspace.rootPath;
run.variables.__sourcePath = path.join(workspace.rootPath, 'source');
```

### 8.5 Modified Service: `AutomationService`

**Changes:**

```typescript
// BEFORE (in runSingleWorkflow):
// Creates WorkflowRun which internally creates its own dirs

// AFTER (in runSingleWorkflow):
// Workspace creation delegated to WorkflowRunService via createWorkspace
// BUT: Data-source scripts and their output are staged BEFORE workspace creation

async runSingleWorkflow(automation, iteration, variables) {
  // Stage data-source script output into a temp location
  const dataOutput = await this.dataSourceResolver.resolve(automation.dataSource, {
    workingDirectory: path.join(this.config.workspacesDir, 'staging', automation.id),
    timeout: automation.dataSource.timeout,
  });
  
  // Create workflow run with extra script paths
  const run = await this.workflowRunService.createAndStartRun({
    ...params,
    scriptPaths: automation.dataSource?.type === 'script' 
      ? [automation.dataSource.scriptPath] 
      : undefined,
    extraVariables: { ...variables, ...dataOutput.extractedVariables },
  });
}
```

### 8.6 Modified Service: `StageExecutionService`

**Changes for code block extraction:**

```typescript
// BEFORE:
const wsPath = await resolveWithinBase(workspaceDirectory, sanitized);
await fs.writeFile(wsPath, block.content, 'utf-8');

// AFTER:
const wsPath = await resolveWithinBase(workspaceDirectory, sanitized);
await fs.writeFile(wsPath, block.content, 'utf-8');

// Track artifact in workspace DB
await this.workspaceManager.trackArtifact({
  workspaceId: run.workspaceId,
  stageRunId: stageRun.id,
  artifactType: 'code_file',
  relativePath: path.relative(workspace.rootPath, wsPath),
  fileSize: Buffer.byteLength(block.content),
  metadata: { language: block.language, sourceFence: block.filename },
});
```

**Changes for response markdown saving:**

```typescript
// BEFORE:
await fs.writeFile(path.join(artifactsDirectory, mdFile), msg.content, 'utf-8');

// AFTER:
const mdPath = path.join(workspace.rootPath, 'artifacts', 'stage-responses', mdFile);
await fs.writeFile(mdPath, msg.content, 'utf-8');
await this.workspaceManager.trackArtifact({
  workspaceId: run.workspaceId,
  stageRunId: stageRun.id,
  artifactType: 'response_md',
  relativePath: `artifacts/stage-responses/${mdFile}`,
});
```

### 8.7 New Port: `IPathResolver`

Centralized path validation and boundary enforcement:

```typescript
export class PathResolver {
  /**
   * Resolve a path within a workspace, preventing escape.
   * Throws if resolved path is outside workspaceRoot.
   */
  resolveWithinWorkspace(workspaceRoot: string, relativePath: string): string {
    const resolved = path.resolve(workspaceRoot, relativePath);
    if (!resolved.startsWith(path.resolve(workspaceRoot))) {
      throw new PathEscapeError(relativePath, workspaceRoot);
    }
    return resolved;
  }

  /**
   * Check if a path is within allowed boundaries.
   */
  isWithinBoundary(targetPath: string, boundary: string): boolean {
    return path.resolve(targetPath).startsWith(path.resolve(boundary));
  }
}
```

---

## 9. Execution Scenarios (End-to-End)

### 9.1 Scenario: Chat Session with Project & Worktree

```
User Action: Create chat linked to project "my-app" with codebases ["frontend", "api"]
             useWorktree: true (default)

Flow:
1. POST /api/chats { projectId: "proj-1", codebaseIds: ["cb-1", "cb-2"], useWorktree: true }
2. ChatManagementService.createChat():
   a. Generate chatId, sessionId
   b. WorkspaceManager.createWorkspace({
        ownerType: 'chat', ownerId: chatId,
        projectId: 'proj-1', codebaseIds: ['cb-1', 'cb-2'],
        useWorktree: true, gitEnabled: true
      })
   c. WorkspaceManager internally:
      - mkdir ~/.generatorai/workspaces/executions/<chatId>/
      - mkdir source/, output/, artifacts/, config/, scripts/
      - GitManager.createWorktree(projectRepos/frontend, source/frontend, branch)
      - GitManager.createWorktree(projectRepos/api, source/api, branch)
      - git init (workspace-level tracking)
      - Stage system prompts/skills/agents → config/
      - Stage project prompts/skills/agents → config/
      - Write .workspace.json
      - INSERT INTO execution_workspaces (...)
      - INSERT INTO workspace_worktrees (...) × 2
   d. config.workingDirectory = "~/.generatorai/workspaces/executions/<chatId>/source/frontend"
   e. Create SDK conversation with workingDirectory set
3. User sends prompt → agent works within workspace/source/frontend/
4. Agent writes code → tracked in workspace_artifacts
5. User archives chat:
   a. WorkspaceManager.archiveWorkspace(workspaceId)
   b. Git commit all changes
   c. tar.gz → archives/<chatId>.tar.gz
   d. Remove worktrees via GitManager
   e. rm -rf workspace directory
   f. Update DB status → 'archived'

Result:
- All generated code lives in workspace/source/frontend/ (worktree)
- All AI responses saved in workspace/artifacts/
- Git history shows exactly what changed
- DB tracks: workspace → chat, worktrees + branches, all artifacts
- User can inspect worktree details before deleting
```

### 9.2 Scenario: Chat Session WITHOUT Project

```
User Action: Create a standalone chat (no project linkage)

Flow:
1. POST /api/chats {}
2. ChatManagementService.createChat():
   a. WorkspaceManager.createWorkspace({
        ownerType: 'chat', ownerId: chatId,
        useWorktree: false, gitEnabled: true
      })
   b. Creates workspace at: ~/.generatorai/workspaces/executions/<chatId>/
   c. SDK workingDirectory = workspace/output/
3. User sends prompt with file attachment:
   a. File staged to: workspace/artifacts/attachments/<filename>
   b. AttachmentRef passed to SDK conversation
4. Agent generates code → workspace/output/<path>
5. Everything tracked in DB

Result:
- Even without a project, chat has isolated workspace
- Agent can't write outside workspace/output/
- Uploaded files accessible within workspace
- Future sandbox: just volume-mount the workspace dir
```

### 9.3 Scenario: Multi-Stage Workflow with Project

```
User Action: Start workflow run (3 stages: Analyze → Implement → Test)
             Linked to project "api-server" with codebase "backend"

Flow:
1. WorkflowRunService.startRun(runId):
   a. WorkspaceManager.createWorkspace({
        ownerType: 'workflow_run', ownerId: runId,
        projectId: 'proj-2', codebaseIds: ['cb-backend'],
        useWorktree: true, gitEnabled: true
      })
   b. Creates:
      ~/.generatorai/workspaces/executions/<runId>/
        source/backend/   ← worktree (branch: generatorai/run-<short>-backend)
        output/
        artifacts/stage-responses/
        config/{agents,prompts,skills}/

2. Stage "Analyze" executes:
   a. SDK workingDirectory = workspace/source/backend/
   b. Agent reads source code, produces analysis
   c. Response saved: artifacts/stage-responses/analyze_response_0.md
   d. Summary extracted and stored in stage_runs.summary
   e. WorkspaceManager.trackArtifact(...) for each file

3. Stage "Implement" executes:
   a. Receives predecessor summary: "Analyzed: found X, Y, Z issues..."
   b. SDK workingDirectory = same workspace/source/backend/
   c. Agent modifies source files IN the worktree
   d. Code blocks extracted → written to source/backend/ (same dir!)
   e. Response saved: artifacts/stage-responses/implement_response_0.md
   f. All changes tracked

4. Stage "Test" executes:
   a. Receives predecessor summary from both Analyze + Implement
   b. Same workingDirectory → agent sees modified files from Implement
   c. Writes test files to source/backend/tests/
   d. Tracked

5. Workflow completes:
   a. WorkspaceManager.commitWorkspaceChanges(workspaceId, "Workflow run completed")
   b. Git commit in worktree captures all changes
   c. workspace status → 'completed'
   d. User can later: push branch, create PR, archive, or delete

Result:
- All 3 stages share the same filesystem (consistent view)
- Git worktree tracks all changes with proper branch
- stage-responses/ gives audit trail
- workspace_artifacts table knows which stage created what
- Single volume-mount point for future sandbox
```

### 9.4 Scenario: Workflow WITHOUT Project (Code Generation)

```
User Action: Start "code-generation" workflow (no project linked)

Flow:
1. WorkspaceManager.createWorkspace({
     ownerType: 'workflow_run', ownerId: runId,
     useWorktree: false, gitEnabled: true
   })
2. Workspace: ~/.generatorai/workspaces/executions/<runId>/
3. SDK workingDirectory = workspace/output/
4. Stage generates code → output/src/app.ts, output/package.json
5. Git tracking shows all generated files
6. User can download workspace contents or archive

Result:
- Even without project, workspace is created
- Agent writes to output/ subdirectory
- Git tracks everything generated
```

### 9.5 Scenario: Automation Batch Execution

```
User Action: Automation fires (batch mode, 5 iterations, linked to project)
             Data source: HTTP API returning 5 items

Flow:
1. AutomationService.triggerExecution(automationId):
   a. DataSourceResolver fetches data (5 items)
   b. Creates AutomationExecution record

2. For each iteration (i = 0..4):
   a. Resolve iteration variables from batch data + column mapping
   b. Create WorkflowRun with iteration variables
   c. WorkflowRunService.startRun():
      - WorkspaceManager.createWorkspace({
          ownerType: 'workflow_run', ownerId: iterRunId,
          projectId: automation.projectId,
          codebaseIds: automation.codebaseIds,
          useWorktree: true, gitEnabled: true,
          scriptPaths: [automation.dataSource.scriptPath], // if script DS
        })
      - Each iteration gets INDEPENDENT workspace
      - Each gets own worktree branch: generatorai/run-<short>-<alias>
   d. Workflow stages execute in workspace
   e. On completion: workspace status → 'completed'

3. Automation execution marked completed
4. User can inspect each iteration's workspace independently

Result:
- Each batch iteration is fully isolated (own workspace + worktrees)
- If useWorktree: true, each iteration's branch is independently pushable
- Data-source script output staged into workspace/scripts/output/
- User sees 5 workspaces in DB, each linked to automation_execution
```

### 9.6 Scenario: Automation with Dynamic Script Data Source

```
User Action: Automation with script data source + project

Flow:
1. Trigger automation
2. Execute data-source script in sandboxed staging area:
   - Staging: ~/.generatorai/workspaces/staging/<automationId>/
   - Script runs in staging dir (not in any run workspace)
   - Output captured: JSON array of items
3. Parse output → items[]
4. For each item:
   a. Create workspace for that iteration
   b. Stage script output data file INTO workspace/scripts/output/data.json
   c. Inject iteration variables
   d. Execute workflow stages
5. Cleanup staging area after all iterations

Result:
- Script execution is isolated from run workspaces
- Each iteration gets a copy of relevant data
- Script can't interfere with workspace contents
```

### 9.7 Scenario: Chat File Attachment Handling

```
User Action: Upload 3 files to an active chat session

Flow:
1. POST /api/chats/:id/prompt (multipart with files)
2. Files received by server:
   a. For each file:
      - Stage to: workspace/artifacts/attachments/<original-filename>
      - Track in workspace_artifacts table
      - Create AttachmentRef with workspace-relative path
   b. Pass AttachmentRef array to SDK conversation
3. Agent can access files at: attachments/<filename> (relative to workspace)
4. If agent references file content → SDK reads from workspace path

Result:
- Files live inside workspace (volume-mountable)
- Path is predictable and workspace-relative
- DB tracks each attachment
```

### 9.8 Scenario: User Inspects Worktree Details Before Cleanup

```
User Action: GET /api/workspaces?projectId=proj-1

Response:
[
  {
    "id": "ws-1",
    "ownerType": "chat",
    "ownerId": "chat-abc",
    "status": "completed",
    "createdAt": "2026-04-25T10:00:00Z",
    "completedAt": "2026-04-25T11:30:00Z",
    "worktrees": [
      {
        "alias": "frontend",
        "branchName": "generatorai/chat-abc-frontend",
        "hasUncommittedChanges": false,
        "status": "committed"
      }
    ],
    "diskUsage": 45000000  // 45MB
  },
  {
    "id": "ws-2",
    "ownerType": "workflow_run",
    "ownerId": "run-xyz",
    "status": "active",
    "worktrees": [
      {
        "alias": "frontend",
        "branchName": "generatorai/run-xyz-frontend",
        "hasUncommittedChanges": true,
        "status": "active"
      }
    ]
  }
]

User sees: "chat-abc is done and committed. run-xyz still has uncommitted changes."
User deletes ws-1 (safe), keeps ws-2 (has changes).
```

---

## 10. API Changes

### 10.1 New Endpoints

```
# Workspace management
GET    /api/workspaces                    → List workspaces (filter by project, status, type)
GET    /api/workspaces/:id                → Get workspace details
GET    /api/workspaces/:id/tree           → Get workspace file tree
GET    /api/workspaces/:id/diff           → Get workspace git diff
POST   /api/workspaces/:id/commit         → Commit workspace changes
POST   /api/workspaces/:id/archive        → Archive workspace to tar.gz
DELETE /api/workspaces/:id                → Delete workspace + cleanup worktrees
POST   /api/workspaces/cleanup            → Trigger retention-based cleanup

# Worktree-specific operations  
GET    /api/workspaces/:id/worktrees      → List worktrees with status
POST   /api/workspaces/:id/worktrees/:alias/push  → Push worktree branch
POST   /api/workspaces/:id/worktrees/:alias/pr    → Create PR from worktree branch
```

### 10.2 Modified Endpoints

```
# Chat creation — new fields
POST /api/chats
  Body: { ..., useWorktree?: boolean }  // Default: true

# Workflow definition — new field  
PATCH /api/workflow-definitions/:id
  Body: { ..., useWorktree?: boolean }

# Automation — new field
PATCH /api/automations/:id
  Body: { ..., useWorktree?: boolean }

# Chat info response — includes workspace
GET /api/chats/:id
  Response: { ..., workspaceId: string, workspace?: WorkspaceInfo }

# Workflow run response — includes workspace
GET /api/workflow-runs/:id
  Response: { ..., workspaceId: string, workspace?: WorkspaceInfo }
```

---

## 11. Migration Strategy

### 11.1 Database Migration

Added to `migrateDB()` in `packages/db/src/index.ts`:

```typescript
// Create new tables
db.exec(`CREATE TABLE IF NOT EXISTS execution_workspaces (...)`);
db.exec(`CREATE TABLE IF NOT EXISTS workspace_worktrees (...)`);
db.exec(`CREATE TABLE IF NOT EXISTS workspace_artifacts (...)`);

// Add columns to existing tables
addColumnIfNotExists(db, 'chats', 'workspace_id', 'TEXT');
addColumnIfNotExists(db, 'chats', 'use_worktree', 'INTEGER DEFAULT 1');
addColumnIfNotExists(db, 'workflow_runs', 'workspace_id', 'TEXT');
addColumnIfNotExists(db, 'workflow_definitions', 'use_worktree', 'INTEGER DEFAULT 1');
addColumnIfNotExists(db, 'automations', 'use_worktree', 'INTEGER DEFAULT 1');
addColumnIfNotExists(db, 'automation_executions', 'workspace_id', 'TEXT');
```

### 11.2 Filesystem Migration

**For existing runs/chats:**

- Old workspaces at `artifacts/runs/<runId>/` remain functional
- New workspaces go to `workspaces/executions/<id>/`
- No migration of existing data needed (they continue working with old paths)
- WorkspaceManager checks for `workspace_id` — if null, falls back to legacy path resolution

### 11.3 Backward Compatibility

```typescript
// In WorkflowRunService.startRun():
if (run.workspaceId) {
  // New path: use WorkspaceManager
  const workspace = await this.workspaceManager.getWorkspaceInfo(run.workspaceId);
  run.variables.__workingDirectory = workspace.workingDirectory;
} else {
  // Legacy path: old directory structure (gradually deprecated)
  const workspaceDir = path.join(this.artifactsDir, 'runs', run.id, 'workspace');
  run.variables.__workingDirectory = workspaceDir;
}
```

---

## 12. Security Considerations

### 12.1 Path Boundary Enforcement

```typescript
// In composition-root.ts, wrap SDK session creation:
const sandboxedConfig = {
  ...conversationConfig,
  workingDirectory: workspace.getWorkingDirectory(),
  // Agent tools are configured to only allow file operations within workspace
  allowedPaths: [workspace.rootPath],
};
```

### 12.2 Path Traversal Prevention

All file operations through `PathResolver.resolveWithinWorkspace()`:

- Blocks `../` escape attempts
- Blocks absolute paths
- Blocks symlink escape
- Logs violations for audit

### 12.3 Script Execution Sandboxing

Data-source scripts execute in a staging directory with:

- Working directory = `workspaces/staging/<id>/`
- No access to other workspaces
- Timeout enforcement (configurable)
- Output size limits (5MB default)
- Allowlist validation (from `config.security.allowedCommands`)

### 12.4 Volume Mount Readiness

When Docker sandbox is enabled:

```typescript
// Single volume mount covers entire workspace
const mounts = [{
  source: workspace.rootPath,
  target: '/workspace',
  readonly: false,
}];
```

Agent sees `/workspace/` inside container = host's `workspaces/executions/<id>/`

---

## 13. Implementation Phases

### Phase 1: Foundation (Core Infrastructure)

**Files to create/modify: ~8 files**

1. Create `packages/core/src/domain/ports/IWorkspaceRepository.ts`
2. Create `packages/core/src/services/WorkspaceManager.ts`
3. Create `packages/core/src/services/PathResolver.ts`
4. Create `packages/db/src/repositories/WorkspaceRepository.ts	`
5. Add schema to `packages/db/src/schema/` (3 new tables)		
6. Add migration to `packages/db/src/index.ts`
7. Create types in `packages/shared/src/types/Workspace.ts`
8. Wire into `apps/server/src/composition-root.ts			`

### Phase 2: Chat Integration

**Files to modify: ~5 files**

1. Modify `packages/core/src/services/ChatManagementService.ts`
2. Add `useWorktree` field to chat creation DTO
3. Add `workspaceId` to chat entity/response
4. Modify chat routes for new fields
5. Update chat archival to use WorkspaceManager cleanup

### Phase 3: Workflow Integration

**Files to modify: ~5 files**

1. Modify `packages/core/src/services/WorkflowRunService.ts`
2. Modify `packages/core/src/services/StageExecutionService.ts`
3. Add `useWorktree` to WorkflowDefinition
4. Update artifact tracking in stage execution
5. Update WorkflowOrchestrator for workspace-aware runs

### Phase 4: Automation Integration

**Files to modify: ~4 files**

1. Modify `packages/core/src/services/AutomationService.ts`
2. Update DataSourceResolver for workspace-scoped execution
3. Add `useWorktree` to Automation entity
4. Update automation routes

### Phase 5: API & UI Layer

**Files to create/modify: ~6 files**

1. Create `apps/server/src/routes/workspaces.ts`
2. Register workspace routes in `apps/server/src/routes/index.ts`
3. Add workspace info to chat/workflow/automation responses
4. Add workspace management UI components (web)
5. Add workspace commands to CLI

### Phase 6: Git Tracking & Cleanup

**Files to create/modify: ~4 files**

1. Implement workspace-level git init/commit in WorkspaceManager
2. Implement archive/snapshot logic
3. Implement retention-based cleanup service
4. Add cleanup cron/background task

---

## 14. File-by-File Change Map

### New Files

| File                                                       | Purpose                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/shared/src/types/Workspace.ts`                 | `ExecutionWorkspace`, `WorktreeDetail`, `WorkspaceInfo` types |
| `packages/core/src/domain/ports/IWorkspaceRepository.ts` | Repository interfaces                                               |
| `packages/core/src/services/WorkspaceManager.ts`         | Central workspace lifecycle service                                 |
| `packages/core/src/services/PathResolver.ts`             | Path validation and boundary enforcement                            |
| `packages/db/src/schema/workspaces.ts`                   | Drizzle schema for 3 new tables                                     |
| `packages/db/src/repositories/WorkspaceRepository.ts`    | SQLite repository implementation                                    |
| `apps/server/src/routes/workspaces.ts`                   | REST API for workspace management                                   |
| `apps/cli/src/commands/workspace.ts`                     | CLI commands for workspace inspection                               |

### Modified Files

| File                                                    | Changes                                          |
| ------------------------------------------------------- | ------------------------------------------------ |
| `packages/db/src/index.ts`                            | Add migration for new tables + columns           |
| `packages/db/src/schema/index.ts`                     | Export new schema                                |
| `packages/shared/src/types/index.ts`                  | Export new types                                 |
| `packages/core/src/services/ChatManagementService.ts` | Use WorkspaceManager for all chats               |
| `packages/core/src/services/WorkflowRunService.ts`    | Use WorkspaceManager instead of manual dirs      |
| `packages/core/src/services/StageExecutionService.ts` | Track artifacts via WorkspaceManager             |
| `packages/core/src/services/AutomationService.ts`     | Use WorkspaceManager per iteration               |
| `packages/core/src/services/WorkflowOrchestrator.ts`  | Pass workspace context                           |
| `packages/core/src/infrastructure/GitManager.ts`      | Add workspace-level git init/commit              |
| `apps/server/src/composition-root.ts`                 | Wire WorkspaceManager + repositories             |
| `apps/server/src/routes/index.ts`                     | Mount workspace routes                           |
| `apps/server/src/routes/chats.ts`                     | Add `useWorktree` param, return workspace info |
| `apps/server/src/routes/workflow-runs.ts`             | Return workspace info                            |
| `apps/server/src/routes/automations.ts`               | Add `useWorktree` param                        |
| `apps/cli/src/composition-root.ts`                    | Wire WorkspaceManager for CLI                    |
| `packages/shared/src/config/AppConfig.ts`             | Add workspace retention settings                 |

### Removed/Deprecated Files

| File                                              | Action                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/core/src/services/WorktreeService.ts` | Refactor → delegate to WorkspaceManager internally (keep for backward compat, mark deprecated) |

---

## Appendix A: Configuration Additions

```typescript
// In AppConfigSchema (packages/shared/src/config/AppConfig.ts):
workspace: z.object({
  retentionHours: z.number().default(168),       // 7 days default
  maxDiskUsageMB: z.number().default(10240),     // 10GB total workspace budget
  gitTrackingEnabled: z.boolean().default(true),
  autoArchiveOnComplete: z.boolean().default(false),
  snapshotOnComplete: z.boolean().default(false),
  cleanupIntervalMinutes: z.number().default(60),
}).default({}),
```

## Appendix B: Workspace Manifest Schema (.workspace.json)

```json
{
  "version": 1,
  "id": "<workspace-id>",
  "ownerType": "workflow_run",
  "ownerId": "<run-id>",
  "projectId": "<project-id>",
  "createdAt": "2026-04-28T10:00:00Z",
  "config": {
    "useWorktree": true,
    "gitEnabled": true,
    "sdkWorkingDirectory": "source/backend"
  },
  "worktrees": [
    {
      "alias": "backend",
      "codebaseId": "cb-1",
      "branchName": "generatorai/run-abc-backend",
      "baseBranch": "main",
      "relativePath": "source/backend"
    }
  ],
  "stagedArtifacts": {
    "agents": ["system-agent-code-review.json"],
    "prompts": ["project-prompt-api-guidelines.md"],
    "skills": ["system-skill-testing.ts"],
    "mcp": ["project-mcp-github.json"]
  },
  "scripts": ["fetch-github-prs.sh"]
}
```

## Appendix C: Volume Mount Strategy for Future Sandbox

```typescript
// When Docker sandbox is activated:
interface SandboxMountConfig {
  workspacePath: string;         // Host: ~/.generatorai/workspaces/executions/<id>/
  containerWorkspace: '/workspace';  // Container path
  
  // Additional bind mounts for read-only system resources
  additionalMounts: [
    { source: systemTemplatesDir, target: '/system/templates', readonly: true },
  ];
}

// The workspace directory structure maps 1:1 into the container:
// Host:      ~/.generatorai/workspaces/executions/<id>/source/backend/
// Container: /workspace/source/backend/
// 
// SDK workingDirectory inside container: /workspace/source/backend/
```

## Appendix D: Retention & Cleanup Policy

```typescript
interface RetentionPolicy {
  // Auto-delete completed workspaces older than N hours
  completedRetentionHours: number;     // Default: 168 (7 days)
  
  // Auto-archive (not delete) if workspace has uncommitted changes
  archiveIfDirty: boolean;             // Default: true
  
  // Never auto-delete workspaces with active worktrees that have unpushed commits
  protectUnpushed: boolean;            // Default: true
  
  // Maximum total disk usage before forced cleanup (oldest first)
  maxTotalDiskMB: number;              // Default: 10240 (10GB)
  
  // Exempt automation workspaces from auto-cleanup if retention is 'keep'
  respectAutomationRetention: boolean; // Default: true
}
```

---

## 15. Parallel Stage Handling & Concurrency

### Problem

When `SessionAllocator` uses `auto` or `per-stage` mode, multiple stages can execute **simultaneously** within the same workspace. This creates file-contention risks on shared worktrees.

### Strategy: Write-Region Partitioning

```typescript
// For parallel stages, each stage gets a DESIGNATED output subdirectory:
const stageOutputDir = workspace.metadata.useWorktree
  ? path.join(workspace.rootPath, 'source', primaryAlias)  // shared (sequential only)
  : path.join(workspace.rootPath, 'output', stageRun.id);  // partitioned (parallel safe)

// Decision matrix:
// - Sequential stages: share working directory (full fs access)
// - Parallel stages WITHOUT worktree: each gets output/<stageRunId>/
// - Parallel stages WITH worktree: ENFORCE sequential execution on writes
//   (read is safe, write contention resolved by DAGScheduler ordering)
```

### Implementation Rules

1. **If DAG has parallel stages that ALL write to the same worktree**: System emits a WARNING at validation time and recommends `per-stage` session mode with sequential write phases.
2. **StageExecutionService checks parallelism**: Before writing code blocks, check if other stages are writing to same directory:

   ```typescript
   const activePeers = await this.stageRunRepo.findActive(run.id);
   if (activePeers.length > 1 && workspace.metadata.useWorktree) {
     // Use atomic file writes (write to .tmp, rename)
     await this.atomicWrite(targetPath, content);
   }
   ```
3. **WorkspaceManager provides write lock for critical sections**:

   ```typescript
   async acquireWriteLock(workspaceId: string, path: string): Promise<ReleaseFn>;
   ```
4. **Parallel workflows without worktree**: Each parallel stage writes to `output/<stageRunId>/`, merged at completion into `output/` via a post-stage hook.

---

## 16. Event System Integration

### New Event Kinds

```typescript
// Add to AgentEventKind enum in packages/shared/src/types/AgentEvent.ts:
'workspace.created'           // Workspace directory created and initialized
'workspace.ready'             // Worktrees + artifacts staged, SDK ready
'workspace.artifact_written'  // New file written by agent
'workspace.committed'         // Git commit performed (auto or manual)
'workspace.archived'          // Workspace archived to tar.gz
'workspace.deleted'           // Workspace removed from disk
'worktree.created'            // Git worktree created for a codebase
'worktree.pushed'             // Worktree branch pushed to remote
'worktree.pr_created'         // Pull request created from worktree branch
```

### Event Enrichment

All events emitted during an execution MUST carry `workspaceId`:

```typescript
// In EventBus.emit() enrichment (or in WorkflowRunService/ChatManagementService):
const enrichedEvent = createAgentEvent(kind, {
  ...data,
  workspaceId: run.workspaceId,   // Always include workspace reference
});
```

### SSE Subscription

Web client receives workspace events via existing unified stream:

```
GET /api/events/stream?scope=workspace&id=<workspaceId>
```

---

## 17. Platform Client Parity (CLI DirectMode)

### IPlatformClient Extensions

```typescript
// Add to packages/core/src/domain/ports/IPlatformClient.ts:
export interface IPlatformClient {
  // ... existing methods ...

  // Workspace management
  listWorkspaces(filters?: WorkspaceFilters): Promise<WorkspaceInfo[]>;
  getWorkspaceInfo(workspaceId: string): Promise<WorkspaceInfo>;
  getWorkspaceTree(workspaceId: string): Promise<FileTreeNode[]>;
  archiveWorkspace(workspaceId: string): Promise<{ snapshotPath: string }>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  cleanupWorkspaces(policy?: RetentionPolicy): Promise<{ deleted: number }>;

  // Worktree operations
  pushWorktreeBranch(workspaceId: string, alias: string): Promise<void>;
  createWorktreePR(workspaceId: string, alias: string, opts: PROptions): Promise<string>;
}
```

### DirectPlatformClient Implementation

```typescript
// In apps/cli/src/platform/DirectPlatformClient.ts:
class DirectPlatformClient implements IPlatformClient {
  // Direct method calls to WorkspaceManager (no HTTP)
  async listWorkspaces(filters) {
    return this.workspaceManager.listWorkspaces(filters);
  }
  async deleteWorkspace(id) {
    return this.workspaceManager.deleteWorkspace(id);
  }
  // ... etc
}
```

### HttpPlatformClient Implementation

```typescript
// In apps/cli/src/platform/HttpPlatformClient.ts:
class HttpPlatformClient implements IPlatformClient {
  async listWorkspaces(filters) {
    return this.get('/api/workspaces', { params: filters });
  }
  async deleteWorkspace(id) {
    return this.delete(`/api/workspaces/${id}`);
  }
  // ... etc
}
```

---

## 18. Workspace Idempotency & Reentrance

### Problem Scenarios

1. `WorkflowRunService.startRun()` called twice for same runId (retry)
2. Server crashes mid-workspace-creation
3. Workspace directory exists but DB record doesn't (or vice versa)

### Solution: Idempotent createWorkspace()

```typescript
async createWorkspace(params: CreateWorkspaceParams): Promise<ExecutionWorkspace> {
  // Check if workspace already exists for this owner
  const existing = await this.workspaceRepo.findByOwner(params.ownerType, params.ownerId);
  
  if (existing) {
    if (existing.status === 'active' || existing.status === 'completed') {
      return existing;  // Idempotent: return existing workspace
    }
    if (existing.status === 'creating' || existing.status === 'failed') {
      // Previous attempt failed; cleanup and recreate
      await this.forceCleanup(existing.id);
    }
  }

  // Proceed with creation...
  const workspace = { id: generateId(), status: 'creating', ... };
  await this.workspaceRepo.create(workspace);
  
  try {
    await this.setupDirectories(workspace);
    await this.setupWorktrees(workspace, params);
    await this.stageArtifacts(workspace, params);
    await this.workspaceRepo.updateStatus(workspace.id, 'active');
    return { ...workspace, status: 'active' };
  } catch (error) {
    await this.workspaceRepo.updateStatus(workspace.id, 'failed');
    throw error;
  }
}
```

### Startup Recovery

```typescript
// In StartupRecoveryService (already exists):
async recoverOrphanedWorkspaces() {
  // Find workspaces stuck in 'creating' status (server crashed mid-creation)
  const orphaned = await this.workspaceRepo.list({ status: 'creating' });
  for (const ws of orphaned) {
    if (Date.now() - ws.createdAt > 5 * 60 * 1000) { // 5min stale
      await this.workspaceManager.forceCleanup(ws.id);
    }
  }
}
```

---

## 19. Disk Quota Enforcement

### Pre-Creation Check

```typescript
async createWorkspace(params: CreateWorkspaceParams): Promise<ExecutionWorkspace> {
  // Check disk budget before creating
  const currentUsage = await this.calculateTotalDiskUsage();
  if (currentUsage > this.config.workspace.maxDiskUsageMB * 1024 * 1024) {
    // Try cleanup: delete oldest completed workspaces
    const freed = await this.cleanupExpiredWorkspaces({
      completedRetentionHours: 0,  // Delete ALL completed that are safe
      protectUnpushed: true,
    });
  
    if (freed === 0) {
      throw new DiskQuotaExceededError(currentUsage, this.config.workspace.maxDiskUsageMB);
    }
  }
  // Proceed with creation...
}
```

### Background Monitor

```typescript
// Periodic check (runs every cleanupIntervalMinutes):
class WorkspaceCleanupService {
  async sweep() {
    // 1. Delete expired completed workspaces (past retention)
    await this.workspaceManager.cleanupExpiredWorkspaces(this.policy);
  
    // 2. Check total disk usage
    const usage = await this.workspaceManager.calculateTotalDiskUsage();
    if (usage > this.config.workspace.maxDiskUsageMB * 0.9) {
      this.logger.warn('Workspace disk usage at 90%+', { usageMB: usage / (1024*1024) });
      // Emit event for UI notification
      this.eventBus.emit(createAgentEvent('system.disk_warning', { usage }));
    }
  }
}
```

---

## 20. Symlink Escape Prevention

### Enhanced PathResolver

```typescript
export class PathResolver {
  async resolveWithinWorkspace(workspaceRoot: string, relativePath: string): Promise<string> {
    // Step 1: Resolve the path (removes ../, ./)
    const resolved = path.resolve(workspaceRoot, relativePath);
  
    // Step 2: Check logical path is within boundary
    const normalizedRoot = path.resolve(workspaceRoot);
    if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
      throw new PathEscapeError(relativePath, workspaceRoot);
    }
  
    // Step 3: Check REAL path (follows symlinks) to detect symlink escape
    try {
      const realPath = await fs.realpath(resolved);
      const realRoot = await fs.realpath(workspaceRoot);
      if (!realPath.startsWith(realRoot + path.sep) && realPath !== realRoot) {
        throw new SymlinkEscapeError(relativePath, realPath, workspaceRoot);
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        // File doesn't exist yet (being created); validate parent
        const parentDir = path.dirname(resolved);
        if (await this.pathExists(parentDir)) {
          const realParent = await fs.realpath(parentDir);
          const realRoot = await fs.realpath(workspaceRoot);
          if (!realParent.startsWith(realRoot + path.sep) && realParent !== realRoot) {
            throw new SymlinkEscapeError(relativePath, realParent, workspaceRoot);
          }
        }
        return resolved;
      }
      throw e;
    }
  
    return resolved;
  }
}
```

---

## 21. Migration Transition Plan

### Phase Transition: Old → New Directory System

```
Phase A (Current):
  projects/<pid>/worktrees/<runId>/<alias>/
  artifacts/runs/<runId>/workspace/
  artifacts/runs/<runId>/artifacts/

Phase B (Transition — both systems active):
  NEW runs: workspaces/executions/<runId>/source/<alias>/
  OLD runs: continue using old paths (via workspace_id NULL check)
  
Phase C (Full Migration):
  ALL new executions use workspaces/executions/
  Old paths remain read-only for historical access
  
Phase D (Cleanup — optional):
  Remove old directory support
  Archive/delete old artifacts/runs/ directories
```

### Fallback Logic Pattern (used everywhere):

```typescript
function getRunWorkingDirectory(run: WorkflowRun, workspaceManager: WorkspaceManager): string {
  if (run.workspaceId) {
    // New system
    const ws = await workspaceManager.getWorkspaceInfo(run.workspaceId);
    return ws.workingDirectory;
  }
  // Legacy fallback
  return run.variables?.['__workingDirectory'] ?? 
    path.join(artifactsDir, 'runs', run.id, 'workspace');
}
```

---

## Summary of Key Design Decisions

1. **Always create workspace** — Even chats without projects get a workspace (for artifacts, boundary enforcement, future sandbox).
2. **Worktrees INSIDE workspace** — `workspace/source/<alias>/` not `project/worktrees/<runId>/`. This makes the workspace self-contained and volume-mountable.
3. **Single working directory** — SDK gets ONE `workingDirectory`. For multi-codebase scenarios, it points to primary codebase worktree; other codebases accessible via `../other-alias/`.
4. **Git-backed tracking** — Workspace-level `git init` provides history without complex DB artifact tracking. DB stores metadata; git stores content history.
5. **Workspace-level boundary enforcement** — Agent filesystem access is restricted to workspace root. Path traversal attempts are blocked and symlink escapes prevented via `realpath()` checks.
6. **Per-execution isolation** — Every workflow run, chat session, and automation iteration gets its own workspace. No shared mutable state between executions.
7. **DB is the single source of truth for workspace metadata** — File presence on disk is secondary; DB tracks lifecycle, status, ownership, and relationships.
8. **Backward compatible** — Old workspaces without `workspace_id` continue working via legacy path resolution. Migration is gradual with fallback pattern.
9. **Staging area for scripts** — Data-source scripts execute in a staging directory, not inside any run workspace. Output is then staged INTO the run workspace.
10. **Cleanup-safe** — Users can always inspect workspace status (worktrees, uncommitted changes, disk usage) before deciding to archive/delete. System never auto-deletes workspaces with unpushed changes.
11. **Parallel stage awareness** — Shared worktrees enforce sequential writes via atomic operations or file locking; non-worktree parallel stages get partitioned output directories.
12. **Idempotent workspace creation** — `createWorkspace()` is reentrant-safe; duplicate calls return existing workspace or cleanup failed attempts.
13. **Event-driven visibility** — All workspace lifecycle events are broadcast via SSE for real-time UI updates.
14. **Full platform parity** — CLI DirectPlatformClient and HttpPlatformClient both support workspace CRUD operations.
15. **Disk quota enforcement** — Pre-creation budget check with automatic cleanup of expired workspaces; warns at 90% capacity.
