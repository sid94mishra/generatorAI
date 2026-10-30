# Remote access to a user's own agent: external research

Researched 2026-10-09. Scope: how products connect clients to a user's own machine or agent on the same machine, the same
LAN, other networks and phones, and how secure each approach is. Every claim links to its source. Labels:
**[2nd]** = secondary source (blog, press, third-party analysis) where no primary source was found;
**[unverified]** = plausible but not confirmed by any source fetched; **[analysis]** = our own inference from the
cited facts.

GeneratorAI baseline used for the implications (from `docs/connections/current-foundations.md`,
`packages/relay-protocol/src/e2ee.ts`, `docs/redesign/01-decisions.md` D-110 to D-113): pairing by code/QR; non-extractable
P-256 device keys; DPoP-bound tokens; biometric-signed approval proofs; LAN HTTPS through a per-install private CA
(name-constrained, never re-issued) with the fingerprint in every pairing offer; BYO certificate; a plain-HTTP "native
lane" for the mobile app until pinning (MV-44) lands; an outbound relay that bridges raw HTTP bytes from a paired client to
`127.0.0.1:<port>`, with E2EE designed (`e2ee.ts`, X25519 + HKDF + XSalsa20-Poly1305) but **not wired**.

---

## 0. Strongest conclusions

1. **The market leaders trust their own relay.** Claude Code Remote Control sends all traffic "through the Anthropic API
   over TLS" and stores the transcript on Anthropic servers ([docs](https://code.claude.com/docs/en/remote-control)).
   Cursor runs the agent loop in its own cloud ([docs](https://cursor.com/docs/cloud-agent/mobile)). Warp uploads session
   state to its cloud ([docs](https://docs.warp.dev/agent-platform/cli-agents/remote-control/)). Zed proxies collaboration
   traffic through its servers ([FAQ](https://zed.dev/faq)). **OpenAI Codex is the exception.** It added
   "authenticated, end-to-end encrypted Noise relay channels" for remote executors
   ([release notes](https://github.com/openai/codex/releases/tag/rust-v0.141.0)) and "authenticated one-to-one QR
   pairing between each iOS or Android device and each host"
   ([changelog](https://learn.chatgpt.com/docs/changelog)). For a local-first product with no vendor model in the path,
   a blind relay is reachable and sets it apart. Without it, the relay is the weakest link.
2. **Mature "blind relay" designs tunnel the endpoint's TLS or SSH through the relay.** They do not add a new crypto
   layer. Plex Relay ([support](https://support.plex.tv/articles/216766168-accessing-a-server-through-relay/) [2nd
   summary]), Nabu Casa's SniTun ([GitHub](https://github.com/NabuCasa/snitun)), VS Code tunnels (SSH over the tunnel,
   [docs](https://code.visualstudio.com/docs/remote/tunnels)) and JetBrains Code With Me (TLS 1.3 with the host's
   certificate fingerprint in the join link,
   [docs](https://www.jetbrains.com/help/idea/2023.3/code-with-me-security-overview.html)) all work this way. GeneratorAI's
   relay already forwards raw bytes, so **native TLS pinned to the per-install CA could run end to end through it**
   [analysis]. MV-44 (mobile pinning) would then close both the LAN gap and the relay gap.
3. **Browsers are the hard case.** If the relay serves the page, it can also serve JavaScript that leaks the keys.
   WhatsApp needed a separate extension (Code Verify) to address this
   ([Meta](https://engineering.fb.com/2022/03/10/security/code-verify/)). There are two honest options. One is to
   document that browser sessions through the relay trust the relay. The other is to copy Nabu Casa: a per-install
   publicly trusted certificate, with the relay routing by SNI and never terminating TLS.
4. **No public CA will vouch for a LAN IP or `.local` name.** CA/B Forum rules forbid reserved IPs and internal names
   ([DigiCert](https://www.digicert.com/internal-names.htm)). Let's Encrypt IP certificates need http-01 or
   tls-alpn-01, not DNS-01 ([LE](https://letsencrypt.org/2025/07/01/issuing-our-first-ip-address-certificate.html)), so
   they cannot cover private addresses. The only warning-free way is **plex.direct**: a vendor domain whose names encode
   the IP, plus a per-user wildcard certificate
   ([Valsorda](https://words.filippo.io/how-plex-is-doing-https-for-all-its-users/)). Tailscale (`*.ts.net` via DNS-01,
   [docs](https://tailscale.com/kb/1153/enabling-https/)) and Nabu Casa use the same idea.
5. **A private CA is the right zero-infrastructure default, but installing it is costly.** On iOS the user installs a
   profile and then turns on "full trust" by hand ([Apple](https://support.apple.com/en-us/102390)). On Android 7+, apps
   ignore user CAs by default ([Android](https://developer.android.com/privacy-and-security/security-config)). WebAuthn
   refuses IP-address RP IDs ([W3C issue](https://lists.w3.org/Archives/Public/public-webauthn/2020Jan/0033.html)).
   Native apps should therefore **pin the CA from the QR code** and never ask the user to install it. Browsers keep the
   "compare the fingerprint, or download the CA" flow.
6. **The pinning libraries do not trust a private CA.** OkHttp `CertificatePinner` runs on top of normal trust, so a
   self-signed or private certificate must first be accepted by the TrustManager (`HandshakeCertificates`)
   ([javadoc](https://javadoc.io/static/com.squareup.okhttp3/okhttp/3.13.1/okhttp3/CertificatePinner.html) [2nd
   summary]). `react-native-ssl-public-key-pinning` sits on OkHttp and TrustKit, needs two pins on iOS, and does not
   document WebSocket coverage ([GitHub](https://github.com/frw/react-native-ssl-public-key-pinning)). MV-44 needs
   **custom trust anchors loaded at runtime** on each platform: `SecTrustSetAnchorCertificates` in a `URLSession`
   delegate on iOS ([Apple](https://developer.apple.com/documentation/foundation/performing-manual-server-trust-authentication)),
   and a custom TrustManager on Android. It must cover fetch, streaming and WebSocket. Build-time pin-sets
   (`NSPinnedDomains`, Android `<pin-set>`) cannot express a different CA for every install.
7. **Mobile OSes now gate LAN access.** iOS 14+ and macOS 15+ show a Local Network prompt for outgoing TCP to LAN
   addresses ([TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)).
   On Android 17, apps targeting SDK 37 are **blocked from the LAN by default** until they get `ACCESS_LOCAL_NETWORK`
   ([Android](https://developer.android.com/privacy-and-security/local-network-permission)). Chrome 142+ prompts before
   public pages reach local addresses, and Chrome 147 extends this to WebSockets
   ([Chrome](https://developer.chrome.com/blog/local-network-access),
   [Citrix](https://support.citrix.com/external/article/CTX696569/chrome-147-and-edge-147-local-network-ac.html)).
   A "connect anywhere" design should **default to the relay and treat a direct LAN path as an upgrade the user opts
   into**, not the other way round [analysis].
8. **Most local agent servers were broken in the same few ways.** Binding to 0.0.0.0 with no auth (Ollama, Selenium,
   ComfyUI, OpenClaw), DNS rebinding (Ollama CVE-2024-28224), CSRF or cross-site WebSocket hijacking on localhost
   (MCP Inspector CVE-2025-49596, Zoom 2019), and trusting a server URL from a link and sending it the token (OpenClaw
   CVE-2026-25253). Section 3.8 has the list. DPoP binding is a strong defence against the token-exfiltration class.

---

## 1. Agentic apps with remote or mobile control of an agent

### 1.1 Comparison

| Product | Where the agent runs | Path phone/web to agent | E2EE? What the vendor sees | Pairing / auth | Devices and revocation | Approvals on phone |
|---|---|---|---|---|---|---|
| **Claude Code Remote Control** | Your machine ([docs](https://code.claude.com/docs/en/remote-control)) | Local process makes "outbound HTTPS requests only", registers with the Anthropic API and polls; the server routes messages over a streaming connection (same) | **No.** "All traffic travels through the Anthropic API over TLS"; transcript "stored on Anthropic servers" (same) | claude.ai login; session URL or QR; "multiple short-lived credentials, each scoped to a single purpose" (same) | **Trusted Devices** (beta): per-device credential enrolled only shortly after a full sign-in; 18 h sign-in recency refreshed by Face ID / Touch ID / Windows Hello / passkey; revoke in account settings; unused credentials expire; admin "Sign out everywhere" (same) | Yes; permission prompts stay open until answered; other forwarded dialogs expire after 5 min by default (same) |
| **Claude Cowork Dispatch** | Desktop app (Cowork VM or Code workspace) ([docs](https://claude.com/docs/cowork/guide/dispatch)) | Desktop "registers as a Dispatch host"; phone app reaches it through Anthropic (same; [2nd](https://devops.com/claude-code-can-now-run-your-desktop/)) | No (Anthropic account-mediated) | Same account | Trusted Devices applies to Cowork too ([docs](https://code.claude.com/docs/en/remote-control)) | Yes; **auto-denied after 10 min** without a reply ([docs](https://claude.com/docs/cowork/guide/dispatch)) |
| **OpenAI Codex Remote** (ChatGPT mobile to Codex host) | Mac or Windows host, or SSH devbox ([docs](https://learn.chatgpt.com/docs/remote-connections)) | "A secure relay layer keeps trusted machines reachable … without exposing them directly to the public internet" (same) | **Yes for remote executors** ("authenticated, end-to-end encrypted Noise relay channels", [v0.141.0](https://github.com/openai/codex/releases/tag/rust-v0.141.0)). For mobile, third parties describe X25519 + Ed25519 transcript signatures + AES-256-GCM, with the relay seeing only session/device IDs ([2nd](https://codex.danielvaughan.com/2026/05/15/codex-mobile-chatgpt-app-relay-architecture-remote-agent-control/)) [unverified in OpenAI docs] | QR scanned on the phone; "Complete any required multi-factor authentication, SSO, or passkey steps"; **each phone paired with each host** ([docs](https://learn.chatgpt.com/docs/remote-connections), [changelog](https://learn.chatgpt.com/docs/changelog)) | Host settings list "devices that can control this Mac" (same) | Yes, "Approve commands and other actions" (same) |
| **Cursor** Remote Control / Cloud Agents | Agent loop in Cursor's cloud; tool calls on your computer (Remote Control) or in a cloud VM (Cloud Agents) ([docs](https://cursor.com/docs/cloud-agent/mobile)) | Automatic worker on your machine; cursor.com/agents on web or mobile | No: "Only tool results and the context the model needs cross to Cursor" (same) | Account + machine binding: "rejects requests for agents you don't own" (same) | Admin dashboard toggle (same) | Steering from phone (same) |
| **Warp** Remote Control | Your terminal (any CLI agent) ([docs](https://docs.warp.dev/agent-platform/cli-agents/remote-control/)) | "Warp uploads the session state to the cloud and generates a shareable link" (same) | No | Link-based; view vs edit access; "Only the publisher can revoke" (same) | Per-link | Via edit access |
| **Zed** remote dev / collaboration | Remote server over SSH; collaboration through Zed servers ([docs](https://zed.dev/docs/remote-development)) | SSH (your keys); collaboration "proxied through our servers" ([FAQ](https://zed.dev/faq)) | SSH is E2E. Collaboration: no E2EE claim; "File contents are never persisted" (same) | SSH config / Zed account | n/a | n/a |
| **GitHub Copilot coding agent** | Ephemeral GitHub Actions environment, firewall on by default ([docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment)) | GitHub web/mobile | Vendor cloud | GitHub auth | n/a | PR review |
| **Devin** | "Brain" in Cognition's cloud; Devbox in Cognition's cloud or customer VPC over PrivateLink/IPSec ([docs](https://docs.devin.ai/enterprise/deployment/overview)) | Vendor cloud | Vendor cloud | Account/SSO | n/a | Chat |
| **Jules** | Fresh Google Cloud VM per task ([Google](https://blog.google/innovation-and-ai/models-and-research/google-labs/jules/)) | Vendor cloud | Vendor cloud | Google account | n/a | Plan approval |
| **Replit Agent** | Replit cloud; mobile app ([docs](https://docs.replit.com/platforms/mobile-app)) | Vendor cloud | Vendor cloud | Replit account | n/a | In app |
| **OpenClaw** (self-hosted gateway) | Your machine ([docs](https://docs.openclaw.ai/network)) | Gateway WS default `ws://127.0.0.1:18789`; remote access by SSH tunnel or Tailscale Serve/Funnel ([docs](https://docs.openclaw.ai/gateway/tailscale)) | Depends on tunnel | Token/password/trusted-proxy; loopback auto-approved; "Tailnet and LAN clients … still require explicit pairing approval" ([docs](https://docs.openclaw.ai/network)) | Pairing approval | Via channels |
| **Hermes Agent** (Nous) | Your hardware; gateway to Telegram/Discord/Slack/Signal ([2nd](https://medium.com/@ishayvilroel/hermes-agent-what-security-teams-should-understand-before-they-run-it-e413de65fcd4)) | Messaging platforms | Platform-dependent | Platform identity | — | Approval system can be "defeatable by a single configuration flag" ([2nd](https://airq.adversa.ai/agent/hermes-agent)) |
| **Happy** (OSS mobile client for Claude Code/Codex) | Your machine ([GitHub](https://github.com/slopus/happy)) | Relay server syncing encrypted blobs over WebSockets | **Yes**, "zero-knowledge" relay; TweetNaCl ([GitHub](https://github.com/slopus/happy), [2nd](https://hn.svelte.dev/item/44904039)) | QR pairing | — | Yes |

### 1.2 Notes and incidents

- **Claude Code Remote Control is turned off for ZDR and HIPAA orgs** because transcripts are stored server-side, and
  it needs `api.anthropic.com` rather than Bedrock or a gateway
  ([docs](https://code.claude.com/docs/en/remote-control)). This shows the cost of a vendor-readable relay: regulated
  users cannot use it.
- **Trusted Devices is the clearest approvals model in the field.** It enrols a device key only right after a real
  sign-in, uses a biometric step-up (WebAuthn/passkey) to refresh recency instead of a new sign-in, and stores only "the
  device's public key and basic metadata" ([docs](https://code.claude.com/docs/en/remote-control)). GeneratorAI's
  biometric-signed approvals match this. Adding recency (step up after N hours) and idle expiry would bring it level.
- **Codex warns** "Don't expose app-server transports directly on a shared or public network" and points to VPN or mesh
  networking instead ([docs](https://learn.chatgpt.com/docs/remote-connections)). No independent audit of its relay or
  QR pairing has been published ([2nd](https://www.techtimes.com/articles/319201/20260627/openai-codex-remote-goes-live-all-plans-phone-control-now-secured-by-qr-relay.htm)).
- **OpenClaw CVE-2026-25253 (CVSS 8.8).** The Control UI "trusts `gatewayUrl` from the query string without validation
  and auto-connects on load, sending the stored gateway token", which gave one-click RCE. Fixed in 2026.1.29
  ([THN](https://thehackernews.com/2026/02/openclaw-bug-enables-one-click-remote.html),
  [GitLab advisory](https://advisories.gitlab.com/pkg/npm/clawdbot/CVE-2026-25253/)). Censys counted 21,639 exposed
  instances on 2026-01-31 ([2nd](https://insiderllm.com/guides/openclaw-security-report-january-2026/)), and
  SecurityScorecard later counted 42,900 ([2nd](https://medium.com/@patilmitesh7823/openclaw-attacks-ten-incidents-that-exposed-the-agent-attack-surface-5584c116d0bc)).
  Lessons: never accept a server address from a URL or QR and then send it stored credentials, and treat "bind beyond
  loopback" as dangerous by default.
- **Hermes Agent CVE-2026-9352.** Information disclosure in the messaging gateway handler, reachable remotely
  ([NVD](https://nvd.nist.gov/vuln/detail/CVE-2026-9352)). A chat-platform gateway is a remote command channel.

---

## 2. Remote-access and developer tools with mature designs

### 2.1 Comparison

| Tool | Topology | TLS / E2EE | Who can read traffic | Identity / pairing | Notable detail |
|---|---|---|---|---|---|
| **VS Code Remote Tunnels** | Outbound to Azure dev tunnels; no inbound ([docs](https://code.visualstudio.com/docs/remote/tunnels)) | "an SSH connection is created over the tunnel in order to provide end-to-end encryption" (same) | Not the relay (SSH inside) | Same GitHub/Microsoft account on both ends (same) | Port forwarding: TLS ends at the service with Microsoft certs, plus an anti-phishing interstitial and scoped 24 h tokens (client/host/manage) ([security](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/security)) |
| **code-server** | Self-hosted HTTP server | BYO TLS | Your network | Password (rate-limited) | "Never expose code-server directly to the internet without some form of authentication and encryption"; SSH port forwarding "highly recommended" ([guide](https://coder.com/docs/code-server/guide)) |
| **JetBrains Code With Me** | Direct or via JetBrains relay; on-prem option | "end-to-end encrypted using TLS 1.3"; **join link carries the host certificate fingerprint**; PIN check against leaked links ([docs](https://www.jetbrains.com/help/idea/2023.3/code-with-me-security-overview.html)) | JetBrains sees IPs, project name and username, not content (same) | Link + host approval + PIN | Shows the fingerprint-in-link pattern |
| **Tailscale** (WireGuard mesh) | Direct, DERP relay or peer relay | WireGuard E2E; "DERP server blindly forwards already-encrypted traffic" ([docs](https://tailscale.com/docs/reference/connection-types)) | No one (relay is blind) | Node keys distributed by the coordination server; **Tailnet Lock** requires node keys to be signed by trusted nodes so a malicious control plane cannot inject nodes ([docs](https://tailscale.com/kb/1226/tailnet-lock)) | `tailscale cert`: Let's Encrypt via DNS-01 on `*.ts.net`, "private keys are generated and stored locally"; machine names appear in CT logs ([docs](https://tailscale.com/kb/1153/enabling-https/)) |
| **Tailscale Serve / Funnel** | Serve: tailnet only. Funnel: public via Funnel relays | Funnel: TLS ends **on your device**; "Funnel relay servers do not decrypt the traffic" ([docs](https://tailscale.com/kb/1223/tailscale-funnel)) | No one | Serve injects `Tailscale-User-Login` identity headers (stripped if spoofed; backend should listen on localhost) ([docs](https://tailscale.com/docs/features/tailscale-serve)) | Funnel ports limited to 443/8443/10000 (same) |
| **Cloudflare Tunnel + Access** | `cloudflared` makes outbound-only connections ([docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)) | TLS ends at the Cloudflare edge ([SSL concepts](https://developers.cloudflare.com/ssl/concepts/)) | **Cloudflare can read it** | Access policies (IdP) | Simplest for public web apps; not E2E |
| **ngrok** | Agent outbound | Edge TLS by default; agent-side TLS termination and mTLS available | ngrok unless agent-terminated | OAuth / IP restrictions in Traffic Policy ([docs](https://ngrok.com/docs/guides/share-localhost/security)) | — |
| **Home Assistant + Nabu Casa** | HA connects out to SniTun; clients reach `*.ui.nabu.casa` | **TLS ends on the HA instance** (Let's Encrypt cert); the proxy routes by SNI over a TCP multiplexer ([SniTun](https://github.com/NabuCasa/snitun), [deep dive](https://support.nabucasa.com/hc/en-us/articles/25619268678557-Remote-UI-Deep-dive) [2nd summary]) | Nabu Casa sees SNI and metadata only | Fernet token with hostname, AES key and expiry; "SniTun server does not perform any user authentication" (HA does) ([SniTun](https://github.com/NabuCasa/snitun)) | Companion app switches internal/external URL by home SSID; "Most secure" allows plain HTTP **only on the home SSID** ([docs](https://companion.home-assistant.io/docs/getting_started/connection-security-level/)) |
| **Plex** | Direct LAN/WAN; Relay fallback (1-2 Mbps) | `*.<hash>.plex.direct` per-user wildcard cert (DigiCert); `1-2-3-4.<hash>.plex.direct` resolves to 1.2.3.4 ([Valsorda](https://words.filippo.io/how-plex-is-doing-https-for-all-its-users/)); relay is "encrypted end-to-end … not terminated on Plex's servers" ([support](https://support.plex.tv/articles/216766168-accessing-a-server-through-relay/) [2nd summary]) | Plex relay cannot | Plex account | Router DNS-rebinding protection breaks it; Plex documents `rebind-domain-ok=/plex.direct/` ([support](https://support.plex.tv/articles/206225077-how-to-use-secure-server-connections/)) |
| **Syncthing** | Direct, or public relays run by anyone | TLS; device ID = SHA-256 of the certificate ([docs](https://docs.syncthing.net/dev/device-ids.html)) | Relays see device IDs, not data ([security](https://docs.syncthing.net/users/security.html)) | Mutual device-ID allow-lists; IDs need not be secret (same) | GUI binds to localhost by default (same) |
| **Jupyter** | Local server | Optional TLS | — | Token or password; XSRF tokens; **Host-header check rejects non-local Host to stop DNS rebinding** (`allow_remote_access`) ([config](https://jupyter-notebook.readthedocs.io/en/5.7.4/config.html)) | Template for a local web server |
| **Obsidian Sync** | Vendor cloud storage | E2EE, AES-256-GCM, scrypt-derived key ([docs](https://help.obsidian.md/sync/security)) | No one | Password-derived key | — |
| **1Password** QR sign-in | Device to device via 1Password | Encrypted channel set up by the scan; "the code itself is temporary and does not contain any secrets" ([blog](https://1password.com/blog/product-update-features-and-security)) | — | QR either way + confirmation | One-time QR |
| **Bitwarden** log in with device | Push to an approved device | Public-key encrypted; **fingerprint phrase** compared on both screens; request expires in 15 min ([blog](https://bitwarden.com/blog/passwordless-authentication-access-your-bitwarden-web-vault-without-a-password/)) | — | Approve on a trusted device | Phrase match blocks relay swaps |
| **Signal** linked devices | Via Signal servers | QR = provisioning address + ephemeral Curve25519 public key; server relays an encrypted provisioning message; one-time linking token ([Signal](https://signal.org/blog/a-synchronized-start-for-linked-devices/)) | Server cannot read | Primary device scans | **Abused by malicious QR codes** from Russia-aligned actors in 2025 ([Google TI](https://cloud.google.com/blog/topics/threat-intelligence/russia-targeting-signal-messenger)) |
| **WhatsApp** multi-device | Via WhatsApp servers | Per-device identity keys; companion QR shows its identity key + a Linking Secret Key "never sent to WhatsApp server"; biometric before linking ([whitepaper](https://www.whatsapp.com/security/WhatsApp-Security-Whitepaper.pdf), [eng blog](https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/)) | Server cannot read | Primary scans companion QR | Code Verify for web JS integrity ([Meta](https://engineering.fb.com/2022/03/10/security/code-verify/)) |
| **Apple Continuity / Handoff** | BLE + iCloud/APNs | BLE pairing done out of band via APNs; per-device AES-256-GCM advertisement keys ([Apple](https://support.apple.com/guide/security/handoff-security-secf78dbe639/web)); keychain sync E2E with P-384 syncing identities ([Apple](https://support.apple.com/guide/security/secure-keychain-syncing-sec0a319b35f/web)) | Apple cannot read keychain items | Same Apple ID | Account-wide device circle |
| **KDE Connect** | LAN | TLS with self-signed certs; unknown peers accepted then "untrusted" until paired ([2nd](https://seclists.org/oss-sec/2020/q4/56)) | — | 8-character verification code from both public keys | **2025 advisory:** the static short code could be brute-forced with a matching key pair; fixed by adding a time component ([KDE](https://kde.org/info/security/advisory-20250418-3.txt)) |
| **Parsec** | P2P (UPnP/STUN) | DTLS 1.2 (AES-128); per-user certificate checked through the backend; one-time connection token after the handshake ([Parsec](https://parsec.app/security) [2nd summary]) | — | Account | — |
| **Chrome Remote Desktop** | WebRTC direct/STUN/TURN | "all remote desktop sessions are fully encrypted" ([Google](https://support.google.com/chrome/answer/1649523)) | — | Google account + PIN | — |
| **RustDesk** | Rendezvous (hbbs) + relay (hbbr), self-hostable | NaCl: Curve25519 / XSalsa20-Poly1305 / Ed25519; "relay only sees encrypted packets" ([2nd](https://wz-it.com/en/knowledge/remote-access/self-hosted-teamviewer-alternative/)) | No one | Server public key distributed to clients | — |

### 2.2 Patterns that recur

- **Outbound-only connectors** (Claude Code, Codex, dev tunnels, cloudflared, SniTun, Tailscale) avoid inbound ports,
  router setup and Internet scanning. Every mature product uses one for off-LAN access.
- **Blind relays tunnel the endpoint's own TLS or SSH** (VS Code SSH-in-tunnel, Code With Me, Plex Relay, SniTun,
  Tailscale Funnel). Only RustDesk, Happy and Codex (Noise) add an application-layer crypto layer.
- **Bind the identity at pairing time.** The link or QR carries the host key fingerprint: Code With Me, Signal and
  WhatsApp QR keys, Syncthing device IDs, Codex QR.
- **Show a human-comparable phrase when the pairing channel could be relayed** (Bitwarden fingerprint phrase,
  Code With Me PIN). Keep it long or time-varying (the KDE Connect lesson).

---

## 3. Techniques and standards

### 3.1 Publicly trusted certificates for LAN services

| Approach | Works for private IPs? | Browser warnings | Infrastructure | Caveats |
|---|---|---|---|---|
| Public CA for an IP or `.local` | **No.** Reserved IPs and internal names have been banned since 2015 ([DigiCert](https://www.digicert.com/internal-names.htm), [Sectigo](https://www.sectigo.com/knowledge-base/detail/ssl-certificates-for-internal-ip-addresses-and-internal-server-names)) | — | — | — |
| Let's Encrypt IP certificate | Public IPs only in practice; needs http-01 or tls-alpn-01, "you can't use the DNS challenge method" ([LE](https://letsencrypt.org/2025/07/01/issuing-our-first-ip-address-certificate.html)) | None | Reachable public IP | Must use the 160-hour `shortlived` profile ([LE GA](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)) |
| **Per-install subdomain + DNS-01** (plex.direct, `*.ts.net`, `*.ui.nabu.casa`) | **Yes.** The name resolves to the LAN IP; the certificate validates through public DNS ([Valsorda](https://words.filippo.io/how-plex-is-doing-https-for-all-its-users/), [Tailscale](https://tailscale.com/kb/1153/enabling-https/)) | None; WebAuthn and SubtleCrypto work because it is a real domain | Vendor DNS zone + ACME DNS-01 broker; private key stays on the device (Tailscale) | Names land in **CT logs** (same); router **DNS-rebinding protection** blocks names that resolve to private IPs ([Plex](https://support.plex.tv/articles/206225077-how-to-use-secure-server-connections/)); LE allows **50 certificates per registered domain per 7 days**, so the vendor domain must be on the PSL or get an override; ARI renewals are exempt ([LE limits](https://letsencrypt.org/docs/rate-limits/)); first issuance needs Internet |
| sslip.io / nip.io | Resolves any embedded IP ([sslip.io](https://sslip.io)) | Only with your own wildcard under a domain you control | None | **local-ip.sh publishes its wildcard private key** for download ([local-ip.sh](https://local-ip.sh/)). That suits development only and gives no security. |
| BYO (mkcert, `tailscale cert`, company CA) | Yes | Depends on the CA | User's | Power-user path (GeneratorAI D-113) |

Let's Encrypt is cutting default lifetimes "from 90 days down to 45 days over the next few years"
([LE](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)). Any ACME path needs automatic, ARI-aware
renewal.

### 3.2 Private CA, self-signed certificates and TOFU, and installation friction

- **iOS/iPadOS.** A manually installed profile's certificate "isn't automatically trusted for SSL". The user must open
  Settings > General > About > Certificate Trust Settings and enable full trust. MDM installs are trusted
  automatically ([Apple](https://support.apple.com/en-us/102390)).
- **Android.** Apps targeting API 24+ trust only system CAs. Since API 28, cleartext is off by default. Pin-sets need a
  backup pin, use SHA-256 only, and an expiry is optional ([Android](https://developer.android.com/privacy-and-security/security-config)).
  Chromium browsers on Android still honour user CAs ([2nd](https://blog.jeroenhd.nl/article/android-7-nougat-and-certificate-authorities)).
- **Desktop browsers.** Chrome "considers local trust decisions" for TCP connections, but for QUIC only for *removing*
  trust. CT enforcement applies to Chrome Root Store chains, not to locally trusted ones
  ([Chrome Root Store FAQ](https://chromium.googlesource.com/chromium/src/+/main/net/data/ssl/chrome_root_store/faq.md)).
  Firefox on Windows, macOS and Android uses third-party roots from the OS store by default
  ([Mozilla](https://support.mozilla.org/en-US/kb/setting-certificate-authorities-firefox)).
- **Name constraints on a private root** are not enforced everywhere. RFC 5280 does not require it, and Chrome on
  Linux did not enforce them on user roots ([2nd](https://alexsci.com/blog/name-non-constraint/)). Treat them as
  defence in depth, not a guarantee.
- **Pinning guidance.** Apple recommends pinning CA keys rather than leaf keys, pinning several keys, and planning a
  fallback ([Apple](https://developer.apple.com/news/?id=g9ejcf8y)). Android says to "always include a backup key"
  ([Android](https://developer.android.com/privacy-and-security/security-config)).

### 3.3 Browser rules that shape a LAN web UI

- **Secure contexts.** `https`/`wss`, `127.0.0.0/8`, `::1`, `localhost` and `*.localhost` are "potentially trustworthy"
  ([W3C](https://w3c.github.io/webappsec-secure-contexts/), [MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)).
  `http://192.168.x.x` is not.
- **WebCrypto `SubtleCrypto` is available only in secure contexts**
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)). A browser on plain-HTTP LAN cannot create the
  non-extractable P-256 device key at all. GeneratorAI's policy (D-111/D-112) that a browser never uses the plain lane
  is forced, not optional.
- **WebAuthn/passkeys need a domain RP ID.** IP addresses are not allowed; `localhost` is special-cased
  ([W3C issue #1358](https://lists.w3.org/Archives/Public/public-webauthn/2020Jan/0033.html),
  [spec](https://www.w3.org/TR/webauthn-3/)). Passkeys on a LAN web UI therefore need a hostname: a plex.direct-style
  domain, `*.ts.net`, or `<host>.local` (a valid domain string, but only in browsers that resolve mDNS) [analysis].
- **Local Network Access (LNA, which replaced PNA).** Requests that go public→local, public→loopback or local→loopback
  need permission; **"local -> local is not a local network request"**
  ([explainer](https://github.com/WICG/local-network-access/blob/main/explainer.md)). Shipping order: prompt from
  Chrome 141 and enforcement for fetch/XHR in 142 (Oct 2025) ([Chrome](https://developer.chrome.com/blog/local-network-access));
  WebSockets added in Chrome 147 ([Citrix](https://support.citrix.com/external/article/CTX696569/chrome-147-and-edge-147-local-network-ac.html)).
  Chrome lifts mixed-content blocking for permission-gated requests to private IP literals, `.local` names or
  `targetAddressSpace: "local"`. **Public names that resolve to local IPs get no such exemption**
  ([Chrome](https://developer.chrome.com/blog/local-network-access)). Consequences [analysis]:
  - a UI served by the LAN server itself (`https://192.168.1.5:port`) reaching that server is local→local, so no prompt;
  - a page served by the relay (public origin) that tries to "upgrade" to a direct LAN connection triggers the prompt
    in Chromium. Safari and Firefox block mixed content outright. Browsers on the relay should stay on the relay;
  - a LAN page touching `127.0.0.1` (for example a loopback widget origin) is local→loopback, so it prompts or is blocked.
- **0.0.0.0.** Browsers allowed pages to reach `0.0.0.0` (which hit local services) for 18 years. Chromium deprecated it
  from 128 and planned a full block by 133; WebKit and Firefox followed
  ([THN](https://thehackernews.com/2024/08/0000-day-18-year-old-browser.html)).
- **mDNS in browsers.** Chrome replaces host ICE candidates with random `UUID.local` names to hide LAN IPs
  ([discuss-webrtc](https://groups.google.com/g/discuss-webrtc/c/4Yggl6ZzqZk/m/nV24XkXXAQAJ)). It does not make
  `.local` service discovery possible for pages; browsers cannot browse Bonjour [analysis].

### 3.4 OS local-network permission (discovery and direct LAN)

| Platform | Rule | Source |
|---|---|---|
| iOS/iPadOS 14+, visionOS | Alert on the first outgoing TCP, UDP unicast or `.local` resolve; Bonjour browsing needs `NSBonjourServices` + `NSLocalNetworkUsageDescription`; multicast needs an entitlement; **background ops while undetermined are denied silently**; there is no API to check or request access; use `NWConnection`, which goes to `.waiting(localNetworkDenied)`; traffic from WKWebView/Safari is exempt | [TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy) |
| macOS 15+ | Same prompt for apps; **accepting incoming TCP needs no permission** (the Electron server is fine); launchd daemons, root and Terminal tools are exempt; requires stable code signing | same |
| Android 16 | Opt-in, under `NEARBY_WIFI_DEVICES` | [Android](https://developer.android.com/privacy-and-security/local-network-permission) |
| Android 17 (target SDK 37) | **LAN blocked by default.** `ACCESS_LOCAL_NETWORK` (NEARBY_DEVICES group) covers outgoing and incoming TCP, UDP and `.local`; the NSD picker (`FLAG_SHOW_PICKER`) avoids needing it; blocked TCP shows up as timeouts | same |

### 3.5 Device keys and token binding

- **DPoP (RFC 9449).** Each request carries a JWS signed by the client key with `htm`, `htu`, `iat`, `jti`, `ath` and an
  optional server `nonce`. Servers must reject replayed `jti`
  ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449), [2nd](https://workos.com/blog/dpop-rfc-9449-explained)). A stolen
  token is useless without the key, which neutralises the OpenClaw-style token-to-attacker URL class as long as the key
  is non-extractable [analysis].
- **WebAuthn/passkeys** as the biometric step-up: Claude Code Trusted Devices uses Face ID, Touch ID, Windows Hello or a
  passkey to refresh an 18-hour recency window ([docs](https://code.claude.com/docs/en/remote-control)).

### 3.6 Pairing: short codes, QR and PAKE

| Method | Resists an active LAN or relay MITM? | Offline brute force? | UX |
|---|---|---|---|
| Short numeric code sent as a bearer secret | No, if the attacker relays it in real time | Not offline, but online guessing is possible without rate limits | Typing |
| Short code derived from both public keys (KDE Connect) | Only if long enough; a static 8-character code was brute-forced ([KDE](https://kde.org/info/security/advisory-20250418-3.txt)) | **Yes** (key grinding) | Compare |
| **QR with host identity (key or CA fingerprint) + one-time secret** (Code With Me link, Signal/WhatsApp, Codex) | **Yes.** The identity arrives out of band ([JetBrains](https://www.jetbrains.com/help/idea/2023.3/code-with-me-security-overview.html), [Signal](https://signal.org/blog/a-synchronized-start-for-linked-devices/)) | n/a | One scan |
| **PAKE** with a short code: SPAKE2 ([RFC 9382](https://www.rfc-editor.org/rfc/rfc9382.html)), CPace (CFRG draft in IRSG review, [draft](https://datatracker.ietf.org/doc/draft-irtf-cfrg-cpace/)), OPAQUE (aPAKE for client/server passwords, [RFC 9807](https://www.rfc-editor.org/rfc/rfc9807.html)) | **Yes.** One online guess per run, no offline dictionary attack (same) | No | Typing a short code |
| Fingerprint phrase compared by a human (Bitwarden) | Yes if the user compares | — | Glance ([Bitwarden](https://bitwarden.com/blog/passwordless-authentication-access-your-bitwarden-web-vault-without-a-password/)) |

Phishing risk is real even when the cryptography is sound: attackers used malicious linking QR codes against Signal
([Google TI](https://cloud.google.com/blog/topics/threat-intelligence/russia-targeting-signal-messenger)). Mitigations
are an approval on the host that names the new device, and a "new device paired" notice on every existing device
[analysis].

### 3.7 E2EE through a relay

- **Noise Protocol Framework** ([spec](http://www.noiseprotocol.org/noise.html)). WireGuard uses
  `Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s` ([WireGuard](https://www.wireguard.com/protocol/)). IK fits "client already
  knows the host static key from the QR". XX fits mutual discovery. Codex uses Noise for relay channels
  ([v0.141.0](https://github.com/openai/codex/releases/tag/rust-v0.141.0)).
- **TLS through the relay.** The relay forwards opaque bytes and the endpoint terminates TLS: Plex, SniTun, Tailscale
  Funnel, Code With Me ([SniTun](https://github.com/NabuCasa/snitun),
  [Funnel](https://tailscale.com/kb/1223/tailscale-funnel),
  [JetBrains](https://www.jetbrains.com/help/idea/2023.3/code-with-me-security-overview.html)). It reuses the existing
  certificate and pinning, adds no new crypto, and the relay sees only SNI and timing.
- **MLS** ([RFC 9420](https://www.rfc-editor.org/rfc/rfc9420)) gives group keys with forward secrecy and post-compromise
  security. It is overkill for one host and N devices; pairwise channels are enough [analysis].
- **What the relay still sees:** connection metadata such as device IDs, session IDs and timing (Syncthing relays,
  [docs](https://docs.syncthing.net/users/security.html); Codex relay [2nd](https://codex.danielvaughan.com/2026/05/15/codex-mobile-chatgpt-app-relay-architecture-remote-agent-control/)).
- **Browser caveat.** Crypto in JavaScript served by the party you want to exclude does not exclude it. WhatsApp ships a
  separate extension to verify its web bundle ([Meta](https://engineering.fb.com/2022/03/10/security/code-verify/)).

### 3.8 Local web server incidents and the defences they teach

| Incident | Root cause | Defence |
|---|---|---|
| Zoom CVE-2019-13450 | Any website could drive the localhost:19421 web server and join calls with the camera on ([THN](https://thehackernews.com/2019/07/zoom-video-conferencing-hacking.html)) | No unauthenticated localhost control API; Origin checks |
| Ollama CVE-2024-28224 | DNS rebinding reached the API in as little as 3 s ([NCC](https://www.nccgroup.com/research/technical-advisory-ollama-dns-rebinding-attack-cve-2024-28224/)) | **Host-header allow-list** (Jupyter's model, [config](https://jupyter-notebook.readthedocs.io/en/5.7.4/config.html)) |
| Ollama CVE-2024-37032 "Probllama" | Path traversal to RCE; Docker image listens on 0.0.0.0 with no auth; over 1,000 exposed ([Wiz](https://www.wiz.io/blog/probllama-ollama-vulnerability-cve-2024-37032)) | Loopback default; auth on every non-loopback bind |
| Selenium Grid "SeleniumGreed" | No auth by default; exposed grids used for cryptomining ([Wiz](https://www.wiz.io/blog/seleniumgreed-cryptomining-exploit-attack-flow-remediation-steps)) | Same |
| ComfyUI (2026) | Over 1,000 unauthenticated instances; RCE through custom nodes; mining botnet ([THN](https://thehackernews.com/2026/04/over-1000-exposed-comfyui-instances.html)) | Same |
| Open WebUI CVE-2025-64496 / -46719 | Malicious "Direct Connections" server, then account takeover and RCE; stored XSS stealing tokens ([Cato](https://www.catonetworks.com/blog/cato-ctrl-vulnerability-discovered-open-webui-cve-2025-64496)) | Never trust server-supplied script; tokens not reachable from JS (DPoP + non-extractable keys) |
| MCP Inspector CVE-2025-49596 (CVSS 9.4) | Unauthenticated localhost proxy; CSRF + 0.0.0.0 Day or DNS rebinding gave RCE from any webpage ([Recorded Future](https://www.recordedfuture.com/blog/anthropic-mcp-inspector-cve-2025-49596)) | Auth token + Origin + Host checks even on loopback |
| OpenClaw CVE-2026-25253 | UI auto-connected to a `gatewayUrl` from the URL and sent the token ([THN](https://thehackernews.com/2026/02/openclaw-bug-enables-one-click-remote.html)) | Never send credentials to an address learned from a link; per-server keys |
| Cross-site WebSocket hijacking (class) | WebSockets ignore CORS; the handshake is a CSRF target ([PortSwigger](https://portswigger.net/web-security/websockets)) | Check `Origin` on upgrade (GeneratorAI `wsAuth.ts` already keeps an allow-list) |

### 3.9 React Native and native TLS pinning

| Option | Model | Private or self-signed CA? | Coverage |
|---|---|---|---|
| Android Network Security Config `<pin-set>` / `<trust-anchors>` | Build-time XML; backup pin advised ([Android](https://developer.android.com/privacy-and-security/security-config)) | Only for a CA known at build time | All app HTTP stacks that honour NSC |
| iOS `NSPinnedDomains` (CA or leaf SPKI) | Build-time `Info.plist`; "can only tighten" trust ([Apple](https://developer.apple.com/news/?id=g9ejcf8y)) | **No** (tightens system trust) | URLSession |
| iOS `URLSession` delegate + `SecTrustSetAnchorCertificates` | Runtime ([Apple](https://developer.apple.com/documentation/foundation/performing-manual-server-trust-authentication)) | **Yes** | Whatever uses that session |
| OkHttp `HandshakeCertificates.addTrustedCertificate` + `CertificatePinner` | Runtime; the pinner alone cannot accept a cert the TrustManager rejects ([javadoc](https://javadoc.io/static/com.squareup.okhttp3/okhttp/3.13.1/okhttp3/CertificatePinner.html) [2nd summary]) | **Yes** with HandshakeCertificates | OkHttp (RN fetch and WebSocket on Android use OkHttp [unverified for current RN]) |
| `react-native-ssl-public-key-pinning` | JS `initializeSslPinning()` at runtime; OkHttp + TrustKit; at least 2 pins on iOS ([GitHub](https://github.com/frw/react-native-ssl-public-key-pinning)) | Not documented; pins on top of system trust | Standard networking APIs; WebSocket not documented |
| `react-native-ssl-pinning` | Its own `fetch` with bundled certificates or key pins ([GitHub](https://github.com/MaxToyberman/react-native-ssl-pinning)) | Possible with a bundled cert, not per-install | Its fetch only; no WebSocket |
| TrustKit | iOS/Android pinning library ([GitHub](https://github.com/datatheorem/TrustKit)) | Pins on top of system trust | — |

**Conclusion [analysis]:** a CA that differs per install and arrives in the QR needs a small native module on each
platform: an iOS session delegate and an Android TrustManager/OkHttpClientFactory. It must back fetch, the streaming
transport and WebSocket, keyed by `serverId → CA SPKI hash`. No off-the-shelf RN library covers this.

### 3.10 Electron accepting a self-signed or private-CA certificate safely

- `session.setCertificateVerifyProc(proc)` receives `hostname`, `certificate`, `verificationResult` and `errorCode`.
  Return `0` to accept, `-2` to reject, `-3` to use Chromium's result. Accepting **disables Certificate Transparency
  verification** for that certificate, and "the result … is cached by the network service"
  ([Electron](https://www.electronjs.org/docs/latest/api/session)). Pattern: return `0` only when the chain's CA SPKI
  hash equals the one pinned for that server; otherwise return `-3`.
- `app.on('certificate-error')` with `event.preventDefault(); callback(true)` works per URL
  ([Electron](https://www.electronjs.org/docs/latest/api/app)). Use it only with an exact fingerprint comparison, never
  per host alone.

---

## 4. UX patterns that make it seamless

| Pattern | Who does it | Notes |
|---|---|---|
| One scan pairs everything: QR = address(es) + relay + host key/CA fingerprint + one-time code | Codex ([docs](https://learn.chatgpt.com/docs/remote-connections)), Signal, WhatsApp, Code With Me link | The QR also defeats a MITM; it must still require approval on the host |
| QR works in both directions | 1Password ([blog](https://1password.com/blog/product-update-features-and-security)) | Desktop shows the QR; the phone can also show one for the desktop camera |
| Picks the route automatically: LAN when on the home network, otherwise relay | Home Assistant (SSID-based, [docs](https://companion.home-assistant.io/docs/getting_started/connection-security-level/)), Plex (direct then relay), Tailscale (direct then DERP, [docs](https://tailscale.com/docs/reference/connection-types)) | SSID detection needs location permission on iOS and Android (same HA docs) |
| Relay-first "connect anywhere" default | Claude Code, Codex, Cursor | Avoids LAN permission prompts and mixed-content problems |
| Device list with platform, enrolment date and revoke; auto-expiry of unused devices | Claude Trusted Devices ([docs](https://code.claude.com/docs/en/remote-control)), Codex host list | Plus "sign out everywhere" for lost devices |
| Recency-based biometric step-up instead of a fresh login | Claude (18 h) | Avoids a password prompt on the phone |
| Approval timeouts that fail closed | Dispatch 10 min auto-deny ([docs](https://claude.com/docs/cowork/guide/dispatch)); Bitwarden 15 min | |
| Clear errors for local-network denial | Apple `localNetworkDenied` ([TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)) | Say "allow Local Network in Settings" instead of a generic timeout |
| Re-pair when the server identity changes | Implied by pinning guidance (backup keys, [Android](https://developer.android.com/privacy-and-security/security-config)) | Pre-announce the next key in the offer so rotation needs no re-pair [analysis] |

---

## 5. Implications for GeneratorAI

### 5.1 Patterns ranked (security, then seamlessness, then cost)

| # | Pattern | Security | Seamless | Cost | Verdict |
|---|---|---|---|---|---|
| 1 | **Pin the host identity from the QR** (CA SPKI already in `certificateFingerprint`) for native clients: iOS session delegate + Android TrustManager covering fetch, streaming and WS (MV-44) | High | High (zero prompts) | M (native modules) | **Do first.** It removes the plain-HTTP lane (D-112) and is the prerequisite for #2 |
| 2 | **Run that TLS end to end through the existing relay** (the host bridge targets the TLS listener; the client does TLS inside the relay stream, pinned as in #1) | High (relay sees SNI/timing only) | High | S–M once #1 lands | **Do next.** Matches Plex, SniTun, Code With Me and dev tunnels; `e2ee.ts` (NaCl framing) is the fallback if TLS-in-stream proves awkward in RN |
| 3 | **Relay-first routing with a LAN upgrade** for native: try the relay, probe the LAN address with a pinned TLS handshake, switch when reachable; handle `localNetworkDenied` and Android 17 `ACCESS_LOCAL_NETWORK` | — | High | M | Do with #2 |
| 4 | **Host-side hardening checklist** (§3.8): Host allow-list (DNS rebinding), WS Origin check (in place), never learn a server URL from a link and then send credentials, auth on every non-loopback bind (in place), no `0.0.0.0` default (in place) | High | Neutral | S | Audit now; Host allow-list is the likely gap |
| 5 | **Device lifecycle**: idle expiry, "last seen", revoke, "sign out everywhere", a notice to every device when a new one pairs, approvals that time out and fail closed, recency step-up for risky approvals | High | High | S–M | Match Claude Trusted Devices |
| 6 | **Browser via relay** with a documented trust model ("the relay can see browser sessions") until #7 exists | Medium | High | S | Be explicit in UI and docs; never claim E2EE for browsers |
| 7 | **Per-install public certificate** (`<install-id>.<vendor-domain>` wildcard via DNS-01 broker; relay routes by SNI, Nabu Casa style). This gives warning-free LAN HTTPS (plex.direct-style IP names), passkeys and E2EE browser sessions through the relay | High | Highest for browsers | L (DNS zone, ACME broker, PSL listing or LE rate override, CT name exposure, router rebind protection) | Strategic option for when browser-anywhere matters; conflicts with "no vendor infra" |
| 8 | **Private CA with fingerprint compare and CA download** for browsers on the LAN (current D-110) | Medium–High (TOFU with a human compare) | Medium (iOS full-trust toggle; Android OK in Chrome) | Done | Keep as the zero-infrastructure default |
| 9 | **BYO / Tailscale cert** (D-113) + Tailscale Serve identity | High | High for Tailscale users | Done | Document `tailscale cert` / Serve as the recommended "different networks without our relay" path |
| 10 | Short-code pairing without QR | Low–Medium | Medium | — | If kept, upgrade to **CPace/SPAKE2** so a MITM gets one online guess, not an offline grind |
| 11 | Plain-HTTP native lane (today) | Low (no confidentiality; DPoP limits token replay) | High | Done | Time-box. Until removed, consider HA's rule: allow it only on the network where pairing happened |

### 5.2 Specific follow-ups

1. **MV-44 scope:** trust anchors loaded at runtime, not `NSPinnedDomains` or `<pin-set>`, which are build-time and
   cannot express a per-install CA. Cover RN `fetch`, the streaming transport **and** WebSocket on both platforms. Carry
   a backup or next CA key hash in the pairing offer so a future CA rotation does not force re-pairing (§3.2, §3.9).
2. **Relay E2EE:** prefer TLS-in-relay for native clients (one crypto stack, already pinned). Bind the relay channel to
   the paired device key (DPoP already does this per request). Keep relay metadata minimal (§3.7).
3. **Browser story:** say plainly that browser sessions over the relay are relay-trusting. Revisit #7 if remote browser
   use matters (§3.3, §3.7).
4. **Android 17 / iOS:** add `ACCESS_LOCAL_NETWORK` (or the NSD picker) and `NSLocalNetworkUsageDescription`, plus
   `NSBonjourServices` if discovery is added. Expect silent denial in the iOS background (§3.4).
5. **Electron (desktop as a client of a remote server):** use `setCertificateVerifyProc`, accepting only an exact CA
   SPKI match per paired server (§3.10).
6. **Pairing phishing:** host-side approval names the device and platform; every device gets a "new device paired"
   notice; the QR or deep link must never retarget an existing pairing's credentials (§1.2 OpenClaw, §3.6 Signal).
