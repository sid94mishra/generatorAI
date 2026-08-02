# GeneratorAI Security, Authentication, Remote Access, Relay, and Mobile Architecture Plan

**Status:** Proposed architecture and phased implementation plan  
**Date:** 2026-07-31  
**Scope:** GeneratorAI monorepo, informed by the local Orca and T3Code reference projects and established security/networking patterns  
**Implementation status:** Analysis only; no implementation is included in this document

---

## 1. Executive Summary

GeneratorAI already has a strong foundation for a multi-harness agentic development platform:

- A pnpm/Turborepo monorepo.
- Separate server, web, desktop, and CLI applications.
- A provider-neutral `IAgentHarness` abstraction.
- `HarnessFactory`, `HarnessRegistry`, `HarnessProxy`, and `MultiHarness` components.
- Express REST APIs, Server-Sent Events, and WebSocket terminal/browser streams.
- A shared platform-client abstraction used by web and CLI clients.
- Drizzle/SQLite persistence with workflow, chat, project, stream, automation, checkpoint, and review domains.
- An Electron desktop shell with context isolation and a restricted preload bridge.
- Existing CORS, payload-limit, webhook-signature, request-ID, rate-limit, stream-flow-control, and scoped-CDP protections.

The current architecture is suitable for local development, but it is not yet safe enough for broad LAN exposure, internet deployment, remote clients, or mobile access. The principal limitations are:

1. Authentication is based on one shared bearer API key.
2. Authentication can be disabled when the API key is absent.
3. SSE supports a long-lived API key in a query parameter.
4. There is no per-user or per-device identity, scope model, or revocation.
5. Provider and source-control credentials rely on environment variables, CLI-owned files, or plaintext configuration.
6. There is no unified secure-secret storage abstraction.
7. There is no SSH transport, tunnel manager, secure LAN pairing, or outbound relay.
8. There is no mobile application or reusable client connection runtime.
9. Harnesses are extensible by provider type, but the model should be expanded to multiple isolated instances of the same provider.
10. Dangerous provider permissions can be configured too broadly and should be secure by default.

The recommended end state separates five concerns:

1. **Human identity** — local OS identity or OAuth/OIDC identity.
2. **Device identity** — a distinct keypair and revocable, scoped credential for every client.
3. **Harness credentials** — provider secrets isolated by harness instance.
4. **Integration credentials** — GitHub, GitLab, Linear, Jira, and similar secrets in separate namespaces.
5. **Transport** — loopback, LAN, SSH, relay, and signed-link transports that do not redefine authorization.

The recommended delivery order is:

1. Fail closed and remove query-string API keys.
2. Introduce a cross-platform secret store.
3. Add per-device authentication, scopes, proof-of-possession, revocation, and audit events.
4. Isolate harness credentials and support multiple instances per provider.
5. Add secure LAN pairing and SSH tunnels.
6. Add an outbound-only, end-to-end encrypted relay.
7. Build the mobile client on the common client and transport contracts.
8. Add signed links, stronger database protection, enterprise RBAC, and formal security testing.

---

## 2. Analysis Scope and Reference Systems

This plan is based on analysis of:

- GeneratorAI at `C:\Users\sidmishra\Desktop\New folder (2)\GeneratorAI`.
- Orca at `referenceProjects/orca`.
- T3Code at `referenceProjects/t3code`.
- OAuth 2.0 Demonstrating Proof of Possession, RFC 9449.
- Tailscale's separation of control plane, direct encrypted data plane, and blind relay fallback.
- Cloudflare Tunnel's outbound-only connector model.
- Electron `safeStorage` platform behavior.
- Common agent-runtime patterns: provider adapters, isolated workspaces, guardrails, approval gates, resumable sessions, MCP, and tracing.

The recommendations intentionally combine:

- GeneratorAI's existing harness and platform-client abstractions.
- T3Code's provider-instance lifecycle, scoped authorization, proof-of-possession, pairing, and event-driven patterns.
- Orca's transport resilience, device registry, encrypted pairing, relay host proof, credential rotation, and durable revocation behavior.

The goal is not to copy either reference project literally. The goal is to preserve GeneratorAI's architecture while introducing the smallest stable set of new boundaries needed for secure multi-client and remote operation.

---

## 3. Current GeneratorAI Architecture

## 3.1 Monorepo and Application Boundaries

GeneratorAI is a Node.js 20+ TypeScript pnpm/Turborepo monorepo.

```text
GeneratorAI/
├── apps/
│   ├── server/       Express backend and composition root
│   ├── web/          React/Vite browser client
│   ├── desktop/      Electron shell and embedded-server manager
│   └── cli/          Commander/Ink command-line client
├── packages/
│   ├── agent-harness-providers/
│   ├── core/
│   ├── db/
│   ├── shared/
│   ├── sdk/
│   ├── mcp-server/
│   ├── git/
│   ├── source-control/
│   ├── changes/
│   ├── checkpoints/
│   └── review/
├── docker/
├── templates/
└── docs/
```

The root build uses:

- pnpm workspaces for package ownership.
- Turborepo task dependency and caching.
- Strict TypeScript configuration.
- Vitest and Playwright for tests.
- ESLint and a custom security check that prevents application-wide Chrome DevTools Protocol exposure.

## 3.2 Server

The server is an Express 5 application, normally using port 3100. Its composition root wires:

- Database and repository implementations.
- Harness registry and providers.
- Workflow orchestration.
- Chats and conversations.
- Projects, codebases, worktrees, and execution workspaces.
- Automations and webhook processing.
- Source-control services.
- Terminal and browser services.
- MCP and custom tools.
- Stream/event infrastructure.
- OpenTelemetry and logging.

The middleware pipeline includes:

1. Request IDs.
2. Request metrics.
3. CORS enforcement.
4. JSON and URL-encoded body limits.
5. API-key authentication.
6. Rate limiting.
7. Routes.
8. Static assets in production.
9. Error handling.

The server exposes:

- REST APIs for chats, workflows, projects, workspaces, automations, source control, sessions, templates, extensions, widgets, hooks, and health.
- SSE for event streaming and replay.
- WebSocket terminal streaming.
- WebSocket browser screencast/input streaming.
- Speech-to-text streaming support.

Existing terminal streaming already has valuable transport controls:

- Backpressure high and low watermarks.
- An output-buffer circuit breaker.
- Input message rate limits.
- Resize, signal, input, acknowledgement, ready, exit, and error messages.

These controls should be preserved and moved behind the future authenticated connection/session layer rather than rewritten.

## 3.3 Web Client

The web application uses React 19, Vite, React Router, TanStack Query, Radix UI, xterm, diff/tree components, and the shared GeneratorAI types.

Its most important architectural feature is `IPlatformClient`, with `HttpPlatformClient` as the remote implementation. This is the correct place to introduce transport-neutral authentication and connection behavior.

The target should be:

```text
React features
    ↓
IPlatformClient
    ↓
AuthenticatedClientRuntime
    ↓
TransportAdapter
    ├── LoopbackHttpTransport
    ├── LanWebSocketTransport
    ├── SshTunnelTransport
    └── RelayTransport
```

Feature code should not know whether it is connected through loopback, LAN, SSH, or relay.

## 3.4 Desktop Application

The desktop app is an Electron shell that starts or connects to the GeneratorAI server and loads the web client. It includes:

- Server process management and readiness checks.
- BrowserWindow management.
- Explicit IPC handlers.
- A restricted context-bridge preload API.
- Settings stored in an application data directory.
- Browser integration.
- Menus, tray, updates, deep links, and logging.
- A per-tab scoped CDP proxy instead of one application-wide debugging port.

The existing `check-no-app-wide-cdp.mjs` guard is an excellent pattern. Similar source-boundary checks should be added for secrets and dangerous process execution.

The desktop app should become the owner of the OS-backed secret provider when running in Electron. The server should consume a `SecretStore` interface, not import Electron APIs directly.

## 3.5 CLI

The CLI supports remote HTTP mode and local embedded mode. Configuration currently resolves from defaults, user and project config, environment variables, and flags.

The CLI should evolve into a fully supported client rather than a special case:

- It should own a device keypair.
- It should pair with a server or import a scoped service credential.
- It should use the same proof-of-possession protocol as desktop, web, and mobile.
- Its local secret storage should use the cross-platform secret-store backend.
- SSH tunnels should be exposed through the common transport package.

