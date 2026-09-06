# Cloudflare Tunnel as the relay transport — end-to-end implementation plan

**Status:** proposed, not yet built. **Supersedes, for v1, the custom director/cell relay** (`apps/relay`, `RelayHostBroker`'s Ed25519 proof-of-possession handshake) as the *default* off-LAN transport — that code is not deleted, just not on the critical path (see §7).

---

## 0. The key insight that changes this plan's scope

Before writing any code, it's worth stating the one thing that makes this much smaller than "build a relay integration": **the pairing-offer schema already has a generic slot for exactly this.**

`PairingEndpointSchema` (`packages/relay-protocol/src/pairingOffer.ts:30-37`) already supports a `reachability` field with four values: `'loopback' | 'lan' | 'private-network' | 'public'`. **`'public'` already exists and is already validated** — `isAllowedEndpoint()` (`pairingOffer.ts:43-66`) accepts any well-formed `https://` origin unconditionally (plain `http://` is restricted to recognized private/loopback hosts, but `https://<anything>` passes). A Cloudflare Tunnel hostname (`https://<subdomain>.trycloudflare.com` or a named tunnel's custom domain) is a completely ordinary HTTPS origin from this schema's point of view.

Separately, there is an E2EE layer (`packages/relay-protocol/src/e2ee.ts`) whose header *says* it "applies to BOTH transports: LAN and relay". **As of September 2026 that is a design statement, not deployed behaviour: `sealFrame`/`openFrame`/`deriveSessionKeys` have zero importers outside the protocol package** — not `DirectTransport`, not `RelayStreamBridge`, not `apps/relay`. Nothing on the wire is end-to-end encrypted today. What actually protects a LAN, relay or tunnel hop is (a) TLS on that hop, where present, and (b) the server's request authentication (DPoP-bound access tokens), which stops an intermediary from *replaying* a request but not from *reading* it. An intermediary — including a tunnel provider — can read traffic and, absent TLS, tamper with it.

**Conclusion (corrected):** we still do not need to reconcile or extend the custom relay wire protocol (director/cell assignment, Ed25519 host proofs, the `relay` block in the offer schema) to ship a tunnel. A Cloudflare Tunnel origin can ride in as a plain `reachability: 'public'` entry in the *existing* `endpoints[]` array and get picked up by the *existing* `DirectTransport`. **But it does NOT get protected by an existing E2EE handshake — there isn't one running.** Its confidentiality rests on the tunnel's TLS and on trusting the tunnel provider with plaintext HTTP, exactly like the custom relay today. Either wire `e2ee.ts` into `DirectTransport` (both ends: mobile/web client + a server-side unwrapping layer) as part of this plan, or state in the product that the tunnel provider is a trusted party. The net-new work is therefore **provisioning the tunnel and injecting its URL into the offer, plus an explicit decision on the E2EE gap** — not a new transport.

---

## 1. Decisions to make explicit before starting (don't let these default silently)

| Decision | Recommendation | Why |
|---|---|---|
| Quick Tunnel vs. Named Tunnel for v1 | **Quick Tunnel first (Phase 1), Named Tunnel later (Phase 2)** | Quick Tunnels need zero Cloudflare account, zero domain, zero backend provisioning — they map naturally onto the *already-short-lived* pairing-grant flow (10-minute TTL). Named tunnels solve a different problem (always-on access to an already-paired device) and need real provisioning infrastructure — don't block the first ship on it. |
| Who runs the tunnel process | **The desktop app bundles and manages `cloudflared`**, for now | Matches where the embedded server itself is spawned. A standalone `apps/server` deployment (no desktop shell) can get the same capability later by having the server spawn `cloudflared` itself — same provider interface, different caller. |
| Reuse `'relay'` as the E2EE transport tag, or add `'tunnel'`? | **Reuse `'relay'`** (only relevant once E2EE is actually wired — see §0) | Semantically identical role in the threat model: an untrusted intermediary that must never see plaintext. Adding a new enum value is schema churn for a distinction that doesn't change any security property. Revisit only if UI/diagnostics need to tell them apart later. |
| Keep the custom relay code? | **Yes, park it** | It's a legitimate, well-designed self-hostable fallback for users who explicitly don't want a Cloudflare dependency, consistent with this project's self-host-first positioning. Don't delete it, don't block this plan on fixing its confirmed bugs — they're independent efforts on independent timelines. |
| Named-tunnel provisioning model (Phase 2) | **Vendor-managed by default, BYO-domain as an escape hatch** | Matches the tradeoff already discussed: most users want zero setup; self-hosters who don't want a vendor dependency need an out. |

---

## 2. End-to-end data flow (target state, Phase 1)

```
Desktop app launches
   └─ spawns embedded GeneratorAI server (loopback only, as today)

User clicks "Invite a device" → chooses "Not on this network"
   └─ Desktop main process spawns `cloudflared tunnel --url http://127.0.0.1:<serverPort>`
        └─ cloudflared dials OUT to Cloudflare's edge (outbound-only — same NAT-friendly
           property the custom relay was built for), gets back a random
           `https://<random-words>.trycloudflare.com` origin, prints it to stderr
   └─ Provider parses that URL from cloudflared's output
   └─ Server mints the pairing grant as it does today (`POST /api/auth/pair`), but the
      caller now also supplies the tunnel origin
   └─ Pairing-offer builder appends ONE more entry to `endpoints[]`:
        { origin: "https://<random-words>.trycloudflare.com",
          reachability: "public", priority: 100 }
      (LAN/loopback entries keep their existing lower-priority values, so they're
      still tried first — the tunnel is last resort, exactly like the custom relay
      was designed to be)
   └─ QR/short-code shown to the user, exactly as today

Remote device (phone on cellular, laptop elsewhere) scans/types the code
   └─ Existing endpoint-fallback logic (mobile: buildEndpointCandidates /
      EndpointSupervisor; web/CLI/desktop: AuthenticatedClientRuntime.resolvePinnedEndpoint)
      tries loopback → LAN → this new "public" candidate, in priority order
   └─ On the "public" candidate, DirectTransport just does an ordinary HTTPS fetch —
      no new Transport class needed
   └─ The E2EE handshake (already implemented, already applies to any transport)
      runs over that HTTPS connection exactly as it would over a LAN one
   └─ DPoP-authenticated pairing/API calls proceed identically to the LAN case

When the invite/session is no longer needed
   └─ Desktop tears the cloudflared process down (matches the existing "demand-driven"
      philosophy already in RelayHostBroker — no idle tunnel when nobody needs one)
```

Nothing about the auth, pairing-grant state machine, DPoP verification, or device-revocation logic changes. This is deliberately a transport-layer addition, not an auth-layer one.

---

## 3. New components (Phase 1)

### 3.1 `ITunnelProvider` port

New file: `packages/core/src/domain/ports/ITunnelProvider.ts`, following the same shape as the existing `IBrowserBridge`/`ITerminalHost` ports (pluggable, native-process-backed capability, one interface + multiple adapters):

```typescript
export interface TunnelHandle {
  publicUrl: string;         // e.g. "https://random-words.trycloudflare.com"
  stop(): Promise<void>;
}

export interface ITunnelProvider {
  /** Starts a tunnel pointed at a local port. Resolves once the public URL is known. */
  start(opts: { localPort: number; timeoutMs?: number }): Promise<TunnelHandle>;
  isAvailable(): Promise<boolean>;   // binary present / downloadable for this platform
}
```

Keeping this as a port (not a concrete class reference) means a later "BYO relay" or "named tunnel" provider is a drop-in alternative, and means core services never import a Cloudflare-specific type — consistent with the existing dependency rule (`AGENTS.md §3`: infrastructure implements domain ports, application never imports vendor SDKs directly).

### 3.2 `CloudflaredTunnelProvider` (the concrete adapter)

New file: `packages/core/src/infrastructure/tunnel/CloudflaredTunnelProvider.ts`.

- **Binary management**: `cloudflared` is a single self-contained Go binary (Apache-2.0 licensed — fine to bundle), published per-platform (Windows x64, macOS x64/arm64, Linux x64/arm64). Follow the same precedent already used for `node-pty` prebuilds and Playwright's Chromium download: fetch on first use (or at install time), pin an exact version, verify the published SHA256 checksum before making it executable, cache under the app's data directory (`~/.generatorai/bin/cloudflared` or the desktop's equivalent userData path).
- **Process lifecycle**: spawn via `child_process.spawn` wrapped in a promise, matching the existing pattern in `SandboxedScriptRunner.run()` and `NodePtyHost` — **never `execSync`/`spawnSync`**, which would block the event loop (the performance review flagged this exact anti-pattern elsewhere; don't reintroduce it here).
- **URL extraction**: Quick Tunnel mode prints the assigned hostname to stderr in a recognizable, stable line format (`https://*.trycloudflare.com`) — parse it with a regex, with a bounded timeout (recommend 15s, matching the existing `waitUntilAttached(15_000)` convention already used in `RelayHostBroker`) and a clear timeout error if `cloudflared` never prints a URL (e.g. no network egress, binary missing, Cloudflare edge unreachable).
- **Crash/exit handling**: if the process dies mid-session, surface that as the tunnel handle's public URL going stale — the existing client-side reconnect/fallback logic (which already handles "this endpoint stopped answering" for LAN endpoints) should handle this without new client work, but this needs an explicit test (§5).

### 3.3 Desktop wiring

- `apps/desktop/src/main/` gets a new small module (sibling to `backend-switcher.ts`/`serverConnections.ts`) that owns the `CloudflaredTunnelProvider` instance, exposes a preload-bridge method the renderer can call ("start a tunnel for this invite" / "stop it"), and reports the resulting public URL back to the renderer the same way other desktop-shell capabilities are surfaced today.
- The embedded server itself doesn't need to know a tunnel exists — the tunnel just makes its already-listening loopback port reachable from outside. This keeps the change desktop-shell-scoped for Phase 1 rather than touching `apps/server` route/service code, other than the pairing-offer-building step needing the extra endpoint (§3.4).

### 3.4 Pairing-offer integration

Locate where the server currently builds `pairingEndpoints`/the offer's `endpoints[]` array for a mint (`apps/server/src/routes/auth.ts`, the `POST /api/auth/pair` handler — same code path already reviewed for `AUTH-3`). Add: if the mint request indicates a tunnel is active for this pairing session (passed in from the desktop shell, which is the one that knows the tunnel's current public URL), append one more `PairingEndpointSchema` entry with `reachability: 'public'` and a priority higher (numerically) than every LAN/loopback candidate, so it's tried last. **No change to `pairingOffer.ts`'s schema itself is required** — `'public'` already validates.

