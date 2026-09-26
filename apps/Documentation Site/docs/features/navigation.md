---
description: Navigate Home, entity lists, command actions, and the application workspace.
---
# Home and navigation

The start page is **Home**: its headline counts what needs you and what is running across chats, workflow runs and automations. Start a chat from the quick composer, answer a tool permission, plan review or stage approval inline from **Needs you**, stop work from **Running**, and retry a failure from **Recently finished**; open any row for detailed interaction.

## Application areas

The navigation shell links to Home, Chats, Projects, Agents, Workflows, Automations, Scripts, and Settings. On desktop the shell also provides native window integration. The web layout adapts its sidebar and workspace panels to narrower windows; the mobile client has its own navigation implementation.

Home's side column shows this week's numbers (chats, workflow runs, run success rate, average run time), a System card (connection, running agents, database size, disk, uptime, version — **Diagnostics** opens Settings › Diagnostics) and shortcut counts. System health is useful before troubleshooting a run: a provider that is not ready or a disconnected server can explain why a model or capability is absent.

## Find an item

Lists provide search and module-specific filters rather than a single full-text index over all stored content. For example, the Chats page searches names and tags and filters All, Active, or Archived. It sorts by the latest update and virtualizes large lists. Do not interpret this search as a transcript-wide server search.

The command palette groups navigation, creation actions, recent chats and — as you type — matching chats, projects, agents, workflows, automations and scripts from the server. Use it to jump to a page or an item, or begin a new chat or workflow; Tab lists a row's actions. The page Find control is separate: it locates rendered page text rather than querying all project files or historical chats.

## Manage list actions

Create actions open the corresponding editor or dialog. Entity cards and rows open the selected item; overflow menus expose contextual actions. Destructive actions use confirmation dialogs. On the Chats page, **Select** starts bulk selection; **Select all** follows the current filtered list. Review the selected count before confirming deletion because deletion is different from archiving.

Breadcrumbs on project, workflow, and run detail pages preserve the owning context. If a run was created from an automation, its execution history remains the place to inspect how that run relates to other iterations.

## Work in the central view and dock

Chats and workflow runs have a central transcript/timeline and a resizable right-side workspace dock. Use the dock's **Add tab** menu to open another surface, its overflow menu to reach tabs that do not fit, and its full-screen control when inspecting large files. On a narrow content area it becomes an overlay so the transcript does not shrink to an unreadable column. See [Workspace panels](./workspace-panels.md).

Navigation state, appearance preferences, and some panel preferences are local to a client. Projects, chats, workflows, and runs are persisted on the server. Switching browsers or servers should not be expected to carry every local layout preference with it.

## Source evidence

`apps/web/src/features/home`, `apps/web/src/features/palette`, `apps/web/src/components/layout/AppLayout.tsx`, `apps/web/src/components/layout/CommandPalette.tsx`, `apps/web/src/components/layout/FindBar.tsx`, `apps/web/src/pages/ChatsListPage.tsx`, and `apps/web/src/components/layout/RightPane.tsx`.

## Configuration and worked examples

[Projects And Settings](../configuration/projects-and-settings.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