## 3.6 Harness Layer

GeneratorAI's most important extension architecture is in `packages/agent-harness-providers`.

Current components:

- `IAgentHarness`: common lifecycle and conversation contract.
- `HarnessFactory`: lazy provider loading.
- `HarnessRegistry`: provider status and initialization.
- `HarnessProxy`: runtime provider switching.
- `MultiHarness`: provider fan-out and conversation ownership routing.
- Copilot and Claude Agent provider implementations.

The status model distinguishes:

- Installed.
- Connected.
- Authenticated.
- Ready.
- Supported model catalog.
- Failure reason and check time.

This should remain the central provider contract. The key change is to address harnesses by **instance ID**, not only by provider type.

Example:

```text
claude-personal  → driver claude-agent → credential harness/claude-personal
claude-work      → driver claude-agent → credential harness/claude-work
copilot-company  → driver copilot      → credential harness/copilot-company
```

A conversation should be owned by a harness instance, not only by a harness type.

## 3.7 Core, Database, and Supporting Packages

`packages/core` owns domain and application services, tools, permissions, MCP integration, events, and repository interfaces.

`packages/db` uses Drizzle and SQLite and contains tables for:

- Sessions, chats, and messages.
- Artifacts.
- Workflow definitions, runs, stages, and edges.
- Streams and sequence allocation.
- Automations, webhooks, and idempotency.
- Projects, codebases, worktrees, and execution workspaces.
- Checkpoints and reviews.
- Plans and human interactions.
- Extensions, widgets, and system configuration.

`packages/sdk` exposes facades for embedded use. The transport and authentication redesign must not make embedded mode depend on a network server. Embedded mode should use an in-process trusted principal with explicitly granted capabilities.

`packages/source-control` currently provides a source-control abstraction, with GitHub as the primary implementation. Tokens may come from environment variables or persisted configuration and need migration to the secret store.

`packages/checkpoints`, `packages/changes`, and `packages/review` already provide useful safety and human-review primitives. They should be integrated into authorization and audit policy rather than reimplemented.

---

## 4. Current Security Posture

## 4.1 Existing Strengths

GeneratorAI already includes several good controls:

1. Constant-time API-key comparison.
2. Production CORS allowlist enforcement.
3. Rejection of wildcard CORS with credentials.
4. JSON, URL-encoded, query-count, and upload limits.
5. Raw-body webhook HMAC verification.
6. Request IDs and structured logging.
7. Rate-limit middleware.
8. WebSocket flow control and message-rate controls.
9. Electron context isolation and explicit preload methods.
10. A settings whitelist.
11. A CI guard against application-wide CDP exposure.
12. Docker sandbox support and explicit opt-in for host fallback.
13. Permission and tool abstractions in the core package.
14. Git checkpoints and review infrastructure.

These should be retained as defense-in-depth layers.

## 4.2 Security Gaps

| ID | Gap | Severity | Why it matters |
|---|---|---:|---|
| G1 | No unified encrypted secret store | Critical | Tokens can be persisted in plaintext config or vendor files |
| G2 | One global API key | Critical | No device isolation, scopes, or individual revocation |
| G3 | Bearer-only authentication | Critical | A stolen token can be replayed by any holder |
| G4 | API key accepted in query strings | Critical | URLs leak through logs, history, analytics, and referrers |
| G5 | Authentication may be disabled when the key is unset | Critical | A deployment mistake can expose the entire API |
| G6 | No secure remote-access architecture | High | LAN or internet exposure would rely on the weak global key |
| G7 | No mobile client foundation | High | Pairing, secure storage, and reconnection are undefined |
| G8 | Provider secrets rely on ambient environment variables | High | Child processes can inherit credentials they do not need |
| G9 | CLI, source-control, and desktop settings can be plaintext | High | Other local processes can read long-lived tokens |
| G10 | SQLite is not encrypted | Medium | Chats, prompts, outputs, and metadata are readable at rest |
| G11 | No formal scopes/RBAC | High | Every authenticated caller has broad authority |
| G12 | No security audit event model | Medium | Incident investigation and compliance are difficult |
| G13 | Database URLs and other credentials may live in environment variables | Medium | Secrets may appear in process inspection and diagnostics |
| G14 | Broad agent permission modes are too easy to select | High | Agent compromise can become host compromise |
| G15 | No cryptographic pairing or host identity pinning | High | LAN clients cannot reliably know which server they reached |
| G16 | No durable revocation propagation | High | An offline relay/device can retain access after local removal |

## 4.3 Highest-Priority Immediate Risks

The most urgent issue is fail-open authentication. A non-loopback listener must never start without authentication.

The second is query-string API keys. Browser `EventSource` limitations do not justify putting a reusable credential in a URL.

The third is credential persistence. Remote transport work should not begin until the application has a secure place to store host keys, device keys, refresh tokens, provider credentials, and relay secrets.

---

## 5. Lessons from Orca

Orca uses the term "relay" for two different systems, and GeneratorAI should avoid that naming ambiguity:

1. A remote-execution relay deployed over SSH.
2. A cloud rendezvous relay used by mobile clients.

GeneratorAI should use distinct names such as:

- `remote-runtime-agent` for software deployed to SSH hosts.
- `cloud-rendezvous` or `blind-relay` for mobile/internet connectivity.

Orca patterns worth adopting:

1. **Per-device credentials:** each paired client gets an independent revocable identity.
2. **Pending-device coalescing:** reopening a QR dialog does not mint unlimited credentials.
3. **Explicit pairing rotation:** regenerate invalidates leaked unconsumed pairing material.
4. **Write-before-valid:** pairing credentials are valid only after durable persistence succeeds.
5. **Strict schema validation:** unknown fields are rejected.
6. **Canonical key encoding:** decode, verify length, re-encode, and compare.
7. **E2EE transcript binding:** transport kind and host identity are included in the handshake transcript.
8. **Invite-to-resume credential transition:** short-lived pairing material becomes a renewable device credential.
9. **Current and grace credential versions:** interrupted rotation does not lock out legitimate clients.
10. **Durable revocation outbox:** revocations are eventually delivered after reconnection.
11. **Outbound relay connection:** the host does not need an inbound firewall opening.
12. **Backpressure and bounded buffers:** large filesystem/git/terminal streams cannot starve interactive traffic.
13. **Graceful reconnection:** remote processes survive temporary transport loss.
14. **Provider credential isolation:** selected accounts use isolated configuration directories and inherited auth variables are stripped.
15. **Test-enforced secret redaction:** logs are tested for absence of known token values.

The Orca `ai-vault` name should not be copied. In Orca it is a transcript/session indexer rather than a credential vault, and the name creates unnecessary security confusion.

---

## 6. Lessons from T3Code

T3Code patterns worth adopting:

1. **Provider drivers as plain values:** driver definitions are schema-driven and create isolated instances.
2. **Multiple instances of one provider:** work and personal accounts can coexist.
3. **Lifecycle scopes:** each provider instance owns its resources and cleanup.
4. **Unknown-driver degradation:** unsupported drivers become unavailable snapshots rather than crashing startup.
5. **Proof-of-possession authentication:** bearer tokens are bound to a client key.
6. **Pairing grants:** bootstrap credentials are short-lived and exchanged for sessions.
7. **Authorization scopes:** read, write, stream, terminal, administrative, and relay operations are separate.
8. **Event sourcing:** commands are validated by a decider and persisted as immutable events before projection.
9. **Approval policy and sandbox mode are independent dimensions.**
10. **SSH and Tailscale are transport options rather than authorization systems.**
11. **Client runtime abstraction:** local, bearer, relay, and SSH targets share a client interface.
12. **Checkpointing and event replay:** state can be recovered and audited.

GeneratorAI already has equivalents for several of these ideas. The plan should extend current abstractions rather than introduce a second orchestration system.

---

## 7. Industry Security and Connectivity Principles

## 7.1 DPoP

RFC 9449 sender-constrains OAuth access and refresh tokens by binding them to a client public key. A request carries:

- The access token.
- A signed DPoP proof.
- The HTTP method and target URI.
- A unique proof ID (`jti`).
- An issue time.
- A hash of the access token (`ath`) for protected-resource requests.
- Optionally a server-provided nonce.

