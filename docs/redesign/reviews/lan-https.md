# LAN HTTPS and the pairing-code overflow (2026-10-07)

Decisions: D-110 to D-114 (`01-decisions.md`). Mobile follow-up: MV-44 (`mobile/reviews/PENDING.md`). User guide: docs site › Guides › Remote access over HTTPS (`apps/Documentation Site/docs/guide/remote-access.md`).

## Problem

- The installed desktop app's server spoke **plain HTTP**. With Network exposure on, a browser on another laptop or phone opened `http://<lan-ip>:<port>`. That is not a secure context, so `crypto.subtle` was missing and pairing failed with "WebCrypto is unavailable; cannot create a device key". The native mobile app's LAN traffic was unencrypted.
- Three copies of the request-URL code trusted `X-Forwarded-Proto` from any client. A request could therefore pick the scheme its DPoP `htu` was checked against. HSTS was keyed on the same header.
- **Pairing screen.** The 12-character code input drew twelve 48-px cells, about 700 px with the gaps, inside a 420-px card. It overflowed on every width, including the desktop window. The read-only code in Settings › Pair a new device also overflowed narrow columns.

## Design

| Piece | Where | What |
| --- | --- | --- |
| Certificates | `apps/server/src/network/tls/certificates.ts` | Local CA: ECDSA P-256, 10 years, `pathLen 0`, critical name constraints (private IPv4, 127/8, 100.64/10, fc00::/7, ::1, `.local`, `localhost`). Leaf: ECDSA P-256, 397 days, serverAuth, signed by the CA. Generated with `@peculiar/x509` (MIT, already in the lockfile) on Node WebCrypto. Inspected, key-matched and host-checked with Node `X509Certificate`. |
| SANs | `tls/certificateNames.ts` | Private IPv4 and unique-local IPv6 addresses on any adapter, `<hostname>.local` (only a valid DNS label), `localhost`, 127.0.0.1, ::1. |
| Lifecycle | `tls/TlsManager.ts` | Key material lives only in the vault (`SecretNamespace.tls` = `system/tls`: `local-ca`, `leaf`, `custom`). On start, and every 60 s, the leaf is re-issued if the addresses or hostname changed, if it expires within 30 days, or if another CA issued it. The `SecureContext` is swapped in place, so it applies to the next handshake. The CA is never re-issued. |
| One port, two protocols | `tls/dualProtocolListener.ts`, `index.ts` | With exposure on, a TCP listener on `0.0.0.0:<port>` sniffs the first byte. `0x16` is wrapped in a server-side `TLSSocket`; anything else stays as is. Both go to the same `http.Server`, so WebSocket upgrades, timeouts and `closeAllConnections` cover both. A socket idle for 10 s, or a handshake stalled for 10 s, is dropped. Shutdown closes the TCP listener. Loopback-only servers are unchanged (`app.listen`). |
| Transport policy | `middleware/transportPolicy.ts`, `wsAuth.ts` | HTTPS and same-machine requests always pass. Plain HTTP from another device: a page gets a 308 redirect to `https://`; a request with a foreign `Origin` gets 403 `HTTPS_REQUIRED`; `/api/*` with no `Origin`, or with the server's own `http://<host>` (React Native's WebSocket default), is the native lane, still DPoP-bound. |
| Scheme-aware checks | `network/requestOrigin.ts` | One helper builds DPoP `htu` for REST, the WebSocket upgrade and the pairing/refresh routes, using `https://` for a TLS socket. The CORS allowlist is checked per request and includes the `https://` LAN and `.local` origins. Advertised endpoints for browsers are `https://` (`network/serverEndpoints.ts`, one source for pairing, network-access, bootstrap and origins). HSTS is sent only over HTTPS, never for an IP or `localhost`. |
| Proxy trust | `requestOrigin.ts` | `GENERATORAI_TRUST_PROXY`: unset or `0` means none; `1`, `true` or `loopback` means a proxy on the same machine; an IP list means exactly those peers. Only those peers' `X-Forwarded-Proto` and `X-Forwarded-Host` are used. |
| APIs | `routes/auth.ts`, `routes/security.ts`, OpenAPI | `tls` (leaf and CA SHA-256, names, expiry, source) on `server-info`, `pair`, `pair/preview` and `network-access`; `trustProxy` on `network-access`. Public `GET /api/auth/tls/ca.crt`. `PUT` / `DELETE /api/security/tls/certificate` (admin:settings) for your own certificate. Pairing offers carry `certificateFingerprint`: the CA SHA-256 as base64url. |
| BYO certificate | `tls/customCertificate.ts` | Accepts PEM with a chain in any order; the certificate matching the key is moved first. The key must be unencrypted. The certificate must not be a CA, must be valid now, and must name this computer: a LAN name, an advertised host, or `<host>.<domain>` such as a Tailscale name, which is then advertised. Errors list what the certificate covers. On restart it is reloaded without the name check. When it expires, the server falls back to the generated certificate and shows the reason. |
| Mobile | D-112, MV-44 | Native, CLI and MCP offers keep the plain-HTTP LAN addresses first, so today's app works unchanged. Web and desktop offers are `https://`. Pinning in React Native needs native trust hooks on both platforms, so it is out of scope here; MV-44 covers it. No `apps/mobile` code changed. |
| Web UI | `features/settings/security/CertificatePanel.tsx`, `ServerPosture.tsx`, `PairDeviceGroup.tsx`, `features/pairing/PairingGate.tsx` | Network exposure shows the `https://` addresses and an HTTPS certificate panel: fingerprint (first 8 bytes in pairs, full value copied), names, expiry, CA download, "Use your own certificate…" (paste or load files), "Use the generated certificate", and the reason when HTTPS is unavailable or a custom certificate failed. The trusted proxy is named when set. Pair a new device shows the server's per-platform `joinUrl`, and next to an `https://` address it says what to compare. The gate refuses a non-secure page with a clear message. On a remote `https://` page it points to the server's screen for the fingerprint, never to a value from the page itself, which a man in the middle could relay. The pairing QR renders at 2 px per module with L correction; before, it fell back to a 550-px code. |
| Pairing code input | `ui/patterns/PairingCodeInput` | Cells share the row (`flex-1 min-w-0`, capped at 48, or 32 read-only). Font size, height and gaps follow the container's own width (`@container/code`): `text-ui` / `h-control-lg` below 320 px, `text-title` / `h-row` from 320 px, `text-heading` / `h-footer` from 512 px. The new **Widths** story checks 256 / 288 / 364 / 560 px and a narrow read-only row. Test ids, roles and names are unchanged. |

