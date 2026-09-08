# Mobile Standalone Client — Audit, Design Overhaul and Implementation Plan

Date: 2026-09-06 · Branch: `arch-redesign` · Status: **proposal for review, no code changed**

This document supersedes `MOBILE_NATIVE_REDESIGN_PLAN.md` (2026-08-05) as the mobile plan of record once approved. It is the output of a full audit of the web/desktop feature surface (≈470 controls, ≈300 endpoints), every file in `apps/mobile` (≈21K lines excluding generated tokens), the server/auth/relay surface, the shared design tokens, the four prior mobile plans, and external research on 2026 mobile agentic clients and the Expo SDK 57 stack. Working notes for each of those audits are summarised in Appendix E.

---

## 0. Executive summary

**Where we are.** The mobile app is a well-built *companion*: ≈80% of a companion's code exists, the design system in `src/components/ui` is genuinely good, typecheck and 211 pure-logic tests pass, and the shared `client-core` reducer means transcripts agree with web. But it has never been built for a physical device, it cannot reach a server off the LAN, and it has one defect that makes the default install non-functional:

> **P0 — a phone paired with the default mobile scopes receives no live events at all.** `useGlobalStream` subscribes to the `global` stream scope at app start; the server requires `admin:settings` for that scope (`apps/server/src/routes/stream.ts:122`) and rejects the *whole* multiplexed connection with 403 (`stream.ts:314-326`). The shared mux client never records a 403 as a per-scope rejection, so it retries the same payload 20 times and gives up (`packages/client-core/src/stream/MuxStreamClient.ts:281-283, 400-408, 446-454`). Chat streaming, gates, list updates: all dead unless the device was paired with admin scopes. Prior audits recorded the `global` subscription as "done".

**What is being asked.** A *standalone* client with every web feature: chat, plan mode, orchestrator, background agents, changes/review, terminal, browser, computer use, workflows, automations, dashboard, settings, voice. That is a product decision reversal — every prior mobile doc chose "control plane, not IDE" and encoded it in `DEFAULT_MOBILE_SCOPES`. The plan below delivers standalone parity, and states precisely which pieces are structurally impossible on a phone (§4) rather than merely withheld by policy.

**What the plan is.** Eight phases (§9): stabilise (P0s, device build, off-LAN), foundation (navigation shell v2, design system v2, scope model), chat core, workbench (changes/review/files/plan/tasks), execution surfaces (terminal/browser/computer), work surfaces (workflows/runs/automations/projects/agents), system (settings/notifications/Live Activities/tablet), and hardening (performance, accessibility, store readiness). Server work is small but blocking (§5): a non-admin activity scope, a scope-request flow, push for tool permissions, a reachable widget-asset origin, and the already-planned tunnel transport.

**Headline numbers**

| | |
|---|---|
| Web/desktop user-facing capabilities catalogued | ≈470 across 23 areas |
| Mobile capabilities present today | ≈150 (≈32%) |
| Partial / defective | ≈60 |
| Missing but feasible | ≈230 |
| Structurally infeasible on a phone (§4) | ≈30 (all desktop-shell or host-filesystem bound) |
| Mobile defects found (§3.4) | 34 (1 P0, 9 P1, 15 P2, 9 P3) |
| Server changes required for standalone parity (§5) | 7 (3 blocking) |

---

## 1. Ground truth

### 1.1 What the web/desktop client offers (parity baseline)

Route surface: Dashboard, Chats (+create dialog), Chat page (composer, timeline, right pane with Changes / Files / Browser / Terminal / Computer / Widget / Background Tasks / Plan tabs), Agents list + editor, Workflows list / builder / definition / run page, Automations list / create / detail, Projects list / create / detail / codebase detail, Scripts list / detail, Settings modal (14 sections, ≈100 controls), pairing/auth, theme system (mode × 17 themes × 6 accents). Full catalogue: Appendix A.

Explicitly **absent on web** too (so not parity gaps): retry/regenerate a turn, edit a sent message, fork a chat, share/export a chat, per-hunk revert, stage/unstage, open in external editor, per-message copy button, notification settings, keybinding settings, PWA.

### 1.2 What the mobile app is today

Expo SDK 57 / RN 0.86 / React 19.2, expo-router 57 (root Stack + 4 JS tabs), NativeWind 4 over generated design tokens, Reanimated 4 + worklets, LegendList everywhere, MMKV + SecureStore, TanStack Query 5 + zustand, `react-native-quick-crypto`, `react-native-webview` (terminal only). Shared packages: `client-core` (API client, mux stream client, reducer, StopController), `client-runtime` (DPoP auth), `client-transport` (`EndpointSupervisor`, `DirectTransport` only), `relay-protocol` (schema only), `design-tokens`.

Screens: Activity, Chats, Work (Runs/Workflows/Automations), Projects tabs; chat, run, workflow, automation, project details; changes list + file diff; terminal; pair; revoked; 10 settings screens. Chat screen has a pinned-gate model (permission / question / plan cards above the composer), a 6-section Workbench sheet (Changes, Files, Plan, Tasks, Terminal, Browser), model/turn-options sheets, slash + @-mention strips, live STT dictation, TTS read-aloud, long-press copy/share.

Deliberately absent per `settings/about.tsx`: widgets, workflow editing, automation authoring, run start/pause/cancel, file editing, commit/PR, browser touch input, codebase linking.

### 1.3 What the server lets a phone do

Auth is per-device DPoP; scopes decide authority, transport never does. `DEFAULT_MOBILE_SCOPES` = all `read:*` + `write:chats` + `write:reviews` + `stream:events` + `exec:agent`. Everything a standalone client needs exists as a route today (Appendix B), gated on scopes an admin can grant per device via `PUT /api/auth/devices/:id/scopes`. Three things do **not** exist for a phone: a non-admin activity feed (`global` needs `admin:settings`), a way for a device to *request* scopes (admin must push them), and an off-LAN transport (relay pairing returns 409, no client relay adapter, E2EE unwired; `TUNNEL` plan is the intended fix). Push exists (Expo only) for stage approvals, plan review, questions, run failures and completions — **not** for tool-permission prompts.

---

## 2. Feature parity catalogue (web → mobile)

Status legend: **✅ done** · **◐ partial / defective** · **✗ missing (feasible)** · **⚠ needs server change** · **⛔ structurally infeasible** (see §4). "Phase" is where §9 delivers it.

### 2.1 Shell, navigation, cross-cutting

| Web capability | Mobile today | Verdict | Phase |
|---|---|---|---|
| Sidebar nav (7 sections) + Settings | 4 tabs + header settings button | ✅ (IA revised in §6.2) | 1 |
| Command palette ⌘K | none | ✗ → global search sheet (pull-down on Home) | 6 |
| Connection status pill + "events may be missing" gap badge | reconnect banner in chat only | ◐ → app-wide status strip + gap recovery | 0 |
| Right pane dock (resizable, tabbed, persisted) | Workbench sheet (3 detents) | ◐ → swipeable session panes + sheet (§6.4) | 1–3 |
| Error boundaries (root + page) | none | ✗ | 1 |
| Toasts with expandable logs | single toast, no logs | ◐ | 1 |
| Theme: mode × 17 themes × 6 accents, per-theme radius/fonts | mode × themes × accents; radius fixed | ◐ → per-theme radius + font stacks | 1 |
| Keyboard shortcuts | n/a (hardware keyboard on iPad: minimal set) | ✗ (iPad only) | 6 |
| Multi-server (remembered connections, switch) | single pairing | ✗ | 6 |
| Deep links `generatorai://` | pairing only; route guard drops `workflows`/`terminal` | ◐ | 0 |
| Desktop: title bar, tray, menus, auto-update, native dialogs, embedded server | — | ⛔ desktop shell | — |

### 2.2 Dashboard → Home

| Web capability | Mobile today | Verdict | Phase |
|---|---|---|---|
| Stat cards (chats/workflows/automations/health) | stat rail | ✅ | — |
| Activity panel Today/Running/Needs attention | Activity feed + filters + swipe | ◐ — chats blocked on gates never count (D10); no live feed on default scopes (P0) | 0 |
| Inline row actions (cancel run, restart, stop chat, cancel automation) | none | ✗ (needs `write:workflows` for runs) | 5 |
| System health card | diagnostics screen | ◐ → health card on Home | 6 |
| New Chat / New Workflow | FAB new chat | ◐ | 5 |

### 2.3 Chat list and creation

| Web capability | Mobile today | Verdict | Phase |
|---|---|---|---|
| Virtualised list, search, All/Active/Archived, bulk select+delete | search, Active/Archived, swipe archive/delete, long-press menu, rename | ✅ (exceeds web) | — |
| Create: name, description, model picker, agent binding + overrides, orchestrate toggle, tags | name, model, project, agent, plan-first, permission mode, orchestrator | ◐ — no agent overrides / capabilities preview, no tags | 2 |
| Create: Sources picker (codebase, local folder, worktree/in-place, branch mode, alias, primary) | project only | ◐ — codebase + branch + worktree picker feasible; local folder is ⛔ (host FS) | 2 |
| Create: browser visibility (headless/visible/off, eval, allowed hosts) | none | ✗ | 4 |
| Edit sources mid-chat | none | ✗ | 3 |

### 2.4 Chat page and transcript

