# Test baseline (P0-03)

Recorded 2026-09-25 on `desktop_redesign @ 780e256` (plan + P0-02, before the P0-04 guardrails and P0-05 deletions), macOS (arm64), Node 26.8.2.

## Environment used

- Server: `apps/server/dist-bundle/server.mjs` with `PORT=3100 WIDGET_PORT=3101 GENERATORAI_BIND_HOST=127.0.0.1 DB_PATH=<tmp>/e2e.db ARTIFACTS_DIR=<tmp>/artifacts WORKSPACES_DIR=<tmp>/workspaces GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1 NODE_ENV=test` (fresh temp DB; D-44 — the old `GENERATORAI_DB_PATH` is ignored by the server).
- Web: Vite dev on 127.0.0.1:5173. Suite: `TARGET_URL=http://localhost:5173 API_URL=http://localhost:3100/api pnpm --filter @generatorai/agent-tests test:e2e` (82 tests, 1 worker).
- Browsers: `playwright install` hangs while extracting on Node 26, so Chromium 1208, the headless shell and ffmpeg 1011 were unzipped into `~/Library/Caches/ms-playwright/` by hand (with `INSTALLATION_COMPLETE` markers).
- Providers on this machine: Claude Code ready; GitHub Copilot installed but not signed in.

## e2e (before the P0-03 spec repairs): 57 passed · 23 failed · 2 skipped (19.2 min)

| Spec | Passed | Failed | Skipped |
|---|---|---|---|
| `automations` | 5 | 2 | 0 |
| `chats` | 5 | 1 | 0 |
| `context-usage-ui` | 5 | 0 | 0 |
| `context-usage` | 0 | 5 | 0 |
| `navigation` | 0 | 3 | 0 |
| `projects` | 3 | 2 | 0 |
| `settings-dashboard-templates` | 5 | 6 | 0 |
| `streaming-turn-live` | 0 | 0 | 1 |
| `subsystems-live` | 21 | 1 | 0 |
| `widget-designer-layout` | 1 | 0 | 0 |
| `workflow-builder` | 7 | 1 | 0 |
| `workflow-run` | 1 | 2 | 1 |
| `workflows-crud` | 4 | 0 | 0 |

Failure causes (category: **drift** = the UI changed and the spec is stale; **spec bug**; **env** = depends on the machine):

| Test | Category | Cause |
|---|---|---|
| automations:7, projects:6 | drift | `getByRole('heading', {name})` also matches the empty-state `h3` ("No automations yet", "No projects yet") — strict-mode violation |
| automations:53 | drift | the create form's name field no longer has the "My Automation" placeholder |
| chats:8 | drift | two "New Chat" buttons (header + empty state) — strict-mode violation |
| context-usage:40,71,81,91,102 | spec bug | fetches `${API_URL}/api/harness/models`, but `API_URL` already ends in `/api` (the convention every other spec and CI use) → `/api/api/…` 404 |
| navigation:31,56,85 | drift | sidebar items are links, not buttons; "Dashboard" button gone; Settings dialog locator stale |
| projects:69 | drift | project detail tab set changed |
| settings-dashboard-templates:12,81,163,251,263,283 | drift | Settings dialog header / theme cards / provider "Active" / Templates heading selectors stale |
| subsystems-live:88 | env | asserts the *primary* provider (Copilot) is ready; on a machine without a Copilot login it is not — must assert on the first ready provider (same class of bug as the model-picker fix) |
| workflow-builder:30 | drift | run-condition trigger no longer labelled "Always run" |
| workflow-run:19,60 | drift | stage buttons no longer named `#0 <stage>` |

P0-03 repaired these specs against the current UI (spec-only changes; no app code changed). Per the owner's testing strategy (legacy UI is being replaced), the repaired suite is verified **once, at the end of P0**, together with the P0-04/P0-05 merges; the result is appended below.

## Web unit + typecheck

`pnpm --filter @generatorai/web typecheck` green; `pnpm --filter @generatorai/web test` **69 files / 650 tests** green (happy-dom). The old root `web` vitest project (jsdom) had 7 failures; P0-04 removed that project.

## Desktop smokes

