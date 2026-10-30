# MV-44 — LAN HTTPS with the server's CA pinned (2026-10-09)

Decisions: mobile MD-199 (native anchors), MD-200 (typed code), MD-201 (no plain HTTP), MD-202 (named problems);
server D-127 (lane removed, standby CA). Shared rule: D-125 (`endpointTrust`).

## What changed

| Where | Change |
|---|---|
| `apps/mobile/modules/generatorai-trust` (new) | iOS `GAITrust` (ObjC, `+load`): session-level challenge handler on `RCTHTTPRequestHandler` and Expo's `URLSessionSessionDelegateProxy`; SocketRocket policy hook in `-[SRWebSocket open]`; evaluation with the pinned CA as the only anchor + SSL host policy. Swift `GeneratorAITrustModule`: `setAnchors`, `clearAnchors`, `lastFailure`, `inspect` (handshake-only chain capture), `localNetwork` (NWConnection `localNetworkDenied`). Android: `TrustAnchors` + pinning `X509ExtendedTrustManager` installed as the `OkHttpClientFactory` from `Application.onCreate` (`GeneratorAITrustPackage`); `GeneratorAITrustModule` with the same JS surface (`localNetwork` = `ACCESS_LOCAL_NETWORK` on Android 17 for a target-37 app). |
| `src/services/transport/trust.ts` (new) | Pure rules: endpoint security (`tls` / `loopback` / `plain`), pinnable names (shared D-125 rule), trust records, anchor targets, diagnosis, the short fingerprint. |
| `src/services/auth/serverTrust.ts` (new) | Trust record per server in the secure store (`gai.trust.<serverId>`), install / clear native anchors, explain a failure. |
| `AuthProvider` | Every request waits for its server's anchors; plain HTTP to another device is never requested; pairing stores the proposal's CA before the first request and restores the old record on failure; `connectionProblem` in the context; unpair deletes the record. |
| `endpointPlan` | No plain-HTTP candidate. |
| `pairingInput` | `consentFor` returns a proposal `{ consent, trust, certificate }`: QR → the offer's CA + standby; typed code → handshake capture, temporary `pairing-preview` anchor for the preview. Address defaults to `https://`; `probeAddress` says **Use https://** for plain HTTP. |
| Pairing screen | Consent row **Encrypted** with how the identity is checked; for a typed code the certificate to compare; failures named (certificate, Local Network + Open Settings, old server). |
| Connection screen (`app/_layout.tsx`) | **This server's identity changed — pair again**, **Pair again for an encrypted connection**, **Allow Local Network access** (`services/auth/connectionProblem.ts`). |
| App config | `withCleartextTraffic` + `androidManifestCleartext` (and their tests) deleted; Info.plist comments; README section "LAN HTTPS and certificate pinning". |
| Server (D-127) | One https:// endpoint list for every platform; transport lanes `https` / `loopback` / `lan-http` (refused); no own-Origin WebSocket allowance; standby CA + `backupCertificateFingerprint`. |
| Endpoint fallback (MD-203) | Pairing connects first and pairs via the first address that answers (3 s each); the working address is remembered per server and leads the next start. Plain-HTTP loopback only when nothing is offered over HTTPS. |
| Tooling | `sandbox.mjs --lan` (exposed, auth, throwaway vault and admin key, agent publish allowed); `sandbox-pair` always uses it, authenticates with the key from its 0600 state file (redacted from output), puts the https LAN address first, follows "Pair again" on the connection screen; `--keep-order` pairs through the offer as minted. `agent-tests/helpers/api.ts` sends `API_KEY` as a bearer. |

## Evidence

Sandbox: `node scripts/mobile/sandbox-pair.mjs` → `sandbox.mjs --lan` (bound to 0.0.0.0, built-in HTTPS, auth on);
the Mac's LAN address was 192.168.0.107, then 192.168.0.111 after a DHCP change. Dev clients rebuilt with the module:
iOS on gai-iphone (iOS 27 simulator), Android on gai-phone (API 36 emulator). Native probes ran inside the app's Hermes
runtime through Metro's inspector (`globalThis.expo.modules.GeneratorAITrust`).

