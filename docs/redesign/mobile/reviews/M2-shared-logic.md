# M2 shared-logic adoption

## Phase start / M2-01 packet (2026-09-29)

- Branch mobile_redesign; phase merge desktop_redesign remains 744f3a02, already up to date. Frozen pnpm install passed. Shared native token emitter retained.
- Mobile and desktop artifact URLs are inaccessible through the web tool; version cannot be compared. Continue snapshot 1790412505-d42b, non-blocking question for phase summary. Main.dark.png and Main.light.png inspected again, both platforms.
- Read MD-03/12/14/25, 07 M2-01, shared transcript types/derivation/grouping/turns/counters and mobile twins. MDF resolutions remain binding at presentation time.
- Existing mobile deriveTimeline is a combined prose/activity read model (931 lines); shared deriveTimeline is a step model (891 lines) and deriveSegments/turns carry prose ordering. Mobile has distinct compact group summaries and error previews. Preserve these presentation choices through an adapter while removing duplicate shared decisions; do not replace calls blindly or discard the 1,111-test safety net.
- M1 native acceptance and spikes remain explicitly pending in PENDING.md. No M2-01 completion claimed yet.

## M2-01 implementation (2026-09-29)

- Shared wire adapter / projected-message overloads committed separately at c4130e5f, logged in COORDINATION. Core typecheck/lint and 34 files / 739 tests pass.
- Deleted the mobile persisted-message parser. Chat and workflow-stage replay now use shared chronological block construction. Shared turn grouping handles history; shared live counters enter the primitive chat selector.
- Retired `deriveTimeline.ts` and its name. `compactTimeline.ts` is a presentation adapter: shared status, nesting, images and group totals; local phone row order, short targets/error previews, collapsible work summaries and stable row identities. No layout or selector rename. M6 replaces the legacy presentation tree.
- Related mobile logic: five files / 73 tests pass, including nested live counters and cache prefix isolation. Token generation passes. Design-token tests: 533 pass, one pre-existing fixed-meter density assertion fails (MV-12); token sources unchanged.
- Native walkthrough/Maestro acceptance remains MV-11 while the M1-06 iOS rebuild runs; Android rebuild follows sequentially. This is implementation progress, not a completed phase or green batch.

## M2-02 packet

- Boards: MFoundations dark/light inspected again (both platform columns); MComponents status-badge reference. MD-25/64, MDF status rules; shared eight-state map overrides board wording.
- Route/data: existing run/stage, background task, plan/review, automation and SCM status renderers. No new endpoints or fake state.
- Replace local domain-status tone maps with shared `resolveStatus`/`STATUS_STATE_DEFS`; keep only a legacy token-name presentation bridge until M3/M4. Worktree metadata is neutral per MD-25. The MP-07 native badge kit belongs to M4-03.
- Preserve action/polling predicates; those are behavior rather than visual tone maps. Update tests where old tone assertions conflict with MD-25. Native coverage remains explicitly pending if rebuilds are unavailable.

## M2-02 checkpoint (2026-09-29)

- Removed duplicated domain-tone tables from run/stage, work/project rows, automation, plan/review, background tasks, SCM steps/results, CI checks, codebase health and file-change renderers. Shared eight-state/health/change definitions drive a small legacy token-name bridge. Worktree metadata is neutral (MD-25). Normal transcript rows no longer acquire a state-tinted card frame.
- Added the React-free transcript-step mapping separately: waiting here is a human gate, unlike a workflow timer. Shared helper typecheck and 43 related tests pass.
- Mobile typecheck, lint/design ratchet and 11 related files / 135 tests pass. Assertions updated only where the old colors/copy contradict the shared decision (paused neutral, partial failed, queued automation).
- Acceptance remains open: MV-13 records PR lifecycle/mergeability and transport-specific status descriptions without shared counterparts, remaining legacy host tints, and native status verification. Continue independent composer adoption under MD-107; do not call M2-02 fully complete.
- iOS native rebuild succeeded; installation/launch now in progress. Android native build remains next, sequentially.

## M2-03 packet