Not baselined in P0: the owner asked not to spend time testing the legacy UI. `right-pane-desktop-smoke`, `desktop-chrome-smoke`, `desktop-diff-review-smoke`, `desktop-diff-render-check` and `terminal-desktop-smoke` got selector/wait repairs against the current UI (stale `chat-toggle-right-pane*` → `header-toggle-right-pane`, pairing waits); they are run for real where the plan needs them — P3 rewrites the chrome smoke for the new shell, P4 the dock/browser/terminal smokes.

## End-of-P0 verification

2026-09-25, `desktop_redesign @ eeec80e` (P0-01…P0-05 applied: guardrails, dead-code deletions, spec repairs), same isolated-server recipe on a fresh temp DB:

**e2e: 80 passed · 0 failed · 3 skipped (3.2 min).** P0-05 is therefore "unchanged vs BASELINE" (every test that passed before still passes; the 23 pre-repair failures were spec drift/spec bugs/env and are fixed in the specs).

Skipped, with reasons:
- `context-usage:74` — asserts a `claude-opus-4.7` budget; skips when that model is not in the local catalog.
- `streaming-turn-live:27` — needs a live provider turn; skipped unless explicitly enabled (unchanged from before).
- `workflow-run:48` — `test.fixme` in the spec (unchanged from before).
- Note: `subsystems-live` "every ready provider publishes a non-empty model catalog" runs here (Claude Code is ready) but **skips on a CI runner with no ready provider**; the primary-provider-ready assertion was replaced because it failed on any machine without a Copilot login. Restoring CI coverage needs a provider that reports ready on the isolated server (the Faux harness, P2-00).

Web unit: 69 files / 650 tests green; typecheck, lint, `check:design --strict`, build, `check:bundle` (309.5 KB gzip initial / 800 KB), `check:css` green.

## End-of-P1 verification

2026-09-26, `desktop_redesign @ 1c2f39a` (all P1 tasks plus P2-00…P2-03), macOS 27 (arm64), Node 26.8.2. The server bundle was rebuilt first because `dist-bundle` predated the P2 commits. Web checks ran against the sandbox (`node scripts/redesign/sandbox.mjs`: server :3197 on a temp DB with the Faux harness and seed, Vite :5197). Desktop checks used fresh `generatorai-p1smoke-*` temp dirs (bare `DB_PATH`/`ARTIFACTS_DIR`/`WORKSPACES_DIR`/`EXTENSIONS_DIR`). Screenshots are in `docs/redesign/shots/p1-verify/{p0,head,diff,empty}/` and `agent-tests/test-results/{desktop-chrome,desktop-smoke,p1-electron-check}/` (both gitignored).

### 1. e2e against the sandbox: 79 passed · 1 failed · 3 skipped (3.1 min)

| | Result | Evidence |
|---|---|---|
| vs end-of-P0 (80 · 0 · 3 on :3100) | 1 new failure, not an app regression | Same 3 skips as P0 (`context-usage:74`, `streaming-turn-live:27`, `workflow-run:48`) |
| `subsystems-live:529` "the UI holds exactly one event stream open for the whole app" | **Stale spec assumption, exposed by 51ae55f (P2-03 G-05)** | `opened 3 event streams` (limit ≤ 2). The test makes 3 full page loads (`gotoApp` = `page.goto`). Since 51ae55f, `useDesktopIntegration.ts:59` calls `useAttentionCounts()` → `useAttention()`, which opens the multiplexed `global` stream at boot on every page (on the web too). So each document opens exactly one stream. At P0 no stream opened on `/`, `/workflows` or `/chats` at all: the P0 build under Vite dev (:5191) made 0 `/api/stream` requests within 8 s, so the ≤ 2 bound passed vacuously. The W26 property still holds: client-side navigation over 6 pages at HEAD opens **1** stream. The spec must navigate client-side (or count per document). |
| Same test against the production builds (`vite preview`) | passes, but for an env reason | Preview origins are not in the sandbox `CORS_ORIGINS` (only :5197), so `POST /api/stream/connections` → 502 and no stream opens |

### 2. Legacy pixel identity, GitHub/blue pinned

