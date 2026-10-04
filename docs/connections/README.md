# Connections — analysis, architecture and phased plan

Status: proposal for the owner, 2026-10-04. Evidence lives in two companion files:
[`research-external.md`](research-external.md) (how other products do it, vendor rules, MCP spec, security; every claim
linked) and [`current-foundations.md`](current-foundations.md) (what GeneratorAI has today, with file paths). Section
references below (`ext §3.1`, `found §5`) point into those files.

## 1. The ask, restated

A **Connections** area in the left navigation where a user adds, authenticates and manages connections to third-party
apps (Slack, Gmail / Google Workspace, Microsoft 365, Notion, Figma, Discord, GitHub, …). A connection is usable
**anywhere** an agent runs (chats, workflow stages, automations) and can also **send events in** (a Slack message that
@mentions the agent starts a chat or an automation). It must be safe: real authentication, scoped access, approvals,
audit.

## 2. How the market does it (short answers to the two research questions)

### 2.1 Agentic apps and bots

**Everyone converged on MCP.** Claude, ChatGPT/Codex, Gemini CLI, Copilot Studio, Cursor, Windsurf, Zed, Raycast,
Perplexity, Grok, Manus, Make, n8n, Dust and Hermes all connect to third-party apps through MCP servers. "Connectors",
"apps" and "plugins" are a **vendor directory plus an OAuth layer on top of remote MCP servers** (ext §1.6, §2).

Two integration patterns exist side by side (ext §2.3):

| Pattern | What it is | Who does it |
|---|---|---|
| **Connector pulls** | The agent holds an OAuth token and calls the app's MCP server or API when it needs data or wants to act. | Claude connectors, ChatGPT apps/plugins, Codex, Grok Connectors, Meta Muse, Manus |
| **Bot lives in the app** | An installed bot receives @mentions/DMs as events and replies in-thread. | Claude in Slack (Claude Tag), Dust, Gemini Enterprise for Slack, Hermes Agent and OpenClaw (Slack Socket Mode, Discord Gateway), OpenAI Dots (Slack/Teams), @grok on X |

Your Slack example needs **both**: a bot that receives the mention (pattern 2) and connector tools for the agent while it
works (pattern 1).

The named bots, as identified (ext §2.1): "Grok bot" = xAI Grok Connectors + the @grok mention bot on X (no Slack bot
found); "Hermes agent" = Nous Research's open-source Hermes Agent (Slack via Socket Mode, deny-by-default user list);
"Meta Muse" = the Meta Muse agent (Settings › Connectors; details only from a third-party tracker); "Dots" = OpenAI Dots
(DevDay 2026-09-29; plugins + messageable in Slack/Teams); "Hyper Agent" = Hyperagent (Airtable team, early access);
"Intent agent" = most likely Augment's Intent, a coding workspace without connectors (uncertain match).

### 2.2 What a connection technically is — bundled plugin, deep integration, or open?

It is **three layers**, and only the top one is private:

1. **The app's own interface — open.** Most big SaaS now host an official remote MCP server (Slack, Notion, GitHub,
   Figma, Linear, Atlassian, Google Workspace, Microsoft Work IQ), and all of them publish REST APIs with OAuth apps
   anyone can register (ext §3.1, §3.2). Discord has no official MCP server.
2. **The OAuth client — open, but gated per vendor.** Anyone can register a client, but *which* clients may connect is
   the vendor's call (ext §3.1):
   - **Open to any compliant client:** Notion (DCR or CIMD, PKCE), Linear, GitHub.
   - **Slack:** only a registered Slack app that is Marketplace-published or internal to the workspace; no DCR. PKCE
     desktop sign-in can't get bot scopes. Socket Mode apps can't be Marketplace-listed. Non-Marketplace distributed apps
     are capped at 1 req/min on channel history; internal apps are exempt.
   - **Figma:** only clients in its MCP catalogue (waitlist).
   - **Google Workspace:** MCP servers are Developer Preview and want an OAuth client in the *customer's own* Google Cloud
     project; restricted Gmail scopes need an annual security assessment if data passes through a third-party server.
   - **Microsoft:** a tenant Entra app registration; Work IQ MCP needs an M365 Copilot licence.
