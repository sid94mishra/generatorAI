# UX Test Findings — browser pass (light + dark, live multistage run)

Tested every top-level page in light **and** dark via Playwright (1440×900), plus a real
two-stage **live** workflow run end-to-end. Verification gates green throughout:
`typecheck` clean · `lint` 0 errors (135 pre-existing warnings) · **167/167 tests**.

Legend: ✅ verified working · 🔧 inconsistency to fix next · 📝 standardization debt.

## ✅ Round 3 — streaming-UI fix, HITL follow-up feature, hooks/handoff/retry/chat (live)
- **In-stage + chat streaming UI fixed**: `AssistantMessage` (persisted/history render) rewritten to the compact, token-based rows used by live `StreamingMessage` (no more hardcoded `bg-*-100` avatar circles / "Complete" pills / `glass-card` box). A stage now looks identical live vs after reload; same fix applies to chat history. Verified in browser.
- **HITL — reviewed end-to-end + NEW follow-up capability**: operator can type free-text in the inline "Add follow-up details" box; **Approve & send** resumes the stage AND injects the text into the stage's live conversation via a new `StageExecutionService.sendStageFollowUp()` (server `/approve` now takes `followUpPrompt`). Verified: interrupt → `awaiting_input` → textarea → Approve & send → stage `awaiting_input → running` (injection path fired). `HitlService` (12) + `StageExecutionService` (9) unit tests pass. *Caveat:* a live agent **reply** to a follow-up needs the stage's session to be alive+idle (awaiting_input / single-session) — the path is in place and unit-covered; the standard post-completion per-stage session is released, so that sub-case can't reply.
- **Hooks (script + function) — live**: a function hook (`injectRequirements`) injected the "CONTEXT INJECTED BY HOOKS" block (project requirements) before the prompt; a `node -e` script hook also persisted + fired. Plus `HookExecutor` (11) + `resolveStageHooks` (9) unit tests.
- **Handoff — live**: `single` mode → both stages shared one session (`f15e57f0`); `per-stage` → distinct sessions (`aaeed5c6` / `8f6de08c`) running in parallel. `single sharesOneSession=true · per-stage usesDistinctSessions=true`.
- **Retry — live**: per-stage "Retry stage" button + header Retry render on failed stages.
- **Chat streaming — live**: message sent via composer → "Copilot is thinking…" loading state → streamed answer rendered in the new compact prose style.
- **Note (composer)**: send is **Ctrl+Enter** (Enter = newline), not the Enter-to-send the plan intended — flag if you want it switched.
- **Note (env)**: the Copilot model was intermittently slow and briefly returned `403 unauthorized` mid-session (recovered) — not a code issue, but it stretched run times.

## ✅ Round 2 — complex workflow driven from the UI (parallel + file changes)
Built a **5-stage fan-out → parallel → fan-in** workflow ("Complex DAG Demo") and ran it
**entirely through the UI** (clicked **Run** → "Start Workflow Run" modal → **Start Run** →
landed on the run page). All confirmed from a user's perspective:
- **UI run journey**: Run button opens the variable/launch modal ("No input variables required", optional prompt/skill/agent uploads); Start Run creates + starts + navigates to the run page. ✅
- **Parallel streaming**: after "Spec & Plan" completed, **Backend Design + Frontend Design ran simultaneously** — `LiveActivityBar` read "**2 stages running**", DagStatusStrip showed both active in definition order, and the spine rendered **both streaming stages at once** (each with the ⚡ parallel badge + context/prompt/response). ✅
- **File changes**: the run produced real workspace files; the **Files & Uploads** tree showed stage-response artifacts (green "new" dots) + the generated `backend/`, and **Review changes** opened the **git-diff viewer** with correct **A/M status badges** ("8 files changed · git diff"; `store.js` = M, `app.js`/`url-shortener-spec.md`/`.workspace.json` = A). ✅
- **Light + dark parity** on the complex run. ✅
- Note (not UI): the agent over-eagerly ran `npm install` and scaffolded a real service for a "design" prompt, so stages ran long; cancelled the test run after validation.