## Steps for another laptop or phone (browser)

1. On the computer running GeneratorAI, go to **Settings › Security & devices › Network exposure** and choose **LAN**. The desktop app restarts its server.
2. Under **HTTPS certificate**, note the fingerprint, for example `B5 54 1C 3C 04 92 9D D6 …`. Under **Pair a new device**, pick **Web browser** and click **Generate pairing code**.
3. On the other device, open the `https://<lan-ip>:<port>` address shown in step 1 of the pairing panel. If you type `http://`, you are redirected to it.
4. The browser warns that the connection is not private. Open the certificate details (Chrome: **Not secure › Certificate details**; Safari: **Show Details**; Firefox: **Advanced › View Certificate**). Check that the SHA-256 fingerprint starts with the bytes from step 2, then continue.
5. Type the 12-character code, check the server name and permissions, and click **Connect**.
6. Optional, to stop the warning for good on a device you own: click **Download certificate authority**, or open `https://<address>/api/auth/tls/ca.crt` on the device, and trust it. The docs guide has the steps for each OS.

**Mobile app:** scan the QR or type the code as before. It uses the native lane until MV-44.

## Evidence

All test servers were isolated: `DB_PATH`, `ARTIFACTS_DIR`, `WORKSPACES_DIR` and `EXTENSIONS_DIR` pointed at the scratchpad, and the logged `dbPath` was checked. The port was 3611, widget 3612. Network-accessible mode came from the exposure file, with a random 32-byte `GENERATORAI_SECRET_KEY`. LAN IP: 192.168.0.101.

- **Unit tests.** `apps/server/src/__tests__/lanTls.test.ts` has 12 tests: CA and leaf generation; a client trusting only the CA verifies the leaf by IP and by name; a CA-signed `bank.example` / `8.8.8.8` leaf is refused with "permitted subtree violation"; SAN selection; mDNS name sanitising; vault persistence, with no re-issue on restart; re-issue on address change and near expiry under the same CA; BYO accept, restart, remove, the Tailscale-name rule, and refusals for key mismatch, other machine, expired, CA certificate, encrypted key and garbage; the base64url offer fingerprint. `lanTransport.test.ts` has 14 tests: plain HTTP with a body split across packets; HTTPS on the same port (`req.secure`, `htu` `https://`); WebSocket upgrade over both; stalled handshake and idle socket dropped; trust-proxy parsing; forged forwarded headers ignored and trusted ones honoured; the transport lanes, redirect, `HTTPS_REQUIRED` and native lane; https endpoints. `securityHeaders.test.ts` was updated (7 tests). Web: `securityModel.test.ts` (4) and the PairingCodeInput story tests (4, including Widths).
- **Gates.**
  - Server: typecheck; lint (0 errors); full suite 78 files / 741 tests before the QR follow-up, and `lanTls` re-run after it.
  - `@generatorai/auth`: 62 tests and typecheck. `@generatorai/secrets` tests pass.
  - Web: typecheck, lint (0 errors), `check:design` OK, related unit tests, story tests, build, `check:bundle` and `check:css` OK.
  - `check:security-invariants` OK. The docs site `check-docs` passes after regenerating the reference.
