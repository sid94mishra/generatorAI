# M1-04 — Current app characterization

In progress on 2026-09-27, starting from M1-03 commit `2f8bfb18`. SDK 57.0.25 / RN 0.86.3, Instrument / ink / dark, default text size. Only the isolated sandbox and its disposable repositories are used. Both clients were paired through sandbox-pair in M1-02; identity and fixture state remain current.

## Baselines

Local, gitignored captures are under `docs/redesign/shots/mobile/baseline/<screen>/<platform>-phone-instrument-dark-default.png`. Screens: Home, Chats, chat, Changes, Terminal and Settings. All six Android captures and all six matching iOS captures are saved and visually checked (iOS completed 2026-09-28 before any product selectors were added). Home also has an additional `-drawer.png` capture. Chat shows the completed sandbox markdown stream; Changes shows its genuine empty state; Terminal shows the default scope gate. The corresponding committed mobile boards were inspected again in dark and light on both sides before this task.

| Screen | Android file under `baseline/` | iOS |
|---|---|---|
| Home | `home/android-phone-instrument-dark-default.png` | captured 2026-09-28 |
| Chats | `chats/android-phone-instrument-dark-default.png` | captured 2026-09-28 |
| Chat | `chat/android-phone-instrument-dark-default.png` | captured 2026-09-28 |
| Changes | `changes/android-phone-instrument-dark-default.png` | captured 2026-09-28 |
| Terminal | `terminal/android-phone-instrument-dark-default.png` | captured 2026-09-28 |
| Settings | `settings/android-phone-instrument-dark-default.png` | captured 2026-09-28 |

## Findings before selectors or flows

- iOS pairing Name input is 42 pt high (minimum 44); retained from M1-03, no accessibility exemption.
- Expo Router can log an initial-URL update-before-mount warning during development-client startup. Preserve fresh logs and characterize recurrence.
- The current composer replaces Send with “Dictate a message” when its draft is empty. Flow examples that wait for Send after completion must characterize the actual idle state without changing product behavior or assigning a Send identifier to the microphone.
- Android driver labels editable inputs with their current value/placeholder; the semantic name “Message” lives in `contentDescription`. The planned `composer-input` testID removes this selector ambiguity.
- Default mobile scopes exclude `write:files`, `write:workspaces` and `exec:terminal`. The Terminal baseline correctly shows the permission gate. Later SCM/terminal characterization needs explicit, minimal grants to the paired test device through the isolated sandbox's existing device-scopes API. No grant has been made yet.

## Verification

No full characterization journey is claimed yet. Native tooling acceptance is recorded in `M1-notes.md`; screen flows and known behavior defects will be added here as they are exercised.

The pinned local iOS driver's first runner preparation compiled, then timed out connecting (300 s; `.expo/m1-baseline-ios-prepare.json`). The warm retry returned success after 293.7 s (`.expo/m1-baseline-ios-prepare-repeat.json`), but subsequent app inspection failed after the driver's automatic runner restart (`.expo/m1-baseline-ios-open.json`, `.expo/m1-baseline-ios-snapshot.json`). Apple's independent `simctl openurl` command also timed out with POSIX error 60. A screenshot showed the app splash, not a ready screen.

Stopped the agent session and rebooted only gai-iphone without erasing data. `bootstatus` finished in 21 s, but a subsequent deep link still timed out. Metro served the iOS bundle; the next screenshot showed Apple's boot screen (`.expo/m1-baseline-ios-reboot.png`). A bootstatus result alone is therefore insufficient acceptance. The final driver attempt and screenshot are recorded in `.expo/m1-baseline-ios-open-reboot.json` and `.expo/m1-baseline-ios-final-attempt.png`. No failed or transitional capture is counted as baseline evidence.

The final screenshot reached Expo's development launcher, not GeneratorAI's Home. The final driver attempt failed with `Daemon request timed out` after 210 s (diagnostic `mujo8ley-53eb7371`); its timed-out xcodebuild processes were terminated by the driver. Stopped under playbook §8's failed-exit-criterion rule after these recovery attempts. This does not invalidate the earlier passing M1-03 evidence, but it prevents claiming M1-04 acceptance.

