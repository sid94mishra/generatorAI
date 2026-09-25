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