3. **The directory and partnerships — private.** What feels like "deep integration" in Claude or ChatGPT is mostly the
   vendor's directory, a vendor-held OAuth client (Anthropic-held credentials, ChatGPT's redirect), catalogue admission
   (Figma) and Marketplace listing (Slack). OpenAI "plugins" (since 2026-07-09) bundle skills + apps; Claude Desktop
   `.mcpb` extensions bundle a local MCP server with a manifest (ext §1.1, §1.2).

**Conclusion:** nothing here requires a private deal. A self-distributed app can do all of it with open standards,
accepting per-vendor setup steps for Slack, Google, Microsoft and Figma.

### 2.3 Managed integration platforms

Composio, Pipedream Connect, Merge, Zapier MCP and Arcade all **hold the user's tokens in their cloud** (ext §4). That
contradicts GeneratorAI's local-first model. Only Nango (ELv2) and Klavis (Apache-2.0) self-host for free. Use them as
ordinary user-added remote MCP connections if a user wants them; don't build the core on them.

## 3. Do our foundations hold? — Yes for half, no for the other half

| Area | Verdict | Evidence |
|---|---|---|
| Secrets vault | **Strong, reuse.** AES-256-GCM per entry, OS-keystore key on desktop, refuses insecure off-loopback. | found §2 |
| MCP config + tool assembly | **Good seam, reuse.** Per-agent/stage/project/chat MCP server lists, frozen snapshot with `secretref:` pointers, `IMcpHub.resolveForRun`. | found §1, §3 |
| Approvals + mobile signed approvals | **Strong, extend.** Gates, `classifyPermissionRisk`, ES256 approval proofs. | found §4 |
| Attention / Activity feed | **Strong, extend.** Needs-you/Running, D-87/D-92/D-94. | found §4 |
| Inbound HTTP webhook | **Skeleton, extend.** Public token route, HMAC, idempotency — workflow runs only. | found §4 |
| Device auth, route policy, Electron deep links | **Strong, extend.** Fail-closed route policy, `generatorai://`. | found §5 |
| MCP itself | **Missing.** We only forward configs to the SDKs: no MCP client, health, tool list or restart. | found §0.1 |
| OAuth for third parties | **Missing.** Only GitHub device flow. No auth-code/PKCE/discovery/refresh/callback. | found §0.2, §5 |
| Tool risk for connector actions | **Unsafe today.** MCP calls are `other` → always "standard": a Slack post or Gmail send shows no Risky badge and can be approved from a phone lock screen without biometrics. | found §4 |
| Accounts / identity | **Missing.** IDs name *servers*, not *accounts*; two Slack workspaces would collide. | found §3, §9 |
| Event ingress without a public URL | **Missing.** Loopback by default; the relay carries paired clients only. | found §5 |
| Multi-user | **Out of scope.** Single-tenant; `user-session` is a placeholder. | found §5 |

So the agent/chat/workflow/automation core is the right foundation, and connector tools would slot into the existing
tool-assembly path. **Five foundational changes are required** before Connections is safe (impact in §6):

1. **An MCP gateway we own** (proxy + client) instead of forwarding raw configs.
2. **An OAuth broker and token records** with refresh, issuer binding and reauth.
3. **MCP-aware tool risk** (read vs write vs send/delete) wired into gates and signed approvals.
4. **A connection identity model** (connector × account), with grants to agents/projects/workflows/automations.
5. **An event ingress model** (event sources → triggers → chat or automation), starting with outbound sockets.

## 4. Recommended architecture

```
                 ┌──────────────────────── GeneratorAI server (local-first) ─────────────────────────┐
 Web / Desktop / │  Connections API ── OAuth broker ── Token vault (packages/secrets, connection/<id>) │
 Mobile UI  ───► │        │                 │  refresh scheduler, issuer binding, reauth asks          │
                 │        ▼                 ▼                                                          │
                 │  Connection registry (DB) ── grants (agent/project/workflow/automation) ── tool policy│
                 │        │                                                                            │
 Agent harness   │        ▼                                                                            │
 (Claude, Codex, │  MCP Gateway  /mcp/c/:connectionId  (loopback, session-bound token)                 │
 Copilot…)  ───► │   • speaks Streamable HTTP to the harness; MCP client to the upstream server         │
                 │   • injects/refreshes the upstream token, never exposes it                            │
                 │   • per-tool allow / ask / block, risk class → gates + signed approvals               │
                 │   • audit every call, health + tool inventory for the UI                              │
                 │        │                                                                            │
                 │  Event sources ── Socket Mode / Gateway / polling / webhooks ── Triggers ──► chat or   │
                 │                                                            automation (provenance)    │
                 └────────────────────────────────────────────────────────────────────────────────────┘
                          │ remote MCP (Notion, Linear, GitHub, Slack, Google, M365…)   │ local MCP (stdio)
```

