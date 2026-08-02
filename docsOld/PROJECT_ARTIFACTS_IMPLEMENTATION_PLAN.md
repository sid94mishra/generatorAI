# Project Artifacts & Scoping — Detailed Implementation Plan

> **Scope:** Rename "Configs" to "Project Artifacts", move worktrees to codebase-level, add system vs project distinction, integrate project-scoped artifacts into workflow/chat/automation creation flows.

---

## Table of Contents

1. [Requirements Summary](#1-requirements-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Affected Areas Map](#3-affected-areas-map)
4. [Implementation Phases](#4-implementation-phases)
5. [Phase 1: Rename Configs → Project Artifacts](#5-phase-1-rename-configs--project-artifacts)
6. [Phase 2: System Artifacts](#6-phase-2-system-artifacts)
7. [Phase 3: Move Worktrees to Codebase Level](#7-phase-3-move-worktrees-to-codebase-level)
8. [Phase 4: Codebase File Browser](#8-phase-4-codebase-file-browser)
9. [Phase 5: Project Scoping on Workflows/Chats/Automations](#9-phase-5-project-scoping-on-workflowschatsautomations)
10. [Phase 6: Artifact Picker in Creation Flows](#10-phase-6-artifact-picker-in-creation-flows)
11. [Phase 7: System vs Project Indicators](#11-phase-7-system-vs-project-indicators)
12. [Database Migration Plan](#12-database-migration-plan)
13. [API Changes Summary](#13-api-changes-summary)
14. [UI Changes Summary](#14-ui-changes-summary)
15. [Risk Assessment](#15-risk-assessment)

---

## 1. Requirements Summary

| # | Requirement | Priority |
|---|-------------|----------|
| R1 | Rename "Configs" tab → **"Project Artifacts"** holding Skills, Prompts, Custom Agents | High |
| R2 | System provides default skills, prompts, and custom agents; every project inherits them + has its own | High |
| R3 | Move Worktrees tab from project-level → **codebase-level** (click codebase → see worktrees + files) | High |
| R4 | Apply .gitignore filtering when showing codebase files | Medium |
| R5 | List indicators: **System** vs **Project** badge on each artifact | High |
| R6 | When creating workflow/chat/automation: **select project first**, then only that project's codebases, skills, prompts, agents are available | Critical |
| R7 | Artifact upload: files for prompts & agents, files OR folders for skills | Medium |
| R8 | Clean up all worktree code from project-level and place at codebase-level | High |

---

## 2. Current State Analysis

### What Exists

| Component | Current State | File |
|-----------|---------------|------|
| **ProjectConfig** type | `{ id, projectId, type: 'agent'\|'prompt'\|'skill', name, filePath, metadata }` | `packages/shared/src/types/Project.ts` |
| **ProjectConfig DB** | `project_configs` table with `projectId`, `type`, `name`, `filePath` columns | `packages/db/src/schema.ts` L702-722 |
| **ProjectConfigService** | `uploadConfig()`, `listConfigs()`, `getConfigContent()`, `scanProjectConfigs()` | `packages/core/src/services/ProjectConfigService.ts` |
| **ProjectConfigRepository** | Full CRUD with `getByProjectId(projectId, type?)` | `packages/db/src/repositories/ProjectConfigRepository.ts` |
| **Worktrees** | Project-level: `worktrees` table has `projectId` + `codebaseId` | `packages/db/src/schema.ts` L725-746 |
| **WorktreeService** | `createWorktree()`, `listWorktrees(projectId?, runId?)` | `packages/core/src/services/WorktreeService.ts` |
| **Chats DB** | `projectId` column **already exists** in `chats` table | `packages/db/src/schema.ts` L297 |
| **Automations DB** | `scope` column exists but **no `projectId`** | `packages/db/src/schema.ts` L556 |
| **WorkflowDefinitions DB** | `scope` column exists but **no `projectId`** | `packages/db/src/schema.ts` L326 |
| **OrchestratedRunParams** | `projectId?` and `selectedCodebases?` **already exist** | `packages/shared/src/types/WorkflowOrchestrator.ts` L184-186 |
| **CopilotConfig** | Has `skillDirectories`, `customAgents`, `disabledSkills` fields | `packages/shared/src/types/Workflow.ts` |
| **System Templates** | 5 JSON files in `templates/system/` loaded by `TemplateRegistry` | `templates/system/*.json` |
| **File Upload Routes** | `POST /projects/:id/configs` (multipart, 10MB max) | `apps/server/src/routes/projects.ts` L148-218 |

### What's Missing

| Gap | Impact |
|-----|--------|
| No `projectId` on `workflow_definitions` table | Can't scope workflows to projects |
| No `projectId` on `automations` table | Can't scope automations to projects |
| No system-level artifacts (skills/prompts/agents) — only per-project | No inherited defaults |
| No `.gitignore` parser for file browsing | Can't show filtered file tree |
| Worktrees on project tab — not codebase tab | UX mismatch |
| No project picker in workflow/chat/automation creation | Can't scope creation |
| No artifact picker (skills/prompts/agents selector) in stage/chat configuration | Users can't select available artifacts |
| `WorktreeRepository.getByCodebaseId()` doesn't exist | Can't query worktrees per codebase |
| No `system_configs` / system artifacts table | No persistence for system defaults |

---

## 3. Affected Areas Map

### Backend (packages)

| Package | Files Affected | Changes |
|---------|---------------|---------|
| `packages/shared` | `types/Project.ts`, `types/WorkflowDefinition.ts`, `types/Chat.ts`, `types/Automation.ts`, `types/WorkflowOrchestrator.ts` | Add `projectId` to definitions, add `SystemArtifact` type, add `ArtifactSource` enum |
| `packages/db` | `schema.ts`, `repositories/ProjectConfigRepository.ts`, `repositories/WorktreeRepository.ts`, `repositories/WorkflowDefinitionRepository.ts`, `repositories/AutomationRepository.ts`, `repositories/ChatRepository.ts`, `index.ts` (migrations) | Add columns, add `getByCodebaseId()`, add system configs table, add `projectId` filter queries |
| `packages/core` | `services/ProjectConfigService.ts`, `services/WorktreeService.ts`, `services/WorkflowDefinitionService.ts`, `services/ChatManagementService.ts`, `services/AutomationService.ts`, `services/ProjectService.ts`, `services/WorkflowOrchestrator.ts`, `domain/ports/IProjectConfigRepository.ts`, `domain/ports/IWorktreeRepository.ts` | System artifact loading, codebase-level worktree queries, project-scoped filtering, artifact resolution at run time |

### Backend (apps/server)

| File | Changes |
|------|---------|
| `routes/projects.ts` | Rename config → artifact routes, add system artifact list endpoint, refactor worktree routes to nest under codebase, add codebase file browser endpoint |
| `routes/workflow-definitions.ts` | Add `projectId` to create/update/list, add filter-by-project |
| `routes/chats.ts` | Add `projectId` to create/list, add filter-by-project |
| `routes/automations.ts` | Add `projectId` to create/update/list, add filter-by-project |
| `routes/orchestrator.ts` | Add project artifact resolution when starting runs |
| `composition-root.ts` | Wire `SystemArtifactService`, update service constructors |

### Frontend (apps/web)

| Area | Files | Changes |
|------|-------|---------|
| **Project Detail Page** | `pages/ProjectDetailPage.tsx` | Rename "Configs" → "Project Artifacts", remove Worktrees tab, add system vs project badges, add folder upload for skills |
| **Codebase Detail View** | NEW `pages/CodebaseDetailPage.tsx` or expand `ProjectDetailPage.tsx` | Click codebase → see worktrees + file browser with .gitignore |
| **Workflow Builder** | `pages/WorkflowBuilderPage.tsx`, `components/workflow/WorkflowConfigPanel.tsx`, `components/workflow/StagePropertiesPanel.tsx` | Add project picker, replace git repo config with codebase picker, add artifact picker for skills/prompts/agents |
| **Chat Creation** | `components/chat/CreateChatDialog.tsx` | Add project picker, replace repo URL with codebase picker, add artifact picker |
| **Automation Creation** | `pages/CreateAutomationPage.tsx` | Add project picker, scope workflow list to project |
| **Artifact Picker** | NEW `components/artifacts/ArtifactPicker.tsx` | Reusable picker showing system + project artifacts with badges |
| **Codebase File Browser** | NEW `components/codebase/CodebaseFileBrowser.tsx` | Tree view with .gitignore filtering |
| **Hooks** | `hooks/projectQueries.ts` | Add system artifact queries, codebase worktree queries, codebase file queries |
| **Platform Client** | `platform/HttpPlatformClient.ts` | Add new API methods for system artifacts, codebase files, codebase worktrees |
| **Router** | `router.tsx` | Add codebase detail route: `/projects/:id/codebases/:cid` |

### CLI (apps/cli)

| File | Changes |
|------|---------|
| `HttpPlatformClient` | Mirror new API endpoints |
| `DirectPlatformClient` | Mirror new service calls |
| Project-related commands | Update to handle artifacts instead of configs |

---

## 4. Implementation Phases

```
Phase 1 ─── Rename Configs → Project Artifacts (backend + frontend)
  │
Phase 2 ─── System Artifacts (new table, service, endpoints, UI badges)
  │
Phase 3 ─── Move Worktrees to Codebase Level (DB, service, routes, UI)
  │
Phase 4 ─── Codebase File Browser (.gitignore, file tree, routes)
  │
Phase 5 ─── Project Scoping (projectId on WF/Chat/Auto + creation pickers)
  │
Phase 6 ─── Artifact Picker in Workflow/Chat/Automation flows
  │
Phase 7 ─── System vs Project Indicators (UI polish, badges, filtering)
```

---

## 5. Phase 1: Rename Configs → Project Artifacts

### 5.1 Shared Types

**File:** `packages/shared/src/types/Project.ts`

```typescript
// Add new type alias (backward compat)
export type ProjectArtifact = ProjectConfig;  // Gradual rename
export type ArtifactType = ConfigType;        // 'agent' | 'prompt' | 'skill'

// Add source indicator
export type ArtifactSource = 'system' | 'project';

// Add enriched artifact with source info
export interface ArtifactWithSource extends ProjectConfig {
  source: ArtifactSource;
}
```

### 5.2 Backend Service

**File:** `packages/core/src/services/ProjectConfigService.ts`
- Rename class to `ProjectArtifactService` (keep old export as alias for backward compat)
- Add `isFolder` parameter to `uploadConfig()` for skill folder uploads
- Add `uploadFolder()` method for skills (recursive directory upload)

### 5.3 Server Routes

**File:** `apps/server/src/routes/projects.ts`
- Rename route handlers internally (comments/logs)
- Keep same URL paths for backward compat: `/projects/:id/configs`
- Add parallel routes: `/projects/:id/artifacts` → same handlers  
- Add folder upload support: `POST /projects/:id/artifacts/folder` (for skills)

### 5.4 Frontend

**File:** `apps/web/src/pages/ProjectDetailPage.tsx`
- Tab label: "Configs" → "Project Artifacts"
- Tab icon: keep or update to appropriate artifact icon
- Section headers: "Upload Config" → "Upload Artifact"
- Upload UI changes:
  - Skills: Allow file OR folder upload (use `webkitdirectory` attribute)
  - Prompts: File upload only
  - Custom Agents: File upload only
- Stats card: "Configs" → "Artifacts"

**File:** `apps/web/src/hooks/projectQueries.ts`
- Rename query keys: `project-configs` → `project-artifacts` (keep both for transition)

### 5.5 Estimated Changes

| Layer | Files Modified | Lines Changed |
|-------|---------------|---------------|
| Shared | 1 | ~20 |
| Core | 1 | ~50 |
| Server | 1 | ~30 |
| Web | 2 | ~80 |
| **Total** | **5** | **~180** |

---

## 6. Phase 2: System Artifacts

### 6.1 Concept

System artifacts are **platform-provided** skills, prompts, and custom agents that are available to ALL projects. They are:
- Loaded from a `templates/system/artifacts/` directory on boot
- Stored in a `system_configs` DB table (or served from filesystem only)
- Read-only from the UI (users cannot modify system artifacts)
- Clearly distinguished with a "System" badge in all lists

### 6.2 Filesystem Layout

```
templates/
  system/
    artifacts/
      skills/
        code-generation.md
        test-generation.md
        documentation.md
      prompts/
        review-prompt.md
        refactor-prompt.md
      agents/
        reviewer-agent.json
        tester-agent.json
```

### 6.3 Database Schema

**File:** `packages/db/src/schema.ts`

```typescript
export const systemConfigs = sqliteTable(
  'system_configs',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ['agent', 'prompt', 'skill'] }).notNull(),
    name: text('name').notNull(),
    description: text('description'),
    filePath: text('file_path').notNull(),
    version: text('version').default('1.0.0'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    typeIdx: index('idx_system_configs_type').on(table.type),
    uniqueNameIdx: uniqueIndex('idx_system_configs_unique').on(table.type, table.name),
  }),
);
```

### 6.4 New Service: `SystemArtifactService`

**File:** `packages/core/src/services/SystemArtifactService.ts`

```typescript
class SystemArtifactService {
  // Scan templates/system/artifacts/ on boot
  async loadSystemArtifacts(): Promise<void>
  
  // List all system artifacts (optionally by type)
  async listSystemArtifacts(type?: ArtifactType): Promise<SystemArtifact[]>
  
  // Get content of a system artifact
  async getSystemArtifactContent(id: string): Promise<string>
  
  // Get merged list: system + project artifacts
  async getAvailableArtifacts(projectId: string, type?: ArtifactType): Promise<ArtifactWithSource[]>
}
```

### 6.5 Server Routes

**File:** `apps/server/src/routes/projects.ts` (or new `routes/system.ts`)

```
GET  /api/system/artifacts              # List all system artifacts
GET  /api/system/artifacts?type=skill   # Filter by type
GET  /api/system/artifacts/:id          # Get system artifact content

# Combined endpoint: system + project artifacts
GET  /api/projects/:id/available-artifacts            # All available for project
GET  /api/projects/:id/available-artifacts?type=skill  # Filter by type
```

### 6.6 Frontend

- Add `useSystemArtifacts()` and `useAvailableArtifacts(projectId)` hooks
- In Project Artifacts tab: show system artifacts at top (read-only, "System" badge), project artifacts below (editable, "Project" badge)
- Add API method `listSystemArtifacts()` and `listAvailableArtifacts(projectId)` to `HttpPlatformClient`

### 6.7 Estimated Changes

| Layer | Files Modified/Created | Lines Changed |
|-------|----------------------|---------------|
| Shared | 1 modified | ~30 |
| DB | 2 (schema + new repo) | ~120 |
| Core | 1 new service + port | ~200 |
| Server | 2 (routes, composition-root) | ~80 |
| Web | 3 (page, hooks, client) | ~150 |
| Templates | New directory + sample files | ~200 |
| **Total** | **~10** | **~780** |

---

## 7. Phase 3: Move Worktrees to Codebase Level

### 7.1 Concept Change

**Before:** Project Detail → Worktrees tab (shows all worktrees for the project)
**After:** Project Detail → Codebases tab → Click codebase → Codebase Detail page → Worktrees section

### 7.2 Database Changes

**File:** `packages/db/src/repositories/WorktreeRepository.ts`
- Add `getByCodebaseId(codebaseId: string): Promise<WorktreeInfo[]>`

**File:** `packages/core/src/domain/ports/IWorktreeRepository.ts`
- Add `getByCodebaseId(codebaseId: string): Promise<WorktreeInfo[]>`

### 7.3 Service Changes

**File:** `packages/core/src/services/WorktreeService.ts`
- Add `listWorktreesByCodebase(codebaseId: string): Promise<WorktreeInfo[]>`

### 7.4 Route Changes

**File:** `apps/server/src/routes/projects.ts`

Remove from project-level:
```
# REMOVE (or deprecate with redirect)
GET    /projects/:id/worktrees
DELETE /projects/:id/worktrees/:wid
POST   /projects/:id/worktrees/cleanup
```

Add to codebase-level:
```
# ADD
GET    /projects/:id/codebases/:cid/worktrees           # List worktrees for codebase
DELETE /projects/:id/codebases/:cid/worktrees/:wid       # Remove worktree
POST   /projects/:id/codebases/:cid/worktrees/cleanup    # Cleanup orphans for codebase
```

### 7.5 Frontend Changes

**File:** `apps/web/src/pages/ProjectDetailPage.tsx`
- Remove "Worktrees" tab entirely
- Remove worktree-related state, queries, and UI from this page
- Update stats cards: remove "Active Worktrees" card (or keep as aggregate)

**New Route:** `/projects/:id/codebases/:cid`

**New File:** `apps/web/src/pages/CodebaseDetailPage.tsx`
```
CodebaseDetailPage
├── Header: codebase alias, type badge, status, last fetched
├── Actions: Fetch, List Branches, Remove
├── Tab: Worktrees
│   ├── List of worktrees for this codebase
│   ├── Status badges (active/completed/orphaned)
│   ├── Remove worktree button
│   └── Cleanup orphans button
└── Tab: Files  (Phase 4)
    ├── File tree with .gitignore filtering
    └── File content preview
```

**File:** `apps/web/src/hooks/projectQueries.ts`
- Add `useCodebaseWorktrees(projectId, codebaseId)` hook
- Add `useCodebaseFiles(projectId, codebaseId)` hook (Phase 4)

**File:** `apps/web/src/platform/HttpPlatformClient.ts`
- Add `listCodebaseWorktrees(projectId, codebaseId)`
- Add `removeCodebaseWorktree(projectId, codebaseId, worktreeId)`
- Add `cleanupCodebaseWorktrees(projectId, codebaseId)`

**File:** `apps/web/src/router.tsx`
- Add route: `{ path: 'projects/:id/codebases/:cid', element: <CodebaseDetailPage /> }`

**File:** `apps/web/src/pages/ProjectDetailPage.tsx` (Codebases tab)
- Make each codebase row **clickable** → navigates to `/projects/:id/codebases/:cid`

### 7.6 Estimated Changes

| Layer | Files Modified/Created | Lines Changed |
|-------|----------------------|---------------|
| DB | 1 repo modified | ~20 |
| Core | 1 service + 1 port modified | ~30 |
| Server | 1 routes file | ~60 |
| Web | 1 new page + 3 modified | ~400 |
| **Total** | **~7** | **~510** |

---

## 8. Phase 4: Codebase File Browser

### 8.1 Backend: File Listing with .gitignore

**New dependency:** `ignore` npm package (or similar .gitignore parser)

**File:** `packages/core/src/services/CodebaseService.ts`
- Add `listCodebaseFiles(codebaseId: string): Promise<FileEntry[]>`
- Reads the codebase's `clonePath` or `localPath`
- Parses `.gitignore` if present and filters files
- Returns recursive file listing with metadata

```typescript
interface FileEntry {
  path: string;         // Relative path from codebase root
  name: string;         // Filename
  type: 'file' | 'directory';
  size?: number;        // File size in bytes
  extension?: string;   // File extension
}
```

**File:** `apps/server/src/routes/projects.ts`

```
GET  /projects/:id/codebases/:cid/files              # List files (with .gitignore filtering)
GET  /projects/:id/codebases/:cid/files/content?path=  # Read file content
```

### 8.2 Frontend: File Tree Component

**New File:** `apps/web/src/components/codebase/CodebaseFileBrowser.tsx`
- Reuse `TreeNode` pattern from `RunArtifactsPanel.tsx`
- Expand/collapse folders
- File content preview with syntax highlighting
- .gitignore indicator (files hidden by .gitignore are not shown)

### 8.3 Integration in CodebaseDetailPage

- Add "Files" tab alongside "Worktrees" tab
- File browser component with lazy loading (expand folders on click)
- File content preview pane

### 8.4 Estimated Changes

| Layer | Files Modified/Created | Lines Changed |
|-------|----------------------|---------------|
| Shared | 1 (new FileEntry type) | ~15 |
| Core | 1 service modified | ~100 |
| Server | 1 routes modified | ~60 |
| Web | 2 (new component + page update) | ~350 |
| **Total** | **~5** | **~525** |

---

## 9. Phase 5: Project Scoping on Workflows/Chats/Automations

### 9.1 Database Schema Changes

**File:** `packages/db/src/schema.ts`

Add `projectId` column to `workflow_definitions`:
```typescript
// In workflowDefinitions table
projectId: text('project_id'),  // nullable — null means "global/unscoped"
```
Add index: `projectIdx: index('idx_workflow_defs_project').on(table.projectId)`

Add `projectId` column to `automations`:
```typescript
// In automations table  
projectId: text('project_id'),  // nullable — null means "global/unscoped"
```
Add index: `projectIdx: index('idx_automations_project').on(table.projectId)`

> **Note:** `chats` table already has `projectId` column (schema.ts L297).

### 9.2 Migration

**File:** `packages/db/src/index.ts` (in `migrateDB()`)

```typescript
addColumnIfNotExists(db, 'workflow_definitions', 'project_id', 'TEXT');
addColumnIfNotExists(db, 'automations', 'project_id', 'TEXT');
// chats.project_id already exists
```

### 9.3 Shared Types

**File:** `packages/shared/src/types/WorkflowDefinition.ts`
```typescript
export interface WorkflowDefinition {
  // ... existing fields
  projectId?: string;   // ADD — null means global
}

export interface CreateWorkflowDefinitionParams {
  // ... existing fields
  projectId?: string;   // ADD
}
```

**File:** `packages/shared/src/types/Automation.ts`
```typescript
export interface Automation {
  // ... existing fields
  projectId?: string;   // ADD — null means global
}
```

**File:** `packages/shared/src/types/Chat.ts`
```typescript
export interface Chat {
  // ... existing fields
  projectId?: string;   // ADD — null means global
}

export interface CreateChatParams {
  // ... existing fields
  projectId?: string;   // ADD
}
```

### 9.4 Repository Changes

**File:** `packages/db/src/repositories/WorkflowDefinitionRepository.ts`
- Update `create()` to persist `projectId`
- Update `getAll()` to accept optional `projectId` filter
- Add `getByProjectId(projectId: string): Promise<WorkflowDefinition[]>`

**File:** `packages/db/src/repositories/ChatRepository.ts`
- Update `create()` to persist `projectId`
- Add `getByProjectId(projectId: string): Promise<Chat[]>`

**File:** `packages/db/src/repositories/AutomationRepository.ts`
- Update `create()` to persist `projectId`
- Add `getByProjectId(projectId: string): Promise<Automation[]>`

### 9.5 Service Changes

**File:** `packages/core/src/services/WorkflowDefinitionService.ts`
- Update `createDefinition()` to accept and persist `projectId`
- Update `listDefinitions()` to accept optional `projectId` filter

**File:** `packages/core/src/services/ChatManagementService.ts`
- Update `createChat()` to accept and persist `projectId`
- Update `listChats()` to accept optional `projectId` filter

**File:** `packages/core/src/services/AutomationService.ts`
- Update `createAutomation()` to accept and persist `projectId`
- Update `listAutomations()` to accept optional `projectId` filter

### 9.6 Route Changes

**File:** `apps/server/src/routes/workflow-definitions.ts`
- `POST /workflow-definitions` — accept `projectId` in body
- `GET /workflow-definitions?projectId=xxx` — filter by project

**File:** `apps/server/src/routes/chats.ts`
- `POST /chats` — accept `projectId` in body
- `GET /chats?projectId=xxx` — filter by project

**File:** `apps/server/src/routes/automations.ts`
- `POST /automations` — accept `projectId` in body
- `GET /automations?projectId=xxx` — filter by project

### 9.7 Frontend: Project Picker in Creation Flows

**New Component:** `apps/web/src/components/common/ProjectPicker.tsx`

```tsx
// Reusable project selector dropdown
interface ProjectPickerProps {
  value?: string;                    // Selected project ID
  onChange: (projectId?: string) => void;
  required?: boolean;
  label?: string;
}
```

**Integration Points:**

1. **Workflow Creation** (`WorkflowConfigPanel.tsx`)
   - Add `ProjectPicker` at the top of the panel
   - When project selected: replace inline git repo config with codebase picker
   - When project selected: show available artifacts for skill/prompt/agent selection

2. **Chat Creation** (`CreateChatDialog.tsx`)
   - Add `ProjectPicker` at the top of the dialog
   - When project selected: replace repo URL field with codebase dropdown
   - When project selected: show available artifacts for configuration

3. **Automation Creation** (`CreateAutomationPage.tsx`)
   - Add `ProjectPicker` at the top of the form
   - When project selected: filter workflow list to only show project workflows

### 9.8 Frontend: Codebase Picker

**New Component:** `apps/web/src/components/common/CodebasePicker.tsx`

```tsx
// Shows codebases from the selected project
interface CodebasePickerProps {
  projectId: string;
  value: string[];                   // Selected codebase IDs/aliases
  onChange: (aliases: string[]) => void;
  multiple?: boolean;
}
```

Replaces the inline `GitRepositoryConfig` editor in:
- `WorkflowConfigPanel.tsx` (currently has manual URL/branch/alias fields)
- `CreateChatDialog.tsx` (currently has single repo URL field)

### 9.9 Estimated Changes

| Layer | Files Modified/Created | Lines Changed |
|-------|----------------------|---------------|
| Shared | 3 types modified | ~30 |
| DB | 3 repos + schema + migration | ~120 |
| Core | 3 services + ports | ~90 |
| Server | 3 route files | ~60 |
| Web | 5 (2 new components + 3 modified pages) | ~500 |
| **Total** | **~17** | **~800** |

---

## 10. Phase 6: Artifact Picker in Creation Flows

### 10.1 Concept

When editing a workflow stage, chat, or automation, users need to **select which skills, prompts, and custom agents** to apply. The picker should:
- Show **system artifacts** (badged "System") — always available
- Show **project artifacts** (badged "Project") — only when a project is selected
- Support multi-select for skills
- Support single-select for agents
- Show file preview on hover/click

### 10.2 New Component: `ArtifactPicker`

**File:** `apps/web/src/components/artifacts/ArtifactPicker.tsx`

```tsx
interface ArtifactPickerProps {
  projectId?: string;              // If set, shows project artifacts
  type: ArtifactType;              // 'skill' | 'prompt' | 'agent'
  selected: string[];              // Selected artifact IDs
  onChange: (ids: string[]) => void;
  multiple?: boolean;              // Multi-select (default: true for skills)
}
```

Features:
- Grouped sections: "System" and "Project" with visual dividers
- Badge indicators: blue "System" pill, green "Project" pill
- Search/filter within the list
- File content preview panel
- Checkbox/radio selection

### 10.3 Integration Points

1. **Stage Properties Panel** (`StagePropertiesPanel.tsx`)
   - New "Artifacts" section or tab
   - `ArtifactPicker` for skills (multi-select)
   - `ArtifactPicker` for prompts (shows available prompt templates)
   - `ArtifactPicker` for custom agents (single-select)
   - Selected artifacts stored on `StageDefinition.copilotConfigOverrides`

2. **Workflow Config Panel** (`WorkflowConfigPanel.tsx`)
   - New "Artifacts" section
   - `ArtifactPicker` for workflow-level skills/agents (inherited by all stages)
   - Selected artifacts stored on `WorkflowDefinition.copilotConfig`

3. **Chat Creation** (`CreateChatDialog.tsx`)
   - "Skills & Agents" section (visible when project selected)
   - `ArtifactPicker` for skills and agents
   - Selected artifacts stored on `Chat.copilotConfig`

### 10.4 Backend: Artifact Resolution

**File:** `packages/core/src/services/WorkflowOrchestrator.ts`

When a run starts:
1. Resolve `projectId` → load project artifacts
2. Merge system artifacts with project artifacts
3. For each selected skill → add file path to `skillDirectories`
4. For each selected agent → add to `customAgents` array
5. For each selected prompt → make available for prompt interpolation

```typescript
// Enhance startOrchestratedRun:
async resolveArtifactsForRun(
  projectId: string | undefined,
  selectedSkills: string[],
  selectedAgents: string[],
  selectedPrompts: string[]
): Promise<ResolvedArtifacts> {
  const systemArtifacts = await this.systemArtifactService.listSystemArtifacts();
  const projectArtifacts = projectId 
    ? await this.projectConfigService.listConfigs(projectId)
    : [];
  
  // Filter to selected, merge paths
  return {
    skillDirectories: [...systemSkillPaths, ...projectSkillPaths],
    customAgents: [...systemAgents, ...projectAgents],
    promptTemplates: [...systemPrompts, ...projectPrompts],
  };
}
```

### 10.5 Type Changes for Selected Artifacts

**File:** `packages/shared/src/types/StageDefinition.ts`
```typescript
export interface StageDefinition {
  // ... existing fields
  selectedArtifacts?: {
    skillIds?: string[];
    agentIds?: string[];
    promptIds?: string[];
  };
}
```

**File:** `packages/shared/src/types/WorkflowDefinition.ts`
```typescript
export interface WorkflowDefinition {
  // ... existing fields
  selectedArtifacts?: {
    skillIds?: string[];
    agentIds?: string[];
    promptIds?: string[];
  };
}
```

### 10.6 Estimated Changes

| Layer | Files Modified/Created | Lines Changed |
|-------|----------------------|---------------|
| Shared | 3 types modified | ~40 |
| Core | 2 services modified | ~150 |
| Server | 1 route modified | ~40 |
| Web | 4 (1 new component + 3 modified) | ~600 |
| **Total** | **~10** | **~830** |

---

## 11. Phase 7: System vs Project Indicators

### 11.1 Badge Component

**File:** `apps/web/src/components/common/SourceBadge.tsx`

```tsx
interface SourceBadgeProps {
  source: 'system' | 'project';
}

// System: blue pill with "System" text and shield icon
// Project: green pill with "Project" text and folder icon
```

### 11.2 Integration Points

| Location | What Gets Badge | Implementation |
|----------|----------------|----------------|
| Project Artifacts tab | Each artifact row | Prepend `SourceBadge` to name |
| ArtifactPicker | Each option | Badge before label |
| Workflow Config artifacts | Selected artifacts list | Badge in pill |
| Chat config artifacts | Selected artifacts list | Badge in pill |
| Templates list | System templates | "System" badge |

### 11.3 Estimated Changes

| Layer | Files Modified/Created | Lines Changed |
|-------|----------------------|---------------|
| Web | 5-6 (1 new + modifications) | ~200 |
| **Total** | **~6** | **~200** |

---

## 12. Database Migration Plan

All migrations use the existing idempotent pattern in `migrateDB()`:

```typescript
// In packages/db/src/index.ts migrateDB()

// Phase 2: System configs table
db.exec(`CREATE TABLE IF NOT EXISTS system_configs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('agent', 'prompt', 'skill')),
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  version TEXT DEFAULT '1.0.0',
  metadata TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_system_configs_type ON system_configs(type)`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_system_configs_unique ON system_configs(type, name)`);

// Phase 5: Add projectId to workflow_definitions and automations
addColumnIfNotExists(db, 'workflow_definitions', 'project_id', 'TEXT');
addColumnIfNotExists(db, 'automations', 'project_id', 'TEXT');
// Note: chats.project_id already exists

// Phase 5: Add indexes
db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_defs_project ON workflow_definitions(project_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id)`);

// Phase 6: Add selected_artifacts columns
addColumnIfNotExists(db, 'workflow_definitions', 'selected_artifacts', "TEXT DEFAULT '{}'");
addColumnIfNotExists(db, 'stage_definitions', 'selected_artifacts', "TEXT DEFAULT '{}'");
addColumnIfNotExists(db, 'chats', 'selected_artifacts', "TEXT DEFAULT '{}'");
```

---

## 13. API Changes Summary

### New Endpoints

| Method | Path | Phase | Purpose |
|--------|------|-------|---------|
| GET | `/api/system/artifacts` | 2 | List system artifacts |
| GET | `/api/system/artifacts/:id` | 2 | Get system artifact content |
| GET | `/api/projects/:id/available-artifacts` | 2 | System + project artifacts merged |
| GET | `/api/projects/:id/codebases/:cid/worktrees` | 3 | Codebase-level worktrees |
| DELETE | `/api/projects/:id/codebases/:cid/worktrees/:wid` | 3 | Remove codebase worktree |
| POST | `/api/projects/:id/codebases/:cid/worktrees/cleanup` | 3 | Cleanup codebase worktrees |
| GET | `/api/projects/:id/codebases/:cid/files` | 4 | List codebase files (.gitignore filtered) |
| GET | `/api/projects/:id/codebases/:cid/files/content` | 4 | Read codebase file content |
| POST | `/api/projects/:id/artifacts/folder` | 1 | Upload skill folder |

### Modified Endpoints

| Method | Path | Phase | Change |
|--------|------|-------|--------|
| POST | `/api/workflow-definitions` | 5 | Accept `projectId` |
| GET | `/api/workflow-definitions` | 5 | Accept `?projectId=` filter |
| POST | `/api/chats` | 5 | Accept `projectId` |
| GET | `/api/chats` | 5 | Accept `?projectId=` filter |
| POST | `/api/automations` | 5 | Accept `projectId` |
| GET | `/api/automations` | 5 | Accept `?projectId=` filter |

### Deprecated Endpoints

| Method | Path | Phase | Replacement |
|--------|------|-------|-------------|
| GET | `/api/projects/:id/worktrees` | 3 | `/api/projects/:id/codebases/:cid/worktrees` |
| DELETE | `/api/projects/:id/worktrees/:wid` | 3 | `/api/projects/:id/codebases/:cid/worktrees/:wid` |
| POST | `/api/projects/:id/worktrees/cleanup` | 3 | `/api/projects/:id/codebases/:cid/worktrees/cleanup` |

---

## 14. UI Changes Summary

### Pages Modified

| Page | Changes | Phase |
|------|---------|-------|
| `ProjectDetailPage` | Remove Worktrees tab, rename Configs→Artifacts, add source badges, folder upload | 1, 3, 7 |
| `WorkflowBuilderPage` | Pass projectId to config panel | 5 |
| `WorkflowConfigPanel` | Add project picker, codebase picker, artifact picker | 5, 6 |
| `StagePropertiesPanel` | Add artifact picker for stage-level skills/agents/prompts | 6 |
| `CreateChatDialog` | Add project picker, codebase picker, artifact picker | 5, 6 |
| `CreateAutomationPage` | Add project picker, filter workflows by project | 5 |

### New Pages

| Page | Purpose | Phase |
|------|---------|-------|
| `CodebaseDetailPage` | Worktrees + Files for a single codebase | 3, 4 |

### New Components

| Component | Purpose | Phase |
|-----------|---------|-------|
| `ProjectPicker` | Dropdown to select a project | 5 |
| `CodebasePicker` | Multi-select codebases from project | 5 |
| `ArtifactPicker` | Select skills/prompts/agents with system/project badges | 6 |
| `SourceBadge` | "System" or "Project" visual indicator | 7 |
| `CodebaseFileBrowser` | File tree with .gitignore filtering | 4 |

---

## 15. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Breaking existing workflows** (no projectId) | Medium | High | Make `projectId` nullable everywhere; existing entities remain "global/unscoped" |
| **DAGScheduler cache invalidation** with project-scoped definitions | Low | Medium | Ensure cache key includes projectId |
| **Migration failures** on existing data | Low | High | All migrations are additive (new columns, new tables); no column renames or drops |
| **SSE stream routing** with projectId filtering | Low | Medium | SSE streams are per-run/per-session, not per-project; no changes needed |
| **CLI parity** | Medium | Medium | CLI direct mode must mirror all new service methods; track in Phase 5 |
| **Performance** of codebase file listing | Medium | Medium | Add pagination/lazy-loading; limit depth; cache file trees |
| **.gitignore edge cases** (nested .gitignore, symlinks) | Medium | Low | Use well-tested npm `ignore` package; handle gracefully |
| **Folder upload** browser compatibility | Low | Low | `webkitdirectory` is supported in all modern browsers; add drag-and-drop fallback |
| **System artifacts directory missing** | Low | Low | Create on boot if not exists; graceful fallback to empty list |

---

## Overall Effort Estimate

| Phase | Description | Files | Lines |
|-------|-------------|-------|-------|
| 1 | Rename Configs → Project Artifacts | ~5 | ~180 |
| 2 | System Artifacts | ~10 | ~780 |
| 3 | Move Worktrees to Codebase Level | ~7 | ~510 |
| 4 | Codebase File Browser | ~5 | ~525 |
| 5 | Project Scoping (WF/Chat/Auto) | ~17 | ~800 |
| 6 | Artifact Picker in Creation Flows | ~10 | ~830 |
| 7 | System vs Project Indicators | ~6 | ~200 |
| **Total** | | **~60 files** | **~3,825 lines** |

---

## Dependency Order

```
Phase 1 (no deps)
  └─► Phase 2 (needs Phase 1 types)
       └─► Phase 7 (needs Phase 2 system artifacts)
Phase 3 (no deps, parallel with 1-2)
  └─► Phase 4 (needs Phase 3 codebase detail page)
Phase 5 (needs Phase 1 for artifact types)
  └─► Phase 6 (needs Phase 2 + 5 for artifact data + project scoping)
```

**Recommended execution order:** 1 → 3 → 2 → 4 → 5 → 6 → 7

Phases 1 and 3 can be done in parallel as they have no dependencies on each other.

---

## 16. Review Findings & Addendum

> This section was added after a thorough subagent review of the plan against the actual codebase. It captures gaps, corrections, and additional work items the initial plan missed.

### 16.1 Backend Gaps Identified

#### 16.1.1 Repository Methods MISSING (Must Create)

The following repository query methods **do not exist** and must be implemented:

| Repository | Method Needed | File |
|-----------|---------------|------|
| `ChatRepository` | `getByProjectId(projectId: string): Promise<Chat[]>` | `packages/db/src/repositories/ChatRepository.ts` |
| `WorkflowDefinitionRepository` | `getByProjectId(projectId: string): Promise<WorkflowDefinition[]>` | `packages/db/src/repositories/WorkflowDefinitionRepository.ts` |
| `AutomationRepository` | `getByProjectId(projectId: string): Promise<Automation[]>` | `packages/db/src/repositories/AutomationRepository.ts` |
| `WorktreeRepository` | `getByCodebaseId(codebaseId: string): Promise<WorktreeInfo[]>` | `packages/db/src/repositories/WorktreeRepository.ts` |

**Note:** `ProjectCodebaseRepository.getByProjectId()` and `ProjectConfigRepository.getByProjectId()` already exist and work correctly.

#### 16.1.2 Service Method Signatures NOT Updated

All three core services need `projectId` parameter additions:

**ChatManagementService** (`packages/core/src/services/ChatManagementService.ts`):
- `createChat(params)` — does NOT accept `projectId`
- `listChats()` — does NOT filter by `projectId`

**WorkflowDefinitionService** (`packages/core/src/services/WorkflowDefinitionService.ts`):
- `createDefinition(params)` — does NOT accept `projectId`
- `listDefinitions()` — does NOT filter by `projectId`

**AutomationService** (`packages/core/src/services/AutomationService.ts`):
- `createAutomation(params)` — does NOT accept `projectId`
- `listAutomations()` — does NOT filter by `projectId`

#### 16.1.3 Route Handlers NOT Updated

None of these route files currently parse or filter by `projectId`:

| Route File | Endpoints Needing Update |
|-----------|-------------------------|
| `apps/server/src/routes/workflowDefinitions.ts` | `POST /workflow-definitions`, `GET /workflow-definitions` |
| `apps/server/src/routes/chats.ts` | `POST /chats`, `GET /chats` |
| `apps/server/src/routes/automations.ts` | `POST /automations`, `GET /automations` |

#### 16.1.4 Database Column Status

| Table | `projectId` Column | `scope` Column | Status |
|-------|-------------------|----------------|--------|
| `chats` | ✅ EXISTS (L297) | — | Ready |
| `workflow_definitions` | ❌ MISSING | ✅ EXISTS | Needs migration |
| `automations` | ❌ MISSING | ✅ EXISTS | Needs migration |
| `workflow_runs` | ✅ EXISTS (L415) | — | Ready |

**Correction:** The `workflow_definitions` and `automations` tables have a `scope` column but NOT `projectId`. The migration must add `projectId TEXT` to both.

#### 16.1.5 SystemArtifactService — Full Implementation Needed

The following files must be **created from scratch**:

| File | Purpose |
|------|---------|
| `packages/core/src/services/SystemArtifactService.ts` | Service logic: load, list, get content |
| `packages/core/src/domain/ports/ISystemConfigRepository.ts` | Port interface |
| `packages/db/src/repositories/SystemConfigRepository.ts` | DB repository |
| `apps/server/src/routes/system.ts` | `/api/system/artifacts` routes |
| `templates/system/artifacts/skills/` | Default system skill files |
| `templates/system/artifacts/prompts/` | Default system prompt files |
| `templates/system/artifacts/agents/` | Default system agent files |

**Composition root** (`apps/server/src/composition-root.ts`) must wire `SystemArtifactService` with its dependencies.

#### 16.1.6 CLI Parity Files

The plan should track these CLI files that need updating:

| CLI File | Changes |
|----------|---------|
| `apps/cli/src/platform/HttpPlatformClient.ts` | Add all new API methods (system artifacts, codebase worktrees, codebase files, project-filtered lists) |
| `apps/cli/src/platform/DirectPlatformClient.ts` | Mirror all new service calls for direct mode |
| Project commands in `apps/cli/src/commands/` | Update config → artifact terminology, add project scoping flags |

---

### 16.2 Frontend Gaps Identified

#### 16.2.1 List Pages Missing Project Filter Dropdown

These existing list pages need a **project filter dropdown** at the top:

| Page | File | Current Filters | Missing |
|------|------|----------------|---------|
| Workflows List | `apps/web/src/pages/WorkflowListPage.tsx` | Search + Tags | Project dropdown |
| Chats List | `apps/web/src/pages/ChatsListPage.tsx` | Search + Status | Project dropdown |
| Automations List | `apps/web/src/pages/AutomationsPage.tsx` | None | Project dropdown |

#### 16.2.2 ChatPage (Ongoing Chat) — Project Context

**File:** `apps/web/src/pages/ChatPage.tsx`

When a chat is associated with a project, the ongoing chat page should:
- Show the project name in the header/breadcrumb
- Show associated codebases in the sidebar
- Restrict skill/agent selection to available artifacts

#### 16.2.3 WorkflowRunExecution — Project Selection at Run Time

**Current:** `OrchestratedRunParams` already has `projectId` and `selectedCodebases`
**Gap:** The "Run Workflow" dialog/page needs:
- Pre-fill `projectId` from the workflow definition
- Show codebase picker if workflow has `requiresCodebase: true`
- Allow overriding with different project at run time

**File to check:** The execution trigger in `WorkflowBuilderPage.tsx` or a run dialog component.

#### 16.2.4 Navigation: Codebases Must Be Clickable

**File:** `apps/web/src/pages/ProjectDetailPage.tsx` (Codebases tab)

Current codebase items are **not clickable**. They need:
```tsx
onClick={() => navigate(`/projects/${projectId}/codebases/${codebase.id}`)}
```
Each codebase row should have a click handler + visual hover state.

#### 16.2.5 Complete New Component Inventory

| Component | File to Create | Phase | Dependencies |
|-----------|---------------|-------|-------------|
| `ProjectPicker` | `apps/web/src/components/common/ProjectPicker.tsx` | 5 | `useProjects()` hook |
| `CodebasePicker` | `apps/web/src/components/common/CodebasePicker.tsx` | 5 | `useProjectCodebases()` hook |
| `ArtifactPicker` | `apps/web/src/components/artifacts/ArtifactPicker.tsx` | 6 | `useAvailableArtifacts()` hook |
| `SourceBadge` | `apps/web/src/components/common/SourceBadge.tsx` | 7 | None |
| `CodebaseDetailPage` | `apps/web/src/pages/CodebaseDetailPage.tsx` | 3 | Router config |
| `CodebaseFileBrowser` | `apps/web/src/components/codebase/CodebaseFileBrowser.tsx` | 4 | File API + ignore pkg |

#### 16.2.6 Complete New Hook Inventory

| Hook | File | Phase | API Endpoint |
|------|------|-------|-------------|
| `useSystemArtifacts(type?)` | `projectQueries.ts` | 2 | `GET /api/system/artifacts` |
| `useAvailableArtifacts(projectId?, type?)` | `projectQueries.ts` | 2 | `GET /api/projects/:id/available-artifacts` |
| `useCodebaseWorktrees(projectId, codebaseId)` | `projectQueries.ts` | 3 | `GET /api/projects/:id/codebases/:cid/worktrees` |
| `useCodebaseFiles(projectId, codebaseId)` | `projectQueries.ts` | 4 | `GET /api/projects/:id/codebases/:cid/files` |

#### 16.2.7 Complete New Platform Client Methods

| Method | Phase | Endpoint |
|--------|-------|----------|
| `listSystemArtifacts(type?)` | 2 | `GET /api/system/artifacts` |
| `getSystemArtifactContent(id)` | 2 | `GET /api/system/artifacts/:id` |
| `listAvailableArtifacts(projectId, type?)` | 2 | `GET /api/projects/:id/available-artifacts` |
| `listCodebaseWorktrees(projectId, codebaseId)` | 3 | `GET /api/projects/:id/codebases/:cid/worktrees` |
| `removeCodebaseWorktree(projectId, codebaseId, wid)` | 3 | `DELETE /api/projects/:id/codebases/:cid/worktrees/:wid` |
| `cleanupCodebaseWorktrees(projectId, codebaseId)` | 3 | `POST /api/projects/:id/codebases/:cid/worktrees/cleanup` |
| `listCodebaseFiles(projectId, codebaseId)` | 4 | `GET /api/projects/:id/codebases/:cid/files` |
| `getCodebaseFileContent(projectId, codebaseId, path)` | 4 | `GET /api/projects/:id/codebases/:cid/files/content` |

---

### 16.3 Corrected Overall Effort Estimate

| Phase | Description | Files | Lines (Corrected) |
|-------|-------------|-------|--------------------|
| 1 | Rename Configs → Project Artifacts | ~5 | ~180 |
| 2 | System Artifacts + Backend Foundation | ~14 | ~1,000 |
| 3 | Move Worktrees to Codebase Level | ~9 | ~600 |
| 4 | Codebase File Browser | ~6 | ~600 |
| 5 | Project Scoping (WF/Chat/Auto) + Pickers | ~22 | ~1,100 |
| 6 | Artifact Picker in Creation Flows | ~12 | ~900 |
| 7 | System vs Project Indicators + List Filters | ~9 | ~350 |
| **Total** | | **~77 files** | **~4,730 lines** |

### 16.4 Corrected Recommended Execution Order

```
BACKEND FIRST:
  Step 1: Add projectId columns to workflow_definitions + automations (migration)
  Step 2: Add repository methods (getByProjectId, getByCodebaseId)
  Step 3: Update service signatures (accept/persist/filter projectId)
  Step 4: Update route handlers (parse projectId, add query filters)
  Step 5: Create SystemArtifactService + SystemConfigRepository + routes
  Step 6: Wire composition root
  Step 7: Add codebase-level worktree routes
  Step 8: Add codebase file listing endpoint + .gitignore parser

FRONTEND:
  Step 9:  Phase 1 — Rename Configs → Artifacts in UI
  Step 10: Phase 3 — CodebaseDetailPage + router + clickable codebases
  Step 11: Phase 5 — ProjectPicker + CodebasePicker + integration
  Step 12: Phase 2 — System artifacts display + hooks
  Step 13: Phase 4 — CodebaseFileBrowser
  Step 14: Phase 6 — ArtifactPicker + stage/workflow/chat integration
  Step 15: Phase 7 — SourceBadge + list page filters
  
CLI (AFTER BACKEND):
  Step 16: Update HttpPlatformClient + DirectPlatformClient
  Step 17: Update CLI commands for artifact terminology + project scoping
```

### 16.5 Pre-Implementation Checklist

Before starting implementation, verify:

- [ ] `packages/db/src/schema.ts` — confirm exact column names/types for projectId additions
- [ ] `packages/db/src/index.ts` — confirm `addColumnIfNotExists` helper signature
- [ ] `apps/server/src/composition-root.ts` — map all current service constructors for wiring changes
- [ ] `apps/web/src/router.tsx` — confirm lazy import pattern for new pages
- [ ] `npm` package availability of `.gitignore` parser (e.g., `ignore` by @nicolo-ribaudo)
- [ ] Confirm `webkitdirectory` attribute works in Electron (for future desktop app)
- [ ] Check if `RunArtifactsPanel.tsx` TreeNode pattern can be extracted to a shared component