| Web capability | Mobile today | Verdict | Phase |
|---|---|---|---|
| Persisted history + optimistic bubble + live transcript + jump-to-latest | ✅ | ✅ | — |
| Status banner Generating / Processing / Paused | activity row | ✅ | — |
| Load earlier (paged) | ✅ | ✅ | — |
| Thinking block (collapsible, live/settled) | ✅ | ✅ | — |
| Tool rows: humanised verb + target, expand args/result | ✅ | ◐ — `error` flag, `fileOp` +/−, `parentCallId` nesting all ignored (D5) | 2 |
| Grouped rows ("Read 5 files", "Ran 3 commands") | none | ✗ | 2 |
| File-op row with inline diff + open in Changes | diff tint if result looks like a patch | ◐ | 2 |
| Shell row → Agent Console | none | ✗ | 4 |
| Screenshot rows with preview | none | ✗ | 2 |
| Subagent nesting (SDK `Agent` call children) | flat | ✗ | 2 |
| Warning rows (MCP failures) | neutral style (D6) | ◐ | 2 |
| Waiting-for-you state on rows | none | ✗ | 2 |
| Question / Permission / Plan cards | pinned above composer | ✅ (better than web on a phone) — `question.header`, `option.preview` not rendered (D29) | 2 |
| Usage chip incl. cache-miss warning | usage footer | ◐ | 2 |
| Hooks invocations (`stream.hooks`) | not rendered | ✗ | 5 |
| Inline widgets | "Desktop only" placeholder | ⚠ WebView host once assets are reachable (§4.2) | 6 |
| Attachments on user messages (chips, preview) | none | ✗ | 2 |
| "Stopped before response finished" marker | none | ✗ | 2 |
| Read aloud / speak live | ✅ | ✅ (mobile has it; web hides it) | — |
| Copy / share message | long-press | ✅ (exceeds web) | — |
| Two-phase Stop → Force reset | label only; `force`/budget dropped (D9) | ◐ | 0 |
| Archived banner | none | ✗ | 2 |

### 2.5 Composer

| Web capability | Mobile today | Verdict | Phase |
|---|---|---|---|
| Auto-grow textarea, send/stop | ✅ | ✅ | — |
| Attach file (picker, paste image, drag-drop), chips with preview | dead `+` button, `attachments={[]}` (D2) | ✗ → photo library, camera, files, clipboard image | 2 |
| Pending captures from browser/terminal | none | ✗ | 4 |
| Model picker (provider rail, search, details, refresh) | ✅ | ✅ | — |
| Reasoning effort, context tier | ✅ persisted via harnessConfig | ✅ | — |
| Context usage gauge + popover breakdown | ring + bar | ◐ → breakdown sheet | 2 |
| Agent mode Interactive/Plan | local state, never persisted, never seeded from chat (D7) | ◐ | 0 |
| Permission mode | in options sheet | ✅ | — |
| Bound-agent chip | none | ✗ | 2 |
| Codebase panel | count only | ◐ | 2 |
| Slash commands: `/browser`, `/terminal`, skills, prompts, `/computer-use` | 6 section-openers only | ◐ → full command source (`/api/system/artifacts`, project artifacts) | 2 |
| `@` mentions attach file content | path text only | ◐ | 2 |
| Prompt history ↑/↓ | none | ✗ → swipe-up on composer / history sheet | 2 |
| Voice dictation (waveform, pause, cancel/accept, "scratch that") | live STT, interim line, pause-on-touch; no waveform, no cancel, no retraction | ◐ | 2 |
| Workspace prep bar (preparing/error/retry) | none | ✗ | 2 |
| Gate banner "Cancel and send" | disabled composer with reason | ◐ | 2 |

### 2.6 Changes, files, checkpoints, review

| Web capability | Mobile today | Verdict | Phase |
|---|---|---|---|
| Summary-first file list with +/−, status badges, mount groups | ✅ | ✅ | — |
| Base picker (session start / branch base / turn checkpoints) | ✅ | ✅ | — |
| Unified / split, wrap | unified + wrap; unwrapped clipped at 760px (D13) | ◐ | 3 |
| Syntax highlighting in diffs | none | ✗ → Shiki engine, closed hunks only | 3 |
| Per-file discard via checkpoint restore | ✅ (needs `write:workspaces`) | ✅ | — |
| Checkpoint timeline: compare / rewind (+report, undo) | list + base picker | ◐ | 3 |
| Commit, create PR, PR list | none | ✗ (needs `write:workspaces`) | 3 |
| Review: select lines → comment (intents), threads, batch send | none | ✗ → long-press line → comment sheet; threads inline | 3 |
| Files browser: tree, breadcrumb, markdown preview, multi-repo | ✅ | ✅ | — |
| File editing (`PUT files/content`) | none | ✗ (small edits feasible; not an IDE) | 5 |
| Changes tray above composer (live +/−, expandable tree) | header badge count | ◐ | 2 |
| Two Changes surfaces with different colours/renderers (D20) | — | defect → unify | 3 |

### 2.7 Plan mode, orchestrator, background agents

| Web capability | Mobile today | Verdict | Phase |
|---|---|---|---|
| Plan card + Plan tab (revisions, edit, comments, approve/changes/discard, save to workspace) | PlanCard + PlanSection (approve/changes/discard) | ◐ — no edit, no comments, no save; two decision encoders (D12) | 3 |
| Orchestrate toggle at creation | ✅ | ✅ (D30 nit) | — |
| Background Tasks panel: list, digest, open worker chat, cancel | list only | ◐ | 3 |

### 2.8 Terminal

| Web capability | Mobile today | Verdict | Phase |
|---|---|---|---|
| xterm.js renderer (colours, cursor, WebGL, links, search) | ANSI-stripping `<pre>` (D3) | ✗ → vendored xterm.js + ghostty-web fallback in WebView | 4 |
| Binary WS, ACK flow control, scrollback replay | ✅ | ✅ | — |
| Header: cwd, host badge, agent badge, attach selection, find, clear, kill | key bar, clear, kill | ◐ | 4 |
| Worktree `cd` quick menu | none | ✗ | 4 |
| Multi-tab (≤4) | single | ✗ | 4 |
| Agent Console (agent-run command history) | none | ✗ | 4 |
| Restart after exit | none (D31) | ✗ | 4 |

### 2.9 Browser

| Web capability | Mobile today | Verdict | Phase |
|---|---|---|---|
| Start/stop, back/forward/reload, URL | ✅ | ✅ | — |
| Live view: WS JPEG/VP8 screencast | 2 s JPEG poll | ◐ → WS JPEG stream | 4 |
| Pointer/keyboard input forwarding | none (by design) | ✗ → opt-in "Take control" mode with viewport emulation (§6.7) | 4 |
| Inspect element → attachment, Capture region → attachment | none | ✗ | 4 |
| Share/attach to agent toggle | none | ✗ | 4 |
| Device toolbar (presets, DPR, UA) | none | ✗ | 4 |
| Cookie import from local Chrome | — | ⛔ host-only | — |
| Multi-tab (≤5) | single | ✗ | 4 |
| Desktop native `WebContentsView` mode | — | ⛔ desktop shell | — |

### 2.10 Computer use

| Web capability | Mobile today | Verdict | Phase |
|---|---|---|---|
| Live window frames + cursor, Now/Replay, recording controls | none | ⚠ scope `exec:computer` withheld by policy; feasible as **view + consent** with an explicit grant (§4.3) | 4 |
| Consent card (allow once / run / always / deny), grants list | none | ⚠ same | 4 |
| Driver runtime start/stop | none | ⚠ same | 4 |

### 2.11 Workflows, runs, automations

| Web capability | Mobile today | Verdict | Phase |
|---|---|---|---|
| List: search, grid/list, bulk delete, import/export JSON, templates | list + search | ◐ | 5 |
| Definition page: read-only DAG, meta, run, edit, delete | stage list | ◐ → read-only DAG (Skia) + stage list | 5 |
| Builder: React Flow canvas, nodes/edges, undo/redo, validate, save | none | ✗ full canvas authoring ⛔ at phone size; **stage-outline editor** feasible (§4.4) | 5 |
| Stage properties (model, prompts, skills, MCP, variables, execution, retry, validation, hooks) | none | ✗ → form-based stage editor (tablet: side-by-side with DAG) | 5 |
| Workflow settings (general, codebases, variables, hooks, tags) | none | ✗ | 5 |
| Run dialog (variables, uploads, stage overrides) | none | ✗ | 5 |
| Run page: header controls Pause/Resume/Cancel/Retry | none (`write:workflows`) | ✗ | 5 |
| Runtime DAG + pipeline strip | none | ✗ | 5 |
| Stage timeline with StreamPanel per stage, sleeping/wake, HITL | stage list + HITL gate | ◐ | 5 |
| Inspector (files/output/hooks/tools) | none | ✗ | 5 |
| Run right pane (Changes/Files/Browser/Terminal/Widget) | links to Changes/Terminal | ◐ | 5 |
| Automations create (trigger, input modes, batch preview, retry) | none | ✗ | 5 |
| Automations detail: run now, enable/disable, rotate token, executions + cancel | read-only | ◐ | 5 |

### 2.12 Projects, codebases, agents, skills/MCP, extensions, scripts, hooks

