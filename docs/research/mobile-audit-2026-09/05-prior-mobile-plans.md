# 05 — Prior mobile plans: consolidated summary (docs only, not verified against code)

Sources read in full: `docs/MOBILE_COMPANION_APP_ARCHITECTURE_AND_PLAN.md` (914 lines, "COMPANION"),
`docs/MOBILE_FEATURE_PARITY_PLAN.md` (184, "PARITY"), `docs/MOBILE_DESIGN_OVERHAUL.md` (184, "OVERHAUL"),
`docs/MOBILE_NATIVE_REDESIGN_PLAN.md` (172, "NATIVE"), `docs/CLOUDFLARE_TUNNEL_RELAY_PLAN.md` (164, "TUNNEL"),
`docs/SECURITY_AUTH_RELAY_MOBILE_ARCHITECTURE_PLAN.md` (2101, "SECURITY"; §1, §8, §14, §19–21, §27, §30–32 read).
Grep-sourced sections: `docs/V2_REMAINING_WORK_AUDIT.md`, `docs/APPLICATION-REVIEW-2026-09.md`,
`docs/SECURITY_AUTH_PAIRING_REVIEW.md`, `docs/SECURITY_AUTH_RELAY_IMPLEMENTATION.md`, `docs/USER_GUIDE_ACCESS.md`,
`docs/REVIEW-FIX-TRACKER.md`, `docs/ARCH_PERF_AUDIT_2026-09-05.md`, `docs/V2_IMPLEMENTATION_TRACKER.md`,
`docs/ARCHITECTURE_V2_MASTER_PLAN_FINAL.md`, `docs/ARCHITECTURE_V2_SYSTEM_DESIGN.md`, `docs/SYSTEM_ARCHITECTURE.md`,
`docs/VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md`, `docs/VOICE_AGENT_REALTIME_STT_PLAN.md`, `docs/AGENTS_FEATURE_RESEARCH_AND_PLAN.md`,
`.github/docs/apps.md`, `.github/docs/feature-agents.md`, `.github/docs/feature-integrated-browser.md`, `apps/mobile/README.md`.

## 0. Timeline (from `git log -- apps/mobile` and doc commit dates)

| Date | Commit | What |
|---|---|---|
| 2026-07-31 | (doc date) | SECURITY plan written: "There is no mobile application" (§1 item 8); mobile is Phase 6 of 7 |
| 2026-08-01 | (doc date) | SECURITY_AUTH_RELAY_IMPLEMENTATION: auth/relay as-built; mobile "next", "requires no new server work" (§12) |
| 2026-08-02 | `2c3b2c9` Baseline V0.0.1-alpha | 125 files / 15,642 lines of `apps/mobile` land in one commit **together with** COMPANION, PARITY, OVERHAUL and SECURITY docs. So COMPANION's "No code has been written" header was already stale at commit time; PARITY ("read-only status viewer", 15%) and OVERHAUL were written mid-build. |
| 2026-08-05 | `80484dd` issue fixes | 56 files / +5,675: NATIVE doc + its build order (SwipeableRow, Toast, ActionSheet, accessibility.ts, scrollToTop, preferences, fuzzyMatch, voice/useVoiceInput, terminal/TerminalView rewrite, workbench sections rewritten) |
| 2026-08-06 | `9a22090` | LAN connectivity + AuthProvider fix |
| 2026-08-12/14 | `43fb3d2`, `b434466`, `21789c3` | NewChatSheet directory changes; `exec:computer` scope label; 17-theme token regeneration (+14k lines tokens.generated.ts) |
| 2026-08-25 | `fc494be` | useChatStream touch (Phase 4-B hosts) |
| 2026-09-03 | `205909b` architecture overhaul | `SseClient.ts` **deleted**; MuxStreamProvider / muxTransport / useGlobalStream / useTwoPhaseStop added; voice: pcm.ts, wavEncoding, useTextToSpeech, live useVoiceInput |
| 2026-09-06 | `d928838` | README, eas.json, EAS_PROJECT_ID, Android cleartext plugin, PermissionCard, notificationFilter, pushStatus, deviceRequests; TUNNEL doc last touched |

## 1. What each doc proposed

