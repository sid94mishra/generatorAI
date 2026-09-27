# M1-04 — Current app characterization

In progress on 2026-09-27, starting from M1-03 commit `2f8bfb18`. SDK 57.0.25 / RN 0.86.3, Instrument / ink / dark, default text size. Only the isolated sandbox and its disposable repositories are used. Both clients were paired through sandbox-pair in M1-02; identity and fixture state remain current.

## Baselines

Local, gitignored captures are under `docs/redesign/shots/mobile/baseline/<screen>/<platform>-phone-instrument-dark-default.png`. Screens: Home, Chats, chat, Changes, Terminal and Settings. All six Android captures are saved and visually checked; matching iOS captures are pending. Home also has an additional `-drawer.png` capture. Chat shows the completed sandbox markdown stream; Changes shows its genuine empty state; Terminal shows the default scope gate. The corresponding committed mobile boards were inspected again in dark and light on both sides before this task.

| Screen | Android file under `baseline/` | iOS |
|---|---|---|
| Home | `home/android-phone-instrument-dark-default.png` | pending |
| Chats | `chats/android-phone-instrument-dark-default.png` | pending |
| Chat | `chat/android-phone-instrument-dark-default.png` | pending |
| Changes | `changes/android-phone-instrument-dark-default.png` | pending |
| Terminal | `terminal/android-phone-instrument-dark-default.png` | pending |
| Settings | `settings/android-phone-instrument-dark-default.png` | pending |

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