This prevents a stolen token from being used without the client private key.

DPoP does not replace TLS, authentication, authorization, or XSS prevention. It is a replay-resistance and sender-binding layer.

## 7.2 Tailscale

Tailscale separates:

- A control plane for identity, public-key distribution, and policy.
- A direct encrypted data plane where possible.
- A blind encrypted relay fallback where direct connectivity fails.

Private keys never leave the nodes. The relay can observe metadata but cannot decrypt payloads.

GeneratorAI should follow the same separation even if it does not implement full STUN/ICE initially.

## 7.3 Cloudflare Tunnel

Cloudflare Tunnel uses outbound-only connectors. This is operationally attractive because:

- The server does not need a public inbound port.
- Firewalls can block all inbound traffic.
- Multiple connectors can be associated with one logical tunnel.
- The provider terminates or forwards traffic after the connector has authenticated outward.

GeneratorAI's relay host should make an outbound WSS connection to a rendezvous service and attach client connections over it.

## 7.4 Electron Safe Storage

Electron `safeStorage` uses:

- macOS Keychain.
- Windows DPAPI.
- Linux Secret Service/KWallet when available.

Important caveats:

- Windows DPAPI protects against other users but not all applications running as the same user.
- Linux may fall back to `basic_text`, which is not acceptable for GeneratorAI secrets.
- Async APIs are preferred because they support non-blocking access, rotation signals, and temporary unavailability.

GeneratorAI must inspect the selected backend and refuse insecure silent fallback.

---

## 8. Target Security Model

## 8.1 Five Independent Planes

```text
Human identity
    │
    ├── owns devices and service accounts
    │
Device identity ── authorizes API operations with scopes
    │
    ├── does not reveal provider credentials
    │
Harness credentials ── available only to one harness instance
    │
Integration credentials ── separate source-control/project-service namespace
    │
Transport ── loopback, LAN, SSH, relay, or signed-link delivery
```

Rules:

1. Transport never implies authorization.
2. A device credential never grants direct access to stored provider secrets.
3. A harness credential never authenticates a user to GeneratorAI.
4. Integration credentials are not automatically inherited by harness processes.
5. Human identity determines which devices and resources a principal may manage.
6. Every destructive or execution operation requires an explicit scope.
7. Every remote client is independently revocable.

## 8.2 Principals

Recommended principal types:

- `local-desktop`: trusted desktop process on loopback.
- `paired-device`: browser, mobile, or CLI with a device keypair.
- `user-session`: OAuth/OIDC-authenticated human session.
- `service-account`: CI, automation, or webhook client.
- `signed-link`: highly constrained, short-lived access to one resource.
- `internal-service`: relay connector or internal runtime component.

## 8.3 Scope Model

Suggested initial scopes:

```text
read:status
read:projects
read:workspaces
read:chats
read:workflows
read:files
read:reviews
write:projects
write:workspaces
write:chats
write:workflows
write:files
write:reviews
stream:events
exec:agent
exec:terminal
exec:browser
admin:harnesses
admin:credentials
admin:devices
admin:settings
admin:relay
```

The server should map every REST route, SSE subscription, WebSocket upgrade, and RPC method to one or more required scopes.

Mobile should not receive `exec:terminal`, `exec:browser`, or any administrative scope by default.

---

## 9. Proposed Package and Application Boundaries

```text
packages/
├── secrets/
│   ├── SecretStore SPI
│   ├── Electron safeStorage adapter
│   ├── native/headless adapter
│   ├── encrypted-file adapter
│   ├── environment adapter
│   └── migration and rotation services
├── auth/
│   ├── principal and scope contracts
│   ├── token mint/verify
│   ├── DPoP verify/proof contracts
│   ├── nonce and replay stores
│   ├── pairing grants
│   └── authorization policy
├── device-registry/
│   ├── devices
│   ├── pending pairing records
│   ├── credential rotation
│   ├── revocation
│   └── audit events
├── transport/
│   ├── TransportAdapter SPI
│   ├── loopback
│   ├── LAN
│   ├── SSH tunnel
│   └── relay
├── relay-protocol/
│   ├── strict shared schemas
│   ├── E2EE handshake/framing
│   ├── control-channel messages
│   └── pairing offers
└── harness-contracts/
    ├── instance schemas
    ├── credential specifications
    └── capability/status metadata

apps/
├── relay/
│   ├── director
│   └── cell/forwarder
└── mobile/
    └── Expo client
```

The package names are conceptual. They may be consolidated to control package count, but the boundaries should remain explicit.

---

## 10. Secret Management Architecture

## 10.1 SecretStore Contract

The core server should depend on a provider-neutral interface:

```ts
interface SecretStore {
  get(namespace: string, name: string): Promise<Uint8Array | null>;
  set(namespace: string, name: string, value: Uint8Array): Promise<void>;
  create(namespace: string, name: string, value: Uint8Array): Promise<void>;
  remove(namespace: string, name: string): Promise<void>;
  list(namespace: string): Promise<string[]>;
  getOrCreateRandom(namespace: string, name: string, bytes: number): Promise<Uint8Array>;
  backendInfo(): Promise<{
    kind: string;
    secure: boolean;
    reason?: string;
    supportsRotation: boolean;
  }>;
}
```

Secrets should be addressed by references such as:

```text
harness/claude-personal/oauth
harness/copilot-work/github-token
integration/github/default/token
integration/linear/company/api-key
device/<device-id>/resume-secret
relay/host-keypair
system/url-signing-key
ssh/<target-id>/private-key
```

Application records store only secret references, never secret values.

## 10.2 Platform Backends

| Runtime | Recommended backend | Mandatory behavior |
|---|---|---|
| Electron/macOS | async `safeStorage` / Keychain | Support re-encryption when key rotation is reported |
| Electron/Windows | async `safeStorage` / DPAPI | Document same-user-process limitation |
| Electron/Linux | portal secret, libsecret, or KWallet | Refuse `basic_text` for persistent secrets |
| Headless macOS | Keychain integration or encrypted file | No desktop dependency |
| Headless Windows | DPAPI/CNG or encrypted file | Protect to current user by default |
| Headless Linux | Secret Service or encrypted file | Require passphrase/master key if no secret service |
| Container/server | Vault/KMS or encrypted file with injected KEK | Never bake master key into image |

## 10.3 Encrypted File Fallback

Requirements:

- Random data-encryption key per secret or per file generation.
- AEAD encryption using XChaCha20-Poly1305 or AES-256-GCM.
- Additional authenticated data containing namespace, name, format version, and key version.
- Key-encryption key from OS storage, Argon2id-derived passphrase, or deployment secret manager.
- Atomic write using temporary file, flush, rename, and directory synchronization where supported.
- POSIX mode `0600`.
- Windows ACL restricted to the owning SID.
- Versioned envelope for rotation.
- No secret values in filenames.
- Integrity failure must fail closed and produce a redacted diagnostic.

## 10.4 Plaintext Migration

Potential legacy sources include:

- User CLI config.
- Project config.
- Source-control configuration.
- Desktop settings.
- Environment variables.
- Provider-owned auth/config files.

Migration process:

1. Detect known legacy fields.
2. Validate the secure backend before reading legacy secrets.
3. Import each secret into a namespaced vault record.
4. Verify a read-after-write round trip.
5. Replace the legacy value with a secret reference or remove it.
6. Atomically rewrite the source file.
7. Record a redacted migration event.
8. Never log the old value.
9. Retain environment-variable compatibility temporarily as an explicit fallback.
10. Later require `GENERATORAI_ALLOW_ENV_CREDENTIALS=1` for ambient credentials.

Secure deletion cannot be guaranteed on journaled or copy-on-write filesystems. The migration documentation should state this honestly and recommend token rotation after migration for high-value credentials.

## 10.5 Secret Logging Rules

- Central redaction utility for known header names, environment names, URL parameters, and token-like values.
- Never serialize complete configuration objects to logs.
- Never log authorization headers, cookies, DPoP proofs, pairing codes, refresh tokens, relay tickets, or signed URLs.
- Register secret fingerprints for test-time leak detection without retaining values.
- Add tests that inject known sentinel secrets and assert they never appear in logs, errors, telemetry, events, or serialized snapshots.

---

## 11. Authentication Architecture

