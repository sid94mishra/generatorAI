# Mobile Companion App — Feature Parity Plan

Status: **in progress**
Owner: this document is the contract for what mobile ships, what it deliberately
does not, and why.

---

## 0. The honest starting position

The mobile app today is a **read-only status viewer with a plain text box**. It
can list chats/runs/projects, open a transcript, send a bare string, and approve
a gate. That is roughly 15% of what the web app does.

Everything below is measured against `apps/web`, which is the reference
implementation of the product.

---

## 1. Gap catalog — web vs mobile

### 1.1 Chat composer

| Capability | Web | Mobile today | Plan |
|---|---|---|---|
| Send text | ✅ | ✅ | — |
| Stop / cancel turn | ✅ | ✅ | — |
| Model picker (grouped by provider, search) | ✅ | ❌ | **P0** |
| Reasoning effort (low→max, model-driven) | ✅ | ❌ | **P0** |
| Context-window gauge + breakdown | ✅ | ❌ | **P1** |
| Long-context tier toggle | ✅ | ❌ | **P1** |
| Agent mode (Interactive / Plan) | ✅ | ❌ | **P0** |
| Permission mode | ✅ | ❌ | **P1** |
| Slash commands (`/browser`, `/terminal`, skills, prompts) | ✅ | ❌ | **P2** |
| `@`-file mentions | ✅ | ❌ | **P2** |
| File attachments | ✅ | ❌ | **P2 (gated)** |
| Voice input (Whisper STT) | ✅ | ❌ | **P2 (gated)** |
| Codebase picker | ✅ | ❌ | **P1** |
| Blocked-by-gate banner | ✅ | partial | **P0** |

### 1.2 Chat right pane (8 tab types on web)

| Tab | Web | Mobile today | Plan |
|---|---|---|---|
| Changes / diff review | ✅ full (threads, commit, PR, checkpoints) | separate screen, read-only | **P1** — sheet + read/comment |
| Files browser | ✅ tree + syntax highlight | ❌ | **P1** |
| Terminal | ✅ xterm.js | screen exists, scope-gated | **P1** — reachable + themed |
| Browser preview | ✅ CDP screencast + input forwarding | ❌ | **P2** — view-only |
| Widgets / extensions | ✅ iframe + postMessage | ❌ | **P3 — deferred** |
| Background tasks | ✅ | ❌ | **P2** |
| Plan document | ✅ revisions, comments, edit | approve/reject only | **P1** |
| Codebase | ✅ | ❌ | **P2** |

### 1.3 Settings (web has 10 sections)

| Section | Web | Mobile today | Plan |
|---|---|---|---|
| Appearance (theme + accent) | ✅ | ✅ (just added) | — |
| Model providers (status, test, default) | ✅ | ❌ | **P0** |
| Default chat model | ✅ | ❌ | **P0** |
| Security / devices | ✅ | ✅ | — |
| Source control (GitHub token/host) | ✅ | ❌ | **P2 — read-only** |
| Browser & terminal prefs | ✅ | ❌ | **P2** |
| Skills | ✅ | ❌ | **P2 — read-only** |
| MCP servers | ✅ | ❌ | **P2 — read-only** |
| Extensions | ✅ | ❌ | **P3 — deferred** |
| Templates | ✅ | ❌ | **P3 — deferred** |
| Notifications | ✅ | ❌ | **P1** |

### 1.4 Workflows / runs / automations

| Capability | Web | Mobile today | Plan |
|---|---|---|---|
| Workflow definition list | ✅ | ❌ | **P1** |
| Workflow detail (stages, DAG) | ✅ | ❌ | **P1 — list, no DAG** |
| Runs for a given workflow | ✅ | ❌ | **P1** |
| Run detail (stages, timing) | ✅ | ✅ basic | **P1 — enrich** |
| Run stage streaming output | ✅ | ❌ | **P1** |
| Approve / reject stage gate | ✅ | ✅ | — |
| Start / pause / cancel run | ✅ | ❌ scope-blocked | **not feasible** (see §4) |
| Workflow creation / editing | ✅ | ❌ | **deferred** (user agreed) |
| Automation list | ✅ | ✅ | — |
| Automation detail + executions | ✅ | ✅ basic | **P1 — enrich** |
| Automation creation | ✅ | ❌ | **deferred** (user agreed) |

---

## 2. Mobile UX design decisions

Sources: Apple HIG (Sheets, Tab bars, Navigation), Material 3 (Navigation bar).

**Rule 1 — the tab bar holds 3–5 destinations, never more.**
Material 3 is explicit: >5 destinations collide and labels truncate. We keep
**Activity / Chats / Runs / Projects** and put everything else behind
navigation or sheets.

