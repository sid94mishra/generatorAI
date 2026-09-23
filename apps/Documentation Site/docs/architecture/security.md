---
title: Security and trust boundaries
description: Authentication, scopes, secret storage, native bridges, workspace boundaries, and current limitations.
---

# Security and trust boundaries

GeneratorAI can execute code and operate developer tools on its host. The important boundary is the authority granted to a client, provider, extension, or tool, not whether its interface happens to be local, mobile, or native. This page describes implemented controls and material limits; it is not a security certification.

## Startup policy

`apps/server/src/composition/security.ts` makes the startup decision before listeners accept requests:

| Deployment | Authentication | Secret backend |
| --- | --- | --- |
| Development, loopback, explicit unauthenticated opt-in | Unauthenticated mode allowed with warning | Local development fallback may be allowed |
| Development, loopback, normal configuration | Authentication required | Effective backend reported in security posture |
| Non-loopback or production | Authentication required; unauthenticated opt-in rejected | Secure backend required; insecure fallback rejected |

Loopback is not an automatic authentication bypass. `GET /api/security/posture` reports the effective posture, including bind mode, authentication requirement, secret backend, relay setting, and legacy API-key status.

## Pairing, identity, and request proof

Pairing establishes a device record and a key-bound session. `AuthenticatedClientRuntime` owns the client device key, pairing completion, access tokens, automatic refresh, DPoP proofs, nonce retries, stream tickets, and revoked-device state.

DPoP validation checks the proof signature and algorithm, request method and URI, timestamp, replay identifier, nonce when required, token hash, and binding to the token's public-key thumbprint. A bearer token alone is insufficient on that path. Short-lived tickets adapt authentication to SSE/WebSocket entry points that cannot always carry the same headers as fetch.

Clients pin the host identity recorded during pairing and check a candidate endpoint before sending credentials. A changed identity is a distinct failure, not another endpoint to retry indefinitely. Pairing offers, access tokens, resume credentials, stream tickets, and raw private keys must not be copied into documentation, screenshots, or issue reports.

The legacy API key remains a compatibility path and bypasses DPoP. New client setup should use pairing rather than building integrations around the legacy exception.

## Authorization scopes

`packages/auth/src/scopes.ts` defines read/write scopes for application resources, `stream:events`, execution scopes, and separate administration scopes. Routes and stream subscriptions apply policy from the auth layer; transport does not grant authority.

| Preset | Important behavior |
| --- | --- |
| Interactive device | Normal resource reads, chat/workflow/review interaction and agent execution; no default admin, terminal, browser, or computer-use grant |
| Mobile companion | Chat/status/review/agent interaction; workflow/project/file authoring and native execution permissions are narrower |
| Standalone mobile | Adds project/workspace/file/workflow writes and terminal/browser execution |
| CLI | Adds project/workspace/file writes and terminal authority to the interactive preset |
| Trusted local administration | Broad scope set for authorized local administration |

Standalone mobile still excludes `exec:computer` and all `admin:*` scopes by default. Higher authority must be granted to the device explicitly. `read:activity` permits a filtered global lifecycle feed so ordinary clients can update lists without reading every transcript or acquiring administrator privileges.

## Secret storage

`createSecretStore` selects a key provider in this order:

1. Operator-supplied `GENERATORAI_SECRET_KEY` or passphrase.
2. OS-protected hooks supplied by the desktop environment, such as Electron safeStorage.
3. A mode-0600 local key file, explicitly classified as an insecure development fallback.

`EncryptedFileSecretStore` encrypts entries with AES-256-GCM and independently derived per-entry keys. Vault encryption and database storage are different controls: the database is not automatically an encrypted SQLite database.

MCP credentials are stored as vault entries and passed through configuration as `secretref:` pointers. The hub resolves values at the handoff to a harness. Redaction helpers and credential migration reduce accidental persistence of raw values, but they do not make arbitrary extension code untrusted or safe to install.

Operator key rotation can use the previous-key migration path. Preserve the correct vault/key combination in backups and follow the effective backend's recovery requirements.

## Desktop bridge

The main application window uses context isolation, no Node integration, sandboxing, and web security. Native browser views have a separate content boundary because they can navigate to arbitrary sites.

`apps/desktop/src/main/ipc-guard.ts` checks that IPC originates from the trusted main window, expected top frame, and application origin. Browser views, popups, and embedded frames must not receive the main renderer's shell/dialog/credential authority.

The `/internal/desktop`, `/internal/browser`, and `/internal/computer` channels are separate from the public API. They require loopback and an accepted local credential. Desktop startup provides a per-launch in-memory handshake token; the internal desktop pairing route also accepts the server's owner-only local admin token for recovery. Avoid the stale simplification that there is only one accepted credential or that all local recovery material is memory-only.

## Workspace and tool boundaries

`PathResolver` provides logical and realpath checks for workspace-relative file access. Mount preparation validates source selection and branch/worktree intent. Browser host policies, tool permission rules, execution modes, and computer-use consent enforce separate controls at their own boundaries.

A worktree separates source changes, but it is not a sandbox against the rest of the filesystem or network. A child-process host separates resource/failure ownership, but it is also not an OS sandbox. Actual isolation depends on the chosen provider sandbox, configured sandbox infrastructure, tool gates, and permitted mounts.

Child process environment construction uses allowlists so a terminal or provider child does not simply inherit every server secret. Script, hook, MCP, and extension configuration deserves review because it can execute local code.

## Extensions and widgets

Server extension entries are dynamically imported into the server process. Their manifest permissions are metadata and must not be described as a complete enforcement sandbox. Only install code trusted with the server's authority.

Widget HTML is served from a dedicated origin with its own Content Security Policy and is embedded through the widget bridge. Some widget frames use `allow-same-origin`; therefore the current isolation boundary is the separate widget origin plus policy, not a universal null-origin claim. The asset handler sets CSP for served HTML and non-HTML assets. Its early validation/error responses return before that header is set; the policy should not be described as covering every response.

Browser content, widget content, and the privileged application renderer are three distinct trust domains. See [Extensions](./extensions.md).

## Relay and network confidentiality

The relay validates host possession/binding, manages assignments/invites and revocation, and forwards application streams. **Live relay and LAN payloads do not currently use the E2EE framing primitives in `relay-protocol`.** The relay can inspect forwarded plaintext at its application layer. Use appropriate transport protection and treat the relay operator as a trusted party.

Do not infer confidentiality from a pairing offer field named `e2eeFraming` or a tested cryptography module alone. A live caller must actually seal/open every relevant frame before that property is true. See [Transport](./transports.md).

## Source evidence

`apps/server/src/composition/security.ts`; `packages/auth/src/dpop.ts`, `scopes.ts`, and `routePolicy.ts`; `packages/secrets/src/createSecretStore.ts`, `EncryptedFileSecretStore.ts`, and `KeyProvider.ts`; `apps/desktop/src/main/window-manager.ts`, `ipc-guard.ts`, and `session-hardening.ts`; `apps/server/src/routes/internal-desktop.ts` and `extensions.ts`; `packages/relay-protocol/src/e2ee.ts`.