### 4.1 Core concepts (packages/shared + client-core)

- **Connector** — a catalogue definition: id, name, brand icon, kind (`remote-mcp` | `local-mcp` | `native`), MCP URL
  or command, auth method (`oauth` with registration order, `api-key`, `bot-token`, `none`), default scopes, tool risk
  map, event capabilities, setup guide. Ships in a versioned catalogue; "Custom MCP server" is a connector too.
- **Connection** — one authenticated account of a connector: connector id, account label + identity (workspace, email,
  tenant), status (`connected` | `needs-reauth` | `error` | `revoked` | `disabled`, in `packages/shared/src/status`),
  scopes, token reference, created_by, last used.
- **Grant** — which agents, projects, workflows and automations may use a connection, and with which tools.
- **Tool policy** — per connection × tool: `allow` | `ask` | `block`, defaulting from MCP annotations
  (`readOnlyHint`, `destructiveHint`, `openWorldHint`) and the connector's risk map: reads allow, writes ask,
  send/post/delete ask + risky.
- **Event source → Trigger** — an inbound stream on a connection (Slack mentions, Discord messages, new Gmail, GitHub
  events) with a filter, mapped to a target: **new chat** (with agent, project, permission mode, thread binding and
  reply-back) or **automation run**.

### 4.2 Why a gateway (proxy) and not "hand the token to the SDK"

| Option | Problems |
|---|---|
| A. Put the access token in each harness's MCP config (what we do with static headers today) | Tokens expire in 1–8 h (Notion ~8 h) while sessions run longer; Claude can swap servers mid-session but **Codex can't**; Copilot/ACP/faux don't support MCP; the token lands in CLI processes and their logs; no central approval or audit; one implementation per provider. (found §9.3) |
| B. Make each harness do OAuth itself (`claude mcp login`, `codex mcp login`) | Tokens split across CLIs, no shared catalogue, no grants, no events, no mobile, no audit. |
| **C. GeneratorAI gateway (recommended)** | One MCP client we control: refreshes transparently, keeps tokens in our vault, enforces per-tool policy and risk, audits every call, normalises transports (incl. the 2026-07-28 stateless spec) for every harness, and gives the UI health and tool lists. Each harness sees a plain loopback Streamable HTTP server with a short-lived session token. |

Option C matches the spec's guidance (servers must not pass tokens through; credentials stay bound to their issuer,
ext §5). It also matches how Claude Code and Codex already keep tokens out of the model (ext §1.1, §1.2).

### 4.3 OAuth broker (the 2026-07-28 MCP client rules)

- Discovery: RFC 9728 protected-resource metadata → RFC 8414 / OIDC; `resource` indicator (RFC 8707); PKCE S256,
  refuse if unsupported; `state`; **`iss` validation and credentials keyed by issuer** (the 2026-09-28 Python SDK
  advisory is exactly this bug); step-up on `insufficient_scope`; SSRF guard (HTTPS only, block private ranges); never
  open URLs through a shell (CVE-2025-6514) (ext §5, §6).
- Registration order: pre-registered client → **CIMD** → DCR (deprecated fallback) → user-entered client ID/secret.
  CIMD needs **one static HTTPS file** we host (`client_id` = its URL) declaring loopback redirects — Claude Code's model
  (ext §1.1, §7.3).
- Redirects:
  - **Desktop:** RFC 8252 loopback listener on an ephemeral port (`http://127.0.0.1/callback`).
  - **Web on the same machine:** the server's own `/api/connections/oauth/callback`.
  - **Mobile and remote web:** system browser (ASWebAuthenticationSession / Custom Tabs), completing on the server; only a
    tokenless completion ping travels by deep link.
- Token records in the vault (`connection/<id>`): access, refresh, expiry, scopes, issuer, account identity. Proactive
  refresh 5 min before expiry and reactive on 401 (as Claude does), under a per-connection mutex, persisting rotated
  refresh tokens atomically (Notion rotates on every refresh). Failure → status `needs-reauth` + an Activity "Reconnect"
  ask.
- Device code flow where it's the better fit (GitHub, Microsoft) — reuse the GitHub device-flow pattern.

### 4.4 Permissions and prompt-injection defence