### 3.5 Client-side endpoint selection

- **Mobile** (`apps/mobile/src/transport/endpointPlan.ts`): needs a small, genuinely new addition — `buildEndpointCandidates()` currently only calls `addDirect()` for `pairedEndpoint`/`discoveredEndpoints`, and routes the offer's `relay` block through the separate (empty) `buildRelayCandidates()`. Add a third input, `publicEndpoints?: string[]` (sourced from any `endpoints[]` entries with `reachability === 'public'`), and feed them through the **same** `addDirect()` helper used for LAN candidates — it already builds a plain `DirectTransport`, which is exactly what a Cloudflare-tunnel HTTPS origin needs. This is a few lines, not a new transport class.
- **Web / CLI / desktop-as-remote-client** (`packages/client-runtime/src/AuthenticatedClientRuntime.ts`): **verify before assuming** — confirm whether `resolvePinnedEndpoint()` already iterates the full `endpoints[]` array generically (most likely yes, since nothing in the reviewed code suggested reachability-based filtering there, unlike mobile which needs bespoke platform-aware filtering). If it already does, **zero code change needed** on these three surfaces — the public endpoint just becomes one more candidate it tries in priority order. Confirm this with a direct read + a unit test before relying on it; don't ship on an assumption here.

---

## 4. Security checklist specific to this transport

