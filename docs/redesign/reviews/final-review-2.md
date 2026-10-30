# Final review 2 of all web/desktop phases (2026-10-03)

Second full review across P0–P7 (owner rule: one review → one fix pass → one end-to-end verification), focused on what
changed since the first one (`final-review.md`, 2026-10-01, commit `2b6d3688`): nine merges of `mobile_redesign`
(M0 … M8) into `desktop_redesign`, up to `b9abae02`. Base for this review: `b9abae02`.

## Method

- **Diff audit** of everything the merges changed outside `apps/mobile/**` and `docs/redesign/mobile/**`
  (173 files, +8.4k/−0.5k): approval proofs (`packages/shared/src/security/*`, `packages/auth/src/approvalProof.ts`,
  `apps/server/src/middleware/approvalProof.ts`, chat + workflow-run gate routes), gate risk (MG-04) and the web
  PermissionCard badge, chat pin/unread (v64/v65), push payload v2 (`packages/core/src/services/push/*`), M7-09 routes
  (devices/me, approval key, remote refs, agent import preview, SCM outcomes, `sttLanguage`, artifacts), client-core
  additions (`transcript/wireMessage`, `attention/route`, chat row model), `ui-contract` (`deepLinks`, `scopes`, run
  pane), design-tokens mobile additions (`vocabulary-mobile`, uniwind emitter, `MOBILE_ICON_CONCEPTS`, motion, haptics).
- Only **one** web file changed in the merges (`blocks/transcript/gates/PermissionCard.tsx`, +5); no desktop file.
  So the question was mostly: does web/desktop still behave per the plan on top of the changed shared/server code?
- Plan parity re-check against `07-phases.md`, `01-decisions.md`, the previous review's fixes, and the parked list.
- Board comparison of the screens touched by the fixes (ChatsList, Home, SettingsSecurity) and running-app walkthroughs
  on an isolated seeded sandbox (:3397/:5397, temp DB asserted by the sandbox).

## Verdict

No regression from the merges breaks a web/desktop gate: typecheck, lint, check:design, web unit (1558), story tests,
build, check:bundle, check:css, check:tokens and the design-tokens suite all pass on the merged tree, web CSS/token
output is unchanged (only `vocabulary-mobile.css` was added), and nothing in `apps/web` or `apps/desktop` imports
mobile-only code (`MOBILE_ICON_CONCEPTS`, `vocabulary-mobile`, uniwind, haptics, glass, native palette). Desktop and web
approvals stay a click: `checkApprovalProof` only binds a `paired-device` principal whose device platform is `mobile`.
Every item fixed in the first review is still in place (no web code changed since).

The findings are **behavioural gaps where shared server state reached web without the web following it** (pin order,
read marks, risk verdict on reload and on Home, the shared scope vocabulary, SCM outcomes) and one **real bug in core**
that explains the parked desktop diff-review failure.

## Findings

Severity: **M** fix now (visible defect / plan gap) · **S** fix now (small) · **L** low (hygiene) · **D** decided, no
change · **O** open, outside this pass.