## ✅ Verified working (no action)
- **Live multi-stage run** (`/workflows/:id/runs/:runId`): `LiveActivityBar` ("Running <stage> · N/M · progress · elapsed"), stage **spine** (timeline dot + connector), per-stage `StatusBadge` (icon+label), `DagStatusStrip` pipeline pills, auto-expanded active stage, `StreamingMarkdown` rendering tables/headings/fenced code live, `UsageChip` (model · ↑/↓ tokens · duration), context + stage-summary blocks. Confirmed in **both** dark and light.
- **Failed-state run**: red error banner, header **Retry**, red (failed) + grey (skipped) spine dots, per-stage inline **Retry** (in code).
- **Terminal runs**: `LiveActivityBar` correctly hidden (quiet on completed/failed).
- **Dashboard**: chat + run pills routed through canonical `StatusBadge` (icons: Active/Completed/Cancelled).
- **List pages** (Workflows, Chats, Projects, Scripts, Automations, Templates): shared `SearchInput` + `EmptyState`.
- **Contrast**: filled primary buttons use `--color-primary-emphasis` (≈5:1, passes AA).
- **Theme parity**: dark + light both clean; theme switch persists (`generatorai-theme`).

## 🔧 Inconsistencies to fix next (high value, low risk)
1. **Chat list cards** (`components/chat/ChatList.tsx` / `ChatCard`) still render a bespoke lowercase pill ("active") instead of `StatusBadge`. Route through `StatusBadge` for icon + consistent casing/tone.
2. **Settings tabs** (General/Provider/Models/Advanced) are hand-rolled. They *look* like the `Tabs` primitive but should use it (`pages/Settings.tsx`).
3. **Detail-page tab bars** — migrate to the `Tabs` primitive: `ProjectDetailPage`, `CodebaseDetailPage` (and confirm `AutomationDetailPage`/`ScriptDetailPage`).
4. **Residual bespoke status pills** — ~38 files matched the inline `rounded-full px-2 py-0.5` status-pill pattern. Audit + route the real status pills through `StatusBadge` (e.g. `RunHistoryPanel`, `StageOutput`, `common/SourceBadge`).

## 📝 Standardization / polish debt (Phase 5 remainder + nice-to-haves)
5. **Stage properties drawer** (`StagePropertiesPanel.tsx`) — standardize sections on `CollapsibleSection` + `Input`/`Select` primitives (Phase 5 "stage drawer" item; the **files panel** part of Phase 5 was already complete — `RunArtifactsPanel` has the file tree, A/M/D/R change badges, and a unified diff viewer).
6. **Settings → Appearance** picker is hardcoded Light/Dark/System — wire it to `themes/registry.ts` `VISIBLE_THEMES` so newly-registered themes appear automatically.
7. **Builder canvas** initial view: nodes cluster low-center with large empty canvas; node labels are small; one node sits slightly misaligned. Tighten initial fit/auto-layout.
8. **`DESIGN_SYSTEM.md`** — document the new primitives (`StatusBadge`, `PageHeader`, `SearchInput`, `Tabs`, `EmptyState`), the theme registry, and the contrast rule.

## ⚠️ Data/config (not UI) — worth fixing so the flagship demo runs
9. The seeded **"Playwright CLI E2E Test Run"** workflow pins stages to model **`gpt-4.1`**, which this harness does not expose → stages fail instantly with *"Model 'gpt-4.1' is not available."* Repoint its stage model to an available one (`claude-sonnet-4.6`, `auto`, etc.). Surfaced because the live-run test initially used this workflow; a fresh workflow on the default model streamed end-to-end with no issues.

## Test artifacts created (safe to delete)
- Workflow def **"Live Stream Demo (UX test)"** `9694ff96-…` + its completed run `e8423372-…` (the successful live-stream demo).
- A failed run `1cbf86af-…` of the gpt-4.1 workflow (demonstrates the failed-state UI).
- `.claude/launch.json` (web preview config) — harmless to keep.