## 11.1 Immediate Fail-Closed Policy

Recommended startup behavior:

```text
Loopback + development + explicit local unauthenticated mode
    → allowed with prominent warning and response marker

Non-loopback listener without auth
    → startup error; server does not listen

Production without auth
    → startup error regardless of bind address
```

An explicit option such as `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1` is preferable to implicit behavior.

## 11.2 Pairing Grants

A pairing grant should be:

- Random and unguessable.
- Single-use.
- Valid for no more than 10 minutes.
- Bound to requested scopes and server identity.
- Stored as a hash, not plaintext.
- Consumed atomically.
- Independently revocable before use.
- Rate-limited by IP, device fingerprint, and server-wide budget.

Suggested pairing record:

```text
PairingGrant {
  grantId
  tokenHash
  deviceNameHint
  requestedScopes
  createdAt
  expiresAt
  consumedAt?
  revokedAt?
  attempts
  maximumAttempts
}
```

## 11.3 Device Registry

Suggested device entry:

```text
DeviceEntry {
  deviceId
  ownerId
  name
  platform
  publicKeyJwk
  jwkThumbprint
  scopes
  createdAt
  lastSeenAt
  revokedAt?
  credentialVersion
  previousCredentialGraceUntil?
  connectionMode
  relayBinding?
}
```

Required operations:

- Create or reuse one pending pairing entry.
- Rotate pending pairing material.
- Complete pairing.
- List devices without secret material.
- Rename device.
- Update scopes.
- Rotate credentials.
- Revoke device.
- Record last-seen metadata.
- Enqueue remote relay revocation.

## 11.4 Proof-of-Possession

DPoP should protect HTTP, stream-ticket issuance, WebSocket upgrades, and token refresh.

For each proof, validate:

1. Exactly one DPoP header.
2. JWT syntax and `typ = dpop+jwt`.
3. An asymmetric allowed algorithm; reject `none` and symmetric algorithms.
4. Signature against the embedded public JWK.
5. No private JWK parameters.
6. `htm` matches the HTTP method.
7. `htu` matches the canonical target URI without query/fragment.
8. `iat` is inside a small acceptance window.
9. `jti` has not been seen.
10. Server nonce, if required, matches an active nonce.
11. `ath` matches the access-token hash for protected-resource requests.
12. The proof key thumbprint matches the token's confirmation claim.
13. Requested scopes are present.
14. The device is not revoked.

Use a maintained JOSE implementation rather than implementing JWT primitives manually.

## 11.5 Token Design

Recommended token classes:

- Access token: 5–15 minute lifetime.
- Refresh/resume credential: longer lived, key-bound, rotatable, revocable.
- Stream ticket: 30-second lifetime, single-use.
- Pairing grant: at most 10 minutes, single-use.
- Relay invite: at most 10 minutes, attempt-limited.
- Signed link: short-lived, resource-scoped, usually single-use.

Access token claims should include:

```text
iss, aud, sub, exp, iat, nbf, jti
principal_type
device_id or service_account_id
scopes
cnf.jkt
session_version
```

The server should reject a DPoP-bound token presented as a bearer token.

## 11.6 Replay and Nonce Stores

A replay store needs:

- Hash of `jti`, not unbounded raw values.
- Expiration based on proof acceptance window.
- Bounded memory.
- Shared persistence or coordination for horizontally scaled deployments.
- Server-provided nonce support for clients with unreliable clocks.

Initial single-server implementation:

- In-memory LRU for fast checks.
- SQLite unique index as the authoritative duplicate barrier.
- Periodic expiration cleanup.

Scaled implementation:

- Redis or another strongly consistent low-latency store.

## 11.7 SSE Authentication

Long-lived API keys must not be placed in URLs.

Recommended transition:

1. Authenticated client calls `POST /api/stream/tickets` using DPoP.
2. Server returns a random, scope-bound, single-use ticket valid for about 30 seconds.
3. Browser opens `EventSource` with the ticket.
4. Server atomically consumes the ticket during stream setup.
5. Logs redact the ticket parameter.

Longer term, unified WebSocket or fetch-streaming can replace SSE, but the ticket exchange is the smallest safe migration.

---

## 12. Authorization and Policy

## 12.1 Route and Method Policy Table

Every exposed operation should have metadata:

```text
operationId
requiredScopes
resourceResolver
riskLevel
requiresRecentAuthentication
requiresUserPresence
allowedPrincipalTypes
rateLimitClass
auditClass
```

Examples:

| Operation | Scope | Extra rule |
|---|---|---|
| List projects | `read:projects` | — |
| Send chat prompt | `write:chats`, `exec:agent` | project access |
| Terminal input | `exec:terminal` | explicit device grant |
| Browser click/input | `exec:browser` | explicit device grant |
| Save provider credential | `admin:credentials` | recent authentication |
| Change device scopes | `admin:devices` | cannot grant beyond caller authority |
| Revoke device | `admin:devices` | audit-critical |
| Create signed link | resource write scope | link scopes must be a subset |

## 12.2 Resource Authorization

Scopes alone are insufficient for multi-user deployment. Add resource checks:

- User owns or belongs to project.
- Device belongs to user or organization.
- Service account is explicitly assigned to project/workflow.
- Signed link is bound to one resource.
- Harness instance is allowed for the project.
- Workspace path belongs to the authorized workspace root.

## 12.3 Permission and Sandbox Matrix

Separate filesystem/process isolation from approval UX:

```text
sandboxMode:
  read-only
  workspace-write
  full-access

approvalPolicy:
  untrusted
  on-failure
  on-request
  never
```

Recommended default:

- `workspace-write`.
- `on-request` for dangerous shell/network/system operations.
- No default `bypassPermissions`.

`full-access + never` must require explicit project-level confirmation and should create a high-severity audit event.

---

## 13. Harness Security and Extensibility

## 13.1 Harness Instance Model

Suggested persisted model:

```text
HarnessInstance {
  instanceId
  driverType
  displayName
  config
  credentialRefs
  homeDirectory
  allowedProjectIds
  defaultModel
  permissionProfile
  enabled
  createdAt
  updatedAt
}
```

`config` must be validated by a driver-owned Zod schema. Secrets must not be embedded in `config`.

## 13.2 Driver Contract Additions

Each driver should declare:

- Driver type and version.
- Configuration schema.
- Credential specification.
- Environment variables it consumes.
- Vendor config-directory variable.
- Supported platforms.
- Required binaries/SDK packages.
- Account probe.
- Capability list.
- Event mapping.
- Permission mapping.
- Safe shutdown behavior.
- Redaction patterns.

Example conceptual credential specification:

```text
CredentialSpec {
  fields: [
    { name: 'apiKey', secret: true, optional: true },
    { name: 'oauth', secret: true, optional: true }
  ]
  environmentMapping
  configFileMapping
  supportsCliDelegation
  supportsManagedHome
}
```

## 13.3 Process Environment Isolation

Never clone the complete parent environment for harness processes.

Build child environments from:

1. A minimal platform allowlist.
2. Explicit application variables needed by that process.
3. Driver-owned credential injection.
4. Driver-owned managed-home/config-dir variables.

Explicitly remove unrelated:

- Anthropic/OpenAI/GitHub/GitLab tokens.
- GeneratorAI authentication secrets.
- Relay and device secrets.
- Database credentials.
- Cloud/KMS credentials unless the exact process requires them.
- Electron-specific process flags.

## 13.4 Managed Provider Homes

Use a cross-platform data-root resolver:

```text
<GeneratorAI data>/harnesses/<instanceId>/home
```

Inject vendor-specific locations such as `CLAUDE_CONFIG_DIR` or `CODEX_HOME` only into that instance's process.

Benefits:

- Multiple accounts of the same provider.
- No credential races.
- Easier backup and revocation.
- Clear ownership boundaries.
- Reduced ambient credential inheritance.

## 13.5 New Harness Checklist

A new harness should require only:

1. Driver package/folder.
2. `IAgentHarness` implementation.
3. Configuration schema.
4. Credential specification.
5. Account and readiness probe.
6. Model catalog.
7. Event mapper.
8. Permission mapper.
9. Tool mapper.
10. Lifecycle tests.
11. Credential-redaction tests.
12. Windows, macOS, and Linux capability declaration.
13. Registration metadata for lazy discovery.

