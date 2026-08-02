# Feature: Projects & Codebases

> Projects are top-level containers grouping codebases (git repos / local directories) and project-scoped assets (skills, prompts, agents, MCP servers). Every codebase can be carved into per-run worktrees.

For execution workspaces (run-scoped filesystem), see [feature-workspaces-files.md](./feature-workspaces-files.md). For the asset types (skill/agent/prompt/MCP), see [feature-skills-agents-mcp.md](./feature-skills-agents-mcp.md).

---

## 1. Filesystem layout

```
~/.generatorai/
├── data.db                                     SQLite database
├── workspaces/                                 (legacy v1 + execution workspaces)
├── artifacts/                                  (artifactsDir)
│   ├── projects/
│   │   └── <projectId>/
│   │       ├── repos/<alias>/                  cloned codebases (bare clone for git-remote)
│   │       ├── worktrees/<runId>/<alias>/      legacy per-run worktrees (now mostly under workspaces/)
│   │       ├── config/
│   │       │   ├── agents/<file>
│   │       │   ├── prompts/<file>
│   │       │   ├── skills/<file>
│   │       │   └── mcp/<name>.json
│   │       └── artifacts/                      project-level artifact storage
│   └── <sessionId>/<artifactId>-<name>         session-scoped artifacts (legacy)
└── templates/
    └── system/
        ├── *.json                              v2 system DAG templates
        ├── mcp-servers.json                    system MCP registry
        └── artifacts/
            ├── agents/
            ├── prompts/
            └── skills/
```

---

## 2. Entities

### `projects` table

```
id                text PK
name              text
description?      text
settings          JSON ProjectSettings
rootPath          text                       always = <artifactsDir>/projects/<id>
status            enum 'active' | 'archived'
createdAt, updatedAt
```

`ProjectSettings`:
```typescript
{
  defaultModel?: string;
  defaultSessionMode?: 'single'|'per-stage'|'auto';
  maxCodebases?: number;                // default 10
  worktreeRetention?: 'immediate'|'hours-24'|'hours-72'|'manual';
  autoFetchInterval?: number;           // minutes; 0 = disabled
  copilotConfig?: Partial<HarnessConfig>;
}
```

### `project_codebases` table

```
id                  text PK
projectId           FK
alias               text                    unique within project (e.g., "core-api")
type                enum 'git-remote' | 'git-local' | 'local-dir'
url?                text                    (git-remote only)
localPath?          text                    (git-local + local-dir)
defaultBranch?      text
subdirectory?       text                    if working only within a subdir of the repo
clonePath?          text                    where it lives on disk
status              enum 'pending'|'cloning'|'ready'|'error'|'stale'
lastFetchedAt?
lastError?          text
settings            JSON CodebaseSettings
createdAt, updatedAt
```

`CodebaseSettings`:
```typescript
{
  autoFetchEnabled?: boolean;
  autoFetchIntervalMinutes?: number;
  shallowClone?: boolean;
  worktreeInclude?: string[];           // e.g., ['.env', 'config.local.json']
                                         // these files are COPIED into each new worktree from the codebase source
}
```

### Codebase type semantics

| Type | Storage | Worktree creation |
|---|---|---|
| `git-remote` | bare clone in `repos/<alias>` | `git worktree add` from the bare repo |
| `git-local` | reference to existing local repo (`clonePath = localPath`) | `git worktree add` from that repo |
| `local-dir` | reference only | directory **copy** (recursive `cp -r`) — no git |

### `project_configs` table

```
id                  text PK
projectId           FK
type                enum 'agent' | 'prompt' | 'skill'   (mcp uses same table with type='mcp')
name                text
description?        text
filePath            text                   relative to <project>/config/<type>s/
metadata            JSON
createdAt, updatedAt
```

### `worktrees` table (legacy, project-scoped)

```
id              text PK
projectId       FK
codebaseId      FK
runId?          text
runType?        enum 'workflow'|'automation'|'manual'
worktreePath    text                       <project>/worktrees/<runId>/<alias>/
branchName      text                       e.g., generatorai/run-<shortId>-<alias>
status          enum 'active'|'completed'|'orphaned'|'cleanup-pending'
createdAt, cleanedUpAt
```

> Note: With the workspace migration (v8) most worktrees now live under `execution_workspaces` / `workspace_worktrees`, not under `projects/<id>/worktrees`. The `worktrees` table is still used for backwards compatibility and for project-scoped worktrees not bound to an execution.

### `system_configs` table

```
id              text PK
type            enum 'agent'|'prompt'|'skill'
name            text
description?    text
filePath        text                    absolute path
version         text default '1.0.0'
metadata        JSON
createdAt, updatedAt
```

Populated on boot by `SystemArtifactService.loadSystemArtifacts()` which scans `templates/system/artifacts/{agents,prompts,skills}/` and upserts.

---

## 3. Project lifecycle

### Create

`POST /api/projects` body:
```typescript
{ name: string, description?: string, settings?: Partial<ProjectSettings> }
```

