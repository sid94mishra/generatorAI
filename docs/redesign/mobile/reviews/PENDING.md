# Open implementation and verification items

Owner-authorized continuation: MD-107 (2026-09-29). These items remain required for end-to-end acceptance. A task proceeding does not resolve them.

| ID | Status | Evidence / issue | Next repair or retest |
|---|---|---|---|
| MV-01 | pending | Android terminal attaches, shell output reaches xterm DOM, but viewport is blank and Maestro text does not reach shell. Sandbox Origin/profile issues fixed. `M1-characterization.md`; local `characterization/android-terminal-blank.png`. | M4 sheet host / M6 terminal, then final live suite. Check modal GPU compositing and actual native keyboard input separately. |
| MV-02 | pending | iOS workbench Terminal leaves a short sheet strip; New terminal absent. `M1-characterization.md`; local `characterization/ios-terminal-entry-failed.png`. | M4 sheets / M5 pane / M6 terminal. Inspect native modal lifecycle and detent geometry. |
| MV-03 | pending | iOS notification delivered and permission granted; three native tap strategies fail to leave Notification Center. Routing is unproven, not established broken. Android action passes. Local `characterization/ios-notification-open-failed.png`. | M9 notification routing and final live suite. Retain `e2e/net2.mjs` until replacement verified. |
| MV-04 | pending | Force reset branch not exercised: Faux acknowledges normal cancellation. | M2 composer and M6; add a controlled non-acknowledging fixture if supported. |
| MV-05 | pending | Full combined native suite not green (Android 7/8, iOS 6/8 individually); baseline legacy accessibility defects remain. | Every relevant screen port and batch/final acceptance. |
| MV-06 | pending external prerequisite | SDK 58 stable and Android API 37 availability must be checked at platform upgrade; installed baseline is SDK 57 / Android API 36 fallback. | M3. Follow plan fallback, keep native SDK-dependent tasks pending when unavailable. |

| MV-07 | pending | M1-06 Storybook route, native rebuilds and two-platform story walkthrough/flow. Six Jest tests and static checks pass; iOS rebuilt, installed and fingerprint recorded; Home renders after Metro fixes. Android rebuild running. Fonts/text-scale integration waits M3 foundations. | Finish native rebuilds and Storybook flow; include M3 font readiness before kit VRT. |

| MV-08 | pending | M1-07 native markdown spike: 2,000-line fps and selection/copy not measured. Current renderer retained pending positive adoption evidence. | Complete with native harness, before M6-02. See M1-markdown-spike.md. |
| MV-09 | pending | M1-08 Gate A unpublished (>1.12.0), Gate B twelve checks not run. SDK 58 stable and NativeWind 5 stable unavailable. | SDK 58 preview scratch spike before M3 engine adoption; recheck releases. See M1-uniwind-spike.md. |

| MV-10 | pending | M1-09 service migration native smoke on both platforms; 1,111 pure tests and six Jest tests pass. | Run paired chat/approval/theme flows after MV-07 native rebuilds; then M2 regression checks. |

| MV-11 | pending | M2-01 native transcript/turn regression walkthrough and paired Maestro flows. Shared model and compact adapter implemented; iOS rebuild complete, Android rebuilding; iOS automated launcher entry remains MV-15. | Paired chat/approval/stop flows after the native clients finish; preserve M1 failures separately. |
| MV-12 | pending | Existing design-tokens density assertion fails for fixed-height `meter`: 533/534 tests pass; generated-token check passes. No token source was changed in M2. | Reconcile the fixed-height token/test expectation during M3-03; retain desktop values. |

| MV-13 | pending | M2-02 replaced run/stage, automation, background-task, plan/review, SCM-step/result, CI-check, codebase-health and file-change maps; shared bridge tests pass. PR lifecycle/mergeability and transport-specific descriptions lack matching shared domain adapters; several legacy card/icon tints remain. Native status walkthrough also pending. | Finish those adapters/presentation replacements with M5 connection UI and M6/M7 SCM/transcript ports; M2-02 acceptance stays open until a source scan and native checks pass. |

| MV-14 | pending | M2-03 composer native send/gate/stop on both platforms and single combined test run. Catalog tests pass; full 1,117-test run had one dynamic-import timeout, affected file reran 21/21 green unchanged. | Run native flows with rebuilt clients, then full tests without simulator/build contention. Force reset remains MV-04 until a non-acknowledging fixture is exercised. |

## 2026-09-29 continuation triage

Rechecked native host code: the legacy Sheet uses an animated RN Modal; WorkbenchSheet retains heavy panes in parked absolute-fill views. The Android software-modal/GPU hypothesis and iOS animation/lifecycle hypothesis are not proven fixes. Earlier targeted repair attempts restored sandbox terminal attachment but not usable rendering, and three notification-opening retries failed. Preserve these findings for the planned host replacements instead of marking the characterization green. Sandbox and Metro are healthy; 21 GiB free. Continue M1-05.

| MV-15 | pending | iOS Maestro launcher detection after the M1-06 rebuild: both Development Build and recent-server conditional selectors skip, then Menu/Back assertion fails. Runtime startup recovered after IPv4/pretty-format fixes and Home observed, but automated product entry remains unproven. Failed selector experiment reverted. | Revisit native launcher hierarchy/driver with M3 tooling; do not count M2 chat flow as passed. `.expo/m2-03-ios-{stream-retest,launch-retest}.log`. Continue independent implementation under MD-107. |

| MV-16 | pending | M2-04 native walkthroughs of migrated SCM/review/project, binary captures/uploads, devices/settings and terminal APIs. Shared typecheck/lint and 768 tests pass; mobile typecheck/lint/design and 1,099 tests pass. Production executable endpoint literals eliminated; strict acceptance grep still matches test fixtures and documentation comments. | Complete paired native walkthroughs and final suite. Keep transport and endpoint fixture contracts intact; no zero-match claim for the broad text grep. |

| MV-17 | pending | M2-05 queries extracted to feature hooks, including Home and Search; route audit finds no useQuery/useQueries/useMutation or queryFn/mutationFn. Typecheck, lint/design ratchet and 1,099 tests pass. Two-platform native journeys remain unverified while Android builds and iOS launcher automation is unresolved. | Native regression after rebuilt clients, then screen ports and final suite. No visual redesign or completed M2 claimed. |
