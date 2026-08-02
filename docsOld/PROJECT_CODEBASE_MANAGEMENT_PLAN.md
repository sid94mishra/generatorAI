# Project & Codebase Management — Analysis, Review & Implementation Plan

> **Status:** DRAFT for review  
> **Date:** 2026-04-23  
> **Scope:** First-class Project entity, persistent codebase management, Git worktree support, scoped agents/prompts/skills, workflow/automation scoping

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Modern Agentic Platform Research](#3-modern-agentic-platform-research)
4. [Comparative Analysis & Best Approach](#4-comparative-analysis--best-approach)
5. [Requirements Specification](#5-requirements-specification)
6. [Architecture Design](#6-architecture-design)
7. [Data Model](#7-data-model)
8. [Implementation Plan](#8-implementation-plan)
9. [Migration Strategy](#9-migration-strategy)
10. [Risk Assessment](#10-risk-assessment)

---

## 1. Executive Summary

GeneratorAI currently has **no project abstraction**. Git repositories are transient per-run inputs — each workflow run clones fresh repos, discarding them after execution. There is no persistent codebase management, no project-scoped configuration, and no cross-run repository reuse.

This plan introduces a **Project** as the top-level organizational unit that:
- Groups and persists multiple codebases (git repos or local folders)
- Scopes agents, prompts, skills, and configurations
- Provides persistent clone-once-use-many repository management
- Enables first-class Git worktree support for parallel isolated execution
- Scopes workflows and automations to one or more projects (or global)

### Key Design Principles
1. **Project = isolation boundary** — filesystem, config, and codebase scope
2. **Clone once, worktree many** — bare repos with on-demand worktrees per run
3. **Scoped everything** — agents, prompts, skills, workflows, automations inherit project context
4. **Parallel-safe by default** — worktrees prevent cross-run file conflicts
5. **Progressive adoption** — existing workflows continue working; projects are opt-in

---

## 2. Current State Analysis

### 2.1 Current Git Integration Architecture

| Layer | Component | Location | Current Behavior |
|-------|-----------|----------|-----------------|
| **Infrastructure** | `GitManager` | `packages/core/src/infrastructure/GitManager.ts` | `cloneToDirectory()` does shallow clone per run; `clone()` caches in `~/.generatorai/workspaces/` |
| **Domain Types** | `GitRepositoryConfig` | `packages/shared/src/types/WorkflowOrchestrator.ts` | `{url, branch?, alias, subdirectory?}` — max 3 repos per workflow |
| **Orchestration** | `WorkflowOrchestrator` | `packages/core/src/services/WorkflowOrchestrator.ts` | 5-phase pipeline: workspace setup → git clone → preprocessing → DAG exec → post-processing |
| **Preprocessing** | `WorkflowPreprocessor` | `packages/core/src/services/WorkflowPreprocessor.ts` | Clones each repo to `{runWorkspaceDir}/{alias}/`, creates feature branch |
| **Database** | `workflowDefinitions.orchestratorConfig` | `packages/db/src/schema.ts` | Stores git config as JSON in `orchestratorConfig` column |
| **API** | `/orchestrator/runs` | `apps/server/src/routes/orchestrator.ts` | Accepts `gitRepositories[]` per run invocation |
| **UI** | `WorkflowConfigPanel.tsx` | `apps/web/src/components/workflow/WorkflowConfigPanel.tsx` | Design-time: add up to 3 repos with URL/branch/alias |
| **State** | `workflowBuilderStore` | `apps/web/src/stores/workflowBuilderStore.ts` | Zustand store holds `gitRepositories[]` |

### 2.2 Current Working Directory Structure

```
~/.generatorai/artifacts/
├── runs/{runId}/
│   ├── workspace/           ← Fresh clones per run (WASTEFUL)
│   │   ├── {alias1}/.git/  ← Full clone each time
│   │   └── {alias2}/.git/
│   ├── artifacts/           ← Markdown responses
│   └── uploads/             ← Run-level uploads
│       ├── skills/
│       ├── agents/
│       └── prompts/
└── workflows/{definitionId}/
    └── uploads/             ← Workflow-level shared uploads
        ├── skills/
        ├── agents/
        └── prompts/
```

### 2.3 Critical Gaps

| Gap | Impact |
|-----|--------|
| **No Project entity** | No way to group related repos, workflows, and configurations |
| **Fresh clone per run** | Slow startup, wasted disk, no cross-run codebase continuity |
| **No worktree support** | Cannot run parallel workflows on same codebase without conflicts |
| **Flat upload structure** | Skills/agents/prompts not scoped to projects |
| **No local folder support** | Only git URLs; can't link existing local repos |
| **No persistent codebase** | Run workspace is ephemeral; can't preserve working state |
| **No config inheritance** | No project-level → workflow-level → stage-level config cascade |

---

## 3. Modern Agentic Platform Research

### 3.1 Claude Code (Anthropic)

**Architecture:** Terminal-first agent that operates within a project directory. Git worktrees are a first-class primitive.

| Feature | Implementation |
|---------|---------------|
| **Project context** | Implicit via current working directory; `CLAUDE.md` for project instructions |
| **Skills** | `.claude/skills/*/SKILL.md` — filesystem-based, project-scoped |
| **Agents** | `.claude/agents/*.md` — custom subagent definitions with frontmatter |
| **Git worktrees** | `--worktree <name>` creates `.claude/worktrees/<name>/` with new branch; auto-cleanup on exit |
| **Parallel sessions** | Each worktree is an independent session; sessions scoped per project directory |
| **Agent teams** | Multiple Claude instances with shared task list + mailbox messaging; each teammate in own worktree |
| **Subagent isolation** | `isolation: worktree` in agent frontmatter gives subagent its own worktree |
| **Config inheritance** | `CLAUDE.md` in directory → parent directories → `~/.claude/` (global) |
| **`.worktreeinclude`** | gitignore-syntax file listing gitignored files to copy to worktrees (`.env`, secrets) |
| **Session management** | Per-project sessions; `Ctrl+A` shows all projects; `--from-pr` resumes PR sessions |
| **Cleanup** | Orphaned worktrees auto-cleaned by `cleanupPeriodDays`; uncommitted changes preserved |

**Key Insight:** Claude Code treats the **project directory as the fundamental scope** and uses **git worktrees for isolation** rather than full clones. Configuration is filesystem-based, encouraging repo-checked-in conventions.

### 3.2 OpenAI Codex

**Architecture:** Desktop app + CLI + IDE extension + cloud; project-folder-based.

| Feature | Implementation |
|---------|---------------|
| **Project concept** | Explicit project folder selection on startup; past projects remembered |
| **Skills** | `.codex/skills/` directory — specialized capabilities |
| **AGENTS.md** | Root-level project instructions file |
| **Worktrees** | Built-in worktree support for parallel agent work |
| **Multi-agent** | "Designed for multi-agent workflows" with built-in worktrees and cloud environments |
| **SDK** | TypeScript + Python SDKs for programmatic control; thread-based sessions |
| **Automations** | Background recurring tasks; agents work unprompted |
| **Cloud threads** | Tasks can run in cloud environments, not just local |
| **App Server** | Local server architecture for multi-surface coordination |

**Key Insight:** Codex has an explicit **project selection** step and remembers past projects. The Desktop app acts as a **command center** for managing multiple projects. Built-in worktrees for parallel work across projects.

### 3.3 OpenCode (anomalyco/sst)

**Architecture:** Client/server TUI with provider-agnostic model support.

| Feature | Implementation |
|---------|---------------|
| **Agents** | Two built-in: `build` (full-access) + `plan` (read-only); `@general` subagent |
| **Session management** | Session-based with persistence |
| **Architecture** | Client/server separation allows remote driving (mobile app) |
| **Config** | `.opencode/` directory for project configuration |
| **Provider-agnostic** | Works with Claude, OpenAI, Google, local models |
| **Desktop app** | Cross-platform desktop app (macOS, Windows, Linux) |

**Key Insight:** Client/server separation enables **multi-surface access** to the same project/session from different clients.

### 3.4 CrewAI

**Architecture:** Python framework with Flows (backbone) + Crews (intelligence).

| Feature | Implementation |
|---------|---------------|
| **Flows** | State management, event-driven execution, control flow (loops, branching) |
| **Crews** | Teams of role-playing agents with specific goals + tools |
| **Task delegation** | Tasks assigned and executed based on agent capabilities |
| **State persistence** | Flows persist data across steps and executions |
| **Tool flexibility** | Connect agents to any API, database, or local tool |

**Key Insight:** CrewAI's **Flows+Crews** model maps well to GeneratorAI's **DAG Workflows + Stage Execution**. The state management and event-driven patterns are analogous.

### 3.5 Summary: Industry Patterns

| Pattern | Used By | Applicability to GeneratorAI |
|---------|---------|------------------------------|
| **Project-as-directory** | Claude Code, Codex, OpenCode | ⭐⭐⭐ — Adapt as Project entity with dedicated filesystem root |
| **Git worktrees for isolation** | Claude Code, Codex | ⭐⭐⭐⭐ — Perfect fit for parallel workflow/automation runs |
| **Filesystem-based config** | Claude Code, Codex, OpenCode | ⭐⭐⭐ — Use for project-scoped skills/agents/prompts |
| **Bare repo + worktrees** | Claude Code | ⭐⭐⭐⭐ — Clone once, create worktrees per-run |
| **Config cascade** | Claude Code (CLAUDE.md hierarchy) | ⭐⭐⭐ — Project → Workflow → Stage config inheritance |
| **Agent teams with task lists** | Claude Code, CrewAI | ⭐⭐⭐ — Future: multi-agent orchestration per run |
| **Session per project** | Claude Code, Codex | ⭐⭐⭐⭐ — Natural fit for GeneratorAI's session model |
| **Explicit project selection** | Codex | ⭐⭐⭐⭐ — UI project picker on dashboard |

---

## 4. Comparative Analysis & Best Approach

### 4.1 Approach Options

#### Option A: Claude Code Style — Implicit Project (Directory-Based)
- Project = current working directory
- Config lives in `.generatorai/` within the repo
- No explicit project entity in the database

**Pros:** Simple, convention-over-configuration, git-friendly  
**Cons:** Doesn't work for a web-based platform serving multiple projects via HTTP; no multi-repo grouping

#### Option B: Codex Style — Explicit Project with Folder Selection  
- Project is an explicit entity with a selected root folder
- Skills/agents/prompts live in the project folder
- Database tracks project metadata; filesystem stores content

**Pros:** Clear UX, supports web UI, multi-repo grouping  
**Cons:** Requires project CRUD; more complex

#### Option C: Hybrid — Database-Backed Project with Filesystem Conventions
- **Project** is a first-class DB entity with metadata
- Each project gets a **dedicated filesystem root** under `~/.generatorai/projects/{projectId}/`
- Codebases (git repos + local folders) are registered to projects and persisted on disk
- **Git worktrees** used for per-run isolation from bare/regular clones
- Skills/agents/prompts stored per-project in the filesystem, referenced from DB
- Workflows and automations have a **scope** field: `global | project[] `

**Pros:** Best of both worlds; web UI friendly; filesystem-based config; persistent codebases; worktree isolation  
**Cons:** Most complex to implement

### 4.2 Recommended: Option C (Hybrid)

**Rationale:**
1. GeneratorAI is a **web-based platform** (not a CLI) — needs explicit project entities and API-driven management
2. Multi-repo grouping (up to N repos per project) requires DB-backed relationships
3. Filesystem conventions for skills/agents/prompts enable easy upload + version control
4. Git worktree model from Claude Code is the gold standard for parallel isolation
5. Scope field on workflows/automations enables both project-specific and cross-project usage

---

## 5. Requirements Specification

### 5.1 Project Management

| ID | Requirement | Priority |
|----|-------------|----------|
| P-1 | Users can create, read, update, delete projects | P0 |
| P-2 | Each project has a name, description, and dedicated filesystem root | P0 |
| P-3 | Project dashboard shows linked repos, workflows, automations, and custom configs | P0 |
| P-4 | Project-level settings (default model, session mode, etc.) | P1 |
| P-5 | Project metadata stored in SQLite; filesystem content under `~/.generatorai/projects/{id}/` | P0 |

### 5.2 Codebase/Repository Management

| ID | Requirement | Priority |
|----|-------------|----------|
| R-1 | Users can link multiple code repos (git URL or local path) to a project | P0 |
| R-2 | Each linked repo has: URL/path, default branch, alias, type (git-remote / git-local / folder) | P0 |
| R-3 | Git repos are cloned ONCE into `projects/{id}/repos/{alias}/` (bare clone for remotes) | P0 |
| R-4 | Local folder repos are symlinked or registered by path (no clone) | P0 |
| R-5 | Users can configure repo-level settings: branch, subdirectory focus, auto-fetch interval | P1 |
| R-6 | Repos are refreshed (git fetch) on demand or on schedule, NOT re-cloned | P0 |
| R-7 | Repo status (last fetch, current branch, size, health) visible in UI | P1 |
| R-8 | Max repos per project: configurable, default 10 | P0 |

### 5.3 Workflow & Automation Scoping

| ID | Requirement | Priority |
|----|-------------|----------|
| S-1 | Workflows have a `scope` field: `global` (available to all projects) or `project[]` (specific projects) | P0 |
| S-2 | Automations have the same `scope` field | P0 |
| S-3 | When linking a workflow to a git repo, only repos configured in the project's linked repos are available | P0 |
| S-4 | Max 3 repos selectable per workflow run (existing limit preserved) | P0 |
| S-5 | Workflows list view can filter by project scope | P1 |

### 5.4 Project-Scoped Agents, Prompts, Skills

| ID | Requirement | Priority |
|----|-------------|----------|
| A-1 | Each project can have custom agents defined in `projects/{id}/config/agents/` | P0 |
| A-2 | Each project can have custom prompts in `projects/{id}/config/prompts/` | P0 |
| A-3 | Each project can have custom skills in `projects/{id}/config/skills/` | P0 |
| A-4 | Project configs are loaded and merged during workflow orchestration | P0 |
| A-5 | Config cascade: Global defaults → Project config → Workflow config → Stage config | P1 |
| A-6 | UI for uploading and managing agents/prompts/skills per project | P0 |

### 5.5 Git Worktree Support

| ID | Requirement | Priority |
|----|-------------|----------|
| W-1 | Each workflow run creates a worktree from the project's cached repo (not a fresh clone) | P0 |
| W-2 | Worktrees created at `projects/{id}/worktrees/{runId}/{alias}/` | P0 |
| W-3 | Feature branch created per worktree: `generatorai/run-{shortRunId}-{alias}` | P0 |
| W-4 | Multiple workflow runs can execute in parallel on the same codebase via separate worktrees | P0 |
| W-5 | Automations also use worktree model for parallel execution | P0 |
| W-6 | Worktree cleanup policy: configurable retention (immediate, after N hours, manual) | P1 |
| W-7 | Orphaned worktree detection and cleanup | P1 |
| W-8 | Support for `.worktreeinclude` files (copy gitignored files like `.env`) | P2 |

### 5.6 Local Folder & Empty Folder Support

| ID | Requirement | Priority |
|----|-------------|----------|
| L-1 | Users can link a local folder (existing repo or plain directory) to a project | P0 |
| L-2 | For local git repos: worktrees created from the existing repo's git database | P0 |
| L-3 | For plain directories: copy or symlink to run workspace (no git operations) | P0 |
| L-4 | Users can create an empty project folder and link it | P1 |
| L-5 | Path validation ensures the folder exists and is accessible | P0 |

---

## 6. Architecture Design

### 6.1 Filesystem Layout

```
~/.generatorai/
├── config/                        ← Global config (existing)
│   ├── agents/                    ← Global custom agents
│   ├── prompts/                   ← Global custom prompts
│   └── skills/                    ← Global custom skills
├── projects/
│   ├── {projectId}/
│   │   ├── project.json           ← Cached project metadata
│   │   ├── config/
│   │   │   ├── agents/            ← Project-scoped agents
│   │   │   │   └── code-reviewer.md
│   │   │   ├── prompts/           ← Project-scoped prompts
│   │   │   │   └── refactoring.md
│   │   │   └── skills/            ← Project-scoped skills
│   │   │       └── testing/
│   │   │           └── SKILL.md
│   │   ├── repos/
│   │   │   ├── frontend/          ← Bare clone (for remote git repos)
│   │   │   │   └── .git/         ← OR bare repo contents directly
│   │   │   ├── backend/           ← Bare clone
│   │   │   │   └── .git/
│   │   │   └── shared-lib/        ← Symlink to local folder
│   │   │       └── -> /Users/dev/shared-lib
│   │   ├── worktrees/
│   │   │   ├── {runId1}/
│   │   │   │   ├── frontend/      ← Git worktree (checkout)
│   │   │   │   │   ├── src/
│   │   │   │   │   └── ...
│   │   │   │   └── backend/       ← Git worktree (checkout)
│   │   │   └── {runId2}/          ← Parallel run, separate worktrees
│   │   │       ├── frontend/
│   │   │       └── backend/
│   │   └── artifacts/
│   │       └── {runId}/
│   │           ├── artifacts/      ← Non-code markdown responses
│   │           └── uploads/        ← Run-level uploads
│   └── {projectId2}/
│       └── ...
├── artifacts/                      ← Legacy: unscoped runs (backward compat)
│   └── runs/
│       └── {runId}/
└── db/
    └── generatorai.db              ← SQLite (existing)
```

### 6.2 Domain Model

```
┌─────────────┐     1:N     ┌──────────────────┐
│   Project    │────────────▶│  ProjectCodebase │
│              │             │ (linked repo/dir) │
│ id           │             │                  │
│ name         │             │ id               │
│ description  │             │ projectId (FK)   │
│ settings{}   │             │ alias            │
│ createdAt    │             │ type (git-remote  │
│ updatedAt    │             │   | git-local     │
└──────┬───────┘             │   | local-dir)    │
       │                     │ url / path       │
       │ scope               │ defaultBranch    │
       ▼                     │ subdirectory     │
┌──────────────┐             │ status           │
│ WorkflowDef  │             │ lastFetchedAt    │
│              │             │ clonePath        │
│ scope: global│             │ settings{}       │
│  | projectId[]             └──────────────────┘
└──────────────┘
       │ scope               ┌──────────────────┐
       ▼                     │ ProjectConfig    │
┌──────────────┐             │ (agents/prompts/ │
│  Automation  │             │  skills metadata)│
│              │             │                  │
│ scope: global│             │ projectId (FK)   │
│  | projectId[]             │ type (agent |    │
└──────────────┘             │  prompt | skill) │
                             │ name             │
                             │ filePath         │
                             │ description      │
                             └──────────────────┘
```

### 6.3 Worktree Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    WORKFLOW RUN EXECUTION                            │
│                                                                     │
│ 1. User starts run for Workflow W1 (scoped to Project P1)          │
│                                                                     │
│ 2. Orchestrator resolves repos:                                     │
│    - W1 selected repos: ["frontend", "backend"]                     │
│    - Validate repos exist in P1's linked codebases                  │
│                                                                     │
│ 3. For each repo, create worktree:                                  │
│    ┌─────────────────────┐    ┌──────────────────────────────┐     │
│    │ P1/repos/frontend/  │───▶│ P1/worktrees/{runId}/frontend│     │
│    │ (bare clone)        │    │  branch: generatorai/run-xxx │     │
│    └─────────────────────┘    └──────────────────────────────┘     │
│    ┌─────────────────────┐    ┌──────────────────────────────┐     │
│    │ P1/repos/backend/   │───▶│ P1/worktrees/{runId}/backend │     │
│    │ (bare clone)        │    │  branch: generatorai/run-yyy │     │
│    └─────────────────────┘    └──────────────────────────────┘     │
│                                                                     │
│ 4. Set context variables:                                           │
│    repo_path_frontend = <worktree path>                             │
│    repo_path_backend = <worktree path>                              │
│                                                                     │
│ 5. Load project config:                                             │
│    - Merge: Global → P1 agents/prompts/skills → W1 config           │
│    - Inject into stage execution context                             │
│                                                                     │
│ 6. Execute DAG stages (existing pipeline)                           │
│                                                                     │
│ 7. Post-processing: commit/push/PR from worktree                   │
│                                                                     │
│ 8. Cleanup: configurable (immediate/retain/manual)                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.4 Parallel Execution Safety

```
Project P1 has repos: frontend, backend

 Time ──────────────────────────────────────────▶

 Run A  ├── worktrees/runA/frontend (branch: generatorai/run-a-frontend)
 (W1)   ├── worktrees/runA/backend  (branch: generatorai/run-a-backend)
        │
 Run B  ├── worktrees/runB/frontend (branch: generatorai/run-b-frontend)
 (W2)   ├── worktrees/runB/backend  (branch: generatorai/run-b-backend)
        │
 Auto C ├── worktrees/autoC/frontend (branch: generatorai/auto-c-frontend)
 (cron) └── worktrees/autoC/backend  (branch: generatorai/auto-c-backend)

All three operate in parallel with ZERO conflicts.
Each has its own working directory and branch.
The bare repo in repos/ is shared (read-only for worktree creation).
```

---

## 7. Data Model

### 7.1 New Database Tables

```sql
-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  settings TEXT DEFAULT '{}',     -- JSON: ProjectSettings
  rootPath TEXT NOT NULL,          -- Filesystem root: ~/.generatorai/projects/{id}
  status TEXT DEFAULT 'active',    -- active | archived
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Project Codebases (linked repos/directories)
CREATE TABLE IF NOT EXISTS project_codebases (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,             -- Unique within project
  type TEXT NOT NULL,              -- 'git-remote' | 'git-local' | 'local-dir'
  url TEXT,                        -- Git URL (for git-remote)
  localPath TEXT,                  -- Local filesystem path (for git-local, local-dir)
  defaultBranch TEXT,              -- Default branch to checkout
  subdirectory TEXT,               -- Focus subdirectory within repo
  clonePath TEXT,                  -- Resolved clone/link path on disk
  status TEXT DEFAULT 'pending',   -- pending | cloning | ready | error | stale
  lastFetchedAt TEXT,
  lastError TEXT,
  settings TEXT DEFAULT '{}',      -- JSON: CodebaseSettings (auto-fetch interval, etc.)
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(projectId, alias)
);

-- Project Configs (agents/prompts/skills metadata)
CREATE TABLE IF NOT EXISTS project_configs (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,              -- 'agent' | 'prompt' | 'skill'
  name TEXT NOT NULL,
  description TEXT,
  filePath TEXT NOT NULL,          -- Relative path within project config dir
  metadata TEXT DEFAULT '{}',      -- JSON: type-specific metadata
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(projectId, type, name)
);

-- Worktree tracking (for cleanup and status)
CREATE TABLE IF NOT EXISTS worktrees (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  codebaseId TEXT NOT NULL REFERENCES project_codebases(id) ON DELETE CASCADE,
  runId TEXT,                      -- WorkflowRun ID or Automation execution ID
  runType TEXT,                    -- 'workflow' | 'automation' | 'manual'
  worktreePath TEXT NOT NULL,      -- Absolute filesystem path
  branchName TEXT NOT NULL,        -- Git branch name
  status TEXT DEFAULT 'active',    -- active | completed | orphaned | cleanup-pending
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  cleanedUpAt TEXT
);
```

### 7.2 Schema Modifications to Existing Tables

```sql
-- Add scope columns to workflowDefinitions
ALTER TABLE workflowDefinitions ADD COLUMN scope TEXT DEFAULT 'global';
-- scope values: 'global' | JSON array of projectIds e.g. '["proj-1","proj-2"]'

-- Add scope columns to automations
ALTER TABLE automations ADD COLUMN scope TEXT DEFAULT 'global';

-- Add projectId to workflowRuns for run-level tracking
ALTER TABLE workflowRuns ADD COLUMN projectId TEXT;

-- Add projectId to chats
ALTER TABLE chats ADD COLUMN projectId TEXT;
```

### 7.3 TypeScript Types

```typescript
// packages/shared/src/types/Project.ts

export interface Project {
  id: string;
  name: string;
  description?: string;
  settings: ProjectSettings;
  rootPath: string;
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSettings {
  defaultModel?: string;
  defaultSessionMode?: 'single' | 'per-stage' | 'auto';
  maxCodebases?: number;         // Default: 10
  worktreeRetention?: 'immediate' | 'hours-24' | 'hours-72' | 'manual';
  autoFetchInterval?: number;    // Minutes, 0 = disabled
  copilotConfig?: Partial<CopilotConfig>;
}

export type CodebaseType = 'git-remote' | 'git-local' | 'local-dir';

export interface ProjectCodebase {
  id: string;
  projectId: string;
  alias: string;
  type: CodebaseType;
  url?: string;                  // For git-remote
  localPath?: string;            // For git-local, local-dir
  defaultBranch?: string;
  subdirectory?: string;
  clonePath?: string;
  status: 'pending' | 'cloning' | 'ready' | 'error' | 'stale';
  lastFetchedAt?: Date;
  lastError?: string;
  settings: CodebaseSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface CodebaseSettings {
  autoFetchEnabled?: boolean;
  autoFetchIntervalMinutes?: number;
  shallowClone?: boolean;        // Default false (bare clone)
  worktreeInclude?: string[];     // Files to copy into worktrees (like .env)
}

export type ConfigType = 'agent' | 'prompt' | 'skill';

export interface ProjectConfig {
  id: string;
  projectId: string;
  type: ConfigType;
  name: string;
  description?: string;
  filePath: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorktreeInfo {
  id: string;
  projectId: string;
  codebaseId: string;
  runId?: string;
  runType?: 'workflow' | 'automation' | 'manual';
  worktreePath: string;
  branchName: string;
  status: 'active' | 'completed' | 'orphaned' | 'cleanup-pending';
  createdAt: Date;
  cleanedUpAt?: Date;
}

// Scope type for workflow definitions and automations
export type EntityScope = 'global' | string[]; // string[] = array of projectIds
```

---

## 8. Implementation Plan

### Phase 1: Foundation — Project Entity + Database (Week 1-2)

#### 8.1.1 Database Schema Changes
- [ ] Add `projects` table to `packages/db/src/schema.ts`
- [ ] Add `project_codebases` table
- [ ] Add `project_configs` table  
- [ ] Add `worktrees` table
- [ ] Add `scope` column to `workflowDefinitions` and `automations`
- [ ] Add `projectId` column to `workflowRuns` and `chats`
- [ ] Update `migrateDB()` in `packages/db/src/index.ts` with `CREATE TABLE IF NOT EXISTS` + `addColumnIfNotExists()`

#### 8.1.2 Repository Layer (packages/db)
- [ ] Create `ProjectRepository` — CRUD for projects
- [ ] Create `ProjectCodebaseRepository` — CRUD for linked codebases
- [ ] Create `ProjectConfigRepository` — CRUD for agents/prompts/skills metadata
- [ ] Create `WorktreeRepository` — Track worktree lifecycle
- [ ] Add `scope` filtering to `WorkflowDefinitionRepository` queries
- [ ] Add `scope` filtering to `AutomationRepository` queries

#### 8.1.3 Shared Types
- [ ] Create `packages/shared/src/types/Project.ts` with all interfaces
- [ ] Add `EntityScope` type
- [ ] Export from `packages/shared/src/index.ts`

### Phase 2: Core Services — Project & Codebase Management (Week 2-3)

#### 8.2.1 ProjectService (packages/core)
```
packages/core/src/services/ProjectService.ts
```
- [ ] `createProject(name, description?, settings?)` — Create project + filesystem root
- [ ] `getProject(id)` / `listProjects(filter?)` / `updateProject(id, changes)` / `archiveProject(id)`
- [ ] `getProjectWithCodebases(id)` — Full project with all linked repos
- [ ] `getProjectConfigs(id, type?)` — Get agents/prompts/skills for a project
- [ ] `resolveProjectConfigCascade(projectId, workflowDefId?)` — Merge global → project → workflow configs

#### 8.2.2 CodebaseService (packages/core)
```
packages/core/src/services/CodebaseService.ts
```
- [ ] `linkCodebase(projectId, config)` — Register codebase + trigger clone/link
- [ ] `unlinkCodebase(codebaseId)` — Remove codebase + cleanup
- [ ] `cloneRemoteRepo(codebase)` — Bare clone to `projects/{id}/repos/{alias}/`
- [ ] `linkLocalRepo(codebase)` — Register local path (validate git repo or plain dir)
- [ ] `fetchCodebase(codebaseId)` — `git fetch --all` on bare clone
- [ ] `fetchAllCodebases(projectId)` — Batch fetch all project repos
- [ ] `getCodebaseStatus(codebaseId)` — Branch info, disk size, last fetch, health
- [ ] `listBranches(codebaseId)` — List available branches from bare clone
- [ ] `validateCodebaseAccess(codebaseId)` — Check URL reachable / path exists

#### 8.2.3 WorktreeService (packages/core)  
```
packages/core/src/services/WorktreeService.ts
```
- [ ] `createWorktree(codebaseId, runId, options?)` — `git worktree add` from bare clone
- [ ] `removeWorktree(worktreeId)` — `git worktree remove` + cleanup
- [ ] `listWorktrees(projectId?, runId?)` — List active worktrees
- [ ] `cleanupOrphanedWorktrees(projectId, maxAge?)` — Auto-cleanup stale worktrees
- [ ] `getWorktreeStatus(worktreeId)` — Git status, diff stats, branch info
- [ ] `applyWorktreeInclude(worktreePath, codebase)` — Copy `.env` and other files
- [ ] `createRunWorktrees(projectId, runId, selectedRepos[])` — Create worktrees for all run repos

#### 8.2.4 ProjectConfigService (packages/core)
```
packages/core/src/services/ProjectConfigService.ts
```
- [ ] `uploadConfig(projectId, type, file)` — Save agent/prompt/skill to project filesystem
- [ ] `deleteConfig(configId)` — Remove from filesystem + DB
- [ ] `listConfigs(projectId, type?)` — List all configs
- [ ] `getConfigContent(configId)` — Read file content
- [ ] `scanProjectConfigs(projectId)` — Scan filesystem and sync DB metadata

### Phase 3: Orchestration Integration (Week 3-4)

#### 8.3.1 Modify WorkflowOrchestrator
- [ ] **Phase 0 (Workspace Setup):** If workflow has `projectId`, resolve from project filesystem
- [ ] **Phase 1 (Git Clone):** Replace `cloneToDirectory()` with `WorktreeService.createRunWorktrees()`
- [ ] **Phase 2 (Preprocessing):** Inject project config cascade (agents/prompts/skills)
- [ ] **Phase 3 (Upload Wire):** Merge project-level + workflow-level + run-level uploads
- [ ] **Post-execution:** Worktree cleanup based on project retention policy

#### 8.3.2 Modify WorkflowPreprocessor
- [ ] Replace `GitManager.cloneToDirectory()` calls with `WorktreeService.createWorktree()`
- [ ] For local-dir codebases: copy or symlink instead of git worktree
- [ ] Preserve backward compat: if no projectId, fall back to legacy clone behavior

#### 8.3.3 Modify ConfigResolver
- [ ] Add project-level config layer to the resolution cascade
- [ ] `resolveConfig(projectId?, workflowDefId, stageDefId?)` → merged config

#### 8.3.4 Modify AutomationService
- [ ] Add project scope awareness
- [ ] Use `WorktreeService` for automation executions
- [ ] Support parallel automation runs via separate worktrees

#### 8.3.5 GitManager Updates
- [ ] Add `bareClone(repoUrl, targetDir)` — `git clone --bare`
- [ ] Add `createWorktree(bareRepoPath, worktreePath, branch, baseBranch?)` — `git worktree add`
- [ ] Add `removeWorktree(bareRepoPath, worktreePath)` — `git worktree remove`
- [ ] Add `listWorktrees(bareRepoPath)` — `git worktree list --porcelain`
- [ ] Add `fetchAll(bareRepoPath)` — `git fetch --all --prune`
- [ ] Add `getBranches(bareRepoPath)` — `git branch -a`
- [ ] Keep existing methods for backward compatibility

### Phase 4: Server API Layer (Week 4-5)

#### 8.4.1 Project Routes (`apps/server/src/routes/projects.ts`)

```
POST   /api/projects                    — Create project
GET    /api/projects                    — List projects
GET    /api/projects/:id                — Get project details
PUT    /api/projects/:id                — Update project
DELETE /api/projects/:id                — Archive/delete project

POST   /api/projects/:id/codebases      — Link codebase to project
GET    /api/projects/:id/codebases      — List project codebases
PUT    /api/projects/:id/codebases/:cid — Update codebase config
DELETE /api/projects/:id/codebases/:cid — Unlink codebase
POST   /api/projects/:id/codebases/:cid/fetch  — Trigger git fetch
GET    /api/projects/:id/codebases/:cid/branches — List branches
GET    /api/projects/:id/codebases/:cid/status   — Get codebase status

POST   /api/projects/:id/configs        — Upload agent/prompt/skill
GET    /api/projects/:id/configs        — List project configs
GET    /api/projects/:id/configs/:cid   — Get config content
DELETE /api/projects/:id/configs/:cid   — Delete config

GET    /api/projects/:id/worktrees      — List active worktrees
DELETE /api/projects/:id/worktrees/:wid — Remove specific worktree
POST   /api/projects/:id/worktrees/cleanup — Trigger orphan cleanup
```

#### 8.4.2 Modify Existing Routes
- [ ] `POST /orchestrator/runs` — Accept optional `projectId`; resolve repos from project codebases
- [ ] `GET /api/workflow-definitions` — Add `?scope=global|projectId` filter
- [ ] `GET /api/automations` — Add `?scope=global|projectId` filter
- [ ] `PUT /api/workflow-definitions/:id` — Accept `scope` field update
- [ ] `PUT /api/automations/:id` — Accept `scope` field update

#### 8.4.3 Composition Root Updates
- [ ] Wire `ProjectService`, `CodebaseService`, `WorktreeService`, `ProjectConfigService`
- [ ] Wire new repositories
- [ ] Register project routes

### Phase 5: Web UI (Week 5-7)

#### 8.5.1 Project Management Pages

**New Pages:**
- [ ] `/projects` — Projects list/dashboard (new top-level nav item)
- [ ] `/projects/:id` — Project detail/dashboard
- [ ] `/projects/:id/codebases` — Manage linked repos
- [ ] `/projects/:id/config` — Manage agents/prompts/skills
- [ ] `/projects/new` — Create project wizard

**Project Dashboard (`/projects/:id`):**
- Project name, description, status
- Linked codebases with status badges
- Recent workflow runs scoped to this project
- Active worktrees
- Quick actions: add codebase, create workflow, run automation

#### 8.5.2 Codebase Management UI

**Add Codebase Dialog:**
- Type selector: Remote Git | Local Git Repo | Local Folder
- For Remote Git: URL input + branch + alias + clone button (with progress)
- For Local Git: folder picker + alias + branch
- For Local Folder: folder picker + alias
- Clone status indicator (pending → cloning → ready / error)
- Fetch button per codebase (with last-fetched timestamp)

**Codebase Status Panel:**
- List of linked codebases with: alias, type badge, status, last fetch
- Expandable: branches, disk size, subdirectory config
- Actions: fetch, edit, unlink

#### 8.5.3 Workflow Builder Integration

**Modify WorkflowConfigPanel:**
- [ ] Add project selector dropdown (if workflow is project-scoped)
- [ ] When project selected, repo picker shows ONLY that project's linked codebases
- [ ] Max 3 repo selection with checkboxes
- [ ] Show codebase status (ready/stale/error) in picker
- [ ] Scope selector: Global | Specific Projects (multi-select)

**Modify WorkflowDefinitionPage (Run dialog):**
- [ ] If workflow is project-scoped, auto-resolve repos from project
- [ ] Show which project context will be loaded
- [ ] Show selected repos with branch info

#### 8.5.4 Automation Builder Integration
- [ ] Add scope selector to automation configuration
- [ ] Project repos available for automation codebase linking

#### 8.5.5 Config Management UI
- [ ] Upload agents/prompts/skills files per project
- [ ] Preview uploaded config files
- [ ] Delete/replace configs
- [ ] Show config cascade visualization

#### 8.5.6 Stores & API Client Updates
- [ ] Create `projectStore` (Zustand) — project list, active project
- [ ] Create `codebaseStore` — codebases per project
- [ ] Add project-related queries to TanStack Query hooks
- [ ] Update `workflowBuilderStore` — add `scope` and `projectId` fields
- [ ] Update platform client with project API methods

### Phase 6: CLI Integration (Week 7-8)

#### 8.6.1 CLI Commands
```
generatorai projects list                    — List all projects
generatorai projects create <name>           — Create project
generatorai projects show <id>               — Show project details
generatorai projects codebases add <projId>  — Link codebase
generatorai projects codebases list <projId> — List codebases
generatorai projects codebases fetch <projId> [alias] — Fetch repo(s)
generatorai projects config upload <projId> <type> <file> — Upload config
generatorai projects worktrees list <projId> — List worktrees
generatorai projects worktrees cleanup <projId> — Cleanup orphans
```

#### 8.6.2 CLI Workflow/Automation Updates
- [ ] `generatorai workflow run` — Accept `--project <id>` flag
- [ ] `generatorai workflow list` — Add `--scope project|global` filter
- [ ] Update `DirectPlatformClient` with project API methods
- [ ] Update `HttpPlatformClient` with project API methods

### Phase 7: Worktree Lifecycle & Cleanup (Week 8)

#### 8.7.1 Worktree Cleanup Service
```
packages/core/src/services/WorktreeCleanupService.ts
```
- [ ] Background cleanup based on retention policy
- [ ] Orphan detection: worktrees whose run has terminal status but worktree not cleaned
- [ ] Configurable cleanup intervals
- [ ] Safe cleanup: check for uncommitted changes before removing
- [ ] Emit events on cleanup for observability

#### 8.7.2 Startup Recovery
- [ ] Add worktree health check to `StartupRecoveryService`
- [ ] Detect orphaned worktrees from crashed runs
- [ ] Queue cleanup for orphans older than threshold

---

## 9. Migration Strategy

### 9.1 Backward Compatibility

The migration is **fully backward compatible**:

1. **Existing workflows** without `projectId` continue using legacy clone behavior
2. **`scope` defaults to `'global'`** — all existing workflows/automations remain globally visible
3. **New columns use `addColumnIfNotExists()`** — no breaking schema changes
4. **New tables use `CREATE TABLE IF NOT EXISTS`** — safe idempotent migration
5. **WorkflowOrchestrator** checks for `projectId`: if absent, falls back to existing `cloneToDirectory()` path

### 9.2 Data Migration

```typescript
// In migrateDB():
// 1. Create new tables
// 2. Add new columns to existing tables
// 3. No data migration needed — all existing data continues working as global scope
```

### 9.3 Gradual Rollout

1. **Phase 1-3:** Backend only — no UI changes, no breaking changes
2. **Phase 4:** API layer — new endpoints alongside existing ones
3. **Phase 5:** UI — add Projects nav item; existing pages unchanged
4. **Phase 6-7:** CLI + lifecycle — additive commands

Users can adopt projects at their own pace. Existing workflows remain functional.

---

## 10. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Bare clone disk space** | Medium | Bare clones are smaller than regular clones; add disk usage monitoring |
| **Worktree branch conflicts** | Low | Branch names include runId, ensuring uniqueness |
| **Concurrent worktree creation** | Medium | Use filesystem locks or sequential worktree creation per bare repo |
| **Stale bare clones** | Low | Auto-fetch on schedule + manual fetch button |
| **Windows path length** | Medium | Use short project IDs; consider `--short-paths` git option |
| **Local folder permissions** | Low | Validate access on link; graceful error on unavailable |
| **Migration complexity** | Low | Fully additive; no breaking changes |
| **Performance: many worktrees** | Medium | Git handles up to ~100 worktrees well; add soft limit |
| **Orphaned worktrees** | Medium | Background cleanup service with configurable retention |
| **Config cascade complexity** | Low | Clear precedence: global < project < workflow < stage; last wins |

---

## Appendix A: API Examples

### Create a Project
```http
POST /api/projects
Content-Type: application/json

{
  "name": "E-Commerce Platform",
  "description": "Main product codebases",
  "settings": {
    "defaultModel": "gpt-4",
    "worktreeRetention": "hours-24",
    "autoFetchInterval": 60
  }
}
```

### Link a Remote Git Repo
```http
POST /api/projects/proj-123/codebases
Content-Type: application/json

{
  "alias": "frontend",
  "type": "git-remote",
  "url": "https://github.com/org/frontend.git",
  "defaultBranch": "main",
  "subdirectory": "src"
}
```

### Link a Local Folder
```http
POST /api/projects/proj-123/codebases
Content-Type: application/json

{
  "alias": "shared-utils",
  "type": "local-dir",
  "localPath": "/Users/dev/shared-utils"
}
```

### Start Workflow Run with Project Context
```http
POST /orchestrator/runs
Content-Type: application/json

{
  "workflowDefinitionId": "wf-456",
  "projectId": "proj-123",
  "selectedCodebases": ["frontend", "backend"],
  "variables": {
    "target_branch": "develop"
  }
}
```

---

## Appendix B: Config Cascade Example

```
Global Config (~/. generatorai/config/)
  └─ agents/code-reviewer.md        ← Available to ALL workflows
  └─ skills/testing/SKILL.md

Project Config (projects/{id}/config/)
  └─ agents/security-auditor.md     ← Available to project workflows only
  └─ prompts/refactoring.md
  └─ skills/frontend-testing/SKILL.md

Workflow Config (orchestratorConfig.uploads)
  └─ agents/domain-expert.md        ← Available to this workflow only
  └─ prompts/code-gen.md

Merged Result (at runtime):
  agents: [code-reviewer, security-auditor, domain-expert]
  prompts: [refactoring, code-gen]
  skills: [testing, frontend-testing]
```

---

## Appendix C: File Counts & Complexity Estimate

| Area | New Files | Modified Files | Estimated Complexity |
|------|-----------|----------------|---------------------|
| **DB Schema + Migration** | 0 | 1 (`packages/db/src/schema.ts`) | Low |
| **DB Repositories** | 4 | 0 | Medium |
| **Shared Types** | 1 | 2 (exports) | Low |
| **Core Services** | 5 | 4 (orchestrator, preprocessor, config, automation) | High |
| **Core Infrastructure** | 0 | 1 (`GitManager.ts`) | Medium |
| **Core Ports** | 4 | 0 | Low |
| **Server Routes** | 1 | 3 (orchestrator, workflow-defs, automations) | Medium |
| **Server Composition Root** | 0 | 1 | Low |
| **Web Pages** | 5 | 3 (workflow builder, automation, nav) | High |
| **Web Stores** | 2 | 2 | Medium |
| **Web API Client** | 0 | 1 | Low |
| **CLI Commands** | 1 | 2 | Medium |
| **CLI Platform Clients** | 0 | 2 | Low |
| **Tests** | 8+ | 3+ | Medium |
| **Total** | ~31 new files | ~25 modified files | |

---

## Appendix D: Worktree Git Commands Reference

```bash
# Create bare clone (one-time per codebase)
git clone --bare https://github.com/org/repo.git projects/{id}/repos/{alias}

# Fetch latest (periodic refresh)
git -C projects/{id}/repos/{alias} fetch --all --prune

# Create worktree for a run
git -C projects/{id}/repos/{alias} worktree add \
  projects/{id}/worktrees/{runId}/{alias} \
  -b generatorai/run-{shortRunId}-{alias} \
  origin/main

# List worktrees
git -C projects/{id}/repos/{alias} worktree list --porcelain

# Remove worktree
git -C projects/{id}/repos/{alias} worktree remove \
  projects/{id}/worktrees/{runId}/{alias}

# Prune stale worktree refs
git -C projects/{id}/repos/{alias} worktree prune

# For local-dir type: just symlink
ln -s /original/path projects/{id}/repos/{alias}

# For local git repo: worktree from existing
git -C /existing/repo worktree add \
  projects/{id}/worktrees/{runId}/{alias} \
  -b generatorai/run-{shortRunId}-{alias}
```

---

*End of plan — ready for review.*