- New permission kind `mcp`, carrying connection, tool and risk class into `buildToolPermissionPayload`; gate cards show
  the connector and the action ("Post to #releases in Acme Slack"); risky actions need the signed biometric approval on
  mobile, like shell and network today.
- **Rule-of-Two guard** (ext §6.1): a run fed by untrusted inbound content (a Slack message, an email) never
  auto-approves a write or egress tool; automations get an explicit tool allowlist because nobody is there to approve;
  `bypassPermissions` stays admin-only (PD-18) and is never the default for event-triggered runs.
- No auto-rendered remote images or links from connector output (Slack AI and AgentFlayer exfiltration, ext §6.2).
- Audit: `connection.created|authorized|refreshed|reauth_needed|revoked`, `connection.tool_called` (tool, args hash,
  result size, approver, run), `inbound.received|rejected`. Also emit the `secret.*` actions that are defined but never
  emitted today (found §2).

### 4.5 Inbound events — three tiers, local-first first

| Tier | Mechanism | Sources | Public URL? |
|---|---|---|---|
| **A. Outbound sockets** | The server keeps a WebSocket open to the provider | Slack Socket Mode, Discord Gateway | No |
| **B. Polling / delta** | Scheduled jobs with cursors | Gmail `history.list`, Graph delta, GitHub, Notion, Linear | No |
| **C. Webhooks** | Provider POSTs to us | Slack Events API, GitHub, Notion, Figma, Graph, Gmail push | Yes — the user's tunnel (Tailscale Funnel, Cloudflare, ngrok) or an opt-in hosted relay |

Tier C reuses the existing webhook route's skeleton (token, HMAC, idempotency) with per-provider verification adapters:
Slack `v0=` HMAC + 5-min window + URL challenge + 3 s ack; GitHub `X-Hub-Signature-256`; Notion signature; Graph
`validationToken` + `clientState`; Figma passcode. Subscription renewals become scheduled jobs: Gmail watch every 7 days,
Graph 1–7 days, Teams 3 days (ext §3.3).

**Your Slack example, end to end:**

1. Connections › Add › Slack shows a guided setup.
2. We generate a Slack **app manifest** (bot scopes, `app_mention`, Socket Mode on). The user creates it in their
   workspace as an **internal app** — no Marketplace review, exempt from the 1 req/min history cap.
3. The user pastes the bot token and app-level token. Optionally they connect the official Slack MCP server with a user
   token from the same internal app, for richer tools.
4. The server opens Socket Mode.
5. An `app_mention` arrives and a Trigger maps it:
   - **New chat:** with the chosen agent, project and permission mode, bound to the Slack thread; replies post back to
     the thread.
   - **Automation run:** with the message as input data.
6. The gate rules from §4.4 apply, and the run shows in Activity marked "from Slack · #channel · @user".

This is exactly Hermes Agent's model (ext §2.1). A Marketplace-listed GeneratorAI Slack app would need Events API
webhooks, so tier C plus a relay — a later option, not v1.

### 4.6 Per-vendor plan

| App | v1 path | Notes |
|---|---|---|
| Notion, Linear, GitHub, Atlassian, Sentry | Official remote MCP + our OAuth (CIMD/DCR) | Works out of the box. Atlassian needs the admin to allowlist our callback domain. |
| Slack | Bring-your-own internal Slack app: Socket Mode bot + Slack MCP with user token | See the walkthrough in §4.5. |
| Discord | Bring-your-own bot: token + Gateway, native tools for read/post | No official MCP; MESSAGE_CONTENT is a privileged intent. |
| Gmail / Google Workspace | Bring-your-own Google Cloud OAuth client: Workspace MCP (preview) or REST; polling for new mail | Avoids restricted-scope verification for local use. Testing-mode refresh tokens expire after 7 days — surface that clearly. |
| Microsoft 365 | User/tenant Entra app registration (localhost redirect): Graph via device code or loopback; Work IQ MCP for Copilot-licensed tenants | Graph delta for events. |
| Figma | Desktop Figma MCP server (local) or REST with a personal token; apply for the Figma MCP catalogue | Remote MCP is catalogue-gated. |
| Anything else | "Custom MCP server" (URL or command) + generic OAuth/API key | Zapier MCP and Composio can be added this way. |

"Bring your own app/client" is the honest local-first answer for Slack, Google and Microsoft. The UI makes it a guided,
copy-paste setup with manifests and links. Once the user base justifies it, we can register verified GeneratorAI clients
(Slack Marketplace, Google verification, Microsoft publisher verification) as an upgrade path.