`ProjectService.createProject(params)`:
1. Generate UUID.
2. Resolve `rootPath = <artifactsDir>/projects/<id>`.
3. Merge default settings (`maxCodebases: 10, worktreeRetention: 'hours-24'`).
4. `fs.mkdir` the full structure:
   ```
   <root>/repos/
   <root>/worktrees/
   <root>/config/agents/
   <root>/config/prompts/
   <root>/config/skills/
   <root>/config/mcp/
   <root>/artifacts/
   ```
5. Insert `projects` row.

### Update

`PUT /api/projects/:id` patches `name`, `description`, `settings`, `status`. **No filesystem changes.**

### Archive / Delete

- `DELETE /api/projects/:id` → archive (sets `status='archived'`).
- `DELETE /api/projects/:id?force=true` → cascading hard delete:
  1. Cascade DB: `project_codebases`, `project_configs`, `worktrees`.
  2. `fs.rm(rootPath, { recursive: true, force: true })`.

---

## 4. Codebase lifecycle

### Link

`POST /api/projects/:id/codebases` body:
```typescript
{
  alias: string;                          // unique within project
  type: 'git-remote' | 'git-local' | 'local-dir';
  url?: string;                           // git-remote
  localPath?: string;                     // git-local + local-dir
  defaultBranch?: string;
  subdirectory?: string;
  settings?: CodebaseSettings;
}
```

`CodebaseService.linkCodebase`:
1. Validate project + max count + alias uniqueness.
2. Insert row with `status='pending'`.
3. Depending on type:
   - **`git-remote`** — fire-and-forget `cloneRemoteRepo`: bare clone via `GitManager.bareClone(url, clonePath)` → status `cloning` → `ready` (or `error`).
   - **`git-local`** — synchronous: verify `.git` exists at `localPath` → status `ready`.
   - **`local-dir`** — synchronous: verify path exists → status `ready`.

### Fetch

`POST /api/projects/:id/codebases/:cid/fetch` — `GitManager.fetch(clonePath)`. Only meaningful for `git-remote` (and `git-local` if you want to pull from its remote). `local-dir` is a no-op.

### Browse files

```
GET  /api/projects/:id/codebases/:cid/files?path=<subPath>   → tree
GET  /api/projects/:id/codebases/:cid/files/content?path=…   → file body
GET  /api/projects/:id/codebases/:cid/branches               → all branches
GET  /api/projects/:id/codebases/:cid/status                 → status + last error
```

### Unlink

`DELETE /api/projects/:id/codebases/:cid`:
1. Remove DB row (cascade `worktrees`).
2. Delete bare clone (`git-remote` only) from disk.

> **Edge case — active worktrees:** unlinking a codebase that has active worktrees fails with `409 Conflict`. Remove the worktrees first.

### Updating

`PUT /api/projects/:id/codebases/:cid` — alias, defaultBranch, subdirectory, settings.

---

## 5. Worktrees

`WorktreeService` ([packages/core/src/services/WorktreeService.ts](../../packages/core/src/services/WorktreeService.ts)).

### Create per run

`createRunWorktrees(projectId, runId, selectedAliases, runType, targetDir?)`:

For each alias:
1. Look up codebase.
2. `worktreePath` = `targetDir ? path.join(targetDir, alias) : <project>/worktrees/<runId>/<alias>`.
3. `branchName` = `generatorai/run-<shortRunId>-<alias>`.
4. **`local-dir`** → recursive copy of `localPath` → `worktreePath`. No git ops.
5. **`git-remote` / `git-local`** → `GitManager.createWorktree(clonePath, worktreePath, branchName, baseBranch)`.
6. **Apply `worktreeInclude`** — copy files like `.env` from the source repo into the worktree.
7. Insert `worktrees` row (legacy) **and/or** `workspace_worktrees` row (new) depending on which workspace the worktree belongs to.

Worktrees created for a workflow run live under `<execution_workspace>/source/<alias>/` when `useWorktree=true`. They are torn down per the retention policy.

### Cleanup

`WorktreeCleanupService` runs a periodic sweep (default hourly):
1. Read `worktrees WHERE status='active'`.
2. For each: compute `age = now - createdAt`. If `age >= retention` → mark `cleanup-pending`.
3. Call `WorktreeService.removeWorktree(id)`:
   - `git worktree remove` (for git types).
   - `fs.rm(worktreePath, { recursive: true, force: true })`.
   - Update `worktrees.status='completed'`, `cleanedUpAt`.

Retention values: `immediate` | `hours-24` | `hours-72` | `manual`. `manual` is never auto-cleaned.

---

## 6. Project configs (agents / prompts / skills / mcp)

### Upload

`POST /api/projects/:id/configs` (multipart):
```
type      = 'agent' | 'prompt' | 'skill'
name      = string
filePath  = string                   (relative; e.g., 'security-agent.md')
description? = string
file      = <File>
```

`ProjectConfigService.uploadConfig`:
1. Validate project exists.
2. Compute `fullPath = <project>/config/<type>s/<filePath>`.
3. **Path traversal check** — `path.resolve(fullPath).startsWith(path.resolve(configDir))` must hold.
4. `fs.mkdir(dirname, recursive)` + `fs.writeFile(fullPath, content)`.
5. Insert `project_configs` row.

