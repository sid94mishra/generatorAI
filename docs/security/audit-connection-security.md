---
title: Connection & security audit (host × client × network)
description: Deep read-mostly audit of GeneratorAI's auth, pairing, TLS, relay, desktop and mobile connection surfaces. Findings with evidence, the solid parts, the scenario matrix and the UX gaps.
audit-date: 2026-10-09
branch: desktop_redesign
method: source review + probes against isolated servers (bare DB_PATH/ARTIFACTS_DIR/WORKSPACES_DIR/EXTENSIONS_DIR + GENERATORAI_BIND_HOST, dbPath asserted in every run)
---

# Connection & security audit

Read-mostly audit of the whole connect + authorize + transport system. No product code was
changed. Behaviour was verified against **isolated** servers on the branch `desktop_redesign`:
every run set bare `DB_PATH` / `ARTIFACTS_DIR` / `WORKSPACES_DIR` / `EXTENSIONS_DIR` into a
scratchpad temp dir plus `GENERATORAI_BIND_HOST`, and the logged `dbPath` was checked to be the
temp DB before any probe (e.g.
`…/scratchpad/audit/srv-3711-8ufh3C/audit.db`). Ports 3197/5197/8081/9898 and the
`mobile_redesign` tree were left untouched.

> **Status (2026-10-09, fix pass).** F-1, F-2, F-3, F-5, F-6, F-7, F-9 and the missing Host
> allow-list (DNS rebinding, research §3.8) are **fixed** on `desktop_redesign` — see
> [§6 Fixed](#6-fixed-finding--commit--verification). F-4 (Electron fuses / `utilityProcess`), F-8,
> mobile CA pinning (MV-44), relay E2EE, per-install public certificates and the desktop-remote
> TOFU are left for the owner's design decisions.

> **Top findings (detail below).** F-1 (**critical**) the route→scope policy is
> case-sensitive but Express routing is not, so `GET /api/auth/Devices`, `POST /api/auth/Pair`,
> `DELETE /api/auth/Devices/:id`, `/api/workspaces/x/Terminals`, `/Computer/*` etc. all run with
> **no scope check** — any paired device (including a minimal-scope MCP agent) reaches full
> `admin:devices` / `exec:terminal` / `exec:computer` surface. Reproduced. F-2 (**high**)
> device revocation does not close that device's **already-open SSE/WS streams** — a revoked
> device keeps receiving live events until it reconnects. Reproduced. F-3 (**high**) the
> pairing anti-brute-force uses one process-wide **global** throttle (60/min) with no allowance
> for the legitimate owner, so one LAN attacker spamming `/pair/preview` locks out real pairing
> for everyone. Reproduced. F-4 (**medium**) packaged macOS app ships with `RunAsNode` /
> `EnableNodeCliInspectArguments` / `EnableNodeOptionsEnvironmentVariable` fuses **enabled** and
> ASAR integrity **disabled**. F-5 (**medium**) a joining device chooses its own `platform`, and
> MCP forbidden-scope enforcement keys on that self-declared value, so an MCP agent principal can
> be handed `exec:terminal` / `admin:*` later.

---

## 1. Scenario matrix (host × client × network)

Reachability/secure-context columns reflect the implemented transport policy (D-110…D-114).
"Auth" is always DPoP-bound device tokens unless noted; **transport never grants authority**
(the one documented exception is dev `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK` on 127.0.0.1).

| Host | Client | Network | Works? | How / secure properties | UX steps |
|---|---|---|---|---|---|
| Desktop embedded (packaged) | Desktop window | same machine (loopback) | ✅ | `http://127.0.0.1:<port>`; renderer auto-pairs via the per-launch admin token over `/internal/desktop` (loopback + token). Secure context on loopback without TLS. | None; silent at first launch. |
| Desktop embedded (packaged) | Browser, same machine | loopback | ✅ | Pair with bootstrap/short code; loopback is a secure context. | Open localhost URL, type code. |
| Desktop embedded (packaged) | Browser, other machine | LAN | ✅ (with cert warning) | Network exposure → `0.0.0.0`; one port sniffs TLS vs HTTP; browser must use `https://<lan-ip>:<port>`, plain-HTTP pages 308-redirect, foreign-Origin API 403 `HTTPS_REQUIRED`. Self-signed → warning until the CA is installed. | Toggle LAN, compare cert fingerprint, trust warning, type code. **Not seamless (U-1).** |
| Desktop embedded | Native mobile app | LAN | ✅ | Plain-HTTP **native lane** (no `Origin` / server's own `http://host`), DPoP-bound. **No confidentiality, no MITM protection during pairing** (D-112 / MV-44, by design, documented). | Scan QR / type code. |
| Any server | Browser / mobile | relay (different networks) | ⛔ today | Relay client transport disabled: `POST /auth/pair {includeRelay:true}` → 409 `RELAY_CLIENT_UNAVAILABLE`; `server-info.transports.relay === false`. Host broker + cell exist and are tested but no shipping client dials them. | — |
| Remote machine's server | Desktop app (remote mode) | LAN / proxy | ⚠️ partial | `backend-switcher` + `serverConnections` load the remote origin in the window (new origin ⇒ fresh stores). `serverId` pinned after first connect. **Self-signed remote HTTPS is refused** — `certificate-error` trusts loopback only (known gap, lan-https.md "Left/follow-ups"). Works against a loopback/plain or publicly-trusted remote. | Menu → Connect to a server, type address. |
| Any server | CLI (`cli-core`) | loopback / LAN | ✅ | Device pairing; key + session in the OS vault via `@generatorai/secrets` (`requireSecure:false` fallback = 0600 file). | `generatorai device pair <code>`. |
| Any server | MCP server device (`mcp-server`) | loopback / LAN | ✅ | `DEFAULT_MCP_SCOPES` (read + chat + `exec:agent`); `MCP_FORBIDDEN_SCOPES` meant to block terminal/admin. Vault `requireSecure:false`. | `generatorai device pair` with `--platform mcp`. |
| Any server | Service account / legacy `GENERATORAI_API_KEY` | any | ✅ | `Authorization: Bearer <secret>`; **bypasses DPoP**; legacy key = full scope. For CI/automation. | Operator config. |
| Any server | Signed link | any | ✅ | Short-lived, resource-pinned, single-use; `exec:*`/`admin:*` forbidden on links; terminal credential kind (cannot mint more). | Share a link. |
| Any server | Widget iframe | loopback only | ✅ (local) / ⛔ remote | Served from a **separate loopback port** (`WIDGET_PORT`, default 3101, bound `127.0.0.1`). A remote browser cannot load widget iframes (known gap). | Automatic in chat. |
| Any server | Webhook caller | public routes | ✅ | `/automations/webhooks`, `/workflow-callbacks` are `public:true`; authenticate via unguessable path token + optional per-automation HMAC (timing-safe). | External system posts. |
| Dev/sandbox | Browser via Vite proxy | loopback / LAN | ✅ | Vite `:5173` proxies `/api`, `xfwd:true`, `changeOrigin:false`, explicit `x-forwarded-proto`. Server honours those headers **only** when `GENERATORAI_TRUST_PROXY` names the peer (D-114). | `pnpm dev`. |
| Loopback dev + `ALLOW_UNAUTHENTICATED_LOOPBACK=1` | any local | loopback only | ✅ | Full authority with no credential; refuses to start off-loopback/production. Loud banner. | Env opt-in. |

---

## 2. Findings (sorted by severity)

### F-1 — CRITICAL — Route→scope policy is case-sensitive; Express routing is not → scope bypass

> **Fixed** — `28e575c2` (D-115). See §6.

**Scenario.** Any authenticated principal (even the lowest-privilege MCP agent device) reaches
admin-only and high-risk routes by changing the case of a path segment.

**Evidence (reproduced against isolated loopback server, dbPath asserted).** A default-scope web
device and a minimal MCP device were paired; then:

```
GET  /api/auth/devices            403  INSUFFICIENT_SCOPE (admin:devices)
GET  /api/auth/Devices            200  {"devices":[ …full list with every device… ]}
GET  /api/auth/audit              403  INSUFFICIENT_SCOPE (admin:settings)
GET  /api/auth/Audit              200  {"events":[ …full security audit log… ]}
POST /api/auth/Pair               201  (minted an ALL-ability pairing grant)
DELETE /api/auth/Devices/<id>     204  (MCP agent device revoked another device)
GET  /api/workspaces/x/Terminals  200  (exec:terminal route; lowercase → 403)
GET  /api/workspaces/x/Computer/control   200   (exec:computer route; lowercase → 403)
GET  /api/workspaces/x/Computer/frames    200
```

The MCP device's own scopes were `exec:agent, read:chats, read:status, read:workflows,
stream:events, write:chats` — no admin, no terminal, no computer.

**Root cause.** `createAuthMiddleware` resolves policy with `requiredScopesFor(req.method, req.path)`
(`apps/server/src/middleware/auth.ts:84`). `req.path` preserves the original case. `resolveRoutePolicy`
→ `matchScore` compares path segments with `expected !== pathSegments[i]`, an exact
**case-sensitive** string compare (`packages/auth/src/routePolicy.ts:276`). But Express 5 (5.2.1)
has case-sensitive routing **off** by default, so the router still dispatches `/auth/Devices` to the
handler registered at `/auth/devices`. The policy lookup for `/auth/Devices` finds no entry whose
segment matches, so — critically — it does **not** fall through to `DEFAULT_POLICY` (that requires
`admin:settings` and would fail closed): longest-prefix matching still matches the shorter,
low-bar `/auth` entry (`read:status`), or for workspace sub-routes matches `/workspaces`
(`read/write:workspaces`) instead of the `exec:*` sub-entry. So the request runs under a *weaker*
policy than its true route, not a stronger one. `DELETE …/Devices/:id` resolves to the method-generic
`/auth` write (`read:status`) — which a default device holds — while the handler performs a full
device revocation.

This also voids `scripts/check-route-scopes.mjs`'s guarantee and the case-sensitive "always fails
closed" claim in `routePolicy.ts:1-9`.

**Why it is a problem.** Complete authorization bypass for every route whose path has an
alphabetic segment: device management, audit log read, pairing-grant minting (privilege
escalation to all-scope), terminal, browser and computer-use surfaces, relay, service accounts.
OWASP A01 Broken Access Control. The blast radius is every non-loopback deployment and every
multi-client install, and it is reachable by any device the owner paired for read-only use, and by
an MCP **agent** principal.

**Fix.** Make path matching and routing agree. Either (a) set Express `app.set('case sensitive
routing', true)` **and** `strict routing` consistently and canonicalize, **or** preferably (b)
lower-case the path before policy resolution and compare case-insensitively in `matchScore`, and
additionally make an unmatched/odd path fall to `DEFAULT_POLICY` rather than a shorter prefix.
Normalize once in `createAuthMiddleware` (`const apiPath = req.path` → normalized) so the WS upgrade
path (`wsAuth.ts`) and REST agree. Add a regression test that every policy entry is enforced under
mixed case. Also consider rejecting non-canonical paths (trailing slash, `%2e`, duplicate slashes)
before dispatch.

---

### F-2 — HIGH — Device revocation does not terminate live SSE/WebSocket/relay streams

> **Fixed** — `ef7157b7` (D-116). See §6.

**Scenario.** A device is revoked (lost phone, compromised laptop). Its REST calls stop, but a
stream it already has open keeps delivering events.

**Evidence (reproduced).** A web device opened `GET /api/stream?scope=global&ticket=…` (200). The
admin then revoked it (`DELETE /api/auth/devices/<id>` → 204). New activity was generated
(`POST /api/projects` 201, `POST /api/chats` 201). Over the next 35 s the **revoked** device's
still-open stream received 293 bytes including `chat.created` and `chat.updated` events.

**Root cause.** Revocation (`DeviceService.revokeDevice`, `packages/auth/src/DeviceService.ts:760`)
sets `revokedAt`, revokes credentials, and enqueues a relay-revoke outbox entry — all enforced on
the **next** `authenticate()` call. Stream tickets are checked for device revocation only **at mint
time** and **at consume time** (`AuthService.authenticateStreamTicket`,
`packages/auth/src/AuthService.ts:301-306`); nothing re-checks a long-lived SSE/WS connection after
it is established. There is no server-side "close connections for device X" hook — `grep` for one
finds nothing in `apps/server/src/streaming/*` or `routes/stream.ts`. Access tokens are short
(~10 min) and scopes are read live per request, so REST self-heals; **persistent streams do not.**

**Why it is a problem.** The whole point of revoke is "cut this device off now." An attacker with a
live `global` stream keeps reading chat/run/activity lifecycle (and, with `read:chats`, content)
after revocation, bounded only by how long they keep the socket open. The audit even records
revocation as `severity: critical`, implying immediacy that the data plane does not honour. Relay
revocation is delivered to the cell's `revokedBindings` (so *new* relay streams are blocked) but an
in-flight relay-bridged stream relies on the same missing local teardown.

**Fix.** On `revokeDevice` (and `rotateCredentials`), actively close that device's live connections:
have `streamConnectionRegistry` index connections by `principal.deviceId` and expose
`closeForDevice(deviceId)`, called from the revoke path (and the relay broker's `revoke_device`).
Alternatively, periodically re-authorize each open SSE/WS (e.g. on each heartbeat) against the live
device record. A belt-and-braces option: cap stream lifetime and force periodic re-ticket.

---

### F-3 — HIGH — Pairing anti-brute-force is a single global bucket with no owner allowance → LAN DoS on pairing

> **Fixed** — `4844577a` (D-117). See §6.

**Scenario.** A server is exposed to the LAN. An attacker on the same Wi-Fi floods
`POST /api/auth/pair/preview` (a public route). The legitimate owner can no longer pair a new
device from anywhere.

**Evidence (reproduced against the LAN-exposed isolated server).** 70 bogus `/pair/preview` from
one source returned `{400:10, 429:60}` — the global bucket filled. Then a **legitimately minted**
code, previewed from a **different** source (loopback), returned `429 THROTTLED`.

**Root cause.** `DeviceService` has `perSourceThrottle = AttemptThrottle(10, 60s)` and
`globalThrottle = AttemptThrottle(60, 60s)` (`packages/auth/src/DeviceService.ts:220-221`). Both
`previewPairingGrant` and `completePairing` require passing **both** (`…:359`, `…:405`). The global
bucket is a single counter across all sources with no reservation for an authenticated/owner path
and no per-grant accounting, so any one source can exhaust it for everybody. The per-grant
5-attempt limit is separate and fine; this is specifically the global rate gate.

**Why it is a problem.** Denial of the one flow that recovers access (add a replacement device).
Combined with the fact that `/pair/preview` and `/pair/complete` are necessarily public, an
unauthenticated LAN or relay peer controls pairing availability for the whole server. OWASP
A04/A05 (improper rate-limiting granularity).

**Fix.** Rate-limit per source primarily; make the global limit a high ceiling that an owner-minted
or desktop-admin-token flow is exempt from, or shard the global bucket by source so one IP cannot
spend the whole budget. Preserve the preview-doesn't-burn-attempts property. Consider a separate,
generous budget for `/pair/complete` (which also presents a DPoP proof) vs `/pair/preview`.

---

### F-4 — MEDIUM — Packaged desktop app: permissive Electron fuses and no ASAR integrity

> **Open** — owner design decision (`utilityProcess` migration, fuses, signing). Not changed in the fix pass.

**Scenario.** Local privilege/escape hardening on the shipped macOS build.

**Evidence.** `@electron/fuses read` on
`apps/desktop/release/mac-arm64/GeneratorAI.app`:

```
RunAsNode                                  Enabled
EnableNodeOptionsEnvironmentVariable       Enabled
EnableNodeCliInspectArguments              Enabled
EnableEmbeddedAsarIntegrityValidation      Disabled
OnlyLoadAppFromAsar                        Disabled
EnableCookieEncryption                     Disabled
GrantFileProtocolExtraPrivileges           Enabled
```

Signature is `adhoc` (expected for an unsigned alpha). The app legitimately uses
`ELECTRON_RUN_AS_NODE` to launch the embedded server (`server-manager.ts:541`), so `RunAsNode`
cannot simply be flipped off without moving the server spawn to `utilityProcess.fork`.

**Why it is a problem.** With `RunAsNode` + `EnableNodeOptionsEnvironmentVariable` +
`EnableNodeCliInspectArguments`, a local attacker (or a malicious `.desktop`/LaunchAgent, or any
process that can set env for the app) can run arbitrary code in the app's context — which holds the
OS-keychain-unlocked vault KEK — via `ELECTRON_RUN_AS_NODE=1` / `NODE_OPTIONS` / `--inspect`.
`OnlyLoadAppFromAsar`/ASAR integrity off means the app bundle can be modified on disk and still
load. These are Electron's standard supply-chain/local-escalation hardening fuses. (Electron
security checklist; `@electron/fuses` guidance.)

**Fix.** Before GA: migrate the embedded-server spawn to `utilityProcess.fork` so `RunAsNode` can
be **disabled**; disable `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments`;
enable `OnlyLoadAppFromAsar` and `EnableEmbeddedAsarIntegrityValidation`; ship a real code signature
+ notarization (also required for the macOS keychain ACL to meaningfully bind the vault key to the
app). Track as a desktop-hardening task alongside the existing packaging work.

---

### F-5 — MEDIUM — Joining device self-declares `platform`; MCP forbidden-scope and person/agent rules trust it

> **Fixed** — `29c1c243` (D-118). See §6.

**Scenario.** A pairing grant is minted for `platform: mcp` (agent), but the joining client claims a
different platform at completion, defeating the "MCP devices never hold terminal/admin" rule and the
person-vs-agent trigger.

**Evidence (reproduced).** Grant minted with `platform: mcp`. The client called
`completePairing({ platform: 'cli', … })`. The stored device record became `platform: "cli"`.
The admin then granted it `exec:terminal` + `admin:settings` → `204` (succeeds, because
`assertPlatformScopes` only forbids these for `platform === 'mcp'`).

**Root cause.** `completePairing` writes `platform: params.platform ?? grant.platform`
(`packages/auth/src/DeviceService.ts:485`) — the body's platform wins over the grant's.
`scopesForbiddenFor` / `MCP_FORBIDDEN_SCOPES` (`packages/auth/src/scopes.ts:152`) and the
person-vs-agent predicate `isPersonRequest` (`routes/workflowInvocations.ts:92`) both key on the
stored platform. So an MCP integration can be re-labelled `cli`/`other` at join time and then be
(a) treated as a *person* for bypass decisions and (b) eligible for terminal/admin grants the MCP
restriction was meant to make impossible.

**Why it is a problem.** The CONVINV-R9 invariant ("an MCP device is an agent principal, so
administration and the terminal stay with people's devices") is bypassable by the joining party.
An automated agent can thereby be escalated to run shell / change settings and to be classified as a
human owner for approval-bypass ceilings.

**Fix.** Pin platform at grant time: ignore a body `platform` that conflicts with the grant's
(or only allow narrowing, never `mcp`→other). Enforce `assertPlatformScopes(grant.platform, …)` on
completion and on every later scope change against the **grant's** platform. Audit a platform
mismatch.

---

### F-6 — MEDIUM — `GET /api/security/network-access` / `server-info` reveal host and address detail pre-auth; posture read bar is low

> **Fixed** — `8cd3151e` (D-120). See §6.

**Scenario.** Information exposure on the public/low-scope surface.

**Evidence.** `/api/auth/server-info` (public) over the native lane returns `serverName`
(= machine hostname, `Siddharths-MacBook-Air.local`), every LAN endpoint, and the TLS SAN list
(all private IPs + `.local` + loopback). `/api/security/posture` is `read:status` (held by every
device) and returns `hostId`, `bindHost`, backend kind/secure flag, legacy-key status.

**Why it is a problem.** `server-info` must be public for pairing, so endpoints/fingerprint there
are acceptable by design — but the machine hostname and full interface map are handed to any
unauthenticated LAN/relay peer, aiding reconnaissance (which networks the host is on, naming). The
posture's internal-security details (secret backend security, bind host) at `read:status` is more
than a minimal read client needs. Low-to-medium.

**Fix.** Keep pairing-critical fields public; drop the raw hostname in favour of the
user-set display name only, and trim the SAN list in `server-info` to the endpoint actually being
offered. Move the sensitive posture fields (secret backend, bind host, legacy-key) behind
`admin:settings`, leaving a minimal public/`read:status` health subset.

---

### F-7 — LOW — DPoP `htu` canonicalization drops the path's trailing-slash only for root; mixed-case host not normalized

> **Fixed** — `61f30128` (D-122). See §6.

**Scenario.** Hardening of the proof-of-possession URI binding.

**Evidence.** `canonicalHtu` (`packages/auth/src/dpop.ts:266`) strips query/fragment and default
ports but does not lowercase the host or normalize path case/encoding; it relies on the server's own
`requestAbsoluteUrl` rebuilding the same string. Combined with F-1 (case-insensitive routing), a
proof signed for `/api/auth/Devices` validates against that exact string, so DPoP does **not** catch
the case-bypass (it binds whatever URI the client signed, which is the one it is attacking). This is
not a DPoP flaw per se — DPoP is working as specified (RFC 9449) — but it means DPoP provides no
defense-in-depth against F-1.

**Fix.** After fixing F-1, no change strictly needed; optionally normalize host case in
`canonicalHtu` for robustness. Noted so F-1's fix is not assumed to be partially covered by DPoP.

---

### F-8 — LOW / informational — Vault KEK is visible to any process of the same OS user

> **Open / accepted** — documented single-user threat model. Not changed in the fix pass.

**Scenario.** The embedded/headless server receives the vault KEK via `GENERATORAI_SECRET_KEY` in
its environment.

**Evidence (reproduced).** `ps eww -p <server pid>` showed `GENERATORAI_SECRET_KEY=gQSyV…` in the
child's environment.

**Why it is (only) low.** This is the documented model: "readable only by the same OS user and never
touches disk" (`server-manager.ts:11-12`, security.md §Secret storage). On macOS/Windows a
same-user process already has keychain/DPAPI access, so this does not widen the trust boundary
materially. It is called out because `/proc/<pid>/environ` (Linux) and `ps eww` expose it to any
same-user process, which is a slightly larger window than the vault file's 0600. The child-env
allowlist (`packages/shared/src/config/childEnv.ts`, `agent-harness-providers/src/childEnv.ts`)
correctly strips `GENERATORAI_SECRET_KEY` / `GENERATORAI_DESKTOP_ADMIN_TOKEN` before spawning
harness/terminal children — that part is solid.

**Fix (optional).** Prefer a pipe/fd or a short unlink-after-read handoff over an env var for the
KEK; not required for the stated single-user threat model.

---

### F-9 — LOW — CORS failures surface as 502 with a stack trace in dev; error envelope leaks internal paths in dev

> **Fixed** — `b15f649a` (D-121). See §6.

**Scenario.** A cross-origin or rebinding request is rejected by the `cors` middleware.

**Evidence (reproduced).** `POST /api/auth/pair/preview` with `Origin: http://evil.example`
returned HTTP 502 with body `{"error":{"code":"UNKNOWN_ERROR",…,"stack":"UnknownError…`. The CORS
rejection becomes a thrown error routed to the generic handler. Stack is included only when
`NODE_ENV==='development'` (`errorHandler.ts:112`), so production hides it — but the 502 status for
a *policy* decision is misleading (should be 403), and dev stacks carry absolute filesystem paths.

**Why it is a problem.** Minor info disclosure in dev; wrong status code muddies monitoring and
makes a legitimate CORS misconfig look like a server crash. The core protection (rejecting unknown
origins) works correctly.

**Fix.** Short-circuit disallowed origins to a clean `403 { code: 'ORIGIN_NOT_ALLOWED' }` instead of
throwing; never attach a stack to a client-visible body even in dev (log it with the requestId
instead).

---

## 3. What is solid (do not change without cause)

- **DPoP implementation (`packages/auth/src/dpop.ts`, `jose.ts`).** Exactly-one-proof, strict
  `typ`, asymmetric-alg allow-list (`none`/HMAC rejected, RFC 9449 §4.2), private-JWK rejection,
  canonical JWK encoding + RFC 7638 thumbprint, `htm`/`htu`/`iat`-window/`jti`-replay/`ath`/`cnf.jkt`
  all checked, ES256 signatures forced to 64-byte raw before OpenSSL, 8 KiB proof cap, nonce
  challenge that does not burn the jti. This is a careful, standards-correct implementation.
- **Token model (`TokenService`).** Access tokens short (≤15 min, DPoP-bound via `cnf.jkt`),
  Ed25519-signed with a vault-only key; resume credentials opaque + hashed at rest + rotating with a
  grace window; stream tickets single-use/30 s/scope-pinned; signed links resource-pinned,
  single-use, `exec:*`/`admin:*` forbidden, and terminal (cannot mint further credentials via
  `canMintDerivedCredentials`).
- **Scope reductions take effect live.** `authenticateDpop` reads scopes from the device record, not
  the token, and enforces `session_version` with a bounded grace window — so scope cuts and
  rotations apply without waiting for token expiry (REST only; see F-2 for the stream gap).
- **Fail-closed startup (`composition/security.ts`).** Verified: a production server with no vault
  KEK **refuses to start** (`SecretStoreError INSECURE_BACKEND`, reproduced); unauthenticated mode is
  rejected off-loopback/production; the agent permission default drops to `acceptEdits` off loopback.
- **Transport policy (D-110/111/112, reproduced on LAN).** Plain-HTTP page → 308 to `https://`;
  foreign-Origin API → 403 `HTTPS_REQUIRED`; native lane (no/own Origin) → allowed and still
  DPoP-bound; HSTS and advertised endpoints are scheme-correct; dual-protocol listener sniffs the
  TLS ClientHello byte and times out stalled handshakes/idle sockets.
- **Local CA design (`network/tls/certificates.ts`).** ECDSA P-256, critical **name constraints**
  (RFC 5280 §4.2.1.10) to RFC1918 / 127/8 / CGNAT 100.64/10 / fc00::/7 / ::1 / `.local` /
  `localhost`, `pathlen:0`, 397-day leaf, stable CA (pinned fingerprint survives leaf re-issue), key
  material vault-only. A user who trusts this CA has not trusted something that can vouch for a
  public name. BYO-cert validation (`customCertificate.ts`) checks key match, not-a-CA, validity,
  and that it names this machine, with clear errors.
- **Forwarded-header trust (D-114).** `GENERATORAI_TRUST_PROXY` gates `X-Forwarded-Proto/Host`
  strictly to the named peer (loopback or explicit IPs); default off. `isLoopbackRequest` disqualifies
  any request carrying `x-forwarded-for`/`forwarded`, so the dev Vite proxy can't be used to forge a
  local principal. Verified in code + reproduced (forged forwarded headers ignored).
- **Electron renderer hardening.** `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`,
  `webSecurity:true` on every window/view; `will-navigate` + `setWindowOpenHandler` strict
  parsed-origin check (the `http://127.0.0.1@evil.com` userinfo trick is handled); `external
  protocol` allow-list; IPC sender guard (`ipc-guard.ts`) ties every channel to the main window's top
  frame on the app origin; `certificate-error` trusts **only** loopback hostnames; permission handler
  denies by default and allows only microphone/clipboard-write for the app origin. (Fuses are the
  gap — F-4.)
- **Scoped CDP proxy (`cdp/ScopedCdpProxy.ts`).** Replaces the app-wide `--remote-debugging-port`;
  per-tab, random-token path segment (constant-time compare), rejects any WS upgrade carrying an
  `Origin`, binds `127.0.0.1`, single client. Good CSWSH/localhost-CVE-class hardening
  (cf. the Chromium `--remote-debugging-port` exposure class).
- **Widget isolation.** Separate loopback-only origin, `allow-same-origin` scoped to that isolated
  origin, same-origin-resolution refused (`sandboxViolation` fails closed), postMessage origin
  pinning in `lib/widgetBridge.ts`. Remote-unreachability is a known, accepted gap.
- **Relay confidentiality is honestly documented.** `RelayStreamBridge` dials only `127.0.0.1`,
  re-enters through the same front door (so DPoP/scope/rate-limit all still apply), and the cell
  never sees device credentials/scopes; the cell is **not** an oracle (same close code for
  offline/unknown host; invite + binding checks are constant-time / revocation-aware). The docs are
  explicit that live relay payloads are **not** E2EE today and the operator must be trusted — no
  false `e2eeFraming` promise.
- **Pairing grant hygiene.** Single-use, 10-min, 5-attempt, coalesced per device-name-hint,
  write-before-valid, DPoP-proof-of-key required at completion with a defence-in-depth re-check and
  auto-revoke on mismatch; preview never consumes and collapses all failures to one error (no
  existence oracle). Bootstrap/local-admin-token recovery paths are loopback-only, token-gated,
  0600, rotated per launch, and only ever mint *pairing* material.

---

## 4. UX of each scenario (and where it is not seamless)

- **U-1 — LAN browser cert warning (the big one).** Steps today: toggle Network exposure → LAN;
  read the fingerprint in Settings; on the other device open `https://<lan-ip>:<port>`; click
  through the browser's "Not private" warning; open cert details; compare the SHA-256 prefix; continue;
  type the 12-char code; confirm; connect. That's a lot, and the fingerprint comparison is exactly
  the step non-experts skip — which is the only thing standing between them and a MITM on first
  connect. Mitigations exist (CA download to silence the warning for good) but it's an extra, OS-specific
  trip. **Not seamless.** Better: guide the CA install first (one-time), or lean on the Tailscale-Serve
  path (publicly-trusted cert, no warning) which the docs already cover.
- **U-2 — Mobile LAN (native lane).** Seamless today (scan QR / type code, works over plain HTTP),
  but the UX hides a real risk: no confidentiality and no MITM protection during pairing (D-112). The
  user is given no signal that this hop is unencrypted. MV-44 (pin the CA) closes it; until then the
  seamlessness is slightly misleading. Consider a one-line "this network hop isn't encrypted yet"
  note on the mobile pairing screen.
- **U-3 — Desktop remote mode to a self-signed server.** The menu lets you type an address and
  connect, but connecting to another machine's built-in-HTTPS server **fails** (certificate-error
  trusts loopback only). The user gets a dead page with no clear "trust this server's certificate?"
  affordance. Known gap (lan-https.md); the suggested fix is TOFU on the CA fingerprint recorded with
  the connection. Until then remote mode effectively requires a publicly-trusted cert or a
  plain/loopback target.
- **U-4 — Revoked device.** From the owner's side, revoke looks instant. From the revoked device's
  side, an open stream keeps working (F-2) — a confusing and insecure "zombie" state.
- **U-5 — Pairing lockout (F-3).** If pairing is being flooded, the owner sees `429 THROTTLED` with
  no indication that someone else is the cause or when it clears — looks like a broken server.
- **U-6 — Lost all admin devices.** Recoverable (local-admin-token file + loopback `/internal/desktop`,
  or desktop shell auto-pair), which is good, but the recovery path is CLI/file-level and
  undocumented for a non-technical owner. The `localAdminToken` design is sound; the UX of using it
  is not surfaced.
- **U-7 — Error legibility.** CORS rejections present as 502 "UNKNOWN_ERROR" (F-9) rather than a clear
  "this origin isn't allowed," which misleads anyone debugging a connection.
- **Solid UX:** desktop window auto-pairs silently; scope-request flow (device asks, admin approves)
  is well-modelled; `HostIdentityChangedError` gives a specific "server was reinstalled — re-pair"
  message instead of an infinite retry; pairing code input and QR were fixed for small widths
  (lan-https.md).

---

## 5. Coverage notes / not fully exercised here

- **Relay end-to-end with a live client**: not runnable (client transport disabled, 409). Reviewed
  by code; cell auth/replay/revocation and the host bridge's loopback-only dial look correct.
- **Mobile native pinning (MV-44)**: open by design; no `apps/mobile` code changed and the plain-HTTP
  LAN lane's lack of confidentiality is the documented, accepted interim risk.
- **Windows/Linux desktop fuses & secret backend**: F-4 read on the macOS artifact; the Linux
  `basic_text` no-keyring path was verified to fail-closed at server start (reproduced). Per-OS
  packaging fuses should be checked on the Windows/Linux builds too.
- Probes used isolated servers only (dbPath asserted each run); the developer's real DB was never
  opened. Ports 3197/5197/8081/9898 and `mobile_redesign` were left untouched.

---

## 6. Fixed (finding → commit → verification)

Fix pass 2026-10-09 on `desktop_redesign`. Every fix landed with a regression test that fails on the
pre-fix code and passes after (checked by reverting only the fix and re-running the test), and the
audit's reproduction was re-run against an **isolated** server (bare `DB_PATH` / `ARTIFACTS_DIR` /
`WORKSPACES_DIR` / `EXTENSIONS_DIR` in a scratchpad temp dir + `GENERATORAI_BIND_HOST`; the startup
`dbPath` was asserted to be that temp DB before every probe).

| Finding | Commit | Fix | Regression tests | Before → after (isolated server) |
|---|---|---|---|---|
| F-1 critical | `28e575c2` (D-115) | Route policy matches the **canonical** path: lower-cased, unreserved escapes decoded (`%64`→`d`, `%2F` kept), one trailing slash dropped; a path with no canonical form (`.`/`..` incl. escaped, `//`, bad escape) → `DEFAULT_POLICY`, and the `/api` middleware answers 400 `NON_CANONICAL_PATH`. WS upgrades apply the same check and require handler ∪ policy scopes. Express case/strict routing left off (routers do not inherit it; policy now agrees with the router). No `scripts/check-route-scopes.mjs` exists; the policy tests are the route-scope check. | `packages/auth/src/__tests__/routePolicyCanonical.test.ts` (every `ROUTE_POLICIES` entry × UPPER / MiXeD / Capitalised / trailing slash / escaped letters / sub-resource, GET+POST+DELETE — 376 of 438 failed before), `apps/server/src/__tests__/routeCaseBypass.test.ts` (real auth middleware + real `/api/auth` router), `wsAuthCanonical.test.ts`; `agent-tests/security-e2e.mjs` §8b | MCP device: `GET /api/auth/Devices` 200 → **403**; `/Audit` 200 → 403; `POST /Pair` 201 → 403; `DELETE /Devices/:id` 204 → 403; `/workspaces/x/Terminals`, `/Computer/control`, `/Computer/frames` 200 → 403; `/auth/x/../devices`, `/auth//devices` → 400 |
| F-2 high | `ef7157b7` (D-116) | `DeviceService.onAccessChanged` (revoked / credentials-rotated / scopes-changed with removed scopes) → `streaming/liveConnections.ts` registry of every SSE (single + mux) and WS (terminal, browser, STT, TTS) by device id. Revoke/rotate close all; a scope cut closes the streams that rely on a removed scope. SSE: `access-ended` frame + destroyed socket; WS: close 4401. Relay-bridged streams end with their loopback socket; a revoke drains the relay outbox at once. | `apps/server/src/__tests__/streamRevocation.test.ts` (stream ends < 1.5 s, unsubscribed from the broker, no event after; mux; rotation; selective scope cut; WS 4401), `DeviceService.test.ts` events; security-e2e §12 | Revoked web device's open `global` stream: still open after 5 s, **239 bytes** (`chat.created`, `chat.updated`) after revoke → stream ended **22–42 ms** after revoke, **0 bytes** |
| F-3 high | `4844577a` (D-117) | Per-source budget (10/min) checked first; server ceiling 600/min counts only source-admitted attempts (≥60 sources to exhaust); a genuinely local request (`isLoopbackRequest`) has its own budget and is exempt from the ceiling (exemption by source, not by looked-up grant, so throttled guesses are never evaluated). 429 `THROTTLED` + `Retry-After`, `retryAfterSeconds`, `limit`, message "Too many pairing attempts from this network address — try again in N s." Preview still burns no attempts; per-grant 5 attempts unchanged. | `packages/auth/src/__tests__/pairingThrottle.test.ts` (70 bogus from A, legit preview+complete from B), `apps/server/src/__tests__/pairingThrottleRoute.test.ts` | LAN-exposed server, 70 bogus previews from `192.168.0.107`: `{400:10, 429:60}` with `Retry-After: 60` and the message; legit preview from another source: 429 → **200** |
| F-5 medium | `29c1c243` (D-118) | `pairedPlatform(grant, claimed)`: a `mcp` or `mobile` grant can never be completed as anything else (400 `PLATFORM_MISMATCH`, audited critical); general grants may be refined (incl. into mcp/mobile); grant scopes re-checked against the recorded platform before the grant is consumed. | `packages/auth/src/__tests__/pairingPlatform.test.ts` | mcp grant completed as `cli`: stored `cli`, then `exec:terminal`+`admin:settings` granted 204 → **400 PLATFORM_MISMATCH** (audited); mcp-paired device + terminal/admin grant → 403 `SCOPE_ESCALATION` |
| DNS rebinding (research §3.8) | `6be417e6` (D-119) | No Host validation existed. `middleware/hostAllowlist.ts` first on the app and the widget listener and in `authorizeWebSocketUpgrade`: IP literals, `localhost`/`*.localhost`, hostname / `.local` (and `<host>.<any zone>` when exposed), advertised URLs, served-certificate names, trusted proxies, `GENERATORAI_ALLOWED_HOSTS`; else 421 `HOST_NOT_ALLOWED`. Desktop window, Vite proxy, LAN HTTPS, BYO cert, Docker unaffected. Documented in the docs site (Remote access › Names the server answers to). | `apps/server/src/__tests__/hostAllowlist.test.ts`; security-e2e §8c | `Host: evil.example` → 127.0.0.1: `/api/health` 200, `/server-info` 200, `/pair/preview` 400 (evaluated), WS upgrade 401 (evaluated) → **421** everywhere; `localhost` / `127.0.0.1` unchanged |
| F-6 medium | `8cd3151e` (D-120) | `server-info`: `serverName` only when `GENERATORAI_SERVER_NAME` is set (never `os.hostname()`), `endpoints` = the endpoint the request used, `tls` = fingerprints + expiry (no names/issuer), no `legacyApiKeyAccepted`. `/security/posture` + `/network-access`: `detail:'limited'` unless `admin:settings` (no bind host, backend, legacy key, warnings, addresses, cert names, proxy trust). Types in `@generatorai/shared` (`SecurityPosture.ts`); web Settings renders the limited view; mobile logged in `docs/redesign/mobile/COORDINATION.md`. | `apps/server/src/__tests__/securityInfoExposure.test.ts`, cli-core probe test | `server-info` contained the hostname + every LAN endpoint + SAN list → hostname absent, one endpoint; web device posture: `bindHost`/`secretStore`/legacy key → `detail:"limited"`; admin still `full` |
| F-7 low | `61f30128` (D-122) | `canonicalHtu` lower-cases the host explicitly; `requestOrigin` lower-cases `Host` / trusted `X-Forwarded-Host`; native-lane own-origin compare case-insensitive. Path stays byte-exact (route case is D-115's job). | `packages/auth/src/__tests__/dpopHtu.test.ts`, `apps/server/src/__tests__/requestOriginCase.test.ts` | Mixed-case `Host` now rebuilds a lower-case `htu`; a proof for a different path case still fails `HTU_MISMATCH` |
| F-9 low | `b15f649a` (D-121) | CORS gate answers a disallowed origin itself: 403 `ORIGIN_NOT_ALLOWED` (preflight too, no CORS headers). The error handler never sends `stack` in any environment (logged with the requestId). | `apps/server/__tests__/middleware/corsRejection.test.ts`; security-e2e §8c | `Origin: http://evil.example` → 502 `UNKNOWN_ERROR` + dev stack → **403 `ORIGIN_NOT_ALLOWED`**, no stack |
| F-4, F-8 | — | Not changed (owner design decisions: fuses / `utilityProcess`, KEK hand-off). Also out of scope: MV-44 CA pinning, relay E2EE, per-install public certificates, desktop-remote TOFU. | — | — |

**Gates run (2026-10-09).** `pnpm typecheck` 51/51. `turbo lint` 27/28 — the one failure is
pre-existing in `apps/mobile/src/blocks/AssistantText/usePacedText.ts` (not touched here);
`check:security`, `check:durability`, `check:docs`, `check:tokens`, `check:workflow-invariants`,
`check:migrations-lock`, `check:db-baseline`, `check:workflow-spec`, `check:templates` pass;
`check:syncio` passes with `--max-old-space-size=8192` (OOM at the default heap, unrelated);
`check:no-legacy` (web automations/workflow hits) and `check:workflow-skill` (stale
`lifecycle.md`) fail on files this pass did not touch. Web `check:design` OK. Tests: auth 518,
secrets 16, shared 476, client-core 829, client-runtime 49, cli-core 898, core 1836 (+10 skipped),
server 797 (86 files) — all pass. E2E scripts on isolated servers: `security-e2e` 61/61,
`lan-pairing-e2e` 23/23, `short-code-pairing-e2e` 22/22, `host-pinning-e2e` 10/10,
`scope-enforcement-probe` 10/10. Full Playwright e2e on a fresh sandbox (`--port=3341
--web-port=5341`): 86 passed, 3 skipped, 4 failed on the first run; `subsystems-live` terminal was
a stale non-executable `node-pty` spawn-helper in the staged bundle (passes once executable);
`changes-dock` "Keep/Undo" and `composer` "pending-question banner" also fail on a sandbox built
from the pre-fix commit `8da675ce` (pre-existing); `activity-column` "opens from the sidebar" is
order-dependent flaky (passed on re-run). Desktop smokes one at a time:
`desktop-chrome-smoke` 59/59, `right-pane-desktop-smoke` all pass, `desktop-security-smoke` 15/15.