- **curl against the live server.**
  - `https://` `server-info` returns `tls` and https endpoints.
  - Plain-HTTP page request: `308 https://192.168.0.101:3611/settings`.
  - Plain-HTTP POST with a foreign `Origin`: `403 HTTPS_REQUIRED`, also with a forged `X-Forwarded-Proto: https`.
  - Native-lane POST: 204. Native `server-info` lists http endpoints. Loopback: 200.
  - `openssl s_client` shows the leaf SANs and that the CA issued it. The downloaded CA has `CA:TRUE, pathlen:0` and the name constraints.
  - WebSocket on the plain LAN: no `Origin` or the server's own `Origin` gets 401 (reaches authentication); a foreign `Origin` gets 403.
  - After a restart the leaf and CA fingerprints are unchanged. No PEM or private key exists anywhere on disk, only the vault. A graceful shutdown in dual mode logs `shutdown complete`.
- **Second browser.** Playwright with Chrome, `ignoreHTTPSErrors`, 390×844 mobile, script in the scratchpad: 19/19 PASS.
  - The host pairs over loopback with the bootstrap code.
  - Settings shows `https://192.168.0.101:3611` and `https://siddharths-macbook-air.local:3611` and the fingerprint.
  - The pairing panel says to open `https://` and shows the compare note.
  - The LAN browser's `http://` is redirected to `https://`.
  - `isSecureContext === true` and `crypto.subtle` is present.
  - Pairing completes over `https://` (DPoP `htu` https) and the authenticated call returns 200.
  - The code fits the card at 360 / 390 / 414 / 1100 px (last cell right edge ≤ card right edge, no page scroll).
  - BYO: the wrong key is refused with "The private key does not belong to this certificate."; the right one is served without a restart; a client trusting only that CA verifies; switching back works.
  - The only console error is the intentional 400.
  - Shots: `shots/lan-https/*.png`.
- **e2e specs.**
  - `agent-tests/lan-pairing-e2e.mjs`, extended: 23/23. The native app still pairs over the plain-HTTP lane. A web client that trusts the CA (real verification, not ignored errors) pairs over `https://`, and its DPoP requests succeed. The mobile offer carries the CA fingerprint. Browser requests over HTTP from the LAN are refused and pages redirect.
  - `short-code-pairing-e2e` 22/22, `security-e2e` 51/51, `host-pinning-e2e` 10/10.
- **Desktop (Electron, isolated profile).**
  - New `agent-tests/desktop-lan-https-smoke.mjs`: 9/9. Clicking **LAN** in Settings restarts the server with HTTPS. The window stays on `http://127.0.0.1:<port>`. Settings shows the `https://` address and fingerprint (`shots/lan-https/desktop-settings-security-lan.png`). The LAN port serves that certificate, plain-HTTP pages redirect, the loopback API works, and **Loopback only** drops TLS.
  - `desktop-chrome-smoke` 59/59. `right-pane-desktop-smoke` all ✅.
  - `desktop-security-smoke` 14/15. The failure, "device private key is non-extractable :: no private key", predates this work: the smoke reads the unscoped IndexedDB key `device-key`, but keys are scoped per server. Nothing touched here changes key storage.
- **Installer:** see the end of this file.

## Left / follow-ups

- **MV-44.** HTTPS and CA pinning in the mobile app, then switch native offers to `https://` and remove the native lane.
- **Desktop remote mode** against another machine's built-in HTTPS: Electron's `certificate-error` handler trusts only loopback, so a remote self-signed server is refused. Before this work that mode was not a secure context either, so it could not pair. Suggested fix: trust on first use of the CA fingerprint, kept with the connection.
- **The widget-asset origin** remains a loopback-only plain-HTTP listener. A remote browser cannot load widget iframes, the same as before.
- A web page that pairs from an offer blob (`?pair=`) uses the offer's primary endpoint, now `https://`. A loopback page should type the short code instead, which uses the page's own origin.
- Mobile typecheck and vitest were not run: no `apps/mobile` or mobile-imported package code changed.
- VRT baselines were not updated: Docker is not available here (D-53).

## Installer

`pnpm package:desktop` built `apps/desktop/release/GeneratorAI-0.0.1-alpha.1-arm64.dmg` (unsigned, arm64, 2026-10-07 00:29). Checks:

- The packaged server bundle was run directly: `GeneratorAI.app/Contents/Resources/server/server.mjs` under `ELECTRON_RUN_AS_NODE`, with an isolated DB (dbPath asserted), port 3621, network-accessible.
- It generated the CA and leaf, served `tls` over `https://192.168.0.101:3621`, redirected a plain-HTTP LAN page (308), and shut down cleanly. So `@peculiar/x509` (and its `reflect-metadata` / `tsyringe` dependencies) bundle correctly with esbuild.