### 4.7 UI (needs boards first — D-36)

- **Left nav "Connections"** (new `NAV_DESTINATIONS` entry + `nav.connections` command, desktop menu, palette; mobile
  module root).
  - **Catalogue:** featured connectors + "Custom MCP server".
  - **My connections:** account, status, last used, used by.
  - **Connection detail:** account and scopes, tools with allow/ask/block, grants, event sources and triggers, recent
    activity (audit), health and reconnect, disconnect.
- **Today's Settings › MCP servers** folds into Connections. No backward compatibility: migrate the data once and delete
  the old store and screens.
- **Pickers:** agent editor, workflow stage Tools, chat composer and project customization select *connections and
  tools*, not raw servers.
- **Activity column:** "Reconnect Slack" and connection-consent asks; event-started runs show their source.
- **Mobile parity** (MD-6): the same screens via client-core queries; OAuth via the system browser.

## 5. Phase-by-phase implementation plan

Every phase is a vertical slice that ships safely on its own. Phase IDs follow the redesign convention; each phase ends
with the usual gates plus a real-user pass in the desktop app.

| Phase | Scope | Exit criteria | Size |
|---|---|---|---|
| **C0 Decisions & design** | ADRs for §4 (gateway, BYO-app model, tiers); threat model; commission Connections boards (catalogue, add flow per auth type, detail, tool policy, triggers, reauth, mobile); host the CIMD JSON on a stable HTTPS URL; confirm the Copilot `mcpServers` contradiction (found §1). | Decisions D-xx recorded, boards in `docs/redesign/boards/`, CIMD URL live | S |
| **C1 Safety first (ships even without Connections)** | MCP-aware permission kind + risk classification from tool annotations and server, gate cards, signed approvals for risky MCP actions, SSRF guard on MCP URLs, emit `secret.*` audit. | A Slack/Gmail-style write via any MCP server shows Risky and needs biometrics on mobile | S–M |
| **C2 Data model & vault** | Migration: `connections`, `connection_grants`, `connection_tool_policies`, `event_sources`, `triggers`, `inbound_events`, `connection_tool_calls`; vault namespace `connection/<id>` with structured token records; shared types/status; client-core queries; openapi. Migrate `mcp-settings.json` + project MCP rows into connections and delete the old store. | Existing MCP servers appear as connections; tests for grants/policy resolution | M |
| **C3 MCP Gateway** | Loopback `/mcp/c/:id` endpoint per connection, session-bound tokens issued at session start; MCP client to upstream (Streamable HTTP, 2026-07-28 stateless + 2025-11-25 compatible, stdio for local); `tools/list` inventory + health; policy enforcement + audit; resolver feeds gateway URLs into `resolveMcp` for every harness. | Same connection works in Claude, Codex and Copilot sessions; a token rotated mid-session doesn't break a 2 h run | L |
| **C4 OAuth broker + first catalogue** | Discovery, CIMD/DCR/pre-registered/manual, PKCE, `resource`, `iss`, step-up, refresh scheduler, reauth Activity ask; desktop loopback, web callback, mobile system-browser flow; device code. Catalogue v1: Notion, Linear, GitHub, Atlassian, Sentry + Custom MCP (URL/command, OAuth/API key/none). | Connect Notion from desktop, web and phone; agent uses it in a chat; revoke works | L |
| **C5 Connections UI** | Left-nav page (catalogue, list, detail, tools, grants, activity), pickers in agent/stage/chat/project, Activity integration, mobile screens; e2e + desktop smokes; board comparison. | Real-user pass on desktop/web/mobile matches boards | M–L |
| **C6 Events tier A + Triggers** | Trigger model (event → new chat with thread binding and reply-back, or automation run), provenance labels, Rule-of-Two guard; Slack BYO internal app (manifest generator, Socket Mode, `app_mention`, reply in thread) and Discord bot (Gateway). | @mention in a test Slack workspace starts a chat that replies in-thread; risky actions still gated | L |
| **C7 Google & Microsoft** | BYO Google Cloud client setup guide + Workspace MCP / REST tools, Gmail polling events; Entra app setup + Graph tools via device code/loopback, Graph delta events; Work IQ when licensed. | New email starts an automation; send-mail is risky + gated | L |
| **C8 Events tier B/C** | Polling framework (cursors, backoff, rate limits); webhook adapters with per-provider verification on a user-supplied public URL / tunnel; subscription renewals; dead-letter view. | GitHub/Notion webhooks via Tailscale Funnel; renewals survive restarts | M–L |
| **C9 Ecosystem & hardening** | MCP Apps (`ui://`) and URL-mode elicitation/MRTR in the chat renderer; admin policy (allow/deny connectors and tools); signed connector bundles via extensions (wire the staged `registerMcpServer`); optional hosted relay ingress (needs its own privacy review); optional Nango backend for long-tail APIs. | — | M each |

