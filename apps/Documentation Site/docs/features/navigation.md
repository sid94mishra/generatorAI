---
description: Navigate Mission Control, entity lists, command actions, and the application workspace.
---
# Dashboard and navigation

The home page is **Mission Control**: an overview of activity across agents, workflows, and automations. Use it to identify work that is running or needs attention, then open the relevant chat or run for detailed interaction.

## Application areas

The navigation shell links to Dashboard, Projects, Chats, Agents, Workflows, Scripts, Automations, and Settings. On desktop the shell also provides native window integration. The web layout adapts its sidebar and workspace panels to narrower windows; the mobile client has its own navigation implementation.

The dashboard provides quick creation, activity, counts for chat/workflow/automation work, and system health. Health is useful before troubleshooting a run: a provider that is not ready or a disconnected server can explain why a model or capability is absent.

## Find an item

Lists provide search and module-specific filters rather than a single full-text index over all stored content. For example, the Chats page searches names and tags and filters All, Active, or Archived. It sorts by the latest update and virtualizes large lists. Do not interpret this search as a transcript-wide server search.

The command palette groups navigation, creation actions, and settings destinations. Use it to jump to a page or begin a new project, chat, agent, workflow, or automation. The page Find control is separate: it locates rendered page text rather than querying all project files or historical chats.

## Manage list actions

Create actions open the corresponding editor or dialog. Entity cards and rows open the selected item; overflow menus expose contextual actions. Destructive actions use confirmation dialogs. On the Chats page, **Select** starts bulk selection; **Select all** follows the current filtered list. Review the selected count before confirming deletion because deletion is different from archiving.

Breadcrumbs on project, workflow, and run detail pages preserve the owning context. If a run was created from an automation, its execution history remains the place to inspect how that run relates to other iterations.

## Work in the central view and dock

Chats and workflow runs have a central transcript/timeline and a resizable right-side workspace dock. Use the dock's **Add tab** menu to open another surface, its overflow menu to reach tabs that do not fit, and its full-screen control when inspecting large files. On a narrow content area it becomes an overlay so the transcript does not shrink to an unreadable column. See [Workspace panels](./workspace-panels.md).

Navigation state, appearance preferences, and some panel preferences are local to a client. Projects, chats, workflows, and runs are persisted on the server. Switching browsers or servers should not be expected to carry every local layout preference with it.

## Source evidence

`apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/components/dashboard`, `apps/web/src/components/layout/AppLayout.tsx`, `apps/web/src/components/layout/CommandPalette.tsx`, `apps/web/src/components/layout/FindBar.tsx`, `apps/web/src/pages/ChatsListPage.tsx`, and `apps/web/src/components/layout/RightPane.tsx`.

## Configuration and worked examples

[Projects And Settings](../configuration/projects-and-settings.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
