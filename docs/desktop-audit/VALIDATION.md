# Desktop audit validation record

Commands ran from the repository root unless stated otherwise. Logs are retained locally under `/tmp/gai-desktop-audit`; that directory also contains credentials and must not be shared wholesale. This record includes results, not private runtime state.

| Check | Result |
|---|---|
| Web Vitest suite, `pnpm --filter @generatorai/web exec vitest run --maxWorkers=2` | 67 files / 642 tests passed |
| Server Vitest suite, `caffeinate -i pnpm --filter @generatorai/server exec vitest run --maxWorkers=2` | 57 files / 554 tests passed after transport correction |
| Desktop Vitest suite | 14 files / 170 tests passed |
| Shared Vitest suite | 16 files / 322 tests passed |
| Client-core Vitest suite | 20 files / 293 tests passed |
| Codex provider suite | 1 file / 50 tests passed, including attachment delivery |
| Focused core suites: AgentResolver, AgentStagingService, StageExecutionService, WorkflowOrchestrator.uploads | 4 files / 35 tests passed |
| Widget browser regression | 1 test passed in installed Google Chrome |
| Atlas generated application | 19 node:test tests passed independently after brownfield work and again after review follow-up |
| Risk workflow generated project | 21 node:test tests passed independently |
| Typechecking | Web, server, desktop, core, provider passed; shared build passed |
| Production builds | Web and desktop passed |
| Bundle budget | Initial gzip 305.7 KB / budget 800 KB; largest lazy chunk 225.7 KB / budget 300 KB |
| Changed-file ESLint | 0 errors, 140 warnings for main changes; later review files 0 errors / 3 existing composition-root warnings |
| Security invariants | Passed all 8; existing ledger tolerates 14 known fail-open defaults; no app-wide CDP switch |
| Durability invariants | All 5 passed |
| `git diff --check` | Passed |
| Repository changes | HEAD remains `db714ce`; staged diff empty |
| Design gate | Initially failed at baseline; follow-up passes without changing budgets. See below |

The responsive extension browser regression is self-contained and serves the real bundled extension assets, with a test initialization message:

```sh
cd agent-tests
PLAYWRIGHT_CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' pnpm exec playwright test e2e/widget-designer-layout.spec.ts --reporter=list
```

This test verifies compact and wide layouts, usable preview width, no document horizontal overflow, keyboard version restore, Activity and Code/Preview. Actual Electron interaction with the live extension is separately captured in screenshots 109–110, 117 and 121–124.

The new regression coverage includes provider/reasoning schema parity, upload timing/path containment, picker retention, explicit stage skills, valid skill staging, completed answer replay, duplicate node positioning, responsive panes, Codex attachment references, widget origin/replay recovery, and stream liveness reconciliation.

The complete monorepo test matrix was not run. Provider/core coverage listed above is focused, not a claim of every test in those packages passing. Windows/Linux builds, release packaging and signed installers were not exercised. Initial environment-related failed attempts (missing bundled Playwright browser/ffmpeg, sleeping host, native-dialog harness failure) are not counted as passing product tests. A server test failed in an earlier unbounded parallel run; the complete suite passed with two workers.

## Final review and test-transport follow-up

The live review follow-up found feedback remaining submitted for an aliased repository. Submission now uses each repository's checkpoint, live workspace snapshots trigger reconciliation, and submitted feedback refreshes after asynchronous reconciliation. Three route tests passed (multi-repository anchors, failed delivery, preview). A second real agent review changed to **Addressed** automatically; screenshot 135 records the result. Web tests again passed 67 files / 642 tests, and web/server typechecking and the production web build passed.

Subsequent full server runs exposed intermittent HTTP failures (missing headers or unexpected 401) in different, unrelated route tests. An isolated Express/Supertest probe demonstrated that an IPv6 fixture listener could select the same port as another application's IPv4 listener; Supertest hardcoded its request to IPv4. The probe received a foreign 404, and listener inspection confirmed an editor process owned that IPv4 port. The test setup now sends requests to the fixture's address family, and three explicit WebSocket/SSE fixtures bind IPv4 loopback. Production auth/headers were not relaxed. Two address-family regressions were added. A separate WebSocket timeout occurred during a run after the audit sleep inhibitor stopped; the focused five-suite rerun passed 43 tests.

Final full server run: **57 files / 554 tests passed** in 42.74 seconds. Server typechecking also passed after the transport correction. Earlier failing run counts are retained in local logs rather than treated as passes. No test was skipped or assertion weakened to achieve a pass.

## Remaining-gaps follow-up validation

The latest pass added real desktop journeys for Undo/Rewind, two-editor conflicts, CSV export/import, keyboard review/deletion, pointer range regression, loop and scheduled batch automation, agent export, and plain prompt uploads. Failure screenshots are preserved; they are not counted as passes.

| Latest check | Result |
|---|---|
| Full web suite after upload/answer changes | 68 files / 643 tests passed |
| Final review/pane regressions after Escape ownership fix | 2 files / 8 tests passed |
| Codex protocol suites (`CodexProvider.test.ts`, `CodexProvider.coverage.test.ts`) | 2 files / 72 tests passed; dead/closed thread now rejects while preserving partial events |
| Core stage/run/upload suites, including timeout and durable replay | 5 files / 72 tests passed |
| Web, core and provider typechecks | Passed |
| Final production renderer build | Passed |
| Design-system gate | Passed; palette 299/314, buttons 42/44, inputs 40/40, spinners 5/6, native confirm 0/0 |
| Bundle budget | Initial 305.7 KB gzip / 800 KB; largest lazy chunk 225.7 KB / 300 KB |
| Follow-up changed-file lint | 0 errors / 38 warnings in the main follow-up set; final pane check 0 errors / 10 warnings |

The full web suite preceded the final Escape guard; its affected two component suites were rerun afterward. Unchanged server/desktop/shared suites retain the earlier results rather than being represented as fresh full-suite reruns. The first new provider regression used an incorrect event name and the first prompt-staging test passed variables in the wrong argument slot; these test-authoring errors were corrected, without weakening the behavioral assertions. An Electron capture stalled once and the isolated audit instance was restarted. Subsequent native captures succeeded. Large unbounded web/typecheck concurrency increased validation duration; no sustained application performance claim is based on that interval.

Provider failure propagation was verified with real JSON-RPC fixture processes and the stage failure contract. The live provider error exposed the original bug; after fixing it, live manual and scheduled campaigns succeeded. A deterministic live retry-exhaustion campaign was not performed. The old false-completion row remains in the audit database.

Final security gate: all 8 invariants passed (14 existing ledger entries remain); durability: all 5 passed. Final whitespace check passed; staged diff is empty and HEAD remains `db714ce`. The isolated audit instance is closed; the pre-existing user instance was not stopped by this audit.
