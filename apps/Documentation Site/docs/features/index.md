---
description: Find every major GeneratorAI feature, its configuration surface, and the guide that explains it.
---
# Feature guide

GeneratorAI combines conversational development, reusable agents, directed workflows, and scheduled or event-driven automation. Projects organize source code and reusable configuration; workspaces hold the files and processes used during execution. The same server powers several clients, whose native controls and available capabilities differ.

This guide describes the current implementation in this repository. It is a source-based product reference, not a claim that every provider, operating system, or deployment has been tested. Start with the [client overview](../clients/overview.md) for client-specific availability and the [architecture overview](../architecture/overview.md) for the underlying services.

## Choose a starting point

| Goal | Guide |
| --- | --- |
| Understand the home screen, navigation, and search | [Dashboard and navigation](./navigation.md) |
| Connect repositories and organize a project | [Projects and codebases](./projects.md) |
| Ask an agent to investigate, generate, or update code | [Chats and the composer](./chats.md) |
| Review a proposed plan or answer a blocked interaction | [Plans, questions, and permissions](./interactions.md) |
| Inspect files, browser activity, terminals, and workers | [Workspace panels](./workspace-panels.md) |
| Create a reusable specialist or a delegating team | [Agents and teams](./agents.md) |
| Design a repeatable multi-stage process | [Workflow builder](./workflows.md) |
| Follow execution and recover a failed stage | [Workflow runs](./workflow-runs.md) |
| Keep workflow definitions in source files | [Workflow scripts](./workflow-scripts.md) |
| Run workflows on schedules, webhooks, or datasets | [Automations](./automations.md) |
| Reuse skills, prompts, MCP servers, and templates | [Skills and integrations](./integrations.md) |
| Install an extension or show an interactive widget | [Extensions and widgets](./extensions.md) |
| Review edits, restore a checkpoint, or open a pull request | [Changes and source control](./source-control.md) |
| Configure the application and host capabilities | [Settings](./settings.md) |

## Feature inventory

| Module | Included surfaces and controls |
| --- | --- |
| Home | Mission Control, live activity, running chat/workflow/automation summaries, system health, quick creation |
| Projects | Creation, linked remote Git/local Git/local directories, aliases, branch selection, clone/fetch status, worktrees, file preview, project customization, pull requests, retention |
| Chats | Create, name/tag search, active/archived filters, bulk deletion, source selection, model and reasoning choice, Auto/Plan modes, attachments, slash commands, mentions, dictation, streaming, stop/reset, message actions, fork and rewind |
| Human interaction | Durable permission requests, structured questions, plan revisions/editing/comments/approval, stage approval and changes requested |
| Workspace dock | Changes, Files, individual file tabs, Browser, Terminal, Computer, Widget, Background Tasks, Plan; workflow runs additionally expose Inspector |
| Agents | System/global/project scopes, identity and instructions, tool policy, selected skills/MCP servers, runtime defaults, effective capabilities, orchestrator teams, import/export |
| Workflow definitions | DAG stages/edges, prompts and file prompts, variables, session modes, agents, skills, MCP servers, conditions, retries, timeouts, validation, hooks, source/worktree settings |
| Workflow execution | Live pipeline and graph, stage timeline, stage inspector, artifacts/output, pause/resume/cancel, run/stage retry, review gates, workspace inspection |
| Scripts | Discovery, script metadata, run profiles, materialization, execution; source authoring and API administration are distinct from the catalog UI |
| Automations | Manual/schedule/webhook triggers; single/loop/batch/script input; typed datasets, grouping and previews; concurrency/error policy, execution history and cancellation |
| Catalogs | System/project skills, agents, prompts, MCP servers, workflow templates; project enablement and selected execution context |
| Extensions | Install by local path, enable/disable, reload, uninstall, interactive widgets/custom tools; workspace scope and other contribution kinds have documented limits |
| Source control | Diff comparison, file/range review comments, Keep/Unkeep, Undo, checkpoints/rewind, commit/push/PR flows, accounts, conflicts, PR review in chat |
| Settings | General, Appearance, Model Providers, Agents, Skills, MCP Servers, Templates, Source Control, Browser & Terminal, Computer Use, Audio, Extensions, Security & Devices, Storage, Diagnostics |

## Understand availability

An implemented feature can still be unavailable in a particular session: the host may lack a required executable, a device may lack a scope, a model may omit a capability, or a workspace may still be preparing. Disabled controls and provider-resolution warnings carry this information. Server/API-only configuration is identified in the relevant guide instead of being presented as a button that every client contains.

The application has three related layers of configuration: server-wide defaults, reusable project/agent/workflow definitions, and per-chat or per-run choices. See [configuration reference](../reference/configuration.md) when deciding where a setting belongs.

## Source evidence

The feature inventory was checked against `apps/web/src/pages`, `apps/web/src/components/settings/sectionRegistry.tsx`, `apps/web/src/pages/ChatPage.tsx`, `apps/web/src/pages/WorkflowRunPage.tsx`, and the contracts in `packages/shared/src/types` and `packages/shared/src/config`.