1. **Keep E2EE mandatory over the tunnel candidate, not optional.** Cloudflare's edge terminates TLS — Cloudflare itself can observe plaintext HTTP unless the application-layer E2EE session is what's actually carrying the sensitive payload underneath. Since E2EE already applies to every transport by design (§0), this should be automatic — just add an explicit test asserting the tunnel candidate never gets a "skip E2EE, it's already HTTPS" shortcut anywhere in the client code.
2. **DPoP's `htu` binding needs a test against a Cloudflare-fronted request.** `canonicalHtu` (`packages/auth/src/dpop.ts`) binds the proof to the exact URL the client believes it's calling — confirm this still matches correctly when the request arrives at the origin server via Cloudflare's proxy (check `Host`/`X-Forwarded-*` headers don't cause a mismatch). This is the one place a subtle bug could silently reject every relayed request.
3. **CORS / WebSocket-upgrade origin allowlists need the tunnel origin added dynamically.** `apps/server/src/middleware/cors.ts` and `wsAuth.ts` check against `advertisedEndpoints`/`reachableOrigins` — a freshly-minted `*.trycloudflare.com` hostname won't be in any static allowlist. Add the active tunnel's origin to the in-memory allowed-origin set for the lifetime of that tunnel (mirrors how LAN advertised endpoints are already computed dynamically, not hardcoded).
4. **Rate limiting still matters.** Cloudflare Tunnel doesn't rate-limit your application — the existing `apps/server/src/middleware/rateLimit.ts` still applies and is sufficient; no new work here, just don't assume Cloudflare is doing this for you.
5. **Don't let a Quick Tunnel's random URL leak into logs or the audit trail unredacted beyond what's already reasonable** — treat it with the same care as any other connection-identifying string already covered by `SecurityAuditService`'s redaction (`AUTH-7`/`SEC-12` conventions from the security review).

