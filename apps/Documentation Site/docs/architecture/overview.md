---
title: Architecture overview
description: The clients, shared engine, persistence, providers, and trust boundaries of GeneratorAI.
---

# Architecture overview

GeneratorAI is a developer workspace with several clients attached to a shared execution server. The server owns projects, chats, workflow runs, automations, execution workspaces, provider conversations, and durable event history. The clients render these resources and send commands; a phone or browser does not become the machine executing an agent simply by connecting to it.

This section describes the implementation inspected in September 2026. Source files are cited as repository-relative paths so they remain useful in a checkout and in an independently hosted documentation site. A design document or a declared interface is not evidence that a feature is enabled in the default runtime.

## System map

```text
Human
  ├─ Desktop: Electron main + shared React web renderer
  ├─ Web: React/Vite browser client
  ├─ Mobile: React Native/Expo client
  └─ CLI: commands + Ink terminal UI
                │
                │ authenticated REST + SSE + selected WebSocket channels
                ▼
Server: Express application + composition root
  ├─ Auth, device scopes, secret vault, host identity
  ├─ Core services: chats, agents, workflows, automations, workspaces
  ├─ StreamBroker/EventBus: durable ordered events + replay
  ├─ Provider registry → Copilot / Claude / Codex / OpenCode / ACP
  ├─ Browser, terminal, computer-use, voice, extensions
  └─ SQLite repositories + files + private checkpoint stores
                │
                └─ Optional process hosts / relay / external provider runtimes
```

The detailed inventories are in [Modules and dependency boundaries](./modules.md), [Clients](../clients/overview.md), and [Features](../features/index.md).

## Deployment shapes

| Shape | Where execution lives | What the client adds |
| --- | --- | --- |
| Standalone desktop | Embedded server managed by Electron | Native windows, filesystem dialogs, browser views, desktop integration |
| Browser connected to a server | Server host | Web interface using the same API and stream model |
| Remote desktop | Selected remote server | Desktop shell around the remote workspace |
| Mobile companion or standalone grant | Paired server host | Native navigation, secure device key, camera/file/audio capabilities; granted scopes determine authority |
| CLI | Selected server endpoint | Scriptable commands and terminal interaction |
| Internal SDK | Calling Node process | An independently composed embedded engine; not an HTTP client |
| MCP stdio entry point | Its SDK instance in the spawned process | A small tool surface for an external MCP client |

“Standalone” mobile describes a broader client permission preset, not an embedded Node server on the phone. The CLI launcher is a packaged client; historical comments about a direct CLI composition root should not be taken as proof of a current CLI execution mode.

## Composition and dependency injection

`apps/server/src/index.ts` loads configuration, creates the container and HTTP app, attaches streaming channels, starts listeners, and coordinates shutdown. `apps/server/src/composition-root.ts` constructs infrastructure and services explicitly:

1. Open the database and apply migrations.
2. Bootstrap the encrypted secret store, device/auth services, and host identity before accepting requests.
3. Configure provider adapters, readiness discovery, provider instances, and durable conversation ownership.
4. Construct repositories and the common service graph through `packages/core/src/bootstrap/createCoreServices.ts`.
5. Wire the durable stream store, project/workspace services, source control, checkpoints/reviews, and agents.
6. Attach browser, terminal, computer-use, voice, workflow scripts, and extension services.
7. Run recovery and start background workers. Recovery precedes automation scheduling.

The HTTP layer mounts route factories from `apps/server/src/routes/index.ts`. Routes translate requests and authorization into service calls; they should not duplicate scheduler or provider behavior.

`createCoreServices` is a shared factory, not the complete production composition root. It accepts repositories, the `IAgentHarness` port, script/HTTP/git infrastructure, concurrency settings, and optional durability/agent/plan services. The server adds platform-specific policy and resource management around it. The internal SDK composes a second graph and does not automatically have every server integration.

## Domain relationships

| Entity | Meaning | Relationship |
| --- | --- | --- |
| Project | Persistent organization and configuration | Owns codebases and reusable project configuration |
| Chat | User-facing conversation | References sessions, an optional project, and execution sources/workspace |
| Session | Provider execution and message/event context | Can belong to a chat or workflow stage/run |
| Agent | Reusable configuration and tool/skill policy | Resolved into a concrete configuration for a chat or stage |
| Workflow definition | Editable stage graph and defaults | Snapshotted for a workflow run |
| Workflow run | One execution of a definition | Owns stage runs and run-scoped events |
| Stage run | One node execution | Has status, output, session assignment, and possibly human input |
| Automation | Trigger and iteration policy | Starts executions that reference workflow runs |
| Execution workspace | Managed execution metadata and lifecycle | Contains one or more source mounts plus derived assets |
| Mount | One source directory exposed to execution | Generated, in-place, or worktree-backed |
| Checkpoint/review | File state and user feedback | Anchored to a workspace/mount/revision |

The distinction between a project and an execution workspace is essential: the project describes reusable source/configuration; the workspace describes an execution's actual files and native resources. See [Workspaces and source control](./workspaces.md).

## Boundaries that matter

- **Client/server:** clients may render the same data differently, but authentication, scope checks, and execution authority stay on the server.
- **Domain/provider:** services consume `IAgentHarness`; provider SDK-specific types stay in adapters. Capability differences remain observable.
- **Durability/live delivery:** an event is committed before it is broadcast. Reconnecting clients either replay or explicitly resnapshot.
- **Metadata/files:** SQLite does not contain the complete workspace or provider credential state. A database-only backup is not a full installation backup.
- **Process separation/security:** a child process isolates failure and resource ownership; it is not automatically an OS permission sandbox.
- **Transport/authorization:** loopback, LAN, SSH, and relay labels never grant permission by themselves.

## Implemented limits

The application is an evolving alpha. Several architecture seams intentionally remain partial:

- SQLite is the only operational database driver. PostgreSQL/libSQL identifiers are recognized but rejected as not wired.
- Agent-host and PTY-host modes are opt-in. The default agent path remains the in-process `MultiHarness` registry.
- The standalone browser-host and cua-host packages should not be confused with the live desktop browser manager or live CUA bridge.
- Relay traffic is **not currently end-to-end encrypted**; the encryption primitives have no live transport callers. TLS and relay operator trust remain relevant.
- The SDK is private and internal. Its old README's “zero importers” claim is stale: the MCP CLI now imports it.

These distinctions are expanded in [Process hosts](./processes.md), [Providers](./providers.md), [Transport](./transports.md), and [Security](./security.md).

## Source evidence

Start with `apps/server/src/composition-root.ts`, `apps/server/src/index.ts`, `apps/server/src/app.ts`, `packages/core/src/bootstrap/createCoreServices.ts`, `packages/core/src/domain/ports/IAgentHarness.ts`, and `packages/db/src/schema.ts`. For startup knobs, use the [configuration reference](../reference/configuration.md).
