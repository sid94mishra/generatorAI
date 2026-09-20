---
title: Modules and dependency boundaries
description: Every application and shared package, its responsibility, and the source entry points to inspect.
---

# Modules and dependency boundaries

The product is a pnpm workspace with **10 application packages and 20 shared packages** in the inspected source, excluding this documentation site and the separate `agent-tests` workspace. The root `pnpm-workspace.yaml` includes `apps/*`, `packages/*`, and `agent-tests`; Turbo orchestrates the repository's build, typecheck, lint, and test tasks.

## Application inventory

| Directory | Package | Responsibility | Entry points and important boundaries |
| --- | --- | --- | --- |
| `apps/server` | `@generatorai/server` | Express API, execution composition, streaming, auth, remote connectivity | `src/index.ts`, `src/composition-root.ts`, `src/routes/index.ts`; authoritative shared runtime |
| `apps/web` | `@generatorai/web` | React browser application and desktop renderer | `src/`; React Query for server state, Zustand for UI state, shared client logic |
| `apps/desktop` | `@generatorai/desktop` | Electron application, server lifecycle, native integration | `src/main/index.ts`, `src/main/window-manager.ts`, `src/main/ipc.ts`; the renderer is the web client |
| `apps/mobile` | `@generatorai/mobile` | React Native/Expo iOS and Android client | Expo Router screens and native adapters; connects to a server rather than embedding core/database |
| `apps/cli` | `@generatorai/cli` | Distributable command-line launcher | Thin entry point over `cli-core` and `tui-kit`; see [CLI client](../clients/overview.md) |
| `apps/relay` | `@generatorai/relay` | Optional relay director/cell application | `src/app.ts`, `src/cell.ts`, `src/index.ts`; outbound host attachment and HTTP/stream forwarding |
| `apps/agent-host` | `@generatorai/agent-host` | Optional provider process host | `AgentHostServer`, `RuntimeSupervisor`, `SessionQueue`, `SessionDemux`; explicitly opt-in |
| `apps/browser-host` | `@generatorai/browser-host` | Standalone Chromium host implementation | `BrowserHostServer`; not the current default server browser path |
| `apps/pty-host` | `@generatorai/pty-host` | Optional isolated PTY host | `PtyHostServer`, `PtySession`, `HeadlessTerminalModel`; `node-pty` ownership |
| `apps/cua-host` | `@generatorai/cua-host` | Standalone computer-use host implementation | `CuaHostServer`, `CuaDriverConnection`; distinct from the live server CUA bridge |

The local Expo module at `apps/mobile/modules/generatorai-device-key` belongs to the mobile application. It implements native device-key integration and is not a separate backend service.

## Shared package inventory

| Package directory | Responsibility | Dependency direction / important exported surface |
| --- | --- | --- |
| `shared` | Domain/wire types, Zod configuration schemas, event types, builders, logging, telemetry, IPC protocols | Common foundation; browser-safe and Node-oriented entry points are separated |
| `core` | Domain services, execution state machines, ports, scheduling, workspace lifecycle, capability services, infrastructure adapters | Uses shared types and focused git/change/checkpoint/review/source-control packages; accepts repository ports |
| `db` | SQLite/Drizzle schema, migrations, repository implementations, retention | Implements domain persistence ports; imports core/auth/shared types |
| `agent-harness-providers` | Copilot, Claude Agent SDK, Codex, OpenCode, ACP, deterministic Faux adapters; registry and supervision | Implements core's `IAgentHarness`; provider protocol/SDK details live here |
| `auth` | Device identities, DPoP, access tokens, scopes, route policies, pairing, audit | Uses `secrets` and `shared`; persistence injected through ports |
| `secrets` | Encrypted file vault, key-provider selection, credential redaction and migration | Uses shared helpers; chooses operator key, OS-protected key, or explicitly weaker local development key |
| `relay-protocol` | Pairing offers, relay routes/messages, host binding, encoding and encryption primitives | Isomorphic package; encryption primitives are not currently used by live transports |
| `client-transport` | Direct byte transport, endpoint selection, backoff, HTTP codec | Depends on relay protocol; transport does not own credentials |
| `client-runtime` | Pairing, device keys, stored sessions, DPoP, token refresh, stream tickets, platform stores | Framework-independent authenticated client layer |
| `client-core` | Typed API modules, stream connection/router/reducers, diff parsing, run titles | Framework-independent client behavior; no React/React Native/provider SDK dependency |
| `cli-core` | CLI command handling, connection management, structured output and client adapters | Builds on client-core/runtime/transport and secret storage |
| `tui-kit` | Ink/React terminal screens, rendering and interaction | UI layer over cli-core, shared types, and design tokens |
| `design-tokens` | Shared semantic visual tokens and generated platform outputs | No runtime dependency; web, mobile, and terminal clients consume it |
| `git` | Local git command port and process adapter | `GitClient`, `IGitClient`, `IGitProcessRunner`; reusable low-level operations |
| `changes` | Workspace/mount change sets, summaries, file versions/patches, tree discovery | Uses git; central diff/status model shared by server-facing features |
| `checkpoints` | Snapshot service and private shadow git refs | `CheckpointService`, `GitShadowRefStore`, snapshot/repository ports |
| `review` | Inline review threads, anchor mapping, comment serialization into agent prompts | `ReviewThreadService`, `AnchorResolver`; persistence injected through `IReviewRepository` |
| `source-control` | Remote VCS-host abstraction and GitHub integration | Provider registry, device flow, PR operations, CLI token fallback; currently GitHub is the implemented provider |
| `sdk` | Internal embedded-engine facade and builders | Composes core/db/harness in the calling process; private package, not an HTTP client or supported external distribution |
| `mcp-server` | MCP stdio server exposing selected GeneratorAI operations | `GeneratorAiMcpServer`, custom tool adapter, CLI that boots the internal SDK |