| # | Sev | Area | Finding (evidence) | Resolution |
|---|---|---|---|---|
| 1 | M | Checkpoints (core) | A turn's `after` checkpoint was skipped whenever a tool call had already scheduled a `live` snapshot of the same tree: durable captures compared against the latest snapshot of **any** kind (`packages/checkpoints/src/CheckpointService.ts` `findLatest` in `cleanAtPrevious` / `createUnlocked`; live snapshots from `ChatManagementService.ts:2164`). Faux emits no tool events, so only real providers lost the turn's closing boundary — the root cause of final-review #19 (desktop-diff-review 9/10 with Copilot) and of "what did this turn do?" being empty with real providers | **Fixed** `8ff397a8`: durable kinds compare with the latest durable snapshot (`previousFor`, `CheckpointService.ts:99`); new real-git test fails without the fix; diff-review smoke now 10/10 with a real provider |
| 2 | M | Chats list (web/desktop) | Since MG-02 `GET /chats` puts pinned chats first for every client (`packages/db/src/repositories/ChatRepository.ts:329`). A chat pinned on the phone jumped to the top of the desktop list (even under Sort: Name) with no indicator and no way to unpin; reading a chat on desktop never set the read mark, so the phone kept its unread dot | **Fixed** `1b0ae5e3` (D-83): pin glyph + unread dot in the chats table (ChatsList, ProjectDetail Chats tab), Pin/Unpin and Mark as read/unread in the row menu, `useMarkChatRead` on open and on leaving; `StatusDot` `accent` tone (story) |
| 3 | S | Gate risk | The web replay path dropped the MG-04 verdict (`apps/web/src/utils/replayEvents.ts:725`), and settled persisted cards too (`packages/client-core/src/transcript/chatMessageToBlocks.ts:160`): after a reload a pending risky gate lost its "Risky" badge | **Fixed** `90ca1db9` (+ client-core test) |
| 4 | S | Home | The Needs-you row offers an inline **Allow once** but did not show the verdict the gate card shows (`gateRisk.ts`: every client renders it) | **Fixed** `90ca1db9`: neutral "Risky" badge before Open / Allow once (`HomeSections.tsx:76`); verified in the app with a risky feed |
| 5 | S | Settings › Security | Private scope vocabulary diverged from the shared MG-23 one: most scopes rendered as raw ids, and only `exec:terminal`/`admin:devices` were confirmed while the server treats `exec:browser` and every `admin:*` as high-risk (`HIGH_RISK_SCOPES`) | **Fixed** `0f3b675d`: `scopeLabel`, `describeScope`, `isSensitiveScope` and the companion/standalone preset scopes from `@generatorai/shared/ui-contract`; web keeps its board-drawn presets (D-83) |
| 6 | S | Home · Recently finished | MG-13 now records a workspace's commit / PR, but rows still read "on <branch>" (the board draws "PR #1176 opened", "committed to docs/release-2.4") | **Fixed** `991bdc16` (`scmOutcome`, `HomeSections.tsx:154`) |
| 7 | S | Stories | No story covered the Risky permission badge (`blocks/transcript`) | **Fixed** `708805a5`: TurnBody `EveryBlockKind` uses a risky `git push` gate, play asserts the badge |
| 8 | L | Desktop deep links | `generatorai://chats/%2e%2e/settings` passed the dot-segment check (encoded) (`apps/desktop/src/main/deep-link-route.ts:73`) | **Fixed** `0014a39a` (+ tests) |
| 9 | L | Home retry | Retry of a failed chat resent the text only (final-review #21, first half) | **Fixed** `37b31a98`: attachments are fetched back and sent with the prompt |
| 10 | L | Docs site | 66 cited `apps/web/src/{components,pages}` paths no longer exist (final-review #22) | **Fixed** `bd2a27d0`: every citation remapped to `ui/`, `blocks/`, `features/`, `app/` |
| 11 | L | Repo hygiene | Three pre-redesign desktop smoke screenshots tracked at `agent-tests/*.png` (the smoke writes to `test-results/`) | **Fixed** `667792c8` |
| 12 | D | Dictation language (MG-17) | Server stores `sttLanguage`; web Settings › Audio has no picker | Keep: the only engine reports `languages: []` (auto-detect only) — nothing to pick (D-36, D-83) |
| 13 | D | Deep links | `ui-contract` gained `deepLinkToRoute`; desktop keeps its own parser | Keep: pairing targets differ (`/?pair=` on web/desktop, `/pair` on mobile); desktop parser hardened (#8) (D-83) |
| 14 | D | Settings › Security layout | Still one column against the board's two | Keep (first review #16) |
| 15 | L | Root `AGENTS.md` | Came in with the M-merges and describes the `mobile_redesign` branch ("Never commit to `desktop_redesign`") — wrong for a Codex session opened on `desktop_redesign` | **Open, owner/mobile**: it is the mobile session's rulebook and returns on every merge; making it branch-neutral should happen on `mobile_redesign` |
| 16 | O | Changes / G-17 | Chat-workspace mounts write no `worktrees` rows (final-review #21, second half) | Open: server follow-up, not a web defect |
| 17 | O | Tests | `projects.spec` "Create is gated on a name…" failed once inside the full e2e run under load and passes alone (5/5) — same class as the parked load-sensitive tests | Open (parked) |

Not findings, checked: push v2 / notification policy (mobile-only consumers; desktop has no push), `GET /chats/:id`
`summary.model`, `/artifacts` route policy (`read:files`; local web principal unaffected), sandbox port options, the
root ESLint config importing `apps/mobile/scripts/eslint-config.mjs` (every block is scoped to `apps/mobile/**`; web
lint unchanged), `design-tokens` index now re-exporting mobile modules (tree-shaken; `check:bundle` budgets hold).

**Note for the mobile session:** fix #3 touches `packages/client-core/src/transcript/chatMessageToBlocks.ts`
additively (a persisted permission card keeps `risk`), and #1 changes `packages/checkpoints` behaviour (a turn's
`after` checkpoint is now recorded with real providers). Both arrive with the next `desktop_redesign` merge.

## Fix pass (2026-10-03)

Commits on `desktop_redesign`: `8ff397a8`, `90ca1db9`, `1b0ae5e3`, `0f3b675d`, `0014a39a`, `37b31a98`, `667792c8`,
`bd2a27d0`, `708805a5`, `991bdc16`. New decision **D-83** (shared mobile state on web and desktop). Selectors: no id,
role or accessible name changed; new accessible names only (`img "Pinned"`, `img "Unread"`, menu items "Pin"/"Unpin",
"Mark as read"/"Mark as unread", text "Risky").

## End-to-end verification (macOS, 2026-10-03)

| Gate | Result |
|---|---|
| `pnpm --filter @generatorai/web typecheck` | pass (before and after the fixes) |
| `pnpm --filter @generatorai/web lint` | 0 errors (75 pre-existing warnings, none in touched files) |
| `check:design` | OK (ratchet locked at 0, every kit component has a story) |
| web unit (`--project unit`, full) | 126 files, **1558/1558** |
| related unit tests for touched files | 58 files, 741/741 |
| story tests (StatusDot, TurnBody × 3 appearance projects) | pass |
| client-core / shared / desktop unit | 788 / 447 / 445 pass |
| checkpoints (real git) + core/server checkpoint suites | 20 + 7 + 38 pass |
| `check:tokens`, design-tokens tests | pass, 804/804 |
| web build, `check:bundle`, `check:css` | pass (initial CSS gzip 28.0 KB, fonts 94.6 KB) |
| e2e (`agent-tests/e2e`, isolated seeded sandbox :3397/:5397, `--workers=1`) | **83 passed, 4 skipped, 1 load flake** (finding #17; passes alone 5/5) |
| desktop smokes (macOS, one at a time, isolated profiles) | chrome 59/59 · right-pane 9/9 · terminal 8/8 · browser all · dock-browser all · **diff-review 10/10** (real provider; was 9/10) |
| walkthrough (Chrome, sandbox) | Chats 1440×900 Instrument dark/light, Solarized light, 1100×760 dark/light; row menu; chat open clears unread (server confirms); Home with a risky feed; Settings › Security; console 0 errors |
| board comparison | `shots/review-2/DIFF.md` (ChatsList, Home, SettingsSecurity) |
| VRT (step 10) | not run: no Docker on this machine (D-53); baselines remain P1-R7 |

## Parked items — state on 2026-10-03

| Item | State |
|---|---|
| P1-R7 / P3-08 VRT baselines | Still parked: owner decision + Docker or the CI `vrt` artifact. Nothing changed |
| Windows / Linux desktop smokes | Still CI-only; the branch is not pushed, so the CI matrix has not run. Unblocked as soon as the owner pushes |
| Desktop diff-review checkpoint with real Copilot (#19) | **Resolved**: root cause found by reading the code (finding #1), fixed, smoke 10/10 with a real provider |
| Load-sensitive tests | Still parked; one more instance seen (#17) |
| Docs-site source paths (#22) | **Resolved** (#10). `reference:generate` already reads `ui-contract/settings.ts` |
| Home retry without attachments (#21a) | **Resolved** (#9); #21b (worktrees rows for chat mounts) open |
| P8 deferred platform | Not started. **P8-01 (Vite 8) is now unblocked**: Vite 8.3.2, `@tailwindcss/vite` 4.3.3, Storybook 10.6.1 and Vitest 4.1.11 all accept `vite ^8` (`@vitejs/plugin-react` 6.x requires it). P8-02 (React Compiler) has no external blocker. P8-03 (TypeScript 7) stays blocked: 7.0.2 is out, 7.1 is not, and typescript-eslint 8.71 supports `typescript <6.1` |

## Addendum — open items closed and P8 (2026-10-03)

| Item | Commit | Result |
|---|---|---|
| #16 / #21b chat-workspace mounts write no `worktrees` rows | `098fd2f1` | `MountService` records every ready worktree mount of a project codebase in `worktrees` under the mount's id (chat → `manual`/chat id, run → `workflow`/run id, map items → their run); removing/releasing the mount or deleting the workspace drops the row, and removing the row (Remove, Clean up orphans, the retention sweep) releases the mount (branch kept). Manual removal of an active worktree is refused (409) and hidden on web as on mobile; the retention clock starts when the worktree is orphaned, a restored chat's worktree returns to active. No migration (shared key). **D-84.** Real-git test (6 cases) + cleanup tests; sandbox check: a chat with a worktree source lists under its codebase with `link.entity: 'chat'`, size 701 KB, no Remove; `DELETE` → 409 |
| #17 + parked load-sensitive tests | `4716a535` | Reproduced by running the web, core and server suites concurrently (load 50–70 on 8 cores, swap in use). Fixed at the cause: faked clock for the sidebar elapsed time, caret wait in the restored-draft test, act-drained sends instead of 102 polls, fake timers for the HostSupervisor SIGTERM grace, stubbed pty-host boot for the adapter retry tests, fresh mocks per test in `chatSourceControlRoutes` (a timed-out test's late request had become the next test's assertion), a never-settling probe instead of a 500 ms stopwatch in `harnessProvidersNonBlocking`, one test per tab/mount in `AgentStageInspector`/ChatPage paging, cli `tui-e2e` cursor test skipped without a live server, `projects.spec` create waits on the `POST /api/projects` response. Budgets only where the work is CPU-bound and nothing is timed: web unit hang budget 20 s, real-git `chatList` 30 s, the 51-send cap 60 s. Evidence: affected files 5× alone and 3× next to a concurrently running suite all green; the create spec 4× under 8 busy threads. What remains is starvation, not nondeterminism: with three suites at once and the machine swapping, a different handful of heavy characterization tests still exceed their budget (always "timed out", never an assertion); the real-process `PtyHostAdapter` tests depend on node+tsx boot time; `VoiceWorkerPool` "recycles the worker" needs the network (Hugging Face 404s) |
| Sandbox `--clean` | `a92ed835` | Found while cleaning up: `--clean` deleted every sandbox temp dir, including other sessions' running sandboxes. Each sandbox now writes its pid; a live one is kept |
| P8-01 Vite 8 | `0a39b523` | Vite 8.3.2 (Rolldown) for web, Storybook builder and every package's Vitest (root override); `@vitejs/plugin-react` 6.1.1, Storybook 10.6.1; Vitest 4.1.11 and `@tailwindcss/vite` 4.3.3 kept (both accept `^8`). `rolldownOptions` + a `codeSplitting` group (same chunk function), `import.meta.dirname`. Budgets green without changes: initial gzip 427.8 → 458.7 KB (Rolldown keeps 54 shared chunks as modulepreloads instead of folding them into the entry), fonts 94.6 KB, initial CSS 28.0 → 28.2 KB. Lightning CSS warns about `::highlight()` (rules emitted unchanged). Hoisting shift recorded in COORDINATION.md (metro/hermes-parser/jest-worker/source-map; zod/esbuild unchanged). Mobile Vitest 1112/1112 on Vite 8 (read-only run) |
| P8-02 React Compiler | `78ec9dcd` | Compiler 1.0 (Babel) in dev, production, Storybook and the web unit project; `'use no memo'` in TranscriptView and DataTable (useVirtualizer); 144 functions skipped by the compiler, none excluded by config. **D-85.** xyflow canvases (production build, 24 stages, component renders, 3 stable runs): builder pan 3,982 → 199, node drag 5,211 → 1,066, zoom 3,069 → 536, select 5 nodes 1,576 → 1,085; run graph open 1,074 → 758, pan 900 → 409; script time pan 63–70 → 20 ms, drag ~103 → ~64 ms. Cost: build ~3 → ~21 s, initial gzip +39.6 KB (498.3 KB of 800) |
| P8-03 TypeScript 7 | — | Still blocked: `typescript` latest 7.0.2 (no 7.1), `typescript-eslint` 8.71 peer `>=4.8.4 <6.1.0` |

### Verification after all four (macOS)

| Gate | Result |
|---|---|
| typecheck (web, core, db, server, sdk, cli) | pass |
| lint (web) | 0 errors (75 pre-existing warnings) |
| `check:design`, `check:tokens` | OK |
| web unit (compiled components) | 126 files, **1564/1564** |
| core / server / db / client-core / shared / desktop / design-tokens / sdk / cli | 1794 / 696 / 169 / 788 / 447 / 445 / 804 / 8 / 323 (9 skipped) |
| web build, `check:bundle`, `check:css` | pass (initial gzip 498.3 KB, fonts 94.6 KB) |
| Storybook story tests, 3 appearances + axe, cold optimizer cache | **1731/1731** (no "Failed to import" on the first run after the dependency change) |
| `build-storybook` | pass |
| e2e (`agent-tests/e2e`, fresh isolated sandbox :3397/:5397, Vite 8 dev + compiler, `--workers=1`) | **84 passed, 4 skipped, 0 flaky** |
| desktop smokes (macOS, one at a time, isolated profiles) | chrome 59/59 · right-pane 9/9 · terminal 8/8 · browser 11/11 · dock-browser 23/23 · diff-review 10/10 (real provider; diff viewer workers OK in the Rolldown bundle) |
| VRT | not run: no Docker (D-53) |