Unknown or unavailable drivers should produce stable unavailable status records rather than fail application startup.

---

## 14. Transport Architecture

## 14.1 Common Transport Contract

```text
TransportAdapter {
  connect(target, authContext)
  close()
  request(request)
  openEventStream(subscription)
  openBinaryStream(kind, metadata)
  connectionState()
  capabilities()
  diagnostics()
}
```

Transport adapters should carry encrypted/authenticated messages but must not decide application authorization.

Connection modes:

1. Loopback.
2. LAN.
3. SSH tunnel.
4. Outbound relay.
5. Signed URL for narrowly scoped sharing.

## 14.2 Connection Selection

Recommended automatic strategy:

```text
If embedded/local desktop:
  use in-process or loopback
Else if pinned LAN endpoint reachable:
  use LAN
Else if configured SSH target reachable:
  open SSH tunnel
Else if relay permitted:
  use relay
Else:
  offline with actionable diagnostics
```

Allow users to select:

- Automatic.
- Local only.
- SSH only.
- Relay allowed.

A privacy-sensitive user should be able to disable all cloud relay behavior.

---

## 15. Secure LAN Connectivity

## 15.1 Binding Rules

- Default server bind is `127.0.0.1` / `::1`.
- LAN binding requires explicit configuration.
- LAN binding requires configured authentication.
- Production LAN mode requires TLS or message-level E2EE with pinned host identity; preferably both.
- Display a firewall warning on Windows and macOS.

## 15.2 Server Identity

Generate a long-term server identity keypair and store the private key in `SecretStore`.

Use the public-key fingerprint as the stable host ID. A pairing QR pins:

- Server public key.
- TLS certificate fingerprint if using self-signed TLS.
- Endpoint and protocol version.

Do not trust a self-signed certificate merely because the user bypassed a warning. Trust must come from out-of-band pairing and fingerprint pinning.

## 15.3 Pairing Offer

Suggested strict schema:

```text
PairingOffer {
  version
  endpoint
  serverId
  serverPublicKey
  certificateFingerprint?
  pairingGrant
  pairingExpiresAt
  requestedScopes
  transportCapabilities
  relayOffer?
}
```

Requirements:

- Base64url encoding.
- Custom URL such as `generatorai://pair?code=...`.
- QR representation.
- Strict maximum length.
- Strict schema with no extra fields.
- Canonical key encoding.
- Pairing code removed from browser address history after import.
- Explicit regeneration and invalidation.

## 15.4 Message-Level E2EE

Use a reviewed protocol/library. At minimum:

- X25519 key agreement.
- HKDF-SHA-256 key schedule.
- XChaCha20-Poly1305 or AES-GCM framing.
- Independent send/receive keys.
- Monotonic sequence numbers.
- Replay rejection.
- Bounded frame sizes.
- Key confirmation.
- Transcript binding.

The transcript should include:

- Protocol and version.
- Client and server public keys.
- Client and server nonces.
- Selected cipher/framing version.
- Transport kind (`lan`, `ssh`, or `relay`).
- Server/relay host ID.
- Endpoint/audience.
- Requested and accepted capabilities.

This prevents a middleman from changing the negotiated transport or host identity.

---

## 16. SSH and Remote Server Support

## 16.1 First Delivery: User-Managed SSH Tunnel

Initial supported flow:

```text
GeneratorAI server on remote machine binds 127.0.0.1:3100
User opens local forwarding to remote loopback
Local GeneratorAI client connects to local forwarded port
Application authentication still uses DPoP/device credentials
```

SSH provides transport encryption and server access, but GeneratorAI authorization must remain enabled. This protects against shared-account and port-forward misuse.

Benefits:

- Minimal implementation.
- No public application port.
- Works on Windows, macOS, and Linux.
- Compatible with bastion hosts, ProxyJump, agent forwarding, and corporate SSH controls.

## 16.2 Managed SSH Transport

Later, add a managed SSH adapter using a mature SSH library.

Features:

- Public-key and agent authentication.
- Optional keyboard-interactive/password flow without persistent password storage by default.
- Host-key verification.
- Known-hosts import and storage.
- TOFU only with explicit confirmation.
- Host-key change blocks by default.
- ProxyJump/bastion support.
- Local forwarding to remote GeneratorAI loopback.
- Keepalive, reconnect, and clear diagnostics.
- Per-target scope and project restrictions.

## 16.3 Cross-Platform SSH Details

Windows:

- Support built-in OpenSSH.
- Detect the Windows OpenSSH agent named pipe.
- Handle paths and quoting without POSIX assumptions.
- Avoid writing private keys into temporary files.

macOS/Linux:

- Respect `SSH_AUTH_SOCK`.
- Support standard OpenSSH config and known-hosts where practical.
- Use runtime path utilities rather than hard-coded separators.

All platforms:

- Never disable host-key verification globally.
- Never log SSH commands containing secrets.
- Keep passwords in memory only and clear references after use.
- Store private keys only in the secret store when user explicitly requests persistence.

## 16.4 Optional Remote Runtime Agent

Do not require a remote agent for initial SSH support. Port forwarding is enough for a deployed GeneratorAI server.

A remote runtime agent is only necessary if the local server must operate directly on remote files, PTYs, and git without deploying the full GeneratorAI server. If later added, it should:

- Be versioned and fingerprinted.
- Run as the SSH user.
- Use a framed protocol with keepalives.
- Preserve PTYs through reconnect grace periods.
- Enforce bounded streams and command validation.
- Use per-user socket permissions.
- Be named distinctly from the cloud relay.

---

## 17. Cloud Relay Architecture

## 17.1 Purpose

The relay exists for a client, especially mobile, to reach a GeneratorAI server behind NAT or a firewall when direct LAN, VPN, or SSH paths are unavailable.

It is not:

- A credential vault.
- A provider proxy.
- An authorization substitute.
- A plaintext application gateway.

## 17.2 Components

```text
Director
  - authenticates host control-plane requests
  - maps a host ID to an assigned cell
  - issues short-lived assignment metadata

Cell
  - accepts outbound host control channels
  - accepts client invite/resume connections
  - attaches matching client and host byte streams
  - enforces connection limits and leases
  - cannot decrypt E2EE application frames

Host broker
  - runs inside GeneratorAI server
  - connects outbound to director/cell
  - proves possession of host private key
  - creates invites
  - accepts pending connections
  - forwards encrypted frames to runtime RPC

Client relay adapter
  - resolves director/cell
  - connects using invite or resume credential
  - completes E2EE handshake with the host
```

The relay should be self-hostable and opt-in.

## 17.3 Outbound-Only Host Connection

The GeneratorAI server initiates WSS connections outward. Operators can block inbound traffic entirely.

The host broker should be demand-driven:

- No active paired relay devices and no pairing request: broker is closed.
- Pairing requested: temporary demand opens broker.
- Active relay-enabled device: durable demand keeps broker available.
- All demand removed: broker drains and closes.

## 17.4 Host Proof

The relay must verify that the connecting host owns the private key associated with its relay host ID.

Challenge transcript should bind:

- Protocol/version.
- Relay origin.
- Relay ephemeral public key.
- Challenge ID and nonce.
- User/profile/organization identity, if applicable.
- Relay host ID.
- Host public key.
- Assignment epoch.
- Previous generation.
- Resume intent.
- Issue and expiry times.

Use a short challenge window and timing-safe comparisons. The challenge must not expose the host private key.

## 17.5 Relay Pairing Credential Lifecycle

1. Host authenticates to relay control plane.
2. Host requests invite for a specific pending local device.
3. Relay returns a one-time invite with maximum attempts and expiration.
4. Pairing offer includes relay origin, assigned cell, host ID, invite, and E2EE version.
5. Client uses invite to establish a basis connection.
6. Client and host complete E2EE and local device authentication.
7. Host authorizes installing a versioned resume credential.
8. Client confirms the resume credential.
9. Invite is invalidated.
10. Future connections use resume credentials.

Credential rotation should support current and grace generations to survive interrupted updates.

## 17.6 Durable Revocation

When a user revokes a device:

1. Local device registry marks it revoked immediately.
2. Local auth rejects it immediately.
3. Relay binding is added to a durable revoke outbox.
4. If relay is online, revoke now.
5. If offline, retry after reconnect with backoff.
6. Remove outbox item only after acknowledged revocation.

