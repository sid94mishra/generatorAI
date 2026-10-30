# P1 review: platform, tokens v2, registries (plus the P2 work in the same range)

- **Range:** `62c9a46..HEAD` (HEAD `1c2f39a`, branch `desktop_redesign`). 38 commits, 400 files, +39,933 / −4,116.
- **Date:** 2026-09-26.
- **Reviewer:** independent adversarial review. I edited no code and started no servers, Storybook, Electron or e2e. Two read-only sub-reviews covered the P2 backend work and the desktop P2-03 work; I re-read the code behind every Major they reported before including it.
- **Working tree:** clean apart from this file and `docs/redesign/shots/BASELINE.md`, which was modified during the review by the concurrent verification agent, not by me.

## Commands and results

| Command | Result |
|---|---|
| `pnpm typecheck` | green, but 49/49 tasks were turbo cache hits, so I re-ran it as `pnpm turbo typecheck --force`: 49/49 green, 0 cached |
| `pnpm turbo lint --force` | 26/26 green. 0 errors; web has 311 warnings (legacy design-rule warnings), mobile 2 |
| `pnpm --filter @generatorai/web check:design --strict` | OK. Every rule is unchanged or locked; `storiesPresent` ok |
| `pnpm check:tokens` | OK on all 7 targets: CSS layers, pre-paint, server CSP pin, desktop CSP pin, vocabulary.css, vocabulary.json, mobile module |
| `pnpm --filter @generatorai/design-tokens test` | 10 files, 417 tests passed |
| `pnpm --filter @generatorai/shared test` | 19 files, 391 passed |
| `pnpm --filter @generatorai/client-core test` | 22 files, 315 passed |
| `pnpm --filter @generatorai/web test` | 81 files, 902 passed. Some test prints an `ECONNREFUSED :3000` stack (noise; I did not trace which test) |
| `pnpm --filter @generatorai/desktop test` | 23 files, 296 passed |
| `pnpm --filter @generatorai/server test` | 59 files, 585 passed |
| `pnpm --filter @generatorai/db test` | 20 files passed, 1 skipped; 137 tests passed, 4 skipped |
| `pnpm exec vitest run --project node scripts/__tests__` | 2 files, 44 passed |
| `pnpm --filter @generatorai/web build` | OK |
| `check:bundle` | OK. Initial load 339.4 KB gzip (budget 800 KB); largest lazy chunk 225.7 KB (budget 300 KB); fonts 94.6 KB in 4 files (budget 104 KB) |
| `check:css` | OK. 138 `@theme inline` variables, 53 required utilities, 18 themes × 2 modes define `--gai-*` |

Extra checks I ran:

- **Pre-paint hash.** The inline script in the built `apps/web/dist/index.html` is byte-identical to the source. Its SHA-256 (`sha256-BpWGgYaXfGaPam8MrElJlLsdVbodL0/llrbnaf1H/Po=`) equals both pins (`apps/server/src/middleware/csp.ts:58`, `apps/desktop/src/main/session-hardening.ts:36`). `tokens:check` compares with line endings normalised, so it survives CRLF checkouts.
- **Ratchet.** `git log -p` on `apps/web/design-system-baseline.json` shows exactly one increase, `legacyTokenUtility` 2568 → 2622 (+54, P1-T1, the sanctioned one). Everything else went down: `whiteBlackClass` −2, `defaultRadius` −1, `arbitraryValue` −1.
- **lucide.** No deprecated lucide 1.48 alias is imported anywhere in `apps/web/src` (281 distinct names checked against the `@deprecated` tags in `lucide-react.d.ts`).
- **Token probe (scratch script).** Across all 252 combinations, `focus` on `sunken` has a minimum contrast of 3.21:1 (tokyo-night/light/rose). The minimum for `*-text` on `sunken` is 5.14:1. These pass today but are not asserted (P1-R6).

Not run here (owned by the concurrent phase-end agent): `test:stories`, e2e, pixel diffs, Electron smokes.

---

## P1 findings

### Critical
None.

### Major

**P1-R1. On web (Windows/Linux), the command host takes Ctrl+K, Ctrl+B and Ctrl+Alt+B away from the integrated terminal and every text field.**
- `apps/web/src/hooks/useCommandHost.ts:128-136` installs a **capture-phase** `keydown` on `window`. Any binding with a modifier (`chordBindings`) runs, and calls `preventDefault()`, before the target sees the key. The editable-target check at `:137` only applies to bare keys.
- The web bindings are `palette.toggle` `Mod+K`, `sidebar.toggle` `Mod+B` and `dock.toggle` `Mod+Alt+B` (`packages/shared/src/ui-contract/commands.ts:57,73,74`). On Windows and Linux, `Mod` means Ctrl.
- The xterm terminal only intercepts Ctrl/Cmd+F (`apps/web/src/components/terminal/TerminalPanel.tsx:268-275`). So in a browser tab on Windows or Linux:
  - readline's Ctrl+K (kill to end of line) opens the palette and moves focus;
  - Ctrl+B (back one character, and the default tmux prefix) toggles the sidebar;
  - Ctrl+Alt+B toggles the dock.
- **Regression:** the old `AppLayout` handler returned early in editable targets (the removed `isEditableTarget` in `e52c153`). 06 §5.2 only asked for `Mod+K` to "fire while typing". D-46 widened that to "Mod chords fire everywhere, including inputs" without considering the terminal or text editors.
- The bug is invisible on macOS web, where `Mod` is Cmd. This is exactly the kind of defect that hides on one OS. (On desktop Windows/Linux the Electron menu accelerators already claimed these chords before P1. That is a separate, older issue worth listing in 11-design-feedback.)
- **Fix:** give each command a `firesInEditable` flag and set it only on `palette.toggle`. Never handle chords whose target is inside `.xterm` or inside an element carrying an opt-out attribute (e.g. `data-gai-keys="own"`, set on the terminal and on code editors). Add tests to `__tests__/hooks/useCommandHost.test.ts` for an xterm helper textarea and for Ctrl+B in a textarea with `mac: false`. Amend D-46 and 06 §5.2.

### Minor

**P1-R2. The Settings menu item no longer brings the window to the front.**
- Before: `nav('/settings')`, and `navigateTo` calls `win.show()` / `win.focus()` (`apps/desktop/src/main/window-manager.ts:371-385`).
- Now: `wm.sendCommand('app.settings')` (`menu.ts:119`, `menu.ts:201`), and `sendCommand` (`window-manager.ts:387-389`) only posts IPC.
- With "minimize to tray" on, or with a minimised window, GeneratorAI ▸ Settings… (Cmd+,) opens Settings in a window the user cannot see. D-46 kept `navigateTo` for the section items for exactly this reason, but did not apply it to Settings.
- **Fix:** show and focus the window inside `sendCommand` for renderer commands that come from the menu or tray (or add `sendCommandAndShow`). Test it in `menu-commands.test.ts`.

**P1-R3. The WCAG suite has weak spots.**
- `design.test.ts:186-192` ("12b"): the test computes `backdrop` (scrim over surface) and only uses it inside a failure message. What it actually asserts is that `overlay` is opaque and that `fg` clears `overlay`, which row 1 already covers. Either assert something about the scrim or delete the test.
- `chrome.test.ts:63`: `it.skipIf(!isKnownTheme('instrument'))` was a guard for before T4. It is dead now, and it would silently skip row 15 if the theme were ever renamed. Remove the guard.
- Every row of 02 §12 is otherwise asserted: rows 1–14 in `design.test.ts`, row 15 in `chrome.test.ts:63`, row 16 in `emit.test.ts:240`. Rows 9 and 10 run all 252 combinations, and the "changes only accent/on-accent/focus" test justifies running the other rows on 36.

**P1-R4. The terminal does not use the bundled mono font (D-16).**
- `TerminalPanel.tsx:238-240` sets `fontFamily: 'JetBrainsMono, "Fira Code", Menlo, Consolas, …'`, but the bundled family is registered as `"JetBrains Mono Variable"` (`packages/design-tokens/src/themes/fonts.ts:55,68`).
- Result: offline Linux (and any machine without these fonts) renders the terminal in generic `monospace` while the diff and code views use JetBrains Mono. xterm also measures cells before the web font loads.
- **Fix:** put `"JetBrains Mono Variable"` first and call `await document.fonts.load('12px "JetBrains Mono Variable"')` before `term.open`/`fit`. This can wait until the terminal block ports, but record it.

**P1-R5. `setAccent` stores the fallback when it gets an invalid id** (`apps/web/src/providers/ThemeProvider.tsx:168-175`).
- `resolveAccentId(theme, next)` turns an unknown id into the theme's default, and that default is then written as an explicit choice.
- After that, switching theme no longer moves the accent to the new theme's default (the "unchosen accent follows theme" behaviour the test at `:71` pins).
- **Fix:** ignore invalid ids, or `write(ACCENT_STORAGE_KEY, null)`.

**P1-R6. Focus and status text are not asserted on `sunken`.**
- Inputs sit on `sunken` and take `border-focus` when focused (02 §2.3 "Focus-ring recipe"), yet `focus` is clamped and tested only against ground/surface/raised/overlay (`design.ts:216`, `design.test.ts:167-169`).
- It passes today (3.21:1 minimum), but nothing guards it.
- **Fix:** add `sunken` to the backs of `focus` and to rows 7 and 10, and update 02 §2.2 step 12 and §12.

**P1-R7. Exit criterion "VRT job green" fails by design** (D-53, `.github/workflows/ci.yml` job `vrt`).
- No baselines are committed, and the job fails whenever it writes one. Until the owner downloads the `vrt-stories` artifact and commits the PNGs, 07 §P1's exit is not met.
- **Fix:** do that before P1 is declared done, and record the commit in README progress.

**P1-R8. Plans and docs no longer match what was built.**
- 06 still describes a single JSON storage key `generatorai:appearance` / `APPEARANCE_STORAGE_KEY` (`06-desktop-and-shell.md:147`, `:698`). D-51 chose six keys; update 06.
- 02 §11.3 (`02-design-system-spec.md:727,730`) still lists a context `designTokens` (not built) and a 100 ms push debounce. The code uses 50 ms, which matches 06:669. Either build `designTokens` or strike it, and align the number.
- 09 §9.1 (`09-verification.md:895`) still describes `STORYBOOK_A11Y_GLOBALS`, which D-53 replaced with one project per combo. 09 §5 (`:640`) still names `OVERLAY_SELECTORS`, which is now `OCCLUSION_SELECTOR`.
- `01-decisions.md`: D-40 comes after D-54 (line 308). D-46…D-54 sit under the heading "F. Mobile readiness", which they are not. Give them their own section ("G. As-built details") and move D-40 back.
- `.claude/CLAUDE.md:65` still says Storybook/VRT and the sandbox have "not landed yet".
- `docs/redesign/README.md:25` still says render-boards uses "Google Fonts before that". T7 has landed.
- The docs site still cites `apps/web/src/router.tsx` (`apps/Documentation Site/docs/clients/desktop.md:42`, `docs/clients/overview.md:53`) and calls the first nav entry "Dashboard".

**P1-R9. The route handle field `nav` is typed but never set.** D-46 types `GaiRouteHandle.nav` (`apps/web/src/app/routes/defineRoute.tsx:25-26`), but no route module sets it and nothing reads it. Set `nav` on each area module now, which is cheap and gives P3's sidebar active state a source, or drop the field until P3.

**P1-R10. `apps/web/src/ui/foundations/` is not in the D-04 layout** (`primitives/patterns/shell/templates/icons/lib`). It holds a 258-line `Foundations.tsx` used only by its story. Move it under `ui/patterns` or `.storybook/`, or add `foundations/` to D-04 and to the boundaries element list, so the next LLM session doesn't treat it as a place to put components.

