---
description: Use every workspace dock surface, including files, browser, terminal, computer activity, plans, and background workers.
---
# Workspace panels

The chat workspace dock keeps inspection and interaction beside the conversation. Open it from the page controls, then use **Add tab** to select a surface. **Changes** is the required default tab. You can close additional tabs, resize the dock, or expand it to full screen. On a narrow content area it becomes an overlay.

## Panel inventory

| Surface | Purpose and availability |
| --- | --- |
| Changes | Workspace diffs, comparison bases, review comments, Keep/Undo, checkpoints, and source-control actions |
| Files | Browse the workspace tree and preview supported files; up to four browser instances |
| Individual file | Dedicated read-only viewer for a selected file |
| Browser | Integrated browser session associated with the workspace; up to five tab instances in chat |
| Terminal | Interactive shell on the server host in the workspace; up to four tab instances in chat |
| Computer | Observe the desktop applications the agent reads or controls; requires host support and grants |
| Widget | Interact with agent-rendered components; up to six widget tab instances in chat |
| Background Tasks | Monitor and cancel workers from an orchestrator chat, and open worker chats |
| Plan | Review, edit, comment on, save, and decide on a plan document |
| Inspector | Workflow-run surface for the selected stage's Files, Output, Hooks, and Tools |

Tabs and preferred widths are remembered locally and scoped appropriately to the chat or run. An overflow menu exposes tabs that do not fit. Closing a visual tab and stopping an underlying agent task are different operations.

## Files and changes

Use **Files** for the current workspace tree and **Changes** for differences against a selected base. Open a file in its own tab when comparing it with the conversation. The dock's code surface is a read-only viewer, not a general embedded editor; use the agent, terminal, or supported **Open in editor** action to make changes. Viewing or keeping a diff does not create a Git commit. See [Changes and source control](./source-control.md).

## Browser

Navigate to the application under test, observe agent activity, inspect elements, and capture supported screenshots for the chat. Desktop uses native browser integration when available; the web client can display a streamed remote browser.

In the web client, **Settings → Browser & Terminal → Allow full browser interaction** controls whether the user drives the shared browser. When off, the user can still watch agent activity and use inspection. Desktop browser interaction is always enabled by this preference. Host/device permission checks still apply.

Browser tabs are workspace-scoped. A persisted URL is not a guarantee that a previous browser process or login session still exists. Live frame processing is gated by the active tab so hidden panels do not all decode streams at once.

## Terminal

The terminal spawns a PTY on the server host, not inside the web browser or on the phone. Use it to start a development server, run tests, or inspect command output. Terminal preferences apply to newly opened tabs: shell path, Windows PowerShell profile loading, and optional inheritance of sensitive environment variables.

Agent shell activity can be displayed in the terminal area through an agent console. A capture can be added to the next chat message. Shell commands have their ordinary effects on the workspace; stopping generation does not necessarily stop an independently running server you launched manually.

## Computer and background tasks

The Computer panel displays available desktop sessions, action markers, approvals, and recording playback. Screen video depends on host support such as `ffmpeg`; the UI explains capture scope. Computer-use settings and per-application grants govern which actions can occur.

Background Tasks shows worker status, output/progress context, a route to the worker's chat, and cancellation for eligible work. Enable orchestration through the chat/agent configuration; this panel is disabled for ordinary chats.

## Widgets and plans

Widgets can appear inline or open in a dedicated dock tab. Each widget instance has its own identity so several widgets do not overwrite one another's surface. The Plan tab is a document-and-review surface rather than an arbitrary file editor. Read [Extensions and widgets](./extensions.md) and [Plans, questions, and permissions](./interactions.md) for their distinct lifecycles.

## Source evidence

`apps/web/src/components/layout/RightPane.tsx`, `apps/web/src/pages/ChatPage.tsx`, `apps/web/src/pages/WorkflowRunPageV2.tsx`, `apps/web/src/components/diff/useFileTabs.tsx`, `apps/web/src/components/chat/BrowserPanel.tsx`, `apps/web/src/components/terminal/TerminalPanel.tsx`, `apps/web/src/components/chat/ComputerPanel.tsx`, and `apps/web/src/components/chat/BackgroundTasksPanel.tsx`.

## Configuration and worked examples

[Browser](../configuration/browser.md), [Widgets](../configuration/widgets.md), [Projects And Settings](../configuration/projects-and-settings.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