This is required for reliable lost-device handling.

## 17.7 Relay Privacy and Threat Model

E2EE hides application content from the relay, but the relay can observe:

- Host and client connection times.
- Approximate traffic volume.
- Cell assignment.
- Host/device opaque IDs.
- Connection success/failure.

The relay can deny service and delay traffic. It should not be trusted for payload confidentiality, integrity, or application authorization.

---

## 18. Signed URL Architecture

Signed URLs should be used only for narrowly scoped, short-lived sharing or automation bootstrap.

Suggested claims:

```text
version
issuer
audience
subject/principal type
resource type and ID
scopes
issuedAt
notBefore
expiresAt
jti
maximumUses
```

Sign with Ed25519 using a key stored in `SecretStore`.

Rules:

- Never grant `exec:terminal`, `exec:browser`, `admin:*`, or unrestricted filesystem access.
- Bind to one server audience.
- Bind to one resource where possible.
- Short TTL.
- Single-use by default.
- Maintain revocation/consumption state.
- Redact URLs from logs and telemetry.
- Clear imported URLs from browser history.
- Display the exact granted capability before opening.

Signed URLs are not a replacement for user or device sessions.

---

## 19. Client Runtime and New Client Applications

## 19.1 Authenticated Client Runtime

A shared client runtime should own:

- Device-key generation and storage.
- Pairing-code import.
- DPoP proof generation.
- Access-token refresh.
- Server nonce handling.
- Transport selection and reconnect.
- E2EE session establishment.
- Stream replay/cursor tracking.
- Capability negotiation.
- Connection diagnostics.

The web, CLI, desktop renderer, and mobile app should consume this package.

## 19.2 New Client Checklist

A new client should only need to:

1. Implement platform secure storage.
2. Provide or generate a non-extractable device key where possible.
3. Render pairing and consent UI.
4. Supply one or more transport adapters.
5. Use the shared platform API contracts.
6. Request a minimum scope set.
7. Implement secure logout and local credential deletion.
8. Handle token expiry and device revocation.
9. Implement stream replay after reconnect.
10. Pass conformance tests against the server protocol.

---

## 20. Mobile Application Plan

## 20.1 Stack

Recommended stack:

- Expo/React Native.
- Expo Router.
- `expo-secure-store` for tokens and sensitive metadata.
- Native platform keystore APIs for non-extractable signing keys where needed.
- Camera/QR support.
- WebSocket and fetch transport.
- xterm-compatible terminal rendering, or a mobile-optimized terminal component.
- Push notifications in a later phase.
- Keep-awake only during active long-running interactions.

## 20.2 Mobile Source Layout

```text
apps/mobile/src/
├── auth/
│   ├── device-key.ts
│   ├── dpop.ts
│   ├── token-session.ts
│   └── secure-storage.ts
├── transport/
│   ├── endpoint-supervisor.ts
│   ├── lan-transport.ts
│   ├── relay-transport.ts
│   ├── e2ee-session.ts
│   └── host-store.ts
├── pairing/
├── projects/
├── chats/
├── workflows/
├── terminal/
├── notifications/
└── diagnostics/
```

## 20.3 Secure Storage

- iOS token storage: Keychain with device-only accessibility such as when-unlocked-this-device-only.
- Android token storage: Android Keystore-backed encrypted storage.
- Device signing key: non-extractable Secure Enclave/Keystore key when algorithm support allows.
- Web build: non-extractable WebCrypto key, IndexedDB metadata, and careful XSS controls.

Do not rely on AsyncStorage for tokens or private keys.

## 20.4 Pairing Flow

1. User opens pairing UI on server/desktop.
2. Server generates or rotates pending device and pairing grant.
3. Server optionally requests relay invite.
4. Server displays QR.
5. Mobile scans and validates strict offer.
6. Mobile shows host name, endpoint, identity fingerprint, transport options, and requested scopes.
7. Mobile generates device keypair.
8. Mobile exchanges pairing grant with DPoP proof.
9. Server stores device public key and scopes.
10. Mobile stores refresh/resume credential securely.
11. Mobile verifies connection and receives server capabilities.
12. Pairing grant is consumed.

## 20.5 Connection Strategy

Automatic mode:

1. Attempt pinned LAN endpoint.
2. Optionally attempt Tailscale/private-network endpoint.
3. Attempt relay if enabled.
4. Reconnect with bounded exponential backoff.
5. On app resume, validate token and replay stream cursors.

Local-only mode never contacts the relay.

## 20.6 Initial Mobile Feature Scope

Phase 1 mobile features:

- Pair/unpair server.
- List projects/workspaces.
- View chats and workflow state.
- Send prompts.
- Approve/reject agent interactions.
- Receive event streams.
- View diffs and reviews.

Phase 2:

- Terminal view and input after explicit `exec:terminal` grant.
- File browser/editor.
- Browser preview.
- Attachments and voice input.
- Push notifications.

Starting with chat, approvals, status, and diffs minimizes the initial mobile attack surface.

---

## 21. Terminal and Binary Stream Security

Retain the existing backpressure model and add:

- Authentication before WebSocket upgrade completion.
- Scope validation for every stream open.
- Per-device concurrent terminal limits.
- Per-device input rate limits.
- Per-stream sequence numbers and acknowledgements.
- Snapshot/replay limits.
- Maximum binary frame size.
- Total connection memory budget.
- Fair scheduling across streams.
- Disconnect after repeated malformed/decrypt-failed frames.
- Audit events for terminal open, close, signal, and privileged actions.

Do not log terminal content by default. Terminal transcripts can contain API keys and passwords.

---

## 22. Data Protection and Database Strategy

## 22.1 Data Classification

Classify persisted data:

- **Secrets:** tokens, private keys, passwords, resume credentials.
- **Sensitive content:** prompts, source code, terminal output, diffs, artifacts.
- **Identity metadata:** users, devices, organization membership.
- **Operational metadata:** timestamps, statuses, usage metrics.
- **Public configuration:** provider catalogs and non-secret UI settings.

Secrets should never be stored directly in ordinary database columns.

## 22.2 Database Encryption Options

Short term:

- File permissions and user-specific data directories.
- Field-level encryption for the most sensitive content.
- Keep secret values entirely in `SecretStore`.
- Redacted backups.

Long term:

- SQLCipher for SQLite deployments, or encrypted storage volumes.
- Managed database TLS and at-rest encryption for PostgreSQL.
- Per-tenant content encryption if enterprise isolation requires it.

Database encryption does not replace access control or secret separation.

## 22.3 Backups

- Backup process must exclude ephemeral pairing grants and replay records.
- Secret-store backup should be explicit and encrypted.
- Restored device credentials should trigger a security warning or forced rotation.
- Backups must never include plaintext environment dumps.

---

## 23. Audit and Observability

## 23.1 Security Audit Events

Record immutable events for:

- Login and logout.
- Pairing grant creation, rotation, consumption, and expiry.
- Device creation, scope change, credential rotation, and revocation.
- Secret creation, update, access class, and deletion without values.
- Harness instance creation, configuration change, and account switch.
- Permission-mode change.
- Terminal/browser execution session open and close.
- SSH host-key trust and change detection.
- Relay host connect, invite, device credential install, and revoke.
- Signed-link creation and consumption.
- Authentication failure classes and throttling.

## 23.2 Audit Event Structure

```text
AuditEvent {
  eventId
  timestamp
  actorPrincipal
  actorDeviceId?
  action
  resourceType
  resourceId?
  result
  reasonCode?
  requestId
  connectionId?
  transport
  sourceAddressHash?
  metadata
  previousEventHash?
}
```

No secret or user-content payloads should appear in audit metadata.

## 23.3 Event-Sourcing Alignment

GeneratorAI already has stream sequences and event persistence. Security events can use the same sequencing infrastructure while remaining a separate append-only category with stricter retention and redaction rules.

A decider/projector model is recommended for device and credential state transitions to avoid invalid states such as:

- Consuming an expired grant.
- Rotating a revoked device.
- Reusing an old credential version outside grace.
- Granting scopes beyond the actor's authority.

---

## 24. Cross-Platform Requirements