| Web capability | Mobile today | Verdict | Phase |
|---|---|---|---|
| Projects list/create/settings/delete | list + detail read-only | ◐ | 5 |
| Codebases: add (git remote), fetch, logs, delete, branches, worktrees, files | read-only | ◐ — git-remote add feasible; `git-local`/`local-dir` ⛔ | 5 |
| Project customization: skills/prompts/agents/MCP per project | none | ✗ | 5 |
| Agents list + editor (identity, instructions, role, skills, MCP, tool policy, team, runtime) | picker only | ✗ (needs `admin:settings`) | 5 |
| Skills catalog + enable; MCP bundled/custom + setup | read-only preview | ◐ (writes need `admin:settings`) | 6 |
| Extensions install/reload/enable | none | ✗ (admin) | 6 |
| Scripts list/detail/run/materialize | none | ✗ | 5 |
| Hooks (workflow/stage editor, phases) | none | ✗ (inside stage editor) | 5 |
| Templates | none | ✗ | 5 |

### 2.13 Settings

| Web section | Mobile today | Verdict | Phase |
|---|---|---|---|
| General (default model) | none | ✗ | 6 |
| Appearance | ✅ | ✅ | — |
| Model providers (test, make default) | ✅ | ✅ | — |
| Agents / Skills / MCP / Templates | read-only capabilities screen | ◐ | 6 |
| Source control (provider, token, host) | read-only | ◐ | 6 |
| Browser & Terminal prefs | none | ✗ | 6 |
| Computer use (enable, allow synthetic, driver) | none | ✗ | 6 |
| Audio (STT engine, model download, TTS voice/speed) | none | ✗ | 6 |
| Extensions | none | ✗ | 6 |
| Security & devices (posture, network access, pair device + QR, pending grants, devices + scopes + revoke) | posture, own scopes, device list + revoke; **no header/back button (D1)**; cannot pair another device | ◐ | 0, 6 |
| Storage retention | none | ✗ | 6 |
| Diagnostics | ✅ | ✅ | — |
| Mobile-only: notifications, motion, haptics, text size, biometric lock, local-only | notifications only; motion/haptics/biometric declared but no UI (D8) | ◐ | 6 |

---

## 3. Mobile implementation audit

### 3.1 Architecture (verified)

Provider stack in `app/_layout.tsx`: GestureHandlerRoot → SafeArea → Theme → Preferences → ThemedShell → QueryClient → Auth → MuxStream → Toast → BottomSheetModal (dead) → AuthGate → RootStack. `AuthProvider` routes `client-runtime` fetches through `EndpointSupervisor` so DPoP signing is transport-agnostic; host identity verified against `/api/auth/server-info` before credentials are sent. One `MuxStreamClient` per auth session, rebuilt on foreground; `useChatStream` routes frames through `StreamEventRouter` with `MOBILE_CAPABILITIES.highLatencyBlockDelivery` and flushes effects to a zustand store every 16 ms.

### 3.2 Strengths to preserve