- MComposerInput dark/light inspected, both phones; MD-03 and shared composer contract. Current layout/testIDs remain stable until M6-04; no new kit component.
- Adopt shared builtin/skill/prompt factories and fuzzy matcher; keep native catalog presentation and existing pane navigation. Delete slashSource twin filename.
- Use composerReducer and selectors for draft/send transitions and the existing native two-phase stop binding. Preserve editable gate drafts and Cancel-and-send's server-authoritative retry behavior.
- Verification: related composer/catalog/stop tests, typecheck, lint/ratchet; native paired chat/gate/stop after client rebuild. M1 Force reset fixture gap stays MV-04 unless actually exercised.

## M2-03 implementation checkpoint

- Shared factories now own builtin, skill, computer-use and prompt formatting. Native catalog adds labels/pane routing; canonical fuzzyMatch selects slash/agent entries. Deleted slashSource.ts; composerCatalog.ts is the smaller presentation adapter.
- Native controller uses composerReducer draft/send transactions and selectCanSend, while preserving attachment upload, dictation, and text entered during a failed request. Composer uses shared content/send eligibility; gates and workspace preparation block Send but do not remove the draft.
- Native stop hook now drives composerReducer with backend observations, stop presses and clock ticks; shared selectors supply its view. No local timeout policy. Cancel-and-send keeps its existing server-authoritative retry path.
- Typecheck and lint/design ratchet pass. Catalog related tests: 13 pass. Full logic run: 1,116 passed / one dynamic-import timeout under native simulator load; the affected toolPresentation file reruns 21/21 green with one worker and unchanged timeout/assertions. Single combined green run remains pending for final/batch acceptance.
- iOS client successfully built, installed, fingerprint recorded, launched. Driver's first dev-server press hit its accessibility watchdog; a fresh snapshot/retry succeeded. Product/Storybook walkthroughs continue. MV-14 holds native composer and full-suite acceptance, including the pre-existing Force reset fixture gap.

## M2-04 packet and SCM contract checkpoint

- MPaneChanges dark/light viewed, both platforms. MD-12/14 and existing server source-control contracts; no presentation changes.
- Add shared typed methods/query keys, remove mobile endpoint twins, retain the authenticated transport. Native request helpers and remaining projects/review/capture endpoints follow.
- First shared addition: `createApiClient().scm`, including the server-held GitHub device-code login. Ten migrated contracts plus device-login contract pass; full client-core 36 files / 751 tests pass, typecheck and lint pass (existing warnings). Mobile adoption and zero-path acceptance are not yet complete.

SCM native adoption: deleted the 180-line mobile endpoint table and its moved contract tests. All SCM screens/invalidation now use shared keys and `useApi().scm`; GitHub sign-in uses its shared device-login methods and ApiError. Typecheck, lint, design ratchet and 18 related mobile tests pass. iOS startup fixed; live flow retest continues. Remaining M2-04 API families are still in progress.

M2-04 review/project shared contracts: added scoped review queries/comment edit/delete, plan detail/revisions/comments/save, worker digest, manual checkpoint, and codebase-scoped worktree cleanup/removal. Shared project invalidation keys and optional wire fields replace local declarations. Existing methods unchanged; review delivery target is an additive optional field. Typecheck, 758 core tests and lint pass (six pre-existing warnings). Thirty-eight related mobile tests pass on initial adoption; mobile final lint/typecheck follows. iOS startup is repaired but Maestro launcher entry remains MV-15, and Android native rebuild is next sequentially.

Review/project mobile adoption passed lint/design ratchet and 38 related tests. The in-flight typecheck later reported a case-insensitive module-name collision and missing config-content typing; correction and a completed typecheck are required before acceptance. Deleted the project endpoint table; a small presentation adapter composes existing admin methods. Review/changes modules now contain hooks only. Shared types replace local duplicate request declarations. Pending iOS launcher acceptance is MV-15; Android rebuild has started.

M2-04 native-resource contracts: shared caller-built multipart methods retain RN URI files and transport boundaries; binary requests retain bytes/content type and server error status. Device revoke reasons/rotation, push registration/mute, config-content and resource path contracts are tested. Core typecheck and 40 files / 768 tests pass; lint passes after replacing inline import types (six existing warnings). Mobile typecheck completed successfully after repairing the case collision (`projectEditorApi.ts`), config-content typing, browser mutation promise typing and invite method names. Full mobile lint/tests are still running; no native acceptance claimed.