| Concern | Windows | macOS | Linux |
|---|---|---|---|
| Secret storage | DPAPI/safeStorage | Keychain/safeStorage | Secret Service/KWallet/portal |
| Insecure fallback | Refuse plaintext | Refuse plaintext | Refuse `basic_text` |
| File protection | Owner SID ACL | `0600` | `0600` |
| Local IPC | Named pipe | Unix socket | Unix socket |
| SSH agent | OpenSSH named pipe | `SSH_AUTH_SOCK` | `SSH_AUTH_SOCK` |
| PTY | ConPTY | forkpty | forkpty |
| LAN firewall | Windows firewall consent/rule | macOS prompt | Distribution-specific |
| Data directory | `%APPDATA%`/Electron userData | Application Support | XDG directories |
| Service mode | Windows service/task | LaunchAgent/daemon | systemd user/system service |

Cross-platform rules:

- Always use path utilities.
- Never assume a shell or quoting syntax.
- Never hardcode `/tmp`; use platform runtime directories.
- Support IPv4 and IPv6 endpoints.
- Normalize URL host syntax for IPv6.
- Use explicit runtime platform checks.
- Rebuild native dependencies for Node and Electron ABIs.
- Test both interactive desktop and headless server modes.

---

## 25. Threat Model

## 25.1 Assets

- Provider API/OAuth credentials.
- Source-control and project-management tokens.
- Device and relay credentials.
- Server and device private keys.
- Source code and artifacts.
- Terminal and browser control.
- Agent execution capability.
- Chats, workflow state, and audit records.

## 25.2 Adversaries

- Remote unauthenticated attacker.
- Attacker with a leaked bearer token.
- Malicious or compromised relay operator.
- LAN man-in-the-middle.
- Compromised mobile/browser client.
- Malicious extension or harness.
- Another local process running as the same OS user.
- Compromised SSH host.
- Malicious workflow input or prompt injection.

## 25.3 Main Mitigations

| Threat | Mitigation |
|---|---|
| Missing auth config | Fail-closed startup |
| Token theft | DPoP-bound tokens, short access lifetime, rotation |
| Replay | `jti` store, nonce, `ath`, expiry |
| LAN MITM | Pinned host key/certificate plus transcript-bound E2EE |
| Relay inspection | End-to-end encryption; relay is a blind forwarder |
| Relay host impersonation | Host proof and host-ID binding |
| Lost device | Per-device revocation and durable relay revoke outbox |
| Cross-harness credential leak | Managed homes and explicit child env allowlists |
| Malicious harness | Capability declaration, sandbox, approval gates, process limits |
| URL leakage | Stream tickets, no long-lived secrets in URLs, log redaction |
| Local config theft | OS secret store and hardened files |
| SSH MITM | Host-key verification and change blocking |
| Extension abuse | Signed manifests, permission declarations, process isolation |
| Prompt injection | Tool scopes, approvals, path restrictions, network policy |

## 25.4 Residual Risks

- A process running as the same OS user may access data or use DPAPI-protected material on Windows.
- XSS can use non-extractable keys while the compromised app remains active.
- A relay can observe metadata and deny service.
- Full-access agents can intentionally or accidentally damage user data.
- SSH-host compromise exposes work performed on that host.
- Encryption cannot protect data while the application legitimately decrypts and uses it.

These limitations should be documented rather than hidden.

---

## 26. Security Tests and CI Gates

Add CI checks modeled after the existing scoped-CDP check:

1. No long-lived secret query parameters.
2. No direct credential environment reads outside approved secret/config packages.
3. No logging of authorization headers or known secret fields.
4. No use of insecure Electron storage backend without explicit test-only override.
5. No production non-loopback bind without authentication.
6. No default dangerous permission mode.
7. No application-wide CDP exposure.
8. No WebSocket endpoint without auth and scope metadata.
9. No new privileged RPC operation without audit classification.
10. No secret fields in ordinary persisted configuration schemas.

Protocol tests:

- Pairing expiry, rotation, and maximum attempts.
- Pairing atomic consumption under concurrency.
- DPoP invalid signature, algorithm, method, URI, audience, `ath`, `jti`, nonce, and clock skew.
- Device revocation during an active connection.
- Current/grace credential rotation.
- Relay invite replay and host-ID mismatch.
- E2EE transcript downgrade attempts.
- Sequence replay and out-of-order frames.
- Buffer exhaustion and slow consumer behavior.
- SSH host-key change.
- Windows/macOS/Linux secret backend behavior.

End-to-end tests:

- Desktop local connection.
- Web LAN pairing.
- CLI SSH tunnel.
- Two clients with independent scopes.
- Relay fallback when LAN is unavailable.
- Device revoke while relay is offline, then reconnect.
- Mobile resume after background suspension.
- Harness account isolation between two instances of one provider.

---

## 27. Phased Implementation Roadmap

## Phase 0 — Immediate Exposure Reduction

**Objective:** Make the existing server safe enough for controlled local and tunneled use.

Tasks:

1. Default bind to loopback.
2. Fail startup on non-loopback or production mode without auth.
3. Add explicit development-only unauthenticated override.
4. Remove reusable API keys from query strings.
5. Add short-lived single-use SSE tickets.
6. Redact auth headers, API keys, tokens, pairing data, and database URLs.
7. Add secret-leak sentinel tests.
8. Change default harness permission mode away from unrestricted bypass.
9. Inventory every REST/SSE/WS operation and assign preliminary scopes.
10. Document supported secure remote access through user-managed SSH forwarding.

**Exit criteria:** No accidental unauthenticated non-loopback deployment; no long-lived credential in URLs; safer default agent permissions.

## Phase 1 — Secret Store

**Objective:** Establish the foundation for every later credential and key.

Tasks:

1. Define `SecretStore` SPI.
2. Implement Electron async `safeStorage` adapter.
3. Implement headless OS secret adapter.
4. Implement encrypted-file/KMS fallback.
5. Refuse insecure Linux `basic_text` persistence.
6. Add namespace and secret-reference types.
7. Migrate CLI, source-control, desktop, and server credentials.
8. Add key-version and rotation support.
9. Add security diagnostics UI/CLI.
10. Add CI source-boundary rule for credential reads.

**Exit criteria:** No GeneratorAI-owned long-lived secret is intentionally stored in plaintext configuration.

## Phase 2 — Device Authentication and Authorization

**Objective:** Replace the global key with independently revocable clients.

Tasks:

1. Add principal, scope, and authorization contracts.
2. Add device and pairing tables/repositories.
3. Implement pending-device coalescing and rotation.
4. Implement pairing grants.
5. Implement DPoP verification and client proof generation.
6. Implement access and refresh/resume credentials.
7. Add nonce and replay stores.
8. Enforce scopes for REST, SSE, and WS.
9. Add device-management UI and CLI.
10. Add audit events.
11. Retain global API key only as a deprecated service credential during migration.

**Exit criteria:** Every remote client has its own key-bound credential, scopes, and revocation path.

## Phase 3 — Harness Isolation and New Harness Readiness

**Objective:** Make provider additions and multiple accounts safe and predictable.

Tasks:

1. Change registry identity from harness type to harness instance ID.
2. Persist harness instance metadata and secret references.
3. Add driver configuration schema and credential specification.
4. Create managed provider homes.
5. Build explicit child process environments.
6. Strip all unrelated auth variables.
7. Add account/readiness probes.
8. Add unavailable shadow status for unknown drivers.
9. Add capability and platform metadata.
10. Add provider conformance test suite.

**Exit criteria:** Two instances of one provider run simultaneously without sharing credentials or config files; a new harness is isolated to its adapter package and registration metadata.

## Phase 4 — Secure LAN and SSH

**Objective:** Support local-network clients and remote deployed servers.

Tasks:

1. Add transport SPI and authenticated client runtime.
2. Generate server identity keypair.
3. Add TLS certificate generation and fingerprint pinning.
4. Add strict pairing-offer schema and QR/deep-link handling.
5. Add message-level E2EE with transcript binding.
6. Add LAN discovery or manual endpoint entry.
7. Document user-managed SSH forwarding.
8. Implement managed SSH adapter.
9. Add host-key pinning, known-hosts, ProxyJump, and agent support.
10. Add transport diagnostics and automatic selection.

**Exit criteria:** Clients connect securely over LAN or SSH without exposing a public GeneratorAI API port.