**P1-R11. The desktop first frame is only correct until the splash loads.** `resources/splash.html:12,30` hard-codes `#0d1117` (and `error.html`/`prompt.html` do the same). A light-theme user therefore gets the persisted light window background, then a GitHub-dark splash, then the app. That is the flash D-25 exists to remove. 02 §8 explicitly defers this to P5-11, which is fine, but the P1-T8 acceptance ("first frame is `#eee8d5`") is only true of the empty window. Say so in 09 and in the smoke notes, or pull the query-param fix (02 §8 row) forward. It is about 10 lines.

### Checked and sound
- **Pre-paint:** it matches `readStoredAppearance` over a matrix that includes throwing storage, junk values and every theme with no stored accent (`prepaint.test.ts`). The script is ES5 and one line, runs before any stylesheet, and both pins match.
- **Single writer:** `applyAppearance` is the only DOM writer in `apps/web/src` (plus the pre-paint and Storybook). No leftovers of `getTheme`/`setTheme`/`themeChanged`, and `settings.theme` is gone.
- **Cross-session rename coverage:** `SHELL_WIDTHS`, `OVERLAY_SELECTORS`, `hasOverlayOverlap`, `react-router-dom` (code), `sectionAccelerator` and Google Fonts are all gone.
- **tailwind-merge v3:** its config is built at runtime from `twMergeExtension()`. `cn.test.ts` checks every 09 §2.5 and 02 §10.3 pair, and also runs generated sweeps (namespace last-wins, size vs colour, every `REQUIRED_UTILITY` grouped).
- **Status map:** exhaustive through `satisfies Record<Union, …>` for every server and client union, `chatTurn` included.
- **Occlusion:** it is a pure function with the ancestor exemption and the own-child exemption, and toasts now count (`[data-sonner-toast]`; the old `.sonner-toast` never matched and `[data-sonner-toaster]` is zero-height).
- **Router split:** paths, titles and error boundaries match the old `router.tsx` one for one, and the `'*'` data route is kept for `useBlocker`.
- **Coordination:** COORDINATION.md has entries for P1-U1…U5, T1 and S3. Those are the only range commits that touch workflow-owned files (verified by path scan).
- **Mobile readiness:** M-01 (native additive `--gai-*`, `gaiColors`), M-02 (`css/vocabulary.css`), M-03, M-04 (`geometry.ts` with typed empty `ios`/`android`), M-05 (`icons.ts`), M-06/M-13 (`shared/status`), M-07/M-08 (`shared/ui-contract`, dependency-free subpath), M-09 (`client-core/src/attention`) and M-14 (the OFL header in `fonts.ts`) all live in React-free packages.

---

## P2 work in range (P2-00 … P2-03)

Line numbers are at HEAD. The code behind every Major was re-read by me, except P2-R12, where the confidence is stated.

### Critical
None.

### Major

**P2-R1. Web bulk delete fails once more than 200 chats are selected.**
- The server caps `ids` at `CHAT_BULK_MAX_IDS = 200` (`apps/server/src/routes/chats.ts:325`, `packages/shared/src/types/ChatList.ts:134`).
- `ChatsListPage.tsx:162` sends `Array.from(selectedIds)`, and "Select all" takes every loaded row, 50 per page. After five pages, delete returns 400 and nothing is removed.
- The old per-id path had no cap.
- **Fix:** chunk inside client-core (`archiveMany`/`removeMany`, so mobile inherits it) and merge the `{ succeeded, failed }` results.

**P2-R2. Live chat lists go stale on rename, unarchive, tag, project and description changes.**
- `PATCH /chats/:id` (`chats.ts:588-700`) emits only `chat.agent_changed`, and `CHAT_LIST_EVENT_KINDS` (`packages/client-core/src/chats/listModel.ts:89`) does not include even that.
- `chat.updated` is emitted only from summary bookkeeping (`ChatManagementService.ts:4150`, `ChatChangeStatsService.ts:187`).
- c384a50 removed the old 30 s `refetchInterval`, so other tabs and devices never see these edits. Attention titles have the same gap.
- D-52's "`chat.updated` SSE feeds live lists" is only half true.
- **Fix:** emit `chat.updated` from PATCH for any field a list shows (unarchive included), and add it to the attention service's chat triggers.

**P2-R3. With a window open, the user is never told an update is ready.**
- `apps/desktop/src/main/updater.ts:112-114` returns before the native dialog whenever the main window is visible. Its own comment says the dialog stays "until [the pill] does [exist]".
- Nothing in `apps/web/src` calls `useUpdateState`/`restartToUpdate` (grep: zero consumers). The pill is P3-06.
- **Fix:** suppress the dialog only when a renderer has subscribed to `updateStateChanged` (main keeps a flag). Keep the dialog until P3-06 lands.

**P2-R4. `installUpdate` stops the app before it knows the install will go ahead** (`updater.ts:192-199`).
- `runQuitShutdown` stops the embedded server, destroys the tray and sets `quitting`, and only then calls `quitAndInstall()`.
- electron-updater can still decline or fail at that point:
  - `install()` returns false (e.g. a cancelled pkexec prompt for deb/rpm);
  - AppImage throws when `APPIMAGE` is unset;
  - on macOS, `quitAndInstall` waits for Squirrel's own download, which never finishes if the signature is rejected.
- In any of those cases the window stays up on a dead backend with no tray.
- **Fix:** after calling it, wait for `error` or a deadline (~60 s). On either, log, then relaunch (`app.relaunch(); app.exit(0)`) or restart the server and tray. On macOS, report `ready` only after Electron's `autoUpdater` emits `update-downloaded`.

**P2-R5. D-54's account of the R5 cause is probably wrong.**
- D-54 (`01-decisions.md:305`), 05 §G-04 and `quit-coordinator.ts:10-18` all say `app.exit(0)` skips the `quit` event, so `autoInstallOnAppQuit` never ran.
- Electron documents only `before-quit` and `will-quit` as skipped. `app.exit` goes through `Browser::Shutdown` → `OnQuit`, which emits `quit` with the exit code (0 here). electron-updater hooks `app.once('quit')`.
- Medium-high confidence. It needs the 06 §8 `mock-update-server` run to settle, and R-10 in 07 stays open until that run happens.
- The normal quit path still ends in `app.exit(0)` (`apps/desktop/src/main/index.ts:116`). So if the premise were true, "quit with an update downloaded" would still be broken. Either way, the stated fix doesn't match the stated cause.
- **Fix:** run the mock-server check on each OS, then correct D-54, G-04 and the comments. If `quit` really is skipped, `before-quit` should call `quitAndInstall(true, false)` when an update has been downloaded.

**P2-R6. Server reachability probes are blocked by CSP.**
- Probes run in the renderer (`apps/web/src/hooks/serverQueries.ts:69-76`, `probeServer` for every entry, every 30 s).
- Both CSPs are `connect-src 'self'` (`apps/server/src/middleware/csp.ts`, `session-hardening.ts:40`), and CORS would block them too. Every server other than the current origin will show "offline" and log a CSP violation.
- Latent for now: `useServers` has no consumer until P3.
- 06 §8 had main return reachability from `getServers`, and the commit message says main uses `probeServer`, but it doesn't.
- **Fix:** probe in main with Node `fetch` and return `status` in `DesktopServerEntry`. On plain web, probe only the same-origin entry and mark the rest `unknown`.

**P2-R7. The update state machine has gaps** (`updater.ts:94-104`).
- A later `checking-for-update` or `error` overwrites `ready` (e.g. Help ▸ Check for Updates while offline), after which `installUpdate` refuses to run.
- `setState` merges, so a stale `error` stays in `idle`/`ready`.
- An unconfigured or offline packaged build sits in `error`.
- `update-cancelled` isn't handled.
- **Fix:** keep `downloadedVersion` separately and derive `ready` from it. Clear `error` on each transition. A check failure before any download should mean `idle` plus `lastError`. Handle `update-cancelled`.

**P2-R8. The badge and tray keep stale counts** (breaks D-36).
- Nothing clears the attention counts on window `closed` (`window-manager.ts:217-219`), on `repointMainWindow` (`backend-switcher.ts:112-115`) or on `render-process-gone`, and the renderer never sends `attention: null`.
- So the macOS/Linux badge shows the previous server's number after a switch, and still shows it after the window is gone.
- **Fix:** on those three events, call `updateMenuState({ attention: null })`, `applyAttentionBadge(0)` and `refreshTrayMenu()`.

**P2-R9. The "Changes ±" backfill has no concurrency limit.**
- `ChatChangeStatsService.ensure()` (`packages/core/src/services/ChatChangeStatsService.ts:115-121,152-180`) schedules one git summary per workspace, and they all fire together after the same 1.5 s debounce.
- Callers make this large: the TUI lists 200 rows, and `cli-core` ref resolution pages through every chat. On a legacy DB that means hundreds of concurrent git processes, which is worst on Windows.
- `composition-root.ts:1893` calls `invalidateWorkingTree()` with no argument, which clears every workspace's memo on each recompute.
- **Fix:** a global queue (2–4 at a time), per-repo invalidation, and make CLI ref resolution use `q=`/`limit`.

**P2-R10. The sandbox cannot start on Windows.**
- `scripts/redesign/sandbox.mjs:56-59` resolves `node_modules/.bin/<name>.cmd`, then `execFileSync(bin('tsx'))` (`:195`), `spawn(bin('vite'))` (`:214`) and `execFileSync('pnpm.cmd')` (`:97`), all without `shell`.
- Node ≥ 18.20.2 / 20.12.2 / 22 throws `EINVAL` when spawning a `.cmd` without a shell (the CVE-2024-27980 hardening), and the repo requires Node 22.
- **Fix:** run the JS entry points with `process.execPath` (`vite/bin/vite.js`, `tsx/dist/cli.mjs`) and find pnpm through `npm_execpath`. This also lets the sandbox kill Vite directly instead of a `cmd.exe` wrapper.

**P2-R11. The VRT/sandbox seed never runs on Windows, or on any path with spaces, and still reports success.**
- `agent-tests/vrt/seed.ts:216` guards with ``import.meta.url === `file://${process.argv[1]}` ``. On Windows (`file:///C:/…` vs `C:\…`) or with `%20` in the path, that comparison is false.
- `main()` is skipped, tsx exits 0, and the sandbox continues on an empty DB.
- **Fix:** `pathToFileURL(process.argv[1]).href`, with a `realpath` comparison like the one in `vrt.mjs:128`.

**P2-R12. The attention feed can stall behind refetches or drop a delta** (medium confidence; from the sub-review, not reproduced).
- `apps/web/src/hooks/attentionQueries.ts:68-70,101-103`: every gap calls `invalidateQueries`, and TanStack v5's default `cancelRefetch: true` cancels the fetch already in flight. A burst of deltas faster than one round trip means the snapshot never lands.
- A delta applied while a fetch is in flight is overwritten when the older snapshot resolves.
- `client-core/src/attention/reducer.ts:127-139` has the same "older snapshot replaces newer" issue.
- **Fix:** `cancelRefetch: false`, and buffer deltas during a fetch, replaying those with `seq > snapshot.seq`. Better, have web use `createAttentionStore` (one implementation, as 08 asks).

### Minor