Host pressure during these failures: 8 GiB RAM, 5.9 GiB swap used, 4.1 GiB disk available. With native builds stopped, removed only this worktree's regenerable 1.1 GiB `apps/mobile/.expo/native-build/ios/ModuleCache.noindex`; available disk increased to 5.1 GiB. Native products, source, installed simulators and all audit evidence were retained. Resource pressure is observed, not established as the sole cause of the simulator failures.

## Resume prerequisites

M1-04 is incomplete. Restore machine headroom (at least 20 GiB free, per M0 setup), restart macOS, then start the isolated sandbox and Metro and re-pair if the sandbox identity changed. Run only gai-iphone first and verify a responsive app, raw native snapshot and screenshot before capturing the six iOS baselines. The Android Stream fixture was consumed during capture; characterization must use fresh fixtures. No M1-04 product selectors, dev routes or Maestro journeys have been added yet, and no legacy journey scripts have been deleted.

At handoff both test phones are stopped, no iOS simulator is booted, the sandbox was stopped through sandbox-pair, and this task's Metro was terminated. Ports 3197, 5197 and 8081 have no listeners. Source changes in this checkpoint are documentation only; `git diff --check` passes. Full Done-loop/characterization acceptance remains pending, not skipped as a pass.

## Owner-requested cleanup and retry (2026-09-27, later session)

The read-only storage scan found Downloads at 154 GiB (largely personal media), developer caches including Gradle at 9.1 GiB and CocoaPods at 2 GiB, and CoreSimulator at 13 GiB. Personal files, simulator data, SDKs, installed dependencies, native products and evidence were preserved. With no active build/install process or open files under the selected cache directories, removed regenerable Gradle caches, CocoaPods download caches, npm's content cache and Homebrew downloads: **11.91 GiB allocated**, recorded in `.expo/cleanup-resume-report.json`. Free disk rose from 8.7 to about 20 GiB. The next native dependency build will regenerate/download these caches.

Restarted the isolated sandbox and Metro with only gai-iphone booted. Bootstatus completed in 15 s. The public artifact could not be retrieved through the web tool in this session; snapshot `1790412505-d42b` remains authoritative and untouched.

Recovery results:

- Sandbox-pair's iOS retry failed at runner preparation after its 300 s limit (`.expo/m1-resume-pair-ios.log`, diagnostic `mujsmh92-59d56f78`). No fresh pairing was completed.
- Independently ran the previously passing native launch flow through Maestro. Its runner started, but Apple's `simctl openurl` failed with POSIX error 60; the screenshot shows GeneratorAI's splash. Report: `.expo/m1-resume-maestro-ios.xml`, one failed flow. Detailed log: `~/.maestro/tests/2026-09-27_180226/maestro.log`.
- Shut down gai-iphone and restarted the existing user's CoreSimulatorService without erasing data. The initial launchctl command could not resolve its GUI service domain; verified the existing service PID and terminated that process normally instead. The service relaunched, and the phone booted in 6 s.
- The second independent Maestro attempt then failed to connect within its configured 180 s driver-startup limit (`.expo/m1-resume-maestro-ios-service.log`). A short native process sample (`.expo/m1-resume-maestro-runner-sample.txt`) places the runner in XCTest UI-automation/accessibility initialization and dynamic-library loading before the test begins. It does not establish an app-code deadlock or prove a single underlying cause.

Disk recovery alone and the simulator-service restart did not resolve the native blocker. A full macOS restart is the next owner action; the recorded uptime was over five days. M1-04 remains incomplete under playbook §8. Test simulator, sandbox and Metro were stopped again; source changes in this retry are evidence/progress notes only. Installed native apps and existing Android baselines remain available for the next attempt.

## App restart and narrower diagnosis (2026-09-27, 21:49–21:55 IST)

Retried the owner-requested app restart from a clean worktree with Android off. Checked the empty host dyld-cache directory using Apple's supported `simctl runtime dyld_shared_cache update` command for `com.apple.CoreSimulator.SimRuntime.iOS-27-0`. Although the command returned success, its diagnostic says the tool is obsolete and current simulator runtimes carry a prebuilt cache. This did not rebuild or repair a cache; the missing host cache is not evidence of corruption. No runtime or device was erased.