## Phase 5 — Outbound Relay

**Objective:** Support off-LAN connectivity without inbound firewall rules.

Tasks:

1. Define relay control and phone/client protocols.
2. Build self-hostable director and cell services.
3. Add outbound host broker.
4. Add host-proof challenge.
5. Add relay invites with attempt and TTL limits.
6. Add E2EE relay transport with host-ID transcript binding.
7. Add invite-to-resume credential installation.
8. Add current/grace credential rotation.
9. Add durable revoke outbox.
10. Add demand-driven broker lifecycle.
11. Add relay abuse, capacity, and rate controls.
12. Add relay metadata/privacy documentation.

**Exit criteria:** Relay infrastructure cannot decrypt application payloads; lost-device revocation succeeds after offline recovery.

## Phase 6 — Mobile Application

**Objective:** Deliver a secure mobile companion client.

Tasks:

1. Scaffold Expo app and shared client runtime.
2. Implement platform device-key and secure-token storage.
3. Add QR pairing and consent UI.
4. Add LAN-first/relay-fallback endpoint supervisor.
5. Add projects, chats, workflow state, approvals, diffs, and reviews.
6. Add event stream replay and background-resume logic.
7. Add terminal only after explicit scope and stream hardening.
8. Add notifications and voice later.
9. Add lost-device and local credential deletion UX.
10. Add iOS/Android security and network configuration.

**Exit criteria:** Mobile can pair, reconnect, revoke, and operate with a minimal scope set over LAN and relay.

## Phase 7 — Advanced Hardening

**Objective:** Prepare for enterprise and public internet deployment.

Tasks:

1. OAuth/OIDC authorization-code flow with PKCE.
2. DPoP-bound OAuth tokens where supported.
3. Organizations, roles, project membership, and service accounts.
4. Signed resource links.
5. SQLCipher or field-level content encryption.
6. Central audit export and retention policy.
7. Extension signing and capability manifests.
8. Formal sandbox/network policy.
9. External threat-model review.
10. Penetration testing and incident-response runbooks.

---

## 28. Recommended Database Additions

Conceptual tables:

```text
users
organizations
organization_memberships
devices
device_credentials
pairing_grants
auth_sessions
dpop_replay_entries
dpop_nonces
service_accounts
service_account_credentials
harness_instances
harness_instance_project_access
secret_references
relay_bindings
relay_revoke_outbox
signed_links
signed_link_consumptions
security_audit_events
ssh_targets
ssh_host_keys
```

Sensitive values should generally be stored as hashes or secret references:

- Pairing grants: hash only.
- Refresh/resume credentials: hash or encrypted secret, depending on verification design.
- Access-token JTIs: hash only.
- DPoP proof JTIs: hash only.
- Private keys: secret store only.
- SSH private keys: secret store only.
- Signed-link signing key: secret store only.

---

## 29. Deployment Profiles

## 29.1 Desktop Local

- Server binds loopback.
- Desktop shell is the initial trusted local client.
- OS secret store.
- SQLite in user data.
- Optional pairing for browser/mobile.

## 29.2 Headless Single-User Server

- Server binds loopback.
- Access through SSH tunnel or outbound relay.
- Encrypted file, Vault, or KMS secret backend.
- System service with restricted OS account.
- No unauthenticated mode.

## 29.3 LAN Team Server

- TLS listener on LAN.
- OIDC or administrator-issued pairing.
- Per-user/per-device scopes.
- PostgreSQL recommended.
- Central audit retention.
- Firewall allowlist where possible.

## 29.4 Public Cloud Deployment

- Reverse proxy and valid TLS.
- OIDC/OAuth with PKCE.
- DPoP-bound sessions.
- Strict CORS and CSP.
- PostgreSQL and managed secret store.
- Rate limiting at edge and application.
- No direct terminal/browser scope by default.
- Separate relay infrastructure from application server.

## 29.5 Air-Gapped Deployment

- No cloud relay.
- Local/SSH transport only.
- Offline identity/service accounts.
- Local secret store.
- Bundled providers only.
- Explicitly disabled telemetry and external update checks.

---

## 30. Priority Decisions

The following decisions should be made before implementation:

1. Whether team identity starts with a chosen OIDC provider or remains local-device-only initially.
2. Whether DPoP is used for all clients immediately or introduced after per-device bearer credentials. This plan recommends immediate DPoP for new device flows.
3. Whether relay infrastructure is operated by GeneratorAI, self-hosted by users, or both.
4. Whether full E2EE applies only to relay or also LAN. This plan recommends both.
5. Whether mobile terminal input is in the initial release. This plan recommends delaying it.
6. Which headless secret backend is mandatory for Linux servers.
7. Whether PostgreSQL is required before multi-user operation.
8. Whether SSH means only port-forwarding to a deployed server or also remote execution from a local server. This plan recommends port-forwarding first.
9. Whether service-account signed requests use DPoP, mTLS, or Ed25519 HTTP signatures.
10. Data retention defaults for chats, terminal output, events, and audit logs.

---

## 31. Acceptance Criteria

The overall initiative is complete when:

1. No production or non-loopback server can start without authentication.
2. No reusable secret appears in a URL.
3. All GeneratorAI-owned secrets use an approved secure backend.
4. Linux refuses insecure secret-store fallback.
5. Every remote client has an independently revocable credential.
6. Tokens are sender-constrained to device keys.
7. REST, SSE, and WebSocket operations enforce scopes.
8. Harness processes receive only the credentials they require.
9. Multiple accounts of one harness provider can operate concurrently.
10. Secure LAN connection pins server identity.
11. SSH connections verify host keys.
12. Relay hosts connect outbound and relay infrastructure cannot decrypt application payloads.
13. Device revocation propagates after offline relay recovery.
14. A mobile client can pair, reconnect, and operate with least privilege.
15. Security-relevant state changes produce redacted audit events.
16. CI prevents regression to unsafe credential, CDP, bind, and stream patterns.
17. Windows, macOS, and Linux integration tests pass.

---

## 32. Final Recommendations

1. **Start with fail-closed authentication.** It has the highest risk reduction per unit of work.
2. **Build the secret store before relay or mobile.** Every later feature creates additional private keys and tokens.
3. **Use per-device DPoP-bound sessions rather than expanding the global API key.**
4. **Use short-lived stream tickets instead of API keys in SSE URLs.**
5. **Keep the current harness abstractions and extend them to instance IDs.** Do not replace them with a second provider framework.
6. **Inject credentials just in time into isolated provider homes.** Never depend on ambient server environment variables.
7. **Ship user-managed SSH forwarding before a custom remote agent or cloud relay.** It validates the transport boundary quickly and securely.
8. **Use outbound-only blind relay architecture with end-to-end encryption and host-proof binding.**
9. **Bind host identity and transport type into the E2EE transcript.** This prevents relay downgrade and host substitution.
10. **Implement durable revocation before marketing relay access as secure.**
11. **Build mobile first around chats, status, approvals, and diffs.** Add terminal control only after explicit scope and stream-security review.
12. **Continue the existing CI-security-gate strategy.** The scoped-CDP rule is a strong precedent for secret, bind, and privileged-RPC checks.
13. **Document residual trust honestly.** Local same-user processes, compromised clients, relay metadata, and full-access agents remain important risks.
14. **Keep all network protocols versioned, strictly validated, bounded, and shared through one contracts package.**
15. **Make security behavior observable.** Users need to know which secret backend, transport, host identity, scopes, and relay path are active.

---

## 33. Reference Links

- RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession: https://datatracker.ietf.org/doc/html/rfc9449
- Electron `safeStorage`: https://www.electronjs.org/docs/latest/api/safe-storage
- Tailscale architecture: https://tailscale.com/blog/how-tailscale-works
- Cloudflare Tunnel overview: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- OpenAI Agents SDK concepts: https://openai.github.io/openai-agents-python/

---

## 34. Document Maintenance

This document should be updated when:

- A phase begins or completes.
- Protocol versions change.
- A new harness credential model is introduced.
- A new client or transport is added.
- Threat-model assumptions change.
- A security incident or penetration test identifies a new control.
- Supported OS secret backends change.

Each implementation phase should have a separate engineering design with concrete schemas, API contracts, migration strategy, rollout flags, tests, and rollback procedure before code is merged.
