# Connections: external research (state as of 2026-10-04)

Scope: how agent products implement connectors (auth, hosting, permissions, inbound events), what the SaaS vendors
actually expose, integration platforms, the MCP spec, and connector security. Every claim carries a link.
Labels: **[primary]** = vendor docs / spec / vendor blog / changelog; **[secondary]** = press, third-party blog,
aggregator; **[unverified]** = could not confirm from a primary source. Untagged links are primary.

---

## 0. Executive summary

1. **MCP is the connector substrate everywhere.** Claude, ChatGPT/Codex, Gemini CLI, Copilot Studio, Cursor, Windsurf,
   Zed, Raycast, Perplexity, Grok, Manus, Make, n8n, Dust and Hermes all speak MCP; "connectors/apps/plugins" are a
   vendor directory + OAuth broker on top of remote MCP servers (sections 1, 2).
2. **Remote, vendor-hosted MCP servers are now the norm for the big SaaS** (Slack, Notion, GitHub, Figma, Linear,
   Atlassian, Google Workspace, Microsoft Work IQ). But they are **not uniformly open to any client**: Slack requires a
   registered, directory-published or internal Slack app and no DCR; Figma allowlists clients; Google Workspace MCP is
   Developer Preview with a customer-owned OAuth client; Microsoft Work IQ needs an M365 Copilot licence and a tenant app
   registration; Atlassian allowlists callback domains. Notion, Linear and GitHub are the open ones (section 3).
3. **OAuth client ownership is the crux for a local-first app.** The 2026-07-28 MCP spec deprecates DCR in favour of
   Client ID Metadata Documents (CIMD) - an HTTPS URL as `client_id` - and binds credentials to their issuer (section 5).
   A desktop app can use CIMD with loopback redirects (Claude Code does exactly this) but needs one stable HTTPS URL to
   host the metadata JSON.
4. **Inbound events require either an outbound socket or a public URL.** Slack Socket Mode and the Discord Gateway work
   from a laptop with no public URL; Gmail (Pub/Sub pull), Graph, Notion, Figma and GitHub webhooks need a public HTTPS
   endpoint, a relay/tunnel, or polling (section 3.3). The MCP roadmap lists server-initiated events (webhooks/channels)
   as a 2026 priority, not yet spec (section 5).
5. **Security consensus:** treat all connector output as untrusted (lethal trifecta / Rule of Two), per-tool approval
   with read/write split, least-privilege scopes, OS-keychain token storage, issuer validation, audit logs. Real
   incidents in 2025-2026 hit exactly these seams (GitHub MCP toxic flow, Slack AI, AgentFlayer, mcp-remote RCE,
   postmark-mcp, Claude Desktop extension RCE, MCP Python SDK issuer bug, OpenClaw/ClawHub) (section 6).

---

## 1. Agentic coding / assistant apps

### 1.1 Anthropic (Claude)