Restarted the isolated sandbox, Metro and gai-iphone. Bootstatus completed in 11 s. Direct `simctl launch --terminate-running-process` and the Expo development URL both eventually returned success. Metro bundled 2,962 modules in 11.9 s. A five-second app sample records Expo's native launcher laying out SwiftUI/UIKit views; it does not demonstrate a JavaScript deadlock. The delayed screenshot ultimately shows the app's “Can't reach your server” identity-verification screen, consistent with its old pairing requiring replacement after sandbox restart. It is not a baseline or pairing success.

The native driver remained blocked during preparation. Its Xcode diagnostic connected to the simulator's testmanagerd socket and initiated the control session without subsequent progress during observation. Host one-minute load rose from 257 to 299 (8 GiB RAM, approximately 4.9 GiB swap used, 17 GiB free disk, over five days uptime). Cancelled this attempt before its configured timeout because the machine was severely overloaded; do not count it as a new completed timeout or a passing driver check. The exact root cause remains unproven. Full macOS restart remains the next owner recovery action under playbook §8.

Evidence: `.expo/m1-cache-retry-{sandbox,metro,pair}.log`, `.expo/m1-cache-retry-app-sample.txt`, `.expo/m1-cache-retry-{launch,deeplink,ready}.png`; runner diagnostics under `~/.agent-device/apple-runner/derived/ios-simulator/cache-7e30ec40a34f9fac/Logs/Test/Test-AgentDeviceRunner-2026.09.27_21-53-03-+0530.xcresult/`. Stopped this task's sandbox, Metro, pairing process and simulator; verified no booted simulator or listeners on 3197/5197/8081. No product-code changes, new baselines or completed phases are claimed. After restart, re-pair with the fresh sandbox before baseline capture.

## Recovery completed after macOS restart (2026-09-28)

Confirmed the owner restarted macOS (three minutes uptime, 29 GiB free). iOS bootstatus completed in eight seconds; cold XCTest initialization eventually reached its listener. Authorization succeeded in the Xcode diagnostics despite `DevToolsSecurity -status` reporting disabled, so no system security setting was changed. An independent early Expo link timed out, but Metro later bundled and the app became responsive. Native snapshots exposed a separate reproducible helper bug: it waited indefinitely at the old server's connection error, then at the scanner title, neither recognized by `waitForApp`. Fixed only mobile tooling (MD-102), and fresh consent completed on both platforms.

Captured and visually inspected Home, Chats, completed real Faux stream, Changes (empty), Terminal (default scope gate) and Settings on iOS. Files are listed in the baseline table above. iOS keyboard dismissal has no dismiss key here, so the chat was left and reopened through its existing navigation before its capture. Raw refs were used where the pinned driver's processed selector heuristic reported the empty Toolbar overlay (MD-100).

Android's first cold startup showed “System UI isn't responding”; the native `alert get`/`alert dismiss` API closed that emulator system dialog, then the helper paired successfully. No device data or app storage was erased. Evidence: `.expo/m1-post-reboot-pair-final.log`, `.expo/m1-post-reboot-android-pair-retry.log`, `.expo/m1-android-anr-{alert,dismiss}.json`, and `.expo/m1-baseline-ios-*.json`. Six existing sandbox tooling tests pass. The twelve screen baselines are complete; full characterization flows remain pending. Selectors/dev routes are being implemented after baseline capture, and mobile typecheck passes. No legacy journey script has been deleted yet.

## Characterization implementation and first live results (2026-09-28)

Added the planned selectors without changing product behavior. The dev-only theme route reads/applies the actual provider preferences; the dev-only notification route registers the existing categories and posts the sandbox interaction payload. Maestro journeys are being verified sequentially. MD-103 records actual legacy control differences and narrowly scoped sandbox grants.

