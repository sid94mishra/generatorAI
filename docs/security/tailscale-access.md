# Connect with Tailscale, and the desktop app as a pinned client (2026-10-09)

Decisions D-123 to D-126 (`docs/redesign/01-decisions.md`). Context: `seamless-connections.html` (Option 1: Tailscale one-click, no hosting) and `security-analysis.html` (G-4: the desktop app cannot connect to another machine's server). User guide: docs site › Guides › Remote access over HTTPS (`apps/Documentation Site/docs/guide/remote-access.md`).

## What was built

| Piece | Where | What |
| --- | --- | --- |
| Tailscale CLI | `apps/server/src/network/tailscale/tailscaleCli.ts` | Finds the CLI: `GENERATORAI_TAILSCALE_CLI`, then `PATH`, then the OS install path (macOS `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, Windows `%ProgramFiles%\Tailscale\tailscale.exe`, Linux `/usr/bin`, `/usr/sbin`, `/usr/local/bin`, `/snap/bin`). Runs it with `spawn(…, { shell: false })` and a timeout (Serve blocks while it waits for HTTPS to be enabled). Exact argument arrays: `status --json`, `serve status --json`, `serve --bg --https=443 http://127.0.0.1:<port>`, `serve --https=443 off`. |
| Parsing | `tailscaleStatus.ts` | `status --json` (BackendState, AuthURL, Self.DNSName, CertDomains / the `https` capability, MagicDNS) and `serve status --json` (the `/` handler of `<name>:443`, Funnel), defensively. Only tailscale.com links are passed on. The enable-HTTPS link is read from the CLI's output. |
| Service | `TailscaleAccess.ts` | States: not installed · not running · needs login · HTTPS off · ready · on · error. Connect, turn off, re-apply after `listen` and every 60 s. Persisted in `tailscale-access.json` (0600, next to the DB). Same blockers as Network exposure; while on, the agent permission default is `acceptEdits`. Never replaces another app's Serve handler without `replace`; turning off removes the handler only if it still points here. |
| Forwarded headers | `network/requestOrigin.ts` | The D-124 lane: `X-Forwarded-Proto` is honoured only from loopback, while Tailscale access is on, when `Host` and `X-Forwarded-Host` are exactly the ts.net name. Never bypasses the Host allow-list. Per-source pairing limits use the tailnet peer (`X-Forwarded-For`). `Tailscale-User-*` is never read. |
| Allow-lists | `middleware/hostAllowlist.ts`, `network/reachableOrigins.ts` | The ts.net name is an allowed Host and `https://<name>` an allowed Origin while on. |
| Offers | `network/advertisedEndpoints.ts`, `serverEndpoints.ts` | `https://<name>.ts.net` first for every platform, reachability `private-network`, also on a loopback-only server. |
| API | `routes/security.ts`, OpenAPI | `GET /api/security/tailscale` (read:status; limited view without admin:settings), `POST /api/security/tailscale {enabled, replace?}` (admin:settings, audited; 409 with the status). |
| Shared | `packages/shared` | `TailscaleAccessStatus`; `endpointTrust(origin)` (`install-ca` / `system` / `none`) and `isTailscaleOrigin` (D-125). |
| Web | `features/settings/security/AccessGroup.tsx`, `PairDeviceGroup.tsx`, `PairingGate.tsx` | **Access from other devices**: the Tailscale card (every state, free download links per OS, Tailscale's enable link, Funnel and conflict warnings, address with copy), **Advanced: Network exposure (LAN)** below it. The pairing panel shows the ts.net address first with "Works on any network where your devices are signed in to Tailscale", and **Copy pairing link**. Certificate-comparison notes only for install-CA names. |
| Desktop as client | `apps/desktop/src/main/pinnedTrust.ts`, `remote-connect.ts`, `backend-switcher.ts`, `index.ts` | **Add Server…** takes an address or a pairing link. A public certificate (ts.net) needs nothing. Otherwise the server's own CA is pinned: from the offer's fingerprint, or after **Trust this server?** with the fingerprint. `setCertificateVerifyProc` accepts only a leaf signed by the pinned CA, valid, not a CA, naming that saved server's host. Everything else gets -3 (Chromium's verdict). The pin is saved per server in `serverConnections`. |
| Hardening found on the way | `apps/desktop/src/main/ipc.ts` | `requestPairingCode` (an all-scope grant for this computer) answers only pages of the embedded server's origin. A remote server shown in the window could mint one before. |

## User steps

### Access from your phone or another computer

1. Install Tailscale on this computer and sign in. It is free (Personal plan: up to 6 users, unlimited devices). Download for [macOS](https://tailscale.com/download/mac), [Windows](https://tailscale.com/download/windows) or [Linux](https://tailscale.com/download/linux).
2. Install Tailscale on the phone or other laptop ([iOS](https://tailscale.com/download/ios), [Android](https://tailscale.com/download/android)) and sign in with the same account.
3. In GeneratorAI, open **Settings › Security & devices › Access from other devices** and click **Connect with Tailscale**.
4. If the card says **HTTPS off**, click **Turn on HTTPS**. That is Tailscale's own link. Approve it, then click **Connect with Tailscale** again.
5. The card shows **On** and `https://<machine>.<tailnet>.ts.net`.
6. Under **Pair a new device**, choose the platform and click **Generate pairing code**.
   - **Browser:** open the address on the other device. There is no certificate warning. Type the code and click **Connect**.
   - **Mobile app:** scan the QR.

### Connect this desktop app to another computer's GeneratorAI

1. On the other computer, go to **Pair a new device**, choose **Desktop**, click **Generate pairing code**, then **Copy pairing link**.
2. Here, choose **Server › Add Server…** and paste the link. You can also type the address.
3. If the server uses its own certificate, check **Trust this server?**:
   - from a link, it confirms that the fingerprint matches the code;
   - from a typed address, compare the fingerprint with **Settings › Security & devices › HTTPS certificate** on the other computer.
4. The other computer's pairing screen opens with the code filled in. Click **Connect**.

## Evidence

All servers were isolated: scratch `DB_PATH`, `ARTIFACTS_DIR`, `WORKSPACES_DIR` and `EXTENSIONS_DIR`, `GENERATORAI_BIND_HOST`, and a random `GENERATORAI_SECRET_KEY`. Every run checked the logged `dbPath`. Desktop runs used fresh `--user-data-dir` profiles. Tailscale is not installed on this Mac, so a fake CLI and a fake Serve proxy stood in for it (`agent-tests/helpers/fake-tailscale/`):

- **Fake CLI.** It produces the real output shapes, including the enable-HTTPS message, and the server finds it on `PATH`.
- **Fake Serve proxy.** A TLS proxy with the same headers as `tailscale serve`: Host kept, `X-Forwarded-*` set, client-sent copies stripped, `Tailscale-User-*` added. It streams SSE, passes WebSocket upgrades through, and uses a throwaway CA.
- **Browser trust.** Chromium trusts that leaf only through `--ignore-certificate-errors-spki-list`, never the system store. The ts.net name resolves through `--host-resolver-rules`.

### Unit tests

- **Server:** `apps/server/src/__tests__/tailscaleAccess.test.ts`, 35 tests:
  - status fixtures: running, logged out (hostile AuthURL dropped), HTTPS off (by CertDomains and by capability), stopped/starting, several tailnets, garbage;
  - serve-status fixtures;
  - the enable link and failure text;
  - the exact argument arrays and port validation;
  - candidate paths per OS and the macOS bundle;
  - a runner check that hostile arguments reach the CLI verbatim (no shell);
  - the timeout kill of a waiting `serve`;
  - connect, HTTPS-off, blocked, conflict/replace, turn off (own handler only), re-apply at start after a port change, the paused-by-blocker case, a corrupt state file, and the limited view;
  - the D-124 lane: loopback plus the exact name honoured; non-loopback, a foreign Host or a foreign X-Forwarded-Host ignored; never loopback-privileged;
  - the Host allow-list with and without access on;
  - endpoint order: ts.net first for browser and native.
- **Shared:** `endpointTrust`, 4 tests.
- **client-runtime:** `preferEndpoint`, 2 tests.
- **Desktop:**
  - `pinnedTrust.test.ts`, 9 tests: exact match accepted; a same-named leaf from another CA refused; another host refused; Chromium's OK kept; expired; tampered pin; CA as leaf; case-insensitive hosts.
  - `remote-connect.test.ts`, 9 tests: offer fingerprint match, mismatch, ts.net first with no pin, loopback skipped, wrong server refused, native-lane http tried as https, typed address needs the trust step, LAN http upgraded, public certificate.
  - `serverConnections.test.ts`: the pin kept or dropped on load, and never swapped.
- **Web:** `securityModel.test.ts`, 5 tests. A ts.net address is shown as is.

### Gates

| Package | Results |
| --- | --- |
| Server | `tsc --build` and lint clean (no sync-IO growth). Full suite 836/837: the one failure, `review-submit`, was a 5 s timeout while the machine sat at load 30, and it passes 3/3 alone. |
| auth, client-core, client-runtime, relay-protocol, shared | All green. |
| Web | Typecheck and lint clean. `check:design` OK. Related unit tests 813/813. Build, `check:bundle` and `check:css` OK. |
| Desktop | Typecheck clean. Vitest 480/480. |
| Docs site | `check-docs` OK. Reference regenerated. |

### e2e

`agent-tests/tailscale-e2e.mjs` passed 32/32. It runs an isolated production server, loopback only, with the fake CLI on `PATH`. It covers:

- every state through the API, including a 409 carrying Tailscale's own enable link;
- Connect running exactly `serve --bg --https=443 http://127.0.0.1:<port>`, and the choice persisted;
- web `joinUrl` and the mobile offer leading with the ts.net origin, even on a loopback-only server;
- a second Chromium browser on `https://<name>.ts.net`, with no warning: `isSecureContext` and WebCrypto are available, and it pairs by typing the code;
- DPoP REST at 200, the SSE stream at 200, a ticketed WebSocket upgrade, and a CORS POST, all through the proxy;
- no console errors;
- no credential granted by the Tailscale identity headers (401);
- WebSocket from the ts.net Origin reaches authentication (401), and a foreign Origin is refused (403);
- loopback with a forged `X-Forwarded-Host` and a foreign Host is refused with 421, so rebinding stays blocked;
- the lane gives an `https://` endpoint;
- turn off removes the handler, and the name gets 421 again;
- both changes audited.

Existing specs: `security-e2e` 61/61, `short-code-pairing-e2e` 22/22, `host-pinning-e2e` 10/10, `lan-pairing-e2e` 29/29.

### Desktop smokes

These ran one at a time, against the real Electron shell.

- **`desktop-tailscale-smoke.mjs`, 18/18.**
  - **HTTPS off:** the card says so, and **Connect** produces Tailscale's link.
  - **Connect:** **Connect with Tailscale** shows **On** and the ts.net address. Serve points at the window's loopback port, and Network exposure stays off.
  - **Pair a new device:** the panel lists the ts.net address with the Tailscale note and no certificate note.
  - **Second browser:** a 390-px browser opens the address with no warning, in a secure context, pairs by typing the code, and its DPoP calls work.
  - **Re-apply:** the persisted port was made stale and the embedded server restarted. Serve was re-pointed, and the other device still works.
  - **Turn off:** removes the handler.
- **`desktop-pinned-client-smoke.mjs`, 15/15.**
  - Server A had LAN HTTPS (D-110 CA). Desktop B used **Add Server…** with A's Desktop pairing link.
  - **Trust this server?** named the server and showed A's certificate fingerprint and "It matches the pairing code".
  - B's window loaded `https://<lan-ip>:<port>` through the pinned CA as a secure context and paired.
  - The pin was saved and equals the offer's fingerprint.
  - A then served a certificate from another CA for the same IP. B refused it with `ERR_CERT_*`, on new connections.
  - Back on A's own CA, B loaded again.
- **`desktop-lan-https-smoke` 9/9.** Updated for the Advanced disclosure and the self-pairing reload.
- **Others:** `desktop-chrome-smoke` 59/59, `right-pane-desktop-smoke` all ✅, `desktop-security-smoke` 17/17.
- Under machine load (an iOS build alongside), one `desktop-tailscale-smoke` run hit a 502 from the fake proxy while the embedded server was busy. The rerun passed 18/18.

### Screenshots

These are in `docs/redesign/shots/tailscale/`:

- `desktop-settings-tailscale-https-off.png`
- `desktop-settings-tailscale-on.png`
- `desktop-pairing-panel-tailscale.png`
- `phone-browser-paired-over-tailscale.png`
- `browser-pairing-over-tailscale.png`
- `browser-paired-over-tailscale.png`
- `desktop-client-pairing-pinned.png`

## What the owner must check live (real Tailscale account)

The fake CLI follows the real one's source (`cmd/tailscale/cli/serve_v2.go`, `ipn/ipnlocal/serve.go`), but these need a real tailnet:

1. **Install and sign in.** Install Tailscale on the Mac (the App Store or standalone app) and sign in. In GeneratorAI › Settings › Security & devices, the card should say **Ready**, or **HTTPS off** on a new tailnet.
2. **Connect.**
   - Click **Connect with Tailscale**.
   - On a new tailnet, follow **Turn on HTTPS**: Tailscale admin console › DNS › HTTPS Certificates. Then connect again.
   - Confirm the card shows **On** and `https://<mac>.<tailnet>.ts.net`.
   - In Terminal, `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status` should show `https://<name> … proxy http://127.0.0.1:<port>`.
   - Also confirm whether the macOS App Store variant accepts `serve` from a non-root user. Its proxy mode is documented to work; path serving does not.
3. **Phone or other laptop.**
   - Install Tailscale on the phone or other laptop and sign in with the same account.
   - Open the address and confirm there is no certificate warning.
   - Pair by code.
   - Use a chat, so the live stream works, and the terminal, if granted, so the WebSocket works.
4. **Off the home network.** Switch the phone to mobile data, with Tailscale on, and confirm it still works.
5. **Quit and reopen** the desktop app. The card stays **On**, and the phone works again within a minute; Serve is re-applied even if the port changed.
6. **Turn off Tailscale access.** The address stops answering, and `tailscale serve status` no longer lists it.
7. **Desktop to desktop.** On a second computer running GeneratorAI:
   - **Server › Add Server…**, then paste the first computer's Desktop **Copy pairing link**.
   - With LAN exposure on: confirm **Trust this server?** and pairing.
   - With Tailscale on both computers: the ts.net address connects with no trust prompt.
8. **Linux** (if available). If `serve` says "Access denied", run `sudo tailscale set --operator=$USER` once; the card's message says so.

## Left / follow-ups

- **Mobile (mobile-owned).** Pair over the first offer endpoint that answers, instead of `endpoints[0]`, because the ts.net address is first and a phone without Tailscale cannot reach it. Use system trust for the ts.net address (`trust.ts` already does). Logged in `docs/redesign/mobile/COORDINATION.md`.
- **Bridge calls in remote mode.** A remote server's page in the desktop window still reaches the other desktop bridge calls, which is the pre-existing remote-mode surface. Only `requestPairingCode` is now restricted. Review which calls a remote origin should get.
- **The pairing gate's generic hint.** It still shows the "did your browser warn" hint in the desktop app for a pinned LAN server. Chromium shows no warning there, because the pin accepted the certificate. The hint could be hidden when the page runs in the desktop shell.
- **VRT baselines.** Not updated: Docker is not available (D-53).