M2-04 mobile native/resource adoption checkpoint: multipart uploads now use shared client methods without altering URI-backed form fields or native temporary-file cleanup. Terminal replay, browser capture/screencast, computer frames/activity, push registration/actions, device administration and audio settings use typed shared APIs. Deleted HTTP/device request twins. Step-up gates and permission/error outcomes remain in place; browser/capture errors keep the prior one-line 160-character presentation. Repaired the case-insensitive project adapter filename collision. Source audit finds no executable endpoint literals outside transport; test expectations and comments remain, so the broad plan grep is not claimed green. Mobile typecheck passes; full lint/tests remain in flight under the Android build. MV-16 retains final/static/native acceptance under MD-107.


## M2-05 packet and implementation checkpoint (2026-09-29)

- Boards: MAutomationDetail and MScriptDetail dark/light inspected (both platform columns), plus MSettings dark/light. This is the SDK 57 behavior-preserving data-layer step, not a screen port. MD-14/107; no kit changes or board sample data.
- Feature queries now own all route requests/mutations, keys, polling, cache updates and optimistic rollback for chats, chat, projects, agents, workflows, automations, scripts, settings, home, devices and search. Route callbacks keep navigation, native consent/step-up, haptics, toasts and local presentation state. Extracted pure models with their existing tests and deleted replaced legacy files. The services activity hook moved into Home, removing its legacy status dependency.
- Preserved chat decision stream effects, stale-409 refresh, Cancel-and-send refresh, automation history on toggle, audio/MCP rollback, partial bulk-delete outcomes, explicit provider re-probe, clone polling and device scope refresh. Search keeps its existing cache behavior pending M5 server search.
- Verified the stronger source scan: no `useQuery`, `useQueries`, `useMutation`, `queryFn:` or `mutationFn:` in app/. The root QueryClientProvider remains in shell until its planned lifecycle work.
- Final mobile typecheck and lint/design ratchet pass (193 legacy files remain ratcheted, new layers zero). Full Vitest: 106 files / 1,099 tests pass. No new UI/blocks were created, so no new component tests required. Native acceptance remains MV-17, not passed.
- Build contention diagnosis: ten concurrent Android C++ jobs on the 8 GB host caused ~8 GB swap. Temporarily paused only this task's Gradle subtree, completed static/test checks, then resumed it. Do not overlap further full test runs with native compilation on this host. M2-06 is next.

## M2-06 — landed read models (2026-09-29)

Task packet: MHome, MChats, MModelPicker, MPaneComputer dark/light boards inspected for both platforms; MD-14/25/27/84. Reuse legacy presentation during SDK 57 characterization; no new kit surface. Acceptance: consume server read models rather than derive them from loaded subsets.

- One `createAttentionStore`/`useSyncExternalStore` binding drives Home, chat live state and project decisions. Removed per-chat gate probing and local urgency ranking. Distinct ask keys keep separate requests on one chat actionable; entity IDs address the correct API.
- Chat list uses shared keys, page merge/live selectors, keyset pagination and server search. Project lists/details request summaries; project runs page directly from the project endpoint, and project decisions use the full attention snapshot.
- Home consumes recent activity and ISO-local-week stats; the M7 port will render the designed weekly strip. Diagnostics uses system uptime. Model picker adopts ready-provider/default/model catalog; computer consent uses shared pending/option policy.
- Removed replaced probe/rank/project-join/needs-attention derivations and their obsolete tests. Added feed/action tests and local Monday/year-boundary coverage. Server action availability controls Allow/Deny, Stop and Retry.
- Verified: mobile typecheck, lint/design ratchet (193 legacy files, new layers zero), 108 Vitest files / 1,091 tests. `.expo/m2-06-final-*.log`; shell chain exited 0. No shared changes.
- Android native rebuild exited 0, installed, fingerprint `562528b8a7a20dbed69bb7ac182c680c9d68181b`. Reboot recovered System UI ANR; JS starts but product screen remains blank. Native acceptance pending MV-18 (iOS MV-15). No M2 phase closure or visual redesign claim. Continue M2-07 under MD-107.