Method: P0-close `62c9a46` was built in a temp `git worktree` (removed afterwards) and HEAD in the checkout. Each was served with `vite preview` (:4191 / :4192), with `/api` proxied to the sandbox server. Capture used playwright-core Chromium at 1440×900, DSF 1, `--disable-gpu --force-color-profile=srgb --disable-lcd-text --font-render-hinting=none`, reduced motion, and a clock frozen at the same instant for both builds (so relative times match). localStorage was `generatorai-theme`=dark|light, `generatorai-theme-palette`=github, `generatorai-accent`=blue (keys from `packages/design-tokens/src/registry.ts:53-55`, the same at both commits). The capture waited for network idle (8 s cap), `document.fonts.ready` and 1.5 s. Diff = exact RGB mismatch count. Noise floor (HEAD vs HEAD): 0–135 px, from the live "Generating…" row and uptime.

| Page | dark | light | Masked residual* (dark/light) | Explanation |
|---|---|---|---|---|
| `/projects` | 941 | 869 | 941 / 869 | Lucide 1.x redrawn glyphs only (D-50): logo zap, Chats, Workflows (git-branch), Scripts (FileCode → FileCodeCorner), Settings gear, theme toggle, search, calendar, list-view icons |
| `/workflows` | 918 | 833 | 918 / 833 | Same icon redraws |
| `/` | 148,223 | 148,229 | 1,221 / 1,130 | **Data, not styling.** The P0 client reads `GET /chats` as an array; the HEAD server returns `{ items, … }` (P2-02, D-52). So the P0 build shows "No activity today", "All systems idle" and Today 0, while HEAD lists the 2 seeded chats, "1 running" and Today 2. The residual is icons, plus ±1-LSB anti-aliasing on one card corner (noise class) |
| `/chats` | 75,158 | 75,144 | 652 / 548 | Same P2-02 contract (P0 client renders "No chats yet"); P2-02 also added the "Select" bulk button. Residual is icons |
| `/settings/appearance` | 117,714 | 91,954 | 1,338 / 1,260 | P1-T4: the new **Instrument** card is first in the Product theme grid, shifting GitHub/Graphite/Carbon/Clay by one slot. Residual is icons. (The accent list is below the 900 px fold and was not captured.) |

\* Pixels still differing after masking the data regions (home activity/status pill/tab counts, chats list + Select button, the settings theme grid). Every residual 24-px cell falls on an icon position. Verdict: **legacy pages are pixel-identical apart from documented intentional changes.** There are no colour, spacing or font differences: GitHub keeps its system stacks, as D-51 says.

### 3. Cleared storage → Instrument/ink