### List

```
GET /api/projects/:id/configs[?type=agent|prompt|skill|mcp]
```

### Get / Update / Delete

```
GET    /api/projects/:id/configs/:cid          → metadata + content
PUT    /api/projects/:id/configs/:cid          → update content (string body)
DELETE /api/projects/:id/configs/:cid          → remove + unlink file
```

### MCP servers

Stored as configs with `type='mcp'`; content is JSON:
```json
{
  "serverType": "http" | "stdio",
  "url": "http://localhost:3000",
  "command": "/usr/bin/mcp-server",
  "args": ["--port", "3000"],
  "enabled": true,
  "env": {}
}
```

Dedicated endpoints (which under the hood persist a `mcp` config):
```
GET    /api/projects/:id/mcp-servers       → array merged with system servers
POST   /api/projects/:id/mcp-servers       → create
PUT    /api/projects/:id/mcp-servers/:mid  → update
DELETE /api/projects/:id/mcp-servers/:mid  → delete
```

### Merged artifact view

`GET /api/projects/:id/available-artifacts[?type=skill|prompt|agent]` returns a unified list:
```json
[
  { "id": "sys-agent-foo", "type": "agent", "name": "foo", "source": "system",  … },
  { "id": "proj-agent-bar", "type": "agent", "name": "bar", "source": "project", … }
]
```

Used by `SkillSelector`, `AgentSelector`, `McpServerSelector` in the workflow builder.

---

## 7. CLI

```powershell
# Projects
generatorai project list [--status active|archived]
generatorai project create <name> [--description "..."]
generatorai project show <id>
generatorai project update <id> --name "..." --description "..."
generatorai project delete <id> [--force]

# Codebases
generatorai project codebase list <projectId>
generatorai project codebase link <projectId> \
  --alias core-api \
  --type git-remote \
  --url https://github.com/org/repo.git \
  --defaultBranch main
generatorai project codebase fetch <projectId> <codebaseId>
generatorai project codebase branches <projectId> <codebaseId>
generatorai project codebase browse <projectId> <codebaseId> [--path src/]
generatorai project codebase file <projectId> <codebaseId> <path>
generatorai project codebase update <projectId> <codebaseId> --defaultBranch dev
generatorai project codebase unlink <projectId> <codebaseId>

# Configs
generatorai project config list <projectId> [--type agent|prompt|skill]
generatorai project config upload <projectId> <type> <file>
generatorai project config get <projectId> <configId>
generatorai project config update <projectId> <configId> <file>
generatorai project config delete <projectId> <configId>

# MCP
generatorai project mcp list <projectId>
generatorai project mcp add <projectId> --name "..." --type http|stdio [--config <json>]
generatorai project mcp update <projectId> <serverId> --config <json>
generatorai project mcp remove <projectId> <serverId>

# Worktrees
generatorai project worktree list <projectId>
generatorai project worktree remove <projectId> <worktreeId>
generatorai project worktree cleanup <projectId>
```

---

## 8. SDK (advanced — services only)

There is no `ai.projects` facade currently. Access via `ai.services`:

```typescript
const proj = await ai.services.projectService.createProject({ name: 'Acme' });
await ai.services.codebaseService.linkCodebase(proj.id, {
  alias: 'core',
  type: 'git-remote',
  url: 'https://github.com/acme/core.git',
});
const codebases = await ai.services.codebaseService.getByProjectId(proj.id);
```

---

## 9. Edge cases & gotchas

1. **Alias uniqueness** — `project_codebases.alias` has a unique index per project. Reusing an alias on different projects is fine.
2. **`git-remote` clones bare** — `repos/<alias>/` is a bare repo (`.git` directory style with no working tree). Necessary for `git worktree add`.
3. **`local-dir` worktrees use `cp -r`** — heavy for large dirs. Prefer `git-local` if the user can `git init` their directory.
4. **`worktreeInclude`** — files copied verbatim from the source repo into each new worktree. Useful for `.env` files that aren't committed. Path traversal is *not* checked here because the source path is the codebase's own clone.
5. **Project deletion with active worktrees** — cascades worktrees away but does not stop running workflows. Cancel runs first.
6. **MCP server enable/disable** — `enabled` field on the JSON config. Workflow stages can additionally exclude via `harnessConfigOverrides.excludedTools`.
7. **System artifacts auto-load** — on every server boot. New files dropped into `templates/system/artifacts/<type>s/` appear without manual DB sync.
8. **Project filter on workflows** — `scope='project'` workflows are invisible in the global list unless `?projectId=<id>` is passed.
9. **Codebase status `error`** — happens when clone fails (e.g., bad URL, auth required). `lastError` field captures the message; UI shows in `CodebaseDetailPage`.
10. **Branches** — `GET /api/projects/:id/codebases/:cid/branches` shells out to `git for-each-ref refs/heads refs/remotes`. Returns up to 1000 names.
11. **Project rootPath move** — `rootPath` is stored in DB. If you move the artifacts directory on disk, you must update each project's rootPath manually (no migration helper yet).
