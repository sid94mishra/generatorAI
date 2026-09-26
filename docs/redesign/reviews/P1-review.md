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