### 1.1 SECURITY (2026-07-31) — the original mandate
- **Architecture:** mobile is "just another paired device" on the five-plane model (§8.1). Principal type `paired-device` (§8.2). Shared `AuthenticatedClientRuntime` consumed by web/CLI/desktop/mobile (§19.1); a new client only supplies secure storage, device key, pairing UI, transport adapters (§19.2 checklist).
- **Stack (§20.1):** Expo/RN, Expo Router, `expo-secure-store`, native keystore for non-extractable keys, camera/QR, WebSocket+fetch, "xterm-compatible terminal rendering, or a mobile-optimized terminal component", push "in a later phase", keep-awake only during active runs.
- **Source layout (§20.2):** `src/auth/{device-key,dpop,token-session,secure-storage}`, `src/transport/{endpoint-supervisor,lan-transport,relay-transport,e2ee-session,host-store}`, plus pairing/projects/chats/workflows/terminal/notifications/diagnostics.
- **Secure storage (§20.3):** Keychain when-unlocked-this-device-only / Keystore; "Do not rely on AsyncStorage".
- **Pairing flow (§20.4):** 12-step QR → consent (host name, endpoint, fingerprint, transport options, requested scopes) → DPoP exchange → grant consumed.
- **Connection strategy (§20.5):** pinned LAN → optional Tailscale → relay if enabled → bounded backoff; resume validates token and replays cursors. "Local-only mode never contacts the relay."
- **Feature scope (§20.6):** Phase 1 = pair/unpair, list projects/workspaces, view chats+workflow state, send prompts, approve/reject, event streams, view diffs/reviews. Phase 2 = terminal (after explicit `exec:terminal`), file browser/**editor**, browser preview, attachments+voice, push.
- **Roadmap Phase 6 (§27):** 10 tasks; exit = "pair, reconnect, revoke, and operate with a minimal scope set over LAN and relay".

### 1.2 COMPANION (committed 2026-08-02, header says "Proposal for review. No code has been written")
- **Thesis (§0):** RN+Expo delivers ~85% at native quality; one codebase → two store artifacts; "the single most important architectural decision" is extracting `design-tokens`, `client-core`, `client-transport` shared packages (§6.1) and migrating `apps/web` onto them in Phase 0 ("non-negotiable").
- **Feature inventory (§2):** Tier A 41 / Tier B 24 / Tier C 12 + 3 mobile-only (push, biometric lock, Live Activity). Tiering keyed to `DEFAULT_MOBILE_SCOPES` (§1.2).
- **Hard features (§5):** terminal = xterm.js in WebView, RN owns the socket, 16 ms base64 batching, gated on `exec:terminal` + biometric (§5.1); diff = server-computed hunks + `GET /api/highlight` Shiki token endpoint keyed by blob SHA, on-device Shiki JS-engine fallback flagged (§5.2); streaming = shared reducer, 16 ms coalesce, memo'd blocks, LegendList, 60 fps @ 200 tok/s on Pixel 6a (§5.3); DAG = Skia read-only canvas + outline editor, authoring stays desktop (§5.4); file manager (§5.5); `marked`→RN markdown (§5.6); widgets = WebView against the separate `WIDGET_PORT` origin with hardening (§5.7); browser = MJPEG frames into expo-image/Skia, tap-to-click, gated on `exec:browser` (§5.8); voice = expo-audio PCM resampled to 16 kHz over `/api/stt/stream` (§5.9).
- **Stack (§4):** Expo SDK 57, expo-router 6, NativeWind v4.2, TanStack Query 5, zustand 5, `@legendapp/list`, Reanimated 4, `@gorhom/bottom-sheet` 5, Skia, react-native-webview, `react-native-quick-crypto` polyfill so `client-runtime` runs unmodified, new `expo-device-key` native module (Secure Enclave / StrongBox, ~250 LOC, private key never enters JS, software fallback reported in posture), SecureStore, MMKV (encrypted), expo-notifications, `@bacons/apple-targets` Live Activity, EAS Build/Update, Sentry.
- **App layout (§6.2):** expo-router mirrors web URLs 1:1; tabs Activity · Chats · Runs · Projects; routes for chats/[id], workflows/[id]/runs/[runId], automations/[id], projects/[id]/codebases/[cid], diff/[workspaceId]/[path], terminal/[workspaceId], browser/[workspaceId], widget/[extensionId]/[widgetId], settings/*.
- **Connection lifecycle (§6.3):** SecureStore session → biometric gate → EndpointSupervisor (LAN → private network → relay) → `server-info` serverId pin check before any credential → token refresh → MMKV hydrate → REST replay → ticket → SSE at `afterSeq`; background detaches SSE, keeps push.
- **Server work (§7):** S1 push registry, S2 push dispatcher (EventBus → APNs/FCM), S3 highlight endpoint, S4 structured hunks, S5 per-device scope elevation request/approve, S6 posture `secretStore.secure` for mobile, S7 route-policy audit. "No changes to the relay, the E2EE protocol, the pairing protocol, DPoP, or the SSE contract."
- **Design (§8):** one token set three renderers; surfaces/status/6 accents ported verbatim from `globals.css`; radius 6/8/10; system sans + bundled JetBrains Mono; System/Light/Dark (dark default); RightPane → bottom sheet with snap points [12%, 55%, 92%], true side pane on tablets; key screens Chat, Workflow run (Timeline/Graph/Changes), Changes/review, Activity, Security settings ("mobile's signature screen"); motion/haptics/a11y (§8.5).
- **Phases (§10):** 0 shared packages → 1 shell/pairing/security → 2 chat → 3 runs/automations/diffs/review → 4 push/background/elevation/mDNS → 5 terminal/browser/widgets/voice/attachments/scripts/DAG outline → 6 tablet/a11y/l10n/store readiness.
- **Deferred F1–F14 (§11):** DAG authoring, long-form prompt authoring, hook editing, MCP JSON editing, extension authoring, local-dir codebase linking, ⌘K, multi-pane, DOM inspector, sandbox/Docker controls, SDK/MCP stdio, offline authoring queue, Watch/widget quick-approve, multi-host switching.
- **Open questions (§13):** highlight endpoint vs on-device; multi-host; Expo Push vs direct APNs/FCM (leans direct); tablet timing; terminal in v1; distribution (public store vs internal); Phase 0 sequencing.

### 1.3 PARITY (committed 2026-08-02) — "the contract for what mobile ships"
- **Starting position (§0):** "read-only status viewer with a plain text box… roughly 15% of what the web app does."
- **Gap catalog (§1):** composer (model picker P0, reasoning effort P0, agent mode P0, gate banner P0, gauge P1, context tier P1, permission mode P1, codebase picker P1, slash/@-mentions P2, attachments P2 gated, voice P2 gated); right pane 8 tabs (Changes P1 sheet, Files P1, Terminal P1, Plan P1, Browser P2 view-only, Tasks P2, Codebase P2, Widgets P3 deferred); settings (Providers P0, default model P0, Notifications P1, Source control/Browser+terminal/Skills/MCP P2 read-only, Extensions/Templates P3 deferred); workflows (list/detail/runs/stage streaming P1; start/pause/cancel **not feasible**; creation/automation creation **deferred, user agreed**).
- **UX rules (§2):** 3–5 tabs (Activity/Chats/Runs/Projects); right pane → gorhom bottom sheet with grabber + medium/large detents; composer row = model + mode + send, "⋯" opens a settings sheet; blocked actions state the reason (`FeatureLocked`); urgency ordering; every list gets loading/empty/error ("this was a real bug: an unauthenticated screen rendered as 'No chats yet'").
- **Phases (§3):** A chat parity (7 items), B context sheet (Changes·Files·Plan·Terminal; files "syntax-plain with mono font"), C settings, D workflows/runs, E polish.
- **Definition of done (§5):** light+dark, list states, no raw 403, typecheck+test, exercised in Expo **web preview at 393×852** (note: web preview, not a device).

### 1.4 OVERHAUL (committed 2026-08-02) — "Supersedes the phased catalogue in PARITY… answers what the app should be"
- **Research (§1):** seven patterns from Linear/Height/Vercel/Raycast/GitHub Mobile/Claude/ChatGPT/Warp: side panel → bottom sheet; detents ~28/60/92%; controls collapse into one overflow surface; motion is IA (press 0.96–0.97 on UI thread); skeletons not spinners; haptics; 44pt targets / 56–64pt rows.
- **Design language (§2):** tokens from `@generatorai/design-tokens`; surface ladder background→card→raised→overlay; radius rows 12 / cards 16 / sheets 24 / pills 999; type scale 11–30; motion press 120 ms · enter 180 ms · sheet spring damping 50; `<Screen>` scaffold with collapsing large title.
- **IA (§3):** tabs Activity · Chats · **Work** · Projects (Settings via header button, "settings is not a peer destination"); Work = segmented Workflows/Runs/Automations; Chat detail = transcript + composer + **Workbench** sheet (Changes · Files · Terminal · Tasks · Plan · Browser) "one sheet with a segmented header, not six tabs".
- **Component inventory (§4):** 18 `ui/` primitives (motion.ts, Pressable, Screen, Card, Chip, Button, IconButton, SegmentedControl, ListRow, SectionHeader, Badge/StatusDot, Skeleton, ProgressRing, Sheet on gorhom, Toast, Switch, Empty/ErrorState, Fab); chat blocks incl. `WidgetBlock` = explicit "not supported on mobile" placeholder; screens Activity, Chats, Work, Projects, Chat, Run, Automation, Project, Changes, Diff, Settings ×10.
- **Not feasible (§5):** widget canvas **not supported**; DAG authoring deferred; automation creation deferred; run start/pause/cancel/retry **blocked by scope**; browser **view-only**; file editing read-only; commit/PR not present; syntax highlighting degraded (mono + diff tint + language badge); inline review comments **read-only threads**. "Everything else in the web app is implemented."
- **Build order (§6):** design system → chat → new-chat → Activity → Settings → Work → verify (typecheck/lint/tests/**live device sweep** light+dark).

### 1.5 NATIVE (committed 2026-08-05) — "Supersedes OVERHAUL… what is actually wrong with what we shipped"
- **Scope decisions (header):** keep shared design-tokens identity + additive native layer; iOS and Android platform-adaptive; **scope elevation is requested, never self-granted** (`PUT /api/auth/devices/:id/scopes` needs `admin:devices`, phone never holds it); plan first then one pass.
- **Audit (§1):** `/impeccable audit` score **8/20 "Poor — major overhaul"**; Platform Conformance FAIL ("a competent single-platform prototype"). P0: mic button dead no-op; reasoning effort + context tier discarded (PATCH harnessConfig never called); send failure silent + draft lost; transcript error renders as empty; six unvirtualized surfaces; Reduce Motion never queried; Dynamic Type breaks layout; Screen back strands deep links. P1: keyboard offset hard-coded 44pt; no edge-to-edge/predictive back/softwareKeyboardLayoutMode; `/pair`, `/revoked`, `/settings/security` bypass the design system; no swipe/long-press; sheet drags only by grabber; no stream-connection state; FilesSection drops repos 2..n; diff no horizontal scroll; plan undecidable from Workbench; automation toggle absent; `/settings/tools` lists locked features with no request path; no offline indicator; ProgressRing invisible to AT. P2/P3: dead components, two sheet impls, unused BottomSheetModalProvider, arbitrary values, `?new=1` never cleared, `prefs.lastRoute` unused, 15 unused deps. Positives: token pipeline, haptic vocabulary, collapsing title, Sheet settle, **SseClient "better than the web's"**, extracted pure logic.
- **Parity table (§2):** targets after the pass: reasoning effort/context tier persisted; animated gauge; **hold-to-dictate voice**; `/browser` `/terminal` slash commands open Workbench; @-mentions attach content; attachments gated **with reason + request path**; real codebase count; per-message long-press copy/share/select ("exceeds web"); jump to latest; paged older messages; stream state banner; Workbench + plan decisions, multi-repo files, scrollable diffs, zoomable browser, task cancel; swipe archive/unarchive/delete + rename + search; run stage output + retry/cancel gated with reason; automations enable/disable + run now gated; codebase detail + branches + worktrees; settings + text size, motion, haptics, default model, skill/MCP toggles, scope requests. Still deferred: DAG authoring, widget canvas, commit/PR, file editing. Desktop-only Electron surfaces (menus, tray, WebContentsView) are "not portable, and nothing in it is a mobile gap".
- **Native layer (§3):** ReduceMotion in every config; fontScale-aware sizing; 44pt/48dp floors; swipe/long-press/drag-anywhere sheets/pinch-zoom/double-tap-tab; haptics on swipe/detent/refresh; `useAnimatedKeyboard`; edge-to-edge + translucent bars; a11y roles/hints/live regions; every list virtualized, base64 off JS thread, one skeleton clock, queries paused when unfocused.
- **Build order (§4):** foundation primitives → new primitives (Toast, SwipeableRow, ActionSheet, SearchField, KeyboardAvoider, ScrollToTop, themed tab bar) → config → screens → features → verify.

### 1.6 TUNNEL (last touched 2026-09-06) — off-LAN transport for mobile
- Cloudflare Quick Tunnel as **default off-LAN transport for v1**, supersedes custom `apps/relay` on the critical path (parked, not deleted) (§0, §1).
- Tunnel URL rides in as a `reachability:'public'` entry in `endpoints[]`; `DirectTransport` handles it; mobile `endpointPlan.ts` needs a `publicEndpoints` input through `addDirect()` (§3.5).
- **Corrected E2EE claim (§0):** `e2ee.ts` has "zero importers"; "Nothing on the wire is end-to-end encrypted today"; confidentiality rests on tunnel TLS + trusting the provider. (§2's data-flow and §4.1 still say "E2EE handshake (already implemented, already applies to any transport)" — an internal inconsistency left in the doc.)
- Desktop bundles/manages `cloudflared`; `ITunnelProvider` port; `GENERATORAI_TUNNEL_PROVIDER=cloudflare|none` default none (§3, §6). Named tunnels, BYO relay, standalone server tunnel are Phase 2+ (§7).

## 2. Done vs pending — as each doc states it

| Doc | Marked done | Marked pending / not started |
|---|---|---|
| SECURITY §27 | Nothing (analysis only) | Phase 6 entirely |
| SECURITY_AUTH_RELAY_IMPLEMENTATION §12 | Server side "requires no new server work"; `DEFAULT_MOBILE_SCOPES` + negative tests | Mobile client: secure storage, QR scanner, consent UI, client-runtime adoption |
| COMPANION | Nothing ("No code has been written") | All phases 0–6, S1–S7 |
| PARITY §1 | Send text, stop, approve gate, list chats/runs/projects, Appearance, Security/devices, Automation list, Run detail basic | Everything P0–P3 in §1; §3 phases A–E |
| OVERHAUL §5 | "Everything else in the web app is implemented" (implicit claim) | Widget canvas, DAG, automation creation, run controls, browser input, file editing, commit/PR, highlighting, inline comments |
| NATIVE §1–2 | Token pipeline, haptics, Screen title, Sheet settle, SseClient, pure-logic extraction, model picker/agent mode | Every P0/P1/P2 finding; every "After this pass" cell in §2 |
| REVIEW-FIX-TRACKER | G12 EAS build config + push id DONE; G13 Android cleartext DONE; G15 notification prefs DONE; A4 mobile PermissionCard DONE (2026-09-04 log) | G14 revoke-device route **PARTIAL** (server alias test failing) |
| ARCH_PERF_AUDIT 2026-09-05 §2, §6 | "mobile `global` scope subscription" closed; mobile PermissionCard; mobile shares client-core reducer ("Good") | — |
| V2_REMAINING_WORK_AUDIT §0-A, §4 Phase 5 | Two-phase Stop correct on mobile | "Mobile → mux transport, plus missing `global`-scope subscription" **M**; `MOBILE_CAPABILITIES` missing; `fileAttachment: enforced(true)` while no `onAttach`; MuxStreamClient backoff reset → reconnect storm; port cost/cache accounting to mobile |
| V2_IMPLEMENTATION_TRACKER W48 | route-level fixtures | "mobile/CLI `fetch`-based client adoption… genuinely not started" |
| APPLICATION-REVIEW-2026-09 §2, §9 | "~80% code-complete, ~10% shippable"; 196 real tests; uses shared client library "more faithfully than web" | "Never once compiled for a phone"; push does nothing (EAS project id unset — since addressed per G12); relay cannot run; hardware-key module never implemented (honest fallback); verdict: "Commit to a device build pipeline and one physical phone this cycle, or freeze and mark experimental" |
| SECURITY_AUTH_PAIRING_REVIEW | TRANS-10 mobile credential storage "genuinely strong" | TRANS-3 `buildRelayCandidates()` returns `[]`; no `RelayTransport.ts` anywhere; P1-2 "implement RelayTransport on mobile first" |
| `.github/docs/apps.md` mobile section | shares client-core reducer | "still uses per-scope stream endpoint… subscribes only to chat scope" (contradicted by 09-05 audit + 09-03 commit) |
| `apps/mobile/README.md` | EAS profiles, EAS_PROJECT_ID, cleartext plugin, notification prefs, `PUT /api/auth/push-token/mute` | "no message-level encryption above the transport (e2ee.ts unwired)"; screens "need a device" |
| VOICE_MODULE_FINAL F.5 | Mobile live PCM via `useAudioStream`, pcm.ts normalisation, sentence-aligned TTS playlist | Parakeet segment drops (upstream) |
| feature-agents.md | Agent picker in NewChatSheet read-only | Authoring stays on web |

## 3. Explicitly stated decisions and constraints

**Companion, not standalone**
- "The mobile app is a pure client of the same HTTP + SSE + WS contract… There is no new backend" (COMPANION §1.1). "The phone is a control plane, not an IDE… delegate → monitor → review → approve" (COMPANION §9.1). "Build mobile first around chats, status, approvals, and diffs" (SECURITY §32.11).
- One codebase, two store artifacts; literal single binary impossible (COMPANION §0).

**Scope model (read + chat + approve + review; no exec/admin/write:workflows)**
- `DEFAULT_MOBILE_SCOPES` = read:* + write:chats + write:reviews + stream:events + exec:agent; withheld exec:terminal/browser, write:files/projects/workspaces/**workflows**, admin:* (COMPANION §1.2; SYSTEM_ARCHITECTURE §7.3; USER_GUIDE_ACCESS §6 "mobile = same minus write:workflows").
- "Mobile should not receive exec:terminal, exec:browser, or any administrative scope by default" (SECURITY §8.3). Terminal input deferred from initial release (SECURITY §30.5).
- Run start/pause/cancel/retry **not feasible** because `write:workflows` is withheld: "Granting it would let a lost phone mutate pipelines… a product decision, not a bug" (PARITY §4; OVERHAUL §5). NATIVE §2 softens to "gated with reason".
- Scope elevation requested from the phone, approved on a trusted device, never self-granted (NATIVE header §3; COMPANION S5). Terminal grant = explicit per-device + biometric (COMPANION §5.1).
- Counter-view: APPLICATION-REVIEW §5.2 — "`write:chats` is equivalent to host code execution… reconsider whether `write:chats` belongs in a default phone grant at all."

**Transport / relay**
- LAN-first, relay fallback, E2EE, host-identity pinning before any credential (COMPANION §6.3; SECURITY §20.5). Local-only mode never contacts relay (SECURITY §20.5, §14.2).
- TUNNEL: Cloudflare Quick Tunnel replaces custom relay as v1 off-LAN default; custom relay parked; E2EE is **not** actually wired.
- README: LAN pairing offers are `http://<lan-ip>`; Android cleartext opt-in justified only by `PairingEndpointSchema` refusing non-private `http:`.
- MASTER_PLAN_FINAL §5.8 / V2_SYSTEM_DESIGN: one multiplexed connection matters most on mobile; `TransportCapabilities` may switch mobile to block delivery instead of token streaming on poor links.

**What was deemed infeasible on mobile and why**
| Item | Verdict | Why (doc) |
|---|---|---|
| Visual DAG authoring | Deferred / desktop-only, "user agreed" | No React Flow equivalent; "node-graph editing at 393pt is not a real workflow" (PARITY §4, OVERHAUL §5, NATIVE §2, COMPANION F1) |
| Widget canvas | COMPANION: Tier B via WebView on `WIDGET_PORT` origin. OVERHAUL/NATIVE: **not supported**, explicit placeholder | "RN has no iframe; a WebView cannot enforce the origin isolation the security model depends on" (OVERHAUL §5); PARITY §4 "needs its own design pass" |
| Automation creation | Deferred, "user agreed" | Multi-step cron/webhook form, low value (PARITY §4) |
| Browser input forwarding | View-only first | Desktop-viewport page, mis-targeted taps (PARITY §4, OVERHAUL §5); COMPANION §5.8 planned tap-to-click gated on exec:browser |
| File editing | Not planned | No `write:files`; "not a phone task" (all four) — contradicts SECURITY §20.6 Phase 2 "file browser/editor" |
| Commit / open PR | Not present | High-risk, low-frequency, "wrong device" (OVERHAUL §5, NATIVE §2) |
| Syntax highlighting | Degraded (mono + diff tint) | "No Shiki/TextMate on RN" (OVERHAUL §5); COMPANION §5.2 instead proposed server `GET /api/highlight` |
| Inline review comments | Read-only threads | RN text selection cannot report ranges (OVERHAUL §5); COMPANION §2.5 had it as flagship Tier A |
| Local-dir codebase linking | Desktop-only affordance | Phone cannot see host FS (COMPANION F6) |
| ⌘K, multi-pane, DOM inspector, MCP JSON, hooks matrix, extension authoring | Deferred | COMPANION F3–F9 |
| Live voice STT | Was batch-only "by explicit documented design" (VOICE_AGENT §1); later **reversed** — `expo-audio` 57 `useAudioStream` enabled live PCM (VOICE_MODULE F.5) |

**Design system**
- Tokens must come from `@generatorai/design-tokens`, never re-invented (OVERHAUL §2, NATIVE header §1, COMPANION §8.1). Dark default, 6 accents (COMPANION §8.2); SYSTEM_ARCHITECTURE says 17 theme families now.
- Tabs ≤5; settings not a tab (OVERHAUL §3); right pane → single detented sheet; composer = 2 inline controls + overflow sheet.

**Verification standard**
- PARITY §5: Expo web preview at 393×852. OVERHAUL §6 / NATIVE §4: live device sweep. APPLICATION-REVIEW: "never once compiled for a phone… one physical phone this cycle, or freeze". COMPANION §9: Maestro + react-native-performance CI gate, `agent-tests/mobile-security-e2e.mjs`.

## 4. Contradictions between the docs

1. **Chronology / status headers.** COMPANION says "No code has been written" and PARITY says "read-only status viewer, ~15%" yet both are committed in `2c3b2c9` alongside 15.6k lines of mobile code. OVERHAUL (same commit) claims "Everything else in the web app is implemented." Three incompatible baselines on one day.
2. **Tab bar naming.** COMPANION §8.3 and PARITY §2 Rule 1: Activity · Chats · **Runs** · Projects. OVERHAUL §3: Activity · Chats · **Work** · Projects (Work segmented). Git shows `(tabs)/runs.tsx` persisted through `80484dd`.
3. **Widgets.** COMPANION §5.7 "nearly free" via WebView against the separate origin with hardening; OVERHAUL §5 / NATIVE §2 "not supported — separate-origin iframe sandbox has no RN equivalent"; PARITY §4 middle ground ("WebView can host it, security model needs a design pass").
4. **Review comments.** COMPANION §2.5 "flagship review-from-the-sofa flow… tap a line to open the review-comment composer" (Tier A); PARITY §1.2 "sheet + read/comment"; OVERHAUL §5 "read-only threads" because selection ranges are unreliable.
5. **Syntax highlighting.** COMPANION §5.2 server-side Shiki token endpoint S3 (Phase 3); PARITY/OVERHAUL: degraded mono text, "not worth the bundle cost".
6. **Run controls.** COMPANION §2.2 Tier A "start/pause/resume/cancel/retry"; SECURITY_AUTH_RELAY_IMPLEMENTATION/USER_GUIDE presets: mobile lacks `write:workflows`; PARITY/OVERHAUL "not feasible"; NATIVE "gated with reason" + request-access flow.
7. **File editing.** SECURITY §20.6 Phase 2 lists "File browser/editor"; every later doc: not planned.
8. **Browser preview.** COMPANION §5.8 full tap/long-press/keyboard forwarding gated on exec:browser; PARITY/OVERHAUL view-only; NATIVE "zoomable browser".
9. **Voice.** COMPANION §5.9 live PCM over WS; VOICE_AGENT plan: batch-only, "real native-module effort"; VOICE_MODULE F.5: live now works via `useAudioStream` (premise expired). NATIVE P0 says the mic button was a dead no-op.
10. **Transport.** COMPANION §4.3 in-house `SseClient` on `expo/fetch`; NATIVE praises it; MASTER_PLAN_FINAL "mobile/CLI stay on SSE… evolution not rewrite"; V2_SYSTEM_DESIGN: WebSocket mux is PRIMARY for mobile; `205909b` deleted SseClient for muxTransport; `.github/docs/apps.md` still says mobile is on per-scope SSE chat-only, while ARCH_PERF_AUDIT 09-05 says `global` subscription is present.
11. **Off-LAN path.** SECURITY §17 + COMPANION: custom director/cell relay with E2EE; PAIRING_REVIEW: no client can use it; TUNNEL: Cloudflare replaces it and E2EE is unwired; but TUNNEL §2/§4.1 itself still asserts E2EE "already implemented, already applies to any transport".
12. **Push provider.** COMPANION §13.3 leans **direct APNs/FCM** (no third party); README/G12 ship **Expo Push** (`getExpoPushTokenAsync`, `EAS_PROJECT_ID`).
13. **Device key module.** COMPANION §4.2 `expo-device-key` Swift/Kotlin, "private key never enters JS"; APPLICATION-REVIEW: "hardware-key module was never implemented" (software fallback honestly reported); PAIRING_REVIEW TRANS-10 describes hardware-first with fallback as working.
14. **Sheet implementation.** OVERHAUL §4: rebuild `Sheet` on `@gorhom/bottom-sheet` "replaces the RN Modal implementation"; NATIVE P2: "two competing sheet implementations plus an unused BottomSheetModalProvider" and "sheet drags only by grabber" — i.e. the gorhom migration did not fully happen.
15. **Definition of done.** PARITY §5 accepts Expo **web preview**; OVERHAUL/NATIVE require a **live device**; APPLICATION-REVIEW: never built for a device.
16. **Companion doc's shared-package precondition.** COMPANION Phase 0 says `apps/web` must migrate to `client-core` before any mobile code; PERF_REVIEW/MASTER_PLAN: mobile is the **only** consumer of `client-core`'s event router and web still has its own 2,100-line duplicate — Phase 0 was inverted (mobile first, web never).
17. **Multi-repo files.** COMPANION §2.1 create chat with "up to 3 codebases"; NATIVE P1 "FilesSection drops repos 2..n"; NATIVE §2 "codebase context hardcoded 0".

## 5. Merged "previously planned but not yet delivered" checklist

Items any doc planned that no doc marks done (docs only; needs code verification). Grouped; source in brackets.

**Build / release / verification**
- [ ] Build and run on a physical iOS + Android device; device-sweep light+dark (OVERHAUL §6, NATIVE §4, APP-REVIEW §9). EAS profiles exist (G12) but no doc records a device build succeeding.
- [ ] `agent-tests/mobile-security-e2e.mjs` mirroring security/host-pinning E2E (COMPANION Phase 1 exit)
- [ ] Maestro + `react-native-performance` CI gate; 60 fps @ 200 tok/s on Pixel 6a (COMPANION §5.3, §9)
- [ ] Kill-mid-stream resume with zero lost/duplicated events test (COMPANION Phase 2 exit)
- [ ] Store readiness: privacy manifests, `usesNonExemptEncryption` declaration, background-mode justification, EAS Update channels, Sentry parity, localization scaffold (COMPANION Phase 6)
- [ ] `MOBILE_CAPABILITIES` ledger with truthful enforcement (V2_REMAINING §4 Phase 5; `fileAttachment` currently mis-declared)

**Transport / security**
- [ ] Off-LAN transport that actually works: either `RelayTransport` on mobile (`buildRelayCandidates()` returns `[]`; PAIRING_REVIEW P1-2) **or** TUNNEL plan `publicEndpoints` in `endpointPlan.ts` + desktop `cloudflared` + CORS/WS origin allowlist + DPoP `htu` test (TUNNEL §3.5, §4, §5, §8)
- [ ] Wire `e2ee.ts` into the client/server path, or state the tunnel provider is trusted (TUNNEL §0; README)
- [ ] `expo-device-key` native Secure Enclave/StrongBox module (COMPANION §4.2; APP-REVIEW "never implemented")
- [ ] Biometric app-open lock + biometric re-auth before exec:* grants / destructive HITL (COMPANION §4.2, §8.4)
- [ ] Scope-elevation request/approve flow S5 + `/settings/tools` "Request access" path (COMPANION §7; NATIVE header §3, P1)
- [ ] G14 revoke-device route + confirmation — PARTIAL, server alias test failing (REVIEW-FIX-TRACKER)
- [ ] `MuxStreamClient` backoff reset before attach → reconnect storm (V2_REMAINING §0-A)
- [ ] Posture `secretStore.secure` reporting for mobile devices S6 (COMPANION §7)
- [ ] mDNS LAN discovery (`react-native-zeroconf`) (COMPANION Phase 4)
- [ ] Multi-host switching F14 (deferred)

**Push / background**
- [ ] Server push dispatcher on EventBus → APNs/FCM with actionable HITL categories S1/S2 (COMPANION §7, Phase 4) — README shows token registration + mute route only; direct APNs/FCM vs Expo Push decision (COMPANION §13.3) resolved de facto to Expo
- [ ] Lock-screen resolution of an approval gate while app is killed (COMPANION Phase 4 exit)
- [ ] iOS Live Activity / Android ongoing notification for run progress; `expo-background-task` reconciliation; badge counts (COMPANION §4.4, Phase 4)
- [ ] Per-category server-side mute (server has only a two-category mute; README)

**Chat / composer**
- [ ] Reasoning effort + context tier persisted via `PATCH /api/chats/:id { harnessConfig }` (NATIVE P0)
- [ ] Send-failure surfaced + draft preserved; transcript error state distinct from empty (NATIVE P0)
- [ ] Attachments (`write:files` gated with reason + request path) — `onAttach` never passed (NATIVE §2; V2_REMAINING)
- [ ] Slash commands `/browser` `/terminal` → Workbench; skills/prompts from `/api/system/artifacts`; `@`-mentions attaching content (PARITY P2; NATIVE §2)
- [ ] Codebase picker with real count/list (PARITY P1; NATIVE "hardcoded 0")
- [ ] Jump-to-latest pill; paged older messages beyond 200 cap; stream-connection banner; offline indicator (COMPANION §8.4; NATIVE §2, P1)
- [ ] Per-message long-press copy/share/select (NATIVE §2)
- [ ] Permission mode control (PARITY P1) — note APP-REVIEW §5.1: mode was shown live on mobile but not enforced server-side
- [ ] Background tasks panel: read + spawn, task cancel (COMPANION §2.1; NATIVE §2)
- [ ] Widget inline/full-page WebView host (COMPANION §5.7) — or keep the "not supported" placeholder (OVERHAUL); decision unresolved

**Workbench / review / files**
- [ ] Plan decisions from the Workbench; plan revisions + comments (PARITY P1; NATIVE P1)
- [ ] FilesSection multi-repo (drops repos 2..n); diff horizontal scroll; swipe between files; sticky hunk headers; pinch font size (NATIVE P1; COMPANION §5.2)
- [ ] Review comment authoring on a tapped line + approve/request-changes (COMPANION §2.5 Tier A; OVERHAUL demoted to read-only) — unresolved
- [ ] Server `GET /api/highlight` + structured hunks S3/S4, or on-device Shiki JS engine (COMPANION §5.2) — unresolved vs "degraded" decision
- [ ] Checkpoint timeline sheet (COMPANION §8.4)
- [ ] Browser: zoomable view; tap-to-click / keyboard forwarding gated on exec:browser; capture + share + attach (COMPANION §5.8; NATIVE §2)
- [ ] Terminal: reachable from Workbench when `exec:terminal` held, key-accessory bar, tab swipe, "attach selection to chat", worktree cd chips; keystroke→echo < 80 ms budget (COMPANION §5.1; PARITY Phase B item 11)
- [ ] Workspace artifacts: preview/download/share via `expo-file-system`/`expo-sharing`; upload gated (COMPANION §2.4)

**Lists / workflows / automations / projects**
- [ ] Swipe archive/unarchive/delete, rename, search on Chats; long-press menus; double-tap-tab scroll-to-top (NATIVE §2, §3)
- [ ] Workflow list/detail (stage list), runs filtered by definition, run stage output streaming, variable-input sheet, run profiles picker (PARITY Phase D; COMPANION §2.2)
- [ ] Run retry/cancel + automation enable/disable/run-now "gated with reason" (NATIVE §2) — depends on scope decision
- [ ] Skia read-only DAG graph + outline editor (COMPANION §5.4, Phase 5) — OVERHAUL/PARITY chose stage list instead; unresolved
- [ ] Codebase detail + branches + worktrees; link codebase from git remote URL; fetch/unlink (NATIVE §2; COMPANION §2.4)
- [ ] Artifacts browse (skills/prompts/agents/MCP) + toggles; extensions browse/install/enable; scripts list+run (COMPANION §2.7, Phase 5)
- [ ] `?new=1` never cleared; `prefs.lastRoute` unused; 15 unused deps; dead components; RunStatusPill divergence (NATIVE P2/P3)

**Settings**
- [ ] Providers (status/test/default), default chat model, Notifications prefs (PARITY P0/P1 — G15 done for prefs), text size, motion, haptics toggles, skill/MCP toggles, scope requests (NATIVE §2)
- [ ] Read-only Skills / MCP / Source control / Browser+terminal prefs; Extensions/Templates deferred (PARITY §1.3)
- [ ] Security screen: serverId fingerprint formatted, transport in use, relay state, posture warning cards, other-device revoke with biometric (COMPANION §8.4)

**Native conformance / a11y / adaptivity (NATIVE §1, §3)**
- [ ] Reduce Motion gating; Dynamic Type / fontScale sizing; edge-to-edge; predictive back; `softwareKeyboardLayoutMode`; `useAnimatedKeyboard` replacing 44pt offset; drag-anywhere sheet; single gorhom Sheet; `/pair` `/revoked` `/settings/security` on the design system; accessibilityHint/roles/live regions/progressbar; every list virtualized; base64 off JS thread; one skeleton clock; queries paused when unfocused
- [ ] Tablet/landscape two-pane (COMPANION F8, Phase 6; NATIVE "no landscape, no tablet layout")

**Shared-package debt COMPANION Phase 0 assumed**
- [ ] `apps/web` consuming `client-core` event router (still duplicated per PERF_REVIEW/MASTER_PLAN) — "mobile promoted to reference implementation, not rewritten"
- [ ] Mobile/CLI adoption of shared `fetch`-based client for DPoP parity (V2_IMPLEMENTATION_TRACKER W48 "genuinely not started")
- [ ] Documentation: `.github/docs/apps.md` mobile section is stale vs 09-03/09-05 state; AGENTS.md mobile row in feature matrix (COMPANION §14)

## 6. Supersession chain and which doc is authoritative for what

```
SECURITY (07-31)  ──mandate: scopes, pairing, transport, Phase-6 feature scope
   └─ SECURITY_AUTH_RELAY_IMPLEMENTATION (08-01)  as-built auth; "mobile next, no server work"
        └─ COMPANION (08-02)  full-parity vision, 6 phases, shared packages, S1–S7
             └─ PARITY (08-02)  "what is missing" gap catalog, P0–P3, feasibility verdicts
                  └─ OVERHAUL (08-02)  "supersedes PARITY": IA, design system, Workbench, not-feasible list
                       └─ NATIVE (08-05)  "supersedes OVERHAUL": 8/20 audit, P0–P3 defects, native layer
                            └─ (no later mobile-specific plan; later state lives in audits:
                                PAIRING_REVIEW, APPLICATION-REVIEW 09, V2_REMAINING, ARCH_PERF 09-05,
                                REVIEW-FIX-TRACKER, README, and TUNNEL 09-06 for off-LAN)
```

- **Scope/security policy:** SECURITY §8.3 + `DEFAULT_MOBILE_SCOPES` (as restated in COMPANION §1.2, SYSTEM_ARCHITECTURE §7.3, USER_GUIDE_ACCESS §6). No later doc changes the scope set; NATIVE only adds the request path.
- **IA and design system:** OVERHAUL §2–§4 (Work tab, Workbench sheet, surface ladder) as amended by NATIVE §3 (native layer). COMPANION §8 is the older, superseded IA (Runs tab, 12/55/92 snap points).
- **Feasibility verdicts:** OVERHAUL §5 is the most restrictive and most recent explicit list; NATIVE §2 reaffirms four of them (DAG, widgets, commit/PR, file editing) and relaxes run/automation controls to "gated with reason".
- **Feature backlog:** PARITY §1 (catalog) + NATIVE §1–§2 (defects + targets) together; COMPANION §2 is the aspirational ceiling.
- **Transport:** TUNNEL (09-06) is the newest statement of intent for off-LAN; SECURITY §17 / COMPANION §6.3 relay design is parked.
- **Current-state claims to distrust until code-verified:** OVERHAUL "everything else is implemented"; COMPANION "no code has been written"; `.github/docs/apps.md` "per-scope SSE, chat scope only"; TUNNEL §2 "E2EE already applies to any transport".

## 7. Verbatim quotes worth carrying forward

- "The auth layer was designed for this app before it existed. Mobile supplies two adapters and inherits the rest." (COMPANION §1.3)
- "The phone is a control plane, not an IDE." / "Approval is the killer mobile feature." (COMPANION §9)
- "Full drag-and-drop graph authoring on a 6-inch screen is a bad product, not just a hard build." (COMPANION §5.4)
- "The gate is a *product decision*, not a bug — surfaced in-app as an explanation." (PARITY §4, on run controls)
- "Six tabs do not fit a phone width, and the segmented control scrolls." (OVERHAUL §3)
- "It reads as a competent single-platform prototype: correct on a 393×852 iPhone at the default text size with animations on, and progressively wrong outside that." (NATIVE §1)
- "Scope elevation is requested, never self-granted." (NATIVE header)
- "~80% code-complete, ~10% shippable. Never once compiled for a phone." (APPLICATION-REVIEW §2.2)
- "Commit to a device build pipeline and one physical phone this cycle, or freeze and mark experimental." (APPLICATION-REVIEW §9)
- "Nothing on the wire is end-to-end encrypted today." (TUNNEL §0)
- "Mobile is architecturally superior to web on every axis measured in this review." (ARCHITECTURE_PERFORMANCE_REVIEW A.1) / "Promoted to reference implementation, not rewritten." (MASTER_PLAN_FINAL §0.3)