- **One auth stack across surfaces.** "The same authentication infrastructure backs claude.ai, Claude Desktop, Claude
  mobile, Claude Code, and Cowork." Remote MCP servers authenticate via OAuth 2.0 (per user), a static credential
  (org-wide header, beta) or none. [claude.com/docs/connectors/building/authentication](https://claude.com/docs/connectors/building/authentication)
- **Auth types:** `oauth_dcr` and `oauth_cimd` supported by default; `oauth_anthropic_creds` (vendor creates a confidential
  client and Anthropic holds the secret) and `custom_connection` (customer enters client ID/secret at connect time) by
  arrangement with `mcp-review@anthropic.com`; `static_headers` beta; `none`. Claude uses CIMD only when the AS advertises
  `client_id_metadata_document_supported: true` **and** `none` in `token_endpoint_auth_methods_supported`, else falls back
  to DCR; it recommends CIMD/Anthropic-held creds for high-traffic servers because "DCR causes Claude to register a new
  client on every fresh connection". `client_credentials` (no user) is not supported. [same](https://claude.com/docs/connectors/building/authentication)
- **Redirects:** hosted apps use `https://claude.ai/api/mcp/auth_callback`; Claude Code is a native client using an
  RFC 8252 loopback redirect on an ephemeral port and publishes its own CIMD at
  `https://claude.ai/oauth/claude-code-client-metadata` declaring `http://localhost/callback` and
  `http://127.0.0.1/callback` (port-agnostic match). [same](https://claude.com/docs/connectors/building/authentication)
- **Token handling:** PKCE S256 always; appends `offline_access` if advertised; refreshes reactively on 401 and
  proactively 5 min before expiry; 10 s timeout for discovery/registration/token, 30 s for refresh; egress from
  `160.79.104.0/21`. Hosted apps hold tokens server-side (vendor custody). [same](https://claude.com/docs/connectors/building/authentication)
- **Enterprise:** "Enterprise Managed Auth" lets SSO-backed orgs connect users via an IdP-signed identity assertion
  instead of a consent screen; Owners can set per-connector, per-tool **Always allow / Needs approval / Blocked**
  org-wide, and per-role on Enterprise. [support.claude.com/en/articles/13930458](https://support.claude.com/en/articles/13930458), [support.claude.com/en/articles/11176164](https://support.claude.com/en/articles/11176164) [secondary summary of these pages via search]
- **Claude Code:** transports stdio / HTTP / SSE (deprecated) / WebSocket; scopes local, project (`.mcp.json`), user;
  `claude mcp login`, `/mcp`; "OAuth tokens are stored securely in your system keychain (macOS) or credentials file";
  pre-registered clients via `--client-id --client-secret --callback-port`; `headersHelper` for custom auth;
  `managed-mcp.json` with `allowedMcpServers`/`deniedMcpServers`; claude.ai connectors auto-available when signed in;
  project servers need approval in interactive sessions; output cap 25k tokens. [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp)
- **Desktop extensions (.mcpb):** zip of a local MCP server + `manifest.json`; sensitive `user_config` "stays in the OS
  keychain"; enterprise Group Policy (Windows) / MDM (macOS), allow/blocklist publishers, disable directory, private
  directories; auto-update. [anthropic.com/engineering/desktop-extensions](https://www.anthropic.com/engineering/desktop-extensions)
- **Claude in Slack:** a Slack Marketplace bot; "Starting August 3, 2026, Claude Tag will replace the current Claude app
  in Slack." [slack.com/help/articles/53532192117267](https://slack.com/help/articles/53532192117267-Use-Claude-in-Slack)

### 1.2 OpenAI (ChatGPT, Codex, API)

- **Naming churn:** connectors were renamed "apps" (Dec 2025); on 2026-07-09 the App Directory became the **Plugin
  Directory** - a plugin bundles skills, apps and app templates; "apps remain the integrations that connect ChatGPT or
  Codex to external data and actions"; available in ChatGPT Work and Codex. [help.openai.com/en/articles/20001256](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt-and-codex); rename date [secondary](https://www.taskade.com/blog/chatgpt-plugins)
- **Apps SDK auth (MCP OAuth 2.1):** ChatGPT supports CIMD (preferred; `none` or `private_key_jwt`), DCR (one
  `client_id` per connection) and predefined clients; redirect `https://chatgpt.com/connector_platform_oauth_redirect`
  (stable) or `https://chatgpt.com/connector/oauth/{callback_id}`; per-tool `securitySchemes` (`noauth`/`oauth2`);
  linking UI appears when tool errors carry `_meta["mcp/www_authenticate"]`. Tokens held by ChatGPT (vendor custody).
  [developers.openai.com/apps-sdk/build/auth](https://developers.openai.com/apps-sdk/build/auth)
- **Developer mode / full MCP:** Business and Enterprise/Edu; admins enable it; write actions allowed; RBAC over who may
  create custom MCP apps. [help.openai.com/en/articles/12584461](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)
- **Responses API:** remote MCP tool with `server_url`; "OAuth client registration and authorization must be handled
  separately by your application"; token passed per request in `authorization` and "not stored"; `require_approval`
  (`never`/`always`/filter) + `allowed_tools`; built-in `connector_*` ids (Gmail, Google Calendar, SharePoint, Dropbox)
  are **legacy, deprecated after 2026-09-01**. [developers.openai.com/api/docs/guides/tools-connectors-mcp](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- **Codex:** `~/.codex/config.toml` (shared by desktop, CLI, IDE); stdio + Streamable HTTP; bearer token, OAuth
  (`codex mcp login`, CIMD + DCR) or ChatGPT session auth for first-party servers; `enabled_tools`/`disabled_tools`,
  `default_tools_approval_mode` (`auto|prompt|writes|approve`), per-tool overrides; plugins can bundle MCP servers.
  [learn.chatgpt.com/docs/extend/mcp](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- **Dots (DevDay, 2026-09-29):** always-on agents with their own cloud computer/browser, run on GPT-6 Astra, connect to
  "4,000+ apps through plugins", run scheduled work, can be messaged in Slack and Microsoft Teams; permissions via
  existing ChatGPT app controls; Pro and Business Premium. [techcrunch.com](https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/), [datacamp.com](https://www.datacamp.com/blog/openai-dots) [secondary; no openai.com page fetched]

### 1.3 Google (Gemini)

- **Gemini app:** "Connected Apps" (formerly Workspace extensions) - first-party Gmail, Drive, Calendar, Keep, Tasks,
  Chat; admin toggle per service. [support.google.com/gemini/answer/15229592](https://support.google.com/gemini/answer/15229592), [Workspace Updates](https://workspaceupdates.googleblog.com/2025/05/google-workspace-apps-are-now-generally-available-for-the-gemini-app.html)
- **Gemini Enterprise:** admin-registered data connectors (Drive, OneDrive, SharePoint, Jira, Slack data store since
  2026-06-05...) and custom MCP servers as data stores; a Gemini Enterprise Slack app answers inside Slack.
  [Business edition release notes](https://support.google.com/g/answer/16719009?hl=en), [Slack app config](https://docs.cloud.google.com/gemini/enterprise/docs/configure-slack-app); MCP-as-data-store [secondary](https://blog.coupler.io/gemini-enterprise-mcp/)
- **Gemini CLI:** stdio / SSE / HTTP; automatic OAuth discovery + DCR; tokens in `~/.gemini/mcp-oauth-tokens.json`
  (plain file); `trust: true` bypasses confirmations; `includeTools`/`excludeTools`; `authProviderType:
  google_credentials` injects ADC ID tokens for Cloud Run servers. [geminicli.com/docs/tools/mcp-server](https://geminicli.com/docs/tools/mcp-server/)

### 1.4 Microsoft

- **Copilot Studio:** MCP tools + resources (no prompts); Streamable HTTP only (SSE dropped after Aug 2025); auth None /
  API key / OAuth 2.0 (Dynamic discovery = DCR, Dynamic, Manual); every MCP server is a **Power Platform connector**, so
  DLP data policies govern it. [learn.microsoft.com/.../mcp-add-existing-server-to-agent](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
- **Work IQ MCP / Agent 365 (preview):** Microsoft-hosted MCP servers for Mail, Calendar, Teams, SharePoint, OneDrive,
  Word, User, Copilot, Dataverse; clients: M365 admin center, Copilot Studio, Foundry, and coding agents (Claude Code,
  GitHub Copilot CLI, VS Code) via a tenant Entra app registration with a loopback redirect; **requires a Microsoft 365
  Copilot licence**; admins allow/block servers centrally; tool calls traced in Defender. Endpoint pattern
  `https://agent365.svc.cloud.microsoft/agents/tenants/{tenantId}/servers/mcp_MailTools`.
  [learn.microsoft.com/microsoft-agent-365/tooling-servers-overview](https://learn.microsoft.com/microsoft-agent-365/tooling-servers-overview)
- **Microsoft MCP Server for Enterprise (preview):** `https://mcp.svc.cloud.microsoft/enterprise`, read-only Entra
  directory scenarios. [learn.microsoft.com/graph/mcp-server/overview](https://learn.microsoft.com/graph/mcp-server/overview)

### 1.5 Coding IDEs and launchers

- **Cursor:** stdio / SSE / Streamable HTTP; fixed OAuth callbacks `https://www.cursor.com/agents/mcp/oauth/callback`
  (web/cloud agents) and `http://localhost:8787/callback` (desktop); `.cursor/mcp.json` / `~/.cursor/mcp.json`;
  approval by default, allowlisted tools auto-run; team admin URL/command allowlists; marketplace one-click install.
  [cursor.com/docs/context/mcp](https://cursor.com/docs/context/mcp)
- **Windsurf (docs now under Devin/Cognition):** stdio / Streamable HTTP / SSE; OAuth for remote only; config
  `~/.config/devin/mcp_config.json`; Teams/Enterprise regex allowlist - "Once you allowlist even a single MCP server, all
  non-allowlisted servers will be blocked." [docs.devin.ai/windsurf/plugins/cascade/mcp](https://docs.devin.ai/windsurf/plugins/cascade/mcp)
- **GitHub Copilot:** enterprise policy "MCP servers in Copilot"; allowlist via `managed-settings.json` (GA; matches
  name/URL/stdio command) or a custom registry URL with "Registry only" (preview, "less secure matching").
  [docs.github.com/.../mcp-management](https://docs.github.com/en/copilot/concepts/enterprise/mcp-management), [restrict-based-on-registry](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-mcp-usage/restrict-based-on-registry), [changelog 2025-11-18](https://github.blog/changelog/2025-11-18-internal-mcp-registry-and-allowlist-controls-for-vs-code-stable-in-public-preview/)
- **Zed:** `context_servers`; remote servers without an `Authorization` header trigger "the standard MCP OAuth flow";
  extensions ship MCP servers; `agent.tool_permissions` `confirm|allow|deny`, per-tool key `mcp:<server>:<tool>`.
  [zed.dev/docs/ai/mcp](https://zed.dev/docs/ai/mcp)
- **Raycast:** stdio + HTTP (HTTP only on iOS); "Dynamic OAuth" = DCR + PKCE; "Static OAuth requires credentials you
  provide (needed for services like Slack)"; "Tokens are stored encrypted, per server"; auto-approves read-only tools,
  asks for the rest. [manual.raycast.com/ai/model-context-protocol](https://manual.raycast.com/ai/model-context-protocol)
- **Perplexity:** custom remote connectors (Streamable HTTP or SSE; OAuth / API key / none; client ID+secret if no DCR);
  redirect `https://www.perplexity.ai/rest/connections/oauth_callback`; local MCP on macOS via the PerplexityXPC helper.
  [perplexity.ai/help-center/.../13915507](https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors), [11502712](https://www.perplexity.ai/help-center/en/articles/11502712-local-and-remote-mcps-for-perplexity)

### 1.6 Comparison

| Product | MCP? | Remote / local | Who hosts the server | OAuth client owner | Registration | Token custody | Per-tool approval | Admin allowlist | Directory |
|---|---|---|---|---|---|---|---|---|---|
| claude.ai / Desktop / mobile | yes | remote (+ local via .mcpb on Desktop) | SaaS vendor or user | Anthropic (DCR/CIMD) or vendor-supplied creds held by Anthropic, or customer-entered | CIMD > DCR; pre-reg | Anthropic cloud; .mcpb secrets in OS keychain | Always allow / Needs approval / Blocked (org, role) | Owners enable connectors; MDM for extensions | Connectors Directory + extension directory |
| Claude Code | yes | both | anyone | Claude Code (own CIMD), or user `--client-id` | CIMD, DCR, pre-reg | OS keychain (macOS) / creds file | permission prompts; org `ask`/`blocked` | `managed-mcp.json` allow/deny | claude.ai connectors |
| ChatGPT apps / plugins | yes | remote | SaaS vendor / dev | OpenAI (CIMD/DCR) or predefined | CIMD > DCR | OpenAI cloud | write actions gated; dev mode | workspace RBAC, dev-mode toggle | Plugin Directory |
| OpenAI Responses API | yes | remote | anyone | **the API caller** | n/a (caller does OAuth) | caller (not stored by OpenAI) | `require_approval`, `allowed_tools` | n/a | legacy `connector_*` (deprecated 2026-09-01) |
| Codex | yes | both | anyone | Codex (CIMD/DCR) | CIMD, DCR | unverified | `default_tools_approval_mode`, per-tool | enabled/disabled tools | plugins |
| Gemini CLI | yes | both | anyone | CLI (DCR) or user config | DCR, manual | `~/.gemini/mcp-oauth-tokens.json` | confirm unless `trust` | include/exclude tools | extensions |
| Copilot Studio | yes | remote | anyone / Microsoft (Work IQ) | maker (Manual) or DCR | DCR, manual | Power Platform connections | orchestration-level | DLP policies; M365 admin center | Agent 365 catalog |
| Cursor | yes | both | anyone | Cursor (fixed callbacks) | DCR etc. | unverified | approval default; allowlist auto-run | team URL/command allowlist | Marketplace, cursor.directory |
| Windsurf | yes | both | anyone | Windsurf | OAuth (remote) | unverified | n/a | regex allowlist | none official |
| GitHub Copilot | yes | both | anyone | client | DCR etc. | client | client-side | managed-settings / registry-only | GitHub MCP registry |
| Zed | yes | both | anyone | Zed | MCP OAuth | unverified | confirm/allow/deny per tool | n/a | extensions |
| Raycast | yes | both | anyone | Raycast (DCR) or user (static) | DCR, static | encrypted per server | read-only auto, rest ask | n/a | curated suggestions |
| Perplexity | yes | remote + local (macOS) | anyone | Perplexity (DCR) or user | DCR, manual | Perplexity cloud | unverified | Enterprise connector permissions | 400+ built-in |

---

## 2. Bot / assistant agents named by the owner, and agent platforms

### 2.1 Identification of the named products

| Owner's name | Closest real product (2026) | What it is | How it integrates / receives events |
|---|---|---|---|
| "Grok bot" | (a) **xAI Grok Connectors** (2026-05-06) and (b) the **@grok** account on X | (a) OAuth connectors for Google Workspace, Outlook/OneDrive/SharePoint, Notion, GitHub, Linear + "Bring Your Own MCP" (must be "reachable over the public internet"; business admins provision connectors in the console). (b) Users tag @grok in an X post and it replies in-thread. | (a) pull via connectors [x.ai/news/grok-connectors](https://x.ai/news/grok-connectors), [docs.x.ai/grok/connectors](https://docs.x.ai/grok/connectors); Teams/Salesforce/Box added mid-May [secondary](https://beginnersinai.org/grok-connectors-launch-2026/). (b) mention-triggered bot on X's own platform [techcrunch.com](https://techcrunch.com/2025/03/07/x-now-lets-you-query-grok-by-mentioning-it-in-replies) [secondary]. No Grok Slack bot found **[unverified]**. |
| "Hermes agent" | **Hermes Agent** by Nous Research (open source, self-hosted) | Long-running agent with skills learning loop, memory, cron, MCP client; one gateway for Telegram, Discord, Slack, WhatsApp, Signal, Email, SMS, Matrix, webhooks... | Slack via **Socket Mode** (bot token `xoxb-` + app token `xapp-` with `connections:write`), events `app_mention`, `message.im/channels/groups`; `SLACK_ALLOWED_USERS` deny-by-default. [hermes-agent docs](https://hermes-agent.nousresearch.com/docs), [Slack guide](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/slack) |
| "Meta Muse" | **Meta Muse** agent (launched Meta Connect, 2026-09-08) on **Muse Spark** models (Spark 1.1, 2026-07-09) | Consumer agent in the Meta AI app with Settings > Connectors (Gmail, Calendar, Outlook, Notion, Slack, Figma, Stripe, Shopify...) and per-user "Custom Connectors" Muse builds on request; no public connector list from Meta. | Pull via connectors; MCP not named by Meta. All from a third-party tracker citing Meta help pages **[secondary]** [postfa.st](https://postfa.st/blog/meta-muse-connectors-list); Muse Spark [pureai.com](https://pureai.com/articles/2026/04/09/meta-launches-muse-spark.aspx) [secondary] |
| "Dots from ChatGPT" | **OpenAI Dots** (DevDay 2026-09-29) | Always-on ChatGPT agents with own cloud computer; plugins for 4,000+ apps; scheduled work; messageable in Slack/Teams; Agent 365 integration. | Both: pull via plugins + live in Slack/Teams as a chat surface. See 1.2. [techcrunch.com](https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/) [secondary] |
| "Hyper Agent" | **Hyperagent** (Airtable team, Howie Liu; early access) | Managed cloud platform for fleets of persistent agents with skills, browser (Browserbase), code exec, connected business tools; deploy agents into Slack. | Agents in Slack + inbox monitoring (Gmail). [browserbase.com case study](https://browserbase.com/blog/case-study-hyperagent), [wavect.io review](https://wavect.io/blog/hyperagent-review-cloud-ai-agents/) [secondary]. Connector mechanism **[unverified]**. |
| "Intent agent" | Most likely **Intent by Augment Code** (announced Feb 2026, intentapp.dev, macOS public beta) | Spec-driven multi-agent coding workspace (coordinator / specialists / verifier, "living spec"). | Not a connector/bot product; integration details **[unverified]** (docs page 404). [augmentcode.com](https://www.augmentcode.com/tools/intent-vs-codex-desktop-app), [rywalker.com](https://rywalker.com/research/augment-intent) [secondary]. Name may also refer to something else. |
| (bonus) OpenClaw (ex-Clawdbot/Moltbot) | Open-source self-hosted personal agent, 147k+ stars | Gateway connecting one agent to WhatsApp, Telegram, Discord, Slack, Signal, iMessage; skills marketplace ClawHub. | Bot lives in messengers; serious security history (section 6). [CSA hardening guide](https://labs.cloudsecurityalliance.org/agentic/agentic-openclaw-hardening-guide-v1/), [pinggy.io](https://pinggy.io/blog/self_hosting_openclaw_ai_agent/) [secondary] |

### 2.2 Agent / automation platforms

| Platform | Connectors | MCP | Inbound events | Notes |
|---|---|---|---|---|
| **Lindy** | 1,000+ apps | "any MCP server" | triggers e.g. new Gmail | [lindy.ai/integrations/mcp](https://www.lindy.ai/integrations/mcp), [gmail-slack](https://www.lindy.ai/pairs/gmail-slack) |
| **n8n** | nodes | AI Agent + MCP Client Tool; MCP Server Trigger exposes workflows | Trigger nodes; self-hosted needs a public URL (ngrok/reverse proxy) | [secondary](https://uibakery.io/blog/n8n-mcp-guide) |
| **Zapier Agents / Zapier MCP** | 8,000+ apps | Zapier MCP; **1 tool call = 2 tasks** | Agents triggered by new Gmail / Slack message / Drive file | [docs.zapier.com/mcp/usage](https://docs.zapier.com/mcp/usage.md), [zapier.com/apps/agents/integrations](https://zapier.com/apps/agents/integrations) |
| **Make** | apps | official MCP server (scenarios as tools); AI Agents can call external MCP | scenario triggers | [make.com/en/blog/model-context-protocol-mcp-server](https://www.make.com/en/blog/model-context-protocol-mcp-server) |
| **Dust** | managed connections | exposes workspace as remote MCP (`dust.tt/mcp`, `eu.dust.tt/mcp`) | **@Dust bot in Slack** (admin-enabled), `@dust ~agent` | [docs.dust.tt/docs/slack](https://docs.dust.tt/docs/slack), [dust-mcp-server](https://docs.dust.tt/docs/dust-mcp-server) |
| **Relevance AI** | 1,000+ with managed OAuth, vaulting | custom MCP registration; own MCP server | triggers: webhooks, cron, Zapier, custom | [relevanceai.com/docs/integrations](https://relevanceai.com/docs/integrations), [mcp-plugins](https://relevanceai.com/docs/get-started/core-concepts/mcp-plugins) |
| **Manus** (now part of Meta) | Gmail, Notion, Stripe, HubSpot, Slack, Calendar, Drive, GitHub... as "MCP connectors" | custom MCP servers | Slack connector | [manus.im/docs/integrations/mcp-connectors](https://manus.im/docs/integrations/mcp-connectors), [blog](https://manus.im/de/blog) |

### 2.3 Two integration patterns

1. **Connector pulls data** (OAuth token + API/MCP, agent calls on demand): Claude, ChatGPT, Grok, Muse, Manus.
2. **Bot lives in the chat platform** (installed app, receives mentions/DMs as events, replies in-thread): Claude Tag,
   Dust, Gemini Enterprise for Slack, Hermes, OpenClaw, Dots (Slack/Teams), @grok on X. Slack is also becoming an MCP
   **client**: Slackbot calls third-party MCP servers; apps need the `mcp:connect` bot scope, redirect
   `https://oauth2.slack.com/external/auth/callback`, and Marketplace review; repeated tool failures trigger auto-off.
   [docs.slack.dev/ai/slackbot-mcp-client/distributing](https://docs.slack.dev/ai/slackbot-mcp-client/distributing/)

---

## 3. What the connections technically are

### 3.1 Official MCP servers of the named SaaS

| SaaS | Official MCP | Endpoint | Auth | Who may connect | Status |
|---|---|---|---|---|---|
| **Slack** | yes, Slack-hosted | `https://mcp.slack.com/mcp` | confidential OAuth with **user tokens**; client must be a registered Slack app with a hardcoded app ID; **no DCR** | "Only directory-published apps or internal apps may use MCP"; admin approval; IP allowlists apply; audit-logged | first-party since 2026-02-17 [secondary]; GA status not stated. [docs.slack.dev/ai/slack-mcp-server](https://docs.slack.dev/ai/slack-mcp-server) |
| **Google Workspace** | yes, 8 servers | `gmailmcp`, `drivemcp`, `docsmcp`, `sheetsmcp`, `slidesmcp`, `calendarmcp`, `chatmcp` `.googleapis.com/mcp/v1`, `people.googleapis.com/mcp/v1` | OAuth client **created in the customer's own Google Cloud project**; scopes e.g. `gmail.readonly`, `gmail.compose` | Antigravity, Claude (paid plans), generic Streamable HTTP clients | **Developer Preview**. [developers.google.com/workspace/guides/configure-mcp-servers](https://developers.google.com/workspace/guides/configure-mcp-servers) |
| **Microsoft 365** | yes (Work IQ, Agent 365) | `agent365.svc.cloud.microsoft/...` | Entra app registration in tenant; OBO / agent identity | M365 Copilot licence; admin allow/block | preview (Work IQ API GA 2026-06-16 [secondary](https://aiweekly.co/alerts/microsoft-work-iq-api-reaches-ga-via-a2a-and-mcp)). [tooling-servers-overview](https://learn.microsoft.com/microsoft-agent-365/tooling-servers-overview) |
| **Notion** | yes, Notion-hosted | `https://mcp.notion.com/mcp` (SSE `/sse`) | OAuth 2.1, **DCR or CIMD**, public client, PKCE mandatory; access ~8 h; refresh rotates, max 180 days, dies after 30 days idle | open to any compliant client | production. [developers.notion.com/guides/mcp/build-mcp-client](https://developers.notion.com/guides/mcp/build-mcp-client) |
| **Figma** | yes, remote + desktop | `https://mcp.figma.com/mcp` | OAuth, scope `mcp:connect` | "Only clients listed in the Figma MCP Catalog"; waitlist for new clients; desktop server bypasses (Dev/Full seat) | beta; rate limits by seat/plan. [developers.figma.com/.../rate-limits-access](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/), [forum statement](https://forum.figma.com/report-a-problem-6/figma-s-approach-breaks-the-core-promise-of-mcp-52507) |
| **GitHub** | yes, GitHub-hosted + local Docker | `https://api.githubcopilot.com/mcp/` | GitHub OAuth app or PAT bearer | any host | GA; toolsets, `--read-only`. [github.com/github/github-mcp-server](https://github.com/github/github-mcp-server) |
| **Discord** | **no official MCP** | - | community servers need a bot token, run locally | - | [secondary](https://chatforest.com/reviews/discord-mcp-servers/) |
| Linear | yes | `https://mcp.linear.app/mcp` | OAuth 2.1 + DCR, or API key bearer | open | [secondary](https://docs.litellm.ai/docs/mcp_servers/linear) |
| Atlassian (Jira/Confluence) | yes, Rovo MCP | (Atlassian-hosted) | OAuth 2.1 with DCR **for allowlisted domains**; optional API tokens | admins allow/block callback domains; IP allowlists | [support.atlassian.com](https://support.atlassian.com/security-and-access-policies/docs/control-atlassian-rovo-mcp-server-settings/) |

Takeaway: "official remote MCP" does not mean "any MCP client can connect". For a self-distributed desktop app, Notion,
Linear, GitHub and (probably) Atlassian work out of the box via CIMD/DCR; Slack needs our own Marketplace-listed or
the user's internal Slack app; Figma needs catalog admission; Google needs a customer-owned GCP OAuth client;
Microsoft needs a tenant app registration plus Copilot licence.

### 3.2 Public REST APIs + OAuth apps (the non-MCP path)

| SaaS | App registration | Desktop-friendly redirect | Notable restrictions |
|---|---|---|---|
| Slack | Slack app (api.slack.com/apps) | PKCE GA 2026-03-30: localhost/custom-scheme = "desktop redirect" ([changelog](https://docs.slack.dev/changelog/2026/03/30/pkce)) | **Desktop redirects cannot request bot scopes**; PKCE is one-way public-client; refresh tokens expire in 30 days ([using-pkce](https://docs.slack.dev/authentication/using-pkce)). Non-Marketplace commercially distributed apps: `conversations.history`/`replies` cut to **1 req/min, 15 objects** (new installs since 2025-05-29; internal customer-built apps exempt) ([changelog](https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps)) |
| Google (Gmail/Drive) | GCP project + OAuth consent screen | loopback `http://127.0.0.1:port`; custom URI schemes "no longer supported"; PKCE ([native-app](https://developers.google.com/identity/protocols/oauth2/native-app)) | Restricted scopes (Gmail read/modify) need verification + **annual security assessment** if data is accessed "from or through a third-party server"; exemptions: personal use, Testing, internal Workspace org, domain-wide install ([restricted-scope-verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)). Testing-status refresh tokens expire in **7 days**; 100 refresh tokens per account per client ([oauth2](https://developers.google.com/identity/protocols/oauth2)) |
| Microsoft Graph | Entra app registration ("Mobile and desktop applications") | `http://localhost` allowed, **port ignored**; prefer 127.0.0.1 ([reply-url](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)) | admin consent for some scopes; tenant policies |
| Notion | public connection (client ID + secret) | redirect must be registered | token exchange uses **HTTP Basic with client secret** - not a public-client flow; internal integration tokens as alternative ([authorization](https://developers.notion.com/docs/authorization)) |
| Discord | application + bot token | OAuth2 `bot` + `applications.commands` to install | MESSAGE_CONTENT is privileged; verification beyond a size threshold ([gateway](https://docs.discord.com/developers/events/gateway)) |
| GitHub | OAuth app or GitHub App | loopback `127.0.0.1` with any port; **device flow** for headless; PKCE S256 ([authorizing-oauth-apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)) | - |
| Figma | OAuth app | - | `mcp:connect` not available to general OAuth apps (see 3.1) |

### 3.3 Events / webhooks

| Source | Mechanism | Needs public HTTPS? | Verification | Renewal / limits |
|---|---|---|---|---|
| Slack Events API | HTTP POST to request URL | yes | signing secret HMAC-SHA256, 5-min timestamp window; ack in **3 s**, 3 retries; 30k events/h/workspace/app ([events-api](https://docs.slack.dev/apis/events-api/)) | - |
| **Slack Socket Mode** | outbound WebSocket using app-level token (`connections:write`) | **no** | token | up to 10 connections; connections refresh; "Apps using Socket Mode are not currently allowed in the public Slack Marketplace" ([using-socket-mode](https://docs.slack.dev/apis/events-api/using-socket-mode)) |
| Gmail | `users.watch` -> Cloud Pub/Sub topic (grant `gmail-api-push@system.gserviceaccount.com`) -> push or **pull** subscription; payload = email + `historyId`, then `users.history.list` | push: yes; **pull: no** (but needs GCP creds) | Pub/Sub auth | re-`watch` at least every 7 days (daily recommended); max 1 event/s/user ([push guide](https://developers.google.com/workspace/gmail/api/guides/push)). Chat/Meet/Drive via Workspace Events API on Pub/Sub ([events](https://developers.google.com/workspace/events)) |
| Microsoft Graph | subscriptions -> webhook / Event Hubs / Event Grid | webhook: yes ("If your endpoint isn't publicly accessible, Microsoft Graph doesn't send notifications") | `validationToken` echo within 10 s; required `clientState`; ack 3 s; retries up to 4 h; slow endpoints throttled/dropped ([webhooks](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks)) | max lifetime: Outlook mail/events ~7 days (1 day with resource data), Teams chat/channel messages 3 days, presence 1 h, drive ~30 days ([overview](https://learn.microsoft.com/en-us/graph/change-notifications-overview)); delta query as polling alternative |
| Notion | webhooks per connection | yes ("localhost endpoints don't work") | one-time `verification_token`, then `X-Notion-Signature` HMAC-SHA256; payload = IDs only; some events aggregated ([webhooks](https://developers.notion.com/reference/webhooks)) | - |
| Figma | Webhooks V2 on team / project / file | yes | `passcode` echoed in payload ([security](https://developers.figma.com/docs/rest-api/webhooks-security/)) | retries at 5 min / 30 min / 3 h; per-context limits ([webhooks](https://developers.figma.com/docs/rest-api/webhooks/)) |
| **Discord Gateway** | outbound WebSocket by bot; heartbeats; resume replays missed events | **no** | bot token | privileged intents ([gateway](https://docs.discord.com/developers/events/gateway)); HTTP Interactions endpoint alternative uses Ed25519 and needs a public URL |
| GitHub | repo/org/app webhooks | yes | `X-Hub-Signature-256` HMAC, constant-time compare ([validating](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)) | 2xx within 10 s; no automatic redelivery - redeliver manually ([best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)); `gh webhook forward` for local testing ([docs](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/using-the-github-cli-to-forward-webhooks-for-testing)) |

**Receiving events without a public URL (local-first options):**

| Option | Works for | Trade-off |
|---|---|---|
| Outbound socket (Slack Socket Mode, Discord Gateway) | Slack, Discord | Slack: user must create/own the Slack app (not Marketplace-listable); app offline = events missed (Slack retries limited) |
| Pub/Sub **pull** | Gmail, Google Workspace Events | needs a GCP project and subscriber credentials (user-owned or ours) |
| Polling / delta | Gmail `history.list`, Graph delta, Notion search, GitHub API | latency, rate limits (Slack non-Marketplace 1 req/min on history) |
| User-run tunnel | all webhook sources | Cloudflare quick tunnel (no account, testing only, no SSE, no uptime guarantee) ([guide](https://flaviocopes.com/cloudflare-quick-tunnels/) secondary); Tailscale Funnel stable HTTPS ([docs](https://tailscale.com/docs/use-cases/application-testing/share-local-dev-server-with-internet)); ngrok free static domain with interstitial and quotas ([ngrok](https://ngrok.com/blog/free-static-domains-ngrok-users)) |
| Hosted relay (ours or third-party) | all | relay terminates webhook + verifies signature, queues, desktop pulls over outbound WS/SSE; examples: smee.io (SSE proxy), Hookdeck CLI ([hookdeck.com/docs/cli](https://hookdeck.com/docs/cli)); breaks pure local-first, needs a privacy story |
| Mobile/desktop "always-on" alternative | all | hosted agent runtime (what Dots, Hyperagent, Grok do) |

---

## 4. Integration platforms / unified APIs

| Platform | Hosting | Self-host | OAuth client owner | Token custody | MCP | Pricing model | Security notes |
|---|---|---|---|---|---|---|---|
| **Composio** | cloud | none listed on pricing page | Composio-managed OAuth apps by default; bring-your-own client | Composio stores/refreshes; "self-managed credentials" option | yes (tool router, MCP) | Hobby free 100k calls + 50k triggers; Pro $29 + $0.0003/call; Enterprise | ZDR and BAA as add-ons. [composio.dev/pricing](https://composio.dev/pricing), [auth configs](https://docs.composio.dev/reference/api-reference/auth-configs); Aug-2026 quota cut reported [secondary](https://dailyaifixs.com/blog/composio-pricing-2026-the-75-tool-call-cut) |
| **Pipedream Connect** (Workday) | cloud | no | Pipedream's pre-approved clients or yours | Pipedream ("encrypted at rest", never exposed to LLM) | yes, 10k+ tools / 3k APIs | free in dev; paid prod (Connect ~$99/mo reported) | Workday acquisition announced 2025-11-19 [secondary](https://rywalker.com/research/pipedream). [pipedream.com/docs/connect](https://pipedream.com/docs/connect) |
| **Nango** | cloud | **yes** - free docker-compose (auth + proxy) and enterprise Helm; Elastic License 2.0 | yours (white-label) | Nango (your instance if self-hosted) | hosted MCP `api.nango.dev/mcp` | free / Starter $50 / Growth $500 / Enterprise | webhooks + syncs. [nango.dev self-hosting](https://www.nango.dev/docs/guides/platform/self-hosting), [pricing](https://www.nango.dev/pricing) |
| **Arcade.dev** | cloud | yes (VPC, on-prem, air-gapped, Helm - enterprise) | Arcade or yours | Arcade token broker, injected at execution | MCP runtime; authored URL-mode elicitation SEP-1036 with Anthropic | free tier + usage | SOC 2 Type 2; acquired **Smithery** 2026-08-05. [arcade.dev/blog/smithery-joins-arcade](https://arcade.dev/blog/smithery-joins-arcade), [businesswire](https://www.businesswire.com/news/home/20251125080912/en), [deployment](https://docs.arcade.dev/en/guides/deployment-hosting.md) |
| **Merge Agent Handler** | cloud (US-East); single-tenant/regional on enterprise | no | Merge | Merge | Tool Packs as MCP servers | credits; Pro from $1,000/mo | DLP scanning on tool inputs/outputs, audit logs, SOC 2. [docs.merge.dev](https://docs.merge.dev/merge-agent-handler/resources/faq) |
| **Paragon ActionKit** | cloud | on-prem (Enterprise; managed on-prem) | yours | Paragon | ActionKit tools | custom | [docs.useparagon.com/on-premise](https://docs.useparagon.com/on-premise) |
| **Zapier MCP** | cloud | no | Zapier | Zapier | yes | 2 tasks per tool call | [docs.zapier.com/mcp/usage](https://docs.zapier.com/mcp/usage.md) |
| **Klavis (Strata)** | cloud | yes, Apache-2.0 | Klavis or yours | Klavis | progressive-disclosure unified server | unverified | [secondary](https://rywalker.com/research/klavis-ai) |
| **Smithery** (Arcade) | cloud registry + hosting | no | varies | varies | 23k+ servers listed | - | [secondary](https://runtimewire.com/article/arcade-acquires-smithery-agent-tool-supply-chain) |
| **Official MCP Registry** | `registry.modelcontextprotocol.io` | codebase "not designed for self-hosting"; OpenAPI spec for sub-registries | n/a | n/a | metadata only (`server.json`) | free | **preview**; namespace auth via GitHub/DNS/HTTP; no private servers; scanning delegated to npm/PyPI/aggregators; hosts should consume aggregators. [modelcontextprotocol.io/registry/about](https://modelcontextprotocol.io/registry/about) |

Pattern: every managed platform takes **token custody** in its cloud. Only Nango (ELv2) and Klavis (Apache-2.0) offer
free self-hosting; Arcade/Paragon self-host is enterprise-only.

---

## 5. MCP specification state

| Topic | 2025-06-18 | 2025-11-25 | 2026-07-28 (current) |
|---|---|---|---|
| Auth base | OAuth 2.1, RFC 9728 PRM mandatory, RFC 8707 `resource` | + OIDC Discovery, scope in `WWW-Authenticate`, step-up `insufficient_scope` (SEP-835), **CIMD SHOULD** (SEP-991), DCR MAY | + RFC 9207 `iss` validation (MUST if present, SEP-2468), `application_type` in DCR (SEP-837), credentials keyed by issuer and never reused across AS (SEP-2352), **DCR deprecated** in favour of CIMD (PR #2858) |
| Client registration order | DCR | pre-registered > CIMD > DCR > ask user | same, DCR deprecated |
| Transport | Streamable HTTP | + SSE polling (SEP-1699), 403 on bad Origin | **stateless**: no `initialize`, no `Mcp-Session-Id`; `server/discover`; `subscriptions/listen`; `Mcp-Method`/`Mcp-Name` headers; no SSE resumability; `ttlMs`/`cacheScope` |
| Elicitation | form | + **URL mode** (SEP-1036) for third-party OAuth/credentials; `URLElicitationRequiredError` -32042 | moved under **MRTR** (`resultType: "input_required"`); `notifications/elicitation/complete` and `elicitationId` removed |
| Tasks | - | experimental (SEP-1686) | official extension `io.modelcontextprotocol/tasks` (SEP-2663) |
| Deprecated | - | - | Roots, Sampling, Logging (12-month window), HTTP+SSE |
| Extensions | - | ext-auth | `extensions` capability; MCP Apps, Tasks, Enterprise-Managed Authorization |

Sources: [2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog),
[2025-11-25 authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization),
[2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog),
[2026-07-28 release post](https://blog.modelcontextprotocol.io/posts/2026-07-28/).

Key normative points for a client (all from the 2025-11-25 authorization page unless noted):
- Clients MUST use RFC 9728 PRM for AS discovery, try both RFC 8414 and OIDC well-knowns, MUST send `resource` in
  authorization and token requests, MUST use PKCE S256 and **refuse to proceed** if `code_challenge_methods_supported`
  is absent, SHOULD validate `state`, MUST NOT send tokens to a server other than ones issued by its AS.
- CIMD: `client_id` is an HTTPS URL with a path; document must contain `client_id`, `client_name`, `redirect_uris`;
  loopback redirects are allowed, but "Client ID Metadata Documents cannot prevent `localhost` URL impersonation"; ASes
  SHOULD warn on localhost-only clients and MUST show the redirect host.
- Servers MUST validate audience and "MUST NOT pass through the token it received from the MCP client"; proxies with a
  static upstream client ID MUST obtain per-client consent (confused deputy).
- **URL-mode elicitation** is the sanctioned way for a server to obtain *third-party* OAuth: credentials "MUST NOT transit
  through the MCP client", the server stores them bound to user identity, clients MUST show the full URL, get consent,
  never pre-fetch, and open it in a context the client/LLM cannot inspect. [elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- **Security best practices**: confused deputy, token passthrough ban, SSRF in OAuth discovery (block private ranges,
  HTTPS only), session hijacking ("MUST NOT use sessions for authentication"), local server compromise (show exact
  command, sandbox), authorization URL validation (only http/https, "MUST NOT use shell commands" to open URLs), scope
  minimisation. [security_best_practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)
- **MCP Apps**: `ui://` resources referenced from tool `_meta.ui.resourceUri`, sandboxed iframes, user consent for
  UI-initiated tool calls; official extension since 2026-01-26, supported by Claude, ChatGPT, VS Code, Goose.
  [2025-11-21 post](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/), [2026-01-26 post](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
- **Auth extensions**: Enterprise-Managed Authorization (stable), Client Credentials (draft). [github.com/modelcontextprotocol/ext-auth](https://github.com/modelcontextprotocol/ext-auth)
- **Roadmap (2026-08-22)**: "server-initiated events (webhooks and channels, so clients aren't left polling)", Tasks
  maturity, DPoP / workload identity federation / token exchange, CIMD as preferred registration, progressive tool
  discovery. [blog.modelcontextprotocol.io/posts/mcp-roadmap](https://blog.modelcontextprotocol.io/posts/mcp-roadmap/)
- **Registry**: preview since 2025-09-08, API v0.1 frozen [secondary](https://pub.towardsai.net/mcp-registries-in-mid-2026-one-upstream-won-2ce541b92036); see section 4.

---

## 6. Security

### 6.1 Threat model and controls

| Threat | Mechanism | Control | Source |
|---|---|---|---|
| Lethal trifecta | private data + untrusted content + external communication in one agent | break one leg per session (Rule of Two); egress controls; no auto-rendered remote images/links | [Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/), [Meta Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/) |
| Indirect prompt injection via connector data | issue/email/doc text instructs agent | treat tool output as data; approval for writes; per-tool read/write split | [OpenAI MCP guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp), [Google Workspace MCP note](https://developers.google.com/workspace/guides/configure-mcp-servers) |
| Malicious / compromised server | hidden instructions, data theft | allowlists, registry namespace auth, pin versions, show exact command for local servers, sandbox | [MCP security BP](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices) |
| AS mix-up / credential theft | server points client at attacker AS | RFC 9207 `iss`, credentials keyed by issuer | [2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) |
| SSRF / URL injection in OAuth discovery | `javascript:`/internal URLs | scheme allowlist, no shell `open`, block private IPs | [security BP](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices) |
| Token theft at rest | config files, logs | OS keychain (Electron `safeStorage`; beware Linux `basic_text` fallback = "hardcoded plaintext password"), short-lived tokens, refresh rotation | [Electron safeStorage](https://electronjs.org/docs/latest/api/safe-storage) |
| Over-broad scopes | omnibus consent | minimal initial scopes, step-up | [security BP](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices) |
| Unaudited actions | no trail | per-call audit log (tool, args, result, approver); Defender traces in Work IQ; Slack audit logs MCP activity | [Agent 365](https://learn.microsoft.com/microsoft-agent-365/tooling-servers-overview), [Slack MCP](https://docs.slack.dev/ai/slack-mcp-server) |

Enterprise controls seen in the market: per-tool Always/Needs approval/Blocked by role (Claude), DLP over connectors
(Copilot Studio), regex or managed-settings allowlists (Windsurf, Copilot, Claude Code), central allow/block in M365
admin center, Slack app approval + IP allowlists, Atlassian domain allowlists, MDM-managed desktop extensions.

### 6.2 Published incidents and advisories

| Date | Incident | Lesson | Source |
|---|---|---|---|
| 2024-08 | Slack AI exfiltration from private channels via public-channel injection + Markdown link | rendered links are an exfil channel | [PromptArmor](https://promptarmor.com/resources/data-exfiltration-from-slack-ai-via-indirect-prompt-injection) |
| 2025-05 | GitHub MCP "toxic agent flow": malicious public issue -> agent leaks private repo data into a public PR | server code was fine; cross-repo flow is the bug; restrict per-session scope | [Invariant Labs](https://invariantlabs.ai/blog/mcp-github-vulnerability) |
| 2025-07 | CVE-2025-6514 mcp-remote (CVSS 9.6): malicious `authorization_endpoint` -> OS command injection | never pass server URLs to a shell | [JFrog](https://research.jfrog.com/vulnerabilities/mcp-remote-command-injection-rce-jfsa-2025-001290844/) |
| 2025-08 | AgentFlayer: poisoned doc makes ChatGPT search connected Drive and exfiltrate via image URL; also Copilot Studio, Cursor+Jira MCP | connectors amplify injection; block remote image rendering | [Zenity Labs](https://labs.zenity.io/p/agentflayer-chatgpt-connectors-0click-attack-5b41) |
| 2025-09 | postmark-mcp npm package BCC'd every email to attacker (first malicious MCP server in the wild) | supply chain; pin and verify publishers | [The Hacker News](https://thehackernews.com/2025/09/first-malicious-mcp-server-found.html) [secondary] |
| 2025-11 | Koi "PromptJacking": command injection in Anthropic's own Chrome/iMessage/Apple Notes desktop extensions (CVSS 8.9), unsandboxed | local extensions run with full user rights | [Koi](https://www.koi.ai/blog/promptjacking-the-critical-rce-in-claude-desktop-that-turn-questions-into-exploits) |
| 2026-01/02 | OpenClaw: 135k internet-exposed instances (gateway bound to 0.0.0.0); ClawHavoc - 341 malicious ClawHub skills (Koi), 1,467 (Snyk) | bind to loopback, authenticate the gateway, vet skills | [CSA hardening guide](https://labs.cloudsecurityalliance.org/agentic/agentic-openclaw-hardening-guide-v1/), [Antiy](https://www.antiy.net/p/clawhavoc-analysis-of-large-scale-poisoning-campaign-targeting-the-openclaw-skill-market-for-ai-agents/) [secondary] |
| 2026-09-28 | GHSA-qx49-fqc8-xw99, MCP Python SDK (CVSS 7.5): OAuth client could send secrets, codes and PKCE verifiers to an AS chosen by a malicious server (no issuer binding) | implement issuer binding (SEP-2352/2468) | [GitHub advisory](https://github.com/modelcontextprotocol/python-sdk/security/advisories/GHSA-qx49-fqc8-xw99) |

---

## 7. Implications for a local-first agent app (GeneratorAI)

1. **Be an MCP client first, a connector catalogue second.** Model "Connection" = remote MCP server (URL) or local MCP
   server (command) + an auth record + per-tool policy. Curate a catalogue of known-good remote servers (Notion, Linear,
   GitHub, Atlassian, Sentry...) on top of generic "add by URL". That matches every product in section 1.
2. **OAuth: implement the 2026-07-28 client properly.** RFC 9728 discovery, RFC 8414 + OIDC, PKCE S256 with refusal when
   unsupported, `resource` indicator, `iss` validation, credentials keyed by issuer, step-up on `insufficient_scope`,
   rotation-safe atomic refresh-token persistence (Notion retires the old token on each refresh). Registration order:
   pre-registered > **CIMD** > DCR (deprecated fallback) > user-entered client.
3. **CIMD needs one public HTTPS file, nothing more.** Host a static `client-metadata.json` (e.g. on the project
   website) listing `http://127.0.0.1/callback` and `http://localhost/callback`; the Electron app runs a loopback
   listener on an ephemeral port - exactly Claude Code's model. Show the hostname on consent; accept that loopback
   impersonation is a known CIMD limit.
4. **Plan per-vendor exceptions, not one generic path.**
   - Slack: the official MCP server needs a Marketplace-published or *internal* Slack app; PKCE desktop redirects cannot
     get bot scopes; Socket Mode apps cannot be Marketplace-listed. Practical local-first answer: "bring your own Slack
     app" (guided manifest -> user installs it into their workspace as an internal app -> bot token + app token ->
     Socket Mode for @mentions; user token for the Slack MCP server). Internal apps also avoid the 1 req/min history cap.
   - Google: Workspace MCP is preview and wants a customer-owned GCP OAuth client; shipping our own verified client for
     restricted Gmail scopes means annual assessment if data passes through our servers. Local-first (tokens never leave
     the device) plus "bring your own GCP client" is the low-friction path; note the 7-day refresh expiry in Testing mode.
   - Microsoft: user/tenant Entra app registration (localhost redirect, port ignored) for Graph; Work IQ MCP only for
     Copilot-licensed tenants.
   - Figma: remote MCP blocked unless we join the client catalogue; desktop MCP server or REST API meanwhile.
   - Discord: no official MCP; bot token + Gateway (outbound) is the model, as in Hermes/OpenClaw.
   - Notion REST OAuth needs a client secret (confidential) - prefer Notion MCP (public client, DCR/CIMD).
5. **Tokens in the OS keychain via Electron `safeStorage`**, server (Express) reads through the desktop shell; detect the
   Linux `basic_text` fallback and warn. Never put tokens in SQLite plaintext, logs or LLM context; never in URLs.
6. **Inbound events: three tiers.** (a) Outbound sockets - Slack Socket Mode, Discord Gateway - work fully local, start
   here for "@mention -> start chat/automation". (b) Polling/delta - Gmail `history.list`, Graph delta, GitHub, Notion -
   for automations tolerant of minute-level latency. (c) Webhooks via an optional relay: user-supplied tunnel
   (Tailscale Funnel / Cloudflare / ngrok) or a thin hosted relay that verifies signatures (Slack HMAC, GitHub
   `X-Hub-Signature-256`, Notion signature, Graph `clientState`/validationToken, Figma passcode) and forwards over an
   outbound WebSocket - keep it opt-in and payload-minimal (most sources send IDs only). Track subscription renewals
   (Gmail watch 7 d, Graph 1-7 d / 3 d Teams) as scheduled jobs. Watch the MCP roadmap's server-initiated events work.
7. **Permissions per tool, not per connection.** Default writes to "ask", reads to "allow", support "block"; respect
   `readOnlyHint`/`destructiveHint`; make automations inherit an explicit allowlist (no interactive approver present).
   Apply a Rule-of-Two guard: when a run has both untrusted connector input and a write/egress tool, require approval
   or strip one capability; never auto-render remote images/links from tool output.
8. **Local MCP servers = code execution.** Show the exact command, pin package versions, prefer registry entries with
   namespace verification, run in a restricted environment where possible, never open auth URLs through a shell,
   validate URL schemes, block private IPs during OAuth discovery.
9. **Audit log every tool call** (connection, tool, args hash, result size, approver, automation id) in SQLite; surface
   in the Activity UI. This is table stakes in Agent 365, Slack and Merge.
10. **Do not depend on a managed integration platform for core flows.** All of them take token custody in their cloud,
    which contradicts local-first; Nango (ELv2, self-hostable) is the only realistic optional backend if long-tail APIs
    are needed later. Zapier MCP / Composio can be offered as ordinary user-added remote MCP servers.
11. **Support MCP Apps (`ui://`) and URL-mode elicitation / MRTR** in the chat renderer: they are how 2026 servers ask
    for third-party auth and render UI; open elicitation URLs in the system browser, never in an inspectable webview.
