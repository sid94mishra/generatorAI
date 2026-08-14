# GeneratorAI — Security, Authentication & Multi-Device Pairing Architecture Review

**Scope:** end-to-end review of the auth/DPoP/pairing core, the relay + E2EE + multi-device transport layer, and secrets-at-rest encryption (BYOK API keys, GitHub PAT, MCP credentials, webhook tokens), against modern agentic-platform practice (Claude Code, GitHub Copilot CLI, MCP's OAuth 2.1 spec, RFC 9449 DPoP, Tailscale, WhatsApp multi-device, n8n).

**Branch:** `dev`, commit `62f1ed3` (fix of network issu). **Method:** three independent read-only code-verification passes, each citing `file:line` evidence, cross-checked against the repo's own executable specs (`agent-tests/*.mjs`, unit tests). Nothing here is inferred from documentation alone — every claim traces to source actually present in the tree today. Where something could not be confirmed statically, that is stated explicitly rather than assumed.

**Why this review supersedes prior analysis:** an earlier review (11 days before this one) concluded GeneratorAI had no mobile pairing, one shared plaintext bearer token, and plaintext secrets everywhere. Three commits landed in the intervening days (`9a22090` "Connectivity for lan and security issue fix", `1cf6b75`, `62f1ed3`) that added a real DPoP-based device-pairing system, a relay protocol with E2EE, and an encrypted secrets vault. That earlier conclusion is now **stale and materially wrong** — treat this document as current instead.

---

## 0. Scope correction on "Discord/Slack channels"

GeneratorAI has **no feature that connects the product itself to Discord or Slack as inbound channels** — no Discord bot, no Slack app/OAuth install flow, no code under `apps/` matching bot/channel/webhook integration for either platform (confirmed by repo-wide search). The only place either name appears is `templates/system/mcp-servers.json`, where **Slack is one of eight pre-configured MCP tool servers the agent can call out to** — a tool the agent uses, not a channel that talks to the agent.

The applicable comparison is therefore **how GeneratorAI stores credentials for the MCP servers and BYOK providers it does support**, which is exactly what Section 3 covers, plus the industry patterns for Slack/Discord/n8n token storage in Section 5 as the relevant best-practice reference (since the underlying problem — "a secret this app needs to hold on a user's behalf" — is identical).

---

## 1. Executive summary

GeneratorAI shipped a genuinely sophisticated multi-device auth system in the last few days: **RFC 9449 DPoP** (sender-constrained, not bearer, tokens), an **atomic single-use pairing-grant state machine**, **real-time device revocation** (not deferred to token expiry), a **hash-chained audit log**, and the scaffolding for a **relay protocol with true end-to-end encryption** for pairing devices that aren't on the same LAN. Several of these design choices (DPoP over plain bearer tokens, live revocation, per-device non-extractable hardware keys on mobile) are **ahead of** what several comparable products ship today (Section 5).

Against that strength, three concrete problems stand out, in order of severity:

1. **A live functional regression**: the new secrets-migration code silently breaks GitHub PAT-based Git integration on the first server restart after upgrade (Section 3, SEC-6). This isn't a design gap — it's a bug that will produce 401 errors with no obvious cause.
2. **The encrypted vault was built well but wired inconsistently**: it correctly protects device keys, the CLI's own identity, and the host's signing key — but **BYOK provider API keys, the GitHub PAT, project-level MCP server credentials, and per-automation webhook tokens remain unencrypted plaintext**, exactly as they were before this security work started (Section 3, SEC-5/6/7/9b). The fix isn't a new design — dead scaffolding for exactly the right pattern (`HarnessInstanceRepository.credentialRefs`) already exists unused in the codebase (SEC-13).
3. **The relay feature (for pairing devices off-LAN) does not work end-to-end today**: the server-side broker and the standalone relay server speak what appear to be two different route contracts, and **no client anywhere in the monorepo — web, mobile, desktop, or CLI — implements the transport needed to actually use a relay connection** (Section 2, TRANS-1 through TRANS-4). This is honestly self-documented in the code's own comments ("Phase 1b", "the remaining work") rather than hidden, but it means "pair a device that isn't on my LAN" is not yet a real capability, regardless of the sophistication already built.

None of this is scored as "the auth system is weak" — it is unusually strong for what it protects. The findings below are about closing gaps in an otherwise well-reasoned design, not fixing a broken foundation.

---

## 2. Auth, DPoP & pairing core

*(Evidence gathered from `packages/auth/src/*`, `apps/server/src/middleware/{auth,wsAuth,cors}.ts`, `apps/server/src/routes/{auth,security,internal-desktop}.ts`, `apps/server/src/composition/{security,bootstrapPairing,localAdminToken}.ts`, and the executable spec `agent-tests/security-e2e.mjs`.)*

### AUTH-1 — One funnel, five principal types, fail-closed by default

`AuthService.authenticate()` (`packages/auth/src/AuthService.ts:106-165`) tries, in order: DPoP token → Bearer service-account secret → stream ticket (`?ticket=`) → signed link (`?link=`) → legacy `?apiKey=` → dev-only unauthenticated loopback. Every path resolves to one common `Principal` shape (`principals.ts:27-54`). `req.principal` is set once (`middleware/auth.ts:154`) after both authentication *and* scope checks pass — there is no route with bespoke auth logic to separately audit. Electron's internal IPC endpoints (`internal-desktop.ts`, `internal-browser.ts`) are intentionally outside this funnel, mounted before `/api` (`apps/server/src/app.ts:127-132`), with their own loopback+token checks.

### AUTH-2 — DPoP (RFC 9449) is correctly implemented, including replay and key-binding

`DpopVerifier.verify()` (`dpop.ts:104-245`) checks header structure, `typ`, algorithm allow-list (`EdDSA`/`ES256` only — `none` and HMAC rejected, `dpop.ts:141-143`), signature, private-JWK-member rejection, `htm`/`htu` match, `iat` window (±60s), nonce, `jti` replay, `ath` (access-token hash) binding, and `cnf.jkt` key-binding — twelve checks in sequence. Replay protection is atomic at the DB layer (`INSERT OR IGNORE` on a primary key, `AuthRepositories.ts:432-443`, not read-then-write), verified live by `security-e2e.mjs:322-335` ("replayed DPoP proof is rejected"). An independent second implementation of the client-side proof construction inside the test suite matches the server's expectations exactly, which is real cross-checked confidence, not just "the code looks right."

### AUTH-3 — Pairing grants are a genuine atomic state machine, not a token with a TTL

Mint (admin-only) → preview (unauthenticated, doesn't consume, collapses every failure mode to one indistinguishable `INVALID_GRANT` so a wrong guess can't be used to enumerate valid codes) → redeem. Redemption is a true compare-and-swap (`UPDATE ... WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ? `, success iff `changes===1`, `AuthRepositories.ts:361-369`) — two concurrent redemptions of the same code can produce at most one device. TTL capped at 10 minutes; 5 redemption attempts before the grant self-revokes; both a per-source (10/min) and global (60/min) throttle gate `preview`/`complete` (`DeviceService.ts:189-190,314,360`).

### AUTH-4 — The short code and the QR blob are the same 60-bit secret, and the math checks out against the rate limit

12 chars from a 32-symbol alphabet (I/L/O/U excluded) = 60 bits of entropy (`packages/shared/src/utils/pairingCode.ts:114-134`), confirmed identical to the QR payload's embedded `pairingGrant` field by test (`auth-pairing.test.ts:93-96`) — the QR carries extra metadata (endpoints, scopes) but no extra secret bits. At a shared global cap of 60 attempts/minute, a maximally distributed attacker gets ~600 total guesses across a grant's 10-minute life against 2⁶⁰ possibilities — this ratio is explicitly reasoned about in the code's own comments, not accidental.

### AUTH-5 — Device revocation is real-time, not deferred to token expiry — a genuine strength

`AuthService.authenticateDpop` re-reads the device row **on every request** and throws `DEVICE_REVOKED` immediately if `revokedAt` is set, regardless of the presented access token's remaining TTL (`AuthService.ts:211-214,229-231`). Proven end-to-end: `security-e2e.mjs:436-462` revokes a device, then shows a token refreshed *immediately after* revocation is still rejected. Many DPoP/OAuth implementations only enforce revocation at refresh time, leaving a live token usable until it expires — this closes that window entirely.

### AUTH-6 — Three genuinely distinct desktop-side tokens, not one renamed

`GENERATORAI_ELECTRON_IPC_TOKEN` (CDP endpoint push, feature-flagged), `GENERATORAI_DESKTOP_ADMIN_TOKEN` (lets Electron main mint a pairing grant for its own renderer without holding standing admin authority), and a file-based `localAdminToken.ts` (per-launch random token written `0600` after listen, for break-glass recovery if every paired device is lost) are three separate mechanisms, confirmed by independently tracing all three call sites and env-var names. All are loopback-only, timing-safe compared, and probing without the right token is indistinguishable from the channel being disabled entirely (`internal-local-admin.test.ts:80-93`).

### AUTH-7 — Audit log is real and wired, with two narrow blind spots

`SecurityAuditService.record()` hash-chains events for tamper detection and redacts metadata before persisting; confirmed as an actually-called (not dead) sink at every pairing/device/auth-denial call site. Two gaps: (a) `packages/auth/src/routePolicy.ts`'s own comment claims a CI script `scripts/check-route-scopes.mjs` guarantees every route is scope-classified — **that script does not exist anywhere in the repository** (confirmed by filesystem search). Runtime is still fail-closed regardless (unmatched routes default to admin-only), so this is a false claim in a comment, not a live hole. (b) Consuming a "signed link" credential is never audited, unlike its sibling "stream ticket" which is — and `canMintDerivedCredentials()`, a guard written specifically to stop a leaked derived credential from minting further credentials, has no caller anywhere in the reviewed code.

---

## 3. Secrets encryption, BYOK, MCP credentials, GitHub PAT

*(Evidence from `packages/secrets/src/*`, `packages/core/src/services/{SourceControlConfigService,ProjectConfigService,AgentResolver,AutomationService}.ts`, `packages/db/src/schema.ts`, `apps/desktop/src/main/secret-protection.ts`.)*

### Verdict on the prior "everything is plaintext" finding: partially fixed, not fully

| Credential category | Encrypted via the new vault? | Evidence |
|---|---|---|
| System/relay host identity, token-signing seed | **Yes** | `security.ts:229-239`, `TokenService.ts:115` |
| CLI device keypair + session | **Yes** | `authRuntime.ts:90-108` |
| BYOK `harnessConfig.provider.apiKey` (chats/workflows) | **No — plaintext DB column** | SEC-5 |
| GitHub PAT (Source Control) | **No — plaintext file, and now actively broken** | SEC-6 |
| Project-level MCP server `env`/`headers` | **No — plaintext JSON on disk** | SEC-7 |
| Per-automation webhook token | **No — plaintext DB column** | SEC-9 |
| Electron/CDP IPC handshake token | N/A — ephemeral, never persisted | AUTH-6 |

### SEC-1 — The vault itself is cryptographically sound (confirmed, not just asserted)

AES-256-GCM per entry, each entry's key HKDF-derived from the master key so no (key, iv) pair repeats across entries, AAD binding namespace+name+version so ciphertext can't be relocated between slots, fail-closed on any integrity failure, atomic `0600` writes with fsync+rename (`EncryptedFileSecretStore.ts:318-379`, `KeyProvider.ts:282-309`).

### SEC-2/3 — Startup refuses a weak backend when it would matter, and is honest when it's using one

If the server binds off-loopback or runs in production, `requireSecureSecretStore` is forced true and the process **throws rather than silently falling back** to a weak key backend (`composition/security.ts:173-185`). On loopback/dev, the fallback (`LocalFileKeyProvider`) is a real 32-byte random key — just unencrypted at rest itself — and it **self-reports `secure: false` with a human-readable reason**, surfaced to the security posture endpoint rather than hidden (`KeyProvider.ts:233-243`).

### SEC-4 — The Electron desktop path bypasses the vault's own "OS-protected key" abstraction with a different, functionally-equivalent mechanism

`OsProtectedKeyProvider`/`osHooks` is fully implemented in `packages/secrets` but **never actually constructed** anywhere in the composition root (`composition-root.ts:178` never supplies `osHooks`). The real desktop protection is a separate, independently-built path (`apps/desktop/src/main/secret-protection.ts:87-145`): generate 32 random bytes, encrypt via Electron `safeStorage` (Keychain/DPAPI/libsecret), persist ciphertext `0600`, hand the *decrypted* key to the server subprocess as a plain env var. The end security property is fine (protected by the OS keystore, plaintext only in process memory), but it means the abstraction the secrets package was designed around is dead scaffolding, and a future maintainer reading `KeyProvider.ts`'s comments would reasonably (and wrongly) assume the desktop uses it.

### SEC-5 — BYOK `provider.apiKey`: still plaintext, exactly as before

Typed as a raw string in the Zod schema (`ChatSchemas.ts:52-57`, identically in `WorkflowDefinitionSchemas.ts:96`), persisted as-is in a SQLite JSON text column (`schema.ts:296,362`) with no encryption step at write (`ChatRepository.ts:35`). Zero references to `SecretStore`/`createSecretStore` anywhere in `packages/core/src/services`. Anyone with DB file read access — a backup, an export, a future SQL injection elsewhere — gets a live BYOK key in cleartext.

### SEC-6 — GitHub PAT: still plaintext, AND the migration path actively breaks it (ship-blocking bug)

`SourceControlConfigService` writes the token to `source-control.json` as plain JSON, no vault involvement (`SourceControlConfigService.ts:131-138`). Separately, `migrateLegacySecrets.ts:76-83` lists this exact file as a migration target and runs automatically on every server boot (`composition/security.ts:294-335`). Migration correctly copies the real token into the vault, then **overwrites the field it migrated from with a non-functional placeholder string** (`secretref:integration/github/default/token`). `SourceControlConfigService.load()` reads that placeholder verbatim — it never checks whether the value is a secret reference — and hands it straight to `GitHubProvider` as the literal bearer token. `resolveMaybeSecretRef()`, exported specifically to reverse this, is **never called anywhere in the codebase**. **Net effect: on the first restart after this security update ships, GitHub Git integration breaks with 401s, and nothing in the logs points back to the cause.** The only workaround today is re-entering the PAT in Settings, which reverts it to the pre-existing plaintext state.

### SEC-7 — Project-level MCP server credentials: still plaintext, and the current REST surface can't even set them

`ProjectConfigService` writes/reads project MCP configs as plain JSON files (`ProjectConfigService.ts:28-69,120-126`), no vault call anywhere in the file. The schema supports `env`/`headers` credential fields, but the current `POST/PUT /api/projects/:id/mcp-servers` route doesn't accept them at all (`routes/projects.ts:381-421`) — so today this is a latent gap (the field exists and would be plaintext-on-disk the moment any path fills it in, e.g. direct file edit) rather than an actively-exploited one via the web UI.

### SEC-8 — System MCP server credentials: no wiring exists either way

`templates/system/mcp-servers.json` has no credential fields at all, and the code that loads system MCP entries has no path to carry `env`/`headers` through even if added — they'd be silently dropped. Whatever the eight bundled servers (GitHub, Slack, Postgres, etc.) need must come from the ambient environment of whatever process spawns them; this repo doesn't manage those credentials at all today, one way or the other.

### SEC-9 — Webhook secrets: operator-env-supplied (acceptable) vs. per-automation DB tokens (plaintext, genuine gap)

Global GitHub/custom webhook secrets come from operator config/env, verified with `crypto.timingSafeEqual` — the same trust tier as any other operator-managed secret, not what the original plaintext finding was about. **Per-automation webhook tokens**, however, are a plaintext DB column (`schema.ts:616`), generated with `crypto.randomBytes(32)` but never touching the vault (`AutomationService.ts:217,247`). Lower blast radius than SEC-5/6 (a leaked token can forge automation triggers, not access an external account), but the same category of gap.

### SEC-10 — Sandbox environment injection is allow-listed, not inherited wholesale (sound, confirmed)

`HostProcessSandboxProvider` builds subprocess environment from an explicit allow-list (`PATH`, `HOME`, etc. — no secret-shaped names, `HostProcessSandboxProvider.ts:25-31,104-115`), and no code path today feeds BYOK keys or MCP credentials into sandbox exec. **Latent risk flagged for the future**, not exploitable today: `DockerSandboxProvider.exec()` forwards `env` entries as `-e KEY=VALUE` CLI arguments (`DockerSandboxProvider.ts:70-72`) — if this is ever extended to carry real secrets, they'd be visible in host process listings for the call's lifetime.

### SEC-11 — Key rotation is genuinely supported and thoroughly tested — a real strength

`migrateKeyIfNeeded()` tries the current key, then each comma-separated candidate in `GENERATORAI_SECRET_KEY_PREVIOUS`, decrypts **every** entry before writing anything back (all-or-nothing — a partially-readable vault is treated as the wrong key, not partially re-keyed), and bumps a `kekVersion` so old ciphertext can never replay into the new generation. Covered by eight distinct test cases in `rekey.test.ts` including the partial-decrypt-refusal case. This is one of the most carefully built parts of the whole package.

### SEC-12 — Legacy plaintext locations and their migration are honestly documented, including the undeleteable-bytes caveat

`migrateLegacySecrets.ts` enumerates exactly four historical plaintext locations (confirming the scope of the old finding was accurate), refuses to migrate into a backend that isn't itself secure, verifies a read-after-write round-trip, and — critically — logs an explicit warning that secure deletion isn't guaranteed on journaled/copy-on-write filesystems and recommends rotating high-value tokens. This is honest, defensive engineering; the only defect is SEC-6's — the stub value nothing ever resolves back.

### SEC-13 — The right fix for SEC-5 already has unused scaffolding sitting in the repo

`HarnessInstanceRepository` (`packages/db/src/repositories/HarnessInstanceRepository.ts:9-33`) defines exactly the right shape for fixing BYOK: a `credentialRefs: Record<string, string>` field that stores **vault pointers, never raw values** — designed, per its own comment, for scenarios like running `claude-personal` and `claude-work` side by side with separate credentials. It is **never constructed or queried anywhere** in `apps/` or `packages/core`. This is the same pattern as the performance review's `SandboxLifecycleManager` finding: the team has already designed the correct fix once; it just needs to be wired to the live BYOK path instead of left as dead code.

---

## 4. Relay, end-to-end encryption & multi-device transport

*(Evidence from `packages/relay-protocol/src/*`, `apps/relay/src/*`, `apps/server/src/relay/*`, `packages/client-runtime/src/*`, `packages/client-transport/src/*`, `apps/server/src/network/*`, `apps/desktop/src/main/{backend-switcher,serverConnections}.ts`, `apps/mobile/src/auth/*`, `apps/cli/src/commands/device.ts`.)*

### TRANS-1 — The relay server and server-side broker are real, tested code — this is not vaporware

`apps/relay/src/{index,cell}.ts` is a complete, runnable director+cell relay server: Ed25519 host-proof verification, single-use/attempt-limited invites, revocation propagation, blind byte-forwarding. `apps/server/src/relay/RelayHostBroker.ts` dials out to it (never listens inbound — sound for a self-hosted product behind NAT), performing the same Ed25519 proof-of-possession handshake. An end-to-end test (`agent-tests/relay-e2e.mjs`) exercises the real relay process and confirms it never logs plaintext or invite tokens.

### TRANS-2 — But the broker and the relay server appear to speak different route contracts — likely broken if wired together today

`apps/relay/src/index.ts:58-77` implements the director as `GET /relay/assignment`, returning a `cellUrl` that already ends in `/relay/host`. `RelayHostBroker.register()` instead `POST`s to `/v1/hosts/register` (`RelayHostBroker.ts:316`) — a route `apps/relay` never defines. `openControlChannel()` then appends `/v1/host` to the returned `cellUrl` (`RelayHostBroker.ts:340`), which would double up against the director's already-suffixed URL. Confirming this isn't a misreading: the repo's own end-to-end relay test **never uses `RelayHostBroker` at all** — it hand-rolls its own client that talks directly to `apps/relay`'s actual routes. There is no test anywhere that boots a real `apps/server` with relay enabled against a real `apps/relay` instance end-to-end.

### TRANS-3 — No client anywhere can actually use a relay connection, even if TRANS-2 were fixed

`apps/mobile/src/transport/endpointPlan.ts:99-117`'s `buildRelayCandidates()` **always returns an empty array**, with a comment stating plainly that wiring an actual `RelayTransport` to the relay socket is "the remaining work." `packages/client-transport/src` contains only `DirectTransport.ts` — there is no `RelayTransport.ts` anywhere in the monorepo. `server-info` and `/api/security/posture` both **hardcode** `relay: false`/`clientAvailable: false` rather than deriving it from whether relay is actually enabled — a deliberate, self-aware signal that this isn't ready to advertise, not an oversight.

### TRANS-4 — Practical implication: relay invites can be minted today but cannot be redeemed by anything

`generatorai device invite --relay` threads a real `includeRelay: true` flag through to a real `RelayHostBroker.createInvite` call — an admin could run this command today and get a QR code that claims relay support, but no client in this codebase can consume it. This is a UX-expectations risk worth fixing before the feature is documented or surfaced to end users: either gate the CLI flag behind an explicit "experimental, no client support yet" warning, or hide it until TRANS-2/3 are resolved.

### TRANS-5 — E2EE uses sound primitives, but its own comments overstate the KDF

X25519 ECDH (`nacl.box`) + XSalsa20-Poly1305 AEAD framing (`nacl.secretbox`) — solid, well-understood primitives via tweetnacl. **However**, the file header and the `kdf()` function's own comments claim the key schedule is "HKDF-SHA-256" / "HMAC-SHA-512/256 in an extract-then-expand construction" (`e2ee.ts:9-14,293-297`), while the actual code computes a single unkeyed `SHA-512` hash over concatenated domain-separated fields (`e2ee.ts:298-310`) — neither HKDF nor HMAC. This is not a demonstrated vulnerability (the construction is still domain-separated and transcript-bound), but "the comment says X and the code does Y" is exactly the class of claim that should not be taken on faith for a cryptographic security boundary — this needs a real cryptographer's sign-off and a doc correction, not just a shrug.

### TRANS-6 — The E2EE is genuinely end-to-end against a relay operator, but not against the GeneratorAI server itself — which is the correct, intended scope, just worth stating precisely

The two parties to the key exchange are the client device and the GeneratorAI server ("host") — a third-party relay operator cannot decrypt traffic even in principle (confirmed by the relay test's sentinel check that plaintext never appears at the relay). It is **not** end-to-end against the server operator, because the server necessarily decrypts everything to serve its own API — which is correct for a self-hosted product, not a zero-knowledge service. The distinction matters for how this gets described to users: "protects you from anyone snooping the relay/network," not "even we can't see your data" (the latter would be false and shouldn't be claimed).

### TRANS-7 — Endpoint fallback exists but isn't as fast as the passing test suggests under realistic conditions

`AuthenticatedClientRuntime.resolvePinnedEndpoint()` tries each candidate endpoint sequentially with its own timeout, defaulting to **4000ms per endpoint** (`AuthenticatedClientRuntime.ts:76,489-493`). The LAN pairing E2E test's "<5s fallback" claim is real, but it's produced by explicitly overriding that timeout down to 500ms for the test (`lan-pairing-e2e.mjs:157`) — with the actual 4000ms default and two dead candidates ahead of a live one, a real device could take 8+ seconds to fall back, and no production call site was found overriding the default down from 4000ms. Not a security issue, but a UX/latency one worth measuring before it surfaces as a support complaint about pairing being slow on flaky networks.

### TRANS-8 — Network exposure control: the UI-facing toggle is advisory, the real gate is elsewhere, and the previously-known "0.0.0.0 with no auth" issue appears closed

`apps/server/src/network/exposure.ts` only persists a UI preference and computes advisory blocker text — it doesn't itself throw or block anything. The actual enforcement is in `composition/security.ts`: unauthenticated-loopback mode is refused outside loopback/dev at two separate checkpoints, and a secure secret backend is mandatory the moment the bind address isn't loopback. By default (no env vars set at all), authentication is required regardless of bind host. This is a sound separation of "what the settings page shows" from "what actually gates the process," and — from static reading — the historical 0.0.0.0-with-no-auth failure mode is closed. (Not confirmed by a live runtime reproduction.)

### TRANS-9 — Desktop "multi-server" is single-active-connection with instant switching, not simultaneous multi-tenancy — and isolation is enforced by the platform, not application code

Switching backends is literally `win.loadURL(newOrigin)` — the file's own comment states this discards every store/cache/stream from the previous server by browser same-origin semantics, not by any explicit multi-tenancy logic. When pointed at a remote server, the desktop shell is treated as an **ordinary, unprivileged paired client** — proven by a test showing it lands on the same human-consent pairing screen as any other device, with no auto-pairing and no native-browser privilege. Auto-pairing only happens for the desktop's **own embedded server**, via a separate same-OS-user-trust path (the `localAdminToken` mechanism) — a materially different and correctly narrower trust tier, clearly distinguished in the code.

### TRANS-10 — Mobile device-credential storage is genuinely strong: hardware-backed keys, honest fallback reporting, never plaintext

The mobile app tries a non-extractable hardware key (Secure Enclave/StrongBox) first, falling back to a software key in `expo-secure-store` (OS keychain) only if hardware generation fails — and that fallback is **surfaced to the user in a Security screen**, not hidden. The session/resume-secret store carries an explicit code comment: "Never AsyncStorage: that is plaintext on disk." Both QR scan and manual entry funnel into the same consent screen showing the host's cryptographic fingerprint for the user to visually compare — that human comparison is the actual defense against a substituted/malicious QR code, and it's presented, not buried.

### TRANS-11 — No explicit cap on paired devices per server was found

Device revocation, scoping, and credential isolation are all per-device and sound (Section 2, AUTH-5), but no code path enforces a maximum device count per server — only relay-specific numeric ceilings exist (max concurrent relay streams/hosts), which don't bound direct/LAN pairings. Given the product's single-tenant, single-operator threat model this is a low-severity gap, not urgent, but worth a deliberate decision rather than an accidental absence.

### TRANS-12 — End-to-end walkthrough: what "one server as source, N devices connect" actually does today

1. The **host** is whichever server process is running (standalone `apps/server`, or a desktop app's embedded server) — one long-term X25519 identity, key material stored via the vault.
2. **Pairing any device** (phone, second laptop, CLI) is the *same* flow regardless of device type: mint grant → scan/type code → consent screen shows the host's fingerprint, name, and exact requested scopes → redeem → device gets its own key (never leaves the device) and its own resume secret, both keyed server-side by the host's `serverId` fingerprint (not URL, so a DHCP lease change doesn't fragment a device's credential into duplicates).
3. **All devices active simultaneously**: each is an independent row in the device registry with its own scopes, access-token lineage, and revocation state; nothing but the host's public identity is shared across them. SSE connections are capped per-(scope,id) at 6 (32 for global) — the one explicit concurrency ceiling found in this area, and it isn't device-specific.
4. **Revoking one device** is immediate (AUTH-5) and independent of every other paired device; if that device had a relay binding, the revocation is queued durably until delivered even while the relay is unreachable.
5. **Today's actual limitation**: this whole flow works for devices on the same LAN (or the same machine, via the desktop's own-server auto-pairing). Pairing a device that is **not** on the same network depends on the relay, which — per TRANS-1 through TRANS-4 — is not yet usable end-to-end.

### TRANS-13 — CLI device commands, and how `--local` mode relates (or doesn't)

`generatorai device pair/recover/status/forget` manage the CLI's own credential; `device list/revoke/invite/audit` manage the server's device registry (require `admin:devices`). `device recover` is the CLI-side entry point to the same break-glass local-admin-token path as desktop. **`--local` (in-process) mode bypasses the entire device/session model by design** — it boots the SDK in-process with no HTTP server, no DPoP, no device credential at all, and the CLI's own code explicitly comments that device management is "meaningless" in that mode. This is a deliberate, correctly-scoped distinction, not an inconsistency.

---

## 5. How modern agentic platforms and comparable systems handle the same problems

| Concern | GeneratorAI today | Reference platform | Comparison |
|---|---|---|---|
| Token binding | DPoP — sender-constrained, RFC 9449 | Claude Code, Copilot CLI: plain bearer OAuth tokens refreshed via a stored refresh token | **GeneratorAI is ahead** — a stolen GeneratorAI access token is useless without the device's private key; a stolen Claude Code/Copilot bearer token is directly usable until revoked/expired. |
| Credential storage location | macOS Keychain / Windows DPAPI / Linux plaintext file for Claude Code; OS keychain for Copilot CLI; a real encrypted vault for GeneratorAI's *identity/device* credentials but plaintext DB/files for BYOK/PAT/MCP creds | n8n: **one** encryption key (`N8N_ENCRYPTION_KEY`) uniformly encrypts every credential type at rest, with optional external vault (Vault/1Password/AWS Secrets Manager) | **GeneratorAI's vault is more sophisticated than n8n's (per-entry HKDF keys, tested rotation) but less consistently applied** — n8n encrypts 100% of user credentials through one path; GeneratorAI encrypts some categories and not others (Section 3). This is the single most actionable comparison in this report. |
| Device pairing / multi-device | DPoP device-pairing, QR + short code, real-time revocation, hardware-backed mobile keys | WhatsApp multi-device: per-device Signal-protocol identity key, server-held device list, E2E-encrypted history sync to newly linked devices | **Comparable in design maturity.** GeneratorAI's per-device key + independent revocation model is architecturally the same shape as WhatsApp's; the gap is `TRANS-1`–`TRANS-4` (off-LAN relay isn't wired end-to-end), the rough equivalent of WhatsApp's device-linking working only when both devices are on the same Wi-Fi. |
| Off-network device introduction | Relay protocol exists server-side, unusable client-side (TRANS-1–4) | Tailscale: a control-plane server brokers introduction (Noise IK + X25519), then devices connect directly or relay through a DERP node if they can't reach each other — fully wired both directions | Tailscale is the direct template for what GeneratorAI's relay is trying to be. The architecture GeneratorAI chose (outbound-only dial from the host, broker mediates introduction, blind relay never sees plaintext) mirrors Tailscale's control-plane/data-plane split correctly — it just isn't finished. |
| MCP server credentials | Plaintext project JSON files; no encryption for `env`/`headers` (SEC-7/8) | MCP spec (2025-06-18 revision): any internet-exposed MCP server **must** implement OAuth 2.1 + PKCE + Protected Resource Metadata | Not a direct violation (GeneratorAI's MCP servers here are locally-spawned tool processes, not the internet-exposed servers the spec targets), but the credentials GeneratorAI hands those tool processes are held with **less** rigor than the spec expects of the servers themselves — worth closing given the product's own README documents MCP integration as a headline feature. |
| Third-party channel/workspace tokens | N/A — feature doesn't exist (Section 0) | Slack: tokens indexed and encrypted per-workspace, never in a GET query string; Discord: token treated as equivalent to a password, environment-variable only, never hardcoded | If/when a Discord/Slack-style channel integration is ever built, the credential-handling lesson is identical to SEC-5/7: **wire it through the vault from day one**, keyed per-integration the way Slack keys per-workspace, rather than adding a fifth plaintext-JSON-column pattern to the four that already exist. |

---

## 6. Critical, unbiased assessment

**What's genuinely good, stated plainly so it doesn't get lost under the findings above:** the DPoP implementation is correct and more advanced than most comparable tools; pairing-grant atomicity and rate-limiting are well-reasoned with the math shown in the code's own comments; device revocation is real-time rather than deferred; mobile credential storage uses hardware-backed keys with honest fallback reporting; the encrypted vault's cryptography and key-rotation support are both genuinely strong; and the relay's *design* (outbound-only dial, blind forwarding, transcript-bound E2EE) is sound even though the implementation isn't finished. This is not a system that needs its foundations redone.

**What's not good enough yet, measured against the modern-platform bar above:**

1. **Inconsistent application of a good pattern is worse than no pattern**, because it creates a false sense of security — an operator who sees "GeneratorAI has an encrypted secrets vault" in the changelog would reasonably assume their BYOK key and GitHub PAT are covered by it. They aren't (SEC-5/6/7/9).
2. **A security-hardening release introduced a functional regression** (SEC-6) — the kind of bug that erodes trust in the *next* security update too, because "the security fix broke my Git integration" is a bad story regardless of how sound the underlying crypto is.
3. **A feature that can be invoked (`--relay` invite) but not consumed by any client** is a trap for whoever documents or demos it next, unless it's explicitly gated as experimental (TRANS-4).
4. **A cryptographic primitive whose own comments misdescribe it** (TRANS-5) needs closing before it's relied upon further, purely on the principle that security code's comments and behavior must match, especially when the next engineer to touch it will trust the comment.

None of this is "the architecture is fundamentally wrong" — it's "several pieces of genuinely good engineering aren't finished being connected to each other yet," which is a materially cheaper problem to fix than the alternative.

---

## 7. Recommendations (evidence-backed, prioritized)

### P0 — fix before the next release ships

**P0-1. Fix the GitHub PAT migration regression (SEC-6).** Make `SourceControlConfigService.load()` call the already-exported `resolveMaybeSecretRef()` on the loaded token before use. *Resolves:* a confirmed, reproducible break of GitHub integration on upgrade. *Why this and not a bigger rewrite:* the fix function already exists, tested, exported for exactly this purpose — this is a one-call wiring fix, not new design work.

**P0-2. Wire BYOK `provider.apiKey` and the GitHub PAT through the existing vault, using the existing `HarnessInstanceRepository.credentialRefs` pattern (SEC-5/6/13).** *Resolves:* the two credential categories the original plaintext finding specifically named, still true today. *Why this is the most cost-effective fix available:* the correct schema (`credentialRefs: Record<string,string>` storing vault pointers, never raw values) is already designed and sitting unused in the repo — this closes the gap by activating existing scaffolding, not building a new subsystem, the same "already-designed fix sitting idle" pattern the performance review found with `SandboxLifecycleManager`.

**P0-3. Gate or hide `device invite --relay` until TRANS-2/3 are resolved (TRANS-4).** *Resolves:* an admin being able to generate a relay QR code today that no client can redeem, with no warning that this is the case. Cheapest fix: one guard clause plus a CLI warning string.

### P1 — do before documenting or promoting these features further

**P1-1. Reconcile `RelayHostBroker`'s route contract with `apps/relay`'s actual routes, and add one real end-to-end test that boots both against each other (TRANS-2).** *Resolves:* the apparent `/v1/hosts/register` vs `/relay/assignment` mismatch that no existing test would catch, since the relay E2E test bypasses `RelayHostBroker` entirely.

**P1-2. Implement `RelayTransport` on at least one client (mobile is the obvious first target, since `buildRelayCandidates()` already has the seam) (TRANS-3).** *Resolves:* relay being real on both server-side halves but unusable by any actual device — this is what turns "pair a device on my LAN" into "pair a device anywhere," which is the capability originally asked about for devices not co-located with the host.

**P1-3. Get the `e2ee.ts` key-schedule comments and implementation reconciled, with a second pair of eyes on the actual construction (TRANS-5).** *Resolves:* a security-critical primitive whose documentation doesn't match its code — either fix the comment to describe the real domain-separated SHA-512 construction accurately, or implement the HKDF the comments claim, but don't ship the mismatch either way.

**P1-4. Extend vault coverage to project-level MCP `env`/`headers` and per-automation webhook tokens (SEC-7/9).** *Resolves:* the remaining two plaintext-credential categories, using the same `credentialRefs`-style pattern as P0-2 — do this as one consolidated pass across all four plaintext categories rather than four separate changes, since they share one root cause (the vault exists but wasn't adopted uniformly).

**P1-5. Implement `scripts/check-route-scopes.mjs` (or delete the comment claiming it exists) (AUTH-7).** *Resolves:* a stale/false claim in security-critical code — cheap either way, and a real CI guard is the better of the two options given how easy it is for a new route to land unclassified.

### P2 — worth doing, lower urgency

**P2-1. Decide on and enforce an explicit max-paired-devices-per-server ceiling (TRANS-11).** *Why lower priority:* the single-tenant/single-operator threat model this product targets makes this a deliberate-choice item, not an active risk, but it should be a decision rather than an accident.

**P2-2. Either wire `OsProtectedKeyProvider`/`osHooks` into the desktop path for real, or remove the abstraction and document that Electron's `safeStorage` path is the actual mechanism (SEC-4).** *Why lower priority:* the current state is functionally secure, just confusing for maintainers — a documentation/consistency fix, not a security fix.

**P2-3. Audit successful `signed-link` consumption, and wire `canMintDerivedCredentials()` into `issueStreamTicket()`/`authenticateSignedLink()` (AUTH-7, F14 from the auth review).** *Why lower priority:* signed links have no minting route today, so the gap is currently unreachable — but it should be closed before one is added, not after.

---

## Appendix — evidence index (file:line citations by finding)

| Finding | Primary evidence |
|---|---|
| AUTH-1 | `packages/auth/src/AuthService.ts:106-165`; `packages/auth/src/principals.ts:27-54`; `apps/server/src/middleware/auth.ts:154` |
| AUTH-2 | `packages/auth/src/dpop.ts:104-245,141-143`; `packages/db/src/repositories/AuthRepositories.ts:432-443`; `agent-tests/security-e2e.mjs:322-335` |
| AUTH-3 | `packages/auth/src/DeviceService.ts:189-190,214-276,301-349,357-482`; `packages/db/src/repositories/AuthRepositories.ts:361-369` |
| AUTH-4 | `packages/shared/src/utils/pairingCode.ts:114-134`; `apps/server/__tests__/routes/auth-pairing.test.ts:93-96` |
| AUTH-5 | `packages/auth/src/AuthService.ts:211-214,229-231`; `agent-tests/security-e2e.mjs:436-462` |
| AUTH-6 | `apps/server/src/routes/internal-browser.ts:32-56`; `apps/desktop/src/main/server-manager.ts:377-391`; `apps/server/src/composition/localAdminToken.ts` |
| AUTH-7 | `packages/auth/src/routePolicy.ts:9`; `packages/auth/src/principals.ts:57-59`; `packages/auth/src/SecurityAuditService.ts` |
| SEC-1 | `packages/secrets/src/EncryptedFileSecretStore.ts:318-379`; `packages/secrets/src/KeyProvider.ts:282-309` |
| SEC-2/3 | `apps/server/src/composition/security.ts:173-185`; `packages/secrets/src/KeyProvider.ts:233-243` |
| SEC-4 | `apps/server/src/composition-root.ts:178`; `apps/desktop/src/main/secret-protection.ts:87-145` |
| SEC-5 | `packages/shared/src/config/ChatSchemas.ts:52-57`; `packages/db/src/schema.ts:296,362`; `packages/db/src/repositories/ChatRepository.ts:35` |
| SEC-6 | `packages/core/src/services/SourceControlConfigService.ts:56-138`; `packages/secrets/src/migrateLegacySecrets.ts:76-83,157-160`; `apps/server/src/composition/security.ts:294-335` |
| SEC-7 | `packages/core/src/services/ProjectConfigService.ts:28-69,120-126`; `apps/server/src/routes/projects.ts:381-421` |
| SEC-9 | `packages/db/src/schema.ts:616`; `packages/core/src/services/AutomationService.ts:217,247` |
| SEC-10 | `packages/core/src/infrastructure/HostProcessSandboxProvider.ts:25-31,104-115`; `packages/core/src/infrastructure/DockerSandboxProvider.ts:70-72` |
| SEC-11 | `packages/secrets/src/EncryptedFileSecretStore.ts:176-235`; `packages/secrets/src/__tests__/rekey.test.ts` |
| SEC-12 | `packages/secrets/src/migrateLegacySecrets.ts:52-93,151-183` |
| SEC-13 | `packages/db/src/repositories/HarnessInstanceRepository.ts:9-33` |
| TRANS-1 | `apps/relay/src/{index,cell}.ts`; `apps/server/src/relay/RelayHostBroker.ts`; `agent-tests/relay-e2e.mjs` |
| TRANS-2 | `apps/relay/src/index.ts:58-77`; `apps/server/src/relay/RelayHostBroker.ts:316,340` |
| TRANS-3 | `apps/mobile/src/transport/endpointPlan.ts:99-117`; `packages/client-transport/src/` (no `RelayTransport.ts`) |
| TRANS-4 | `apps/cli/src/commands/device.ts:408,429-432` |
| TRANS-5/6 | `packages/relay-protocol/src/e2ee.ts:9-14,262-310,346-460` |
| TRANS-7 | `packages/client-runtime/src/AuthenticatedClientRuntime.ts:76,489-522`; `agent-tests/lan-pairing-e2e.mjs:157,170` |
| TRANS-8 | `apps/server/src/network/exposure.ts:50-129`; `apps/server/src/composition/security.ts:153-185,279-289` |
| TRANS-9 | `apps/desktop/src/main/backend-switcher.ts:5-78`; `agent-tests/desktop-remote-mode.mjs:33-104` |
| TRANS-10 | `apps/mobile/src/auth/stores.ts:8-24,99-210`; `apps/mobile/app/pair.tsx:92-267` |
| TRANS-11/12 | `packages/relay-protocol/src/relayProtocol.ts:28`; `apps/relay/src/cell.ts:44` |
| TRANS-13 | `apps/cli/src/commands/device.ts:44-497`; `apps/cli/src/platform/createClient.ts:34-40` |

All evidence gathered via three independent read-only code-verification passes against `dev`@`62f1ed3`, cross-checked against the repository's own unit tests and executable E2E specs where available. Anything not directly confirmed from source is flagged inline above rather than presented as fact.