- Android send/stream: **passed**, 53 s (`apps/mobile/.expo/m1-android-stream.xml`), heading, fenced code, completion and idle controls asserted.
- Android two-phase stop: **passed**; ordinary Stop returned to idle, force-reset branch skipped (`apps/mobile/.expo/m1-android-stop.xml`, Maestro run `2026-09-28_182537`).
- Android approval: **failed** at the required editable-composer assertion. Native snapshot `.expo/m1-gate-failure.json` confirms `composer-input` is visible and disabled while the live permission card is pending. `app/chats/[id].tsx` constructs the `gate` banner only if a draft exists, but Composer uses that banner to keep the disabled field editable. Starting with an empty draft therefore prevents typing. Keep the assertion; do not mark this journey passed. Owner approval requested for a minimal behavior fix because M1-04 explicitly permits selectors only.
- Initial theme run stopped at harness launch readiness because Expo restored the previous chat. Updated launch setup to wait for Menu/Back, open the root route, then require `menu-button`; no product routing change. Retry pending.
- Seven sandbox tooling tests pass, including scope restoration after a failing native run. Mobile typecheck passes with the dev routes. Full suite and iOS checks remain pending.

Proposed approval fix, pending owner scope approval: keep the gate model present whenever blocked and unarchived; condition the banner rendering itself on draft content. That separates input editability from banner visibility without changing the intended banner appearance. Verify both pending-input editing and approval-to-idle in Maestro on both platforms.

### System appearance blocker and checkpoint

The theme retry (`.expo/m1-android-theme.xml`, Maestro `2026-09-28_182944`) successfully changed to Solarized/light and asserted both values again after stopping/relaunching the app. Its final reset to Instrument/System crashed in Android `AppearanceModule.setColorScheme`: a non-null Kotlin `String` received null. `src/theme/ThemeProvider.tsx` currently casts null past the RN type for System; installed RN 0.86.3 `Libraries/Utilities/Appearance.js` forwards its argument and the native module handles `"unspecified"` as follow-system. Proposed minimal fix: pass `"unspecified"`, remove the cast and obsolete null comment, then rerun on both platforms. This behavior change is not applied pending the same M1 scope approval.

Failure screenshots: `docs/redesign/shots/mobile/characterization/android-gate-disabled.png` and `android-system-mode-crash.png` (local, ignored). Approval failure remains asserted. Theme cleanup remains asserted; do not hide the crash by resetting to Dark instead.

Eight journeys are authored, but only send/stream and normal Stop have complete native passes, Android only. Pairing, approval, Changes, terminal, settings and notifications need completed acceptance on both platforms. SCM/terminal grant restoration has a passing failure-path unit test, but native grant refresh is unverified. Notification verification uses the existing stream replay API and requires `chat.permission.resolved` with `behavior: allow`; iOS preparation uses real native consent and a host-filled `simctl push` payload. These new runner branches are still pending native checks.

Latest typecheck passes; lint exits zero with the two existing warnings in scope-request and secureItemStore.web. Seven sandbox tooling tests pass; `git diff --check` passes. Bootstrap Done-loop steps 3 and Jest remain unavailable until M1-05/M1-06. No baseline changes, legacy journey deletions or M1 completion are claimed. Android was stopped after the crash to release memory; iOS is already stopped. Sandbox/Metro remain running. Free disk was 25 GiB. Resume by obtaining the narrow behavior-fix exception, applying both fixes, rebuilding only if fingerprint changes, then completing the task's native tests before M1-05.

## Authorized blocker fixes and verification (2026-09-28, evening)

Owner instructed continuing the phases after the two-fix proposal; MD-104 records the exception. Gate state now exists with an empty draft, while its banner still appears only after typing; System appearance passes the RN-supported unspecified value. Re-read Main and MThemesPhone dark/light boards. Public artifact retrieval failed again; snapshot remains authoritative. Both native fingerprints report no rebuild. Typecheck and lint pass, seven tooling tests pass; related Vitest finds no tests for these screen/provider files (native flows supply the regression checks).

Android gate regression passes (`.expo/m1-android-gate-fixed.xml`): typing and clearing a pending draft, allowing the command and returning to idle. First attempt hit keyboard occlusion before Send; screenshots show the composer beneath the Android IME. Flows now explicitly dismiss the keyboard before sending; this does not waive a keyboard-layout assertion because M1 pins send behavior, and the layout defect belongs to M6-06. Theme and remaining flow verification are ongoing.

Android theme regression passed in 80 s (`.expo/m1-android-theme-fixed.xml`), including System reset. Android Keep/Undo/Commit passed in 107 s (`.expo/m1-android-changes.xml`) with the exact subject verified in Git and original device scopes restored through the API afterward. The flow opens the real Kept filter, preserves tray expansion across turns, asserts Push/PR off and a commit-only submit label, then checks the successful sheet dismissal plus host history. No push or PR occurred. Repeated fresh runs reached the project's ten-codebase cap; MD-105 rotates to another temporary fixture project without deleting earlier data.

