# GeneratorAI — Complete User Guide

> **Version:** 2.0 | **Last Updated:** March 2026  
> **Audience:** Developers, AI Agents, and LLMs using GeneratorAI  
> **Purpose:** End-to-end guide for using GeneratorAI to build, run, and manage multi-stage AI workflows

---

## Table of Contents

1. [What is GeneratorAI?](#1-what-is-generatorai)
2. [Getting Started](#2-getting-started)
3. [Dashboard Overview](#3-dashboard-overview)
4. [Chats — AI Conversations](#4-chats--ai-conversations)
5. [Workflows — Multi-Stage AI Pipelines](#5-workflows--multi-stage-ai-pipelines)
6. [Templates — Pre-Built Workflow Patterns](#6-templates--pre-built-workflow-patterns)
7. [Creating a Workflow — Step by Step](#7-creating-a-workflow--step-by-step)
8. [Configuring Stages — Complete Reference](#8-configuring-stages--complete-reference)
9. [Running a Workflow — Execution Guide](#9-running-a-workflow--execution-guide)
10. [Monitoring a Running Workflow](#10-monitoring-a-running-workflow)
11. [Workflow Results — Files, Artifacts, and Status](#11-workflow-results--files-artifacts-and-status)
12. [Workflow Lifecycle — End to End](#12-workflow-lifecycle--end-to-end)
13. [Sessions — Legacy Concept](#13-sessions--legacy-concept)
14. [CLI Reference](#14-cli-reference)
15. [API Reference for AI Agents](#15-api-reference-for-ai-agents)
16. [Configuration Reference](#16-configuration-reference)
17. [System Workflow Templates — Detailed Reference](#17-system-workflow-templates--detailed-reference)
18. [Keyboard Shortcuts](#18-keyboard-shortcuts)
19. [Troubleshooting](#19-troubleshooting)

---

## 1. What is GeneratorAI?

GeneratorAI is an **AI-powered workflow orchestration platform** that enables developers and AI agents to build, execute, and manage multi-stage AI pipelines. It uses GitHub Copilot as its AI backbone and organizes work into:

- **Chats** — Direct conversational interactions with AI (like ChatGPT, but integrated)
- **Workflows** — Multi-stage DAG (Directed Acyclic Graph) pipelines where each stage is an AI task
- **Templates** — Pre-built workflow patterns for common tasks (code generation, code review, testing, refactoring)

### Key Capabilities

| Capability | Description |
|---|---|
| **Visual DAG Builder** | Drag-and-drop workflow editor with auto-layout |
| **Multi-Stage Pipelines** | Chain AI tasks with dependencies and conditions |
| **Real-Time Streaming** | Live token-by-token output via SSE |
| **Template Library** | 5 system templates + custom JSON import |
| **Git Integration** | Clone repos, create branches, commit & push |
| **File Generation** | Automatic code extraction and workspace persistence |
| **Parallel Execution** | Stages run concurrently when dependencies allow |
| **Conditional Logic** | Branch workflows based on stage success/failure |
| **CLI & Web UI** | Full-featured command-line and browser interfaces |
| **AI Agent Friendly** | Complete REST API for programmatic control |

### Architecture at a Glance

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Web UI    │    │     CLI     │    │  AI Agent   │
│ (React)     │    │ (Commander) │    │ (REST API)  │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌──────────────────────────────────────────────────┐
│              Express API Server                  │
│  REST Endpoints + SSE Streaming + File Uploads   │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│              Core Engine                         │
│  WorkflowOrchestrator → DAGScheduler →           │
│  StageExecutionService → SessionAllocator        │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│         GitHub Copilot SDK (LLM Backend)         │
└──────────────────────────────────────────────────┘
```

---

## 2. Getting Started

### Prerequisites

- **Node.js** 18+ and **pnpm** package manager
- **GitHub Copilot** license (for AI capabilities)
- A modern browser (Chrome, Edge, Firefox) for the Web UI

### Installation

```bash
# Clone the repository
git clone <repo-url> GeneratorAI
cd GeneratorAI

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Starting the Application

**Option 1: Development Mode (Web + Server)**
```bash
# Start the development server (API + Web UI)
pnpm dev
```
This starts:
- **API Server** at `http://localhost:3100`
- **Web UI** at `http://localhost:5173`

**Option 2: CLI Mode**
```bash
# Run CLI commands directly
pnpm cli <command>

# Or use the CLI globally
pnpm cli workflow list
pnpm cli c start
```

### First Steps

1. Open `http://localhost:5173` in your browser
2. The **Dashboard** shows activity stats and quick actions
3. Click **"New Chat"** to start a conversation with AI
4. Click **"New Workflow"** to build a multi-stage pipeline
5. Browse **Templates** for pre-built workflow patterns

---

## 3. Dashboard Overview

The Dashboard is the landing page showing:

| Section | Description |
|---|---|
| **Active Chats** | Number of ongoing AI conversations |
| **Workflows** | Total workflow definitions created |
| **Active Runs** | Currently executing workflow runs |
| **Completed** | Successfully finished runs |

### Quick Actions

- **New Chat** — Start a conversational AI session
- **New Workflow** — Open the visual DAG builder
- **Browse Workflows** — View and run existing workflows

### Recent Activity

Shows recent chats and workflow runs with status badges and timestamps.

---

## 4. Chats — AI Conversations

Chats are **direct conversations with GitHub Copilot**. Each chat is a first-class entity with its own session and conversation history.

### Creating a Chat

**Web UI:**
1. Click **"+ New Chat"** in the sidebar or dashboard
2. A new chat is created with status `active`
3. Start typing in the message input at the bottom

**CLI:**
```bash
pnpm cli c start
```

**API:**
```http
POST /api/chats
Content-Type: application/json

{
  "name": "My Chat",
  "description": "Optional description"
}
```

### Chat Features

| Feature | How |
|---|---|
| **Send Messages** | Type in the input box, press Ctrl+Enter or click Send |
| **File Attachments** | Click the attachment icon to upload files with your prompt |
| **Real-Time Streaming** | See AI responses token-by-token as they generate |
| **Thinking Blocks** | View AI reasoning process (collapsible sections) |
| **Tool Calls** | See tools the AI uses (code execution, file ops, etc.) |
| **System Messages** | View system-level messages and sub-agent activity |
| **Markdown Rendering** | AI responses render with full Markdown support |
| **Search Chats** | Search across all chats by name |
| **Filter by Status** | Show All, Active, or Archived chats |

### Chat Lifecycle

```
Created → Active → Archived (soft delete)
                 ↘ Deleted (hard delete)
```

- **Active** — Chat is live, you can send messages
- **Archived** — Chat is closed but history is preserved
- **Deleted** — Chat and all its data are permanently removed

### Chat Message Types

| Role | Description |
|---|---|
| **user** | Your messages |
| **assistant** | AI responses (with metadata: thinking, tool calls) |
| **system** | System messages (sub-agent activity, errors) |
| **tool** | Tool execution results (name, args, result) |

---

## 5. Workflows — Multi-Stage AI Pipelines

Workflows are the core feature of GeneratorAI. A workflow is a **DAG (Directed Acyclic Graph)** of stages, where each stage is an AI task that executes prompts against GitHub Copilot.

### Core Concepts

| Concept | Description |
|---|---|
| **Workflow Definition** | The blueprint — defines stages, edges, variables, and configuration |
| **Workflow Run** | An execution instance of a definition — has runtime state, variables, artifacts |
| **Stage** | A single AI task with one or more prompts |
| **Edge** | A connection between stages defining execution order and conditions |
| **Variable** | Configurable parameters that customize workflow behavior |
| **Prompt** | Text sent to the AI within a stage — supports `{{variable}}` interpolation |

### Workflow vs. Chat

| Aspect | Chat | Workflow |
|---|---|---|
| **Structure** | Free-form conversation | Structured multi-stage pipeline |
| **Automation** | Manual interaction | Automated sequential/parallel execution |
| **Reproducibility** | Single-use | Reusable definitions with variables |
| **Output** | Conversation history | Structured artifacts + code files |
| **Best For** | Quick questions, exploration | Code generation, reviews, testing, refactoring |

---

## 6. Templates — Pre-Built Workflow Patterns

Templates are pre-configured workflow blueprints you can instantly use.

### Template Types

| Type | Description |
|---|---|
| **Simple Templates** | Basic prompts for single tasks (Code Generation, Code Review, Refactoring) |
| **System Workflow Templates** | Full multi-stage DAG workflows with stages, edges, variables, and preprocessing |

### Available System Templates

| Template | Stages | Purpose |
|---|---|---|
| **Code Generation Workflow** | 4 | Requirements Analysis → Code Generation → Test Generation → Documentation |
| **Code Review Workflow** | 4 | Architecture Analysis → Code Quality → Security Review → Review Report |
| **E2E Testing & Debugging** | 4 | Test Planning → Test Execution → Debug & Issue Analysis → Test Report |
| **Test Generation Workflow** | 4 | Codebase Analysis → Unit Tests → Integration Tests → Test Report |
| **Code Refactoring Workflow** | 4 | Code Analysis → Refactoring Plan → Refactored Code → Verification |

### Using a Template

**From Workflows Page (Web UI):**
1. Go to **Workflows** page
2. Under **System Workflows**, click **"Use Template"** on any template card
3. A new workflow definition is created with all stages pre-configured
4. You can customize the stages before running

**From Template (System Template Import):**
1. Click the **"Template"** button in the workflows header
2. Select a system template → it creates a workflow definition
3. Stages from the template are created as locked (core stages cannot be changed)
4. Configure variables specific to the template

**Import JSON:**
1. Click **"Upload JSON"** in the workflows header
2. Select a `.json` file matching the workflow definition schema
3. The import creates stages and edges from the JSON structure

**Via API:**
```http
# Create from system template
POST /api/orchestrator/from-template
{
  "templateId": "system-code-generation",
  "variables": { "requirements": "Build a REST API", "language": "TypeScript" }
}

# Import from JSON
POST /api/workflow-definitions/import-json
{
  "name": "My Workflow",
  "stages": [...],
  "edges": [...]
}
```

### Template Variables

Each system template defines configurable variables:

**Code Generation Template Variables:**
| Variable | Type | Required | Description |
|---|---|---|---|
| `git_url` | git_url | No | Existing repository to clone |
| `requirements` | text | Yes | What to generate |
| `language` | choice | Yes | TypeScript, JavaScript, Python, Java, Go, Rust, C# |
| `framework` | string | No | Framework (React, Express, Django, etc.) |
| `coding_style` | choice | No | Clean Architecture, MVC, Functional, Microservices |
| `test_framework` | string | No | Test framework (default: Vitest) |

**Code Review Template Variables:**
| Variable | Type | Required | Description |
|---|---|---|---|
| `git_url` | git_url | Yes | Repository to review |
| `branch` | string | No | Branch to review |
| `review_focus` | text | Yes | Areas to focus on |
| `language` | choice | Yes | Primary language |

**E2E Testing Template Variables:**
| Variable | Type | Required | Description |
|---|---|---|---|
| `target_url` | string | Yes | URL to test |
| `test_scenarios` | text | Yes | Test cases to execute |
| `expected_results` | text | No | Expected outcomes |
| `browser` | choice | No | Chromium, Firefox, WebKit |
| `viewport` | choice | No | Screen resolution |

---

## 7. Creating a Workflow — Step by Step

### Method 1: Visual Builder (Web UI)

#### Step 1: Open the Builder
- Click **"+ New Workflow"** from the sidebar or the Workflows page
- The **Workflow Builder** opens with an empty canvas

#### Step 2: Name Your Workflow
- Click the title field at the top (default: "Untitled Workflow")
- Enter a descriptive name

#### Step 3: Configure Workflow Settings
Click **"Settings"** in the toolbar to open the workflow configuration modal:

| Setting | Description | Options |
|---|---|---|
| **Name** | Workflow display name | Free text |
| **Description** | What this workflow does | Free text |
| **Session Mode** | How Copilot sessions are allocated | `auto`, `single`, `per-stage` |
| **Variables** | Workflow-level parameters | Key-value definitions with type, default, required |
| **Tags** | Categorization labels | Free text tags |

**Session Mode Explained:**
- **auto** — System decides session allocation automatically
- **single** — All stages share ONE Copilot conversation (stages see all prior context)
- **per-stage** — Each stage gets its OWN conversation (isolated context, more parallel)

#### Step 4: Add Stages
Click **"+ Add Stage"** or **"Add First Stage"**. Each stage appears as a node on the canvas.

For each stage, you configure:
1. **Name** — Descriptive stage name
2. **Prompts** — One or more prompts to send to AI
3. **Conditions** — When this stage should execute
4. **Variables** — Stage-specific variable overrides
5. **Advanced** — Retry policy, timeout, model override, hooks

#### Step 5: Connect Stages with Edges
Click and drag from a stage's output handle to another stage's input handle to create an edge (connection).

**Edge Types:**
| Type | Description |
|---|---|
| `on_success` | Execute target only if source completes successfully |
| `on_failure` | Execute target only if source fails |
| `on_completion` | Execute target when source finishes (success or failure) |
| `always` | Always execute target after source (regardless of outcome) |

#### Step 6: Validate
Click **"Validate"** in the toolbar. The system checks for:
- ✅ No cycles in the DAG
- ✅ No orphan stages (disconnected from the graph)
- ✅ No duplicate edges
- ✅ At least one stage exists
- ✅ All edge references are valid

#### Step 7: Save
Click **"Save"** to persist the workflow definition.

#### Step 8: Run
Click **"Run"** to execute the workflow (see [Section 9: Running a Workflow](#9-running-a-workflow--execution-guide)).

### Method 2: From System Template

1. Go to **Workflows** page
2. Find a **System Workflow** card (e.g., "Code Generation Workflow")
3. Click **"Use Template"**
4. A new definition is created with pre-configured stages
5. Navigate to the definition page to customize or run

### Method 3: Import JSON

1. Go to **Workflows** page
2. Click **"Upload JSON"**
3. Select a JSON file with this structure:

```json
{
  "name": "My Custom Workflow",
  "description": "What this workflow does",
  "sessionMode": "per-stage",
  "stages": [
    {
      "name": "Stage 1 - Analysis",
      "prompts": [
        {
          "label": "Analyze",
          "text": "Analyze the following: {{requirements}}",
          "waitForCompletion": true
        }
      ],
      "order": 0
    },
    {
      "name": "Stage 2 - Generate",
      "prompts": [
        {
          "label": "Generate Code",
          "text": "Generate code based on the analysis",
          "waitForCompletion": true
        }
      ],
      "order": 1
    }
  ],
  "edges": [
    {
      "fromStageIndex": 0,
      "toStageIndex": 1,
      "edgeType": "on_success"
    }
  ],
  "variables": [
    {
      "name": "requirements",
      "label": "Requirements",
      "type": "text",
      "required": true
    }
  ]
}
```

### Method 4: CLI

```bash
# Create from scratch (interactive)
pnpm cli workflow create

# Import from template
pnpm cli workflow create --template system-code-generation
```

### Method 5: API

```http
# Create a definition
POST /api/workflow-definitions
{
  "name": "My Workflow",
  "description": "Description",
  "sessionMode": "per-stage"
}

# Add stages
POST /api/workflow-definitions/{id}/stages
{
  "name": "Stage 1",
  "prompts": [{ "label": "Prompt", "text": "Do X", "waitForCompletion": true }],
  "order": 0
}

# Add edges
POST /api/workflow-definitions/{id}/edges
{
  "fromStageId": "stage-1-id",
  "toStageId": "stage-2-id",
  "edgeType": "on_success"
}

# Validate
POST /api/workflow-definitions/{id}/validate
```

---

## 8. Configuring Stages — Complete Reference

### Stage Properties

| Property | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Human-readable stage name |
| `prompts` | Prompt[] | Yes | Ordered list of prompts to send to AI |
| `order` | number | Auto | Execution order (auto-assigned, can override) |
| `condition` | StageCondition | No | When to execute this stage |
| `variables` | object | No | Stage-specific variable values |
| `copilotConfigOverrides` | object | No | Override model, tools, system message for this stage |
| `retryPolicy` | object | No | Automatic retry on failure |
| `timeoutMs` | number | No | Maximum execution time in milliseconds |
| `hooks` | HookDefinition[] | No | Pre/post processing hooks |

### Prompts

Each prompt in a stage has:

| Field | Type | Description |
|---|---|---|
| `label` | string | Descriptive name for the prompt |
| `text` | string | The actual prompt text — supports `{{variable}}` interpolation |
| `waitForCompletion` | boolean | Wait for AI response before sending next prompt |
| `attachments` | string[] | File paths to attach with the prompt |

**Variable Interpolation Example:**
```
Analyze the {{language}} codebase at {{repo_path}} and identify areas for {{refactoring_focus}}.
Focus on: {{review_focus}}
```

Variables are resolved at runtime from workflow variables, stage variables, and runtime overrides (3-level merge).

### Conditions

Conditions control WHEN a stage executes:

| Condition Type | Description | Example |
|---|---|---|
| `always` | Always execute (default) | Stage runs regardless of predecessor outcome |
| `on_success` | Only if predecessor(s) completed successfully | Run tests only if code generation succeeded |
| `on_failure` | Only if predecessor(s) failed | Run error handler if main stage failed |
| `expression` | Custom expression evaluation | `status == 'completed' && variables.run_tests != 'false'` |

**Expression Syntax:**
- Operators: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Values: string literals (`'value'`), numbers, booleans
- Context: `status` (predecessor status), `variables.key` (variable lookup), `retryCount`

### Retry Policy

Configure automatic retrying on failure:

```json
{
  "maxRetries": 3,
  "backoffMs": 1000,
  "backoffMultiplier": 2
}
```

This retries up to 3 times with exponential backoff: 1s → 2s → 4s.

### Model Override

Override the AI model for a specific stage:

```json
{
  "copilotConfigOverrides": {
    "model": "gpt-4.1"
  }
}
```

### Hooks

Hooks are lifecycle callbacks:

| Phase | Trigger |
|---|---|
| `pre_prompt` | Before sending prompt to AI |
| `post_prompt` | After receiving AI response |
| `pre_run` | Before stage starts |
| `post_run` | After stage completes |
| `on_error` | When stage encounters an error |

Hook types: `script` (run a shell command), `http` (call a URL), `function` (Node.js module).

### Stage Output

After a stage completes, it produces:
1. **Assistant Messages** — AI responses (stored in chat history)
2. **Code Blocks** — Extracted from responses, saved as files in workspace
3. **Stage Summary** — AI-generated summary of what was accomplished
4. **Artifacts** — Response files saved to artifacts directory

---

## 9. Running a Workflow — Execution Guide

### Starting a Run

**Web UI:**
1. Navigate to a **Workflow Definition** page
2. Click **"Run"** button in the top-right
3. A **Variable Input Modal** appears if the workflow has variables
4. Fill in required variables (text, numbers, choices)
5. Optionally upload files (prompts, skills, agents)
6. Click **"Start Run"**

**CLI:**
```bash
pnpm cli workflow run <definitionId> --var requirements="Build a todo app" --var language="TypeScript"
```

**API:**
```http
# Step 1: Create the run
POST /api/workflow-runs
{
  "workflowDefinitionId": "def-123",
  "variables": {
    "requirements": "Build a todo app",
    "language": "TypeScript"
  }
}

# Step 2: Start the run
POST /api/workflow-runs/{runId}/start
```

**API (Orchestrated — with git clone + preprocessing):**
```http
POST /api/orchestrator/runs
{
  "workflowDefinitionId": "def-123",
  "variables": { "requirements": "Build a todo app" },
  "gitRepositories": [
    {
      "url": "https://github.com/user/repo.git",
      "alias": "my-repo",
      "branch": "main"
    }
  ]
}
```

### File Uploads

You can upload files at two levels:

1. **Workflow-level uploads** — Shared across all runs of this definition
   ```http
   POST /api/orchestrator/workflows/{definitionId}/uploads
   Content-Type: multipart/form-data
   files: [*.md, *.txt, *.json, *.yaml, *.ts, *.js, *.py, *.sh, *.prompt]
   ```

2. **Run-level uploads** — Specific to this run
   ```http
   POST /api/orchestrator/runs/{runId}/uploads
   Content-Type: multipart/form-data
   files: [...]
   ```

Allowed file types: `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.toml`, `.ts`, `.js`, `.py`, `.sh`, `.prompt`

### What Happens During a Run

1. **Run Created** — `WorkflowRun` record created with status `created`, `StageRun` records created for each stage (status `pending`)
2. **Orchestration** (if using orchestrated runs):
   - Git repositories are cloned
   - Preprocessing steps execute (validate inputs, set variables, run scripts)
   - Upload files are copied to run workspace
3. **DAG Built** — The system builds the execution graph from stages and edges
4. **Root Stages Start** — Stages with no dependencies begin executing
5. **Stage Execution** — For each stage:
   - Session allocated (based on session mode)
   - Prompts sent to Copilot sequentially
   - Responses collected with metadata (thinking, tool calls)
   - Code blocks extracted and saved to workspace
   - Stage summary generated
6. **Next Stages Scheduled** — When a stage completes, its dependents are evaluated:
   - Edge conditions checked (on_success, on_failure, etc.)
   - Ready stages start executing (parallel when possible)
   - Unreachable stages are marked as `skipped`
7. **Run Completes** — When all stages reach terminal state, run is marked `completed` (or `failed`)

---

## 10. Monitoring a Running Workflow

### Web UI — Workflow Run Page

The run page shows a **split-view layout**:

**Left Panel: Runtime DAG Canvas**
- Read-only visualization of the execution graph
- Each stage node shows:
  - Status badge (color-coded: gray=pending, blue=running, green=completed, red=failed, yellow=paused)
  - Progress indicator (current step / total steps)
  - Duration counter
- Animated edges show data flow
- Click any stage to select it for detail view

**Right Panel: Stage Detail (tabbed)**
- **Output Tab** — Live streaming AI responses with:
  - Thinking blocks (AI reasoning, collapsible)
  - Text blocks (Markdown rendered)
  - Tool call blocks (tool name, arguments, results)
  - System messages (sub-agent activity, errors)
- **Artifacts Tab** — Generated files:
  - Workspace files (generated code)
  - Artifact files (response documents)
  - Uploaded files
  - Per-file and bulk download
- **Messages Tab** — Full message history for the selected stage

**Bottom Panel: Timeline**
- Collapsible timeline showing all stage events chronologically
- Click events to navigate to specific stages

**Header Controls:**
| Control | Action |
|---|---|
| **Pause** | Pause the running workflow (all stages pause) |
| **Resume** | Resume a paused workflow |
| **Cancel** | Cancel the workflow (all non-terminal stages abort) |
| **Status Badge** | Shows current state (running, paused, completed, failed) |
| **Duration** | Live timer showing total elapsed time |

### CLI — Live Monitoring

```bash
# Watch a run in real-time
pnpm cli workflow watch <runId>
```

This shows a live DAG visualization in the terminal with stage status updates.

### API — Polling & Streaming

**Polling:**
```http
GET /api/workflow-runs/{runId}
# Returns run with all stage runs and their statuses
```

**SSE Streaming:**
```http
GET /api/events/stream
# Multiplexed stream: receives events for ALL active sessions
# Events include context: { type: 'workflow_run'|'stage_run', id: '...' }
```

**Run-specific SSE (via stage sessions):**
```http
GET /api/sessions/{sessionId}/stream
# Stream events for a specific session (maps to a stage)
```

### Run Controls (Mid-Execution)

| Action | API | Effect |
|---|---|---|
| **Pause Run** | `POST /api/workflow-runs/{id}/pause` | Pauses all running stages |
| **Resume Run** | `POST /api/workflow-runs/{id}/resume` | Resumes paused stages |
| **Cancel Run** | `POST /api/workflow-runs/{id}/cancel` | Aborts all non-terminal stages |
| **Pause Stage** | `POST /api/workflow-runs/{runId}/stages/{stageId}/pause` | Pause individual stage |
| **Resume Stage** | `POST /api/workflow-runs/{runId}/stages/{stageId}/resume` | Resume individual stage |
| **Cancel Stage** | `POST /api/workflow-runs/{runId}/stages/{stageId}/cancel` | Cancel individual stage |
| **Retry Stage** | `POST /api/workflow-runs/{runId}/stages/{stageId}/retry` | Retry a failed stage |

---

## 11. Workflow Results — Files, Artifacts, and Status

### Understanding the Output Structure

When a workflow run completes, output is organized as:

```
~/.generatorai/artifacts/runs/{runId}/
├── workspace/          ← Generated code files (the main output)
│   ├── src/
│   │   ├── index.ts
│   │   └── utils.ts
│   ├── tests/
│   │   └── index.test.ts
│   └── package.json
├── artifacts/          ← Stage response documents
│   ├── stage_response_0.md
│   ├── stage_response_1.md
│   └── ...
└── uploads/            ← User-uploaded files
    ├── requirements.md
    └── design-spec.txt
```

### Checking Run Status

**Web UI:**
- Navigate to the workflow definition page → **Run History** tab
- Click any run to see its detail page with stage statuses

**API:**
```http
GET /api/workflow-runs/{runId}

Response:
{
  "id": "run-123",
  "status": "completed",          // created|starting|running|paused|cancelling|completed|failed|cancelled
  "startedAt": "2026-03-19T...",
  "completedAt": "2026-03-19T...",
  "stageRuns": [
    {
      "id": "sr-1",
      "name": "Requirements Analysis",
      "status": "completed",      // pending|queued|running|paused|completed|failed|skipped|cancelled
      "currentStep": 2,
      "totalSteps": 2,
      "summary": "Analyzed requirements and...",
      "startedAt": "2026-03-19T...",
      "completedAt": "2026-03-19T..."
    },
    ...
  ]
}
```

### Downloading Files

**Web UI:**
- On the Run page, select a stage → **Artifacts** tab
- Browse workspace files, artifact files, and uploads
- Click the download icon per file, or use **"Download All"** for bulk download

**API:**
```http
# Browse workspace files for a run
GET /api/orchestrator/runs/{runId}/workspace

# Download a specific file from run workspace
GET /api/orchestrator/runs/{runId}/workspace/download?path=src/index.ts

# Browse workflow-level files
GET /api/orchestrator/workflows/{definitionId}/files

# Download workflow-level file
GET /api/orchestrator/workflows/{definitionId}/files/download?path=file.md

# List stage artifacts
GET /api/sessions/{sessionId}/artifacts

# Download artifact
GET /api/artifacts/{artifactId}/download
```

### Stage Summaries

Each completed stage generates a summary (AI-generated description of what was accomplished). Access via:
- `stageRun.summary` field in the API response
- Visible in the run page stage detail

### Run Statuses Explained

| Status | Meaning |
|---|---|
| `created` | Run record exists but hasn't started |
| `starting` | DAG is being built, root stages being scheduled |
| `running` | One or more stages are actively executing |
| `paused` | User paused the run; all active stages paused |
| `cancelling` | Cancel requested; cleaning up running stages |
| `completed` | All stages finished successfully |
| `failed` | One or more stages failed and no recovery path exists |
| `cancelled` | Run was manually cancelled |

### Stage Statuses Explained

| Status | Meaning |
|---|---|
| `pending` | Waiting for dependencies to complete |
| `queued` | Dependencies met, waiting for session allocation |
| `running` | Actively executing prompts |
| `paused` | Execution paused by user |
| `completed` | All prompts executed successfully |
| `failed` | Stage encountered an error (check `error` field) |
| `skipped` | Stage skipped because conditions weren't met |
| `cancelled` | Stage cancelled (user or cascading from run cancel) |

---

## 12. Workflow Lifecycle — End to End

This section describes the complete lifecycle of a workflow from creation to completion.

### Phase 1: Definition (Design Time)

```
User designs workflow in builder
         │
         ▼
┌─────────────────────┐
│ WorkflowDefinition  │  ← name, description, sessionMode, variables, tags
│  ├── StageDefinition│  ← stages with prompts, conditions, retry policies
│  ├── StageDefinition│
│  ├── StageEdge      │  ← connections with edge types
│  └── StageEdge      │
└─────────────────────┘
         │
         ▼
    Validate DAG
    (no cycles, no orphans, valid refs)
         │
         ▼
    Save to Database
```

### Phase 2: Run Creation (Runtime)

```
User clicks "Run" / API call
         │
         ▼
┌─────────────────────┐
│   WorkflowRun       │  ← status: created
│  ├── StageRun (A)   │  ← status: pending
│  ├── StageRun (B)   │  ← status: pending
│  └── StageRun (C)   │  ← status: pending
└─────────────────────┘
```

### Phase 3: Orchestration (Optional)

If using orchestrated runs:
```
Clone git repositories → Set repo path variables
         │
Run preprocessing steps (validate inputs, run scripts, set variables)
         │
Copy uploaded files → Wire into variables
         │
Start DAG execution
```

### Phase 4: DAG Execution

```
Build DAG from stages + edges
         │
         ▼
Identify root stages (no incoming edges)
         │
         ▼
┌─ Execute Root Stages (parallel) ─────────────────────┐
│                                                       │
│  StageRun A: pending → queued → running → completed   │
│  StageRun B: pending → queued → running → completed   │
│                                                       │
└───────────────────────────────────────────────────────┘
         │
         ▼
Evaluate edges: which stages are ready?
         │
         ▼
┌─ Execute Next Stages ────────────────────────────────┐
│                                                       │
│  StageRun C: pending → queued → running → completed   │
│  (C depends on A and B via on_success edges)          │
│                                                       │
└───────────────────────────────────────────────────────┘
         │
         ▼
All stages in terminal state?
  Yes → Run status: completed
  No  → Continue scheduling
```

### Phase 5: Stage Execution (Deep Dive)

For each stage:

```
1. Allocate Session
   ├── single mode: Reuse shared session
   ├── per-stage mode: Create new session + conversation
   └── auto mode: Create per-stage (system decides)

2. Build Config (3-level merge)
   ├── Level 1: WorkflowDefinition.copilotConfig (base)
   ├── Level 2: StageDefinition.copilotConfigOverrides (stage)
   └── Level 3: Runtime variable overrides

3. Inject Context
   └── Predecessor stage summaries appended as context

4. Execute Prompts (sequentially)
   ├── Prompt 1 → Send to Copilot → Receive response
   ├── Prompt 2 → Send to Copilot → Receive response
   └── ...
   
5. Post-Processing
   ├── Extract code blocks from responses
   ├── Infer filenames for extracted code
   ├── Write files to workspace directory
   ├── Save responses as artifacts
   └── Generate stage summary

6. Release Session
   ├── per-stage: Destroy conversation + close session
   └── single: Keep alive for next stage
```

### Phase 6: Completion

```
All stages terminal → Run marked as completed
         │
         ▼
Result validation (if configured)
         │
         ▼
Files available in workspace directory
Artifacts available for download
Stage summaries available in API
```

---

## 13. Sessions — Legacy Concept

Sessions are the legacy (v1) entity model. In v2:
- **Chats** replaced session-based conversations
- **Workflow Runs** replaced session-based workflow execution
- Sessions still exist internally as Copilot SDK wrappers

The Sessions tab in the UI shows legacy v1 sessions. New features should use Chats and Workflows.

---

## 14. CLI Reference

### Chat Commands

```bash
# Start a new chat
pnpm cli c start

# List all chats
pnpm cli c list

# Resume an existing chat
pnpm cli c resume <chatId>
```

### Workflow Definition Commands

```bash
# List all defined workflows
pnpm cli workflow list

# Show workflow details (stages, edges)
pnpm cli workflow show <definitionId>

# Create new workflow (interactive)
pnpm cli workflow create

# Delete a workflow
pnpm cli workflow delete <definitionId>
```

### Workflow Run Commands

```bash
# Start a workflow run
pnpm cli workflow run <definitionId> [--var key=value ...]

# List all runs
pnpm cli workflow runs

# Check run status
pnpm cli workflow status <runId>

# Watch run live (real-time terminal DAG)
pnpm cli workflow watch <runId>

# Control execution
pnpm cli workflow pause <runId>
pnpm cli workflow resume <runId>
pnpm cli workflow cancel <runId>
```

### Template Commands

```bash
# List available templates
pnpm cli template list

# Show template details
pnpm cli template show <templateId>
```

### Initialize

```bash
# Set up GeneratorAI configuration
pnpm cli init [directory]
```

---

## 15. API Reference for AI Agents

### Base URL
```
http://localhost:3100/api
```

### Workflow Definition Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/workflow-definitions` | Create definition |
| GET | `/workflow-definitions` | List all definitions |
| GET | `/workflow-definitions/:id` | Get definition + stages + edges |
| PATCH | `/workflow-definitions/:id` | Update definition |
| DELETE | `/workflow-definitions/:id` | Delete definition |
| POST | `/workflow-definitions/:id/stages` | Add stage |
| PUT | `/workflow-definitions/:id/stages/:stageId` | Update stage |
| DELETE | `/workflow-definitions/:id/stages/:stageId` | Delete stage |
| POST | `/workflow-definitions/:id/edges` | Add edge |
| DELETE | `/workflow-definitions/:id/edges/:edgeId` | Delete edge |
| POST | `/workflow-definitions/:id/validate` | Validate DAG |
| POST | `/workflow-definitions/import` | Import from template ID |
| POST | `/workflow-definitions/import-json` | Import from JSON |
| GET | `/workflow-definitions/:id/export` | Export as template |

### Workflow Run Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/workflow-runs` | Create run |
| GET | `/workflow-runs` | List runs (?status=, ?definitionId=) |
| GET | `/workflow-runs/:id` | Get run + stage runs |
| POST | `/workflow-runs/:id/start` | Start run |
| POST | `/workflow-runs/:id/pause` | Pause run |
| POST | `/workflow-runs/:id/resume` | Resume run |
| POST | `/workflow-runs/:id/cancel` | Cancel run |
| DELETE | `/workflow-runs/:id` | Delete run |
| GET | `/workflow-runs/:id/stages` | List stage runs |
| POST | `/workflow-runs/:runId/stages/:stageId/pause` | Pause stage |
| POST | `/workflow-runs/:runId/stages/:stageId/resume` | Resume stage |
| POST | `/workflow-runs/:runId/stages/:stageId/cancel` | Cancel stage |
| POST | `/workflow-runs/:runId/stages/:stageId/retry` | Retry failed stage |

### Orchestrator Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/orchestrator/system-workflows` | List system templates |
| GET | `/orchestrator/system-workflows/:id` | Get system template details |
| POST | `/orchestrator/from-template` | Create from system template |
| POST | `/orchestrator/runs` | Start orchestrated run |
| GET | `/orchestrator/runs/:id/context` | Get orchestration context |
| POST | `/orchestrator/runs/:id/cancel` | Cancel orchestrated run |
| POST | `/orchestrator/workflows/:id/uploads` | Upload workflow files |
| GET | `/orchestrator/workflows/:id/files` | List workflow files |
| GET | `/orchestrator/workflows/:id/files/download` | Download workflow file |
| DELETE | `/orchestrator/workflows/:id/files` | Delete workflow file |
| POST | `/orchestrator/runs/:id/uploads` | Upload run files |
| GET | `/orchestrator/runs/:id/workspace` | Browse run workspace files |
| GET | `/orchestrator/runs/:id/workspace/download` | Download run workspace file |

### Chat Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/chats` | Create chat |
| GET | `/chats` | List chats (?status=active\|archived) |
| GET | `/chats/:id` | Get chat |
| DELETE | `/chats/:id` | Archive/delete chat |
| POST | `/chats/:id/prompt` | Send prompt (multipart/form-data) |
| GET | `/chats/:id/messages` | Get message history |
| GET | `/chats/:id/stream` | SSE stream |

### Real-Time Streaming

| Method | Path | Description |
|---|---|---|
| GET | `/events/stream` | Multiplexed SSE (all sessions) |
| GET | `/events/global` | Global lifecycle events |
| GET | `/sessions/:id/stream` | Per-session SSE |
| GET | `/sessions/:id/stream/events` | REST event replay |

### Templates & Health

| Method | Path | Description |
|---|---|---|
| GET | `/templates` | List templates |
| GET | `/templates/:id` | Get template |
| GET | `/health` | Health check |
| GET | `/health/config` | Get configuration |

---

## System-Injected Variables & Preprocessing

When using orchestrated runs (especially with system templates), the system automatically injects variables during preprocessing:

### Auto-Injected Variables

| Variable Pattern | Injected When | Example |
|---|---|---|
| `repo_path_{alias}` | Git repository is cloned | `repo_path_target` = `/tmp/.../target` |
| `repo_subdir_{alias}` | Git repo with subdirectory | `repo_subdir_target` = `src/` |
| `__workingDirectory` | Run starts | Run workspace absolute path |
| `__artifactsDirectory` | Run starts | Run artifacts absolute path |

### How It Works

When you specify `gitRepositories` in an orchestrated run:
```json
{
  "gitRepositories": [
    { "url": "https://github.com/user/repo.git", "alias": "target", "branch": "main" }
  ]
}
```

The system:
1. Clones the repository (shallow clone, depth 1)
2. Sets `repo_path_target` to the cloned path
3. Sets `repo_subdir_target` to the subdirectory (if specified)
4. These variables become available in stage prompts via `{{repo_path_target}}`

### Preprocessing Steps

System templates can define preprocessing steps that run BEFORE the DAG executes:

| Step Type | Purpose | Example |
|---|---|---|
| `clone_repo` | Clone a git repository | Clone `target` repo by alias |
| `validate_input` | Validate a variable | Check `review_focus` is not empty |
| `set_variable` | Set/interpolate a variable | `full_path = {{repo_path_target}}/{{subdirectory}}` |
| `run_script` | Execute a shell command | Run linting before analysis |
| `conditional` | Branch based on condition | Only clone if `git_url` is provided |

---

## 16. Configuration Reference

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | 3100 | Server port |
| `DB_PATH` | `packages/db/data/generatorai.db` | SQLite database path |
| `WORKSPACES_DIR` | `~/.generatorai/workspaces` | Workspace storage |
| `ARTIFACTS_DIR` | `~/.generatorai/artifacts` | Artifact storage |
| `TEMPLATES_DIR` | `./templates` | Workflow templates directory |
| `MAX_CONCURRENT_SESSIONS` | 10 | Max concurrent Copilot sessions |
| `LOG_LEVEL` | `info` | Logging level |
| `COPILOT_MODEL` | `gpt-4.1` | Default AI model |
| `COPILOT_USE_STDIO` | `true` | Use stdio for Copilot SDK |
| `COPILOT_AUTO_RESTART` | `true` | Auto-restart Copilot on crash |
| `SSE_HEARTBEAT_MS` | 15000 | SSE heartbeat interval (ms) |
| `SSE_MAX_REPLAY` | 10000 | Max events to replay on reconnect |
| `CORS_ORIGINS` | localhost:5173,localhost:5174 | Allowed CORS origins |

### System Limits

| Limit | Value |
|---|---|
| Max stages per workflow | 50 |
| Max edges per workflow | 200 |
| Max file upload size | 10 MB per file |
| Max files per upload | 20 |
| Max prompt attachments | 10 files, 50 MB total |
| Request body size | 10 MB |
| SSE replay buffer | 2000 events (multiplexed) |
| Default Copilot timeout | 120 seconds |

---

## 17. System Workflow Templates — Detailed Reference

### Code Generation Workflow (`system-code-generation`)

**Purpose:** Generate a complete codebase from requirements.

**Stage Pipeline:**
```
┌─────────────────────┐
│ Requirements        │
│ Analysis            │
└──────────┬──────────┘
           │ on_success
┌──────────▼──────────┐
│ Code                │
│ Generation          │
└──────┬────────┬─────┘
       │        │ on_success
       │   ┌────▼─────────────┐
       │   │ Documentation    │
       │   └──────────────────┘
       │ on_success
┌──────▼──────────────┐
│ Test                │
│ Generation          │
└─────────────────────┘
```

**Variables:**
- `requirements` (required, text) — What to generate
- `language` (required, choice) — Programming language
- `framework` (optional) — Framework to use
- `git_url` (optional) — Existing repo to extend
- `coding_style` (optional, choice) — Architecture pattern
- `test_framework` (optional) — Testing framework

---

### Code Review Workflow (`system-code-review`)

**Purpose:** Comprehensive code review of a repository.

**Stage Pipeline:**
```
┌─────────────────────┐
│ Architecture        │
│ Analysis            │
└──────┬────────┬─────┘
       │        │ on_success
       │   ┌────▼─────────────┐
       │   │ Security         │
       │   │ Review           │
       │   └────────┬─────────┘
       │            │
       │ on_success │ on_success
┌──────▼────────────▼─┐
│ Review Report       │
└─────────────────────┘

┌─────────────────────┐
│ Code Quality        │──── on_success ───►┐
│ Review              │                     │
└─────────────────────┘                     ▼
                                    Review Report
```

**Variables:**
- `git_url` (required) — Repository URL
- `branch` (optional) — Branch to review
- `review_focus` (required, text) — Focus areas
- `language` (required, choice) — Language

---

### E2E Testing & Debugging (`system-e2e-testing`)

**Purpose:** Browser-based end-to-end testing with Playwright.

**Stage Pipeline:**
```
┌─────────────────────┐
│ Test Planning       │
│ (playwright-cli)    │
└──────────┬──────────┘
           │ on_success
┌──────────▼──────────┐
│ Test Execution      │
│ (click,fill,etc.)   │
└──────┬────────┬─────┘
       │        │ on_failure
       │   ┌────▼─────────────┐
       │   │ Debug & Issue    │
       │   │ Analysis         │
       │   └────────┬─────────┘
       │            │
       │ on_success │ on_completion
┌──────▼────────────▼─┐
│ Test Report         │
│ Generation          │
└─────────────────────┘
```

**Variables:**
- `target_url` (required) — URL to test
- `test_scenarios` (required, text) — Test cases
- `expected_results` (optional) — Expected outcomes
- `browser` (optional, choice) — Browser engine
- `viewport` (optional, choice) — Screen size

**Note:** Uses `single` session mode so browser state persists across stages.

---

### Test Generation Workflow (`system-test-generation`)

**Purpose:** Generate comprehensive test suites for existing code.

**Stage Pipeline:**
```
┌─────────────────────┐
│ Codebase            │
│ Analysis            │
└──────┬────────┬─────┘
       │        │ on_success
       │   ┌────▼─────────────┐
       │   │ Integration      │
       │   │ Tests            │
       │   └────────┬─────────┘
       │            │
       │ on_success │ on_success
┌──────▼────────────▼─┐
│ Test Report         │
└─────────────────────┘

┌─────────────────────┐
│ Unit Test           │──── on_success ───► Test Report
│ Generation          │
└─────────────────────┘
```

**Variables:**
- `git_url` (required) — Repository URL
- `branch` (optional) — Branch
- `test_focus` (optional) — Specific modules
- `language` (required, choice) — Language
- `test_framework` (optional) — Framework (default: Vitest)

---

### Code Refactoring Workflow (`system-refactoring`)

**Purpose:** Analyze, plan, and execute code refactoring.

**Stage Pipeline:**
```
┌─────────────────────┐     ┌─────────────────────┐
│ Code Analysis       │────►│ Refactoring Plan    │
└─────────────────────┘     └──────────┬──────────┘
                                       │
                            ┌──────────▼──────────┐
                            │ Generate Refactored │
                            │ Code                │
                            └──────────┬──────────┘
                                       │
                            ┌──────────▼──────────┐
                            │ Verification        │
                            └─────────────────────┘
```

**Variables:**
- `git_url` (required) — Repository URL
- `branch` (optional) — Branch
- `refactoring_focus` (required, text) — What to refactor
- `refactoring_approach` (required, choice) — Incremental / Aggressive / Conservative

---

## 18. Keyboard Shortcuts

### Workflow Builder
| Shortcut | Action |
|---|---|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Delete` | Delete selected node/edge |
| `+` / `-` | Zoom in/out |
| Mouse wheel | Zoom |
| Click + drag | Pan canvas |

### Chat
| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Send message |
| `Escape` | Clear input |

---

## 19. Troubleshooting

### Common Issues

| Issue | Solution |
|---|---|
| **"Copilot not connected"** | Check Copilot SDK is initialized; verify `GET /api/copilot/state` returns `running` |
| **Workflow validation fails** | Check for cycles, orphan stages, or missing edges using `POST /api/workflow-definitions/{id}/validate` |
| **Stage stuck in "queued"** | Max concurrent sessions reached — wait for other sessions to complete or increase `MAX_CONCURRENT_SESSIONS` |
| **SSE stream disconnects** | Browser reconnects automatically via `Last-Event-ID`; check network tab for SSE connection |
| **Files not appearing** | Check run workspace directory: `~/.generatorai/artifacts/runs/{runId}/workspace/` |
| **Run stuck in "starting"** | Check server logs for orchestration errors (git clone failure, preprocessing error) |
| **Stage fails repeatedly** | Check stage retry policy; review error in stage run details; try manual retry via API |

### Health Check

```bash
# Check server health
curl http://localhost:3100/api/health

# Check configuration
curl http://localhost:3100/api/health/config

# Check Copilot status
curl http://localhost:3100/api/copilot/state
```

---

*This guide covers all features of GeneratorAI v2. For developer/contributor documentation, see [TECHNICAL_REFERENCE.md](TECHNICAL_REFERENCE.md).*
