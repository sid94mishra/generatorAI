---
description: Create projects, attach codebases, inspect files and worktrees, and manage project-scoped configuration.
---
# Projects and codebases

A project groups codebases and reusable configuration. A codebase describes a source location; a workspace is the execution environment assembled from those sources for a chat, workflow, or automation. Multiple codebases let one task work across a frontend, backend, and shared library without representing them as unrelated projects.

## Create a project

1. Open **Projects → Create Project**.
2. Enter a name and optional description.
3. Choose the worktree retention policy and maximum codebase count.
4. Add repositories now, or create the project and add them later from its **Codebases** tab.
5. Wait for remote repositories to finish cloning before using them as execution sources.

| Source type | Input | Use |
| --- | --- | --- |
| Remote Git Repo | Repository URL, alias, optional default branch | Clone a remote repository on the server host |
| Local Git Repo | Host filesystem path, alias, optional branch | Work from an existing repository on the server host |
| Local Directory | Host filesystem path and alias | Use files that are not a Git repository |

Paths refer to the machine running GeneratorAI's server. In a remote connection, a laptop path is not automatically a path on that server. Aliases distinguish codebases in prompts, selectors, and mounted workspaces.

## Inspect and maintain codebases

The project **Codebases** tab shows repository status, clone errors, and fetch actions. Open a codebase for **Worktrees** and **Files**. Git-backed codebases expose branch selection and a last-fetched value. Use **Sync / Fetch latest** to update remote references; inspect the reported error if authentication, network access, or a branch prevents completion.

The file browser supports source inspection and rendered previews for supported content. A preview is not execution of an arbitrary application. Worktree entries identify isolated working copies associated with runs; removal is a filesystem operation, not simply hiding a row.

The codebase update contract permits correcting a remote URL or local path, as well as alias, branch, subdirectory, and settings. Client editing surfaces differ; the API contract should not be mistaken for a complete form on every client.

## Project customization

Open **Project Customization** to inspect Skills, Prompts, Custom Agents, and MCP Servers. System catalog items can be enabled for a project, while project items can be uploaded, viewed, edited where supported, and removed. A skill folder must contain the required skill entry file; uploading the folder preserves its supporting files. The web upload flow enforces a 10 MB per-file limit.

MCP servers are registered configurations, not arbitrary inline tool descriptions. The project form exposes HTTP or STDIO setup. Required inputs and credentials must be configured before a server becomes effectively available. See [Skills and integrations](./integrations.md).

Project customization's agent artifacts and the first-class [Agents](./agents.md) editor serve related but distinct purposes. Use the agent editor for portable agent bindings, runtime policy, capabilities, and teams.

## Settings and lifecycle

The project **Settings** tab exposes worktree retention and maximum codebase count. Retention values are immediate cleanup, 24 hours, 72 hours, or manual cleanup. These codebase worktree policies are distinct from the server-wide completed-workspace cleanup in Settings → Storage.

The **Pull requests** tab lists source-control work for linked repositories. Repository account configuration lives in Settings → Source Control. Deleting a codebase removes its managed worktrees; deleting a project has broader effects than archiving a chat. Read the confirmation and preserve wanted changes before removal.

## Source evidence

`apps/web/src/pages/CreateProjectPage.tsx`, `apps/web/src/pages/ProjectDetailPage.tsx`, `apps/web/src/pages/CodebaseDetailPage.tsx`, `apps/web/src/components/codebase/CodebaseFileBrowser.tsx`, `apps/web/src/components/scm/ProjectPullRequestsTab.tsx`, and `packages/shared/src/types/Project.ts`.

## Configuration and worked examples

[Projects And Settings](../configuration/projects-and-settings.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