The table comes from each package's current `package.json` and `src/index.ts`, not solely from names or historical READMEs.

## Core module map

`packages/core/src` is larger than a single “business logic” folder. Its main areas are:

| Area | What belongs there |
| --- | --- |
| `domain/ports` | Harness, repositories, sandbox, browser, terminal, speech, extension and service contracts |
| `domain/dag` | Graph validation and edge/condition semantics |
| `services` | Chat/session/agent/project/workflow/automation/workspace lifecycle and coordination |
| `services/scm` | Repository readiness, source-control configuration/flows, generated commit/review text, editor launch |
| `services/orchestrator` | Agent task orchestration and delegation tools' backing service |
| `events` | EventBus ordering, persistence connection, event filtering |
| `permissions` | Tool permission policy, mode mapping, pre-tool hook bridge |
| `tools` | Built-in browser/computer/widget/plan/orchestrator tools and custom tool registry |
| `mcp` | Catalog merging, credential pointers/vault, MCP settings, hub interface |
| `infrastructure` | Script/git/HTTP/sandbox/process adapters and browser/computer/terminal/voice implementations |
| `bootstrap` | Shared service-graph construction |

Core is not a perfectly isolated pure-domain library: it contains Node infrastructure and some type-only references to database repository implementations. Changes should follow the existing ports where available rather than assuming a strict dependency rule that the source does not enforce.

## Configuration and built-in assets

`templates/` supplies built-in workflow/stage templates and system artifacts such as skills, prompts, MCP metadata, and extensions. These are runtime inputs, not another client. `ProjectConfigService`, `SystemArtifactService`, `TemplateRegistry`, and `ArtifactCatalog` resolve the user/project/system views used by clients.

`packages/shared/src/config/` supplies validation for chats, agents, workflows/stages, workflow scripts, automations, MCP servers, browser configuration, widgets, extensions, and top-level app settings. Forms and routes should agree on these schemas. See [Extensibility](./extensions.md) and [Configuration](../reference/configuration.md).

## Verification and tooling modules

`agent-tests/` contains end-to-end/agent/browser test harnesses. Tests beside source use the repository's test runner; scripts at the repository root cover security, durability, documentation, synchronous I/O, token generation, packaging, and release checks. Existing `docs/` and `.github/docs/` contain design proposals, historical audits, and operations notes. They are evidence to reconcile with source, not a substitute for checking which code path is actually wired.

## Change impact examples

- A new REST feature normally touches shared schemas, a service/port, a route and authorization policy, a client API module, and each intended client UI.
- A new provider belongs behind `IAgentHarness`, with explicit capability declarations and conformance tests. It should not add provider-specific code to every screen.
- A new workspace resource needs lifecycle cleanup before workspace deletion, not just a create endpoint.
- A new event needs deliberate durable classification, replay behavior, and client reduction; a component-local subscription alone does not cover reconnection.
- A new visual token belongs in `design-tokens` and its generated outputs, not a parallel client-specific palette.

See [Execution](./execution.md), [Data and storage](./data-and-storage.md), and [Process hosts](./processes.md) for the consequences of these boundaries.