### Terminal and notification characterization follow-up

Terminal initially failed because the isolated sandbox rejected Android's `http://10.0.2.2:3197` WebSocket Origin and the personal zsh startup requested an Oh My Zsh update. Commit `3416574a` adds an explicit sandbox-only origin option and selects `/bin/sh` for POSIX mobile fixtures; production authorization is unchanged. All thirteen sandbox/tooling tests pass. Restarted the owned sandbox and completed fresh Android consent.

The retry (`.expo/m1-android-terminal-fixed.xml`, Maestro `2026-09-28_210522`) attaches successfully but still fails. Its native screenshot is blank. Read-only WebView debugging shows the shell prompt in `.xterm-rows`, with nonzero geometry and contrasting text colors. Server scrollback receives Enter but not the `inputText` command. The sheet uses RN Modal's default `hardwareAccelerated=false`, a rendering hypothesis to verify, not a proven cause. No terminal product fix or screenshot-fallback pass is claimed. Requested an M1 behavior exception for these blockers while continuing independent native checks.

Android notifications are posted with genuine Allow/Deny actions. The first test missed the shade; starting the swipe at the top edge after Home settles opens it. The second exposed an ambiguous preliminary `Allow` tap: it activated the heads-up notification action, then looked for an already-dismissed action in the shade. Server replay confirms `chat.permission.resolved` with `behavior: allow`. Removed that generic tap because sandbox-pair already grants permission. The complete corrected flow still needs a pass. A following pairing attempt was obscured by the shade left by the failed flow; collapsed it through Android's statusbar command before retrying. No app state or security bypass was used.

Corrected Android notification flow now passes (`.expo/m1-android-notification.xml`, Maestro `2026-09-28_211617`), including the runner's server replay assertion. It ends at Home so the shade cannot obscure the next flow. Fresh pairing also passes in 37 s (`.expo/m1-android-pairing.xml`) after waiting for the fresh Expo Development Build launcher before opening Metro; the runner verifies a newly created sandbox device. Seven of eight Android journeys have now passed individually; terminal and the full combined suite remain pending. Android stopped before starting iOS.

iOS boot and fresh sandbox consent succeeded. First chat flow reached the typed composer but Maestro `hideKeyboard` failed on its multiline input; the native screenshot shows Send visibly above the keyboard. Scoped the workaround added for Android to Android only in chat sends and pending-draft edits. No product keyboard change. iOS regression rerun is in progress.

Subsequent iOS startup crashed before the chat with `ExpoFabricView.injectInitializer` / AppContextLost (`GeneratorAI-2026-09-28-212348.ips`). MD-106 records the native launcher selection fallback; the next attempt reached the chat without crashing. That attempt's Send tap used its pre-keyboard frame (y=800), hitting Return; the final native hierarchy has the corrected y=487…526, and server replay has no prompt. Added `waitForAnimationToEnd` after typing/dismissing the keyboard before Send. The stream assertion remains required; no successful send is claimed for the stale-frame attempt.

All three corrected iOS chat flows now pass (`.expo/m1-ios-chat.xml` with per-flow reports): send/stream 40 s, pending-draft editing and approval 104 s, normal Stop 52 s. Force reset is skipped on both platforms because the fixture acknowledges cancellation. The gate fix is now verified on both OSes. Deleted replaced web-preview `chat.mjs`, `gatelive.mjs` and `stop.mjs` after these passes. Theme verification is next; no M1-04 completion claimed.

iOS theme persistence and Instrument/System reset also pass (`.expo/m1-ios-theme.xml`), confirming the System fix on both platforms. Deleted its replaced `light.mjs` journey. Both authorized product repairs now have native regressions on iOS and Android. iOS Changes, terminal, notifications and fresh pairing remain; Android terminal remains open.

iOS Keep/Undo/Commit passes (`.expo/m1-ios-changes.xml`) with exact dummy-repo commit verification. Push and PR remain off; the scope wrapper restores the device's original grants afterward. Five iOS journeys now pass. Notification handling is next.