Suggested order: C0 → C1 → C2 → C3 → C4 → C5 is the first release (pull connectors, safe). C6 delivers the Slack
example. C7–C9 follow by demand. C1 is worth doing now regardless: it closes a live gap for today's MCP servers.

## 6. Impact on existing code

| Area | Change | Risk |
|---|---|---|
| `packages/db` | New migration + lock entry, baseline regen | Medium (migration lock discipline) |
| `packages/secrets` / McpCredentialVault | New namespace; keep the namespace-restricted reader invariant so workflow/provider pointers can never resolve a connection secret | High if a resolver is widened |
| `packages/core` session assembly | `resolveMcp` → gateway URLs; snapshot stores `connection:` refs so resume re-resolves | Medium |
| Providers (`agent-harness-providers`) | Map `mcp__*` to the new permission kind; verify Copilot MCP support | Medium |
| `packages/shared` | Connection types/status, `mcp` permission kind + risk, gate kinds (`connection_reauth`, `connection_consent`), nav destination, tool verbs, brand icons | Medium (shared contract — coordinate with mobile via COORDINATION.md) |
| `packages/auth` route policy | `/connections` (`admin:credentials` for writes), public `/connections/oauth/callback` (state-bound), public `/inbound/...` (verify before any side effect, rate-limited); MCP-device principals forbidden from managing connections | High — every `public:true` is reviewed |
| Automations | Trigger type `event` + chat target; webhook route generalised | Medium |
| Electron | Loopback OAuth listener; deep-link allowlist for completion pings only (never codes or tokens) | Low–medium |
| Web/mobile UI | New feature areas; MCP settings screens removed after migration | Medium |

## 7. Why this approach is the best fit (and what we rejected)

1. **MCP-first** because it is the industry substrate (ext §0.1) and the major SaaS host official servers. Every
   connector we don't have to write is maintained by the vendor.
2. **Own gateway** because it is the only option that keeps tokens out of model-facing processes, works identically
   across all our harnesses, survives token expiry in long runs, and gives one place for approvals and audit (§4.2).
3. **Local token custody + BYO apps** because GeneratorAI is local-first and single-tenant. Managed platforms take
   custody in their cloud (ext §4), and vendor-verified clients bring review costs and server-side data paths
   (ext §3.2). This is the same trade Hermes Agent, Raycast (static OAuth for Slack) and Claude Code make (ext §1.5,
   §2.1).
4. **Outbound sockets before webhooks** because they need no public URL and no relay (ext §3.3). They cover the flagship
   case (Slack/Discord mentions) without new attack surface.
5. **Safety before breadth** (C1 first) because the incident record is about connector data driving write tools
   (GitHub MCP toxic flow, Slack AI, AgentFlayer, ext §6.2), and our MCP actions are currently unclassified.

Rejected:

- Building on Composio/Pipedream/Merge — token custody in their cloud, per-call pricing.
- One native integration per app — high maintenance; duplicates vendor MCP servers.
- A hosted relay as the default for events — breaks local-first and needs a privacy and E2EE story (the relay isn't
  end-to-end encrypted today, found §5).
- Multi-user now — no user model exists; v1 is server-global with `created_by` to keep the door open.

## 8. Decisions needed from the owner

1. **CIMD host:** which stable HTTPS domain hosts `client-metadata.json` (the project website is enough)?
2. **Slack model for v1:** BYO internal Slack app + Socket Mode (recommended), versus our own Marketplace app (needs
   review and Events API webhooks, so a relay).
3. **Google:** BYO Google Cloud client for v1 (recommended), versus pursuing verification for a GeneratorAI client.
4. **Nav placement:** top-level "Connections" (your request; recommended) with Settings › MCP servers folded in.
5. **Phase order:** C1 now, then C2–C5 as the first release; C6 (the Slack @mention flow) as the second.
6. **Boards:** commission the Connections boards on the design canvas before C5 (D-36).