- **P2-R13. Invented zeros before load (D-36), in lines rewritten by c384a50.** `apps/mobile/app/(tabs)/chats.tsx:253-254` (`counts.active ?? 0`, `counts.archived ?? 0` → "Active 0 / Archived 0" while loading), `apps/web/src/pages/DashboardPage.tsx:50` (`?? 0`). Render the counts only once data exists.
- **P2-R14. "Select all" is misleading** (`ChatsListPage.tsx:216-226`). It selects the loaded rows but shows "N of {total} selected". With `keepPreviousData`, rows from the previous filter can also be selected right after a filter change.
- **P2-R15. Attention question text is not redacted.** `AttentionService.ts:218-226` sends `ask.summary` (the agent's first question, verbatim, which may contain paths or commands) to principals that have only `read:activity`. Clip it the way `ask.detail` is clipped, or record the exception in D-49.
- **P2-R16. Attention sends more events and does more work than it needs to.**
  - Every tool-step label change persists `attention.upsert` plus an unchanged `attention.counts` (`AttentionService.ts:476-490,566-569`). Each one wakes the badge and rebuilds the whole application menu (`ipc.ts:278-285`), which on macOS can close a menu the user has open. Emit counts only when they change, and skip `buildMenu` for patches that only carry attention.
  - The rebuild loads every automation's full execution history, one query per automation (`:414-421`).
- **P2-R17. A failed attention start is served as "nothing needs you"** (`composition-root.ts` ~2723). The empty snapshot is served as if it were real (D-36). Return 503 or `{ available: false }`.
- **P2-R18. `useAttentionCounts()` now runs in plain browser tabs** (`useDesktopIntegration.ts:59`): a `GET /attention`, a global stream and a 60 s poll, only to feed the desktop badge. Principals without `read:activity` get repeated errors. Gate it on `isDesktop` until P3 adds consumers.
- **P2-R19. Consent prompts with no `chatId` never appear in the feed** (`AttentionService.ts:400-403,608`).
- **P2-R20. Performance.**
  - The `last_activity_at` index is never used: the sort is `COALESCE(last_activity_at, created_at*1000)` (`ChatRepository.ts:407`), but after the backfill every row is non-null. Order by the column directly.
  - Migration v55 carries `metadata` through the window function for every assistant message (`migrations/index.ts:2523`). Select `rowid` in the window and join the winners.
  - The value type inside a cursor isn't checked against the sort.
  - A 200-id bulk archive causes 200 cancel-and-refetch cycles on every client (`chatListQueries.ts:65-67`). Throttle, and use `cancelRefetch: false`.
- **P2-R21. The faux harness can touch the real checkout.**
  - `file_edit` falls back to `process.cwd()` (`FauxProvider.ts:574`), which in the sandbox is `apps/server` inside this checkout, and it doesn't contain `../` or absolute paths. That breaks the dummy-repo rule.
  - `permission_request` ignores the answer (`:640`).
  - `split('\n')` over-counts additions.
- **P2-R22. Sandbox and seed robustness.**
  - The SIGKILL fallback never fires, because `child.killed` is true once SIGTERM is *sent* (`sandbox.mjs:255`).
  - `serverLog` grows without bound.
  - `findChatIdByName` only scans the newest 200 chats (`agent-tests/helpers/api.ts:268-272`), so re-seeding a large DB is no longer idempotent. Use `?q=`.
- **P2-R23. Desktop smaller issues.**
  - Two quit paths can run at once, because `quitHandled` is set only after `await confirmDiscard()` (`quit-coordinator.ts:94-96`). Share one in-flight promise.
  - `serversChanged` from IPC doesn't rebuild the Server menu (`ipc.ts:344-347`).
  - View ▸ Appearance with no window leaves the radio out of sync.
  - The remote-mode tray mixes the embedded server's port with the remote server's counts (`tray.ts:81`).
  - `probeServer` maps 429/5xx to `unpaired` and doesn't compare `serverId` (`packages/client-runtime/src/connections.ts:277-283`).
  - `desktopServers.list()` and `getState` swallow errors as `[]` or `null` (`apps/web/src/lib/desktop.ts:123-127,154-158`).
- **P2-R24. Bridge types are declared twice.** `apps/web/src/types/desktop-bridge.d.ts:142-199` re-declares `UpdateState`, `DesktopServerEntry`, `AttentionCounts` and the appearance payload by hand. Move the IPC payload types to `packages/shared` and import them on both sides.
- **P2-R25. Tests and docs.**
  - `updater.test.ts:13-22` mocks both `runQuitShutdown` and `quitAndInstall`, so it only checks the order of calls. There are no tests for install failure, `error` after `ready`, or the tray's new labels.
  - 06 §8 still says Windows gets no badge, that `getServers` returns reachability, and that the update dialog is deleted.
  - D-54 says "tray and menu show counts", but the menu doesn't read them.
  - `apps/Documentation Site/audit/source-inventory.json:3103` still lists `GENERATORAI_LOAD_TEST_FAUX_HARNESS`.
- **P2-R26. The CLI `chat list` silently truncates at 50** (`packages/cli-core/src/commands/chat.ts:211`). Print "showing 50 of N" and add `--cursor`/`--all`.

### Checked and sound (P2)
- **Paging:** keyset paging is correct, with the id tie-break following the sort in both directions. The cursor is bound to its sort (400 on a mismatch). Tests cover pages of 1, 2, 3 and 50 over equal timestamps.
- **Filters:** repeated params mean "any of", the LIKE escaping is right, and `state` uses the same live-set rule as `chatRowState`.
- **Bulk routes:** they validate, de-duplicate, report per-id results, and require `write:chats`.
- **Attention sequencing:** the `seq`/emit chain is consistent with `getSnapshot`, `counts` doesn't advance `seq`, and redaction is applied on the route, the stream, the mux (including the pre-hello buffer) and `/stream/replay`.
- **Faux harness:** it is behind the flag, stays out of `ALL_HARNESS_TYPES`, and the `Exclude<HarnessType,'faux'>` narrowing is complete. The env var rename is done in code and CI.
- **Consumers:** every consumer moved to `.items` (web, mobile, CLI, TUI, agent-tests), and no testid was removed.
- **Desktop plumbing:** `sanitizeAttention` clamps to [0, 999], all new IPC goes through `guardedHandle`, and `badge.ts` degrades on each OS (macOS dock, Linux `setBadgeCount` no-op, a Windows overlay that is cleared with `null`).

---

## Exit criteria (07 §P1)

| Criterion | Status |
|---|---|
| All T/U/S tasks merged | **Met.** U1–U5, S1, S2, S3, S5, SB and T1–T11 are all in range, each its own commit. |
| 252-combination WCAG suite green | **Met.** Every row of 02 §12 is asserted and green (417/417). Gaps that should be closed: P1-R3, P1-R6. |
| Legacy pages pixel-identical with GitHub/blue pinned | **Pending:** the concurrent phase-end verification agent (pixel diff on the sandbox, :3197/:5197). |
| Cleared storage renders Instrument/ink | **Met at unit level:** `prepaint.test.ts` "D-25 defaults" and `ThemeProvider.test.tsx:50`. In-browser confirmation is **pending** (verification agent). |
| Storybook + VRT jobs green | **Not met.** The `vrt` job fails by construction until baselines are committed (owner action, D-53; P1-R7). The `storybook` job has not been seen green in CI; the local `test:stories` run is pending with the verification agent. |
| Registries typed and consumed by desktop menu/tray | **Met.** `menu.ts` takes every accelerator from `accel(id)` and the sections from `NAV_DESTINATIONS`; `tray.ts` uses `NAV_DESTINATIONS.filter(tray)`; `menu-commands.test.ts` passes. P1-R2 is a regression in the same area. |
| Per-task desktop acceptances (S2 "Help ▸ Keyboard Shortcuts opens the sheet on all hosts", S5 "a toast hides the native view", T8 "Solarized light relaunch first frame", U5 "no missing-icon warnings on every route") | **Pending:** Electron and browser smokes by the verification agent (macOS). Windows and Linux are pending with the owner/CI. See P1-R11 on what the T8 first-frame check really proves. |

---

## Round 1 fixes (P1)

Branch `desktop_redesign`, commit `redesign(P1-fix): address P1 review round 1`. P2 findings are handled separately.

| Finding | Status | What was done |
|---|---|---|
| **P1-R1** (Major) web Ctrl chords in fields and the terminal | **Fixed** | The rule is now the same on every OS, with no platform check. (1) Inside a surface that owns every key, the host handles nothing, chords included. Such a surface is the `.xterm` root or anything under `data-gai-keys="own"`; the terminal container carries the attribute, and future code editors must too (`KEY_OWNER_SELECTOR`, `isKeyOwnerTarget` in `useCommandHost.ts`). (2) In a text field, contenteditable, combobox or menu, a chord fires only if its registry entry has the new `CommandDef.firesInEditable` flag, and only `palette.toggle` (`Mod+K`) has it (06 §5.2 "fires while typing"). `Mod+B`, `Mod+Alt+B` and every other chord are left to the field and are not `preventDefault`ed. (3) Bare keys and sequences behave as before. This keeps the old AppLayout behaviour for everything except the deliberate `Mod+K` exception. Tests: `useCommandHost.test.ts` covers Ctrl+B and Ctrl+Alt+B in a textarea and an input with `mac: false`; Ctrl+K/Ctrl+B/`G C` on an xterm helper textarea; an opt-out container; contenteditable Mod+K; and the same rule with `mac: true` (Cmd+K fires in a textarea, Cmd+B does not). `commands.test.ts` pins that only `palette.toggle` is flagged and that the flag is only allowed on renderer Mod chords. D-46 and 06 §5.2 are amended. The desktop Windows/Linux menu-accelerator variant (older than P1) is recorded as DF-23 and scheduled with the terminal/dock port (P4). |
| **P1-R2** Settings in a hidden window | **Fixed** | `WindowManager.sendCommand` now restores, shows and focuses the window after posting the command. Every caller is a menu, accelerator, tray or dock action. A shared `reveal()` also makes `navigateTo` restore a minimised window. Tests are in `window-manager.test.ts` (window hidden to the tray, minimised window, no window). The reviewer suggested `menu-commands.test.ts`, but that file mocks the window manager, so the behaviour is tested where it lives; `menu-commands.test.ts` already pins Settings → `app.settings`. D-46 is amended. |
| **P1-R3** WCAG suite weak spots | **Fixed** | Test 12b now asserts the scrim: `overlay` is opaque, and `scrim` is translucent and darkens `surface`. It is added to the 02 §12 table as row 12b. The `skipIf` on row 15 is removed, and the test asserts `isKnownTheme('instrument')`, so a rename fails instead of skipping. |
| **P1-R4** terminal font | **Fixed** | The xterm `fontFamily` now starts with `"JetBrains Mono Variable"`, taken from `BUNDLED_FONT_FAMILIES`. `term.open`, the WebGL addon and the first fit wait for `document.fonts.load('12px "JetBrains Mono Variable"')`, so cells are measured on the bundled face. If the load fails, or the Font Loading API is missing, the terminal opens anyway. Writes made before open are buffered by xterm. |
| **P1-R5** `setAccent` stores the fallback | **Fixed** | Unknown ids are ignored (`isAccentId`). A ThemeProvider test checks that after an invalid `setAccent`, storage is still empty and the accent still follows a theme switch. D-51 is amended. |
| **P1-R6** focus and status text on `sunken` | **Fixed** | `design.ts` clamps `focus` and every `<state>Text` against `sunken` too. Rows 7, 10 and 13 assert `sunken`. 02 §2.2 steps 9 and 12 and §12 rows 7 and 10 are updated, and D-47 is amended. `pnpm check:tokens` is unchanged: no emitted value moved. |
| **P1-R7** VRT exit criterion | **Deferred (owner action)** | This needs the CI `vrt-stories` artifact, and this Mac has no Docker (D-53). The README progress row now records that the P1 exit is blocked on committing those baselines. |
| **P1-R8** plans and docs drift | **Fixed** | 06: the storage-key rows and §6.3 now describe six keys, and the hand-written pre-paint sketch is replaced by a pointer to the generated script. 02 §11.3: `designTokens` is struck (not built) and the debounce is 50 ms. 09 §9.1 describes per-combo projects and 09 §5 says `OCCLUSION_SELECTOR`. `01-decisions.md`: D-40 is back under "F. Mobile readiness", and D-46…D-54 sit under a new "G. As-built details". `.claude/CLAUDE.md` no longer says Storybook, VRT and the sandbox are missing. README render-boards fonts are updated. The docs site now cites `apps/web/src/app/router.tsx` + `app/routes/` and names Home. |
| **P1-R9** `handle.nav` unused | **Fixed** | `nav` is set on every area route: home, chats, projects, agents, workflows, automations and scripts. Settings and the 404 have none. The new `__tests__/app/routeHandles.test.ts` checks that each route's `nav` equals `navDestinationFor(path)` and that every destination owns a route. |
| **P1-R10** `ui/foundations` outside D-04 | **Fixed (declared)** | `foundations` is now its own boundaries element, listed before `ui`. It may import `ui`, and nothing may import it (a probe import from `ui/lib` fails lint). It is added to the D-04 layout and the CLAUDE.md layer list. The files stay put, so the Storybook title and the test:stories projects are unchanged. |
| **P1-R11** splash first frame | **Documented** | 09 §6.7 has a new "All OS" row, and the BASELINE (c) row now says that "first frame = persisted ground" covers the window background only, while the splash page stays GitHub-dark until P5-11. The fix was not pulled forward: `splash.html` has a `default-src 'none'` CSP (no script), so a query-param recolour means restyling the static pages, which is P5-11's job. |

Verification defects from `shots/BASELINE.md` "End-of-P1 verification":

| Defect | Status | What was done |
|---|---|---|
| 1. `desktop-chrome-smoke.mjs` sends `toggle-sidebar` and checks mere existence | **Fixed** | The smoke imports `COMMANDS` from the dependency-free registry source (Node ≥ 22.18 strips its types) and sends `sidebar.toggle` over IPC. "Sidebar is open at boot", the new "toggle collapses the sidebar" and "command reopens the sidebar" checks now read the `<aside>`'s `aria-hidden` and its rendered width (collapsed = ≤ 1 px, its border). A new check confirms that the menu checkmark follows the command. |
| 2. `subsystems-live.spec.ts` "one event stream" | **Fixed** | The spec loads `/` once, marks the document, then goes to Workflows, Chats and Projects through sidebar links. It asserts that the document survived (no reload), that at least one stream opened (no vacuous pass), and that at most two opened. |
| 3. `desktop-smoke.mjs` resolves `apps/desktop` from the cwd | **Fixed** | A new `agent-tests/helpers/desktop-profile.mjs` resolves `DESKTOP_DIR` from its own path. `desktop-smoke`, `desktop-security-smoke` (which had the repo-root variant of the same bug) and `desktop-pairing-diagnostic` use it. `desktop-smoke`'s default `OUT` is now `agent-tests/test-results/desktop-smoke/`, not the cwd. |
| Note 1: smokes touch the developer's userData and vault key | **Fixed** | `isolatedProfile()` passes a fresh temp `--user-data-dir` and removes it on exit. Electron 42 takes `app.getPath('userData')` from that switch on every OS (checked with a probe app). Main needed no new env var, and the switch is what the browser/diff/no-cdp smokes already used. It is applied to desktop-chrome-smoke, desktop-smoke, desktop-security-smoke, desktop-pairing-diagnostic and packaged-app-smoke. Not applied to the legacy CDP-spawn dev smokes (right-pane, terminal, p2-browser), which attach to the :5173 dev server and its paired profile. 09 §6.5 documents the rule. |

Checks run for this round: `pnpm typecheck`; `pnpm turbo lint --force` (web, desktop, shared); `check:design --strict`; web, shared, desktop and design-tokens tests; `check:tokens`; desktop build; `node --check` on every edited `.mjs`; `scripts/__tests__`. Real browser check of P1-R1: `vite preview` :5371 proxying to an isolated server bundle on :3371 (temp DB, Faux harness), in headed Chrome with `navigator.platform` set to `Linux x86_64` so `Mod` = Ctrl. With focus in the Chats search input (value `abc`), Ctrl+B and Ctrl+Alt+B changed nothing: the sidebar stayed open at 240 px, the value was intact and focus stayed put. Ctrl+K opened the palette. With focus on the body, Ctrl+B collapsed the sidebar (`aria-hidden` true; 1 px, which is its border) and a second press restored it. The terminal case is covered by unit tests only. The e2e suite and the Electron smokes were not run; the lead runs them at the end of the fix round.

## Round 1 fixes (P2)

Every P2-R finding was fixed; none was found wrong, though P2-R5's premise was (the reviewer was right) and the code that rested on it was reworked. Unit tests pin each fix; the API-level ones were also driven against a real isolated server (bundled server on :3381, bare `DB_PATH`/`ARTIFACTS_DIR`/`WORKSPACES_DIR`/`EXTENSIONS_DIR` in a `generatorai-p2fix-*` temp dir, `dbPath` asserted from the startup log, Faux harness), results under "Real API check" below.

### Major

- **P2-R1 (bulk > 200).** Contract decided: **the client batches**; the server cap stays 200 (a raw 201-id request is still 400). `runChatBulk(ids, send)` in `packages/shared/src/types/ChatList.ts` de-duplicates, sends sequential requests of ≤ `CHAT_BULK_MAX_IDS` and merges `{ succeeded, failed }`; an outright request failure is thrown only when nothing succeeded yet, otherwise the remaining ids are reported failed so removed chats are never hidden. Used by web `HttpPlatformClient.archiveChats/deleteChats` and client-core `chats.archiveMany/removeMany` (mobile, CLI inherit it). Tests: `packages/client-core/src/__tests__/chatListModel.test.ts` (450 ids → 200/200/50, merged failures; failure semantics), `apps/web/src/__tests__/platform/HttpPlatformClient.test.ts` (401 → 200/200/1). Real: 450 chats + 1 duplicate deleted in 3 requests, `succeeded=450`, total afterwards 0, 450 `chat.deleted` on SSE.
- **P2-R2 (stale lists).** `PATCH /chats/:id` emits `chat.updated` whenever a list-visible field changes (`name`, `description`, `tags`, `status` incl. unarchive, `projectId`, `agentRef`); `chat.updated` is now an `AttentionService` chat trigger, so attention titles/projects follow. No polling safety net restored — not needed once every list-visible write announces itself. Test: `apps/server/src/__tests__/chatList.test.ts` "PATCH … live lists" (rename, unarchive, tags, description, project → one event each; `harnessConfig` → none; attention title follows). Real: rename and unarchive each produced `chat.updated` on `GET /api/stream?scope=global`; a `harnessConfig`-only PATCH produced none.
- **P2-R3 (update never announced).** Main counts renderer subscriptions (preload `updates.onChange` reports subscribe/unsubscribe over the guarded `IPC.watchUpdates`; cleared whenever the page resets). The native dialog is skipped only when a renderer subscribed **and** the window is visible. Nothing in `apps/web/src` subscribes yet, so the dialog keeps showing until the P3-06 pill mounts `useUpdateState` (D-54, 05 G-04, 06 §8). `getUpdateState`/`onChange` carry the full state (status, current/next/downloaded version, percent, error).
- **P2-R4 (install stops the app first).** `installUpdate` stops nothing up front: `confirmDiscard` → mark quitting → `quitAndInstall()`; the resulting `before-quit` is the commit point and runs the normal bounded shutdown. An electron-updater `error`, a throw, or 60 s without a quit is a failure: state back to `ready` with the error, quitting cleared (and the discard confirmation reset), window restored — nothing was stopped. Concurrent requests share one attempt. On macOS `ready` waits for Electron's native `autoUpdater` `update-downloaded` (`updaterHasNativeInstallStage` in `platform.ts`, the one place that knows Squirrel.Mac has a second stage). Tests: `updater.test.ts` (error, throw, deadline, retry, macOS stage).
- **P2-R5 (R5 cause).** **The reviewer was right; D-54's premise was wrong.** Electron's own typings say `app.exit` skips only `before-quit`/`will-quit`; its source (`shell/browser/browser.cc`: `Browser::Exit` → `DestroyAllWindows` → `OnWindowAllClosed` sees `is_exiting_` → `Shutdown()` → observers' `OnQuit`; `api/electron_api_app.cc`: `App::OnQuit` → `Emit("quit", exitCode)`) emits `quit` with code 0. electron-updater 6.8.9 installs on `app.once('quit')` when `exitCode === 0` (`ElectronAppAdapter.onQuit`, `BaseUpdater.addQuitHandler`), so install-on-quit was never broken on Windows/Linux. D-54, 05 G-04, 06 §11 R5 and the code comments are corrected, and the code that rested on the premise is gone (`runQuitShutdown`/`isQuitHandled`/the `before-quit` pass-through): every quit, an install included, goes `before-quit` → `quitApp` → `app.exit(0)`. Still unverified on real installers (no `mock-update-server` run here); 07 R-10 stays open. On macOS it is Squirrel.Mac's documented behaviour, not source-verified, that ShipIt installs after any process exit.
- **P2-R6 (probes vs CSP).** Desktop: main probes every server in parallel with Node `fetch` (`server-probe.ts`, 2.5 s each, `probeServer` from the import-free `@generatorai/client-runtime/connections` subpath) and `getServers` returns `status`/`serverName`/`latencyMs`; the renderer never probes on desktop. Web: `useServers` probes only the entry on its own origin and marks the rest `unknown`. No CSP was widened. Same code on every OS.
- **P2-R7 (state machine).** `ready` derives from `downloadedVersion` (a later check or failure only sets `error`); `error` clears on the next successful step; a failed check is `idle` + `error`; `update-cancelled` handled; a newer download replaces the older. Status `'error'` removed, `'installing'` added.
- **P2-R8 (stale badge).** `WindowManager.onRendererReset` (window closed, renderer gone, `repointMainWindow`, top-frame navigation) → `clearAttention()` (counts dropped, tray refreshed, badge cleared) and update subscriptions cleared. The renderer also pushes `attention: null` while its counts are unknown (P2-R18). Tests: `attention-state.test.ts`, `window-manager.test.ts`.
- **P2-R9 (git storm).** `ChatChangeStatsService` runs at most `maxConcurrent` (default 3) summaries across all workspaces, FIFO queue, every one still runs; the composition root uses the new `getSummary({ freshWorkingTree: true })` (`packages/changes`), which drops only that workspace's repos from the working-tree memo instead of clearing every workspace's. CLI ref resolution (`findChat`) now uses one `GET /chats/:id` for an exact id, the newest page for `#n`/`@last`/`@active`, the `q=` search for names, and pages every chat only for an id prefix. Tests: `packages/core/__tests__/ChatListSummary.test.ts` (40 workspaces → peak 3, all 40 done), `packages/cli-core/src/commands/__tests__/chat-list.test.ts`.
- **P2-R10 (sandbox on Windows).** Shared `scripts/redesign/lib/spawn-node-bin.mjs`: a tool's JS entry (`vite/bin/vite.js`, `tsx/dist/cli.mjs`, resolved from the workspace package that declares it) runs with `process.execPath`; pnpm runs through `npm_execpath` (bare `pnpm` with a shell only as the documented fallback when the script was not started by pnpm). No `.cmd` is spawned on any OS, and the sandbox now signals the real Vite process. `--help`/`--dry-run` print the resolved commands without starting anything. macOS proof: `node scripts/redesign/sandbox.mjs --help` resolves `node …/tsx/dist/cli.mjs agent-tests/vrt/seed.ts` and `node …/vite/bin/vite.js --port 5197 …`; `scripts/__tests__/spawn-node-bin.test.mjs` actually runs `tsx --version` and `vite --version` through the helper. Windows is for CI/the owner.
- **P2-R11 (seed skipped).** `isMain()` compares `pathToFileURL(realpathSync(argv[1])).href` with the real module URL; `scripts/__tests__/main-module-guard.test.mjs` runs it from a path with a space (and shows the old check already fails on macOS through `/var` → `/private/var`).
- **P2-R12 (attention stall).** Fixed at the one implementation: client-core's reducer holds every delta from the moment a snapshot request is sent (`fetch` event) and replays those past the response's `seq`, so an older response never rolls the view back and a burst never needs a cancel; the store never cancels a request (one at a time; a delta gap during a fetch is settled by the replay, an explicit resync queues exactly one more; ≤ 5 back-to-back fetches). The web now wraps `createAttentionStore` (shared per platform + project, ref-counted, `useSyncExternalStore`) instead of its own React Query copy — as the review preferred and 08 asks. Tests: `packages/client-core/src/__tests__/attention.test.ts` (50 deltas during a slow fetch: 2 requests total, final seq 60 over a seq-12 response; gap/resync during fetch), `apps/web/src/__tests__/hooks/attentionQueries.test.tsx` (shared store; 35-delta burst during a refetch: no cancel, no repeat, nothing lost). Real: store driven by the live `global` stream while 12 Faux chats ran and `refresh()` was called 10× in 400 ms → 5 requests (not 11), final `seq` equal to the server's, `needsResync=false`.

### Minor

- **P2-R13.** Mobile Chats segments show no count until the page loads (`counts?.all/active/archived`); Dashboard renders "—" when the count is unknown (loading or failed) instead of `?? 0`.
- **P2-R14.** The bulk bar says "N selected · L of T loaded" and the button reads "Select All Loaded"; a filter or search change clears the selection, and Select All is disabled while the previous filter's rows are still shown as placeholder data.
- **P2-R15.** A question's or plan review's free-text `ask.summary` becomes "Your agent has a question" / "Review the plan" for principals without the entity's read scope (tool/app/stage names are kept). Test: `attentionHelpers.test.ts`. D-49 updated.
- **P2-R16.** `attention.counts` is emitted only when the totals change (a tool-step label change is a lone upsert — test in `attention.test.ts`); the boot rebuild reads live automation executions with one indexed query (`listAutomationExecutionIdsByStatus`, a read-only query in a new redesign-owned file over the PW-owned table; test asserts the history walk is never called). Desktop half: `applyMenuPush` rebuilds the menu only when something the menu shows changed (a plain "skip if only attention" check would not work — the renderer re-sends every field whenever the counts move). Test: `menu-push.test.ts`.
- **P2-R17.** `AttentionService.isAvailable()`; `GET /attention` answers 503 `ATTENTION_UNAVAILABLE` until `start()` finished (OpenAPI updated). Test in `attention.test.ts`.
- **P2-R18.** `useDesktopIntegration` calls `useAttentionCounts({ enabled: isDesktop })`: a plain tab opens no request, stream or poll. It now pushes `attention: counts ?? null`, so "unknown" clears main's badge instead of leaving a previous server's number (see P2-R8).
- **P2-R19.** A consent prompt with no `chatId` is listed on the top-level chat that owns its workspace (`chats.getByWorkspaceId`), on boot, on `computer.consent_required/resolved` and on expiry. Tests in `attention.test.ts`.
- **P2-R20.** Activity sort orders by the bare `last_activity_at` (never NULL: `create` stamps it, v55 backfilled it), so `idx_chats_last_activity` serves it; v55's window function carries only `rowid` and joins the winners; a cursor's value must be a number for activity/created and a string for name (test in `ChatListSummary.test.ts`); web live lists fold events into one refetch per 250 ms with `cancelRefetch: false` and one follow-up if events arrived during the request (test: 200-event burst → 1 refetch, in-flight request not cancelled, exactly one follow-up).
- **P2-R21 (Faux).** `file_edit` needs the chat's workspace (no `process.cwd()` fallback) and rejects `../` and absolute escapes (`path.relative`, Windows-safe); a denied `permission_request` turns the next scripted `file_edit` into a failed tool call with no write; `countLines()` fixes the trailing-newline over-count. 9 new tests.
- **P2-R22.** SIGKILL fallback checks `exitCode`/`signalCode` (not `.killed`); server/Vite logs are a 200 KB ring; `findChatIdByName` uses `?q=` + exact name + cursor paging.
- **P2-R23.** Concurrent quits share one in-flight promise (declining lets a later quit ask again); `serversChanged` rebuilds the Server menu and tray; View ▸ Appearance with no window rebuilds the menu so the radio follows; remote-mode tray shows `{remote} · N agents` plus a separate `This computer: {state} (:port)` line; `probeServer` maps 429/5xx to `error` and a `serverId` mismatch to `unpaired`; `desktopServers.list()`/`desktopUpdates.getState()` reject instead of returning `[]`/`null` (query error / unknown).
- **P2-R24.** IPC payload types live once in `packages/shared/src/types/DesktopShell.ts`; main, preload and the web `.d.ts` (via `@generatorai/shared/client`) import them.
- **P2-R25.** New updater tests (install failure paths, `error` after `ready`, `update-cancelled`), tray label tests; 06 §8 now says Windows gets an overlay badge, `getServers` returns reachability and the dialog stays until P3-06; D-54 says the tray (not the menu) shows counts; `source-inventory.json` lists `GENERATORAI_TEST_FAUX_HARNESS`/`_SCRIPT`.
- **P2-R26.** `chat list` warns "Showing 50 of N chats. Next page: --cursor … (or --all …)" on stderr when there is more; `--cursor` and `--all` added. D-52 updated.

### Real API check (isolated server, :3381)

Bundled server (`pnpm --filter @generatorai/server bundle`), `PORT=3381`, bare `DB_PATH`/`ARTIFACTS_DIR`/`WORKSPACES_DIR`/`EXTENSIONS_DIR` in a `generatorai-p2fix-*` temp dir, `GENERATORAI_BIND_HOST=127.0.0.1`, `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1`, `NODE_ENV=test`, `GENERATORAI_TEST_FAUX_HARNESS=true`; the startup log's `dbPath` was the temp DB. Driven with client-core's own `createApiClient`/`createAttentionStore` plus a raw SSE reader on `GET /api/stream?scope=global`:

```text
[attention] GET /api/attention → 200
[bulk] seeded 450 chats; server total with tag p2fix = 450
[sse] PATCH rename → 200; chat.updated for the renamed and the unarchived chat (plus Changes-backfill ones)
[sse] chat.archived events: 1; harnessConfig-only PATCH produced chat.updated: false
[attention] store seq == server seq (match=true), running 0/0, needsResync=false, fetching=false, getAttention calls=5
            (12 Faux chats prompted at once, refresh() called 10× in 400 ms while 48 attention deltas streamed)
[bulk] one raw request with 201 ids → 400 (server cap stays 200)
[bulk] client-core removeMany(450 ids + 1 duplicate) → succeeded=450 failed=0 (3 requests)
[bulk] server total with tag p2fix after delete = 0; chat.deleted events seen: 450
```

### Verification

`pnpm typecheck` (all packages), `pnpm turbo lint --force` on every touched package (0 errors), tests: shared 391, db 137, changes 46, core 1888 (the 8 `PtyHostAdapter` failures in a fresh worktree need `apps/pty-host` built; green after building it), client-core 321+, client-runtime 45, cli-core 904+, server 589, desktop 336, web `vitest related` on every touched file, `pnpm --filter @generatorai/web check:design --strict`, `pnpm exec vitest run --project node scripts/__tests__` (57). No Electron, e2e or `mock-update-server` run (the lead's, once).

---

## Round 2 review

- **Range:** `42ff689..HEAD` (HEAD `8b3c2c8`): a83a230 (P1-fix), be62544, 656509e, cc866b6, 8b3c2c8 (P2-fix). 121 files, +4,384 / −1,118.
- **Reviewer:** a fresh, independent adversarial review. I edited no code and started no server, Electron, Storybook or e2e. Two read-only sub-reviews covered (a) the desktop updater, quit, probe and badge work and (b) the attention, chat-list and git work. I re-read the code, or the `node_modules` source, behind every Major before including it. Probes (scratch SQLite DBs, one temporary vitest file, a real electron-updater 6.8.9 probe) ran in temp dirs and were deleted. `git status` is clean apart from this file.

### Commands and results

| Command | Result |
|---|---|
| `pnpm typecheck` | green, but 49/49 were cache hits, so I re-ran it as `pnpm turbo typecheck --force`: 49/49 green, 0 cached |
| `pnpm turbo lint --force` | 26/26 green, 0 cached, 0 errors (web 311 warnings, as before) |
| `pnpm --filter @generatorai/web check:design --strict` | OK |
| `pnpm check:tokens` | OK on all targets |
| `pnpm --filter @generatorai/shared test` | 19 files, 392 passed |
| `pnpm --filter @generatorai/client-core test` | 22 files, 321 passed |
| `pnpm --filter @generatorai/core test` | 141 files passed, 2 skipped; 1879 tests passed, 9 skipped |
| `pnpm --filter @generatorai/db test` | 20 files passed, 1 skipped; 137 tests passed, 4 skipped |
| `pnpm --filter @generatorai/server test` | 59 files, 589 passed |
| `pnpm --filter @generatorai/web test` | 82 files, 918 passed. The `ECONNREFUSED ::1:3000` noise is still there; it predates this range |
| `pnpm --filter @generatorai/desktop test` | 27 files, 340 passed |
| `pnpm exec vitest run --project node scripts/__tests__` | 4 files, 57 passed on macOS. **The same run with a non-symlinked `TMPDIR` (as on Linux) fails 1 of 3 tests in `main-module-guard.test.mjs`** (P2-R29) |

### Round-1 fixes: are they real?

- **P1-R1:** fixed. I read `installWebKeyHandler` directly:
  - `isKeyOwnerTarget` runs first and returns without calling `preventDefault`.
  - A matched chord in a typing target returns un-prevented unless `firesInEditable`.
  - Only `palette.toggle` carries the flag.
  - The terminal container has `data-gai-keys="own"`.
  - The web app has no other code editor (no CodeMirror or Monaco) that would need the attribute.
  - The rule is the same on every OS.
- **P1-R2 … R6, R8 … R11:** fixed or documented as stated.
  - For P1-R4, the terminal now opens asynchronously after `document.fonts.load`. I checked every path that reads `term.cols`/`rows` or sends a resize. A fit before open is a no-op, and `ws.onopen` sends the dimensions after the fit, so there is no regression.
  - For P1-R5, `ACCENT_IDS` is theme-independent, so ignoring unknown ids loses nothing.
- **P1-R7:** still an owner action.
- **Docs:**
  - Every `D-xx` referenced anywhere (docs, code, CLAUDE.md) resolves; they are D-01…D-54.
  - README says "D-01…D-54".
  - D-40 is under F and D-46…D-54 are under G.
  - `.claude/CLAUDE.md` is 85 lines.
  - Two content inaccuracies remain (P1-R12, P2-R42).
- **P2-R1:** fixed. `runChatBulk` is correct, and every consumer goes through it: web `HttpPlatformClient.archiveChats/deleteChats`, and client-core `archiveMany/removeMany` (used by mobile). No other capped bulk route exists.
- **P2-R2:** mostly fixed. `model` and indirect writes are missed (P2-R33).
- **P2-R3:** fixed. The dialog still shows (no web subscriber yet), and the watcher count is clamped and cleared on reset.
- **P2-R4:** fixed as described, but the new order spawns the installer **before** the shutdown, and that is a regression on Windows and AppImage (P2-R28). A second install call is not latched either (P2-R27).
- **P2-R5:** the correction is right. electron-updater 6.8.9:
  - `ElectronAppAdapter.onQuit` is `app.once("quit", (_, exitCode) => handler(exitCode))`.
  - `BaseUpdater.addQuitHandler` installs only when `exitCode === 0` and `!quitAndInstallCalled`, and is registered only after a download.
  - One `quitAndInstall` therefore does not install twice.
  - The one naming slip is in P2-R42.
- **P2-R6, R7, R8:** fixed.
  - The probe URLs come from stored, normalised origins, never from the renderer.
  - Same-document navigations do not clear the badge.
- **P2-R9:** fixed.
  - The FIFO queue caps concurrency at 3.
  - Errors free their slot.
  - `freshWorkingTree` drops exactly that repo's memo keys.
  - The `checkpoint.created` path at `composition-root.ts:1492` still clears every workspace's memo. That is minor and outside R9's scope.
- **P2-R10:** fixed. No `.cmd` is spawned, and `execFileSync(process.execPath, [script])` is safe on paths with spaces. See P2-R43 for the fallback.
- **P2-R11:** the seed fix is right, but its new test is wrong on Linux (P2-R29).
- **P2-R12:** fixed.
  - Held deltas are replayed past `seq`, duplicates are ignored, and a hole triggers a refetch.
  - The buffer is capped at 500.
  - The web wrapper is ref-counted, survives StrictMode, and its snapshot is a stable reference.
  - Retry after an error is weak (P2-R31).
- **P2-R13 … R19, R21 … R23, R25, R26:** fixed as stated, with residual edges in P2-R32 and P2-R37 … R39.
- **P2-R20:** the cursor type check and the v55 rewrite are correct. The "index-served" claim is not (P2-R30).
- **P2-R24:** the five payload types are single-sourced, but other bridge types are still duplicated (P2-R41).
- **v55 edited in place:**
  - The runner stores only the version and name (no checksum), and the name is unchanged.
  - I ran the old and new SQL on identical random data (300 chats, mixed metadata) and got identical results.
  - So a DB that ran the earlier v55 is in the same state as a fresh one.
  - The earlier v55 only ever existed on dev machines, and the no-backward-compatibility rule applies anyway. Safe.
- **One-shutdown quit:** every path I traced reaches `before-quit` → `quitApp` → `app.exit(0)`: menu Quit, Cmd+Q, tray, `window-all-closed`, vault Quit, electron-updater's `app.quit` and Squirrel's terminate. The embedded server is stopped inside the 20 s bound on each of them. Nothing else calls `app.exit` or `app.relaunch`.
  - Pre-existing gaps, not counted here: nothing handles Windows `session-end`, so a logoff skips the graceful stop; the debounced bounds save and the logger stream are not flushed before `app.exit`.

### Critical
None.

### Major

**P2-R27. A second `installUpdate` after the install is committed installs the update twice.**
- **Where:** `apps/desktop/src/main/updater.ts:299-307`. `installInFlight` is cleared in `.finally` even when the outcome is `'quitting'`. `downloadedVersion` and `updaterRef` are still set, so the next call runs `runInstall` again and calls `quitAndInstall()` a second time.
- **What electron-updater 6.8.9 then does:**
  - `install()` sees `quitAndInstallCalled` and returns false, with no error (`BaseUpdater.js:42-46`).
  - `quitAndInstall` then **resets the flag** (`BaseUpdater.js:24-26`: `else { this.quitAndInstallCalled = false; }`).
  - On `app.exit(0)` the quit handler finds the flag false and exit code 0, and calls `install(true, false)` again (`:74-88`).
  - Sub-review probe against the real module: `installs = 1` after two calls, then `installs = 2` after the quit handler.
- **Impact:**
  - AppImage: the second run unlinks `$APPIMAGE`, which is the freshly installed file when the name carries no version. `mv` then fails, and no AppImage is left on disk.
  - deb/rpm: a second pkexec prompt.
  - NSIS: a second installer.
- **Reachability:** any `IPC.installUpdate` during the shutdown window, which is up to 20 s with the window still up. Latent until the P3-06 pill exists, but a "nothing happened, click again" is exactly what a pill invites.
- **Fix:** latch it. Once the outcome is `'quitting'`, keep the settled promise, or return `'quitting'` whenever `machine.installing || isQuitting()`. Never call `quitAndInstall` twice. Add a test that calls `installUpdate` twice after the handoff.

**P2-R28. The install now starts before the graceful shutdown, and the installer can kill the app mid-shutdown.** This regression comes from the P2-R4 reordering in cc866b6. Confidence: medium-high for Windows, medium for AppImage. Not verified on real installers.
- **What changed:** before cc866b6, the shutdown ran first and `quitAndInstall` came after. Now `quitAndInstall()` spawns the installer, and the bounded shutdown (up to 20 s) runs afterwards in `before-quit`.
- **Windows NSIS:**
  - The installer runs with `--updated`. `app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh:106-150` waits `Sleep 300` → `FIND_PROCESS` → `Sleep 1000` → `KILL_PROCESS`.
  - With PowerShell, `KILL_PROCESS` is `Stop-Process` on every process whose path is under `$INSTDIR`, then a forced retry.
  - That includes the embedded server, which runs as `process.execPath` with `ELECTRON_RUN_AS_NODE` (`server-manager.ts:420,533`).
  - So the graceful stop (close the DB, flush events, stop the agent CLIs) is cut off after roughly 1.5–3 s, and the agent CLIs are orphaned.
- **AppImage:**
  - `quitAndInstall()` passes `autoRunAppAfterInstall` (default true) as `isForceRunAfter`.
  - `AppImageUpdater.doInstall` then `spawnLog(destination)` **immediately** (`AppImageUpdater.js:106-109`).
  - The new process fails `requestSingleInstanceLock()` (`index.ts:50-51`) while the old one is still shutting down, and quits. The update installs, but the app does not come back.
  - deb/rpm are unaffected: they use `app.relaunch()`, which runs at exit.
- **Fix (BaseUpdater path):**
  - Check that the install can go ahead before stopping anything: installer file present, `APPIMAGE` set.
  - Then run the shutdown.
  - Then call `quitAndInstall()` immediately before `exit(0)`.
  - If it declines at that point, `app.relaunch(); app.exit(0)`, the round-1 fallback.
  - Keep today's order on macOS, where ShipIt waits for the process to exit.
- Also: the 06 §8 `mock-update-server` run should include "server stopped gracefully" and "app relaunched" checks per OS.

**P2-R29. `scripts/__tests__/main-module-guard.test.mjs` fails on Linux, so CI's "Root script tests" step goes red on ubuntu.**
- **Where:** the test "the old `file://${argv[1]}` template comparison is not a reliable…" (`:73-79`) asserts `oldGuard === false`.
- **Why it only passes on macOS:** it depends on `os.tmpdir()` going through a symlink (`/var` → `/private/var`). On Linux `/tmp` is a real directory. The old template comparison is then *true* for a plain path, and the assertion fails.
- **Reproduced here** with `TMPDIR=<realpath dir> pnpm exec vitest run --project node scripts/__tests__/main-module-guard.test.mjs`: `expected true to be false`, 1 failed / 2 passed.
- **Scope:** CI runs this step on all three OSes (`.github/workflows/ci.yml:120-126`).
- **Fix:** assert only the positive properties of the new guard, which already hold on every OS (space in path, imported-not-run). If the old-guard demonstration stays, build the mismatch explicitly, e.g. a directory whose name contains a space or `%`, or a symlinked directory created by the test, and skip where symlinks are unavailable.

### Minor

- **P1-R12. D-24 still describes the planned registry, not the built one.**
  - It names the registry `SHORTCUTS` and gives `C` as the new-chat key (`01-decisions.md:142`).
  - As built, the registry is `COMMANDS` (`packages/shared/src/ui-contract/commands.ts`) and `chat.new` is `N` on the web.
  - Amend D-24 or point it at D-46.
- **P2-R30. The activity sort still is not index-served** (P2-R20 is not effective).
  - `ChatRepository.ts:418` now sorts on the bare column, but the list query always has `parent_chat_id IS NULL` and usually `status = ?`.
  - `EXPLAIN QUERY PLAN` on a migrated 5,000-chat DB: `SEARCH chats USING INDEX idx_chats_parent_chat_id | USE TEMP B-TREE FOR ORDER BY`.
  - Only after `ANALYZE` does it use `idx_chats_last_activity`, and even then with a temp B-tree for the `id` tie-break. Nothing runs `ANALYZE` or `PRAGMA optimize`.
  - **Fix:** a composite index `(parent_chat_id, last_activity_at, id)` or `(last_activity_at DESC, id DESC)`, or `PRAGMA optimize` at open.
  - The column is also nullable. A NULL row would now sort last, and its cursor `{v:null}` would be rejected with a 400. Only `create` inserts today.
- **P2-R31. The attention store never retries on its own after a failed snapshot** (`packages/client-core/src/attention/store.ts:92,103`).
  - When the first fetch fails (e.g. the new 503), the store has `snapshot: null` and `needsResync: false`, and later deltas are only buffered. Probe: 20 deltas → 1 request, still no snapshot.
  - Web recovers only through its 60 s safety refresh. Mobile would not.
  - While `needsResync` is set and the server keeps failing, every delta fires a request with no backoff (probe: 11 deltas → 12 requests).
  - **Fix:** retry with backoff inside the store, and treat "no snapshot" like `needsResync`.
- **P2-R32. A computer-use consent raised by a worker chat stays in Needs you after it is answered.**
  - `computer.consent_resolved` carries no `chatId` (`ComputerService.ts:1466-1469`).
  - The P2-R19 resolve path re-reads only top-level chats that own the workspace (`AttentionService.ts:514-525`), so an ask keyed on the worker lingers until expiry or `harness.idle`.
  - **Fix:** add `chatId` to the payload, or re-read every item whose `ask.id` equals the request id.
- **P2-R33. `chat.updated` still misses list-visible writes.**
  - `model` is not in `LIST_VISIBLE_CHAT_FIELDS` (`apps/server/src/routes/chats.ts:328`), yet web (`ChatsListPage.tsx:423`) and mobile (`chats.tsx:568`) render it, and `ChatPage` PATCHes it.
  - Deleting a project nulls `chats.project_id` (`ProjectRepository.ts:79`) with no event, and attention items keep the deleted project.
  - Renaming or deleting an agent changes `summary.agent` with no event.
  - **Fix:** add `model`; emit per affected chat, or a coarse list invalidation, from project delete and agent rename.
- **P2-R34. A coalesced list refetch can piggyback on an older request** (`apps/web/src/hooks/chatListQueries.ts:89`).
  - With `cancelRefetch: false`, TanStack returns whatever fetch is already in flight, including `fetchNextPage` on the infinite query, which reloads only the next page. An event that lands during a foreign fetch is then lost until the next event.
  - **Fix:** if `fetchStatus === 'fetching'`, mark dirty and refetch after it settles. Medium-high confidence.
- **P2-R35. CLI ref resolution regressions** (`packages/cli-core/src/commands/chat.ts` `findChat`).
  - Name refs go through `q=`, which compares with SQLite `lower()`, and that folds only ASCII. `"Über plan"` is now NOT_FOUND, even with the exact case; the old in-JS match found it. The seed's `findChatIdByName` has the same problem.
  - An unmatched ref says "No chats exist yet." (`resolveRef.ts:86-89`).
  - `#n`, `@last` and `@active` see only the newest page.
  - **Fix:** fall back to a paged scan when `q=` finds nothing, and correct the message.
- **P2-R36. Bulk failure UX.**
  - Mobile `removeMany` (`apps/mobile/app/(tabs)/chats.tsx:178-191`) has no `onError`, and there is no global mutation handler, so a thrown "nothing succeeded" is silent.
  - Web `confirmBulkDelete` (`ChatsListPage.tsx:173-177`) keeps the dialog open after a partial failure, with the ids already deleted still selected, so a retry reports them as NOT_FOUND.
- **P2-R37. Update install UX and state edges** (`updater.ts`).
  - A `'failed'` outcome after "Restart Now" is silent (`:139`). After "Later" there is no way to install: `offerInstall` fires only on the transition to ready, and Check for Updates shows nothing once an update is downloaded (`:247-249`).
  - `confirmDiscard` sets `discardConfirmed` only when there was unsaved work, so `quitApp` asks again at `before-quit`. Declining there leaves `status: installing` and `wm.quitting` true, while NSIS may already be running.
  - `win.isVisible()` is true for a minimised window (`:128`). This is latent until a renderer subscribes.
  - On macOS, the cached-download path re-runs `nativeUpdater.checkForUpdates()` after ready, and every `error` clears `awaitingNativeVersion` (`:201-222`). So `ready` plus a bogus error, or a lost native `update-downloaded`, is possible. Low-medium confidence.
- **P2-R38. Quit-flag leaks.**
  - Tray Quit (`tray.ts:137`) and the vault prompt's Quit (`index.ts:295`) set the quitting flag *before* the discard prompt. Declining leaves it set, which suppresses `showError`, stops close-to-tray and suppresses the vault prompt for the rest of the session. A prevented `before-quit` closes nothing, so the pre-set is unnecessary.
  - If `confirmDiscard` throws, `quitApp`'s `inFlight` (`quit-coordinator.ts:83-86`) stays a rejected promise, and the app can never quit again. Add a `.catch` that resets it.
- **P2-R39. The badge can be cleared by a navigation that never commits.**
  - `onRendererReset` runs on `did-start-navigation` (`window-manager.ts:249`), which fires before `will-navigate` blocks an external link. The same happens for a download or a 204.
  - Counts and update watchers are then dropped while the page lives on. The renderer re-pushes counts only when they change, so the badge stays blank until then.
  - **Fix:** use `did-navigate` (committed), or a per-document token. The preload's `updates.onChange` unsubscribe (`preload/index.ts:136-139`) is also not idempotent: a double call sends two `false`s.
- **P2-R40. Probe details** (`packages/client-runtime/src/connections.ts:286-296`).
  - `fetch` follows redirects, so a stored server can bounce main's request elsewhere and its `serverName` reaches the renderer. Use `redirect: 'manual'`.
  - A body read cut by the timeout maps to `unpaired`, not `offline`/`error`.
  - Node `fetch` ignores the system proxy and Chromium's certificate policy, so the status can disagree with what the window can load. Consider passing Electron's `net.fetch`.
- **P2-R41. Bridge types are still partly duplicated** (P2-R24).
  - `WindowChrome` is declared in `apps/desktop/src/shared/ipc.ts:66` (`platform: NodeJS.Platform`) and in `apps/web/src/types/desktop-bridge.d.ts:130` (a three-OS union), so the two have already drifted.
  - `WindowStateChange`, `FindInPageResult` and the browser-IPC shapes are also still duplicated.
- **P2-R42. Doc and comment accuracy.**
  - D-54, 05 G-04, `updater.ts:292` and `quit-coordinator.ts:12` say `Browser::ExitWithCode`. `app.exit` binds to `Browser::Exit` → `DestroyAllWindows`, which is how the round-1 fix notes above describe it. The conclusion stands.
  - `updater.ts` and 05 say electron-updater "runs the installer synchronously". That is false for NSIS: spawn errors are dispatched asynchronously (`NsisUpdater.js:131-147`) after `app.quit()` has already been scheduled, so the error path cannot catch them.
  - "Squirrel rejecting the signature" can now only happen before `ready`.
  - D-49 says "mobile wraps [`createAttentionStore`] in its own container", but nothing in `apps/mobile` imports it. Say "will wrap".
- **P2-R43. `pnpmCommand` trusts any `npm_execpath`** (`scripts/redesign/lib/spawn-node-bin.mjs:100-105`).
  - Under `npm run`/`npm exec` or yarn, it points at npm's or yarn's JS entry. The sandbox would then run `npm --filter @generatorai/server bundle`.
  - **Fix:** also require `/pnpm/i` in the path.
  - The `shell: true` fallback passes an args array, which Node 24 deprecates (DEP0190). Join the fixed string instead.
- **P2-R44. `isolatedProfile()` can leak or pull the profile out from under Electron** (`agent-tests/helpers/desktop-profile.mjs`).
  - Cleanup hangs off process `exit`, so SIGINT or SIGTERM (Ctrl-C) leaves the directory behind.
  - The hook is registered before `electron.launch` (e.g. `desktop-security-smoke.mjs:29-30`), so after a throw it can run while Electron and the embedded server still hold files. The resulting Windows EBUSY is swallowed.
  - Windows does not clean `%TEMP%` by default.
  - **Fix:** add SIGINT/SIGTERM handlers, close the app before removing the directory, and have the sandbox's `--clean` also sweep `gai-*-smoke-*`.

### Verdict

The round-1 fixes are real for P1 and for most of P2. The three Majors are in new code: the reordered update install (P2-R27, P2-R28) and a new root test that only passes on macOS (P2-R29). P2-R29 will fail CI on ubuntu on the next push.

Critical: 0, Major: 3, Minor: 16

## Round 2 fixes

Every Major and Minor finding from round 2 is fixed or documented below. The desktop update sequence (P2-R27, R28) was designed against electron-updater 6.8.9's source in `node_modules` (`BaseUpdater`, `NsisUpdater`, `AppImageUpdater`, `DebUpdater`/`RpmUpdater`/`PacmanUpdater`, `MacUpdater`, `ElectronAppAdapter`) and app-builder-lib 26.15.7's NSIS and deb templates. D-54 now gives the sequence per OS. No Electron, e2e or real installer was run (they run at batch end), so 07 R-10 stays open.

### Major

- **P2-R27 (second install installs twice): fixed.**
  - The guard is in our state machine (`updater.ts`), not in electron-updater. Once an install is committed, `installCommitted` is latched for the rest of the process, and every later `installUpdate` returns `quitting` without touching electron-updater.
  - A request while an ordinary quit is already shutting down is also `quitting`. electron-updater's `autoInstallOnAppQuit` installs on that quit's exit code 0.
  - Tests (`updater.test.ts`, "against the real electron-updater BaseUpdater"):
    - They drive the real `BaseUpdater` class through `vi.importActual`, with only `doInstall` counting and a fake app adapter.
    - The first test reproduces the reviewer's probe on the bare module: `install()`, then a second `quitAndInstall()`, then the quit handler with code 0 gives 2 installs.
    - The second test runs `installUpdate` → hand-off → `exit(0)`, then `installUpdate` again, then `quit(0)`. The result is exactly 1 install.
  - The macOS path has the same latch test against the fake `MacUpdater`.
- **P2-R28 (installer raced the shutdown): fixed.** The order is now: commit, then shutdown, then installer, then exit. This holds on every OS whose installer could race us. A failure found before the commit leaves the app running untouched.
  - **Windows and Linux (`BaseUpdater`: NSIS, AppImage, deb, rpm, pacman):**
    1. A side-effect-free check runs first: the installer file exists (the raw `downloadedUpdateHelper.file`; `LinuxUpdater.installerPath` is shell-escaped). For an AppImage it also checks that `$APPIMAGE` is absolute and exists. If either fails, the install fails with nothing touched.
    2. `confirmDiscard`.
    3. `quit-coordinator` gets a new `setExitHandoff` and the updater calls `app.quit()`. `quitApp` accepting the quit is the commit point.
    4. After the bounded shutdown (computer host, embedded server, tray), the hand-off calls `install(false, autoRunAppAfterInstall)`, which is what `quitAndInstall()` passes, without its `app.quit()`. `app.exit(0)` follows.
    - NSIS's kill loop then finds nothing of ours to kill.
    - The new AppImage is spawned in the same tick as our exit, so it finds the single-instance lock free.
    - deb/rpm/pacman keep their `app.relaunch()`.
    - If `install()` returns false, throws, or reports `error` within two event-loop turns (NSIS spawn errors are asynchronous), the app relaunches on the current version. An AppImage relaunches `$APPIMAGE`, because its mount goes away with the process.
    - A quit that is not accepted, or no quit within 60 s, leaves the app running with the update still `ready`.
  - **macOS:** installer first, as before. ShipIt waits for our exit, and Squirrel verified the update before `ready`.
  - The hand-off is bounded (10 s). A hand-off registered while a quit is already shutting down still runs.
  - Tests:
    - `updater.test.ts` runs through the real `quit-coordinator`, wired the way index.ts wires it. It covers the exact order for NSIS, AppImage and macOS; both pre-commit refusals (missing file, no `$APPIMAGE`); pkexec cancelled; an NSIS next-tick spawn error; an AppImage failure relaunching `$APPIMAGE`; decline at either prompt; and the deadline.
    - `quit-coordinator.test.ts` covers the hand-off position (after the tray, before exit), decline, registration mid-shutdown, and a hanging or throwing hand-off.
  - Docs:
    - D-54 has the full per-OS sequence.
    - 05 §G-04 and 06 §11 R5 match it.
    - 06 §8's `mock-update-server` run must now also check "server stopped gracefully before the installer" and "app came back" on each OS.
- **P2-R29 (main-module guard test failed on Linux):** fixed.
  - Reproduced first: with a non-symlinked `TMPDIR`, `main-module-guard.test.mjs` failed with `expected true to be false`.
  - The old-guard demonstration now builds its own mismatch: a temp directory whose name contains a space. `import.meta.url` is a real URL and percent-encodes the space (`%20`); the old `file://${argv[1]}` template never encodes anything. This does not depend on symlinks, drive letters or the OS.
  - `pnpm exec vitest run --project node scripts/__tests__` passes 4 files / 62 tests both with the default `TMPDIR` and with a non-symlinked one (`/private/tmp/claude-501/gai-rt`).
  - The session scratchpad path is too deep for one test: tsx's IPC socket path goes over the Unix socket-path length limit (`EINVAL`), and that happens with or without these changes. Any ordinary temp dir is fine.

### Minor

- **P1-R12:** D-24 now names `COMMANDS` (`packages/shared/src/ui-contract/commands.ts`, as built in D-46) and gives `N` as new chat (`Shift+N` new workflow) on the web.
- **P2-R31 (attention store never retried):** fixed in `packages/client-core/src/attention/store.ts`.
  - **Retry:** a failed snapshot fetch is retried by the store with backoff: 1 s, doubling, capped at 30 s, reset after a snapshot. Timers are injectable.
  - **No snapshot:** a store with no snapshot yet is treated like `needsResync`.
  - **Deltas while a retry is pending:** they are held rather than each firing a request.
  - **`refresh()`:** fetches at once.
  - **`stop()`:** cancels the timer.
  - **Tests:** both reviewer probes. 20 deltas after a failed first fetch lead to one retry, and the snapshot then carries all 20. 11 deltas while the server keeps failing send only one request per backoff step. Also covered: the delay sequence, `refresh()` and `stop()`.
  - D-49 is updated.
- **P2-R34 (list refetch rode an older request):** fixed in `apps/web/src/hooks/chatListQueries.ts`.
  - If a fetch of that list is already in flight (for example `fetchNextPage`), the event marks the list dirty, and one full refetch runs after that fetch settles. Bursts still coalesce.
  - The new test fails without the fix.
- **P2-R35 (CLI ref resolution):** fixed in `packages/cli-core/src/commands/chat.ts` and `refs/resolveRef.ts`.
  - **Names:** when `q=` has no exact (Unicode case-insensitive) match, the CLI pages through every chat and matches in JS, so `Über plan` resolves.
  - **Unmatched refs:** they say `No chat matches "x".` "No chats exist yet." now appears only when there are none.
  - **`#n`:** pages as far as it needs.
  - **`@active`:** sees every active chat.
  - **`@last`:** reads every chat, because "last created or updated" is not a server sort.
  - **Seed:** `agent-tests/helpers/api.ts` `findChatIdByName` has the same fallback.
  - **Tests:** a fake server whose search folds only ASCII.
- **P2-R36 (bulk failure UX):** fixed.
  - **Web** (`ChatsListPage.tsx`): after a partial failure the dialog closes and only the failed ids stay selected, so a retry sends just those; the toast shows "Failed to delete n of m chats" with the first reason. After a total failure the toast shows the error and the selection is kept. There is a new page test.
  - **Mobile** (`chats.tsx`): `removeMany` has an `onError` that uses the screen's existing error toast, and a partial failure keeps only the failed ids selected. Checked by typecheck only, because mobile has no screen test harness.
- **P2-R37 (install UX and state edges):** fixed.
  - A `failed` install after "Restart Now" shows an error dialog.
  - Help ▸ Check for Updates with an update already downloaded offers it again instead of checking, even with a subscribed renderer on screen. This is the way back after "Later", and it avoids re-feeding Squirrel.Mac on macOS.
  - `confirmDiscard` remembers a "nothing to lose" answer for the rest of the quit, so `quitApp` never asks a second time mid-install. `setQuitting(false)` forgets the answer, and so does a window closed without quitting (this was also a latent leak on macOS).
  - A minimised window no longer counts as visible for skipping the dialog.
  - On macOS an unrelated `error` no longer clears `awaitingNativeVersion`, so a later native `update-downloaded` still becomes `ready`.
  - Tests cover each edge.
- **P2-R38 (quit-flag leaks):** fixed.
  - Tray Quit and the vault prompt's Quit only call `app.quit()`. `quitApp` sets the flags once the quit is accepted. `markQuitting` is deleted.
  - A throwing `confirmDiscard` resets `quitApp`'s in-flight promise and tells a registered hand-off, so a later quit still works.
  - Tests are in `tray.test.ts` and `quit-coordinator.test.ts`.
- **P2-R39 (badge cleared by a navigation that never commits):** fixed.
  - `WindowManager.onRendererReset` now fires on `did-navigate`: a committed, cross-document, main-frame load. It no longer fires on `did-start-navigation`. This is the same rule `browser-host.ts` already uses.
  - The preload's `updates.onChange` unsubscribe is idempotent.
  - D-54 is updated.
- **P2-R42 (doc accuracy):**
  - `Browser::ExitWithCode` is replaced by `app.exit` → `Browser::Exit` → `DestroyAllWindows` → `Shutdown()` in D-54, 05, 06, `quit-coordinator.ts` and `updater.ts`.
  - "Runs the installer synchronously" is gone. The docs now say NSIS reports spawn failures asynchronously, and the code waits two event-loop turns for them.
  - "Squirrel rejecting the signature" is dropped from the install-failure list, because that can only happen before `ready`.
  - D-49 now says mobile *will* wrap `createAttentionStore`.
- **P2-R30 — activity sort not index-served:** fixed with a new migration **v56 `chat_list_activity_indexes`**, not another in-place edit of v55. The runner stores no checksum, so a DB that already ran v55 would never get an in-place change. COORDINATION.md records v56 as taken.
  - **Indexes:** `(parent_chat_id, last_activity_at, id)` and `(status, parent_chat_id, last_activity_at, id)`. `idx_chats_last_activity` becomes `(last_activity_at, id)` for the workers-included list.
  - **Cursor:** the predicate is a row value `(key, id) < (?, ?)`, so a cursor page is an index range.
  - **NULLs:**
    - Rows with a NULL activity time are backfilled from `created_at × 1000`.
    - Two triggers reject NULL writes; SQLite cannot add `NOT NULL` without rebuilding `chats`.
    - `schema.ts` declares the column `.notNull()`, and the `COALESCE` fallbacks are gone. A `{v:null}` cursor cannot occur.
  - **`EXPLAIN QUERY PLAN`** on a migrated 5,000-chat DB (about 20 % archived, 10 % workers), with the exact SQL `listPage` generates:
    - Before:
      - `SEARCH chats USING INDEX idx_chats_parent_chat_id (parent_chat_id=?) | USE TEMP B-TREE FOR ORDER BY` (no status, first page and cursor page).
      - `SEARCH chats USING INDEX idx_chats_status (status=?) | USE TEMP B-TREE FOR ORDER BY` (active/archived).
      - Workers included: `SCAN … idx_chats_last_activity | USE TEMP B-TREE FOR LAST TERM OF ORDER BY`.
    - After:
      - `SEARCH chats USING INDEX idx_chats_list_activity (parent_chat_id=?)`; the cursor page adds `AND (last_activity_at,id)<(?,?)`.
      - `SEARCH chats USING INDEX idx_chats_list_status_activity (status=? AND parent_chat_id=?)`; the cursor page adds the same range.
      - Workers included: `SCAN chats USING INDEX idx_chats_last_activity`.
    - No temp B-tree anywhere for the activity sort, and no `ANALYZE` involved.
    - Walking every page matched a plain `ORDER BY` exactly.
    - The created and name sorts are unchanged (they still use a temp B-tree, as before).
  - **Trade-off:** a project-filtered list now walks the status index in activity order, checking the project on each row.
  - **Tests** (`ChatListRepository.test.ts`): the v56 backfill, the index columns, NULL insert and update rejected, and plan assertions (no temp B-tree for status none/active/archived, first and cursor page, workers-included).
- **P2-R32 — worker consent lingered:** fixed in `AttentionService` only (`ComputerService`, owned by G-07, is untouched).
  - `computer.consent_resolved` now re-reads every feed item whose `ask.id` is the resolved request, whichever chat it is keyed on. The request's expiry timer is cancelled and does the same re-read.
  - A server test raises the consent from a worker and resolves it with `ComputerService`'s exact payload (no `chatId`). It fails without the fix.
- **P2-R33 — missed `chat.updated`:** fixed.
  - **`model`:** added to `LIST_VISIBLE_CHAT_FIELDS`.
  - **New core `ChatListInvalidator`**, wired in `composition-root.ts`:
    - **Agent rename or delete:** on `agent.updated` / `agent.deleted` it emits `chat.updated` for every chat bound to that agent. This uses the new `IChatRepository.getByAgentRef`, and archived chats are included.
    - **Project delete:** `deleteProject` collects the project's chats before the delete clears `project_id` (used by `DELETE /projects/:id?force=true`). It then announces each chat and calls the new `AttentionService.refreshProject`, so chat and workflow-run attention items drop the deleted project.
  - Server tests cover the model PATCH, the real project delete route (all 5 unlinked chats announced, the attention item loses its project), and agent rename/delete (only bound chats; an agent with no chats announces nothing).
- **P2-R40 — probe details:** fixed in `packages/client-runtime/src/connections.ts` and `apps/desktop/src/main/server-probe.ts`.
  - `redirect: 'manual'`: a 3xx is `unpaired`, never followed.
  - A timeout while reading the body, after the status line arrived, is `error`, not `unpaired`. Invalid JSON with no abort stays `unpaired`.
  - `probeServer` takes an injectable `fetch`, and desktop main passes Electron's `net.fetch` (system proxy and Chromium certificate policy). Its typings accept `redirect` and `signal`.
  - Tests are in both packages. D-54 is updated.
- **P2-R41 — duplicated bridge types:** fixed.
  - These are single-sourced in `packages/shared/src/types/DesktopShell.ts`: `WindowChrome`, `WindowStateChange`, `FindInPageResult`, `BrowserBounds`, `BrowserDevtoolsPanel`, `BrowserEmulationParams`, `NativeBrowserDescriptor`, `NativeBrowserEvent`, `BrowserPickResult`, `BrowserAnnotationSummary` and `BrowserAnnotatePollResult`. The last three replace inline return types the web had hand-copied.
  - `apps/desktop/src/shared/{ipc,browser-ipc}.ts` re-export them, and `apps/web/src/types/desktop-bridge.d.ts` references them. The local copies are deleted.
  - `WindowChrome.platform` is the three-OS `DesktopPlatform`. Main maps `process.platform` with `desktopPlatform()` in `platform.ts`, and any other Unix is laid out like Linux.
- **P2-R43 — `npm_execpath` trust:** fixed in `scripts/redesign/lib/spawn-node-bin.mjs`.
  - It is used only when it is a pnpm entry: the basename is `pnpm(.cjs|.mjs|.js)`, or a path segment is named `pnpm` (corepack's shim). The check is case-insensitive and handles both separators. npm's `npm-cli.js` and yarn's `yarn.js` fall back to bare `pnpm`.
  - The `shell: true` fallback passes one quoted command string with no args array (DEP0190).
  - Tests are in `spawn-node-bin.test.mjs`.
- **P2-R44 — smoke profile cleanup:** fixed.
  - `isolatedProfile()` (`agent-tests/helpers/desktop-profile.mjs`) handles SIGINT/SIGTERM: it closes an `attach()`ed app, cleans up, and exits with 128 + the signal number.
  - Cleanup is idempotent, retries `rmSync` (5 × 300 ms) and logs a final failure instead of swallowing it.
  - Every smoke that uses the helper (`desktop-smoke`, `desktop-security-smoke`, `desktop-chrome-smoke`, `packaged-app-smoke`, `desktop-pairing-diagnostic`) attaches the app after launch and closes it in `finally` before cleanup.
  - `sandbox.mjs --clean` also sweeps the profile prefixes from `os.tmpdir()`.
  - The smokes were `node --check`ed, not run (they need Electron).

### Verification

| Command | Result |
|---|---|
| `pnpm typecheck` | 49/49 green (42 run, 7 cached) |
| `pnpm turbo lint --force` (desktop, server, core, db, client-core, web, cli-core, client-runtime, shared, mobile) | 10/10 green, 0 errors |
| `pnpm --filter @generatorai/desktop test` | 27 files, 364 passed |
| `pnpm --filter @generatorai/server test` | 59 files, 593 passed |
| `pnpm --filter @generatorai/db test` | 139 passed, 4 skipped |
| `pnpm --filter @generatorai/core test` | 1878 passed, 9 skipped, **1 failed**: `PtyHostAdapter.test.ts` "a failed start is retried rather than cached forever" times out at 30 s. It fails the same way when run alone. The test and `PtyHost*` are untouched by this change, and nothing it imports changed at runtime. It passed in the subagent's run earlier in this session (1879 passed). The machine's load average was above 20 while this ran (other agents were building), and the test forks a missing entry and waits through a restart backoff (1+2+4+8… s), so it is timing-bound. Treated as environmental; recheck at batch end. |
| `pnpm --filter @generatorai/client-core test` | 22 files, 324 passed |
| `pnpm --filter @generatorai/cli-core test` | 36 files, 909 passed |
| `pnpm --filter @generatorai/client-runtime test` | 3 files, 49 passed |
| `pnpm --filter @generatorai/shared test` | 19 files, 392 passed |
| `pnpm --filter @generatorai/web test` | 83 files, 921 passed |
| `pnpm --filter @generatorai/mobile typecheck` | green |
| `pnpm exec vitest run --project node scripts/__tests__` | 4 files, 62 passed, both with the default `TMPDIR` and with a non-symlinked one |
| `pnpm --filter @generatorai/web check:design --strict` | OK |

No Electron, e2e, Storybook or real installer run (batch end). 07 R-10 stays open until the per-OS `mock-update-server` run, which now also checks that the server stopped before the installer ran and that the app came back.