---

## 5. Testing plan

- **Unit**: `CloudflaredTunnelProvider` with a mocked/faked subprocess (fixture stdout/stderr text) — assert correct URL parsing, timeout behavior when no URL ever appears, and clean process teardown.
- **Integration** (new): `agent-tests/cloudflare-tunnel-pairing-e2e.mjs`, modeled directly on the existing `agent-tests/lan-pairing-e2e.mjs` and `short-code-pairing-e2e.mjs` — spin up a real server, spawn a real `cloudflared` Quick Tunnel (needs network egress; mark this test as requiring network access, skip in fully offline CI), mint a pairing offer that includes the resulting public endpoint, and confirm a DPoP-authenticated request succeeds through it end-to-end. This is the test the custom relay path never had (the earlier review's `TRANS-2` finding existed specifically *because* no such end-to-end test existed) — don't repeat that mistake here.
- **Failure-mode test**: kill the `cloudflared` process mid-session; confirm the client's existing reconnect/fallback logic degrades to "endpoint unreachable" rather than hanging or crashing.
- **DPoP `htu` test** (from §4.2): a request that actually round-trips through a real Cloudflare Tunnel, asserting DPoP verification still succeeds.

---

## 6. Rollout

- New config: `GENERATORAI_TUNNEL_PROVIDER=cloudflare|none`, default `none` — opt-in, matching the existing `GENERATORAI_RELAY_ENABLED` convention.
- Desktop Settings UI: a toggle ("Allow inviting devices that aren't on this network") with plain-language disclosure of what's protected (E2EE payload) versus what Cloudflare can observe (connection metadata/timing, same as any site behind their CDN) — don't overclaim "even Cloudflare can't see anything," since Cloudflare *can* see TLS-terminated connection metadata even though it can't read the E2EE-protected payload.
- No telemetry to a GeneratorAI-operated backend for Phase 1 (Quick Tunnel needs no vendor infrastructure at all) — keeps this consistent with the project's self-hosted, telemetry-free positioning.

---

## 7. What this plan deliberately does NOT do (Phase 2+ / explicitly out of scope for v1)

- **Named tunnels / stable per-install URLs** — real feature, real value (lets an already-paired device reconnect without a fresh invite each time), but needs vendor-side Cloudflare API provisioning (a tunnel + DNS record per install) and a decision on who owns that Cloudflare account/domain and how its credentials are protected (the existing `packages/secrets` vault is the right place to store a provisioned tunnel's credentials once this lands — another example of activating existing infrastructure rather than building new). Sequence this after Phase 1 ships and the endpoint-selection plumbing (§3.5) is proven.
- **Fixing the custom relay's route-mismatch bug** (`TRANS-2` from the security review) — independent effort, not a prerequisite for this plan, since this plan bypasses that code path entirely.
- **BYO-relay / self-hosted alternative to Cloudflare** — worth offering eventually for users who don't want any third-party dependency (via `rathole`/`frp`, per the earlier discussion), but a second, separate provider implementation behind the same `ITunnelProvider` port — don't build it until Phase 1 is proven and there's real user demand for it.
- **Standalone (non-desktop) server spawning its own tunnel** — same `ITunnelProvider`/`CloudflaredTunnelProvider` should work for this later; not blocking Phase 1, which is scoped to the desktop-app-as-host scenario the user asked about.

---

## 8. Suggested sequencing

1. Spike: confirm `AuthenticatedClientRuntime.resolvePinnedEndpoint` behavior with `endpoints[]` entries of mixed `reachability` (§3.5) — this determines how much client-side work is actually needed and should be resolved before estimating the rest.
2. `ITunnelProvider` port + `CloudflaredTunnelProvider` + binary management + unit tests.
3. Desktop wiring (spawn/stop, preload bridge) + pairing-offer integration (§3.4).
4. Mobile `endpointPlan.ts` addition (§3.5) — small, isolated change.
5. Security checklist items (§4) — DPoP `htu` test and dynamic CORS/origin allowlisting are the two that could silently break things if skipped.
6. New end-to-end test (§5) mirroring the existing LAN/short-code E2E test pattern.
7. Settings UI + rollout flag (§6).

Steps 2–4 can run in parallel once step 1's answer is known, since they touch disjoint parts of the codebase (core/infrastructure, desktop main process, mobile transport respectively).