**Rule 2 — the web "right pane" becomes a bottom sheet, not a tab.**
A phone has no room for a side-by-side dock. The web pane is contextual to a
chat, so on mobile it becomes a **resizable bottom sheet** over the transcript
(`@gorhom/bottom-sheet`, already a dependency) with:
- a **grabber** (HIG: signals resizability and works with VoiceOver),
- **medium + large detents** (HIG: progressive disclosure),
- **swipe-to-dismiss**.
This keeps the transcript visible while reviewing a diff — the mobile analogue
of the web's split view.

**Rule 3 — composer controls live in a sheet, not a crowded toolbar.**
The web composer has ~12 controls in a horizontal strip. At 393pt that yields
sub-44pt targets, below the HIG minimum. Instead: the composer row shows
**model + mode + send**, and a single **"⋯" opens a settings sheet** with
model picker, reasoning effort, context gauge and codebase picker at full width.

**Rule 4 — destructive and permission-blocked actions are stated, not hidden.**
Where a scope is withheld we render the reason inline (existing `FeatureLocked`
pattern) rather than a dead button or a raw 403.

**Rule 5 — urgency ordering everywhere.**
A phone is checked in gaps. Blocked-waiting-on-you sorts above running, which
sorts above recent. Already applied on Activity and Runs.

**Rule 6 — every list gets loading / empty / error, and every error is actionable.**
No silent empty states standing in for failures (this was a real bug: an
unauthenticated screen rendered as "No chats yet").

---

## 3. Implementation phases

### Phase A — Chat parity (P0) ✅ highest value
1. `useModels` hook + model picker sheet (grouped by provider, search).
2. Reasoning-effort selector driven by the selected model's capabilities.
3. Agent mode (Interactive / Plan) selector.
4. Composer settings sheet hosting the above + context gauge.
5. Send with `model` / `mode` / `reasoningEffort`.
6. Blocked-by-gate banner wired to `/api/chats/:id/interactions`.
7. New-chat sheet: title, project, model.

### Phase B — Chat context sheet (P1)
8. Bottom sheet over the transcript with tabs: **Changes · Files · Plan · Terminal**.
9. Files browser (tree → file view, syntax-plain with mono font).
10. Plan document viewer with revisions.
11. Terminal reachable from the sheet when `exec:terminal` is held.

### Phase C — Settings (P0/P1)
12. Settings hub (done) + Providers section (status, models, set default).
13. Default chat model preference.
14. Notifications preferences.
15. Read-only Skills / MCP / Source-control sections.

### Phase D — Workflows & runs (P1)
16. Workflows list + detail (stage list, not DAG).
17. Runs filtered by definition.
18. Run stage output streaming.
19. Automation detail enrichment.

### Phase E — Polish
20. Pull-to-refresh everywhere, haptics on destructive actions.
21. Empty/loading/error audit.
22. Light + dark verification on every screen.

---

## 4. Explicitly NOT feasible / deferred — and why

| Item | Verdict | Reason |
|---|---|---|
| **Start / pause / cancel a run** | **Not feasible now** | Requires `write:workflows`, which `DEFAULT_MOBILE_SCOPES` deliberately withholds. Granting it by default would let a lost phone mutate pipelines. The gate is a *product decision*, not a bug — surfaced in-app as an explanation. Can be enabled per-device from a trusted device. |
| **Workflow authoring / DAG editor** | **Deferred** (user agreed) | React Flow has no RN equivalent; node-graph editing at 393pt is not a real workflow. Viewing stages as a list is the honest mobile affordance. |
| **Automation creation** | **Deferred** (user agreed) | Multi-step form with cron/webhook config; low value on a phone. Run *history* is delivered. |
| **Widgets / extensions canvas** | **Deferred** | Depends on a separate-origin iframe + postMessage bridge. RN `WebView` can host it, but the security model (origin isolation) needs its own design pass. |
| **Browser preview with input forwarding** | **Partial (P2)** | Viewing the MJPEG/screencast is feasible in a `WebView`. Forwarding precise clicks/keystrokes from a touch screen to a desktop viewport is a poor experience; ship **view-only** first. |
| **Full diff review (commit / PR / checkpoint restore)** | **Partial** | Reading diffs and adding review comments is feasible and useful. Committing and opening PRs from a phone is high-risk, low-frequency — deferred to desktop. |
| **File editing** | **Not planned** | Requires `write:files`; editing code on a phone is not a real use case. |
| **Syntax highlighting** | **Degraded** | Web uses worker-based Shiki. On RN we render mono text with diff-line tinting. Full tokenisation is possible later via a WebView but is not worth the bundle cost now. |

---

## 5. Definition of done

- Every screen renders correctly in **light and dark**.
- Every list has loading / empty / error states.
- No screen 403s or shows a raw error where a scope is withheld.
- `pnpm --filter @generatorai/mobile typecheck` and `test` pass.
- Every feature above is exercised in the Expo web preview at 393×852.
