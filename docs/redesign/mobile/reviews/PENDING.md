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

| MV-07 | pending | M1-06 Storybook route, native rebuilds and two-platform story walkthrough/flow. Six Jest tests and static checks pass; iOS rebuild started. Fonts/text-scale integration waits M3 foundations. | Finish native rebuilds and Storybook flow; include M3 font readiness before kit VRT. |

| MV-08 | pending | M1-07 native markdown spike: 2,000-line fps and selection/copy not measured. Current renderer retained pending positive adoption evidence. | Complete with native harness, before M6-02. See M1-markdown-spike.md. |
| MV-09 | pending | M1-08 Gate A unpublished (>1.12.0), Gate B twelve checks not run. SDK 58 stable and NativeWind 5 stable unavailable. | SDK 58 preview scratch spike before M3 engine adoption; recheck releases. See M1-uniwind-spike.md. |

## 2026-09-29 continuation triage

Rechecked native host code: the legacy Sheet uses an animated RN Modal; WorkbenchSheet retains heavy panes in parked absolute-fill views. The Android software-modal/GPU hypothesis and iOS animation/lifecycle hypothesis are not proven fixes. Earlier targeted repair attempts restored sandbox terminal attachment but not usable rendering, and three notification-opening retries failed. Preserve these findings for the planned host replacements instead of marking the characterization green. Sandbox and Metro are healthy; 21 GiB free. Continue M1-05.
