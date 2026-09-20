---
title: Client and server transports
description: REST, SSE, WebSocket, pairing, direct endpoint failover, relay, ACP, and MCP transport boundaries.
---

# Client and server transports

GeneratorAI separates **what a request means**, **who is allowed to make it**, and **how its bytes reach the host**. This separation lets the desktop, browser, phone, and CLI share API and event behavior without pretending they have identical UI capabilities.

## Client layers

```text
Client UI or CLI command
  → client-core: API modules, stream connection/router, reducers
  → client-runtime: device identity, pairing, token/proof/ticket handling
  → client-transport: endpoint, byte delivery, backoff and failover
  → server route and authorization policy
```

`client-core` intentionally avoids a UI framework. Platform components supply storage, rendering, networking, and native behavior. `client-runtime` supports injected fetch and storage implementations. `client-transport` is a separate package for direct transport, codec, endpoint supervision, and retry timing.

## Channels

| Channel | Purpose | Important behavior |
| --- | --- | --- |
| REST under `/api` | Resource queries and commands | Schemas, authentication, scopes, rate limits, structured errors |
| Unified SSE `/api/stream` | Chat/run/session/global events | Durable cursor replay, subscription scopes and filters, reconnect/reset semantics |
| Stream replay API | Historical event ranges | Reads committed history; retention can require a fresh snapshot |
| Browser WebSocket | High-frequency live browser frames/control channel | Workspace ownership and stream authentication |
| Terminal WebSocket | PTY input/output and resize | Terminal execution authority and workspace/session ownership |
| STT/TTS WebSockets | Audio input/output | Connection-scoped session lifecycle, capacity and cleanup |
| Internal loopback HTTP | Desktop native bridge registration and pairing bootstrap | Separate local-token trust boundary |
| Typed child IPC | Optional agent/PTY hosts and host implementations | Request IDs, protocol/build hello, lifecycle supervision |
| ACP stdio | Agent interoperability | JSON-RPC on stdin/stdout; diagnostics on stderr |
| MCP stdio | External tool access to GeneratorAI | MCP SDK server and selected tool dispatch |

The exact REST operations are enumerated by the server route modules and the [reference section](../reference/configuration.md). A UI tab is not necessarily a separate network stream: computer preview, for example, is a live-only subscription on the shared stream infrastructure.

## Direct connections and failover

`DirectTransport` carries ordinary fetch/stream URLs. `EndpointSupervisor` tries candidates in preference order, verifies the pinned server identity before credentials are sent, uses bounded jittered backoff, and fails over when a candidate is unreachable.

Connection state includes idle, connecting, connected, reconnecting, offline, and host mismatch. Host mismatch is deliberately terminal for automatic retry: the application should explain that the endpoint no longer presents the paired host identity.

The transport kind union includes `loopback`, `lan`, `ssh`, and `relay`, but a type declaration is not proof that each has a dedicated implemented adapter in every client. An SSH-forwarded endpoint may still be consumed as a direct HTTP origin. Client setup should reflect actual supported configuration, not the union alone.

## Authentication lifecycle

The shared runtime creates a proof per authenticated request and de-duplicates simultaneous refreshes. Server nonce challenges are retried appropriately. It distinguishes an unreachable host, a rejected resume credential, and an explicitly revoked device; these states require different user recovery actions.

Short-lived stream tickets let selected streaming APIs authenticate a connection without placing reusable account credentials into arbitrary URLs. A ticket's scope is not a blanket authorization for internal desktop routes or all application resources.

## Multiplexing and replay

The unified stream supports multiple logical subscriptions over one physical connection. Each scope keeps its own sequence and replay state. Slow consumers have bounded queues; ordered events can apply backpressure, while transient deltas can be coalesced or dropped from a congested live queue and recovered from durable state.

`StreamBroker` reports whether the requested cursor was fully honored. An expired cursor or truncated replay requires a resnapshot. The shared client reducer/router assembles server events into transcript and resource effects rather than asking each screen to reinterpret provider messages.

Cross-tab EventSource sharing is marked unsupported in the current capability ledger. It should not appear in a deployment/performance claim just because the stream itself supports multiplexing.

## Relay topology

```text
Paired remote client
       │ HTTP / streaming
       ▼
Relay director + cell
       │ host-attached forwarding channel
       ▼
RelayHostBroker / RelayStreamBridge on the execution server
       │ loopback forwarding
       ▼
The same authorized API and streaming routes
```

`RelayHostBroker` connects outward to the relay, so the execution host does not need an inbound public listener just to attach. Its connection is demand-driven by paired relay devices or pending invitations. Host proofs bind the relay origin, nonce, assignment epoch/generation and signing identity; revocations use a durable outbox until acknowledged.

**Current confidentiality limit:** `RelayStreamBridge`, clients, and relay do not call the `sealFrame`/`openFrame`/`deriveSessionKeys` E2EE primitives. The cell sees application plaintext. TLS protects the configured network hops; it does not make the relay blind to content. This is explicitly documented in current source and corrects older README language.

## ACP has two directions

- **Outbound provider:** `AcpProvider` spawns an external agent executable and adapts its sessions/events to `IAgentHarness`.
- **Inbound server:** `apps/server/src/acp-entry.ts` boots a GeneratorAI container without HTTP/Express/WebSocket listeners and exposes it through `AcpInboundAdapter` over stdio.

The inbound bridge calls `ChatManagementService`, preserving normal transcript and event behavior. Chat IDs and event-session IDs are separate identifiers. ACP does not define a universal model-discovery endpoint; avoid promising the full model picker through every ACP agent.

## MCP has two directions too

- **Consume MCP tools:** the artifact catalog, settings and credential vault resolve MCP server entries for supported providers.
- **Expose GeneratorAI tools:** `packages/mcp-server/src/cli.ts` starts an internal SDK instance and serves MCP stdio operations such as chat listing, sending a prompt, and starting a workflow.

The latter is an embedded engine, not a proxy to whichever desktop server is currently open. Its database/configuration need to be selected accordingly. See [Extensions and MCP](./extensions.md).

## Surface capabilities

`packages/shared/src/transport/TransportCapabilities.ts` distinguishes a declared capability from one validated by a registered runtime test for that surface. The `enforced` label identifies a test-backed runtime declaration; `aspirational` means an unverified claim, not necessarily missing implementation.

Use the [client guides](../clients/overview.md) for UI availability. Browser panels, computer previews, interactive widgets, terminal rendering, attachment controls, keyboard shortcuts, and high-latency delivery should be checked per client instead of inferred from one shared API.

## Source evidence

`packages/client-core/src/`; `packages/client-runtime/src/AuthenticatedClientRuntime.ts`; `packages/client-transport/src/`; `apps/server/src/routes/stream.ts`; `apps/server/src/streaming/`; `apps/server/src/relay/RelayHostBroker.ts` and `RelayStreamBridge.ts`; `apps/relay/src/`; `packages/shared/src/transport/TransportCapabilities.ts`; `apps/server/src/acp-entry.ts`; `packages/mcp-server/src/cli.ts`.
