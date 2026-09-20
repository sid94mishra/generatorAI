# HTTP API and integration

The server exposes HTTP routes under `/api`, one unified event stream, and WebSocket transports for live tools. The [route catalogue](./http-routes.md) lists every literal route registration found in current source, including internal desktop routes separately by source module.

## Pick the correct integration boundary

| Integration | Use |
| --- | --- |
| External client driving an existing host | Authenticated HTTP/SSE/WebSocket protocols |
| In-repository client | Shared client contracts, `client-core`, runtime, and transports |
| Internal in-process engine embedding | Private `@generatorai/sdk`; separate lifecycle and database ownership |
| Agent using exposed GeneratorAI MCP tools | `packages/mcp-server`; see [SDK and MCP](../clients/sdk-mcp.md) |
| Electron main-process handshake | `/internal/*` with its dedicated local trust model; not a public client API |

The SDK is not a published HTTP client. Do not substitute it for connecting to the running server.

## Authentication and scopes

Pair a device through an authorized host, or use a configured service-account credential. Paired-device requests use the shared runtime's credential and DPoP proof handling. A bearer string copied from a paired session without its proof is not a complete integration.

`packages/auth/src/routePolicy.ts` classifies route prefixes into scopes. Unknown API routes fail closed to administrator authority. Some routes also apply operation-specific checks. Public bootstrap and health routes are intentional exceptions; webhooks apply their own authentication rules.

Service-account verification exists in the auth layer, but this checkout does not implement a public service-account provisioning route or UI. The following example is only for an already provisioned integration whose token permits the operation; normal users should pair through a client.

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $GENERATORAI_SERVICE_TOKEN" \
  http://127.0.0.1:3100/api/chats
```

The variable above is an example caller-side variable, not a server configuration switch. Use an already provisioned token; do not expose it in scripts, logs, or documentation.

## API discovery

`GET /api/openapi.json` serves the hand-maintained OpenAPI document and `GET /api/docs` serves a Swagger UI. The spec is useful for request/response examples, but it is **not exhaustive or fully current**. In particular, its older description says there is no end-user authentication and the API is open on the LAN; the current middleware and route policy contradict that description.

Use these authorities in order when implementing a client:

1. The current route handler and its validation schema.
2. `packages/shared/src/types/IPlatformClient.ts` and the shared client implementation.
3. The route policy and service behavior for authorization and effects.
4. The hand-maintained OpenAPI document as a supplementary reference.

The generated catalogue discovers registrations, not full request/response schemas. It includes source paths and line numbers so a missing OpenAPI operation can still be located. It does not infer payloads or claim that all methods have been exercised.

## Common request families

| Family | Resource |
| --- | --- |
| Chats and sessions | Conversations, messages, prompt execution, approvals, history |
| Projects and workspaces | Codebases, configuration, file trees, worktrees, changes |
| Agents and system artifacts | Definitions, resolution, skills, prompts, MCP |
| Workflow definitions and runs | DAG authoring, validation, execution, stage control |
| Automations and webhooks | Triggers, datasets, executions, schedules, tokens |
| Source control and review | Provider accounts, branches, commits, pull requests, comments |
| Browser, computer, terminals | Workspace-bound interactive tool sessions |
| Extensions and widgets | Installed packages, tool/UI registrations, widget state |
| Auth and security | Pairing, scopes, device lifecycle, audit and posture |
| Health and harness | Runtime diagnostics, catalog and provider status |

## Streaming and reconnect

The SSE endpoint is `/api/stream?scope=chat|run|session|global&id=...`. Use the required ID for entity scopes. Clients retain event cursors and reconnect using the stream protocol; `/api/stream/replay` is the REST replay companion. Reading text deltas is not enough to model approvals, errors, completion, or background execution.

Use the existing stream reducer/runtime where practical. It handles event ordering, replay, cache invalidation, and durable history reconciliation. See [Execution](../architecture/execution.md) and [Transports](../architecture/transports.md).

## WebSocket and asset surfaces

Speech also uses `/api/stt/stream` and `/api/tts/stream`, owned by `apps/server/src/stt-ws.ts` and `apps/server/src/tts-ws.ts`. Relay director/cell HTTP and WebSocket channels are a separate service surface described in [Transports](../architecture/transports.md).

Integrated browser and terminal live I/O use upgrades managed by `apps/server/src/browser-ws.ts` and `apps/server/src/terminal-ws.ts`. Their authentication, ticketing, workspace checks, and control messages are separate from ordinary REST responses. Inspect those files and the client implementations rather than treating these endpoints as generic unauthenticated sockets.

Widget assets are served from a separate loopback origin, not from the authenticated API origin. Their capability/session checks and sandbox behavior matter for embedding; see [Security](../architecture/security.md).

## Errors and compatibility

Expect validation errors, denied scopes, unavailable providers, missing resources, conflicts, rate limits, and asynchronous execution failures. Many operations acknowledge work before it completes; observe the corresponding run or event stream. Preserve request IDs when reporting a failure.

The application is alpha. Keep a client and server from compatible source versions, and inspect the shared contract when upgrading. Do not use the existence of a route as evidence that it is available to a mobile-scoped device.

## Source evidence

`apps/server/src/app.ts`, `apps/server/src/routes/index.ts`, `apps/server/src/openapi/spec.ts`, `packages/auth/src/routePolicy.ts`, `packages/shared/src/types/IPlatformClient.ts`, `packages/client-core/src`, `packages/client-runtime/src`, `packages/client-transport/src`.