`/` and `/chats` at HEAD with empty storage: `<html class="dark platform-linux" data-mode="dark" data-theme="instrument" data-accent="ink" data-density="comfortable" data-font-size="13">`, body background `rgb(11,11,12)` = the Instrument dark ground `#0b0b0c`, Instrument Sans rendered, ink primary buttons, and no console errors. (`data-motion="reduce"` came from the capture's reduced-motion setting.) **Pass.**

### 4. Storybook

`pnpm --filter @generatorai/web test:stories`: **3 files / 6 tests passed** (the Foundations stories in the Instrument dark, Instrument light and Solarized light projects).

### 5. Desktop (Electron, this Mac)

`pnpm --filter @generatorai/desktop build` is green. No staging was needed: unpackaged standalone runs `apps/server/src/index.ts` through tsx on the system Node, and `node -e "new (require('better-sqlite3'))(':memory:')"` from `apps/server` still works.

| Check | Result | Evidence |
|---|---|---|
| `node agent-tests/desktop-chrome-smoke.mjs` | 36/36 | `desktop-chrome/desktop-chrome.png`. Two checks are vacuous; see defect 1 |
| `node desktop-smoke.mjs` (must run from `agent-tests/`; defect 3) | 7/7 | health, templates, workflow from template, builder, new-chat dialog; screenshots checked. The first attempt reused the chrome smoke's temp dir and failed with `SecretStoreError INTEGRITY` (note 1) |
| (a) Help ▸ Keyboard Shortcuts (menu item clicked in main) | **Pass** | `[data-testid="shortcuts-sheet"]` visible with ⌘ bindings from the registry (`a-shortcuts-sheet.png`). It is on the legacy Modal (interim until P3), so no `data-gai-overlay`, as intended |
| (b) View ▸ Appearance ▸ Light / Dark / Light | **Pass** | `html` class light/dark/light, `data-mode` matches, `nativeTheme.themeSource` = light/dark/light, and the menu radio follows |
| (c) Solarized light → quit → relaunch | **Pass** | Persisted `settings.appearance` = `{mode:light, themeId:solarized, groundLight:#eee8d5, …}`, which matches `chromeColors('solarized','light').ground`. At relaunch every window (splash `file://` from the first poll, then the SPA window) had `getBackgroundColor()` = `#EEE8D5`, and the renderer came back on solarized/light. This proves the window background only: the splash page painted into it is still GitHub-dark `resources/splash.html` until P5-11 (P1-R11; 09 §6.7) |
| (d) sonner toast over the native browser view | **Pass** | Native view (`GENERATORAI_DESKTOP_NATIVE_BROWSER=1`, isolated `--user-data-dir`) in the chat's Browser dock tab. A real error toast was raised by forcing the chat PATCH to 500 (global mutation-error toast) and the confirm dialog was closed, leaving 0 dialogs and 1 visible toast overlapping the view. Result: `View.getVisible()` true → **false** → true after the toast left, with "Paused (overlay open)" shown (`d3-real-toast.png`). The dock "+" menu (legacy Radix) also hides it. A hand-made `[data-sonner-toast]` without `data-mounted` has `opacity:0` from sonner's CSS and is correctly ignored |
| desktop:command ids | legacy `toggle-sidebar` is a no-op; `sidebar.toggle` toggles | aside `aria-hidden` false → true → false and the menu checkmark follows |

Per-OS matrix (09 §6.7): only the macOS row was covered here (traffic-light inset and dark/light background at launch, which pass). Windows, Linux and Linux custom-title-bar rows are left to CI's `desktop-smoke` job and the owner.

### 6. Cleanup

The sandbox was stopped with SIGINT (clean shutdown) and `--clean`ed. The previews, the P0 dev server and Electron were stopped, and the worktree and `generatorai-p1smoke-*` temp dirs removed. No dummy repo was used, and no tracked PNG was changed.

### Defects found

1. **`agent-tests/desktop-chrome-smoke.mjs:339`** sends the obsolete `desktop:command` id `'toggle-sidebar'`, which P1-S2 (e52c153) renamed to `sidebar.toggle`, against CLAUDE.md selector rule 2. Its check at `:341-345` ("toggle-sidebar command reaches the renderer") only tests that `[data-testid="sidebar-toggle"]` exists, and that element is present whether the sidebar is open or collapsed. The same applies to "sidebar is open at boot" (`:316-319`). Evidence: the manual check shows the legacy id is a no-op; the smoke's final screenshot shows the sidebar still collapsed while the check passed.
2. **`agent-tests/e2e/subsystems-live.spec.ts:529-548`** fails on the sandbox since 51ae55f: its full-reload navigation counts one stream per document (see §1). This is a spec fix; the app keeps one stream per document.
3. **`agent-tests/desktop-smoke.mjs:11`** resolves `apps/desktop` from `process.cwd()/..`, so `node agent-tests/desktop-smoke.mjs` from the repo root (the command in 09 §6.5) looks for `<parent of repo>/apps/desktop`. It only works from `agent-tests/`.

Notes (environment, not P1 defects):
1. Every Playwright-launched Electron on this Mac fails `safeStorage` decrypt of the unpackaged app's key and renames it to `~/Library/Application Support/@generatorai/desktop/secret-key.bin.unreadable-*`. There are four such files: three predate this run and one more came from this run. Files are renamed, never deleted. So `desktop-chrome-smoke`/`desktop-smoke` (no `--user-data-dir`) touch the developer's dev userData, and two launches cannot share one vault dir.
2. During the chrome smoke's quit, the embedded server aborted with `libc++abi: … Napi::Error` (SIGABRT) while the voice worker pool was being disposed (desktop `main.log`). This is outside P1 scope.
3. `useDesktopIntegration.ts:59` makes every web page fetch `/attention` (60 s refetch) and hold the global stream open just for the desktop badge. This is harmless, and the P3 sidebar needs the feed anyway.

Follow-up (P1-fix round 1, see `reviews/P1-review.md` "Round 1 fixes (P1)"): defects 1–3 are fixed in the scripts, and the Electron smokes now launch with a fresh temp `--user-data-dir` (note 1). Re-run them to replace the results above.