- `src/components/ui`: single `Touchable` (UI-thread press scale, haptic vocabulary, hit-slop, ripple), elevation ladder, tone tokens, `MAX_SCALE` Dynamic Type caps, reduce-motion in every preset, detented `Sheet`, `SwipeableRow` with arming haptic, `Screen` with collapsing large title, skeleton clock, empty/error/locked states everywhere.
- Pinned decision cards above the composer (better than web's inline cards on a phone).
- LegendList non-inverted chat with `alignItemsAtEnd` / `maintainScrollAtEnd`.
- Optimistic send with draft restore on failure; turn-id de-duplication of live vs history.
- Scope-gated feature model (`featureGate.ts`) with human reasons.
- Voice: insert-at-caret, interim line outside the buffer, pause-on-touch (parity with web Part C).

### 3.3 Weaknesses

- Never compiled for a device (EAS profiles exist; no recorded device build). Verification standard drifted to "Expo web preview at 393×852".
- Two visual generations: `pair.tsx`, `revoked.tsx`, `settings/security.tsx` use raw `Pressable` and hand-rolled sections outside the design system.
- Duplicates: two `Sheet`s, two `States`, two base64 encoders, two plan-decision encoders, two `formatDuration`s, two Changes surfaces.
- Ten unused dependencies (Skia, gorhom portal, background-task, task-manager, sharing, network, linking, system-ui, qrcode-svg, semver) and a dead `BottomSheetModalProvider`.
- No tablet or landscape layout despite `supportsTablet: true`.
- No screen/hook/component tests; the 211 tests are pure logic.

### 3.4 Defect register (ranked)

| # | Sev | Where | Finding | Fix phase |
|---|---|---|---|---|
| D0 | **P0** | `src/stream/useGlobalStream.ts:62-70`, server `routes/stream.ts:122,314-326`, `client-core/.../MuxStreamClient.ts:281,446-454` | `global` scope needs `admin:settings`; server 403s the whole mux connection; client retries 20× then gives up. **Default-scope phones get no live events.** | 0 |
| D1 | P0 | `app/settings/security.tsx`, `app/_layout.tsx:263` | No header, no title, no back button (stack header off, no `<Screen back>`); top inset ignored. | 0 |
| D2 | P1 | `src/components/chat/Composer.tsx:361-370`, `app/chats/[id].tsx:775-778` | Attachment button dead when `write:files` granted; `attachments={[]}`; no picker. | 2 |
| D3 | P1 | `src/terminal/terminalHtml.ts` | Terminal renderer is a `<pre>` that strips ANSI; no cursor/colour/line editing; capability ledger claims xterm. | 4 |
| D4 | P1 | `src/native/deviceKeyModule.ts:49` | `GeneratorAIDeviceKey` native module does not exist; keys always software-backed. | 0 |
| D5 | P1 | `src/components/chat/BlockView.tsx:199-250` | `ToolCallBlock.error`, `fileOp`, `parentCallId` ignored. | 2 |
| D6 | P1 | `BlockView.tsx:341-357` | `warning` system blocks rendered neutral. | 2 |
| D7 | P1 | `app/chats/[id].tsx:100` | `mode` never seeded from `defaultAgentMode`, never persisted. | 0 |
| D8 | P1 | `src/prefs/preferences.tsx`, `src/storage/prefs.ts:35`, `app.config.ts:47` | Motion/haptics prefs have no UI; `biometricLock`/`lastRoute`/`disabledSkills` unused; Face ID usage string promises an app lock that does not exist. | 6 |
| D9 | P1 | `app/chats/[id].tsx:257-260`, `client-core/src/api/client.ts:913` | Two-phase stop drops `force`/`budgetSeconds`; `chats.cancel` has no body. | 0 |
| D10 | P1 | `src/api/useActivity.ts:70-86` | Chats blocked on a gate never count in the Activity badge / "Needs you". | 0 |
| D11 | P2 | `common/Sheet.tsx`, `chat/ApprovalGate.tsx`, `runs/RunStatusPill.tsx`, `common/States.tsx` | Dead files and a live shim. | 1 |
| D12 | P2 | `workbench/PlanSection.tsx:63-70` vs `gateActions.ts` | Two plan-decision encoders. | 3 |
| D13 | P2 | `ChangesSection.tsx:785,799`, `FilesSection.tsx:322` | Magic `width: 760`, long lines clipped. | 3 |
| D14 | P2 | `src/stream/streamStore.ts:45` | `clear()` never called; stream state accumulates for the process lifetime. | 1 |
| D15 | P2 | `BrowserSection.tsx:292`, `TerminalView.tsx:343`, `deviceKeyModule.ts:54` | Contradictory `btoa` assumptions; duplicate encoders. | 1 |
| D16 | P2 | `src/voice/useVoiceInput.ts:108` | `setAmplitude` re-renders the chat screen per audio buffer; amplitude never shown. | 2 |
| D17 | P2 | `src/notifications/routeGuard.ts:16-23` | `workflows`, `terminal` not in the allow-list; pushes to them dropped. | 0 |
| D18 | P2 | `src/components/markdown/Markdown.tsx:163` | `Linking.openURL` on any scheme; no images. | 2 |
| D19 | P2 | `app/runs/[id].tsx:76-80` | `pendingInterrupts` polls forever after terminal state. | 5 |
| D20 | P2 | `app/changes/*` vs `workbench/ChangesSection.tsx` | Two Changes surfaces, different colours/renderers. | 3 |
| D21 | P2 | `package.json` | Ten unused deps; dead gorhom provider. | 1 |
| D22 | P2 | `pair.tsx`, `revoked.tsx`, `security.tsx`, `CodeBlock.tsx` | Outside the design system; no safe areas on pair. | 1 |
| D23 | P2 | `PermissionCard`, `PlanCard`, `QuestionCard`, `runs/[id]` | `FadeInDown.springify()` without reduce-motion branch. | 1 |
| D24 | P2 | `app/chats/[id].tsx:762-766` | Effort/tier/permission PATCH with no optimistic UI; `modelOverride` can diverge. | 2 |
| D25–D33 | P3 | see Appendix C | Nits: no-op ternary, duplicate imports, template copy, query-key shape, `question.header`/`option.preview`, orchestrator toggle, no terminal restart, FAB shadow alpha, no tablet layouts. | 1–6 |

Also verified server-side: `chat.permission.requested` is not pushed (`notificationPolicy.ts`), so the most time-critical gate never reaches a locked phone.

---

## 4. Feasibility verdicts

Everything below was checked against the actual server routes and host-process split, not assumed.

### 4.1 Structurally infeasible on a phone (flag, do not build)

| Feature | Why |
|---|---|
| Local folder / `git-local` codebase linking, `DirectoryBrowser`, `/api/fs/*` | The phone cannot browse the host filesystem; `/api/fs` is loopback-gated and admin-only. Git-remote codebases are fine. |
| Cookie import from local Chrome/Edge | Reads the host's browser profile. |
| Desktop native browser mode (`WebContentsView`), DevTools, F12 | Electron only; screencast mode covers the phone. |
| Desktop shell: title bar, tray, native menus, auto-update, Save-As dialogs, embedded server, backend switcher | Electron only. |
| Computer-use *driving* from the phone with a pointer | The agent drives; a phone should only watch and consent. Policy in `routePolicy.ts:112-116` is right. |
| Widget sandbox with the web's origin-isolation guarantees, while assets stay on `127.0.0.1:3101` | Blocked by server topology, not RN — see §4.2. |
| Full drag-and-drop DAG authoring at phone width | "A bad product, not just a hard build" (prior plan); outline editor + tablet canvas instead (§4.4). |
| Hardware-keyboard-centric shortcuts | No keyboard; iPad gets a minimal set. |

### 4.2 Feasible with a server change

| Feature | Server change |
|---|---|
| Activity feed / live list updates on default scopes | New `read:activity` scope (or let `stream:events` holders subscribe to `global` filtered to `LIFECYCLE_EVENT_KINDS` only). **Blocking.** |
| In-app "Request access" for a scope | `POST /api/auth/devices/me/scope-requests` + admin approval on a trusted device (S5 in the companion plan, never built). **Blocking for standalone.** |
| Lock-screen Allow/Deny for tool permissions | Push category for `chat.permission.requested` with idempotent decision routes. |
| Inline widgets | Serve widget assets on a reachable, still-isolated origin (e.g. a second advertised port, DPoP-ticketed) so a WebView can load them. |
| Off-LAN use | Cloudflare tunnel (`CLOUDFLARE_TUNNEL_RELAY_PLAN.md`) + `publicEndpoints` in `endpointPlan.ts`. Relay is parked. |
| Syntax highlighting without shipping Shiki | Optional `GET /api/highlight` (S3); on-device `react-native-shiki-engine` is the default choice, so this is not blocking. |
| Narrow run control | Optional `exec:runs` scope so a phone can cancel/pause without full authoring. |

### 4.3 Feasible with a scope grant (policy, not code)

Terminal (`exec:terminal`), browser control (`exec:browser`), computer-use viewing + consent (`exec:computer`), commit/PR/checkpoint restore/file write (`write:workspaces`), attachments (`write:files` per ledger; server actually gates uploads on `write:chats`), workflow/automation authoring and run control (`write:workflows`), project/codebase writes (`write:projects`), agent/skill/MCP/extension/system writes (`admin:settings`), device management (`admin:devices`). The plan proposes pairing presets and a request flow (§5.1) so these are one tap away on a trusted device instead of a hidden admin call.

### 4.4 Feasible with a mobile-shaped redesign

| Web | Mobile shape |
|---|---|
| React Flow canvas | Read-only Skia DAG (pinch/pan) + **stage outline editor** (reorder, add/remove, edge type per link). Full canvas editing only on tablet ≥ 700 pt. |
| Right pane with 9 tab kinds | Swipeable session panes (Chat · Changes · Terminal · Browser · Computer) + a "More" sheet for Files / Plan / Tasks / Widgets / Inspector. |
| Hover previews, hover-revealed actions | Long-press context menus (native), swipe actions. |
| Settings modal with 14 sections | Grouped list → pushed screens (already the pattern). |
| Split diff | Unified by default; split only ≥ 700 pt. |
| Text-selection review comments | Long-press a diff line (or drag a range handle) → comment sheet. |
| Command palette | Global search sheet. |

---

## 5. Server and shared-package work

### 5.1 Scope model for a standalone client (decision required)

Keep `DEFAULT_MOBILE_SCOPES` as the **Companion** preset. Add a **Standalone** preset selectable on the pairing screen (web/desktop Settings › Security already has presets `default/readonly/companion/workstation`):

```
STANDALONE_MOBILE_SCOPES = DEFAULT_MOBILE_SCOPES
  + write:workspaces + write:files + write:workflows + write:projects
  + exec:terminal + exec:browser
```

`exec:computer`, `admin:*` stay opt-in per device. Every high-risk grant already audits at critical level. On the phone, `exec:*` and `admin:*` actions get a biometric step-up (local) before the first use in a session.

### 5.2 Required server changes (ordered)

| # | Change | Files (indicative) | Blocking |
|---|---|---|---|
| S1 | `read:activity` scope: allows `global` subscription filtered to `LIFECYCLE_EVENT_KINDS`; add to mobile presets | `packages/auth/src/scopes.ts`, `routes/stream.ts:108-124`, `composition/streamScopes.ts` | **Yes (P0)** |
| S2 | Scope-request flow: device posts a request; admins see pending requests in Settings › Security (web/desktop) and on other admin devices; approval calls the existing scopes route | `routes/auth.ts`, `DeviceService`, web `Security.tsx` | Yes for standalone |
| S3 | Push category `approval` for `chat.permission.requested` + Expo action buttons (`approve`/`deny`) + idempotent decision endpoints | `notificationPolicy.ts`, `PushDispatcher.ts` | Yes for lock-screen approvals |
| S4 | `POST /api/chats/:id/cancel` accepts `{force, budgetSeconds}` (web has the same gap) | `routes/chats.ts`, `client-core/api/client.ts` | No |
| S5 | Widget assets on a reachable isolated origin with ticket auth | `apps/server/src/index.ts:693-708`, `wsAuth.ts` | No (Phase 6) |
| S6 | Tunnel transport per `CLOUDFLARE_TUNNEL_RELAY_PLAN.md`; `publicEndpoints` through `endpointPlan.addDirect()` | desktop + `client-transport` + mobile `endpointPlan.ts` | Yes for off-LAN |
| S7 | Mux client: treat a 403 on `POST /stream/connections` as a rejection of the named scope(s) (parse `requiredScopes`), drop them from `wanted()`, reconnect with the rest | `client-core/src/stream/MuxStreamClient.ts` | **Yes (P0 hardening; web benefits too)** |

Optional: `GET /api/highlight` (S3 in the companion plan), `exec:runs` scope, APNs/FCM direct providers.

---

## 6. Design overhaul

### 6.1 Design language (one system, three renderers)

- **Tokens** stay sourced from `@generatorai/design-tokens` (`tokens.generated.ts`). Adopt the three axes exactly as web: mode (`system|light|dark`, default dark) × theme (17) × accent (6), persisted under the same keys (`generatorai-theme`, `generatorai-theme-palette`, `generatorai-accent`) so a user who knows one client knows the other.
- **Per-theme radius and fonts.** Web radius is per theme (4–20 px). Mobile currently hardcodes 12/16/24. Fix: `radius.sm/md/lg` from `themeMeta[theme].radius`, mapped to rows (`lg`), cards (`xl`), sheets (`xl + 8`), pills (full). Bundle JetBrains Mono (already the native mono); sans stays system (SF / Roboto) — matching `NATIVE_FONT_FAMILY`.
- **Surface ladder** `background → card → popover → raised → subtle → emphasis`, 1 px `border` dividers, colour only for status/accent — the web's "quiet chrome" rule, kept.
- **Type scale** (from tokens): 11 / 12 / 14 / 15 / 17 / 20 / 24 / 30. Body 15 on phone (one step above web's 14 for touch distance), agent-surface text 12–13.5, code 12.5 at line-height 1.45. Dynamic Type on for prose, capped at 1.3–1.5× for chrome and mono.
- **Motion** (tokens): fast 120 / normal 180 / slow 220 ms; springs (`withSpring`, damping ≈ 50) for sheets and Material 3 Expressive feel on Android; every animation carries `ReduceMotion.System` (already the pattern). Compositor-only properties.
- **Status = icon + label, never colour alone** (web rule; already followed in `StatusDot`/`Badge`).
- **Haptics vocabulary** (existing `haptics.ts`): `select` on tabs/pickers, `tap` on light actions, `commit` on send/approve, `success`/`error` on outcomes, impact on swipe arm and sheet detent. Respect Low Power Mode.
- **Platform adaptation**: iOS 26 Liquid Glass tab bar via expo-router Native Tabs (feature-flagged with JS fallback), bottom accessory strip for "N waiting for you"; Android 16 edge-to-edge (mandatory at targetSdk 36), predictive back **off** until react-native-screens supports it, Material ripple on Android only.

### 6.2 Information architecture

Four native tabs plus a persistent "needs you" accessory:

```
┌───────────────────────────────────────────────┐
│  Home        Chats        Work       Projects │  ← Native tabs (iOS 26 glass / M3)
└───────────────────────────────────────────────┘
   ▲ "2 waiting for you" accessory strip (tap → Approvals sheet)
```

| Tab | Contents | Rationale |
|---|---|---|
| **Home** (was Activity) | Approvals queue (first, always), stat rail, feed Today/Running/Needs you, health card, global search (pull down), quick actions (New chat / New workflow / Pair a device) | Codex/Cursor pattern: approvals are a first-class list, not buried in transcripts |
| **Chats** | Search, Active/Archived, swipe actions, New chat sheet (full create dialog) | unchanged, proven |
| **Work** | Segmented Workflows · Runs · Automations · Scripts; FAB "New" per segment | absorbs builder-lite, run controls, automation create |
| **Projects** | Projects, codebases, agents (segment), skills/MCP browse | agents move here from Settings (they are authoring, not preferences) |
| Settings | Header gear on every tab (unchanged) | HIG: settings is not a peer destination |

Route-addressable sheets (expo-router `formSheet`): `/approvals`, `/chats/[id]/gate/[interactionId]`, `/chats/[id]/plan/[planId]`, `/pair`, `/scope-request`. Push payloads carry these routes, so a notification opens the exact card.

### 6.3 Navigation model and gestures

| Gesture | Where | Result |
|---|---|---|
| Swipe from left edge | any pushed screen | back (iOS native; Android system back) |
| Horizontal swipe (from ≥ 24 pt inside) | chat session | switch session pane Chat ↔ Changes ↔ Terminal ↔ Browser ↔ Computer (pager, only panes that exist for this chat) |
| Horizontal swipe | Home / Work / Chats filter row | next/previous segment (already implemented) |
| Vertical drag on sheet header or body edge | Workbench / detail sheets | detents 28 / 60 / 92 %; drag anywhere, not just the grabber |
| Long-press | message, tool row, file row, diff line, chat row, run row | native context menu (zeego): Copy, Share, Read aloud, Open in Changes, Comment, Retry, Archive, Cancel… |
| Swipe row left | chat / run / automation / device rows | Archive · Delete / Cancel · Retry / Revoke (arming haptic at 50 %) |
| Pull to refresh | every list (never the transcript) | refetch + haptic |
| Re-tap active tab | tabs | scroll to top (exists) |
| Pinch | diff, terminal, browser view, DAG | font size / zoom |
| Two-finger tap | browser (take-control mode) | right-click equivalent |
| Shake | anywhere (debug builds) | diagnostics sheet |

Animations: shared-element transition from a chat row to the chat header (RN 0.86 view transitions where available, else crossfade); tool rows enter with a 180 ms 3 pt rise; grouped rows expand with layout transition; approval cards spring in from the composer; send button morphs (kept); "Latest" pill fades; skeleton shimmer once per screen then optimistic rows.

### 6.4 Chat session screen (the core)

```
┌ ‹ Back   Chat name ▾        [●LAN] [⋯] ┐   header: transport badge, menu (rename, archive, edit sources, share)
│ Chat  · Changes 3 · Terminal · Browser │   pane strip (expo-router/ui TabList; swipeable)
├────────────────────────────────────────┤
│  transcript (LegendList, tail-aligned) │
│   ┌ Read 5 files              +12 −3 ┐ │   grouped tool row with file-op chip
│   ┌ ▸ Agent: explore auth  (3 steps) ┐ │   subagent nesting
│   markdown answer (native text)        │
│   ⚠ MCP "github" failed to start      │   warning row
├────────────────────────────────────────┤
│ 📎 3 files changed  +40 −12  Review ▸  │   changes tray (collapsible)
│ ▣ Allow "Bash: pnpm test"?  Deny Allow │   pinned gate card (permission / question / plan)
├────────────────────────────────────────┤
│ [ + ] Ask anything · / actions · @files│   composer card (radius from theme)
│ Claude Opus ▾ · Plan ▾ · ⋯    ◔ ➤     │   model / mode / options / gauge / send-stop
└────────────────────────────────────────┘
```

- **Panes** replace the single Workbench sheet for the heavy surfaces (Changes, Terminal, Browser, Computer) because they need full height and their own gestures; Files, Plan, Tasks, Widgets, Inspector remain in a "More" sheet reachable from the strip's `⋯` and from slash commands. Panes mount lazily and unmount WebViews when hidden; sockets gate on `active`.
- **Timeline rows** adopt the web taxonomy (Appendix D): grouped rows, file-op rows with inline diff (≤ 160 lines, "Open full diff"), shell rows → Agent Console, screenshot rows → image sheet, subagent nesting, warning/error rows, waiting-for-you state, failed flag, usage chip with cache-miss hint. Rows are cards with a 28 pt leading icon (kept) rather than a 1 px rail.
- **Composer**: row 1 attachments chips (photo, camera, files, clipboard image, browser/terminal captures), row 2 slash/@ suggestion strip, row 3 field + mic, row 4 `+`, model chip, mode chip, options chip, gauge ring, send/stop. Long-press send = "send with plan mode"; swipe up on the field = prompt history sheet. Voice pill shows an 18-bar waveform (Reanimated shared values from the existing `amplitude`), pause/resume, cancel/accept; "scratch that" retraction ported from web.
- **Gates**: pinned cards stay (kept); each also exists as a route sheet for push deep links; Deny reveals an optional reason; plan card offers Approve & implement / Approve & run autonomously (when offered) / Request changes / Open plan.
- **Header transport badge**: LAN · Tunnel · Offline, with tap → diagnostics; a slim reconnect/offline strip above the composer with three states (offline / reconnecting / relay fallback) and a "events may be missing — refresh" action on gap.

### 6.5 Changes and review pane

Unified diff by default, virtualised per line (LegendList sections with sticky file headers), word wrap on with per-file no-wrap + horizontal scroll, `+N −M` chips, base picker (session start / branch base / turn checkpoints), expand/collapse all, refresh, mount group chips. Syntax colour via `react-native-shiki-engine` on settled hunks only, capped at 500 rendered lines per file with "load more". Long-press a line → **Review comment sheet** (intent pills Fix / Question / Refactor / Test / Note); threads render inline under the line with status pills; a **batch bar** at the bottom: "3 pending · Send all to agent" with note. Per-file discard (checkpoint restore, two-step). **Checkpoints** sheet: compare / rewind with per-mount report and undo. **Commit / Create PR** in a bottom action bar when `write:workspaces` is held (title + description sheet; PR list with external link).

### 6.6 Terminal pane

Two tiers: (1) **Agent Console** — a native, virtualised list of the agent's commands with status, `$ command`, and output (this is what people open on a phone 90 % of the time; no WebView); (2) **Interactive PTY** — vendored xterm.js (or ghostty-web) inside a `react-native-webview` loaded from a local bundle with no network, RN owning the socket (existing bridge), theme from `terminalThemes`, 2k scrollback, unmounted when the pane is hidden. Chrome: cwd pill, host/agent badges, worktree `cd` menu, find (inline), clear, kill, restart. Input: sticky hotkey bar above the IME (Esc, Tab, Ctrl sticky, Alt, arrows, `|`, `~`, `/`, `-`), hold-space-and-slide for arrows, pinch zoom, hardware-keyboard detection hides the bar, snippets (recent commands). Attach selection → composer chip. Multi-session tabs (≤ 4) in the pane header.

### 6.7 Browser pane

Screencast over the browser WebSocket (JPEG; VP8 only where a decoder is available), keyframe on focus, polling fallback. Default **watch mode**: URL, back/forward/reload, share/attach toggle, read-page (a11y text) view for small screens. Opt-in **Take control** (requires `exec:browser`, one-tap toggle with haptic): the server viewport is set to the phone's logical size × DPR via `POST …/browser/resize` so taps land where aimed; pointer/scroll/keyboard forwarded through `POST …/input`; two-finger tap = right-click; device toolbar presets. Inspect (tap element → note → attachment) and Capture (drag rectangle → PNG chip) both feed the composer. Tabs ≤ 5 in the pane header.

### 6.8 Computer-use pane

View + consent only (requires `exec:computer` grant). Now / Replay segmented control, target-window PNG per turn fetched from `…/recording/turns/:turn/:kind`, cursor overlay from `computer.preview.cursor`, activity list, consent card (Allow once / Allow all this run / Always allow / Deny) with the takeover warning, grants list with revoke, driver runtime status/start/stop, recording toggle. Never forwards pointer input.

### 6.9 Work surfaces

- **Runs**: header (status pill, progress bar, elapsed, parallel/awaiting badges), controls Pause/Resume/Cancel/Retry when `write:workflows`, pipeline strip, stage timeline with the same `StreamPanel` rows as chat, sleeping countdown + Wake, inline HITL (Approve / Request changes / Reject), Inspector sheet (Files/Output/Hooks/Tools), panes Changes/Files/Browser/Terminal.
- **Workflows**: list (search, tags, import JSON from Files app, export/share), definition (read-only Skia DAG with pinch/pan + stage list + Run + Edit), **Builder-lite**: outline editor (ordered stages, add/duplicate/delete, drag to reorder, edge type per dependency chip), stage editor form (identity, model/effort/tier, prompts inline/files/agent, skills, MCP, variables, execution, retry, validation, output format, hooks), workflow settings (general, codebases, variables, hooks, tags), validate, save, unsaved-changes guard, run dialog (variables, uploads, stage overrides). On tablet ≥ 700 pt the DAG canvas becomes editable (drag nodes, connect handles) beside the form.
- **Automations**: create flow as a stepper (Basics → Trigger → Workflows → Input mode → Retry → Review) with cron helper and webhook credentials shown once (copy + share); detail with Run now (dataset sheet), enable/disable, rotate token, executions with cancel, per-iteration Changes.
- **Scripts**: list, detail, run with profile, materialise.
- **Projects / codebases**: create (name, retention, max codebases), add git-remote codebase (URL, branch, alias), fetch/logs/delete, branches picker, worktrees (cleanup/remove), files browser; project customization (skills/prompts/agents/MCP enable, add custom MCP http/stdio).
- **Agents**: list with scope/role filters, editor as sectioned form (identity, instructions with byte counter, role, skills/MCP toggles, tool policy tri-state, team, runtime), effective-capabilities preview, import `.agent.md` from Files, export/share.

### 6.10 Settings

Mirror the web's four groups with every section (§2.13), all as pushed screens on the `<Screen>` scaffold: General (default model, default reasoning), Appearance (kept), Notifications (two-toggle model "when the agent decides" / "when action required" + per-category detail, quiet hours, Live Activities toggle), Model providers (kept), Agents/Skills/MCP/Templates (browse + enable where scope allows; custom MCP add), Source control, Browser & Terminal, Computer use, Audio, Extensions, Security & devices (rebuilt on the design system: posture, this device's scopes with **Request access** rows, pair another device with QR + preset, pending grants, devices with scope toggles + revoke, biometric app lock, local-only mode), Storage, Diagnostics, Accessibility (text size, reduce motion, haptics), About.

### 6.11 Tablet, foldables, landscape

`onLayout`-driven breakpoints (Dimensions lies in Split View): < 700 pt single column; ≥ 700 pt two-pane — sessions list | session (expo-router SplitView on iPad, JS split elsewhere), chat | active pane side by side, DAG | stage form, settings nav | section. Landscape phones: Workbench detents in points, not fractions; composer keeps a minimum 3 visible transcript rows.

### 6.12 Accessibility

VoiceOver/TalkBack: every tool row `button` with `expanded` state; live region announce for "Waiting for you"; diff lines prefixed added/removed; gates announced assertively. Dynamic Type as §6.1. Reduce Motion: crossfades instead of springs, no shimmer, no typewriter. Contrast is guaranteed by tokens (AA by construction). Minimum targets 44 pt / 48 dp (existing `MIN_TARGET`).

---

## 7. Technical architecture and performance plan

### 7.1 Stack decisions

| Concern | Decision | Notes |
|---|---|---|
| Runtime | Expo SDK 57 ≥ 57.0.17, RN 0.86.3, Hermes V1, New Architecture only | pins fix worklets memory + dev-start regressions |
| Router | expo-router 57; **Native Tabs** behind a flag with JS-tabs fallback; `Stack.Protected` for paired/unlocked gating; `formSheet` routes for gates/plans/pairing; `expo-router/ui` `TabList/TabSlot` for session panes; SplitView on iPad | alpha APIs isolated behind one module |
| Panes | `react-native-pager-view` v7 driven by the router tabs; pager ignores the left 24 pt so the back gesture survives; inner horizontal scrollers use `simultaneousHandlers`/edge hand-off | |
| Lists | `@legendapp/list` v3 for the timeline (no recycling, `anchoredEndSpace`, `KeyboardAwareLegendList`); recycling on for uniform lists | keep |
| Keyboard | `react-native-keyboard-controller` (`KeyboardStickyView` composer, interactive dismiss, hotkey toolbar) replacing `KeyboardAvoidingView` + measured offset | |
| Markdown | `react-native-enriched-markdown` for settled blocks; `react-native-streamdown` (worklet parse, auto-closes fences) for the in-flight block; existing `marked` renderer kept behind a flag as fallback | both young; pin versions |
| Code highlight | `react-native-shiki-engine`, one instance, settled fences/hunks only, lazy | |
| Diff | custom virtualised unified view (no viable RN lib); server hunks from `changes/file` | |
| Terminal | vendored xterm.js (+ ghostty-web fallback) in WebView, local bundle; native Agent Console list | fixes D3 |
| Sheets | keep the in-house Reanimated `Sheet` (drag-anywhere added); remove gorhom + portal | D21 |
| Styling | keep NativeWind 4 over generated tokens (web token parity is the point); do not migrate to Unistyles now | revisit if theme switching shows re-render cost |
| Menus | `zeego` for native context menus (needs dev client — already the case) | |
| Storage | MMKV v4 (prefs, drafts, last route, pane state) + SecureStore (keys/session) | |
| Audio | expo-audio `useAudioStream` (kept) → 16 kHz PCM → STT WS; TTS via sentence-file playlist (kept); background playback flags | |
| Notifications | expo-notifications categories with Approve/Deny actions (iOS reliable; verify Android background actions on device, fall back to tap-through); headless task posts the decision | |
| Long-running runs | `expo-widgets` Live Activities (iOS) updated via push; Android 16 `ProgressStyle` Live Update via a small Expo module, foreground-service fallback | |
| Device key | Implement `GeneratorAIDeviceKey` Expo module (Secure Enclave / StrongBox, non-extractable P-256; software fallback reported in posture) | fixes D4 |
| Biometrics | `expo-local-authentication` app lock + privacy overlay on background; step-up before `exec:*`/`admin:*` first use | |
| Links | `generatorai://` scheme for LAN; universal/app links for the tunnel domain; QR, push and deep links share one URL grammar | |
| Android | targetSdk 36, edge-to-edge insets everywhere, predictive back off, `tabBarRespectsIMEInsets` | |
| Testing | vitest for logic (kept); add React Native Testing Library for screens/hooks; Maestro flows on device for pair → chat → approve → diff; `react-native-performance` marks | |

### 7.2 Streaming and rendering performance

1. Keep the shared reducer; coalesce effects per frame (existing 16 ms tick) but make the timer demand-driven (D14 companion: stop the interval when nothing is pending).
2. Only the in-flight block re-renders per token: streaming text goes through a per-key selector into `streamdown`; settled blocks are memoised on identity (kept).
3. Native text for the growing block so re-layout happens in `NSAttributedString`/`Spannable`, not the JS tree.
4. Tool results are lazily stringified on expand and capped (kept, 4 KB); inline diffs capped at 160 lines; full diff virtualised.
5. Unmount hidden panes' WebViews; gate sockets on pane `active`; terminal scrollback 2k lines; browser stream only for the visible pane.
6. `freezeOnBlur` on off-screen stacks (kept); evict stream state for chats not visited in the last N (fix D14 with `clear`/LRU, mirroring web's `evictStream`).
7. MMKV synchronous reads for first frame (theme, last route, drafts).
8. Budgets: 60 fps at 200 tok/s on a Pixel 6a and iPhone 12; time-to-first-token paint < 150 ms after the event; cold start to Home < 1.2 s warm cache; memory < 300 MB with one terminal + one browser pane; measured in CI with `react-native-performance` and re-measured after each SDK patch (Hermes V1 memory history).

### 7.3 Connectivity and resilience

- Transport order: pinned LAN → other advertised private endpoints → tunnel public endpoint (S6) — `EndpointSupervisor` already does failover; add the public candidate.
- Mux client fix (S7) plus per-scope rejection surfacing in the UI ("Activity feed needs `read:activity` — Request access").
- Offline: TanStack `onlineManager` wired to NetInfo; mutations paused offline; an outbox for prompts and gate decisions with idempotency keys (client-side; server routes are already 409-safe for duplicate decisions); banner states offline / reconnecting / degraded.
- Resume: on foreground, one "live state" snapshot (pending interactions across chats + runs awaiting input) before streams reattach — the Codex pattern; this also feeds the Approvals queue.
- Session TTL: sliding 48 h resume is short for a phone in a drawer; propose a per-platform TTL (mobile 30 days) with biometric-gated resume — server config knob exists (`GENERATORAI_SESSION_TTL_HOURS`) but is global.

---

## 8. Feature interlinking map

```
Push / Live Activity ──► route sheet (/chats/[id]/gate/[iid]) ──► decision ──► stream settles card
Home › Approvals queue ──► same sheets ──────────────────────────┘
Chat tool row (file-op) ──► Changes pane focused on file ──► long-press line ──► Review comment ──► batch send ──► next turn
Chat shell row ──► Terminal pane › Agent Console ──► "Attach selection" ──► composer chip
Browser Inspect / Capture ──► composer chip ──► prompt
Plan card ──► Plan sheet (edit, comment) ──► Approve ──► implementation turn ──► Changes tray pulses
Orchestrator chat ──► Tasks sheet ──► worker chat (real chat screen) ──► back
Run stage awaiting_input ──► HITL card ──► approve ──► stage stream continues ──► Changes pane base = stage
Workflow outline editor ──► stage form ──► save ──► Run dialog ──► Run screen
Automation ──► execution ──► run screen ──► iteration Changes
Scope-locked control ──► LockedState with reason ──► Request access sheet ──► admin approves on trusted device ──► token refresh ──► control unlocks in place
QR pairing ──► consent (host, endpoint, fingerprint, preset, scopes) ──► Home; Settings › Security can pair *another* device by showing a QR
```

Every gated control renders the reason and the request path instead of hiding (kept from `FeatureLocked`), so the standalone client never shows a dead button.

---

## 9. Phased implementation plan

Effort is one senior RN engineer unless noted; ranges are estimates. Each phase ends with a device sweep (iPhone + Pixel, light + dark, default and 1.5× text, Reduce Motion on) and green `typecheck`, `test`, `lint`, `tokens:check`.

### Phase 0 — Stabilise and prove the device path (1.5–2 weeks)

Goals: the default install works, on a real phone, on and off the LAN.

- S1 + S7 (server activity scope; mux 403 handling) and mobile `useGlobalStream` uses the new scope; UI surfaces a rejected scope.
- D1 security header/back; D7 mode seeding + persistence via `PATCH defaultAgentMode`; D9 cancel body (S4); D10 blocked chats counted; D17 route allow-list; connection status strip app-wide.
- EAS development + preview builds on one iPhone and one Android; CI step for `expo export`; a Maestro smoke flow (pair → open chat → send → stop).
- S6 tunnel public endpoint in `endpointPlan.ts` (client side; desktop side per the tunnel plan) — or, if the tunnel lands later, document `GENERATORAI_ADVERTISED_URL` as the interim.
- `GeneratorAIDeviceKey` Expo module (D4) — can slip to Phase 1 without blocking.

Exit: a phone paired with default scopes streams a chat live; approve a permission from the phone; works over the tunnel; both store-preview builds install.

### Phase 1 — Foundation: shell, design system v2, scope model (2–3 weeks)

- Navigation shell: Native Tabs (flagged) with JS fallback; Home/Chats/Work/Projects; "needs you" accessory; `Stack.Protected` gating; formSheet routes for gates/plans/pair/scope-request; error boundaries; deep-link grammar shared with QR and push.
- Design system v2: per-theme radius/fonts; `Screen` v2 with large-title + search; drag-anywhere `Sheet`; zeego context menus; `KeyboardStickyView` composer container; toasts with logs; rebuild `pair`, `revoked`, `security` on the system (D22); remove dead files/deps (D11, D21); reduce-motion branches (D23); dedupe encoders (D15); stream store eviction (D14).
- Scope model: Standalone preset (S1 scopes), Request-access sheet (S2 client side), biometric step-up, app lock + privacy overlay, Accessibility settings (motion/haptics/text size) (D8).
- Storybook-style gallery screen (debug builds) for primitives in every theme.

Exit: every screen on the design system; scope request round-trips end to end; tabs + sheets pass the device sweep.

### Phase 2 — Chat core parity (3–4 weeks)

- Timeline: grouped rows, file-op rows with inline diff, subagent nesting, error/warning/failed/waiting states, screenshot rows, usage chip with cache hint, hooks rows, attachments on user messages, "stopped" marker, archived banner (D5, D6, D29).
- Markdown: enriched-markdown + streamdown behind a flag; images; link scheme allow-list (D18); Shiki for settled fences.
- Composer: attachments (photo/camera/files/clipboard; chips with preview; multipart send) (D2); bound-agent chip; codebase panel; full slash-command source (skills, prompts, `/computer-use`); `@` mentions attach content; prompt history sheet; workspace prep bar; gate banner with "Cancel and send"; gauge breakdown sheet; optimistic option changes (D24).
- Voice: waveform pill (D16 fix by moving amplitude to a shared value), pause/resume/cancel/accept, "scratch that", push-to-talk option.
- Changes tray above the composer.
- New chat sheet: agent overrides + capabilities preview, tags, sources picker (codebase + branch mode + worktree/in-place + alias), browser visibility.
- Approvals queue on Home (live snapshot + stream).

Exit: transcripts render identically to web for the recorded fixture set; attachments round-trip; a plan-mode chat can be run end to end from the phone.

### Phase 3 — Workbench: changes, review, files, plan, tasks (2–3 weeks)

- Session panes (pager + router tabs) with Changes as the first heavy pane; unify the two Changes surfaces (D20); virtualised unified diff with wrap/no-wrap (D13), Shiki hunks, split view on tablet.
- Review comments (long-press line → sheet; threads; batch bar; send to agent); checkpoints sheet (compare/rewind/undo); commit/PR action bar (scope-gated).
- Plan sheet: revisions, edit + save as revision, comments, approve/changes/discard, save to workspace; single decision encoder (D12).
- Background tasks: digest, open worker chat, cancel.
- Files: multi-repo, breadcrumb, preview/source, wrap, share file.

Exit: a code-review-from-the-sofa flow (read diff → comment → send → next turn → commit) works on the phone.

### Phase 4 — Execution surfaces: terminal, browser, computer (3–4 weeks)

- Terminal: Agent Console (native); vendored xterm.js WebView bundle with theme, find, ≤ 4 tabs, restart (D3, D31); hotkey bar + gesture arrows + pinch + hardware-keyboard detection; attach selection; worktree `cd`.
- Browser: WS JPEG screencast; watch mode; Take-control mode with viewport emulation; Inspect + Capture → chips; share/attach toggle; device presets; ≤ 5 tabs; pending captures in the composer.
- Computer use: view + consent pane; grants; runtime; recording.
- Slash `/browser` `/terminal` open the panes and pre-start sessions.

Exit: with `exec:*` granted, all three panes work over LAN and tunnel; without, each shows the reason and the request path.

### Phase 5 — Work surfaces: runs, workflows, automations, projects, agents, scripts (4–5 weeks)

- Runs: full run screen (controls, pipeline strip, stage timeline with StreamPanel, wake, HITL, Inspector, panes); stop polling after terminal (D19).
- Workflows: list upgrades (tags, import/export, templates), read-only Skia DAG, outline editor + stage form + workflow settings + validate/save + run dialog; tablet canvas editing.
- Automations: create stepper, detail actions, executions with cancel and iteration changes.
- Projects/codebases: create, add git-remote codebase, fetch/logs/delete, branches, worktrees, customization (skills/prompts/agents/MCP).
- Agents: list + editor + import/export; move agent picker to Projects tab.
- Scripts: list/detail/run/materialise. Hooks inside the stage/workflow editors.

Exit: a workflow can be created, run, approved and reviewed entirely from the phone; automations can be created and triggered.

### Phase 6 — System: settings, notifications, Live Activities, widgets, tablet (2–3 weeks)

- Settings parity (§6.10) including pair-another-device QR, device scope toggles, custom MCP, audio, storage, computer-use, extensions (admin-gated).
- Notifications: two-toggle model, Approve/Deny actions (S3), quiet hours, Live Activities (iOS) and Android Live Updates for runs; badge counts.
- Widgets: WebView host once S5 lands; otherwise keep the honest placeholder.
- Multi-server connections (switch/forget); global search sheet; iPad SplitView and two-pane layouts; hardware keyboard shortcuts on iPad.

Exit: notification tap and lock-screen action open/resolve the exact gate; iPad two-pane passes the sweep.

### Phase 7 — Hardening and store readiness (2 weeks)

- Performance pass against the §7.2 budgets; memory soak with terminal + browser panes; Hermes/worklets regression check.
- Accessibility audit (VoiceOver/TalkBack scripts, Dynamic Type 2×, Reduce Motion, high contrast theme).
- RNTL screen tests for chat, gates, composer, changes; Maestro device flows in CI (pair, chat, approve, diff, terminal).
- Store readiness: privacy manifests, `usesNonExemptEncryption`, background modes justification, EAS Update channels, crash reporting (Sentry) parity, localisation scaffold, `docs/` + `.github/docs/apps.md` updated, `MOBILE_CAPABILITIES` ledger made truthful.

Total: **≈ 20–26 engineer-weeks** for one engineer; ≈ 12–14 calendar weeks with two (Phases 2/3 and 4/5 parallelise after Phase 1). Server work (S1–S7) is ≈ 2 weeks and sits in Phases 0, 1 and 6.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Native Tabs / SplitView are alpha in expo-router | Flag with JS fallback; isolate behind one module |
| Android notification action buttons unreliable in killed state | Verify on Android 14–16 devices in Phase 0; tap-through deep link fallback |
| Predictive back breaks router stacks | Keep `predictiveBackGestureEnabled: false` until screens v5 |
| enriched-markdown / streamdown are young | Keep the `marked` renderer behind a flag; fixture-based rendering tests |
| Hermes V1 + worklets memory regressions | Pin ≥ 57.0.17; memory budget in CI |
| Scope widening for standalone raises the blast radius of a lost phone | Standalone preset is explicit at pairing; biometric step-up; app lock; short resume TTL unless biometrics; remote revoke already cascades |
| Tunnel plan slips | `GENERATORAI_ADVERTISED_URL` documented as interim; transport code path is the same |
| Two Changes/diff implementations already diverged; a third (virtualised) would make it worse | Phase 3 replaces both with one component used by Workbench pane, run page and automation iterations |

---

## 11. Decisions requested from the reviewer

1. **Scope model**: approve the Standalone preset (§5.1) and the in-app request flow (S2). Alternative: keep Companion only and treat §2 "✗ needs scope" rows as out of scope.
2. **`read:activity` scope vs filtered `global`** (S1): new scope (cleaner audit) or filter-by-holder (no schema change). Recommendation: new scope.
3. **Widgets on mobile**: fund S5 (reachable isolated origin) or keep the placeholder permanently. Recommendation: defer to Phase 6, decide after Phases 0–3 ship.
4. **Workflow authoring depth**: outline editor + tablet canvas (recommended) vs phone canvas.
5. **Browser take-control**: ship in Phase 4 (recommended, `exec:browser` gated) vs watch-only.
6. **Computer use on phone**: view + consent with explicit grant (recommended) vs never.
7. **Markdown engine**: adopt native enriched-markdown/streamdown behind a flag (recommended) vs keep `marked`.
8. **Session TTL for phones**: per-platform 30-day resume with biometrics (recommended) vs global 48 h.
9. **Ordering**: Phases 2/3 before 4/5 (recommended: chat and review are daily use; terminal/browser are scope-gated).

---

## 12. Implementation status (Sept 7 2026)

Decisions 1–9 were taken as recommended. Everything below is on `arch-redesign`, uncommitted, verified by `typecheck`/`test`/`lint` per package and by a live phone-viewport pass (Expo web preview at 393×852 against an isolated server, three paired devices: admin, companion-scope, legacy-scope). Device builds were NOT produced: this machine has no Android SDK, emulator or Xcode, so anything that needs the native shell (WebView terminal, biometrics, push actions, haptics, native gestures, the Secure Enclave/StrongBox key module) is written and typechecked but unverified on hardware.

### Landed

| Area | What shipped |
|---|---|
| Phone ≠ desktop (bundle) | `@generatorai/shared/client` entry + Metro alias (server config/IPC/OTel/pino out of the phone), per-icon lucide Babel plugin, dead deps removed (gorhom, Skia, background-task, task-manager, sharing, network, qrcode-svg, semver), `scripts/check-bundle.mjs` gate (`pnpm bundle:check`). 6.77 → 5.12 MB before features; 6.50 MB after everything incl. the inlined xterm renderer. No server module in the bundle (guard test `sharedClientEntry.test.ts`). |
| Server S1/S2/S3/S4/S7 | `read:activity` scope (global feed restricted to lifecycle kinds server-side), scope-request flow (migration 52, routes under `/api/auth`, web + phone admin UI, Standalone preset), push for tool permissions/questions/plans with lock-screen Allow/Deny (`approval` category, `approvals` channel), cancel body `{force,budgetSeconds}` (force destroys the provider conversation), per-scope 403 handling in both mux clients. |
| Phase 0 | D0 (strip + retry), D1, D7, D9, D10, D17, D19, D23, D24 fixed; **new** P0 found live: chat stream state was keyed by `data.sessionId ?? chatId` while the screen read `chat.sessionId`, so no live token or gate ever rendered on mobile (content appeared only on history refetch). Fixed in `useChatStream`. |
| Phase 1 | Home/Chats/Work/Projects tabs (JS tabs, Native Tabs behind `USE_NATIVE_TABS`), needs-you strip, Home approvals queue + decision cards, Work segments, Projects › Agents, route sheets `/approvals`, `/chats/[id]/gate/[iid]`, `/chats/[id]/plan/[pid]`, `/scope-request`, pair/revoked rebuilt, design-system v2 (Screen search, drag-anywhere Sheet, ContextMenu, Pager, KeyboardSticky, Chip tones, Toast actions, motion presets), app lock + privacy overlay, biometric step-up (`requireStepUp`, `StepUpGate` on terminal/browser/admin), Accessibility settings (motion, haptics, text size, title collapse, app lock, push-to-talk), stream store LRU (6 chats / 2,000 blocks), base64 dedupe, last-route restore, local Expo module `modules/generatorai-device-key` (Swift + Kotlin, uncompiled). |
| Phase 2 | Timeline model ported from web (grouped rows, subagent nesting, file-op rows with inline diff, shell rows → Agent Console sheet, warning/error/waiting/stopped rows, usage chip with cache hint, attachments on user rows), per-block live selector, demand-driven flush timer, Markdown v2 (GFM, tables, images + lightbox, link allow-list) + dependency-free highlighter, Composer v2 (`useComposerController`: attachment chips via expo-image-picker / file picker / clipboard, slash + @ strips, model/mode/options chips, gauge sheet, prompt history, voice waveform on shared values, gate banner with Cancel-and-send), New chat sheet v2, session panes Chat · Changes · Terminal · Browser · Computer with More sheet (Files, Plan, Tasks, Widgets placeholder, Inspector), header transport badge and menu (rename, share, archive), changes tray. |
| Phase 3 | One Changes surface (route screens + pane), virtualised diff with wrap/pinch/split ≥700pt, review comments sheet + batch send, checkpoints sheet, commit/PR bar, plan sheet (revisions, edit, comments, decisions), tasks pane, files pane. |
| Phase 4 (partial) | Terminal: inlined xterm.js WebView, ≤4 tabs, hotkey bar, pinch, restart/kill, Agent Console (native). Browser pane: watch + start/stop/navigate (take-control, capture chips and the computer-use view are **not** built). |
| Phase 5 (partial) | Work tab shell with Runs/Workflows/Automations lists and Agents list/detail; run detail polling fix. Workflow/automation authoring, scripts, project/codebase CRUD are **not** built. |
| Phase 6 (partial) | Accessibility settings, scope requests and device names in Security, notification categories with actions. Live Activities, widgets, multi-server, iPad two-pane are **not** built. |
| E2E harness | `apps/mobile/e2e/` (Playwright, phone viewport, isolated server) — see its README. |

### Found and fixed by the live pass (none were caught by unit tests)

1. Live rendering keyed under the wrong stream key (above).
2. Stop left the Allow/Deny card pinned: the server emitted `chat.question.expired` for tool permissions; it now emits `chat.permission.expired` (the client also tolerates the old kind).
3. Fit-to-content sheets (menus, confirmations, PR sheet) rendered empty on web (`flex: 0` → `0 1 0%`) and overflowed by the header height on every platform.
4. Two full-width buttons in a row pushed the second off-screen (permission card, Home decision card, plan sheet): `Button grow`.
5. Security screen showed "Revoke undefined" (wire field is `name`); the request sheet broke navigation when opened by URL; the five-segment pane strip truncated "Changes".

### Not done / needs hardware or a later phase

- Device builds, Maestro flows, store readiness, performance budgets measured on a phone (§7.2 numbers are unverified).
- Browser take-control/inspect/capture, computer-use consent pane, browser/terminal capture chips (menu items are honest stubs).
- Workflow outline editor + tablet canvas, automation create, scripts, project/codebase CRUD, run controls beyond approve/open.
- Live Activities / Android live updates, home-screen widgets, multi-server switcher, iPad SplitView, localisation scaffold, Sentry.
- Server: tunnel public endpoint (S6), widget-asset origin (S5), badge counts on push, per-platform session TTL.

## Appendix A — Web feature catalogue (summary)

Areas and control counts from the audit: navigation/shell/shortcuts 32 · dashboard 8 · chat list + create 18 · chat page + panels 26 · composer 24 · streaming timeline 26 · changes/files/review 30 · plan/orchestrator 12 · terminal 12 · browser 14 · computer use 10 · workflow builder + list 32 · workflow runs 14 · automations 18 · projects/codebases 20 · agents 14 · skills/MCP 8 · extensions/widgets 8 · templates/scripts 8 · hooks 5 · settings (14 sections) ≈ 100 · auth/devices/pairing 12 · desktop-only 18. Doc drift noted: `usage-web.md` still describes a `/templates` route, a 4-tab settings page, "no auth", and `POST /chats/:id/archive|stop` routes that do not exist.

## Appendix B — Server surface a phone uses

≈170 routes across 31 routers, 4 WebSockets (terminal, browser, STT, TTS), 1 SSE family (single-scope + multiplexed). Scope read requirements per stream scope: `session|chat → read:chats`, `run|automation|workspace → read:workflows`, `computer → exec:computer`, `terminal → exec:terminal`, `browser → exec:browser`, `global → admin:settings`. Limits that shape the client: 8 mux connections / 32 subs each; attachments 10 MB × 5; workspace file read/write 512 KB; access token 10 min; resume 48 h sliding; stream ticket 30 s; pairing grant ≤ 10 min. Push: Expo only; categories approval / failed / completed; approvals bypass mute; `chat.permission.requested` not pushed.

## Appendix C — P3 defects

D25 `pair.tsx:38` no-op ternary · D26 `settings/index.tsx:35,37` duplicate import · D27 `capabilities.tsx:112` template copy · D28 `workflows/[id].tsx:59` query key bypasses `queryKeys` · D29 `QuestionCard` ignores `header`/`preview` · D30 `NewChatSheet.tsx:206` orchestrator toggle sticks · D31 no terminal restart · D32 `Button.tsx:199` FAB shadow double alpha · D33 no tablet/landscape layouts.

## Appendix D — Timeline row taxonomy to reproduce (from web)

think · tool read/search/edit/run/tool/memory (verb + target + meta) · file-op (+N/−M, inline diff, open in Changes) · shell (→ Agent Console) · screenshot (preview) · grouped (≥2 same kind: "Read 5 files", "Ran 3 commands", "+N more", failed count, summed duration) · subagent (children under the `Agent` call or legacy system note) · warning · error · waiting-for-you (PauseCircle, generating cues stand down) · failed flag · answer (markdown) · streaming indicator · loading skeleton · plan / question / permission cards · inline widget · error box · usage footer (model · ↑in · ⚡cached · ↓out · duration · $ · cache-miss hint) · context gauge (composer).

## Appendix E — Audit working notes

Six working documents were produced during this audit and are summarised above. They are preserved under `docs/research/mobile-audit-2026-09/`:

| File | Content |
|---|---|
| `01-web-feature-catalog.md` | web/desktop feature catalogue (653 lines, ≈470 controls, route inventory) |
| `02-mobile-audit.md` | mobile code audit, screen/module inventory, 33 defects, test/typecheck output |
| `03-server-api-surface.md` | routes, scopes, events, relay/auth, per-subsystem feasibility |
| `04-web-design-language.md` | tokens, type/spacing/motion numbers, composer anatomy, timeline taxonomy |
| `05-prior-mobile-plans.md` | the four prior mobile plans consolidated, 17 contradictions, undelivered checklist |
| `06-external-research.md` | competitor patterns and Expo SDK 57 stack research, 91 sources |