| Check | iOS (gai-iphone) | Android (gai-phone) |
|---|---|---|
| Pair from the QR link over `https://` with the CA pinned; consent shows **Encrypted** | pass (`ios-home-after-tsnet-fallback.png`) | pass (`android-consent-encrypted.png`) |
| Offer lists an unreachable `https://…ts.net` first → app falls back and pairs via `https://192.168.0.111:3197` (stored session leads with it) | pass | pass |
| Home and chats load; a streaming turn streams (SSE via expo/fetch) and a gate is approved | pass (`ios-gate-approved-over-https.png`; Maestro `chat/send-stream-approve` streamed the gate, its Allow tap landed under the keyboard, approved by hand) | pass (Maestro `chat/send-stream-approve`) |
| WebSocket | SocketRocket `wss://` upgrade reached the server (`[tts-ws] upgrade unauthorized` — no ticket in the probe); terminal needs the passcode step-up the iOS 27 simulator cannot give (MV-02) | terminal opens and the shell prompt streams over `wss://` (`android-terminal-over-wss.png`; Maestro `terminal/open-type` stopped at the fingerprint step-up, done by hand) |
| Wrong pin refused, failure recorded, no request sent | expo/fetch refused; RN XHR refused on a fresh connection; SocketRocket refused with no upgrade logged | OkHttp `SSLHandshakeException: The server's certificate is not issued by the CA this device paired with`; WebSocket refused with no upgrade logged |
| Server reinstalled (new CA + identity key) → **This server's identity changed — pair again** | pass (`ios-identity-changed.png`) | pass (`android-identity-changed.png`; refusal is the pinned trust manager) |
| Leaf re-issued for a new LAN address under the same CA keeps working | pass (192.168.0.111 leaf, same CA, `inspect` = server's leaf + CA) | pass |
| Plain HTTP refused | app never builds an http:// LAN candidate (unit tests); server answers `403 HTTPS_REQUIRED` to a raw http:// request from the app | same |
| Handshake-only inspection (typed code) returns the server's leaf and CA; a closed port rejects | pass (Network.framework) | pass |

Gates: mobile `typecheck`, `lint`, `check:design --strict`, `vitest` (1163), `jest` (706 + 2 skipped), `bundle:check`;
server `lanTransport` / `lanTls` / `requestOriginCase` / `tailscaleAccess` / auth suites; relay-protocol tests;
`agent-tests/lan-pairing-e2e.mjs` 29/29; `scripts/mobile/lib/sandbox-data.test.mjs`.

Findings on the way (not MV-44 defects): Metro "reload" crashes this dev build in `ExpoFabricView.injectInitializer`
(an Expo dev-client issue, cold launches are fine); the gai-phone AVD has a lock-screen PIN, so after a reboot nothing
launches until it is unlocked (`START_CLASS_NOT_FOUND`); agent-device on Android failed to `open` under load, so the
Android steps used adb + uiautomator; Maestro `pairing/pair-via-link` on iOS stopped at a scroll-visibility check on
the busy machine (the same steps pass through `sandbox-pair pair`).

## Not covered / follow-ups

- CA rotation itself (promote the standby) is not built (D-127); the app already pins the standby.
- Android 17 `ACCESS_LOCAL_NETWORK`: not declared while the target is SDK 36 (MD-202).
- Typed-code pairing is trust on first use plus a human comparison; CPace/SPAKE2 would close it (research §5.1 #10).
- iOS terminal over `wss://` on a real iPhone (simulator step-up, MV-02); the iOS Maestro pairing flow on a quiet machine.
- Web Settings copy still mentions the native lane (`PairDeviceGroup.tsx`, `securityModel.ts`) — left to the web owner (COORDINATION).
